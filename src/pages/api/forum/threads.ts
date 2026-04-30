import type { APIRoute } from 'astro';
import {
  cleanBody,
  cleanString,
  ensureDbUserFromSession,
  getForumCourseAccess,
  json,
} from '../../../lib/forum-server';
import { canonicalizeCourseId, getCourseAliases } from '../../../lib/course-alias';
import { query } from '../../../lib/db/pool';

const THREAD_TITLE_MAX = 140;
const THREAD_BODY_MAX = 4000;
const THREAD_LIMIT = 100;
const BOARD_SCOPE_PREFIX = '@board:';

type ThreadRow = {
  id: string;
  title: string;
  createdByUserId: string;
  createdAt: string | null;
  updatedAt: string | null;
  isPinned: boolean | null;
  isLocked: boolean | null;
};

type AuthorRow = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

type ThreadPostRow = {
  threadId: string | null;
  createdAt: string | null;
  parentPostId: string | null;
};

function toDisplayName(author?: AuthorRow): string {
  if (!author) return 'Usuario';
  if (author.name?.trim()) return author.name.trim();
  if (author.email?.trim()) return author.email.trim().split('@')[0];
  return 'Usuario';
}

function pickNewestTimestamp(current: string | null, candidate: string | null): string | null {
  if (!current) return candidate;
  if (!candidate) return current;
  const currentTime = new Date(current).getTime();
  const candidateTime = new Date(candidate).getTime();
  if (Number.isNaN(currentTime)) return candidate;
  if (Number.isNaN(candidateTime)) return current;
  return candidateTime > currentTime ? candidate : current;
}

function resolveForumErrorMessage(error: any, fallback: string): string {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (message.includes('ForumBoard') || message.includes('ForumThread') || message.includes('ForumPost') || message.includes('ForumPostVote')) {
    return 'Forum schema missing or outdated. Please verify the database state on the VPS.';
  }
  return fallback;
}

function normalizeBoardSlug(value: string): string {
  return value.trim().toLowerCase();
}

function resolveForumScopeKey(params: { lessonSlug: string; boardSlug: string }): string {
  const { lessonSlug, boardSlug } = params;
  if (lessonSlug) return lessonSlug;
  return `${BOARD_SCOPE_PREFIX}${normalizeBoardSlug(boardSlug)}`;
}

async function ensureBoardExists(
  courseId: string,
  courseAliases: string[],
  boardSlug: string,
): Promise<boolean> {
  const normalized = normalizeBoardSlug(boardSlug);
  if (!normalized) return false;

  const { data: board, error: boardError } = await query(
    `SELECT "id" FROM "ForumBoard" 
     WHERE "courseId" = ANY($1) 
     AND "slug" = $2 
     AND "isArchived" = false 
     LIMIT 1`,
    [courseAliases.length > 0 ? courseAliases : [courseId], normalized]
  );

  if (boardError) throw boardError;
  return Boolean(board?.[0]);
}

async function loadAuthorMap(authorIds: string[]): Promise<Map<string, AuthorRow>> {
  if (authorIds.length === 0) return new Map();

  const { data: authors, error: authorsError } = await query(
    `SELECT "id", "name", "email", "image" FROM "User" WHERE "id" = ANY($1)`,
    [authorIds]
  );

  if (authorsError) throw authorsError;

  return new Map((authors || []).map((author: AuthorRow) => [author.id, author]));
}

export const GET: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;

  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const url = new URL(request.url);
  const courseId = await canonicalizeCourseId(cleanString(url.searchParams.get('courseId'), 120));
  const courseAliases = await getCourseAliases(courseId);
  const lessonSlug = cleanString(url.searchParams.get('lessonSlug'), 240);
  const boardSlug = cleanString(url.searchParams.get('boardSlug'), 120);

  if (!courseId) {
    return json({ error: 'courseId is required' }, 400);
  }
  if (!lessonSlug && !boardSlug) {
    return json({ error: 'lessonSlug or boardSlug is required' }, 400);
  }
  if (lessonSlug && boardSlug) {
    return json({ error: 'Provide either lessonSlug or boardSlug, not both' }, 400);
  }

  try {
    const dbUser = await ensureDbUserFromSession(session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const access = await getForumCourseAccess(dbUser, courseId);
    if (!access.canRead) {
      return json({ error: 'Forbidden' }, 403);
    }

    if (boardSlug) {
      const exists = await ensureBoardExists(courseId, courseAliases, boardSlug);
      if (!exists) return json({ error: 'Board not found' }, 404);
    }

    const forumScopeKey = resolveForumScopeKey({ lessonSlug, boardSlug });

    const { data: threadsRaw, error: threadsError } = await query(
      `SELECT "id", "title", "createdByUserId", "createdAt", "updatedAt", "isPinned", "isLocked" 
       FROM "ForumThread" 
       WHERE "courseId" = ANY($1) 
       AND "lessonSlug" = $2 
       ORDER BY "isPinned" DESC, "updatedAt" DESC 
       LIMIT $3`,
      [courseAliases.length > 0 ? courseAliases : [courseId], forumScopeKey, THREAD_LIMIT]
    );

    if (threadsError) throw threadsError;

    const threads = (threadsRaw || []) as ThreadRow[];
    const threadIds = threads.map((thread) => thread.id);
    const authorIds = Array.from(new Set(threads.map((thread) => thread.createdByUserId).filter(Boolean)));

    const authorById = await loadAuthorMap(authorIds);
    const activityByThread = new Map(
      threads.map((thread) => [
        thread.id,
        {
          messageCount: 0,
          replyCount: 0,
          postCount: 0,
          lastActivityAt: pickNewestTimestamp(thread.createdAt, thread.updatedAt),
        },
      ]),
    );

    if (threadIds.length > 0) {
      const { data: posts, error: postsError } = await query(
        `SELECT "threadId", "createdAt", "parentPostId" 
         FROM "ForumPost" 
         WHERE "threadId" = ANY($1) 
         AND ("status" IS NULL OR "status" <> 'deleted')`,
        [threadIds]
      );

      if (postsError) throw postsError;

      for (const post of (posts || []) as ThreadPostRow[]) {
        const threadId = cleanString(post.threadId, 80);
        if (!threadId) continue;

        const activity = activityByThread.get(threadId);
        if (!activity) continue;

        activity.messageCount += 1;
        if (post.parentPostId) {
          activity.replyCount += 1;
        }
        activity.postCount += 1;
        activity.lastActivityAt = pickNewestTimestamp(activity.lastActivityAt, post.createdAt ?? null);
        activityByThread.set(threadId, activity);
      }
    }

    const payload = threads.map((thread) => {
      const author = authorById.get(thread.createdByUserId);
      const activity = activityByThread.get(thread.id) ?? {
        messageCount: 0,
        replyCount: 0,
        postCount: 0,
        lastActivityAt: null,
      };
      const isAuthor = thread.createdByUserId === dbUser.id;
      const canModerate = access.isTeacher || (isAuthor && !Boolean(thread.isLocked));

      return {
        id: thread.id,
        title: thread.title,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        createdByUserId: thread.createdByUserId,
        createdByName: toDisplayName(author),
        createdByImage: author?.image ?? null,
        isPinned: Boolean(thread.isPinned),
        isLocked: Boolean(thread.isLocked),
        canEdit: canModerate,
        canDelete: canModerate,
        canPin: access.isTeacher,
        messageCount: activity.messageCount,
        replyCount: activity.replyCount,
        postCount: activity.postCount,
        lastActivityAt: activity.lastActivityAt,
      };
    });

    return json(
      {
        threads: payload,
        canWrite: access.canWrite,
      },
      200,
    );
  } catch (error: any) {
    console.error('Forum thread list error:', error?.message || error);
    return json({ error: resolveForumErrorMessage(error, 'Failed to load forum threads') }, 500);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;

  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400);
  }

  const courseId = await canonicalizeCourseId(cleanString(body?.courseId, 120));
  const courseAliases = await getCourseAliases(courseId);
  const lessonSlug = cleanString(body?.lessonSlug, 240);
  const boardSlug = cleanString(body?.boardSlug, 120);
  const title = cleanString(body?.title, THREAD_TITLE_MAX);
  const firstPostBody = cleanBody(body?.body, THREAD_BODY_MAX);

  if (!courseId) {
    return json({ error: 'courseId is required' }, 400);
  }
  if (!lessonSlug && !boardSlug) {
    return json({ error: 'lessonSlug or boardSlug is required' }, 400);
  }
  if (lessonSlug && boardSlug) {
    return json({ error: 'Provide either lessonSlug or boardSlug, not both' }, 400);
  }
  if (title.length < 3) {
    return json({ error: 'Title must be at least 3 characters' }, 400);
  }
  if (!firstPostBody) {
    return json({ error: 'Post body is required' }, 400);
  }

  try {
    const dbUser = await ensureDbUserFromSession(session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const access = await getForumCourseAccess(dbUser, courseId);
    if (!access.canWrite) {
      return json({ error: 'You must be enrolled in this course to post' }, 403);
    }

    if (boardSlug) {
      const exists = await ensureBoardExists(courseId, courseAliases, boardSlug);
      if (!exists) return json({ error: 'Board not found' }, 404);
    }

    const forumScopeKey = resolveForumScopeKey({ lessonSlug, boardSlug });
    const now = new Date().toISOString();
    const threadId = crypto.randomUUID();

    const { error: threadInsertError } = await query(
      `INSERT INTO "ForumThread" ("id", "courseId", "lessonSlug", "title", "createdByUserId", "isPinned", "isLocked", "createdAt", "updatedAt") 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [threadId, courseId, forumScopeKey, title, dbUser.id, false, false, now, now]
    );

    if (threadInsertError) throw threadInsertError;

    const { data: firstPostRows, error: firstPostError } = await query(
      `INSERT INTO "ForumPost" ("id", "threadId", "authorUserId", "parentPostId", "body", "status", "createdAt", "updatedAt") 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING "id", "createdAt"`,
      [crypto.randomUUID(), threadId, dbUser.id, null, firstPostBody, 'published', now, now]
    );
    const firstPost = firstPostRows?.[0];

    if (firstPostError) {
      await query(`DELETE FROM "ForumThread" WHERE "id" = $1`, [threadId]);
      throw firstPostError;
    }

    return json(
      {
        success: true,
        thread: {
          id: threadId,
          title,
          createdAt: now,
          updatedAt: now,
          createdByUserId: dbUser.id,
          createdByName: dbUser.name || dbUser.email || 'Usuario',
          createdByImage: null,
          isPinned: false,
          isLocked: false,
          canEdit: true,
          canDelete: true,
          canPin: access.isTeacher,
          postCount: 1,
          lastActivityAt: firstPost?.createdAt ?? now,
        },
      },
      201,
    );
  } catch (error: any) {
    console.error('Forum thread create error:', error?.message || error);
    return json({ error: resolveForumErrorMessage(error, 'Failed to create forum thread') }, 500);
  }
};

