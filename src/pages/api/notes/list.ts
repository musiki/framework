import type { APIRoute } from 'astro';
import { json } from '../../../lib/forum-server';
import { resolveLiveManageAccess } from '../../../lib/live/access';
import { ensureCourseLatexTemplateNotes, listCourseNotes, notesPreflightError } from '../../../lib/notes-fs';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) return json({ error: 'Not authenticated' }, 401);

  const url = new URL(request.url);
  const courseId = url.searchParams.get('courseId')?.trim() || '';
  if (!courseId) return json({ error: 'courseId is required' }, 400);

  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage) return json({ error: 'Teacher access required' }, 403);

  const err = notesPreflightError(courseId);
  if (err) return json({ error: err }, 503);

  try {
    ensureCourseLatexTemplateNotes(courseId);
    const notes = listCourseNotes(courseId);
    return json({ notes });
  } catch (e: any) {
    return json({ error: e.message }, 400);
  }
};
