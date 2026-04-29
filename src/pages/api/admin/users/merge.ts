import type { APIRoute } from 'astro';
import { isElevatedGlobalRole } from '../../../../lib/roles';
import { mergeUsers } from '../../../../lib/user-email';
import { query } from '../../../../lib/db/pool';

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;

  if (!currentUser?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const { keepId, mergeId } = await request.json();

    if (!keepId || !mergeId || typeof keepId !== 'string' || typeof mergeId !== 'string') {
      return new Response(JSON.stringify({ error: 'keepId and mergeId are required' }), { status: 400 });
    }

    if (keepId === mergeId) {
      return new Response(JSON.stringify({ error: 'keepId and mergeId must be different' }), { status: 400 });
    }

    // Verify requester is admin/teacher
    const { data: viewerRows } = await query(
      `SELECT "id", "role" FROM "User" WHERE "email" ILIKE $1`,
      [currentUser.email]
    );

    const isElevated = (viewerRows || []).some((row: any) => isElevatedGlobalRole(row?.role));
    if (!isElevated) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    const result = await mergeUsers(undefined, keepId, mergeId);

    if (!result.ok) {
      return new Response(JSON.stringify({ error: result.error }), { status: 400 });
    }

    return new Response(JSON.stringify(result), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};

