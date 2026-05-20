import type { APIRoute } from 'astro';
import { json } from '../../../lib/forum-server';
import { resolveLiveManageAccess } from '../../../lib/live/access';
import { getCourseNote, notesPreflightError } from '../../../lib/notes-fs';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) return json({ error: 'Not authenticated' }, 401);

  const url = new URL(request.url);
  const courseId = url.searchParams.get('courseId')?.trim() || '';
  const slug = url.searchParams.get('slug')?.trim() || '';
  if (!courseId || !slug) return json({ error: 'courseId and slug are required' }, 400);

  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage) return json({ error: 'Teacher access required' }, 403);

  const err = notesPreflightError(courseId);
  if (err) return json({ error: err }, 503);

  try {
    const note = getCourseNote(courseId, slug);
    if (!note) return json({ error: 'Note not found' }, 404);
    return json({ slug, content: note.content, filePath: note.filePath });
  } catch (e: any) {
    return json({ error: e.message }, 400);
  }
};
