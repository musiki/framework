// Pure, shared tree model for folders/notes with fractional manual ordering.
//
// No DOM, no astro/db imports — this module must stay usable from both the
// so studio and musiki's notes sidebar, and from plain `node --test` runs.

export type TreeFolder = {
  id: string;
  parentId: string | null;
  name: string;
  position?: number | null;
  visibility?: string | null;
};

export type TreeNote = {
  id: string;
  folderId: string | null;
  title: string;
  position?: number | null;
  visibility?: string | null;
  userId?: string | null;
};

export type TreeNode =
  | { kind: 'folder'; folder: TreeFolder; children: TreeNode[] }
  | { kind: 'note'; note: TreeNote };

/**
 * Sort a group of same-level siblings: items with a non-null `position`
 * come first, ordered ascending by position; items with a null position
 * follow, ordered alphabetically by `label` via
 * `label.localeCompare(otherLabel, locale, { sensitivity: 'base' })`.
 *
 * This mirrors musiki's current `notes-sidebar.ts` `renderNotesTree`
 * folder sort (`a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })`)
 * when locale is 'es' and every position is null — the "musiki-unchanged"
 * guarantee for folders.
 */
export function sortSiblings<T>(
  items: T[],
  key: (item: T) => { position?: number | null; label: string },
  locale: string,
): T[] {
  return [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    const pa = ka.position ?? null;
    const pb = kb.position ?? null;

    if (pa !== null && pb !== null) return pa - pb;
    if (pa !== null && pb === null) return -1;
    if (pa === null && pb !== null) return 1;
    return ka.label.localeCompare(kb.label, locale, { sensitivity: 'base' });
  });
}

/**
 * The exact display order `buildTree` uses for a group of sibling folders,
 * exposed so any caller that needs to reproduce that order outside of a
 * full tree build (e.g. `reorderSpaceItem` mapping a drop `targetIndex` to
 * a sibling slot) gets the same order the UI rendered, deterministically.
 *
 * Same rule as `sortSiblings` (position first, then
 * `name.localeCompare(name, locale, { sensitivity: 'base' })`), plus a
 * final `id.localeCompare(id)` tie-break so two folders with the same
 * `position` (or both null, same name under base sensitivity) always land
 * in the same order on every call — `sortSiblings` alone leaves exact ties
 * in whatever order the underlying (not-guaranteed-stable-across-engines)
 * `Array#sort` happened to produce, which is what let two independent
 * requests (e.g. the display the user dragged from vs. the request
 * `reorderSpaceItem` re-reads) disagree on tie order.
 */
export function displayOrderFolders<T extends { id: string; position?: number | null; name: string }>(
  folders: T[],
  locale: string,
): T[] {
  return [...folders].sort((a, b) => {
    const pa = a.position ?? null;
    const pb = b.position ?? null;

    if (pa !== null && pb !== null) return pa - pb;
    if (pa !== null && pb === null) return -1;
    if (pa === null && pb !== null) return 1;
    const cmp = a.name.localeCompare(b.name, locale, { sensitivity: 'base' });
    return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
  });
}

/**
 * The exact display order `buildTree` uses for a group of sibling notes —
 * see `displayOrderFolders` above for why this exists and why the final
 * `id` tie-break matters. `locale` is accepted so this has the same call
 * shape as `displayOrderFolders`, but it is intentionally NOT passed to
 * `localeCompare` for the title comparison: musiki's note sort never took
 * a locale/options argument, and changing that would break the
 * musiki-unchanged guarantee (`buildTree`'s all-null-positions test).
 */
export function displayOrderNotes<T extends { id: string; position?: number | null; title: string }>(
  notes: T[],
  _locale: string,
): T[] {
  return [...notes].sort((a, b) => {
    const pa = a.position ?? null;
    const pb = b.position ?? null;

    if (pa !== null && pb !== null) return pa - pb;
    if (pa !== null && pb === null) return -1;
    if (pa === null && pb !== null) return 1;
    const cmp = (a.title || '').localeCompare(b.title || '');
    return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
  });
}

/**
 * Build the folder/note tree.
 *
 * - Root level and each folder's children: folders are listed before notes.
 * - Folders within a group are ordered via `displayOrderFolders` (position,
 *   then `name` with the given `locale` and `sensitivity: 'base'`, then
 *   `id`), matching musiki's current folder sort exactly when all
 *   positions are null (the `id` tie-break only fires on exact ties).
 * - Notes within a group are ordered via `displayOrderNotes` — musiki's
 *   exact note comparator (position, then plain
 *   `title.localeCompare(title)`, then `id`).
 * - A folder whose `parentId` doesn't resolve to another folder in the
 *   input (including self-parenting) is treated as a root folder.
 * - A note whose `folderId` doesn't resolve to a folder in the input is
 *   treated as a root note.
 * - Cycles among folders (a -> b -> a) are broken: any folder that cannot
 *   reach a root through its parent chain within `folders.length` hops is
 *   treated as a root folder, so `buildTree` always terminates and every
 *   folder appears exactly once.
 */
export function buildTree(folders: TreeFolder[], notes: TreeNote[], locale = 'en'): TreeNode[] {
  const foldersById = new Map(folders.map((f) => [f.id, f]));

  // Determine, for every folder id, whether it should be treated as a root
  // (its parent chain is broken, missing, or cyclic).
  const isEffectiveRoot = new Map<string, boolean>();
  for (const folder of folders) {
    if (isEffectiveRoot.has(folder.id)) continue;
    const seen = new Set<string>();
    let current: TreeFolder | undefined = folder;
    let root = false;
    while (current) {
      if (current.parentId === null) {
        root = false; // has a real parent chain ending at the tree root
        break;
      }
      if (seen.has(current.id)) {
        // Cycle detected: everyone visited in this walk becomes a root.
        root = true;
        break;
      }
      seen.add(current.id);
      const parent = foldersById.get(current.parentId);
      if (!parent) {
        root = true; // parent missing -> orphan
        break;
      }
      current = parent;
    }
    for (const id of seen) isEffectiveRoot.set(id, root);
    isEffectiveRoot.set(folder.id, root);
  }

  const effectiveParentId = (folder: TreeFolder): string | null => {
    if (isEffectiveRoot.get(folder.id)) return null;
    return folder.parentId;
  };

  const childFoldersByParent = new Map<string | null, TreeFolder[]>();
  for (const folder of folders) {
    const parentId = effectiveParentId(folder);
    const list = childFoldersByParent.get(parentId) ?? [];
    list.push(folder);
    childFoldersByParent.set(parentId, list);
  }

  const notesByFolder = new Map<string | null, TreeNote[]>();
  for (const note of notes) {
    const folderId = note.folderId !== null && foldersById.has(note.folderId) ? note.folderId : null;
    const list = notesByFolder.get(folderId) ?? [];
    list.push(note);
    notesByFolder.set(folderId, list);
  }

  const buildLevel = (parentId: string | null): TreeNode[] => {
    const childFolders = displayOrderFolders(childFoldersByParent.get(parentId) ?? [], locale);
    const childNotes = displayOrderNotes(notesByFolder.get(parentId) ?? [], locale);

    const folderNodes: TreeNode[] = childFolders.map((folder) => ({
      kind: 'folder',
      folder,
      children: buildLevel(folder.id),
    }));
    const noteNodes: TreeNode[] = childNotes.map((note) => ({ kind: 'note', note }));

    return [...folderNodes, ...noteNodes];
  };

  return buildLevel(null);
}

/**
 * Position to use when inserting a new/moved sibling between `prev` and
 * `next` (both taken from already-sorted, adjacent siblings).
 *
 * - both null -> 1024 (first item in an empty/unpositioned list)
 * - only `next` given -> `next - 1024` (insert before everything)
 * - only `prev` given -> `prev + 1024` (insert after everything)
 * - both given -> midpoint `(prev + next) / 2`
 */
export function positionBetween(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return 1024;
  if (prev === null) return (next as number) - 1024;
  if (next === null) return prev + 1024;
  return (prev + next) / 2;
}

/**
 * True when `prev` and `next` are both non-null and so close together
 * (`|next - prev| < 1e-9`) that further fractional inserts between them
 * would lose precision, meaning the sibling group should be renormalized.
 */
export function needsRenormalize(prev: number | null, next: number | null): boolean {
  if (prev === null || next === null) return false;
  return Math.abs(next - prev) < 1e-9;
}

/**
 * Fresh, evenly-spaced positions for `count` siblings: `[1024, 2048, ...]`.
 */
export function renormalizedPositions(count: number): number[] {
  const result: number[] = [];
  for (let i = 1; i <= count; i++) result.push(i * 1024);
  return result;
}

/**
 * Plan the position assignment(s) needed to move `draggedId` to
 * `targetIndex` within `siblingsInDisplayOrder` — the sibling group
 * exactly as currently displayed (i.e. already run through `sortSiblings`
 * or the note equivalent), each with its raw `position`.
 *
 * `draggedId` may or may not be present in `siblingsInDisplayOrder`: when
 * the drag moves an item in from a *different* parent, it won't be, and
 * this function treats that the same as inserting a brand-new sibling.
 *
 * Steps:
 * 1. Remove `draggedId` from its current slot, if present, giving
 *    `remaining` (the other siblings, in display order).
 * 2. Clamp `targetIndex` to `[0, remaining.length]` and insert the dragged
 *    id there.
 * 3. If every sibling in `remaining` has a non-null `position` *and* the
 *    gap the drop lands in doesn't trip `needsRenormalize`, only the
 *    dragged item needs a new position: `positionBetween` of its new
 *    neighbours. This is the cheap common case once a sibling group has
 *    been fully migrated to fractional positions.
 * 4. Otherwise (any null position among the siblings — in particular
 *    musiki's current data, where every position is null — or the drop
 *    would land in too tight a gap) every sibling in the resulting order
 *    gets reassigned via `renormalizedPositions`, so the displayed order
 *    is exactly preserved (dragged item included at `targetIndex`)
 *    without relying on a single `1024` fallback that would otherwise
 *    always sort the dragged item to the very top ahead of the
 *    null-position remainder — the bug this replaces `dropPosition` to
 *    fix.
 */
export function planReorder(
  siblingsInDisplayOrder: { id: string; position: number | null }[],
  draggedId: string,
  targetIndex: number,
): { id: string; position: number }[] {
  const remaining = siblingsInDisplayOrder.filter((s) => s.id !== draggedId);
  const clampedIndex = Math.max(0, Math.min(targetIndex, remaining.length));

  const prev = clampedIndex > 0 ? remaining[clampedIndex - 1].position : null;
  const next = clampedIndex < remaining.length ? remaining[clampedIndex].position : null;

  const allPositioned = remaining.every((s) => s.position !== null);
  if (allPositioned && !needsRenormalize(prev, next)) {
    return [{ id: draggedId, position: positionBetween(prev, next) }];
  }

  const resultingIds = [
    ...remaining.slice(0, clampedIndex).map((s) => s.id),
    draggedId,
    ...remaining.slice(clampedIndex).map((s) => s.id),
  ];
  const positions = renormalizedPositions(resultingIds.length);
  return resultingIds.map((id, i) => ({ id, position: positions[i] }));
}
