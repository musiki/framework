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
import * as forumSql from '../../../lib/forum-queries.ts';

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

const loadBoardActivityMap = (courseId: string, courseAliases: string[]) =>
  forumSql.loadBoardActivityMap(query, courseId, courseAliases);

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
  const { data: existingDefaultRows, error: existingError } = await forumSql.selectDefaultBoard(
    query,
    forumSql.courseIdsFor(courseId, courseAliases),
  );
  const existingDefault = existingDefaultRows?.[0];

  if (existingError) throw existingError;
  if (existingDefault) return;

  const now = new Date().toISOString();

  const { error: insertError } = await forumSql.insertBoard(
    query,
    {
      id: crypto.randomUUID(),
      courseId,
      slug: 'general',
      title: 'General',
      description: 'Foro general del curso',
      createdByUserId,
      isDefault: true,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    },
    { onConflictDoNothing: true },
  );

  if (insertError && insertError.code !== '23505') {
    throw insertError;
  }
}

async function listBoards(
  courseId: string,
  courseAliases: string[],
): Promise<BoardRow[]> {
  const { data: boards, error: boardsError } = await forumSql.listCourseBoards(
    query,
    forumSql.courseIdsFor(courseId, courseAliases),
  );

  if (boardsError) throw boardsError;
  return (boards || []) as BoardRow[];
}

async function getBoardBySlug(
  courseId: string,
  courseAliases: string[],
  boardSlug: string,
): Promise<BoardRow | null> {
  const { data: boardRows, error } = await forumSql.selectCourseBoardBySlug(
    query,
    forumSql.courseIdsFor(courseId, courseAliases),
    boardSlug,
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

    const { data: createdBoardRows, error: createError } = await forumSql.insertBoard(query, insertPayload, {
      returning: true,
    });
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

    const { data: updatedBoardRows, error: updateError } = await forumSql.updateBoardTitle(
      query,
      board.id,
      title,
      new Date().toISOString(),
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

    const { error: archiveError } = await forumSql.archiveBoard(query, board.id, new Date().toISOString());

    if (archiveError) throw archiveError;
    return json({ success: true, boardSlug }, 200);
  } catch (error: any) {
    console.error('Forum board delete error:', error?.message || error);
    return json({ error: resolveForumErrorMessage(error, 'Failed to delete board') }, 500);
  }
};

