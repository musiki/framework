import type { APIRoute } from 'astro';
import {
  cleanBody,
  cleanString,
  ensureDbUserFromSession,
  getForumCourseAccess,
  json,
} from '../../../../../lib/forum-server';
import { renderForumMarkdown } from '../../../../../lib/forum-markdown';
import { broadcastForumEvent } from '../../../../../lib/forum-broadcast';
import { query } from '../../../../../lib/db/pool';

const POST_BODY_MAX = 4000;
const POSTS_LIMIT = 500;

type ThreadRow = {
  id: string;
  courseId: string;
  lessonSlug: string;
  createdByUserId: string;
  isLocked: boolean;
};

function resolveForumErrorMessage(error: any, fallback: string): string {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (message.includes('ForumBoard') || message.includes('ForumThread') || message.includes('ForumPost') || message.includes('ForumPostVote')) {
    return 'Forum schema missing or outdated. Please verify the database state on the VPS.';
  }
  return fallback;
}

async function getThreadOrNull(threadId: string): Promise<ThreadRow | null> {
  const { data, error } = await query(
    `SELECT id, "courseId", "lessonSlug", "createdByUserId", "isLocked" FROM "ForumThread" WHERE id = $1`,
    [threadId]
  );
  if (error || !data?.[0]) return null;
  return data[0];
}

export const GET: APIRoute = async ({ params, locals, request }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const requestUrl = new URL(request.url);
  const useRemoteLilypond = cleanString(requestUrl.searchParams.get('renderContext'), 40) === 'course';
  const threadId = cleanString(params.threadId, 80);
  if (!threadId) {
    return json({ error: 'threadId is required' }, 400);
  }

  try {
    const dbUser = await ensureDbUserFromSession(session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const thread = await getThreadOrNull(threadId);
    if (!thread) return json({ error: 'Thread not found' }, 404);

    const access = await getForumCourseAccess(dbUser, thread.courseId);
    if (!access.canRead) {
      return json({ error: 'Forbidden' }, 403);
    }

    const { data: postsRaw, error: postsError } = await query(
      `SELECT p.*, u.name as "authorName", u.email as "authorEmail", u.image as "authorImage", u.role as "authorRole"
       FROM "ForumPost" p
       LEFT JOIN "User" u ON p."authorUserId" = u.id
       WHERE p."threadId" = $1 
       ORDER BY p."createdAt" ASC 
       LIMIT $2`,
      [threadId, POSTS_LIMIT]
    );

    if (postsError) throw postsError;

    const posts = await Promise.all(
      (postsRaw || []).map(async (post: any) => {
        const fallbackName = post.authorEmail ? post.authorEmail.split('@')[0] : 'Usuario';
        return {
          id: post.id,
          bodyHtml: await renderForumMarkdown(post.body || '', {
            remoteLilypond: useRemoteLilypond,
          }),
          authorUserId: post.authorUserId,
          authorName: post.authorName || fallbackName,
          authorImage: post.authorImage,
          authorRole: post.authorRole,
          createdAt: post.createdAt,
          updatedAt: post.updatedAt,
          parentPostId: post.parentPostId,
          status: post.status,
          canEdit: post.authorUserId === dbUser.id || access.isTeacher,
          canDelete: post.authorUserId === dbUser.id || access.isTeacher,
        };
      }),
    );

    return json({ 
      posts,
      canReply: access.canWrite,
      canVote: access.canRead,
    });
  } catch (error: any) {
    console.error('Error loading forum posts:', error);
    return json({ error: resolveForumErrorMessage(error, 'Failed to load posts') }, 500);
  }
};

export const POST: APIRoute = async ({ params, locals, request }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const threadId = cleanString(params.threadId, 80);
  if (!threadId) {
    return json({ error: 'threadId is required' }, 400);
  }

  const requestUrl = new URL(request.url);
  const useRemoteLilypond = cleanString(requestUrl.searchParams.get('renderContext'), 40) === 'course';

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400);
  }

  const body = cleanBody(payload?.body, POST_BODY_MAX);
  const parentPostId = cleanString(payload?.parentPostId, 80);

  if (!body) {
    return json({ error: 'Post body is required' }, 400);
  }

  try {
    const dbUser = await ensureDbUserFromSession(session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const thread = await getThreadOrNull(threadId);
    if (!thread) return json({ error: 'Thread not found' }, 404);

    const access = await getForumCourseAccess(dbUser, thread.courseId);
    if (!access.canWrite) {
      return json({ error: 'You must be enrolled in this course to post' }, 403);
    }

    const isLocked = Boolean(thread.isLocked);
    if (isLocked && !access.isTeacher) {
      return json({ error: 'This thread is locked' }, 403);
    }

    const now = new Date().toISOString();
    const { data: inserted, error: insertError } = await query(
      `INSERT INTO "ForumPost" (
        "threadId", "authorUserId", "body", "parentPostId", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        threadId,
        dbUser.id,
        body,
        parentPostId || null,
        now,
        now,
      ]
    );

    if (insertError) {
      console.error('Forum post insert error:', insertError);
      throw insertError;
    }
    const postRaw = inserted?.[0];

    if (!postRaw) {
      console.error('Forum post insert returned no data');
      throw new Error('Failed to create post record');
    }

    // Broadcast new post to other clients
    try {
      await broadcastForumEvent(threadId, 'forum_post_created', {
        postId: postRaw.id,
        authorUserId: dbUser.id,
      });
    } catch (broadcastError) {
      console.warn('Forum post broadcast failed (non-critical):', broadcastError);
    }

    const post = {
      ...postRaw,
      authorName: dbUser.name || (dbUser.email ? dbUser.email.split('@')[0] : 'Usuario'),
      authorImage: dbUser.image || (session.user as any)?.image || '',
      authorRole: dbUser.role,
      bodyHtml: await renderForumMarkdown(postRaw.body || '', {
        remoteLilypond: useRemoteLilypond,
      }),
      canEdit: true,
      canDelete: true,
    };

    return json({ post });
  } catch (error: any) {
    console.error('Error creating forum post:', error);
    return json({ error: resolveForumErrorMessage(error, 'Failed to create post') }, 500);
  }
};
