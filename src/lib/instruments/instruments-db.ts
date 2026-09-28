// q-injected loader for the public instruments endpoint: finds the so
// space's `Cases` root folder, collects its descendant folders/notes, keeps
// only the ones whose effective visibility is `public`, projects each
// through `projectInstrument` (whitelisted frontmatter only), and sorts by
// title.
//
// Selects only the columns the public endpoint needs — no `userId`, no
// author/email fields ever leave this module.

import { effectiveVisibility } from '../writing/notes/visibility.ts';
import type { QueryFn } from '../writing/notes/access-core.ts';
import type { TenantId } from '../tenant/tenants.ts';
import { projectInstrument, type PublicInstrument } from './projection.ts';

type FolderRow = { id: string; parentId: string | null; name: string; visibility: string | null };
type NoteRow = { id: string; folderId: string | null; title: string; body: string; visibility: string | null };

/** Every folder id reachable from `rootId` by walking child links, excluding `rootId` itself. */
function collectDescendantIds(rootId: string, folders: FolderRow[]): Set<string> {
  const byParent = new Map<string | null, FolderRow[]>();
  for (const f of folders) {
    const list = byParent.get(f.parentId) ?? [];
    list.push(f);
    byParent.set(f.parentId, list);
  }
  const ids = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const child of byParent.get(id) ?? []) {
      if (ids.has(child.id)) continue; // cycle guard
      ids.add(child.id);
      stack.push(child.id);
    }
  }
  return ids;
}

/** True when `folderId` (or any of its ancestors up to, and including, the
 * `Cases` root) has a name containing "fictional" (case-insensitive). */
function isFictional(folderId: string | null, foldersById: Map<string, FolderRow>): boolean {
  const seen = new Set<string>();
  let id = folderId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = foldersById.get(id);
    if (!folder) break;
    if (folder.name.toLowerCase().includes('fictional')) return true;
    id = folder.parentId;
  }
  return false;
}

/**
 * Loads the public instruments for `tenantId`'s dissertation space (so
 * space slug `dissertation`, root folder `Cases`). Returns `[]` (never
 * throws for a missing space/folder) when there is no such space or it has
 * no root `Cases` folder yet, so the public endpoint can answer `200` with
 * an empty list instead of an error.
 */
export async function loadPublicInstruments(
  q: QueryFn,
  { tenantId }: { tenantId: TenantId },
): Promise<PublicInstrument[]> {
  const { data: spaceRows, error: spaceErr } = await q(
    `SELECT id FROM "Space" WHERE "tenantId" = $1 AND slug = 'dissertation' LIMIT 1`,
    [tenantId],
  );
  if (spaceErr) throw spaceErr instanceof Error ? spaceErr : new Error(String((spaceErr as any)?.message || spaceErr));
  const spaceId = spaceRows?.[0]?.id;
  if (!spaceId) return [];

  const { data: folderRows, error: folderErr } = await q(
    `SELECT id, "parentId", name, visibility FROM "LiveClassNoteFolder" WHERE "spaceId" = $1`,
    [spaceId],
  );
  if (folderErr) throw folderErr instanceof Error ? folderErr : new Error(String((folderErr as any)?.message || folderErr));
  const folders: FolderRow[] = folderRows ?? [];

  const casesFolder = folders.find((f) => f.parentId === null && f.name === 'Cases');
  if (!casesFolder) return [];

  const foldersById = new Map(folders.map((f) => [f.id, f]));
  const descendantFolderIds = collectDescendantIds(casesFolder.id, folders);

  const { data: noteRows, error: noteErr } = await q(
    // Never select "userId" (or any other author/email column) here — this
    // module backs the public, unauthenticated /api/public/instruments
    // endpoint.
    `SELECT id, "folderId", title, body, visibility FROM "LiveClassNote" WHERE "spaceId" = $1`,
    [spaceId],
  );
  if (noteErr) throw noteErr instanceof Error ? noteErr : new Error(String((noteErr as any)?.message || noteErr));
  const notes: NoteRow[] = noteRows ?? [];

  const instruments: PublicInstrument[] = notes
    .filter((n) => n.folderId === casesFolder.id || (n.folderId !== null && descendantFolderIds.has(n.folderId)))
    .filter((n) => effectiveVisibility(n, foldersById as Map<string, { id: string; parentId: string | null; visibility?: string | null }>) === 'public')
    .map((n) =>
      projectInstrument(
        { id: n.id, title: n.title, body: n.body },
        { fictional: isFictional(n.folderId, foldersById) },
      ),
    )
    .filter((instrument): instrument is PublicInstrument => instrument !== null);

  instruments.sort((a, b) => a.title.localeCompare(b.title, 'en'));

  return instruments;
}
