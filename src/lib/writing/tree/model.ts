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
 * Sort siblings using musiki's exact note tie-break comparator:
 * `(a.title || '').localeCompare(b.title || '')` — plain `localeCompare`,
 * no locale argument, no options. This is deliberately NOT the same
 * comparator as `sortSiblings`'s label tie-break (which takes a locale and
 * `sensitivity: 'base'`), because musiki's note sort in
 * `src/scripts/course/notes-sidebar.ts` never passed those either. Keeping
 * this as a separate function (rather than threading a "notes mode" flag
 * through `sortSiblings`) is what lets `buildTree` reproduce musiki's
 * behavior byte-for-byte for notes while still honoring the shared
 * `position`-first rule.
 */
function sortNoteSiblings(notes: TreeNote[]): TreeNote[] {
  return [...notes].sort((a, b) => {
    const pa = a.position ?? null;
    const pb = b.position ?? null;

    if (pa !== null && pb !== null) return pa - pb;
    if (pa !== null && pb === null) return -1;
    if (pa === null && pb !== null) return 1;
    return (a.title || '').localeCompare(b.title || '');
  });
}

/**
 * Build the folder/note tree.
 *
 * - Root level and each folder's children: folders are listed before notes.
 * - Folders within a group are ordered via `sortSiblings` (position, then
 *   `name` with the given `locale` and `sensitivity: 'base'`), matching
 *   musiki's current folder sort exactly when all positions are null.
 * - Notes within a group are ordered via musiki's exact note comparator
 *   (position, then plain `title.localeCompare(title)`).
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
    const childFolders = sortSiblings(
      childFoldersByParent.get(parentId) ?? [],
      (f) => ({ position: f.position, label: f.name }),
      locale,
    );
    const childNotes = sortNoteSiblings(notesByFolder.get(parentId) ?? []);

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
 * Position for inserting a sibling at `index` among `siblingPositions`,
 * an array of the *already-sorted* siblings' current positions (nulls
 * allowed, in whatever order those siblings actually appear — e.g. from
 * `sortSiblings`/`buildTree` output, where null-position siblings sort
 * after positioned ones).
 *
 * Rule: take `prev` as the nearest non-null position at an index strictly
 * before `index` (scanning backwards), and `next` as the nearest non-null
 * position at an index >= `index` (scanning forwards) — i.e. we look past
 * any immediately-adjacent null-position siblings to find real numeric
 * neighbours, rather than trying to renormalize them first. Then return
 * `positionBetween(prev, next)`. This keeps the helper a one-shot pure
 * function: renormalizing the null-position siblings into real positions
 * is a separate, explicit step (`renormalizedPositions`) a caller can run
 * first if it wants every sibling numerically positioned.
 */
export function dropPosition(siblingPositions: (number | null)[], index: number): number {
  let prev: number | null = null;
  for (let i = index - 1; i >= 0; i--) {
    if (siblingPositions[i] !== null) {
      prev = siblingPositions[i] as number;
      break;
    }
  }

  let next: number | null = null;
  for (let i = index; i < siblingPositions.length; i++) {
    if (siblingPositions[i] !== null) {
      next = siblingPositions[i] as number;
      break;
    }
  }

  return positionBetween(prev, next);
}
