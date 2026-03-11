import type { APIRoute } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  cleanBody,
  cleanString,
  createSupabaseServerClient,
  ensureDbUserFromSession,
  getForumCourseAccess,
  json,
} from '../../../../../lib/forum-server';
import { renderForumMarkdown } from '../../../../../lib/forum-markdown';

const POST_BODY_MAX = 4000;
const POSTS_LIMIT = 500;

type ThreadRow = {
  id: string;
  courseId: string;
  lessonSlug: string;
  createdByUserId: string;
  isLocked: boolean | null;
};

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

type AuthorRow = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: string | null;
};

type PostVoteRow = {
  postId: string;
  userId: string;
  value: number | null;
};

type ReactionCounts = {
  useful: number;
  clarifies: number;
  reference: number;
};

type ReactionSummary = {
  reactionCounts: ReactionCounts;
  myReaction: number;
  reactionTotal: number;
};

function toDisplayName(author?: AuthorRow): string {
  if (!author) return 'Usuario';
  if (author.name?.trim()) return author.name.trim();
  if (author.email?.trim()) return author.email.trim();
  return 'Usuario';
}

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
  if (message.includes('SUPABASE_SERVICE_ROLE_KEY_REQUIRED_FOR_FORUM') || message.includes('SUPABASE_SERVER_KEY_MISSING')) {
    return 'Forum requires server service credentials. Set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY=service-role key) and restart dev server.';
  }
  if (message.toLowerCase().includes('row-level security')) {
    return 'RLS blocked forum write. Set SUPABASE_SERVICE_ROLE_KEY in server env and restart dev server.';
  }
  if (message.includes('ForumThread') || message.includes('ForumPost') || message.includes('ForumPostVote')) {
    return 'Forum schema missing. Run docs/sql/forum-schema.sql in Supabase.';
  }
  return fallback;
}

async function loadAuthorMap(supabase: SupabaseClient, authorIds: string[]): Promise<Map<string, AuthorRow>> {
  if (authorIds.length === 0) return new Map();

  const { data: authors, error: authorsError } = await supabase
    .from('User')
    .select('id, name, email, image, role')
    .in('id', authorIds);

  if (authorsError) throw authorsError;

  return new Map((authors || []).map((author: AuthorRow) => [author.id, author]));
}

async function loadPostVoteMap(
  supabase: SupabaseClient,
  postIds: string[],
  currentUserId: string,
): Promise<Map<string, ReactionSummary>> {
  const summary = new Map<string, ReactionSummary>();
  if (postIds.length === 0) return summary;

  const { data: votesRaw, error: votesError } = await supabase
    .from('ForumPostVote')
    .select('postId, userId, value')
    .in('postId', postIds);

  if (votesError) {
    const message = typeof votesError?.message === 'string' ? votesError.message : '';
    if (message.includes('ForumPostVote') || message.includes('does not exist')) {
      // Backward compatibility when vote table has not been applied yet.
      return summary;
    }
    throw votesError;
  }

  for (const vote of (votesRaw || []) as PostVoteRow[]) {
    const postId = cleanString(vote.postId, 80);
    if (!postId) continue;

    const value = Number(vote.value);
    if (value !== 1 && value !== 2 && value !== 3) continue;

    const current = summary.get(postId) || {
      reactionCounts: { useful: 0, clarifies: 0, reference: 0 },
      myReaction: 0,
      reactionTotal: 0,
    };
    if (value === 1) current.reactionCounts.useful += 1;
    if (value === 2) current.reactionCounts.clarifies += 1;
    if (value === 3) current.reactionCounts.reference += 1;
    current.reactionTotal += 1;
    if (vote.userId === currentUserId) {
      current.myReaction = value;
    }
    summary.set(postId, current);
  }

  return summary;
}

async function getThreadOrNull(supabase: SupabaseClient, threadId: string): Promise<ThreadRow | null> {
  const { data: thread, error: threadError } = await supabase
    .from('ForumThread')
    .select('id, courseId, lessonSlug, createdByUserId, isLocked')
    .eq('id', threadId)
    .maybeSingle();

  if (threadError) throw threadError;
  if (!thread) return null;
  return thread as ThreadRow;
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

  const supabase = createSupabaseServerClient({ requireServiceRole: true });

  try {
    const dbUser = await ensureDbUserFromSession(supabase, session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const thread = await getThreadOrNull(supabase, threadId);
    if (!thread) return json({ error: 'Thread not found' }, 404);

    const access = await getForumCourseAccess(supabase, dbUser, thread.courseId);
    if (!access.canRead) {
      return json({ error: 'Forbidden' }, 403);
    }

    const { data: postsRaw, error: postsError } = await supabase
      .from('ForumPost')
      .select('id, threadId, parentPostId, authorUserId, body, status, createdAt, updatedAt')
      .eq('threadId', threadId)
      .neq('status', 'deleted')
      .order('createdAt', { ascending: true })
      .limit(POSTS_LIMIT);

    if (postsError) throw postsError;

    const posts = (postsRaw || []) as PostRow[];
    const authorIds = Array.from(new Set(posts.map((post) => post.authorUserId).filter(Boolean)));
    const authorById = await loadAuthorMap(supabase, authorIds);
    const voteSummaryByPostId = await loadPostVoteMap(
      supabase,
      posts.map((post) => post.id),
      dbUser.id,
    );
    const isLocked = Boolean(thread.isLocked);
    const canReply = access.canWrite && (!isLocked || access.isTeacher);
    const canVote = access.canWrite;

    const postsPayload = await Promise.all(
      posts.map(async (post) => {
        const author = authorById.get(post.authorUserId);
        let bodyHtml = '';
        const isAuthor = post.authorUserId === dbUser.id;
        const canModerate = access.isTeacher || isAuthor;

        try {
          bodyHtml = await renderForumMarkdown(post.body || '', {
            remoteLilypond: useRemoteLilypond,
          });
        } catch (renderError) {
          console.error('Forum markdown render error:', renderError);
          bodyHtml = `<p>${escapeHtml(post.body || '')}</p>`;
        }

        return {
          id: post.id,
          threadId: post.threadId,
          parentPostId: post.parentPostId,
          authorUserId: post.authorUserId,
          authorName: toDisplayName(author),
          authorImage: author?.image ?? null,
          authorRole: author?.role ?? null,
          body: post.body,
          status: post.status || 'published',
          bodyHtml,
          createdAt: post.createdAt,
          updatedAt: post.updatedAt,
          canEdit: canModerate,
          canDelete: canModerate,
          reactionCounts: voteSummaryByPostId.get(post.id)?.reactionCounts ?? {
            useful: 0,
            clarifies: 0,
            reference: 0,
          },
          myReaction: voteSummaryByPostId.get(post.id)?.myReaction ?? 0,
          reactionTotal: voteSummaryByPostId.get(post.id)?.reactionTotal ?? 0,
          voteScore: voteSummaryByPostId.get(post.id)?.reactionTotal ?? 0, // backward compatibility
          myVote: voteSummaryByPostId.get(post.id)?.myReaction ?? 0, // backward compatibility
        };
      }),
    );

    return json(
      {
        thread: {
          id: thread.id,
          courseId: thread.courseId,
          lessonSlug: thread.lessonSlug,
          isLocked,
        },
        canReply,
        canVote,
        posts: postsPayload,
      },
      200,
    );
  } catch (error: any) {
    console.error('Forum post list error:', error?.message || error);
    return json({ error: resolveForumErrorMessage(error, 'Failed to load thread posts') }, 500);
  }
};

export const POST: APIRoute = async ({ request, params, locals }) => {
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

  const supabase = createSupabaseServerClient({ requireServiceRole: true });

  try {
    const dbUser = await ensureDbUserFromSession(supabase, session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const thread = await getThreadOrNull(supabase, threadId);
    if (!thread) return json({ error: 'Thread not found' }, 404);

    const access = await getForumCourseAccess(supabase, dbUser, thread.courseId);
    if (!access.canWrite) {
      return json({ error: 'You must be enrolled in this course to post' }, 403);
    }

    const isLocked = Boolean(thread.isLocked);
    if (isLocked && !access.isTeacher) {
      return json({ error: 'Thread is locked' }, 403);
    }

    if (parentPostId) {
      const { data: parent, error: parentError } = await supabase
        .from('ForumPost')
        .select('id')
        .eq('id', parentPostId)
        .eq('threadId', threadId)
        .maybeSingle();

      if (parentError) throw parentError;
      if (!parent) {
        return json({ error: 'Parent post not found in this thread' }, 400);
      }
    }

    const now = new Date().toISOString();
    const postId = crypto.randomUUID();

    const { data: insertedPost, error: insertError } = await supabase
      .from('ForumPost')
      .insert([
        {
          id: postId,
          threadId,
          parentPostId: parentPostId || null,
          authorUserId: dbUser.id,
          body,
          status: 'published',
          createdAt: now,
          updatedAt: now,
        },
      ])
      .select('id, threadId, parentPostId, authorUserId, body, createdAt, updatedAt')
      .single();

    if (insertError) throw insertError;

    const { error: threadUpdateError } = await supabase
      .from('ForumThread')
      .update({ updatedAt: now })
      .eq('id', threadId);

    if (threadUpdateError) throw threadUpdateError;

    let bodyHtml = '';
    try {
      bodyHtml = await renderForumMarkdown((insertedPost as PostRow).body || '', {
        remoteLilypond: useRemoteLilypond,
      });
    } catch (renderError) {
      console.error('Forum markdown render error:', renderError);
      bodyHtml = `<p>${escapeHtml((insertedPost as PostRow).body || '')}</p>`;
    }

    return json(
      {
        success: true,
        post: {
          ...(insertedPost as PostRow),
          authorName: dbUser.name || dbUser.email || 'Usuario',
          authorImage: null,
          bodyHtml,
          canEdit: true,
          reactionCounts: {
            useful: 0,
            clarifies: 0,
            reference: 0,
          },
          myReaction: 0,
          reactionTotal: 0,
          voteScore: 0,
          myVote: 0,
        },
      },
      201,
    );
  } catch (error: any) {
    console.error('Forum post create error:', error?.message || error);
    return json({ error: resolveForumErrorMessage(error, 'Failed to create post') }, 500);
  }
};
