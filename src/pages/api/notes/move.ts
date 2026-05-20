import type { APIRoute } from 'astro';
import { json } from '../../../lib/forum-server';
import { resolveLiveManageAccess } from '../../../lib/live/access';
import { moveCourseNote, notesPreflightError } from '../../../lib/notes-fs';

export const prerender = false;

const normalizeText = (v: unknown) => String(v || '').trim();

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) return json({ error: 'Not authenticated' }, 401);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const courseId = normalizeText(body?.courseId);
  const slug = normalizeText(body?.slug);
  const newSlug = normalizeText(body?.newSlug);
  if (!courseId || !slug || !newSlug) {
    return json({ error: 'courseId, slug, and newSlug are required' }, 400);
  }

  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage) return json({ error: 'Teacher access required' }, 403);

  const err = notesPreflightError(courseId);
  if (err) return json({ error: err }, 503);

  try {
    moveCourseNote(courseId, slug, newSlug);
    return json({ ok: true, slug: newSlug });
  } catch (e: any) {
    return json({ error: e.message }, 400);
  }
};
