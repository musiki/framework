import type { APIRoute } from 'astro';
import {
  cleanString,
  createSupabaseServerClient,
  ensureDbUserFromSession,
  getForumCourseAccess,
  json,
} from '../../../../lib/forum-server';

const THREAD_TITLE_MAX = 140;

type ThreadRow = {
  id: string;
  courseId: string;
  title: string;
  createdByUserId: string;
  isLocked: boolean | null;
  createdAt: string | null;
  updatedAt: string | null;
};

function resolveForumErrorMessage(error: any, fallback: string): string {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (message.includes('SUPABASE_SERVICE_ROLE_KEY_REQUIRED_FOR_FORUM') || message.includes('SUPABASE_SERVER_KEY_MISSING')) {
    return 'Forum requires server service credentials. Set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY=service-role key) and restart dev server.';
  }
  if (message.toLowerCase().includes('row-level security')) {
    return 'RLS blocked forum write. Set SUPABASE_SERVICE_ROLE_KEY in server env and restart dev server.';
  }
  if (message.includes('ForumThread') || message.includes('ForumPost')) {
    return 'Forum schema missing or outdated. Re-run docs/sql/forum-schema.sql in Supabase.';
  }
  return fallback;
}

async function getThreadOrNull(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  threadId: string,
): Promise<ThreadRow | null> {
  const { data: threadRaw, error: threadError } = await supabase
    .from('ForumThread')
    .select('id, courseId, title, createdByUserId, isLocked, createdAt, updatedAt')
    .eq('id', threadId)
    .maybeSingle();

  if (threadError) throw threadError;
  if (!threadRaw) return null;
  return threadRaw as ThreadRow;
}

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

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

  const title = cleanString(payload?.title, THREAD_TITLE_MAX);
  if (title.length < 3) {
    return json({ error: 'Title must be at least 3 characters' }, 400);
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

    const isAuthor = thread.createdByUserId === dbUser.id;
    const canModerate = access.isTeacher || (isAuthor && !Boolean(thread.isLocked));
    if (!canModerate) {
      return json({ error: 'Only the thread author or a teacher can edit this thread' }, 403);
    }

    const { data: updatedRaw, error: updateError } = await supabase
      .from('ForumThread')
      .update({ title, updatedAt: new Date().toISOString() })
      .eq('id', threadId)
      .select('id, courseId, title, createdByUserId, isLocked, createdAt, updatedAt')
      .single();

    if (updateError) throw updateError;

    return json(
      {
        success: true,
        thread: {
          ...(updatedRaw as ThreadRow),
          canEdit: canModerate,
          canDelete: canModerate,
        },
      },
      200,
    );
  } catch (error: any) {
    console.error('Forum thread edit error:', error?.message || error);
    return json({ error: resolveForumErrorMessage(error, 'Failed to edit thread') }, 500);
  }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

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

    const isAuthor = thread.createdByUserId === dbUser.id;
    const canModerate = access.isTeacher || (isAuthor && !Boolean(thread.isLocked));
    if (!canModerate) {
      return json({ error: 'Only the thread author or a teacher can delete this thread' }, 403);
    }

    const { error: deleteError } = await supabase
      .from('ForumThread')
      .delete()
      .eq('id', threadId);

    if (deleteError) throw deleteError;

    return json({ success: true, threadId }, 200);
  } catch (error: any) {
    console.error('Forum thread delete error:', error?.message || error);
    return json({ error: resolveForumErrorMessage(error, 'Failed to delete thread') }, 500);
  }
};
