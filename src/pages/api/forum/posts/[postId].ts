import type { APIRoute } from 'astro';
import {
  cleanBody,
  cleanString,
  createSupabaseServerClient,
  ensureDbUserFromSession,
  getForumCourseAccess,
  json,
} from '../../../../lib/forum-server';
import { renderForumMarkdown } from '../../../../lib/forum-markdown';

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
  if (message.includes('SUPABASE_SERVICE_ROLE_KEY_REQUIRED_FOR_FORUM') || message.includes('SUPABASE_SERVER_KEY_MISSING')) {
    return 'Forum requires server service credentials. Set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY=service-role key) and restart dev server.';
  }
  if (message.toLowerCase().includes('row-level security')) {
    return 'RLS blocked forum write. Set SUPABASE_SERVICE_ROLE_KEY in server env and restart dev server.';
  }
  if (message.includes('ForumPost') || message.includes('ForumThread')) {
    return 'Forum schema missing or outdated. Re-run docs/sql/forum-schema.sql in Supabase.';
  }
  return fallback;
}

async function getPostContext(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  postId: string,
): Promise<{ post: PostRow; thread: ThreadRow } | null> {
  const { data: postRaw, error: postError } = await supabase
    .from('ForumPost')
    .select('id, threadId, parentPostId, authorUserId, body, status, createdAt, updatedAt')
    .eq('id', postId)
    .maybeSingle();

  if (postError) throw postError;
  if (!postRaw) return null;

  const post = postRaw as PostRow;

  const { data: threadRaw, error: threadError } = await supabase
    .from('ForumThread')
    .select('id, courseId, createdByUserId, isLocked')
    .eq('id', post.threadId)
    .maybeSingle();

  if (threadError) throw threadError;
  if (!threadRaw) return null;

  return {
    post,
    thread: threadRaw as ThreadRow,
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

  const supabase = createSupabaseServerClient({ requireServiceRole: true });

  try {
    const dbUser = await ensureDbUserFromSession(supabase, session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const context = await getPostContext(supabase, postId);
    if (!context) return json({ error: 'Post not found' }, 404);

    const access = await getForumCourseAccess(supabase, dbUser, context.thread.courseId);
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

    const { data: updatedRaw, error: updateError } = await supabase
      .from('ForumPost')
      .update({ body, status: 'published' })
      .eq('id', postId)
      .select('id, threadId, parentPostId, authorUserId, body, status, createdAt, updatedAt')
      .single();

    if (updateError) throw updateError;

    const updatedPost = updatedRaw as PostRow;
    let bodyHtml = '';
    try {
      bodyHtml = await renderForumMarkdown(updatedPost.body || '', {
        remoteLilypond: useRemoteLilypond,
      });
    } catch (renderError) {
      console.error('Forum markdown render error:', renderError);
      bodyHtml = `<p>${escapeHtml(updatedPost.body || '')}</p>`;
    }

    return json(
      {
        success: true,
        post: {
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
        },
      },
      200,
    );
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

  const supabase = createSupabaseServerClient({ requireServiceRole: true });

  try {
    const dbUser = await ensureDbUserFromSession(supabase, session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const context = await getPostContext(supabase, postId);
    if (!context) return json({ error: 'Post not found' }, 404);

    const access = await getForumCourseAccess(supabase, dbUser, context.thread.courseId);
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

    const { data: updatedRaw, error: updateError } = await supabase
      .from('ForumPost')
      .update({ body: '', status: 'deleted' })
      .eq('id', postId)
      .select('id, threadId, parentPostId, authorUserId, body, status, createdAt, updatedAt')
      .single();

    if (updateError) throw updateError;

    const { error: threadUpdateError } = await supabase
      .from('ForumThread')
      .update({ updatedAt: now })
      .eq('id', context.thread.id);

    if (threadUpdateError) throw threadUpdateError;

    return json(
      {
        success: true,
        post: {
          ...(updatedRaw as PostRow),
          bodyHtml: '',
          canEdit: false,
          canDelete: false,
        },
      },
      200,
    );
  } catch (error: any) {
    console.error('Forum post delete error:', error?.message || error);
    return json({ error: resolveForumErrorMessage(error, 'Failed to delete post') }, 500);
  }
};
