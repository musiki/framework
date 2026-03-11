import type { APIRoute } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  cleanString,
  createSupabaseServerClient,
  ensureDbUserFromSession,
  getForumCourseAccess,
  json,
} from '../../../../../lib/forum-server';

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
  if (message.includes('SUPABASE_SERVICE_ROLE_KEY_REQUIRED_FOR_FORUM') || message.includes('SUPABASE_SERVER_KEY_MISSING')) {
    return 'Forum requires server service credentials. Set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY=service-role key) and restart dev server.';
  }
  if (message.includes('ForumPostVote_value_check') || message.toLowerCase().includes('check constraint')) {
    return 'Forum reaction schema outdated. Re-run docs/sql/forum-schema.sql in Supabase and restart dev server.';
  }
  if (message.toLowerCase().includes('row-level security')) {
    return 'RLS blocked forum write. Set SUPABASE_SERVICE_ROLE_KEY in server env and restart dev server.';
  }
  if (message.includes('ForumPostVote') || message.includes('ForumPost') || message.includes('ForumThread')) {
    return 'Forum schema missing or outdated. Re-run docs/sql/forum-schema.sql in Supabase.';
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
  supabase: SupabaseClient,
  postId: string,
): Promise<{ post: PostRow; thread: ThreadRow } | null> {
  const { data: post, error: postError } = await supabase
    .from('ForumPost')
    .select('id, threadId')
    .eq('id', postId)
    .maybeSingle();

  if (postError) throw postError;
  if (!post) return null;

  const { data: thread, error: threadError } = await supabase
    .from('ForumThread')
    .select('id, courseId')
    .eq('id', post.threadId)
    .maybeSingle();

  if (threadError) throw threadError;
  if (!thread) return null;

  return {
    post: post as PostRow,
    thread: thread as ThreadRow,
  };
}

async function getVoteSnapshot(
  supabase: SupabaseClient,
  postId: string,
  currentUserId: string,
): Promise<ReactionSnapshot> {
  const { data: votes, error: votesError } = await supabase
    .from('ForumPostVote')
    .select('userId, value')
    .eq('postId', postId);

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

  const supabase = createSupabaseServerClient({ requireServiceRole: true });

  try {
    const dbUser = await ensureDbUserFromSession(supabase, session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const context = await getPostContext(supabase, postId);
    if (!context) return json({ error: 'Post not found' }, 404);

    const access = await getForumCourseAccess(supabase, dbUser, context.thread.courseId);
    if (!access.canWrite) {
      return json({ error: 'You must be enrolled in this course to react' }, 403);
    }

    if (voteValue === 0) {
      const { error: deleteError } = await supabase
        .from('ForumPostVote')
        .delete()
        .eq('postId', postId)
        .eq('userId', dbUser.id);

      if (deleteError) throw deleteError;
    } else {
      const { error: upsertError } = await supabase.from('ForumPostVote').upsert(
        [
          {
            postId,
            userId: dbUser.id,
            value: voteValue,
          },
        ],
        {
          onConflict: 'postId,userId',
        },
      );

      if (upsertError) throw upsertError;
    }

    const snapshot = await getVoteSnapshot(supabase, postId, dbUser.id);
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
