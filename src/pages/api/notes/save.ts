import type { APIRoute } from 'astro';
import { json } from '../../../lib/forum-server';
import { resolveLiveManageAccess } from '../../../lib/live/access';
import { saveCourseNote, notesPreflightError } from '../../../lib/notes-fs';

export const prerender = false;

const normalizeText = (v: unknown) => String(v || '').trim();

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) return json({ error: 'Not authenticated' }, 401);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const courseId = normalizeText(body?.courseId);
  const slug = normalizeText(body?.slug);
  const content = typeof body?.content === 'string' ? body.content : null;

  if (!courseId || !slug || content === null) {
    console.warn('[notes/save] invalid payload', {
      hasCourseId: Boolean(courseId),
      hasSlug: Boolean(slug),
      hasContent: content !== null,
    });
    return json({ error: 'courseId, slug, and content are required' }, 400);
  }

  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage) return json({ error: 'Teacher access required' }, 403);

  const err = notesPreflightError(courseId);
  if (err) return json({ error: err }, 503);

  try {
    const result = saveCourseNote(courseId, slug, content);
    return json({ ok: true, slug, filePath: result.filePath });
  } catch (e: any) {
    console.warn('[notes/save] rejected', {
      courseId,
      slug,
      error: String(e?.message || e),
    });
    return json({ error: e.message }, 400);
  }
};
