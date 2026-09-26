import type { APIRoute } from 'astro';
import { cleanString, ensureDbUserFromSession, json } from '../../../../lib/forum-server';
import { getClient } from '../../../../lib/db/pool';
import { isUuid } from '../../../../lib/tenant/space-roles';
import { CourseOrderError, reorderCourseItem } from '../../../../lib/writing/notes/course-order-core';
import type { QueryFn } from '../../../../lib/writing/notes/access-core';

function errorResponse(err: unknown): Response {
  if (err instanceof CourseOrderError) return json({ error: err.message }, err.status);
  console.error('[api/live/notes/reorder] Unexpected error:', err);
  return json({ error: 'Internal error' }, 500);
}

// POST /api/live/notes/reorder
// { courseId: string|null, kind: 'note'|'folder', id, parentId: string|null, targetIndex } -> { ok: true, positions }
// Owner only: reorders the caller's own DB notes/folders within a course scope (or the
// courseId=null root scope). Never touches a Studio space's rows.
export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const payload = await request.json().catch(() => ({}));

  const kind = payload?.kind === 'folder' ? 'folder' : payload?.kind === 'note' ? 'note' : null;
  if (!kind) return json({ error: "kind must be 'note' or 'folder'" }, 400);

  const id = String(payload?.id || '');
  if (!id) return json({ error: 'id required' }, 400);
  if (!isUuid(id)) return json({ error: 'invalid-id' }, 400);

  const rawParentId = payload?.parentId;
  if (rawParentId !== null && rawParentId !== undefined && !isUuid(String(rawParentId))) {
    return json({ error: 'invalid-id' }, 400);
  }
  const parentId = rawParentId ? String(rawParentId) : null;

  const courseId = cleanString(String(payload?.courseId ?? ''), 120) || null;

  const targetIndex = Number(payload?.targetIndex);
  if (!Number.isInteger(targetIndex) || targetIndex < 0) {
    return json({ error: 'targetIndex must be a non-negative integer' }, 400);
  }

  const client = await getClient();
  const q: QueryFn = async (text, params = []) => {
    try {
      const res = await client.query(text, params as any[]);
      return { data: res.rows, error: null };
    } catch (error) {
      return { data: null, error };
    }
  };

  try {
    const positions = await reorderCourseItem(q, {
      userId: user.id,
      courseId,
      kind,
      id,
      parentId,
      targetIndex,
      locale: 'es',
    });
    client.release();
    return json({ ok: true, positions });
  } catch (err) {
    if (err instanceof CourseOrderError) {
      // Either rejected before any BEGIN was issued (the dragged-item
      // existence/self-parent checks), or the core already rolled back
      // cleanly on its own `q` before rethrowing — the connection is fine
      // to return to the pool normally.
      client.release();
    } else {
      // An unexpected DB/transaction-layer error — release with the error so
      // pg discards this connection instead of returning a possibly still
      // mid-rollback connection to the pool for reuse.
      client.release(err instanceof Error ? err : new Error(String(err)));
    }
    return errorResponse(err);
  }
};

export const prerender = false;
