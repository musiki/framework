import type { APIRoute } from 'astro';
import { query } from '../../../lib/db/pool';

export const GET: APIRoute = async ({ locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;

  if (!currentUser?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  try {
    const { data: userRows, error: userError } = await query(
      'SELECT "id" FROM "User" WHERE "email" = $1 LIMIT 1',
      [currentUser.email]
    );

    if (userError || !userRows?.[0]) {
      return json({ submissions: {} }, 200);
    }

    const user = userRows[0];

    const { data: submissions, error: submissionsError } = await query(
      `SELECT "id", "assignmentId", "payload", "score", "feedback", "attempts", "submittedAt", "gradedAt"
       FROM "Submission"
       WHERE "userId" = $1
       ORDER BY "submittedAt" DESC`,
      [user.id]
    );

    if (submissionsError) throw submissionsError;

    const byAssignment = (submissions || []).reduce((acc: Record<string, any>, submission: any) => {
      if (!submission?.assignmentId || acc[submission.assignmentId]) return acc;

      acc[submission.assignmentId] = {
        id: submission.id,
        assignmentId: submission.assignmentId,
        answer: submission.payload,
        score: submission.score,
        feedback: submission.feedback,
        attempts: submission.attempts,
        submittedAt: submission.submittedAt,
        gradedAt: submission.gradedAt,
      };

      return acc;
    }, {});

    return json({ submissions: byAssignment }, 200);
  } catch (error: any) {
    console.error('Error loading submissions:', error?.message || error);
    return json({ error: 'Failed to load submissions' }, 500);
  }
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
