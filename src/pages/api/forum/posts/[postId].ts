import type { APIRoute } from 'astro';
import {
  cleanBody,
  cleanString,
  ensureDbUserFromSession,
  getForumCourseAccess,
  json,
} from '../../../../lib/forum-server';
import { renderForumMarkdown } from '../../../../lib/forum-markdown';
import { broadcastForumEvent } from '../../../../lib/forum-broadcast';
import { query } from '../../../../lib/db/pool';

const POST_BODY_MAX = 4000;

type PostRow = {
  id: string;
  threadId: string;
  parentPostId: string | null;
  authorUserId: string;
  body: string;
  status: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type ThreadRow = {
  id: string;
  courseId: string;
  createdByUserId: string;
  isLocked: boolean | null;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function resolveForumErrorMessage(error: any, fallback: string): string {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (message.includes('ForumBoard') || message.includes('ForumThread') || message.includes('ForumPost') || message.includes('ForumPostVote')) {
    return 'Forum schema missing or outdated. Please verify the database state on the VPS.';
  }
  return fallback;
}

async function getPostContext(
  postId: string,
): Promise<{ post: PostRow; thread: ThreadRow } | null> {
  const { data: postRows, error: postError } = await query(
    `SELECT id, "threadId", "parentPostId", "authorUserId", body, status, "createdAt", "updatedAt" 
     FROM "ForumPost" WHERE id = $1`,
    [postId]
  );

  if (postError) throw postError;
  const post = postRows?.[0] as PostRow | undefined;
  if (!post) return null;

  const { data: threadRows, error: threadError } = await query(
    `SELECT id, "courseId", "createdByUserId", "isLocked" FROM "ForumThread" WHERE id = $1`,
    [post.threadId]
  );

  if (threadError) throw threadError;
  const thread = threadRows?.[0] as ThreadRow | undefined;
  if (!thread) return null;

  return {
    post,
    thread,
  };
}

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const requestUrl = new URL(request.url);
  const useRemoteLilypond = cleanString(requestUrl.searchParams.get('renderContext'), 40) === 'course';
  const postId = cleanString(params.postId, 80);
  if (!postId) {
    return json({ error: 'postId is required' }, 400);
  }

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400);
  }

  const body = cleanBody(payload?.body, POST_BODY_MAX);
  if (!body) {
    return json({ error: 'Post body is required' }, 400);
  }

  try {
    const dbUser = await ensureDbUserFromSession(session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const context = await getPostContext(postId);
    if (!context) return json({ error: 'Post not found' }, 404);

    const access = await getForumCourseAccess(dbUser, context.thread.courseId);
    if (!access.canRead) {
      return json({ error: 'Forbidden' }, 403);
    }

    const isAuthor = context.post.authorUserId === dbUser.id;
    const canModerate = access.isTeacher || isAuthor;
    if (!canModerate) {
      return json({ error: 'Only the message author or a teacher can edit this post' }, 403);
    }

    if (Boolean(context.thread.isLocked) && !access.isTeacher) {
      return json({ error: 'Thread is locked' }, 403);
    }

    const { data: updatedRaw, error: updateError } = await query(
      `UPDATE "ForumPost" SET body = $1, status = $2, "updatedAt" = $3 WHERE id = $4 
       RETURNING id, "threadId", "parentPostId", "authorUserId", body, status, "createdAt", "updatedAt"`,
      [body, 'published', new Date().toISOString(), postId]
    );

    if (updateError) throw updateError;

    const updatedPost = updatedRaw?.[0] as PostRow;
    let bodyHtml = '';
    try {
      bodyHtml = await renderForumMarkdown(updatedPost.body || '', {
        remoteLilypond: useRemoteLilypond,
      });
    } catch (renderError) {
      console.error('Forum markdown render error:', renderError);
      bodyHtml = `<p>${escapeHtml(updatedPost.body || '')}</p>`;
    }

    const editedPost = {
      id: updatedPost.id,
      threadId: updatedPost.threadId,
      parentPostId: updatedPost.parentPostId,
      authorUserId: updatedPost.authorUserId,
      body: updatedPost.body,
      status: updatedPost.status || 'published',
      bodyHtml,
      createdAt: updatedPost.createdAt,
      updatedAt: updatedPost.updatedAt,
      canEdit: canModerate,
      canDelete: canModerate,
    };

    void broadcastForumEvent(updatedPost.threadId, 'forum_post_updated', { post: editedPost });

    return json({ success: true, post: editedPost }, 200);
  } catch (error: any) {
    console.error('Forum post edit error:', error?.message || error);
    return json({ error: resolveForumErrorMessage(error, 'Failed to edit post') }, 500);
  }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const postId = cleanString(params.postId, 80);
  if (!postId) {
    return json({ error: 'postId is required' }, 400);
  }

  try {
    const dbUser = await ensureDbUserFromSession(session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const context = await getPostContext(postId);
    if (!context) return json({ error: 'Post not found' }, 404);

    const access = await getForumCourseAccess(dbUser, context.thread.courseId);
    if (!access.canRead) {
      return json({ error: 'Forbidden' }, 403);
    }

    const isAuthor = context.post.authorUserId === dbUser.id;
    const canModerate = access.isTeacher || isAuthor;
    if (!canModerate) {
      return json({ error: 'Only the message author or a teacher can delete this post' }, 403);
    }

    if (Boolean(context.thread.isLocked) && !access.isTeacher) {
      return json({ error: 'Thread is locked' }, 403);
    }

    const now = new Date().toISOString();

    const { data: updatedRaw, error: updateError } = await query(
      `UPDATE "ForumPost" SET body = $1, status = $2, "updatedAt" = $3 WHERE id = $4 
       RETURNING id, "threadId", "parentPostId", "authorUserId", body, status, "createdAt", "updatedAt"`,
      ['', 'deleted', now, postId]
    );

    if (updateError) throw updateError;

    const { error: threadUpdateError } = await query(
      `UPDATE "ForumThread" SET "updatedAt" = $1 WHERE id = $2`,
      [now, context.thread.id]
    );

    if (threadUpdateError) throw threadUpdateError;

    void broadcastForumEvent(
      (updatedRaw?.[0] as PostRow).threadId,
      'forum_post_deleted',
      { postId },
    );

    return json(
      { success: true, post: { ...(updatedRaw?.[0] as PostRow), bodyHtml: '', canEdit: false, canDelete: false } },
      200,
    );
  } catch (error: any) {
    console.error('Forum post delete error:', error?.message || error);
    return json({ error: resolveForumErrorMessage(error, 'Failed to delete post') }, 500);
  }
};
