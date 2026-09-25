// Space notes core: tree listing, single-note fetch, CRUD, reorder, and OKA
// folder bootstrap for the so.zztt.org studio workspace.
//
// Pure module: no astro/db imports. Every function takes `q: QueryFn` first
// (see access-core.ts) so it can be exercised with fakeQuery in tests; the
// thin `space-notes.ts` wrapper binds `q` to the real pool `query` (and, for
// `reorderSpaceItem`, to a single pooled client so its multiple statements
// run inside one transaction).

import { isSpaceRole, type SpaceRole } from '../../tenant/space-roles.ts';
import { effectiveVisibility, isVisibility, type Visibility } from './visibility.ts';
import { resolveSpaceAccess, canManageSpace, type NoteAccess } from './space-access.ts';
import type { QueryFn } from './access-core.ts';
import type { TreeFolder, TreeNote } from '../tree/model.ts';
import { displayOrderFolders, displayOrderNotes, positionBetween, planReorder } from '../tree/model.ts';

export class SpaceNotesError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'SpaceNotesError';
    this.status = status;
  }
}

/** Normalizes whatever a `QueryFn` puts in `error` into a throwable `Error`. */
function toThrowable(error: unknown): Error {
  if (error instanceof Error) return error;
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);
  return new SpaceNotesError(500, message || 'database error');
}

/**
 * Runs a statement and throws when `q` reports an error, instead of letting
 * the caller silently treat a failed statement as "zero rows". Used inside
 * `reorderSpaceItem`'s transaction, where a swallowed error on one of the
 * UPDATEs would otherwise still reach `COMMIT` and report success while the
 * position/folder move never actually happened.
 */
async function runOrThrow(q: QueryFn, text: string, params: unknown[] = []): Promise<any[]> {
  const { data, error } = await q(text, params);
  if (error) throw toThrowable(error);
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Role / access helpers
// ---------------------------------------------------------------------------

export async function getMemberRole(q: QueryFn, spaceId: string, userId: string): Promise<SpaceRole | null> {
  const { data } = await q(
    `SELECT "role" FROM "SpaceMember" WHERE "spaceId" = $1 AND "userId" = $2::uuid LIMIT 1`,
    [spaceId, userId],
  );
  const role = data?.[0]?.role;
  return isSpaceRole(role) ? role : null;
}

async function requireRole(q: QueryFn, spaceId: string, userId: string): Promise<SpaceRole> {
  const role = await getMemberRole(q, spaceId, userId);
  if (!role) throw new SpaceNotesError(403, 'not a space member');
  return role;
}

async function requireAuthor(q: QueryFn, spaceId: string, userId: string): Promise<void> {
  const role = await requireRole(q, spaceId, userId);
  if (!canManageSpace(role)) throw new SpaceNotesError(403, 'author only');
}

async function assertFolderInSpace(q: QueryFn, spaceId: string, folderId: string): Promise<void> {
  const rows = await runOrThrow(
    q,
    `SELECT id FROM "LiveClassNoteFolder" WHERE id = $1 AND "spaceId" = $2 LIMIT 1`,
    [folderId, spaceId],
  );
  if (!rows.length) throw new SpaceNotesError(400, 'folder does not belong to this space');
}

async function lastPosition(
  q: QueryFn,
  table: '"LiveClassNote"' | '"LiveClassNoteFolder"',
  spaceId: string,
  parentColumn: '"folderId"' | '"parentId"',
  parentId: string | null,
): Promise<number | null> {
  const { data } = await q(
    `SELECT MAX("position") AS "maxPosition" FROM ${table} WHERE "spaceId" = $1 AND ${parentColumn} IS NOT DISTINCT FROM $2`,
    [spaceId, parentId],
  );
  const raw = data?.[0]?.maxPosition;
  return raw === null || raw === undefined ? null : Number(raw);
}

// ---------------------------------------------------------------------------
// Tree listing
// ---------------------------------------------------------------------------

export type SpaceTreeFolder = TreeFolder & { effectiveVisibility: Visibility };
export type SpaceTreeNote = TreeNote & {
  effectiveVisibility: Visibility;
  access: NoteAccess;
  versionsOnly: boolean;
};

/**
 * Loads every folder/note of the space (never selecting `body`), computes
 * effective visibility and role-based access per item, drops notes whose
 * access is null, and drops folders that contain no visible descendant
 * (note, anywhere below them) unless the caller is the space author — an
 * author always sees the full tree, including `private` root items, which
 * is otherwise unreachable for every other role (the matrix maps
 * `private` -> null for everyone but `author`).
 */
export async function listSpaceTree(
  q: QueryFn,
  { spaceId, userId }: { spaceId: string; userId: string },
): Promise<{ role: SpaceRole; folders: SpaceTreeFolder[]; notes: SpaceTreeNote[] }> {
  const role = await requireRole(q, spaceId, userId);

  const { data: folderRows } = await q(
    `SELECT id, "parentId", name, visibility, position FROM "LiveClassNoteFolder" WHERE "spaceId" = $1`,
    [spaceId],
  );
  const { data: noteRows } = await q(
    `SELECT id, "folderId", title, "userId", visibility, position FROM "LiveClassNote" WHERE "spaceId" = $1`,
    [spaceId],
  );

  const folders: TreeFolder[] = folderRows ?? [];
  const notes: TreeNote[] = noteRows ?? [];
  const foldersById = new Map(folders.map((f) => [f.id, { id: f.id, parentId: f.parentId, visibility: f.visibility }]));

  const isAuthor = canManageSpace(role);

  const notesByFolder = new Map<string | null, SpaceTreeNote[]>();
  const visibleNotes: SpaceTreeNote[] = [];
  for (const note of notes) {
    const vis = effectiveVisibility(note, foldersById);
    const { access, versionsOnly } = resolveSpaceAccess(role, vis);
    if (access === null) continue;
    const entry: SpaceTreeNote = { ...note, effectiveVisibility: vis, access, versionsOnly };
    visibleNotes.push(entry);
    const key = note.folderId ?? null;
    const list = notesByFolder.get(key) ?? [];
    list.push(entry);
    notesByFolder.set(key, list);
  }

  const childFoldersByParent = new Map<string | null, TreeFolder[]>();
  for (const folder of folders) {
    const key = folder.parentId ?? null;
    const list = childFoldersByParent.get(key) ?? [];
    list.push(folder);
    childFoldersByParent.set(key, list);
  }

  const visibleMemo = new Map<string, boolean>();
  const visiting = new Set<string>();
  const hasVisibleDescendant = (folderId: string): boolean => {
    if (visibleMemo.has(folderId)) return visibleMemo.get(folderId)!;
    if (visiting.has(folderId)) return false; // cycle guard: never revisit while resolving
    visiting.add(folderId);
    let result = (notesByFolder.get(folderId) ?? []).length > 0;
    if (!result) {
      for (const child of childFoldersByParent.get(folderId) ?? []) {
        if (hasVisibleDescendant(child.id)) {
          result = true;
          break;
        }
      }
    }
    visiting.delete(folderId);
    visibleMemo.set(folderId, result);
    return result;
  };

  const keptFolders = isAuthor ? folders : folders.filter((f) => hasVisibleDescendant(f.id));
  const outFolders: SpaceTreeFolder[] = keptFolders.map((f) => ({
    ...f,
    effectiveVisibility: effectiveVisibility({ visibility: f.visibility, folderId: f.parentId }, foldersById),
  }));

  return { role, folders: outFolders, notes: visibleNotes };
}

// ---------------------------------------------------------------------------
// Single note
// ---------------------------------------------------------------------------

export async function getSpaceNote(
  q: QueryFn,
  { spaceId, userId, noteId }: { spaceId: string; userId: string; noteId: string },
): Promise<{ note: Record<string, any>; accessLevel: NoteAccess; versionsOnly: boolean } | null> {
  const { data: noteRows } = await q(
    `SELECT id, "userId", "spaceId", "folderId", title, body, lang, visibility, position, "createdAt", "updatedAt"
       FROM "LiveClassNote" WHERE id = $1 AND "spaceId" = $2 LIMIT 1`,
    [noteId, spaceId],
  );
  if (!noteRows?.length) return null;
  const note = noteRows[0];

  const role = await getMemberRole(q, spaceId, userId);
  if (!role) return null;

  const { data: folderRows } = await q(
    `SELECT id, "parentId", visibility FROM "LiveClassNoteFolder" WHERE "spaceId" = $1`,
    [spaceId],
  );
  const foldersById = new Map((folderRows ?? []).map((f: any) => [f.id, f]));
  const vis = effectiveVisibility(note, foldersById);
  const { access, versionsOnly } = resolveSpaceAccess(role, vis);
  if (access === null) return null;

  const outNote = { ...note };
  if (versionsOnly) delete outNote.body;

  return { note: outNote, accessLevel: access, versionsOnly };
}

// ---------------------------------------------------------------------------
// Note CRUD
// ---------------------------------------------------------------------------

export async function createSpaceNote(
  q: QueryFn,
  {
    spaceId,
    userId,
    folderId,
    title,
    body,
    lang,
  }: { spaceId: string; userId: string; folderId: string | null; title: string; body: string; lang?: string | null },
): Promise<Record<string, any> | null> {
  await requireAuthor(q, spaceId, userId);
  if (folderId) await assertFolderInSpace(q, spaceId, folderId);

  const last = await lastPosition(q, '"LiveClassNote"', spaceId, '"folderId"', folderId ?? null);
  const position = positionBetween(last, null);

  const { data } = await q(
    `INSERT INTO "LiveClassNote" ("userId", "spaceId", "folderId", "courseId", title, body, lang, visibility, position)
     VALUES ($1, $2, $3, NULL, $4, $5, $6, NULL, $7)
     RETURNING *`,
    [userId, spaceId, folderId ?? null, title, body, lang ?? null, position],
  );
  return data?.[0] ?? null;
}

export type UpdateSpaceNotePatch = {
  title?: string;
  body?: string;
  folderId?: string | null;
  visibility?: Visibility | null;
};

export async function updateSpaceNote(
  q: QueryFn,
  {
    spaceId,
    userId,
    noteId,
    patch,
  }: { spaceId: string; userId: string; noteId: string; patch: UpdateSpaceNotePatch },
): Promise<Record<string, any> | null> {
  // Membership is checked before the note lookup so a non-member always
  // gets a uniform 403, whether or not `noteId` exists in this space —
  // otherwise the existence check alone would let a non-member distinguish
  // "note exists" (403 from the role check that used to run after it) from
  // "note doesn't exist" (404), turning `noteId` into an enumeration oracle.
  const role = await requireRole(q, spaceId, userId);

  const { data: noteRows } = await q(
    `SELECT id, "folderId", visibility FROM "LiveClassNote" WHERE id = $1 AND "spaceId" = $2 LIMIT 1`,
    [noteId, spaceId],
  );
  if (!noteRows?.length) throw new SpaceNotesError(404, 'note not found');
  const current = noteRows[0];

  const wantsContent = patch.title !== undefined || patch.body !== undefined;
  const wantsStructural = patch.folderId !== undefined || patch.visibility !== undefined;

  if (wantsContent) {
    const { data: folderRows } = await q(
      `SELECT id, "parentId", visibility FROM "LiveClassNoteFolder" WHERE "spaceId" = $1`,
      [spaceId],
    );
    const foldersById = new Map((folderRows ?? []).map((f: any) => [f.id, f]));
    const vis = effectiveVisibility(current, foldersById);
    const { access } = resolveSpaceAccess(role, vis);
    if (access !== 'edit') throw new SpaceNotesError(403, 'edit access required');
  }

  if (wantsStructural && !canManageSpace(role)) {
    throw new SpaceNotesError(403, 'author only');
  }

  if (patch.folderId !== undefined && patch.folderId !== null) {
    await assertFolderInSpace(q, spaceId, patch.folderId);
  }
  if (patch.visibility !== undefined && patch.visibility !== null && !isVisibility(patch.visibility)) {
    throw new SpaceNotesError(400, 'invalid visibility');
  }

  const sets: string[] = [];
  const params: any[] = [];
  if (patch.title !== undefined) {
    params.push(patch.title);
    sets.push(`"title" = $${params.length}`);
  }
  if (patch.body !== undefined) {
    params.push(patch.body);
    sets.push(`"body" = $${params.length}`);
  }
  if (patch.visibility !== undefined) {
    params.push(patch.visibility);
    sets.push(`"visibility" = $${params.length}`);
  }
  if (patch.folderId !== undefined) {
    params.push(patch.folderId);
    sets.push(`"folderId" = $${params.length}`);
    if (patch.folderId !== current.folderId) {
      // Moved to a different folder without an explicit reorder: append at
      // the end of the new sibling group (reorderSpaceItem handles the
      // "drop at a specific index" case separately).
      const last = await lastPosition(q, '"LiveClassNote"', spaceId, '"folderId"', patch.folderId);
      params.push(positionBetween(last, null));
      sets.push(`"position" = $${params.length}`);
    }
  }

  if (!sets.length) throw new SpaceNotesError(400, 'nothing to update');

  params.push(noteId, spaceId);
  const { data } = await q(
    `UPDATE "LiveClassNote" SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND "spaceId" = $${params.length} RETURNING *`,
    params,
  );
  return data?.[0] ?? null;
}

export async function deleteSpaceNote(
  q: QueryFn,
  { spaceId, userId, noteId }: { spaceId: string; userId: string; noteId: string },
): Promise<true> {
  await requireAuthor(q, spaceId, userId);
  const { data } = await q(`DELETE FROM "LiveClassNote" WHERE id = $1 AND "spaceId" = $2 RETURNING id`, [noteId, spaceId]);
  if (!data?.length) throw new SpaceNotesError(404, 'note not found');
  return true;
}

// ---------------------------------------------------------------------------
// Folder CRUD
// ---------------------------------------------------------------------------

export async function createSpaceFolder(
  q: QueryFn,
  {
    spaceId,
    userId,
    parentId,
    name,
    visibility,
  }: { spaceId: string; userId: string; parentId: string | null; name: string; visibility?: Visibility | null },
): Promise<Record<string, any> | null> {
  await requireAuthor(q, spaceId, userId);
  if (parentId) await assertFolderInSpace(q, spaceId, parentId);
  if (visibility != null && !isVisibility(visibility)) throw new SpaceNotesError(400, 'invalid visibility');

  const last = await lastPosition(q, '"LiveClassNoteFolder"', spaceId, '"parentId"', parentId ?? null);
  const position = positionBetween(last, null);

  const { data } = await q(
    `INSERT INTO "LiveClassNoteFolder" (name, "parentId", "userId", "spaceId", "courseId", visibility, position)
     VALUES ($1, $2, $3, $4, NULL, $5, $6)
     RETURNING *`,
    [name, parentId ?? null, userId, spaceId, visibility ?? null, position],
  );
  return data?.[0] ?? null;
}

export async function renameSpaceFolder(
  q: QueryFn,
  { spaceId, userId, folderId, name }: { spaceId: string; userId: string; folderId: string; name: string },
): Promise<Record<string, any>> {
  await requireAuthor(q, spaceId, userId);
  const { data } = await q(
    `UPDATE "LiveClassNoteFolder" SET name = $1 WHERE id = $2 AND "spaceId" = $3 RETURNING *`,
    [name, folderId, spaceId],
  );
  if (!data?.length) throw new SpaceNotesError(404, 'folder not found');
  return data[0];
}

export async function moveSpaceFolder(
  q: QueryFn,
  { spaceId, userId, folderId, parentId }: { spaceId: string; userId: string; folderId: string; parentId: string | null },
): Promise<Record<string, any> | null> {
  await requireAuthor(q, spaceId, userId);

  const allFolders = await runOrThrow(q, `SELECT id, "parentId" FROM "LiveClassNoteFolder" WHERE "spaceId" = $1`, [spaceId]);
  const rows: { id: string; parentId: string | null }[] = allFolders;
  const current = rows.find((f) => f.id === folderId);
  if (!current) throw new SpaceNotesError(404, 'folder not found');

  if (parentId !== null) {
    if (parentId === folderId) throw new SpaceNotesError(400, 'cannot move folder into itself');
    if (!rows.some((f) => f.id === parentId)) throw new SpaceNotesError(400, 'target folder does not belong to this space');

    const byId = new Map(rows.map((f) => [f.id, f]));
    let cur = byId.get(parentId);
    const seen = new Set<string>();
    while (cur) {
      if (cur.id === folderId) throw new SpaceNotesError(400, 'cannot move folder into its own descendant');
      if (seen.has(cur.id)) break;
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }

  const sets = ['"parentId" = $1'];
  const params: any[] = [parentId];
  if (parentId !== current.parentId) {
    // Moved to a genuinely different parent: append at the end of the new
    // sibling group (same rationale as updateSpaceNote's folderId move),
    // so the folder doesn't collide with — or silently jump ahead of —
    // whatever positions its new siblings already have.
    const last = await lastPosition(q, '"LiveClassNoteFolder"', spaceId, '"parentId"', parentId);
    params.push(positionBetween(last, null));
    sets.push(`position = $${params.length}`);
  }
  params.push(folderId, spaceId);

  const { data, error } = await q(
    `UPDATE "LiveClassNoteFolder" SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND "spaceId" = $${params.length} RETURNING *`,
    params,
  );
  if (error) throw toThrowable(error);
  return data?.[0] ?? null;
}

export async function deleteSpaceFolder(
  q: QueryFn,
  { spaceId, userId, folderId }: { spaceId: string; userId: string; folderId: string },
): Promise<true> {
  await requireAuthor(q, spaceId, userId);
  // A single DELETE is enough: LiveClassNoteFolder.parentId cascades (subfolders
  // are removed with it) and LiveClassNote.folderId is ON DELETE SET NULL, so
  // every direct note of the folder (and of each cascaded subfolder) detaches
  // to root automatically — the musiki note-folders.ts DELETE route predates
  // those FK actions and re-implements them by hand; this table already has them.
  const { data } = await q(`DELETE FROM "LiveClassNoteFolder" WHERE id = $1 AND "spaceId" = $2 RETURNING id`, [folderId, spaceId]);
  if (!data?.length) throw new SpaceNotesError(404, 'folder not found');
  return true;
}

export async function setFolderVisibility(
  q: QueryFn,
  { spaceId, userId, folderId, visibility }: { spaceId: string; userId: string; folderId: string; visibility: Visibility | null },
): Promise<Record<string, any>> {
  await requireAuthor(q, spaceId, userId);
  if (visibility !== null && !isVisibility(visibility)) throw new SpaceNotesError(400, 'invalid visibility');

  const { data } = await q(
    `UPDATE "LiveClassNoteFolder" SET visibility = $1 WHERE id = $2 AND "spaceId" = $3 RETURNING *`,
    [visibility, folderId, spaceId],
  );
  if (!data?.length) throw new SpaceNotesError(404, 'folder not found');
  return data[0];
}

// ---------------------------------------------------------------------------
// Reorder (drag & drop) — author only, single transaction
// ---------------------------------------------------------------------------

export async function reorderSpaceItem(
  q: QueryFn,
  {
    spaceId,
    userId,
    kind,
    id,
    parentId,
    targetIndex,
    locale = 'en',
  }: {
    spaceId: string;
    userId: string;
    kind: 'note' | 'folder';
    id: string;
    parentId: string | null;
    targetIndex: number;
    /** UI locale driving the display-order tie-break — so passes 'en', musiki 'es'. */
    locale?: string;
  },
): Promise<{ id: string; position: number }[]> {
  await requireAuthor(q, spaceId, userId);

  if (kind === 'folder' && parentId === id) {
    throw new SpaceNotesError(400, 'cannot move folder into itself');
  }

  const table = kind === 'note' ? '"LiveClassNote"' : '"LiveClassNoteFolder"';
  const parentColumn = kind === 'note' ? '"folderId"' : '"parentId"';
  const labelColumn = kind === 'note' ? 'title' : 'name';

  // The dragged id must actually be a `kind` item of this space, or the
  // rest of this function would silently no-op every UPDATE (WHERE id=...
  // AND "spaceId"=... simply matches zero rows) while still reporting a
  // planned reorder as if it had happened.
  const existsRows = await runOrThrow(q, `SELECT id FROM ${table} WHERE id = $1 AND "spaceId" = $2 LIMIT 1`, [id, spaceId]);
  if (!existsRows.length) throw new SpaceNotesError(404, `${kind} not found`);

  const beginResult = await q('BEGIN');
  if (beginResult.error) throw toThrowable(beginResult.error);

  try {
    if (parentId !== null) {
      await assertFolderInSpace(q, spaceId, parentId);
    }

    if (kind === 'folder' && parentId !== null) {
      const allFolders = await runOrThrow(q, `SELECT id, "parentId" FROM "LiveClassNoteFolder" WHERE "spaceId" = $1`, [spaceId]);
      const byId = new Map<string, { id: string; parentId: string | null }>(allFolders.map((f: any) => [f.id, f]));
      let cur = byId.get(parentId);
      const seen = new Set<string>();
      while (cur) {
        if (cur.id === id) throw new SpaceNotesError(400, 'cannot move folder into its own descendant');
        if (seen.has(cur.id)) break;
        seen.add(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }

    const siblingRows = await runOrThrow(
      q,
      `SELECT id, position, ${labelColumn} AS label FROM ${table} WHERE "spaceId" = $1 AND ${parentColumn} IS NOT DISTINCT FROM $2`,
      [spaceId, parentId],
    );
    // Same display order buildTree would render for this sibling group
    // (position first, then the kind-appropriate label comparator, then a
    // final `id` tie-break) — so the UI's `targetIndex` always maps to the
    // slot the user actually saw, instead of `sortSiblings`'s looser,
    // non-deterministic-on-ties order that could disagree between the
    // request that rendered the list and this one re-reading it.
    const siblings =
      kind === 'note'
        ? displayOrderNotes(
            siblingRows.map((r: any) => ({ id: r.id, position: r.position, title: r.label ?? '' })),
            locale,
          )
        : displayOrderFolders(
            siblingRows.map((r: any) => ({ id: r.id, position: r.position, name: r.label ?? '' })),
            locale,
          );

    const assignments = planReorder(
      siblings.map((s) => ({ id: s.id, position: s.position ?? null })),
      id,
      targetIndex,
    );

    for (const a of assignments) {
      await runOrThrow(q, `UPDATE ${table} SET position = $1 WHERE id = $2 AND "spaceId" = $3`, [a.position, a.id, spaceId]);
    }

    if (kind === 'note') {
      await runOrThrow(q, `UPDATE "LiveClassNote" SET "folderId" = $1 WHERE id = $2 AND "spaceId" = $3`, [parentId, id, spaceId]);
    } else {
      await runOrThrow(q, `UPDATE "LiveClassNoteFolder" SET "parentId" = $1 WHERE id = $2 AND "spaceId" = $3`, [parentId, id, spaceId]);
    }

    const commitResult = await q('COMMIT');
    if (commitResult.error) throw toThrowable(commitResult.error);
    return assignments;
  } catch (err) {
    await q('ROLLBACK');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// OKA bootstrap
// ---------------------------------------------------------------------------

const OKA_FOLDERS: { name: string; visibility: Visibility; position: number }[] = [
  { name: 'GTX', visibility: 'supervision', position: 1024 },
  { name: 'Output', visibility: 'committee', position: 2048 },
];

export async function ensureOkaFolders(
  q: QueryFn,
  { spaceId, authorId }: { spaceId: string; authorId: string },
): Promise<void> {
  const { data } = await q(
    `SELECT name FROM "LiveClassNoteFolder" WHERE "spaceId" = $1 AND "parentId" IS NULL AND name = ANY($2)`,
    [spaceId, OKA_FOLDERS.map((f) => f.name)],
  );
  const existing = new Set((data ?? []).map((r: any) => r.name));

  for (const folder of OKA_FOLDERS) {
    if (existing.has(folder.name)) continue;
    await q(
      `INSERT INTO "LiveClassNoteFolder" (name, "parentId", "userId", "spaceId", "courseId", visibility, position)
       VALUES ($1, NULL, $2, $3, NULL, $4, $5)`,
      [folder.name, authorId, spaceId, folder.visibility, folder.position],
    );
  }
}
