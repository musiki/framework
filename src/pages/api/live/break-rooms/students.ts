import type { APIRoute } from 'astro';
import { json } from '../../../../lib/forum-server';
import { resolveLiveParticipantRole } from '../../../../lib/live/access';
import { query } from '../../../../lib/db/pool';

// GET /api/live/break-rooms/students?courseId=X&year=YYYY
// Returns enrolled students with their grupo assignment.
export const GET: APIRoute = async ({ url, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) return json({ error: 'Not authenticated' }, 401);

  const courseId = url.searchParams.get('courseId') ?? '';
  if (!courseId) return json({ error: 'courseId required' }, 400);

  try {
    const role = await resolveLiveParticipantRole(session, courseId);
    if (role !== 'teacher') return json({ error: 'Teachers only' }, 403);

    const year = (url.searchParams.get('year') ?? String(new Date().getFullYear()));

    // Find the meta assignment for this course+year
    const assignmentId = `__meta__:course-student-profile:${encodeURIComponent(courseId)}:${year}`;

    const { data: subs, error } = await query(
      `SELECT "userId", payload FROM "Submission" WHERE "assignmentId" = $1`,
      [assignmentId]
    );

    if (error) return json({ error: error.message }, 500);

    // Also fetch user names for each userId
    const userIds = (subs ?? []).map((s: any) => s.userId).filter(Boolean);
    let userNames: Record<string, string> = {};
    let userEmails: Record<string, string> = {};

    if (userIds.length > 0) {
      const { data: users } = await query(
        `SELECT id, name, email FROM "User" WHERE id = ANY($1)`,
        [userIds]
      );

      if (users) {
        for (const u of users) {
          userNames[u.id] = u.name || u.email || u.id;
          userEmails[u.id] = u.email || '';
        }
      }
    }

    const students = (subs ?? []).map((s: any) => ({
      userId: s.userId,
      name: userNames[s.userId] ?? s.userId,
      email: userEmails[s.userId] ?? '',
      grupo: String((s.payload as any)?.grupo ?? ''),
    }));

    return json({ students });
  } catch (err: any) {
    console.error('break-rooms/students error:', err?.message || err);
    return json({ error: 'Failed to load students' }, 500);
  }
};
