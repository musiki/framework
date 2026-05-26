import type { APIRoute } from 'astro';
import { json } from '../../../lib/forum-server';
import { resolveLiveManageAccess } from '../../../lib/live/access';
import { getCourseNote, notesPreflightError } from '../../../lib/notes-fs';
import { renderRuntimeMarkdown } from '../../../lib/runtime-content';

type NotePreviewPayload = {
  slug: string;
  content: string;
  filePath: string;
  renderedHtml?: string;
};

async function addRenderedHtml(note: NotePreviewPayload, enabled: boolean): Promise<NotePreviewPayload> {
  if (!enabled) return note;
  const rendered = await renderRuntimeMarkdown(note.content, note.filePath).catch((error) => {
    console.error('[notes/get] Preview render failed:', error);
    return null;
  });
  return {
    ...note,
    renderedHtml: rendered?.html || '',
  };
}

export const prerender = false;

async function readContentCollectionFallback(courseId: string, slug: string): Promise<{ content: string; filePath: string } | null> {
  const cleanSlug = String(slug || '').replace(/^\/+/, '');
  const slugParts = cleanSlug.split('/').filter(Boolean);
  const requestedTail = slugParts[slugParts.length - 1] || cleanSlug;

  const { getCollection, getEntry } = await import('astro:content');
  const {
    getContentCanonicalSlug,
    getContentFilenameSlug,
    getContentFrontmatterSlug,
    getContentTitleSlug,
    normalizeContentSlug,
  } = await import('../../../lib/content-slug');

  const direct = await getEntry('content', cleanSlug as any);
  if (direct) {
    return {
      content: typeof direct.body === 'string' ? direct.body : '',
      filePath: direct.id,
    };
  }

  const normalizedTargets = [
    normalizeContentSlug(cleanSlug),
    normalizeContentSlug(requestedTail),
  ].filter(Boolean);
  const content = await getCollection('content');
  const match = content.find((item) => {
    const project = String(item.data?.project || '').trim().toLowerCase();
    if (project && project !== 'general' && project !== courseId.toLowerCase()) return false;

    const candidates = [
      getContentCanonicalSlug(item),
      getContentFrontmatterSlug(item),
      getContentFilenameSlug(item),
      getContentTitleSlug(item),
      normalizeContentSlug(item.id),
      normalizeContentSlug(String(item.id || '').split('/').pop()),
    ].filter(Boolean);
    return candidates.some((candidate) => normalizedTargets.includes(candidate));
  });

  if (!match) return null;
  return {
    content: typeof match.body === 'string' ? match.body : '',
    filePath: match.id,
  };
}

export const GET: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) return json({ error: 'Not authenticated' }, 401);

  const url = new URL(request.url);
  const courseId = url.searchParams.get('courseId')?.trim() || '';
  const slug = url.searchParams.get('slug')?.trim() || '';
  const includeRenderedHtml = url.searchParams.get('rendered') === 'true';
  if (!courseId || !slug) return json({ error: 'courseId and slug are required' }, 400);

  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage) return json({ error: 'Teacher access required' }, 403);

  const err = notesPreflightError(courseId);
  if (err) return json({ error: err }, 503);

  try {
    const note = getCourseNote(courseId, slug);
    if (!note) {
      const fallback = await readContentCollectionFallback(courseId, slug);
      if (fallback) {
        return json(await addRenderedHtml({
          slug,
          content: fallback.content,
          filePath: fallback.filePath,
        }, includeRenderedHtml));
      }
      return json({ error: 'Note not found' }, 404);
    }
    return json(await addRenderedHtml({
      slug,
      content: note.content,
      filePath: note.filePath,
    }, includeRenderedHtml));
  } catch (e: any) {
    return json({ error: e.message }, 400);
  }
};
