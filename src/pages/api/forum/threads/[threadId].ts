import type { APIRoute } from 'astro';
import {
  cleanString,
  ensureDbUserFromSession,
  getForumCourseAccess,
  json,
} from '../../../../lib/forum-server';
import { query } from '../../../../lib/db/pool';

const THREAD_TITLE_MAX = 140;

type ThreadRow = {
  id: string;
  courseId: string;
  title: string;
  createdByUserId: string;
  isPinned: boolean | null;
  isLocked: boolean | null;
  createdAt: string | null;
  updatedAt: string | null;
};

function resolveForumErrorMessage(error: any, fallback: string): string {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (message.includes('ForumBoard') || message.includes('ForumThread') || message.includes('ForumPost') || message.includes('ForumPostVote')) {
    return 'Forum schema missing or outdated. Please verify the database state on the VPS.';
  }
  return fallback;
}

async function getThreadOrNull(
  threadId: string,
): Promise<ThreadRow | null> {
  const { data, error } = await query(
    `SELECT id, "courseId", title, "createdByUserId", "isPinned", "isLocked", "createdAt", "updatedAt" 
     FROM "ForumThread" WHERE id = $1`,
    [threadId]
  );

  if (error) throw error;
  return data?.[0] || null;
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

  const hasTitleUpdate = Object.prototype.hasOwnProperty.call(payload || {}, 'title');
  const hasPinnedUpdate = Object.prototype.hasOwnProperty.call(payload || {}, 'isPinned');
  const title = hasTitleUpdate ? cleanString(payload?.title, THREAD_TITLE_MAX) : '';
  const isPinned = hasPinnedUpdate ? Boolean(payload?.isPinned) : false;

  if (!hasTitleUpdate && !hasPinnedUpdate) {
    return json({ error: 'Nothing to update' }, 400);
  }
  if (hasTitleUpdate && title.length < 3) {
    return json({ error: 'Title must be at least 3 characters' }, 400);
  }

  try {
    const dbUser = await ensureDbUserFromSession(session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const thread = await getThreadOrNull(threadId);
    if (!thread) return json({ error: 'Thread not found' }, 404);

    const access = await getForumCourseAccess(dbUser, thread.courseId);
    if (!access.canRead) {
      return json({ error: 'Forbidden' }, 403);
    }

    const isAuthor = thread.createdByUserId === dbUser.id;
    const canEditThread = access.isTeacher || (isAuthor && !Boolean(thread.isLocked));
    const canPinThread = access.isTeacher;

    if (hasTitleUpdate && !canEditThread) {
      return json({ error: 'Only the thread author or a teacher can edit this thread' }, 403);
    }
    if (hasPinnedUpdate && !canPinThread) {
      return json({ error: 'Only teachers can pin or unpin threads' }, 403);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (hasTitleUpdate) updateData.title = title;
    if (hasPinnedUpdate) updateData.isPinned = isPinned;

    const cols = Object.keys(updateData);
    const vals = Object.values(updateData);
    const setSql = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
    
    const { data: updatedRaw, error: updateError } = await query(
      `UPDATE "ForumThread" SET ${setSql} WHERE id = $${cols.length + 1} 
       RETURNING id, "courseId", title, "createdByUserId", "isPinned", "isLocked", "createdAt", "updatedAt"`,
      [...vals, threadId]
    );

    if (updateError) throw updateError;

    return json(
      {
        success: true,
        thread: {
          ...(updatedRaw?.[0] as ThreadRow),
          canEdit: canEditThread,
          canDelete: canEditThread,
          canPin: canPinThread,
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

  try {
    const dbUser = await ensureDbUserFromSession(session);
    if (!dbUser) return json({ error: 'Not authenticated' }, 401);

    const thread = await getThreadOrNull(threadId);
    if (!thread) return json({ error: 'Thread not found' }, 404);

    const access = await getForumCourseAccess(dbUser, thread.courseId);
    if (!access.canRead) {
      return json({ error: 'Forbidden' }, 403);
    }

    const isAuthor = thread.createdByUserId === dbUser.id;
    const canModerate = access.isTeacher || (isAuthor && !Boolean(thread.isLocked));
    if (!canModerate) {
      return json({ error: 'Only the thread author or a teacher can delete this thread' }, 403);
    }

    const { error: deleteError } = await query(
      `DELETE FROM "ForumThread" WHERE id = $1`,
      [threadId]
    );

    if (deleteError) throw deleteError;

    return json({ success: true, threadId }, 200);
  } catch (error: any) {
    console.error('Forum thread delete error:', error?.message || error);
    return json({ error: resolveForumErrorMessage(error, 'Failed to delete thread') }, 500);
  }
};
