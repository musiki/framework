import type { APIRoute } from 'astro';
import { json } from '../../../../lib/forum-server';
import { assertSameOriginJson } from '../../../../lib/tenant/studio-http';
import { resolveStudioSpace } from '../../../../lib/tenant/studio-space';
import { isUuid } from '../../../../lib/tenant/space-roles';
import { SpaceNotesError, reorderSpaceItem } from '../../../../lib/writing/notes/space-notes.ts';

function errorResponse(err: unknown): Response {
  if (err instanceof SpaceNotesError) return json({ error: err.message }, err.status);
  console.error('[api/studio/notes/reorder] Unexpected error:', err);
  return json({ error: 'Internal error' }, 500);
}

// POST /api/studio/notes/reorder
// { spaceId, kind: 'note'|'folder', id, parentId: string|null, targetIndex } -> { ok: true, positions }
export const POST: APIRoute = async ({ locals, request }) => {
  const csrf = assertSameOriginJson(request, { requireJson: true });
  if (csrf) return csrf;

  const payload = await request.json().catch(() => ({}));
  const spaceId = String(payload?.spaceId || '');
  const guard = await resolveStudioSpace(locals, spaceId);
  if (guard instanceof Response) return guard;
  const { userId } = guard;

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

  const targetIndex = Number(payload?.targetIndex);
  if (!Number.isInteger(targetIndex) || targetIndex < 0) return json({ error: 'targetIndex must be a non-negative integer' }, 400);

  try {
    const positions = await reorderSpaceItem({
      spaceId,
      userId,
      kind,
      id,
      parentId,
      targetIndex,
      locale: locals.tenant.locale,
    });
    return json({ ok: true, positions });
  } catch (err) {
    return errorResponse(err);
  }
};

export const prerender = false;
