import type { APIRoute } from 'astro';
import matter from 'gray-matter';
import {
  buildCreateCandidatePath,
  getEditableLocalRepoFile,
  isEditableCourseRepoPath,
  isLocalContentAdminEnabled,
  resolveCourseSource,
  sanitizeRepoMarkdownPath,
  writeEditableLocalRepoFile,
} from '../../../lib/content-admin';
import { normalizeContentSlug } from '../../../lib/content-slug';
import { json } from '../../../lib/forum-server';
import { renderRuntimeMarkdown } from '../../../lib/runtime-content';
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
  const localContentAdminEnabled = isLocalContentAdminEnabled();
  const userName = normalizeText(session?.user?.name);
  const sessionEmail = normalizeText(session?.user?.email);
  if (!sessionEmail) {
    return json({ error: 'Not authenticated' }, 401);
  }

  if (!localContentAdminEnabled && !isGitHubAppConfigured()) {
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

  const requestedTargetPath = sanitizeRepoMarkdownPath(body?.targetPath || body?.path);
  if (!requestedTargetPath) {
    return json({ error: 'A valid markdown target path is required.' }, 400);
  }

  if (!isEditableCourseRepoPath(courseId, requestedTargetPath)) {
    return json({ error: 'The target path is outside the editable area for this course.' }, 403);
  }

  const rawContent = String(body?.content || '').replace(/\r\n?/g, '\n');
  if (!rawContent.trim()) {
    return json({ error: 'Content cannot be empty.' }, 400);
  }

  const editSummary = normalizeText(body?.editSummary || body?.message) || 'Edit via online editor';

  // Update Frontmatter (MediaWiki-style versioning)
  let finalContent = rawContent;
  let parsedFrontmatter: Record<string, unknown> = {};
  try {
    const { data, content: markdownBody } = matter(rawContent);
    const frontmatter = { ...(data || {}) } as Record<string, unknown>;
    frontmatter.updatedAt = new Date().toISOString();
    frontmatter.updatedBy = userName ? `${userName} <${sessionEmail}>` : sessionEmail;
    frontmatter.editSummary = editSummary;
    parsedFrontmatter = frontmatter;
    finalContent = matter.stringify(markdownBody, frontmatter);
  } catch (error) {
    console.warn('[Publish] Frontmatter parse error, using raw content:', error);
  }

  const baseBranch = normalizeText(source.branch) || 'main';
  const mode = normalizeText(body?.mode).toLowerCase() === 'create' ? 'create' : 'edit';
  const expectedSha = normalizeText(body?.sha);

  const loadExistingFile = (candidatePath: string) =>
    localContentAdminEnabled
      ? Promise.resolve(getEditableLocalRepoFile(source, candidatePath))
      : getRepoFile({
          repoFullName: source.repo,
          path: candidatePath,
          ref: baseBranch,
        });

  let targetPath = requestedTargetPath;
  let existing: Awaited<ReturnType<typeof loadExistingFile>> = null;

  if (mode === 'create') {
    let resolvedCreatePath = '';
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const candidatePath = buildCreateCandidatePath({
        courseId,
        preferredPath: requestedTargetPath,
        title: parsedFrontmatter?.title,
        attempt,
      });
      const candidateExisting = await loadExistingFile(candidatePath);
      if (!candidateExisting) {
        resolvedCreatePath = candidatePath;
        break;
      }
    }

    if (!resolvedCreatePath) {
      return json({ error: 'Could not find a free filename for the new note.' }, 409);
    }

    targetPath = resolvedCreatePath;
  } else {
    existing = await loadExistingFile(targetPath);
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
  const renderedContent = await renderRuntimeMarkdown(finalContent, targetPath).catch((error) => {
    console.error('Runtime markdown render error during publish:', error);
    return null;
  });

  try {
    if (localContentAdminEnabled) {
      const localResult = writeEditableLocalRepoFile(source, targetPath, finalContent);
      return json({
        success: true,
        mode,
        repo: source.repo || 'local',
        branch: 'local',
        path: localResult.path,
        commitSha: localResult.fileSha,
        commitUrl: '',
        fileSha: localResult.fileSha,
        localOnly: true,
        localPaths: localResult.writtenPaths,
        renderedHtml: renderedContent?.html || '',
        renderedFrontmatter: renderedContent?.frontmatter || {},
      });
    }

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

    // Persist to local source mirrors so runtime rendering sees the update immediately.
    try {
      const localResult = writeEditableLocalRepoFile(source, targetPath, finalContent);
      console.log(`[Publish] Locally persisted to: ${localResult.writtenPaths.join(', ')}`);
    } catch (localError) {
      console.error('[Publish] Failed to persist local file:', localError);
    }

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
      renderedHtml: renderedContent?.html || '',
      renderedFrontmatter: renderedContent?.frontmatter || {},
    });
  } catch (error: any) {
    console.error('Content publish error:', error);
    return json({ error: error?.message || 'Could not publish the note to GitHub.' }, 500);
  }
};
