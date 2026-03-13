import type { APIRoute } from 'astro';
import { json } from '../../../lib/forum-server';
import { renderRuntimeMarkdown } from '../../../lib/runtime-content';
import { resolveLiveManageAccess } from '../../../lib/live/access';

export const prerender = false;

const normalizeText = (value: unknown) => String(value || '').trim();

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const sessionEmail = normalizeText(session?.user?.email);
  if (!sessionEmail) {
    return json({ error: 'Not authenticated' }, 401);
  }

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const courseId = normalizeText(body?.courseId);
  if (!courseId) {
    return json({ error: 'courseId is required.' }, 400);
  }

  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage) {
    return json({ error: 'Only teachers can preview notes.' }, 403);
  }

  const rawContent = String(body?.content || '').replace(/\r\n?/g, '\n');
  if (!rawContent.trim()) {
    return json({ html: '', frontmatter: {} });
  }

  try {
    const rendered = await renderRuntimeMarkdown(rawContent, normalizeText(body?.path || 'preview'));
    return json({
      success: true,
      html: rendered?.html || '',
      frontmatter: rendered?.frontmatter || {},
    });
  } catch (error: any) {
    console.error('[content-admin/preview] Render error:', error);
    return json({ error: error?.message || 'Could not render preview.' }, 500);
  }
};
