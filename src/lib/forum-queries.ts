// SQL used by the musiki course forum routes (src/pages/api/forum/*), extracted
// verbatim into q-injected helpers so it can be characterized under node --test
// with a fake query. Each helper returns the query result unchanged
// (`{ data, error }`), so the routes keep their own error handling.
//
// Pure module: no astro/db imports.

import { cleanString } from './forum-text.ts';

export type ForumQueryResult = { data: any[] | null; error: any };
export type ForumQueryFn = (text: string, params?: any[]) => Promise<ForumQueryResult>;

export const BOARD_SCOPE_PREFIX = '@board:';

// Course XOR space (migration 20260929090000): ForumBoard/ForumThread rows with a
// `spaceId` belong to mm commons spaces and are never listed, read or mutated
// through the musiki course routes. Every statement below is pinned to course
// rows: boards/threads by `"spaceId" IS NULL`, posts/votes through their thread.
const POST_IN_COURSE_THREAD = (postAlias: string) =>
  `EXISTS (SELECT 1 FROM "ForumThread" ct WHERE ct.id = ${postAlias}."threadId" AND ct."spaceId" IS NULL)`;
const VOTE_ON_COURSE_POST = `EXISTS (SELECT 1 FROM "ForumPost" cp JOIN "ForumThread" ct ON ct.id = cp."threadId"
       WHERE cp.id = "ForumPostVote"."postId" AND ct."spaceId" IS NULL)`;

/** Course ids to match: the alias list, or the canonical id alone. */
export const courseIdsFor = (courseId: string, courseAliases: string[]): string[] =>
  courseAliases.length > 0 ? courseAliases : [courseId];

export function pickNewestTimestamp(current: string | null, candidate: string | null): string | null {
  if (!current) return candidate;
  if (!candidate) return current;
  const currentTime = new Date(current).getTime();
  const candidateTime = new Date(candidate).getTime();
  if (Number.isNaN(currentTime)) return candidate;
  if (Number.isNaN(candidateTime)) return current;
  return candidateTime > currentTime ? candidate : current;
}

const BOARD_COLUMNS = `"id", "courseId", "slug", "title", "description", "isDefault", "isArchived", "createdAt", "updatedAt"`;

// ---------------------------------------------------------------------------
// Boards (boards.ts, threads.ts)
// ---------------------------------------------------------------------------

export const selectDefaultBoard = (q: ForumQueryFn, courseIds: string[]) =>
  q(
    `SELECT "id" FROM "ForumBoard" WHERE "courseId" = ANY($1) AND "slug" = $2 AND "isArchived" = false AND "spaceId" IS NULL`,
    [courseIds, 'general'],
  );

export const insertBoard = (
  q: ForumQueryFn,
  b: {
    id: string;
    courseId: string;
    slug: string;
    title: string;
    description: string | null;
    createdByUserId: string;
    isDefault: boolean;
    isArchived: boolean;
    createdAt: string;
    updatedAt: string;
  },
  opts: { onConflictDoNothing?: boolean; returning?: boolean } = {},
) =>
  q(
    `INSERT INTO "ForumBoard" ("id", "courseId", "slug", "title", "description", "createdByUserId", "isDefault", "isArchived", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)${opts.onConflictDoNothing ? ' ON CONFLICT ("courseId", "slug") DO NOTHING' : ''}${
       opts.returning ? `
     RETURNING ${BOARD_COLUMNS}` : ''
     }`,
    [b.id, b.courseId, b.slug, b.title, b.description, b.createdByUserId, b.isDefault, b.isArchived, b.createdAt, b.updatedAt],
  );

export const listCourseBoards = (q: ForumQueryFn, courseIds: string[]) =>
  q(
    `SELECT ${BOARD_COLUMNS}
     FROM "ForumBoard" WHERE "courseId" = ANY($1) AND "isArchived" = false AND "spaceId" IS NULL
     ORDER BY "isDefault" DESC, "title" ASC`,
    [courseIds],
  );

export const selectCourseBoardBySlug = (q: ForumQueryFn, courseIds: string[], boardSlug: string) =>
  q(
    `SELECT ${BOARD_COLUMNS}
     FROM "ForumBoard" WHERE "courseId" = ANY($1) AND "slug" = $2 AND "isArchived" = false AND "spaceId" IS NULL`,
    [courseIds, boardSlug],
  );

/** threads.ts ensureBoardExists. */
export const selectActiveBoardId = (q: ForumQueryFn, courseIds: string[], boardSlug: string) =>
  q(
    `SELECT "id" FROM "ForumBoard"
     WHERE "courseId" = ANY($1)
     AND "slug" = $2
     AND "isArchived" = false
     AND "spaceId" IS NULL
     LIMIT 1`,
    [courseIds, boardSlug],
  );

export const updateBoardTitle = (q: ForumQueryFn, boardId: string, title: string, now: string) =>
  q(
    `UPDATE "ForumBoard" SET "title" = $1, "updatedAt" = $2 WHERE "id" = $3 AND "spaceId" IS NULL
     RETURNING ${BOARD_COLUMNS}`,
    [title, now, boardId],
  );

export const archiveBoard = (q: ForumQueryFn, boardId: string, now: string) =>
  q(`UPDATE "ForumBoard" SET "isArchived" = true, "updatedAt" = $1 WHERE "id" = $2 AND "spaceId" IS NULL`, [now, boardId]);

/** Board-scoped threads of a course (`lessonSlug` = '@board:<slug>'). */
export const selectBoardScopedThreads = (q: ForumQueryFn, courseIds: string[]) =>
  q(
    `SELECT "id", "lessonSlug", "createdAt", "updatedAt" FROM "ForumThread"
     WHERE "courseId" = ANY($1) AND "lessonSlug" LIKE $2 AND "spaceId" IS NULL LIMIT 2000`,
    [courseIds, `${BOARD_SCOPE_PREFIX}%`],
  );

export const selectPostActivity = (q: ForumQueryFn, threadIds: string[]) =>
  q(
    `SELECT "threadId", "createdAt" FROM "ForumPost"
     WHERE "threadId" = ANY($1) AND ("status" IS NULL OR "status" <> 'deleted')
     AND ${POST_IN_COURSE_THREAD('"ForumPost"')}`,
    [threadIds],
  );

/** boards.ts loadBoardActivityMap: message count + last activity per board slug. */
export async function loadBoardActivityMap(
  q: ForumQueryFn,
  courseId: string,
  courseAliases: string[],
): Promise<Map<string, { messageCount: number; lastActivityAt: string | null }>> {
  const boardActivity = new Map<string, { messageCount: number; lastActivityAt: string | null }>();

  const { data: threadsRaw, error: threadsError } = await selectBoardScopedThreads(q, courseIdsFor(courseId, courseAliases));
  if (threadsError) throw threadsError;

  const threads = (threadsRaw || []) as { id: string; lessonSlug: string | null; createdAt: string | null; updatedAt: string | null }[];
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
    const { data: postsRaw, error: postsError } = await selectPostActivity(q, threadIds);
    if (postsError) throw postsError;

    for (const post of (postsRaw || []) as { threadId: string | null; createdAt: string | null }[]) {
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
    const current = boardActivity.get(threadStats.boardSlug) || { messageCount: 0, lastActivityAt: null };
    current.messageCount += threadStats.messageCount;
    current.lastActivityAt = pickNewestTimestamp(current.lastActivityAt, threadStats.lastActivityAt);
    boardActivity.set(threadStats.boardSlug, current);
  });

  return boardActivity;
}

// ---------------------------------------------------------------------------
// Threads (threads.ts, threads/[threadId].ts, threads/[threadId]/posts.ts)
// ---------------------------------------------------------------------------

export const selectUsersByIds = (q: ForumQueryFn, userIds: string[]) =>
  q(`SELECT "id", "name", "email", "image" FROM "User" WHERE "id" = ANY($1)`, [userIds]);

export const listThreadsByScope = (q: ForumQueryFn, courseIds: string[], scopeKey: string, limit: number) =>
  q(
    `SELECT "id", "title", "createdByUserId", "createdAt", "updatedAt", "isPinned", "isLocked"
     FROM "ForumThread"
     WHERE "courseId" = ANY($1)
     AND "lessonSlug" = $2
     AND "spaceId" IS NULL
     ORDER BY "isPinned" DESC, "updatedAt" DESC
     LIMIT $3`,
    [courseIds, scopeKey, limit],
  );

export const selectThreadPostActivity = (q: ForumQueryFn, threadIds: string[]) =>
  q(
    `SELECT "threadId", "createdAt", "parentPostId"
     FROM "ForumPost"
     WHERE "threadId" = ANY($1)
     AND ("status" IS NULL OR "status" <> 'deleted')
     AND ${POST_IN_COURSE_THREAD('"ForumPost"')}`,
    [threadIds],
  );

export const insertThread = (
  q: ForumQueryFn,
  t: { id: string; courseId: string; lessonSlug: string; title: string; createdByUserId: string; now: string },
) =>
  q(
    `INSERT INTO "ForumThread" ("id", "courseId", "lessonSlug", "title", "createdByUserId", "isPinned", "isLocked", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [t.id, t.courseId, t.lessonSlug, t.title, t.createdByUserId, false, false, t.now, t.now],
  );

/** threads.ts first post of a new thread. */
export const insertFirstPost = (
  q: ForumQueryFn,
  p: { id: string; threadId: string; authorUserId: string; body: string; now: string },
) =>
  q(
    `INSERT INTO "ForumPost" ("id", "threadId", "authorUserId", "parentPostId", "body", "status", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING "id", "createdAt"`,
    [p.id, p.threadId, p.authorUserId, null, p.body, 'published', p.now, p.now],
  );

/** threads.ts cleanup when the first post fails (a thread it just created). */
export const deleteNewThread = (q: ForumQueryFn, threadId: string) =>
  q(`DELETE FROM "ForumThread" WHERE "id" = $1 AND "spaceId" IS NULL`, [threadId]);

/** threads/[threadId].ts */
export const selectThreadForEdit = (q: ForumQueryFn, threadId: string) =>
  q(
    `SELECT id, "courseId", title, "createdByUserId", "isPinned", "isLocked", "createdAt", "updatedAt"
     FROM "ForumThread" WHERE id = $1 AND "spaceId" IS NULL`,
    [threadId],
  );

/** threads/[threadId].ts PATCH: `updateData` keys are column names (updatedAt, title, isPinned). */
export function updateThread(q: ForumQueryFn, threadId: string, updateData: Record<string, unknown>) {
  const cols = Object.keys(updateData);
  const vals = Object.values(updateData);
  const setSql = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
  return q(
    `UPDATE "ForumThread" SET ${setSql} WHERE id = $${cols.length + 1} AND "spaceId" IS NULL
     RETURNING id, "courseId", title, "createdByUserId", "isPinned", "isLocked", "createdAt", "updatedAt"`,
    [...vals, threadId],
  );
}

export const deleteThread = (q: ForumQueryFn, threadId: string) =>
  q(`DELETE FROM "ForumThread" WHERE id = $1 AND "spaceId" IS NULL`, [threadId]);

/** threads/[threadId]/posts.ts */
export const selectThreadForPosts = (q: ForumQueryFn, threadId: string) =>
  q(`SELECT id, "courseId", "lessonSlug", "createdByUserId", "isLocked" FROM "ForumThread" WHERE id = $1 AND "spaceId" IS NULL`, [threadId]);

export const listThreadPosts = (q: ForumQueryFn, threadId: string, limit: number) =>
  q(
    `SELECT p.*, u.name as "authorName", u.email as "authorEmail", u.image as "authorImage", u.role as "authorRole"
       FROM "ForumPost" p
       LEFT JOIN "User" u ON p."authorUserId" = u.id
       WHERE p."threadId" = $1
       AND ${POST_IN_COURSE_THREAD('p')}
       ORDER BY p."createdAt" ASC
       LIMIT $2`,
    [threadId, limit],
  );

export const insertReply = (
  q: ForumQueryFn,
  p: { threadId: string; authorUserId: string; body: string; parentPostId: string | null; now: string },
) =>
  q(
    `INSERT INTO "ForumPost" (
        "threadId", "authorUserId", "body", "parentPostId", "createdAt", "updatedAt"
      ) SELECT $1::uuid, $2::uuid, $3::text, $4::uuid, $5::timestamptz, $6::timestamptz
      WHERE EXISTS (SELECT 1 FROM "ForumThread" ct WHERE ct.id = $1::uuid AND ct."spaceId" IS NULL)
      RETURNING *`,
    [p.threadId, p.authorUserId, p.body, p.parentPostId, p.now, p.now],
  );

// ---------------------------------------------------------------------------
// Posts (posts/[postId].ts, posts/[postId]/vote.ts)
// ---------------------------------------------------------------------------

export const selectPostForEdit = (q: ForumQueryFn, postId: string) =>
  q(
    `SELECT id, "threadId", "parentPostId", "authorUserId", body, status, "createdAt", "updatedAt"
     FROM "ForumPost" WHERE id = $1 AND ${POST_IN_COURSE_THREAD('"ForumPost"')}`,
    [postId],
  );

export const selectThreadOfPost = (q: ForumQueryFn, threadId: string) =>
  q(`SELECT id, "courseId", "createdByUserId", "isLocked" FROM "ForumThread" WHERE id = $1 AND "spaceId" IS NULL`, [threadId]);

/** posts/[postId].ts PATCH (status 'published') and DELETE (body '', status 'deleted'). */
export const updatePostBodyStatus = (q: ForumQueryFn, postId: string, body: string, status: string, now: string) =>
  q(
    `UPDATE "ForumPost" SET body = $1, status = $2, "updatedAt" = $3 WHERE id = $4 AND ${POST_IN_COURSE_THREAD('"ForumPost"')}
       RETURNING id, "threadId", "parentPostId", "authorUserId", body, status, "createdAt", "updatedAt"`,
    [body, status, now, postId],
  );

export const touchThread = (q: ForumQueryFn, threadId: string, now: string) =>
  q(`UPDATE "ForumThread" SET "updatedAt" = $1 WHERE id = $2 AND "spaceId" IS NULL`, [now, threadId]);

/** vote.ts */
export const selectPostForVote = (q: ForumQueryFn, postId: string) =>
  q(`SELECT "id", "threadId" FROM "ForumPost" WHERE "id" = $1 AND ${POST_IN_COURSE_THREAD('"ForumPost"')} LIMIT 1`, [postId]);

export const selectThreadForVote = (q: ForumQueryFn, threadId: string) =>
  q(`SELECT "id", "courseId" FROM "ForumThread" WHERE "id" = $1 AND "spaceId" IS NULL LIMIT 1`, [threadId]);

export const deleteVote = (q: ForumQueryFn, postId: string, userId: string) =>
  q(`DELETE FROM "ForumPostVote" WHERE "postId" = $1 AND "userId" = $2 AND ${VOTE_ON_COURSE_POST}`, [postId, userId]);

export const upsertVote = (q: ForumQueryFn, postId: string, userId: string, value: number) =>
  q(
    `INSERT INTO "ForumPostVote" ("postId", "userId", "value")
         SELECT $1::uuid, $2::uuid, $3::smallint
         WHERE EXISTS (SELECT 1 FROM "ForumPost" cp JOIN "ForumThread" ct ON ct.id = cp."threadId"
                       WHERE cp.id = $1::uuid AND ct."spaceId" IS NULL)
         ON CONFLICT ("postId", "userId") DO UPDATE SET "value" = $3`,
    [postId, userId, value],
  );

export const selectVotes = (q: ForumQueryFn, postId: string) =>
  q(`SELECT "userId", "value" FROM "ForumPostVote" WHERE "postId" = $1 AND ${VOTE_ON_COURSE_POST}`, [postId]);
