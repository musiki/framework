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

/** The dissertation data behind `/api/public/instruments` always lives in
 * the `so` tenant's space, regardless of which host the request came in
 * on — the `musiki` default tenant has no `dissertation` space of its own,
 * so loading with the *request* tenant's id there would always yield `[]`.
 * Every caller of `loadPublicInstruments` for this endpoint must pass this
 * constant, never `locals.tenant.id`. */
export const INSTRUMENTS_SOURCE_TENANT: TenantId = 'so';

/** Which request-tenant hosts may reach the public instruments endpoint at
 * all (the data source is always {@link INSTRUMENTS_SOURCE_TENANT}
 * regardless of which of these hosts served the request). */
export function isInstrumentsHostAllowed(tenantId: string): boolean {
  return tenantId === 'so' || tenantId === 'musiki';
}

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
  // The Cases root itself plus every descendant folder — the full set of
  // folder ids a note must live directly under to be in scope. Computed
  // before the query so the filter runs in SQL, not by pulling every note
  // in the space into JS and discarding most of them.
  const caseFolderIds = [casesFolder.id, ...descendantFolderIds];

  const { data: noteRows, error: noteErr } = await q(
    // Never select "userId" (or any other author/email column) here — this
    // module backs the public, unauthenticated /api/public/instruments
    // endpoint. Filtering by folderId here (not in JS after a
    // SELECT * of the space) means notes outside the Cases tree are never
    // even requested from the database.
    `SELECT id, "folderId", title, body, visibility FROM "LiveClassNote" WHERE "spaceId" = $1 AND "folderId" = ANY($2::uuid[])`,
    [spaceId, caseFolderIds],
  );
  if (noteErr) throw noteErr instanceof Error ? noteErr : new Error(String((noteErr as any)?.message || noteErr));
  const notes: NoteRow[] = noteRows ?? [];

  const instruments: PublicInstrument[] = notes
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

export type PublicInstrumentsResponse =
  | { status: 200; body: { generatedAt: string; instruments: PublicInstrument[] } }
  | { status: 404 | 500; body: { error: string } };

/**
 * Pure, q-injected core of `GET /api/public/instruments`: gates on the
 * *request* tenant (`requestTenantId`, i.e. which host the request came in
 * on) via {@link isInstrumentsHostAllowed}, then always loads instrument
 * data from {@link INSTRUMENTS_SOURCE_TENANT}'s space — never from
 * `requestTenantId`'s own space. This is what makes a `musiki`-host
 * request return the `so` studio's data instead of always `[]` (the
 * `musiki` tenant has no `dissertation` space of its own).
 *
 * Returns a plain `{status, body}` pair (no `Response`/Astro types) so the
 * route handler and its host-sourcing behavior are testable with a fake
 * `q` and no Astro request machinery.
 */
export async function handlePublicInstrumentsRequest(
  q: QueryFn,
  requestTenantId: string,
): Promise<PublicInstrumentsResponse> {
  if (!isInstrumentsHostAllowed(requestTenantId)) {
    return { status: 404, body: { error: 'Not found' } };
  }
  try {
    const instruments = await loadPublicInstruments(q, { tenantId: INSTRUMENTS_SOURCE_TENANT });
    return { status: 200, body: { generatedAt: new Date().toISOString(), instruments } };
  } catch (err) {
    console.error('[api/public/instruments] failed to load public instruments:', err);
    return { status: 500, body: { error: 'Internal error' } };
  }
}
