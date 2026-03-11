import type { APIRoute } from 'astro';
import {
  isEditableCourseRepoPath,
  resolveCourseSource,
  sanitizeRepoMarkdownPath,
} from '../../../lib/content-admin';
import { json } from '../../../lib/forum-server';
import { getRepoFile, isGitHubAppConfigured, upsertRepoFile } from '../../../lib/github-app';
import { resolveLiveManageAccess } from '../../../lib/live/access';

export const prerender = false;

const normalizeText = (value: unknown) => String(value || '').trim();

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const sessionEmail = normalizeText(session?.user?.email);
  if (!sessionEmail) {
    return json({ error: 'Not authenticated' }, 401);
  }

  if (!isGitHubAppConfigured()) {
    return json({ error: 'GitHub App is not configured on the server.' }, 503);
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
    return json({ error: 'Only teachers can publish notes.' }, 403);
  }

  const source = resolveCourseSource(courseId);
  if (!source?.repo) {
    return json({ error: `No source repository is configured for course "${courseId}".` }, 400);
  }

  const targetPath = sanitizeRepoMarkdownPath(body?.targetPath || body?.path);
  if (!targetPath) {
    return json({ error: 'A valid markdown target path is required.' }, 400);
  }

  if (!isEditableCourseRepoPath(courseId, targetPath)) {
    return json({ error: 'The target path is outside the editable area for this course.' }, 403);
  }

  const content = String(body?.content || '').replace(/\r\n?/g, '\n');
  if (!content.trim()) {
    return json({ error: 'Content cannot be empty.' }, 400);
  }

  const branch = normalizeText(source.branch) || 'main';
  const mode = normalizeText(body?.mode).toLowerCase() === 'create' ? 'create' : 'edit';
  const expectedSha = normalizeText(body?.sha);

  const existing = await getRepoFile({
    repoFullName: source.repo,
    path: targetPath,
    ref: branch,
  });

  if (mode === 'create' && existing) {
    return json({ error: 'A file already exists at that path.', latestSha: existing.sha }, 409);
  }

  if (mode === 'edit' && !existing) {
    return json({ error: 'The note no longer exists in GitHub.' }, 404);
  }

  if (expectedSha && existing?.sha && expectedSha !== existing.sha) {
    return json(
      {
        error: 'The note changed upstream. Reload the editor before publishing again.',
        latestSha: existing.sha,
      },
      409,
    );
  }

  const message =
    normalizeText(body?.message) ||
    `${mode === 'create' ? 'create' : 'edit'}: ${targetPath}`;

  try {
    const result = await upsertRepoFile({
      repoFullName: source.repo,
      branch,
      path: targetPath,
      content,
      message,
      sha: existing?.sha || undefined,
      authorName: normalizeText(session?.user?.name) || sessionEmail,
      authorEmail: sessionEmail,
    });

    return json({
      success: true,
      mode,
      repo: source.repo,
      branch,
      path: result.path,
      commitSha: result.commitSha,
      commitUrl: result.commitUrl,
      fileSha: result.fileSha,
    });
  } catch (error: any) {
    console.error('Content publish error:', error);
    return json({ error: error?.message || 'Could not publish the note to GitHub.' }, 500);
  }
};
