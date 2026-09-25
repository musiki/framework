import type { APIRoute } from 'astro';
import { cleanBody, cleanString, json } from '../../../lib/forum-server';
import { assertSameOriginJson } from '../../../lib/tenant/studio-http';
import { resolveStudioSpace } from '../../../lib/tenant/studio-space';
import { isUuid } from '../../../lib/tenant/space-roles';
import {
  SpaceNotesError,
  createSpaceNote,
  deleteSpaceNote,
  ensureOkaFolders,
  getSpaceNote,
  listSpaceTree,
  updateSpaceNote,
} from '../../../lib/writing/notes/space-notes.ts';
import type { UpdateSpaceNotePatch } from '../../../lib/writing/notes/space-notes-core.ts';
import { isVisibility, type Visibility } from '../../../lib/writing/notes/visibility.ts';

const TITLE_MAX = 160;
const BODY_MAX = 10_000_000;

function errorResponse(err: unknown): Response {
  if (err instanceof SpaceNotesError) return json({ error: err.message }, err.status);
  // Not a SpaceNotesError: an unexpected bug, not a mapped domain error —
  // log the detail server-side and never echo it (it could be a raw DB
  // message or stack detail) to the client.
  console.error('[api/studio/notes] Unexpected error:', err);
  return json({ error: 'Internal error' }, 500);
}

// GET /api/studio/notes?spaceId=...            -> { role, folders, notes }
// GET /api/studio/notes?spaceId=...&id=...      -> { notes: [ { ...note, accessLevel, versionsOnly } ], currentUserId }
export const GET: APIRoute = async ({ locals, url }) => {
  const spaceId = url.searchParams.get('spaceId') || '';
  const guard = await resolveStudioSpace(locals, spaceId);
  if (guard instanceof Response) return guard;
  const { userId, role } = guard;

  const rawNoteId = url.searchParams.get('id');
  if (rawNoteId && !isUuid(rawNoteId)) return json({ error: 'invalid-id' }, 400);
  const noteId = rawNoteId || null;

  try {
    if (noteId) {
      const result = await getSpaceNote({ spaceId, userId, noteId });
      if (!result) return json({ error: 'Not found' }, 404);
      const { note, accessLevel, versionsOnly } = result;
      return json({ notes: [{ ...note, accessLevel, versionsOnly }], currentUserId: userId });
    }

    if (role === 'author') {
      await ensureOkaFolders({ spaceId, authorId: userId });
    }
    const tree = await listSpaceTree({ spaceId, userId });
    return json(tree);
  } catch (err) {
    return errorResponse(err);
  }
};

// POST /api/studio/notes  { spaceId, folderId?, title?, body?, lang? } -> { note }
export const POST: APIRoute = async ({ locals, request }) => {
  const csrf = assertSameOriginJson(request, { requireJson: true });
  if (csrf) return csrf;

  const payload = await request.json().catch(() => ({}));
  const spaceId = String(payload?.spaceId || '');
  const guard = await resolveStudioSpace(locals, spaceId);
  if (guard instanceof Response) return guard;
  const { userId } = guard;

  const rawFolderId = payload?.folderId;
  if (rawFolderId !== undefined && rawFolderId !== null && !isUuid(String(rawFolderId))) {
    return json({ error: 'invalid-id' }, 400);
  }
  const folderId = rawFolderId ? String(rawFolderId) : null;
  const noteBody = cleanBody(payload?.body ?? '', BODY_MAX);
  const title = cleanString(payload?.title ?? '', TITLE_MAX) || 'untitled';
  const lang = cleanString(payload?.lang ?? '', 8) || null;

  try {
    const note = await createSpaceNote({ spaceId, userId, folderId, title, body: noteBody, lang });
    return json({ note });
  } catch (err) {
    return errorResponse(err);
  }
};

// PATCH /api/studio/notes  { spaceId, id, title?, body?, folderId?, visibility? } -> { ok: true }
export const PATCH: APIRoute = async ({ locals, request }) => {
  const csrf = assertSameOriginJson(request, { requireJson: true });
  if (csrf) return csrf;

  const payload = await request.json().catch(() => ({}));
  const spaceId = String(payload?.spaceId || '');
  const guard = await resolveStudioSpace(locals, spaceId);
  if (guard instanceof Response) return guard;
  const { userId } = guard;

  const noteId = String(payload?.id || '');
  if (!noteId) return json({ error: 'id required' }, 400);
  if (!isUuid(noteId)) return json({ error: 'invalid-id' }, 400);

  const patch: UpdateSpaceNotePatch = {};
  if ('title' in payload) patch.title = cleanString(payload.title ?? '', TITLE_MAX) || 'untitled';
  if ('body' in payload) patch.body = cleanBody(payload.body ?? '', BODY_MAX);
  if ('folderId' in payload) {
    const rawFolderId = payload.folderId;
    if (rawFolderId !== null && rawFolderId !== undefined && !isUuid(String(rawFolderId))) {
      return json({ error: 'invalid-id' }, 400);
    }
    patch.folderId = rawFolderId ? String(rawFolderId) : null;
  }
  if ('visibility' in payload) {
    const visibility = payload.visibility;
    if (visibility !== null && !isVisibility(visibility)) return json({ error: 'invalid visibility' }, 400);
    patch.visibility = (visibility as Visibility | null) ?? null;
  }

  try {
    await updateSpaceNote({ spaceId, userId, noteId, patch });
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
};

// DELETE /api/studio/notes?spaceId=...&id=... -> { ok: true }
export const DELETE: APIRoute = async ({ locals, request, url }) => {
  const csrf = assertSameOriginJson(request);
  if (csrf) return csrf;

  const spaceId = url.searchParams.get('spaceId') || '';
  const guard = await resolveStudioSpace(locals, spaceId);
  if (guard instanceof Response) return guard;
  const { userId } = guard;

  const noteId = url.searchParams.get('id') || '';
  if (!noteId) return json({ error: 'id required' }, 400);
  if (!isUuid(noteId)) return json({ error: 'invalid-id' }, 400);

  try {
    await deleteSpaceNote({ spaceId, userId, noteId });
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
};

export const prerender = false;
