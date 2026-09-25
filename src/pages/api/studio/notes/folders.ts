import type { APIRoute } from 'astro';
import { cleanString, json } from '../../../../lib/forum-server';
import { assertSameOriginJson } from '../../../../lib/tenant/studio-http';
import { resolveStudioSpace } from '../../../../lib/tenant/studio-space';
import { isUuid } from '../../../../lib/tenant/space-roles';
import {
  SpaceNotesError,
  createSpaceFolder,
  deleteSpaceFolder,
  listSpaceTree,
  moveSpaceFolder,
  renameSpaceFolder,
  setFolderVisibility,
} from '../../../../lib/writing/notes/space-notes.ts';
import { isVisibility, type Visibility } from '../../../../lib/writing/notes/visibility.ts';

function errorResponse(err: unknown): Response {
  if (err instanceof SpaceNotesError) return json({ error: err.message }, err.status);
  console.error('[api/studio/notes/folders] Unexpected error:', err);
  return json({ error: 'Internal error' }, 500);
}

// GET /api/studio/notes/folders?spaceId=... -> { folders }
export const GET: APIRoute = async ({ locals, url }) => {
  const spaceId = url.searchParams.get('spaceId') || '';
  const guard = await resolveStudioSpace(locals, spaceId);
  if (guard instanceof Response) return guard;
  const { userId } = guard;

  try {
    const { folders } = await listSpaceTree({ spaceId, userId });
    return json({ folders });
  } catch (err) {
    return errorResponse(err);
  }
};

// POST /api/studio/notes/folders  { spaceId, parentId?, name, visibility? } -> { folder }
export const POST: APIRoute = async ({ locals, request }) => {
  const csrf = assertSameOriginJson(request, { requireJson: true });
  if (csrf) return csrf;

  const payload = await request.json().catch(() => ({}));
  const spaceId = String(payload?.spaceId || '');
  const guard = await resolveStudioSpace(locals, spaceId);
  if (guard instanceof Response) return guard;
  const { userId } = guard;

  const name = cleanString(payload?.name ?? '', 160);
  if (!name) return json({ error: 'name required' }, 400);

  const rawParentId = payload?.parentId;
  if (rawParentId !== undefined && rawParentId !== null && !isUuid(String(rawParentId))) {
    return json({ error: 'invalid-id' }, 400);
  }
  const parentId = rawParentId ? String(rawParentId) : null;

  const visibility = payload?.visibility;
  if (visibility != null && !isVisibility(visibility)) return json({ error: 'invalid visibility' }, 400);

  try {
    const folder = await createSpaceFolder({
      spaceId,
      userId,
      parentId,
      name,
      visibility: (visibility as Visibility | null) ?? null,
    });
    return json({ folder });
  } catch (err) {
    return errorResponse(err);
  }
};

// PATCH /api/studio/notes/folders  { spaceId, id, name?, parentId?, visibility? } -> { folder }
export const PATCH: APIRoute = async ({ locals, request }) => {
  const csrf = assertSameOriginJson(request, { requireJson: true });
  if (csrf) return csrf;

  const payload = await request.json().catch(() => ({}));
  const spaceId = String(payload?.spaceId || '');
  const guard = await resolveStudioSpace(locals, spaceId);
  if (guard instanceof Response) return guard;
  const { userId } = guard;

  const folderId = String(payload?.id || '');
  if (!folderId) return json({ error: 'id required' }, 400);
  if (!isUuid(folderId)) return json({ error: 'invalid-id' }, 400);

  const hasName = 'name' in payload;
  const hasParent = 'parentId' in payload;
  const hasVisibility = 'visibility' in payload;
  if (!hasName && !hasParent && !hasVisibility) return json({ error: 'nothing to update' }, 400);

  if (hasVisibility) {
    const visibility = payload.visibility;
    if (visibility !== null && !isVisibility(visibility)) return json({ error: 'invalid visibility' }, 400);
  }
  let parentId: string | null = null;
  if (hasParent) {
    const rawParentId = payload.parentId;
    if (rawParentId !== null && rawParentId !== undefined && !isUuid(String(rawParentId))) {
      return json({ error: 'invalid-id' }, 400);
    }
    parentId = rawParentId ? String(rawParentId) : null;
  }

  try {
    let folder: Record<string, any> | null = null;
    if (hasName) {
      const name = cleanString(payload.name ?? '', 160);
      if (!name) return json({ error: 'name required' }, 400);
      folder = await renameSpaceFolder({ spaceId, userId, folderId, name });
    }
    if (hasParent) {
      folder = await moveSpaceFolder({ spaceId, userId, folderId, parentId });
    }
    if (hasVisibility) {
      const visibility = (payload.visibility as Visibility | null) ?? null;
      folder = await setFolderVisibility({ spaceId, userId, folderId, visibility });
    }
    return json({ folder });
  } catch (err) {
    return errorResponse(err);
  }
};

// DELETE /api/studio/notes/folders?spaceId=...&id=... -> { ok: true }
export const DELETE: APIRoute = async ({ locals, request, url }) => {
  const csrf = assertSameOriginJson(request);
  if (csrf) return csrf;

  const spaceId = url.searchParams.get('spaceId') || '';
  const guard = await resolveStudioSpace(locals, spaceId);
  if (guard instanceof Response) return guard;
  const { userId } = guard;

  const folderId = url.searchParams.get('id') || '';
  if (!folderId) return json({ error: 'id required' }, 400);
  if (!isUuid(folderId)) return json({ error: 'invalid-id' }, 400);

  try {
    await deleteSpaceFolder({ spaceId, userId, folderId });
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
};

export const prerender = false;
