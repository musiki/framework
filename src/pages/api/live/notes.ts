import type { APIRoute } from 'astro';
import {
  cleanBody,
  cleanString,
  createSupabaseServerClient,
  ensureDbUserFromSession,
  json,
} from '../../../lib/forum-server';
import { renderForumMarkdown } from '../../../lib/forum-markdown';

const TITLE_MAX = 160;
const BODY_MAX  = 8_000;

// GET  /api/live/notes?courseId=...&roomName=...&limit=40
export const GET: APIRoute = async ({ request, locals, url }) => {
  const session = (locals as any).session;
  const supabase = createSupabaseServerClient();
  const user = await ensureDbUserFromSession(supabase, session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const courseId = cleanString(url.searchParams.get('courseId') ?? '', 120) || null;
  const roomName = cleanString(url.searchParams.get('roomName') ?? '', 120) || null;
  const limit    = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || '40')));

  let query = supabase
    .from('LiveClassNote')
    .select('id, title, body, renderedHtml, noteDate, createdAt, updatedAt')
    .eq('userId', user.id)
    .order('noteDate', { ascending: false })
    .order('updatedAt', { ascending: false })
    .limit(limit);

  if (courseId) query = query.eq('courseId', courseId);
  if (roomName) query = query.eq('roomName', roomName);

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  return json({ notes: data ?? [] });
};

// POST /api/live/notes  — upsert by id (create if no id, update if id provided)
export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const supabase = createSupabaseServerClient();
  const user = await ensureDbUserFromSession(supabase, session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body   = await request.json().catch(() => ({}));
  const id       = cleanString(body?.id ?? '', 36) || null;
  const title    = cleanString(body?.title ?? '', TITLE_MAX);
  const noteBody = cleanBody(body?.body ?? '', BODY_MAX);
  const courseId = cleanString(body?.courseId ?? '', 120) || null;
  const roomName = cleanString(body?.roomName ?? '', 120) || null;
  const noteDate = cleanString(body?.noteDate ?? '', 10) || new Date().toISOString().slice(0, 10);

  // Render markdown (mermaid + lilypond + math) server-side for instant display
  let renderedHtml: string | null = null;
  try {
    renderedHtml = await renderForumMarkdown(noteBody, { remoteLilypond: true });
  } catch {
    // non-fatal: client can still show raw markdown
  }

  const row = { userId: user.id, title, body: noteBody, renderedHtml, courseId, roomName, noteDate };

  let result;
  if (id) {
    // Update — only if it belongs to this user
    result = await supabase
      .from('LiveClassNote')
      .update(row)
      .eq('id', id)
      .eq('userId', user.id)
      .select('id, title, renderedHtml, noteDate, updatedAt')
      .single();
  } else {
    result = await supabase
      .from('LiveClassNote')
      .insert(row)
      .select('id, title, renderedHtml, noteDate, createdAt')
      .single();
  }

  if (result.error) return json({ error: result.error.message }, 500);
  return json({ note: result.data });
};

// DELETE /api/live/notes?id=...
export const DELETE: APIRoute = async ({ url, locals }) => {
  const session = (locals as any).session;
  const supabase = createSupabaseServerClient();
  const user = await ensureDbUserFromSession(supabase, session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const id = cleanString(url.searchParams.get('id') ?? '', 36);
  if (!id) return json({ error: 'id required' }, 400);

  const { error } = await supabase
    .from('LiveClassNote')
    .delete()
    .eq('id', id)
    .eq('userId', user.id);

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
};
