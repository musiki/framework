import type { APIRoute } from 'astro';
import { query } from '../../../lib/db/pool';
import { isElevatedGlobalRole } from '../../../lib/roles';

export const DELETE: APIRoute = async ({ params, locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;

  if (!currentUser?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const submissionId = params.id;
  if (!submissionId) {
    return json({ error: 'Submission id required' }, 400);
  }

  try {
    const { data: users, error: userError } = await query(
      'SELECT "id", "role" FROM "User" WHERE "email" ILIKE $1',
      [currentUser.email]
    );
    const user = (users || []).find((row: any) => isElevatedGlobalRole(row?.role)) || users?.[0];

    if (userError || !user) {
      return json({ error: 'User not found' }, 404);
    }

    const isTeacher = isElevatedGlobalRole(user.role);

    if (!isTeacher) {
      const { data: submissions, error: submissionError } = await query(
        'SELECT "id" FROM "Submission" WHERE "id" = $1 AND "userId" = $2',
        [submissionId, user.id]
      );

      if (submissionError || !submissions?.length) {
        return json({ error: 'Submission not found' }, 404);
      }

      const { error: deleteError } = await query(
        'DELETE FROM "Submission" WHERE "id" = $1 AND "userId" = $2',
        [submissionId, user.id]
      );

      if (deleteError) throw deleteError;
    } else {
      const { data: submissions, error: submissionError } = await query(
        'SELECT "id" FROM "Submission" WHERE "id" = $1',
        [submissionId]
      );

      if (submissionError || !submissions?.length) {
        return json({ error: 'Submission not found' }, 404);
      }

      const { error: deleteError } = await query(
        'DELETE FROM "Submission" WHERE "id" = $1',
        [submissionId]
      );

      if (deleteError) throw deleteError;
    }

    return json({ success: true }, 200);
  } catch (error: any) {
    console.error('Error deleting submission:', error?.message || error);
    return json({ error: 'Failed to delete submission' }, 500);
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
