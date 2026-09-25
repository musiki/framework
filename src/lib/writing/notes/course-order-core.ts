// Pure, DB-agnostic core for musiki's DB-notes manual ordering.
//
// Scope: courseId-scoped rows only, always "spaceId" IS NULL, and always
// the caller's own rows ("userId" = the authenticated user) — this module
// must never read or write a Studio space's rows. Mirrors
// `space-notes-core.ts`'s `reorderSpaceItem` shape (single transaction,
// same `buildTree`-order sibling read via displayOrderFolders/Notes, same
// `planReorder` assignment), but scoped by (userId, courseId) instead of
// by SpaceMember role.
//
// No astro/db imports — takes `q: QueryFn` first so it is exercisable with
// fakeQuery in tests; the thin `src/pages/api/live/notes/reorder.ts` route
// binds `q` to a single pooled client (via `getClient`) for the whole call
// so every statement runs inside one transaction.

import type { QueryFn } from './access-core.ts';
import { displayOrderFolders, displayOrderNotes, planReorder } from '../tree/model.ts';

export class CourseOrderError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'CourseOrderError';
    this.status = status;
  }
}

function toThrowable(error: unknown): Error {
  if (error instanceof Error) return error;
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);
  return new CourseOrderError(500, message || 'database error');
}

// Never acknowledge a statement when the database returned an error.
async function checkedQuery(q: QueryFn, text: string, params: unknown[] = []) {
  const result = await q(text, params);
  if (result.error) {
    throw new Error(
      result.error instanceof Error
        ? result.error.message
        : String((result.error as { message?: unknown })?.message || 'Database error'),
    );
  }
  return result;
}

async function runOrThrow(q: QueryFn, text: string, params: unknown[] = []): Promise<any[]> {
  const { data, error } = await checkedQuery(q, text, params);
  if (error) throw toThrowable(error);
  return data ?? [];
}

export type CourseOrderKind = 'note' | 'folder';

/**
 * Move `id` (a `kind` row owned by `userId` in `courseId`'s scope, never a
 * space row) to `targetIndex` among its `parentId` siblings, in exactly one
 * transaction on the caller-supplied `q` (bound to a single pooled client).
 *
 * Steps mirror `reorderSpaceItem`:
 * 1. Confirm the dragged row exists, is owned by `userId`, in this course
 *    scope, and is not a space row (404 otherwise, no BEGIN issued).
 * 2. BEGIN.
 * 3. If moving into a folder, confirm that folder is owned by the same
 *    user in the same course scope (400 otherwise).
 * 4. For a folder move, reject moving into itself or into its own
 *    descendant (400).
 * 5. Read the target parent's siblings in the exact order `buildTree`
 *    would render them (`displayOrderFolders`/`displayOrderNotes`, given
 *    `locale`), plan the position assignment(s) with `planReorder`, and
 *    persist every assignment plus the folder/parent move.
 * 6. COMMIT and return the assignments, or ROLLBACK and rethrow on any
 *    failure.
 */
export async function reorderCourseItem(
  q: QueryFn,
  {
    userId,
    courseId,
    kind,
    id,
    parentId,
    targetIndex,
    locale = 'es',
  }: {
    userId: string;
    courseId: string | null;
    kind: CourseOrderKind;
    id: string;
    parentId: string | null;
    targetIndex: number;
    /** UI locale driving the display-order tie-break; musiki passes 'es'. */
    locale?: string;
  },
): Promise<{ id: string; position: number }[]> {
  if (kind === 'folder' && parentId === id) {
    throw new CourseOrderError(400, 'cannot move folder into itself');
  }

  const table = kind === 'note' ? '"LiveClassNote"' : '"LiveClassNoteFolder"';
  const parentColumn = kind === 'note' ? '"folderId"' : '"parentId"';
  const labelColumn = kind === 'note' ? 'title' : 'name';

  // The dragged id must actually be an owned `kind` item of this course
  // scope (and never a space row), or every UPDATE below would silently
  // match zero rows while this still reported a planned reorder as done.
  const existsRows = await runOrThrow(
    q,
    `SELECT id FROM ${table}
     WHERE id = $1::uuid AND "userId" = $2::uuid AND "courseId" IS NOT DISTINCT FROM $3 AND "spaceId" IS NULL
     LIMIT 1`,
    [id, userId, courseId],
  );
  if (!existsRows.length) throw new CourseOrderError(404, `${kind} not found`);

  const beginResult = await checkedQuery(q, 'BEGIN');
  if (beginResult.error) throw toThrowable(beginResult.error);

  try {
    if (parentId !== null) {
      const parentRows = await runOrThrow(
        q,
        `SELECT id FROM "LiveClassNoteFolder"
         WHERE id = $1::uuid AND "userId" = $2::uuid AND "courseId" IS NOT DISTINCT FROM $3 AND "spaceId" IS NULL
         LIMIT 1`,
        [parentId, userId, courseId],
      );
      if (!parentRows.length) throw new CourseOrderError(400, 'parent folder does not belong to this scope');
    }

    if (kind === 'folder' && parentId !== null) {
      const allFolders = await runOrThrow(
        q,
        `SELECT id, "parentId" FROM "LiveClassNoteFolder"
         WHERE "userId" = $1::uuid AND "courseId" IS NOT DISTINCT FROM $2 AND "spaceId" IS NULL`,
        [userId, courseId],
      );
      const byId = new Map<string, { id: string; parentId: string | null }>(
        allFolders.map((f: any) => [f.id, f]),
      );
      let cur = byId.get(parentId);
      const seen = new Set<string>();
      while (cur) {
        if (cur.id === id) throw new CourseOrderError(400, 'cannot move folder into its own descendant');
        if (seen.has(cur.id)) break;
        seen.add(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }

    const siblingRows = await runOrThrow(
      q,
      `SELECT id, position, ${labelColumn} AS label FROM ${table}
       WHERE "userId" = $1::uuid AND "courseId" IS NOT DISTINCT FROM $2 AND "spaceId" IS NULL
         AND ${parentColumn} IS NOT DISTINCT FROM $3`,
      [userId, courseId, parentId],
    );
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
      await runOrThrow(
        q,
        `UPDATE ${table} SET position = $1 WHERE id = $2::uuid AND "userId" = $3::uuid AND "spaceId" IS NULL`,
        [a.position, a.id, userId],
      );
    }

    if (kind === 'note') {
      await runOrThrow(
        q,
        `UPDATE "LiveClassNote" SET "folderId" = $1 WHERE id = $2::uuid AND "userId" = $3::uuid AND "spaceId" IS NULL`,
        [parentId, id, userId],
      );
    } else {
      await runOrThrow(
        q,
        `UPDATE "LiveClassNoteFolder" SET "parentId" = $1 WHERE id = $2::uuid AND "userId" = $3::uuid AND "spaceId" IS NULL`,
        [parentId, id, userId],
      );
    }

    const commitResult = await checkedQuery(q, 'COMMIT');
    if (commitResult.error) throw toThrowable(commitResult.error);
    return assignments;
  } catch (err) {
    await checkedQuery(q, 'ROLLBACK');
    throw err;
  }
}
