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

const BOARD_TITLE_MAX = 90;
const BOARD_DESCRIPTION_MAX = 260;
const BOARD_SLUG_MAX = 48;

type BoardRow = {
  id: string;
  courseId: string;
  slug: string;
  title: string;
  description: string | null;
  isDefault: boolean | null;
  isArchived: boolean | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type ThreadRow = {
  id: string;
  lessonSlug: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type PostRow = {
  threadId: string | null;
  createdAt: string | null;
};

const BOARD_SCOPE_PREFIX = '@board:';

function pickNewestTimestamp(current: string | null, candidate: string | null): string | null {
  if (!current) return candidate;
  if (!candidate) return current;
  const currentTime = new Date(current).getTime();
  const candidateTime = new Date(candidate).getTime();
  if (Number.isNaN(currentTime)) return candidate;
  if (Number.isNaN(candidateTime)) return current;
  return candidateTime > currentTime ? candidate : current;
}

async function loadBoardActivityMap(
  courseId: string,
  courseAliases: string[],
): Promise<Map<string, { messageCount: number; lastActivityAt: string | null }>> {
  const boardActivity = new Map<string, { messageCount: number; lastActivityAt: string | null }>();

  const { data: threadsRaw, error: threadsError } = await query(
    `SELECT "id", "lessonSlug", "createdAt", "updatedAt" FROM "ForumThread" 
     WHERE "courseId" = ANY($1) AND "lessonSlug" LIKE $2 LIMIT 2000`,
    [courseAliases.length > 0 ? courseAliases : [courseId], `${BOARD_SCOPE_PREFIX}%`]
  );

  if (threadsError) throw threadsError;

  const threads = (threadsRaw || []) as ThreadRow[];
  if (threads.length === 0) return boardActivity;

  const threadStatsById = new Map<string, { boardSlug: string; messageCount: number; lastActivityAt: string | null }>();
  const threadIds: string[] = [];

  for (const thread of threads) {
    const threadId = cleanString(thread?.id, 80);
    const rawScope = cleanString(thread?.lessonSlug, 240);
    const boardSlug = rawScope.startsWith(BOARD_SCOPE_PREFIX)
      ? cleanString(rawScope.slice(BOARD_SCOPE_PREFIX.length), 120).toLowerCase()
      : '';
    if (!threadId || !boardSlug) continue;
    threadIds.push(threadId);
    threadStatsById.set(threadId, {
      boardSlug,
      messageCount: 0,
      lastActivityAt: pickNewestTimestamp(thread?.createdAt ?? null, thread?.updatedAt ?? null),
    });
  }

  if (threadIds.length > 0) {
    const { data: postsRaw, error: postsError } = await query(
      `SELECT "threadId", "createdAt" FROM "ForumPost" 
       WHERE "threadId" = ANY($1) AND ("status" IS NULL OR "status" <> 'deleted')`,
      [threadIds]
    );

    if (postsError) throw postsError;

    for (const post of (postsRaw || []) as PostRow[]) {
      const threadId = cleanString(post?.threadId, 80);
      if (!threadId) continue;
      const threadStats = threadStatsById.get(threadId);
      if (!threadStats) continue;
      threadStats.messageCount += 1;
      threadStats.lastActivityAt = pickNewestTimestamp(threadStats.lastActivityAt, post?.createdAt ?? null);
      threadStatsById.set(threadId, threadStats);
    }
  }

  threadStatsById.forEach((threadStats) => {
    const current = boardActivity.get(threadStats.boardSlug) || {
      messageCount: 0,
      lastActivityAt: null,
    };
    current.messageCount += threadStats.messageCount;
    current.lastActivityAt = pickNewestTimestamp(current.lastActivityAt, threadStats.lastActivityAt);
    boardActivity.set(threadStats.boardSlug, current);
  });

  return boardActivity;
}

function resolveForumErrorMessage(error: any, fallback: string): string {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (message.includes('ForumBoard') || message.includes('ForumThread') || message.includes('ForumPost') || message.includes('ForumPostVote')) {
    return 'Forum schema missing or outdated. Please verify the database state on the VPS.';
  }
  return fallback;
}

function slugifyBoard(value: string): string {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized.slice(0, BOARD_SLUG_MAX);
}

async function ensureDefaultBoard(
  courseId: string,
  courseAliases: string[],
  createdByUserId: string,
): Promise<void> {
  const { data: existingDefaultRows, error: existingError } = await query(
    `SELECT "id" FROM "ForumBoard" WHERE "courseId" = ANY($1) AND "slug" = $2 AND "isArchived" = false`,
    [courseAliases.length > 0 ? courseAliases : [courseId], 'general']
  );
  const existingDefault = existingDefaultRows?.[0];

  if (existingError) throw existingError;
  if (existingDefault) return;

  const now = new Date().toISOString();

  const { error: insertError } = await query(
    `INSERT INTO "ForumBoard" ("id", "courseId", "slug", "title", "description", "createdByUserId", "isDefault", "isArchived", "createdAt", "updatedAt") 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT ("courseId", "slug") DO NOTHING`,
    [
      crypto.randomUUID(),
      courseId,
      'general',
      'General',
      'Foro general del curso',
      createdByUserId,
      true,
      false,
      now,
      now,
    ]
  );

  if (insertError && insertError.code !== '23505') {
    throw insertError;
  }
}

async function listBoards(
  courseId: string,
  courseAliases: string[],
): Promise<BoardRow[]> {
  const { data: boards, error: boardsError } = await query(
    `SELECT "id", "courseId", "slug", "title", "description", "isDefault", "isArchived", "createdAt", "updatedAt" 
     FROM "ForumBoard" WHERE "courseId" = ANY($1) AND "isArchived" = false 
     ORDER BY "isDefault" DESC, "title" ASC`,
    [courseAliases.length > 0 ? courseAliases : [courseId]]
  );

  if (boardsError) throw boardsError;
  return (boards || []) as BoardRow[];
}

async function getBoardBySlug(
  courseId: string,
  courseAliases: string[],
  boardSlug: string,
): Promise<BoardRow | null> {
  const { data: boardRows, error } = await query(
    `SELECT "id", "courseId", "slug", "title", "description", "isDefault", "isArchived", "createdAt", "updatedAt" 
     FROM "ForumBoard" WHERE "courseId" = ANY($1) AND "slug" = $2 AND "isArchived" = false`,
    [courseAliases.length > 0 ? courseAliases : [courseId], boardSlug]
  );
  const board = boardRows?.[0];

  if (error) throw error;
  return (board || null) as BoardRow | null;
}

async function parseBoardMutationRequest(request: Request): Promise<{
  courseId: string;
  courseAliases: string[];
  boardSlug: string;
  title: string;
}> {
  const url = new URL(request.url);
  let body: any = null;

  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const courseId = await canonicalizeCourseId(
    cleanString(body?.courseId ?? url.searchParams.get('courseId'), 120),
  );
  const boardSlug = slugifyBoard(
    cleanString(body?.boardSlug ?? body?.slug ?? url.searchParams.get('boardSlug') ?? url.searchParams.get('slug'), BOARD_SLUG_MAX),
  );
  const title = cleanString(body?.title, BOARD_TITLE_MAX);

  return {
    courseId,
    courseAliases: courseId ? await getCourseAliases(courseId) : [],
    boardSlug,
    title,
  };
}

export const GET: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const url = new URL(request.url);
  const courseId = await canonicalizeCourseId(cleanString(url.searchParams.get('courseId'), 120));
  if (!courseId) return json({ error: 'courseId is required' }, 400);
  const courseAliases = await getCourseAliases(courseId);

  try {
    const dbUser = await ensureDbUserFromSession(session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const access = await getForumCourseAccess(dbUser, courseId);
    if (!access.canRead) {
      return json({ error: 'Forbidden' }, 403);
    }

    await ensureDefaultBoard(courseId, courseAliases, dbUser.id);
    const boards = await listBoards(courseId, courseAliases);
    const boardActivityBySlug = await loadBoardActivityMap(courseId, courseAliases);

    return json(
      {
        boards: boards.map((board) => {
          const boardSlug = cleanString(board?.slug, 120).toLowerCase();
          const activity = boardActivityBySlug.get(boardSlug) || {
            messageCount: 0,
            lastActivityAt: null,
          };
          return {
            ...board,
            messageCount: activity.messageCount,
            lastActivityAt: activity.lastActivityAt,
          };
        }),
        canManageBoards: access.isTeacher,
      },
      200,
    );
  } catch (error: any) {
    console.error('Forum board list error:', error?.message || error);
    return json({ error: resolveForumErrorMessage(error, 'Failed to load boards') }, 500);
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
  const title = cleanString(body?.title, BOARD_TITLE_MAX);
  const description = cleanBody(body?.description, BOARD_DESCRIPTION_MAX);
  const providedSlug = cleanString(body?.slug, BOARD_SLUG_MAX);

  if (!courseId) return json({ error: 'courseId is required' }, 400);
  const courseAliases = await getCourseAliases(courseId);
  if (title.length < 3) return json({ error: 'Title must be at least 3 characters' }, 400);

  const slugBase = providedSlug || title;
  const slug = slugifyBoard(slugBase);
  if (!slug) return json({ error: 'Unable to generate valid board slug' }, 400);
  if (slug === 'general') {
    return json({ error: 'Slug "general" is reserved for the default course forum' }, 400);
  }

  try {
    const dbUser = await ensureDbUserFromSession(session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const access = await getForumCourseAccess(dbUser, courseId);
    if (!access.isTeacher) {
      return json({ error: 'Only teachers can create alternative forums' }, 403);
    }

    await ensureDefaultBoard(courseId, courseAliases, dbUser.id);

    const now = new Date().toISOString();
    const insertPayload = {
      id: crypto.randomUUID(),
      courseId,
      slug,
      title,
      description: description || null,
      createdByUserId: dbUser.id,
      isDefault: false,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    };

    const { data: createdBoardRows, error: createError } = await query(
      `INSERT INTO "ForumBoard" ("id", "courseId", "slug", "title", "description", "createdByUserId", "isDefault", "isArchived", "createdAt", "updatedAt") 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       RETURNING "id", "courseId", "slug", "title", "description", "isDefault", "isArchived", "createdAt", "updatedAt"`,
      [
        insertPayload.id,
        insertPayload.courseId,
        insertPayload.slug,
        insertPayload.title,
        insertPayload.description,
        insertPayload.createdByUserId,
        insertPayload.isDefault,
        insertPayload.isArchived,
        insertPayload.createdAt,
        insertPayload.updatedAt,
      ]
    );
    const createdBoard = createdBoardRows?.[0];

    if (createError) {
      if (createError.code === '23505') {
        return json({ error: 'A forum with this slug already exists in this course' }, 409);
      }
      throw createError;
    }

    return json({ success: true, board: createdBoard }, 201);
  } catch (error: any) {
    console.error('Forum board create error:', error?.message || error);
    return json({ error: resolveForumErrorMessage(error, 'Failed to create board') }, 500);
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const { courseId, courseAliases, boardSlug, title } = await parseBoardMutationRequest(request);
  if (!courseId) return json({ error: 'courseId is required' }, 400);
  if (!boardSlug) return json({ error: 'boardSlug is required' }, 400);
  if (title.length < 3) return json({ error: 'Title must be at least 3 characters' }, 400);

  try {
    const dbUser = await ensureDbUserFromSession(session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const access = await getForumCourseAccess(dbUser, courseId);
    if (!access.isTeacher) {
      return json({ error: 'Only teachers can edit alternative forums' }, 403);
    }

    const board = await getBoardBySlug(courseId, courseAliases, boardSlug);
    if (!board) {
      return json({ error: 'Forum not found' }, 404);
    }
    if (board.isDefault || board.slug === 'general') {
      return json({ error: 'The default course forum cannot be renamed' }, 400);
    }

    const { data: updatedBoardRows, error: updateError } = await query(
      `UPDATE "ForumBoard" SET "title" = $1, "updatedAt" = $2 WHERE "id" = $3 
       RETURNING "id", "courseId", "slug", "title", "description", "isDefault", "isArchived", "createdAt", "updatedAt"`,
      [title, new Date().toISOString(), board.id]
    );
    const updatedBoard = updatedBoardRows?.[0];

    if (updateError) throw updateError;
    return json({ success: true, board: updatedBoard }, 200);
  } catch (error: any) {
    console.error('Forum board update error:', error?.message || error);
    return json({ error: resolveForumErrorMessage(error, 'Failed to update board') }, 500);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const { courseId, courseAliases, boardSlug } = await parseBoardMutationRequest(request);
  if (!courseId) return json({ error: 'courseId is required' }, 400);
  if (!boardSlug) return json({ error: 'boardSlug is required' }, 400);

  try {
    const dbUser = await ensureDbUserFromSession(session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const access = await getForumCourseAccess(dbUser, courseId);
    if (!access.isTeacher) {
      return json({ error: 'Only teachers can remove alternative forums' }, 403);
    }

    const board = await getBoardBySlug(courseId, courseAliases, boardSlug);
    if (!board) {
      return json({ error: 'Forum not found' }, 404);
    }
    if (board.isDefault || board.slug === 'general') {
      return json({ error: 'The default course forum cannot be removed' }, 400);
    }

    const { error: archiveError } = await query(
      `UPDATE "ForumBoard" SET "isArchived" = true, "updatedAt" = $1 WHERE "id" = $2`,
      [new Date().toISOString(), board.id]
    );

    if (archiveError) throw archiveError;
    return json({ success: true, boardSlug }, 200);
  } catch (error: any) {
    console.error('Forum board delete error:', error?.message || error);
    return json({ error: resolveForumErrorMessage(error, 'Failed to delete board') }, 500);
  }
};

