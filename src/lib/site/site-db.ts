// q-injected loader for the public site: finds the so space's root `Site`
// folder, collects its descendant folders/notes, keeps only the ones whose
// effective visibility is `public`, and hands them to the pure
// `buildSiteModel`.
//
// Selects only the columns the public endpoint needs — no `userId`, no
// author/email fields ever leave this module.

import { effectiveVisibility } from '../writing/notes/visibility.ts';
import type { QueryFn } from '../writing/notes/access-core.ts';
import type { TenantId } from '../tenant/tenants.ts';
import { buildSiteModel, type SiteFolder, type SiteModel, type SiteNote } from './site-model.ts';

type FolderRow = { id: string; parentId: string | null; name: string; visibility: string | null; position: number | null };
type NoteRow = { id: string; folderId: string | null; title: string; body: string; visibility: string | null; position: number | null };

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

/**
 * Loads the public site for `tenantId`'s dissertation space. Returns `null`
 * when there is no such space or it has no root `Site` folder yet (nothing
 * has been bootstrapped).
 */
export async function loadPublicSite(q: QueryFn, { tenantId }: { tenantId: TenantId }): Promise<SiteModel | null> {
  const { data: spaceRows, error: spaceErr } = await q(
    `SELECT id FROM "Space" WHERE "tenantId" = $1 AND slug = 'dissertation' LIMIT 1`,
    [tenantId],
  );
  if (spaceErr) throw spaceErr instanceof Error ? spaceErr : new Error(String((spaceErr as any)?.message || spaceErr));
  const spaceId = spaceRows?.[0]?.id;
  if (!spaceId) return null;

  const { data: folderRows, error: folderErr } = await q(
    `SELECT id, "parentId", name, visibility, position FROM "LiveClassNoteFolder" WHERE "spaceId" = $1`,
    [spaceId],
  );
  if (folderErr) throw folderErr instanceof Error ? folderErr : new Error(String((folderErr as any)?.message || folderErr));
  const folders: FolderRow[] = folderRows ?? [];

  const siteFolder = folders.find((f) => f.parentId === null && f.name === 'Site');
  if (!siteFolder) return null;

  const foldersById = new Map(folders.map((f) => [f.id, f]));
  const descendantFolderIds = collectDescendantIds(siteFolder.id, folders);

  const siteFolders: SiteFolder[] = folders
    .filter((f) => descendantFolderIds.has(f.id))
    .map((f) => ({ id: f.id, parentId: f.parentId as string, name: f.name, position: f.position }));

  const { data: noteRows, error: noteErr } = await q(
    // Never select "userId" (or any other author/email column) here — this
    // module backs the public, unauthenticated /api/public/site endpoint.
    `SELECT id, "folderId", title, body, visibility, position FROM "LiveClassNote" WHERE "spaceId" = $1`,
    [spaceId],
  );
  if (noteErr) throw noteErr instanceof Error ? noteErr : new Error(String((noteErr as any)?.message || noteErr));
  const notes: NoteRow[] = noteRows ?? [];

  const siteNotes: SiteNote[] = notes
    .filter((n) => n.folderId === siteFolder.id || (n.folderId !== null && descendantFolderIds.has(n.folderId)))
    .filter((n) => effectiveVisibility(n, foldersById) === 'public')
    .map((n) => ({ id: n.id, folderId: n.folderId as string, title: n.title, body: n.body, position: n.position }));

  return buildSiteModel({ siteFolderId: siteFolder.id, folders: siteFolders, notes: siteNotes });
}
