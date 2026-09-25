import type { APIRoute } from 'astro';
import { cleanString, json } from '../../../../lib/forum-server';
import { assertSameOriginJson } from '../../../../lib/tenant/studio-http';
import { resolveStudioSpace } from '../../../../lib/tenant/studio-space';
import { SpaceNotesError, reorderSpaceItem } from '../../../../lib/writing/notes/space-notes.ts';

function errorResponse(err: unknown): Response {
  if (err instanceof SpaceNotesError) return json({ error: err.message }, err.status);
  return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
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

  const id = cleanString(payload?.id ?? '', 36);
  if (!id) return json({ error: 'id required' }, 400);

  const parentId = payload?.parentId === null || payload?.parentId === undefined
    ? null
    : cleanString(String(payload.parentId ?? ''), 36) || null;

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
