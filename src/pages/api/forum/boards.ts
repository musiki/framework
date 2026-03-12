import type { APIRoute } from 'astro';
import {
  cleanBody,
  cleanString,
  createSupabaseServerClient,
  ensureDbUserFromSession,
  getForumCourseAccess,
  json,
} from '../../../lib/forum-server';
import { canonicalizeCourseId, getCourseAliases } from '../../../lib/course-alias';

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
  supabase: ReturnType<typeof createSupabaseServerClient>,
  courseId: string,
  courseAliases: string[],
): Promise<Map<string, { messageCount: number; lastActivityAt: string | null }>> {
  const boardActivity = new Map<string, { messageCount: number; lastActivityAt: string | null }>();

  const { data: threadsRaw, error: threadsError } = await supabase
    .from('ForumThread')
    .select('id, lessonSlug, createdAt, updatedAt')
    .in('courseId', courseAliases.length > 0 ? courseAliases : [courseId])
    .like('lessonSlug', `${BOARD_SCOPE_PREFIX}%`)
    .limit(2000);

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
    const { data: postsRaw, error: postsError } = await supabase
      .from('ForumPost')
      .select('threadId, createdAt')
      .in('threadId', threadIds)
      .neq('status', 'deleted');

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
  if (message.includes('SUPABASE_SERVICE_ROLE_KEY_REQUIRED_FOR_FORUM') || message.includes('SUPABASE_SERVER_KEY_MISSING')) {
    return 'Forum requires server service credentials. Set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY=service-role key) and restart dev server.';
  }
  if (message.toLowerCase().includes('row-level security')) {
    return 'RLS blocked forum write. Set SUPABASE_SERVICE_ROLE_KEY in server env and restart dev server.';
  }
  if (message.includes('ForumBoard') || message.includes('ForumThread') || message.includes('ForumPost')) {
    return 'Forum schema missing or outdated. Re-run docs/sql/forum-schema.sql in Supabase.';
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
  supabase: ReturnType<typeof createSupabaseServerClient>,
  courseId: string,
  courseAliases: string[],
  createdByUserId: string,
): Promise<void> {
  const { data: existingDefault, error: existingError } = await supabase
    .from('ForumBoard')
    .select('id')
    .in('courseId', courseAliases.length > 0 ? courseAliases : [courseId])
    .eq('slug', 'general')
    .eq('isArchived', false)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existingDefault) return;

  const now = new Date().toISOString();

  const { error: insertError } = await supabase.from('ForumBoard').insert([
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
  ]);

  if (insertError && insertError.code !== '23505') {
    throw insertError;
  }
}

async function listBoards(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  courseId: string,
  courseAliases: string[],
): Promise<BoardRow[]> {
  const { data: boards, error: boardsError } = await supabase
    .from('ForumBoard')
    .select('id, courseId, slug, title, description, isDefault, isArchived, createdAt, updatedAt')
    .in('courseId', courseAliases.length > 0 ? courseAliases : [courseId])
    .eq('isArchived', false)
    .order('isDefault', { ascending: false })
    .order('title', { ascending: true });

  if (boardsError) throw boardsError;
  return (boards || []) as BoardRow[];
}

async function getBoardBySlug(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  courseId: string,
  courseAliases: string[],
  boardSlug: string,
): Promise<BoardRow | null> {
  const { data: board, error } = await supabase
    .from('ForumBoard')
    .select('id, courseId, slug, title, description, isDefault, isArchived, createdAt, updatedAt')
    .in('courseId', courseAliases.length > 0 ? courseAliases : [courseId])
    .eq('slug', boardSlug)
    .eq('isArchived', false)
    .maybeSingle();

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

  const supabase = createSupabaseServerClient({ requireServiceRole: true });

  try {
    const dbUser = await ensureDbUserFromSession(supabase, session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const access = await getForumCourseAccess(supabase, dbUser, courseId);
    if (!access.canRead) {
      return json({ error: 'Forbidden' }, 403);
    }

    await ensureDefaultBoard(supabase, courseId, courseAliases, dbUser.id);
    const boards = await listBoards(supabase, courseId, courseAliases);
    const boardActivityBySlug = await loadBoardActivityMap(supabase, courseId, courseAliases);

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

  const supabase = createSupabaseServerClient({ requireServiceRole: true });

  try {
    const dbUser = await ensureDbUserFromSession(supabase, session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const access = await getForumCourseAccess(supabase, dbUser, courseId);
    if (!access.isTeacher) {
      return json({ error: 'Only teachers can create alternative forums' }, 403);
    }

    await ensureDefaultBoard(supabase, courseId, courseAliases, dbUser.id);

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

    const { data: createdBoard, error: createError } = await supabase
      .from('ForumBoard')
      .insert([insertPayload])
      .select('id, courseId, slug, title, description, isDefault, isArchived, createdAt, updatedAt')
      .single();

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

  const supabase = createSupabaseServerClient({ requireServiceRole: true });

  try {
    const dbUser = await ensureDbUserFromSession(supabase, session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const access = await getForumCourseAccess(supabase, dbUser, courseId);
    if (!access.isTeacher) {
      return json({ error: 'Only teachers can edit alternative forums' }, 403);
    }

    const board = await getBoardBySlug(supabase, courseId, courseAliases, boardSlug);
    if (!board) {
      return json({ error: 'Forum not found' }, 404);
    }
    if (board.isDefault || board.slug === 'general') {
      return json({ error: 'The default course forum cannot be renamed' }, 400);
    }

    const { data: updatedBoard, error: updateError } = await supabase
      .from('ForumBoard')
      .update({
        title,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', board.id)
      .select('id, courseId, slug, title, description, isDefault, isArchived, createdAt, updatedAt')
      .single();

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

  const supabase = createSupabaseServerClient({ requireServiceRole: true });

  try {
    const dbUser = await ensureDbUserFromSession(supabase, session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const access = await getForumCourseAccess(supabase, dbUser, courseId);
    if (!access.isTeacher) {
      return json({ error: 'Only teachers can remove alternative forums' }, 403);
    }

    const board = await getBoardBySlug(supabase, courseId, courseAliases, boardSlug);
    if (!board) {
      return json({ error: 'Forum not found' }, 404);
    }
    if (board.isDefault || board.slug === 'general') {
      return json({ error: 'The default course forum cannot be removed' }, 400);
    }

    const { error: archiveError } = await supabase
      .from('ForumBoard')
      .update({
        isArchived: true,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', board.id);

    if (archiveError) throw archiveError;
    return json({ success: true, boardSlug }, 200);
  } catch (error: any) {
    console.error('Forum board delete error:', error?.message || error);
    return json({ error: resolveForumErrorMessage(error, 'Failed to delete board') }, 500);
  }
};
