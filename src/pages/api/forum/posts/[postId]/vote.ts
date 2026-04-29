import type { APIRoute } from 'astro';
import {
  cleanString,
  ensureDbUserFromSession,
  getForumCourseAccess,
  json,
} from '../../../../../lib/forum-server';
import { broadcastForumEvent } from '../../../../../lib/forum-broadcast';
import { query } from '../../../../../lib/db/pool';

type PostRow = {
  id: string;
  threadId: string;
};

type ThreadRow = {
  id: string;
  courseId: string;
};

type VoteRow = {
  userId: string;
  value: number | null;
};

type ReactionCounts = {
  useful: number;
  clarifies: number;
  reference: number;
};

type ReactionSnapshot = {
  reactionCounts: ReactionCounts;
  myReaction: number;
  reactionTotal: number;
};

function resolveForumErrorMessage(error: any, fallback: string): string {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (message.includes('ForumBoard') || message.includes('ForumThread') || message.includes('ForumPost') || message.includes('ForumPostVote')) {
    return 'Forum schema missing or outdated. Please verify the database state on the VPS.';
  }
  return fallback;
}

function parseVoteValue(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed === 0 || parsed === 1 || parsed === 2 || parsed === 3) return parsed;
  return null;
}

async function getPostContext(
  postId: string,
): Promise<{ post: PostRow; thread: ThreadRow } | null> {
  const { data: postRows, error: postError } = await query(
    `SELECT "id", "threadId" FROM "ForumPost" WHERE "id" = $1 LIMIT 1`,
    [postId]
  );
  const post = postRows?.[0];

  if (postError) throw postError;
  if (!post) return null;

  const { data: threadRows, error: threadError } = await query(
    `SELECT "id", "courseId" FROM "ForumThread" WHERE "id" = $1 LIMIT 1`,
    [post.threadId]
  );
  const thread = threadRows?.[0];

  if (threadError) throw threadError;
  if (!thread) return null;

  return {
    post: post as PostRow,
    thread: thread as ThreadRow,
  };
}

async function getVoteSnapshot(
  postId: string,
  currentUserId: string,
): Promise<ReactionSnapshot> {
  const { data: votes, error: votesError } = await query(
    `SELECT "userId", "value" FROM "ForumPostVote" WHERE "postId" = $1`,
    [postId]
  );

  if (votesError) throw votesError;

  const reactionCounts: ReactionCounts = {
    useful: 0,
    clarifies: 0,
    reference: 0,
  };
  let myReaction = 0;

  for (const vote of (votes || []) as VoteRow[]) {
    const value = Number(vote.value);
    if (value !== 1 && value !== 2 && value !== 3) continue;

    if (value === 1) reactionCounts.useful += 1;
    if (value === 2) reactionCounts.clarifies += 1;
    if (value === 3) reactionCounts.reference += 1;

    if (vote.userId === currentUserId) {
      myReaction = value;
    }
  }

  const reactionTotal = reactionCounts.useful + reactionCounts.clarifies + reactionCounts.reference;
  return { reactionCounts, myReaction, reactionTotal };
}

export const POST: APIRoute = async ({ request, params, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

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

  const voteValue = parseVoteValue(payload?.value);
  if (voteValue === null) {
    return json({ error: 'value must be 0, 1, 2, or 3' }, 400);
  }

  try {
    const dbUser = await ensureDbUserFromSession(session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const context = await getPostContext(postId);
    if (!context) return json({ error: 'Post not found' }, 404);

    const access = await getForumCourseAccess(dbUser, context.thread.courseId);
    if (!access.canWrite) {
      return json({ error: 'You must be enrolled in this course to react' }, 403);
    }

    if (voteValue === 0) {
      const { error: deleteError } = await query(
        `DELETE FROM "ForumPostVote" WHERE "postId" = $1 AND "userId" = $2`,
        [postId, dbUser.id]
      );

      if (deleteError) throw deleteError;
    } else {
      const { error: upsertError } = await query(
        `INSERT INTO "ForumPostVote" ("postId", "userId", "value") 
         VALUES ($1, $2, $3) 
         ON CONFLICT ("postId", "userId") DO UPDATE SET "value" = $3`,
        [postId, dbUser.id, voteValue]
      );

      if (upsertError) throw upsertError;
    }

    const snapshot = await getVoteSnapshot(postId, dbUser.id);

    // Broadcast updated counts to all clients (excluding myReaction — private per user)
    void broadcastForumEvent(context.post.threadId, 'forum_reaction_updated', {
      postId,
      reactionCounts: snapshot.reactionCounts,
      reactionTotal: snapshot.reactionTotal,
    });

    return json(
      {
        success: true,
        postId,
        reactionCounts: snapshot.reactionCounts,
        myReaction: snapshot.myReaction,
        reactionTotal: snapshot.reactionTotal,
        voteScore: snapshot.reactionTotal, // backward compatibility
        myVote: snapshot.myReaction, // backward compatibility
      },
      200,
    );
  } catch (error: any) {
    console.error('Forum post vote error:', error?.message || error);
    return json({ error: resolveForumErrorMessage(error, 'Failed to update reaction') }, 500);
  }
};

