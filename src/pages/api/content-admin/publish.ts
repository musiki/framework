import type { APIRoute } from 'astro';
import matter from 'gray-matter';
import {
  isEditableCourseRepoPath,
  resolveCourseSource,
  sanitizeRepoMarkdownPath,
} from '../../../lib/content-admin';
import { normalizeContentSlug } from '../../../lib/content-slug';
import { json } from '../../../lib/forum-server';
import {
  createBranch,
  createPullRequest,
  getRepoFile,
  isGitHubAppConfigured,
  upsertRepoFile,
} from '../../../lib/github-app';
import { resolveLiveManageAccess } from '../../../lib/live/access';

export const prerender = false;

const normalizeText = (value: unknown) => String(value || '').trim();

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const userName = normalizeText(session?.user?.name);
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

  const rawContent = String(body?.content || '').replace(/\r\n?/g, '\n');
  if (!rawContent.trim()) {
    return json({ error: 'Content cannot be empty.' }, 400);
  }

  const editSummary = normalizeText(body?.editSummary || body?.message) || 'Edit via online editor';
  
  // Update Frontmatter (MediaWiki-style versioning)
  let finalContent = rawContent;
  try {
    const { data: frontmatter, content: markdownBody } = matter(rawContent);
    frontmatter.updatedAt = new Date().toISOString();
    frontmatter.updatedBy = userName ? `${userName} <${sessionEmail}>` : sessionEmail;
    frontmatter.editSummary = editSummary;
    finalContent = matter.stringify(markdownBody, frontmatter);
  } catch (error) {
    console.warn('[Publish] Frontmatter parse error, using raw content:', error);
  }

  const baseBranch = normalizeText(source.branch) || 'main';
  const mode = normalizeText(body?.mode).toLowerCase() === 'create' ? 'create' : 'edit';
  const expectedSha = normalizeText(body?.sha);

  const existing = await getRepoFile({
    repoFullName: source.repo,
    path: targetPath,
    ref: baseBranch,
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

  const message = `${mode === 'create' ? 'create' : 'edit'}: ${targetPath}\n\n${editSummary}`;
  const isPublicPath = targetPath.startsWith('public/');
  const usePRWorkflow = isPublicPath;

  try {
    let activeBranch = baseBranch;
    let prResult = null;

    if (usePRWorkflow) {
      const userSlug = normalizeContentSlug(userName || sessionEmail.split('@')[0]);
      activeBranch = `editor/${userSlug}/${Date.now()}`;
      await createBranch({
        repoFullName: source.repo,
        branchName: activeBranch,
        baseBranch,
      });
    }

    const result = await upsertRepoFile({
      repoFullName: source.repo,
      branch: activeBranch,
      path: targetPath,
      content: finalContent,
      message,
      sha: (usePRWorkflow ? undefined : existing?.sha) || undefined,
      authorName: userName || sessionEmail,
      authorEmail: sessionEmail,
    });

    if (usePRWorkflow) {
      prResult = await createPullRequest({
        repoFullName: source.repo,
        head: activeBranch,
        base: baseBranch,
        title: `${mode === 'create' ? 'Create' : 'Edit'} ${targetPath}`,
        body: `Automated ${mode} request from Musiki Editor.\n\n**Author:** ${userName} (${sessionEmail})\n**Path:** ${targetPath}\n**Summary:** ${editSummary}`,
      });
    }

    return json({
      success: true,
      mode,
      repo: source.repo,
      branch: activeBranch,
      path: result.path,
      commitSha: result.commitSha,
      commitUrl: result.commitUrl,
      fileSha: result.fileSha,
      prUrl: prResult?.htmlUrl,
      prNumber: prResult?.number,
    });
  } catch (error: any) {
    console.error('Content publish error:', error);
    return json({ error: error?.message || 'Could not publish the note to GitHub.' }, 500);
  }
};
