import type { APIRoute } from 'astro';
import { forceEvalCatalogSync } from '../../../../lib/eval-sync';
import { isElevatedGlobalRole } from '../../../../lib/roles';
import { query } from '../../../../lib/db/pool';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });

const resolveRequesterRole = async (email: string): Promise<string> => {
  const { data, error } = await query(
    `SELECT "role" FROM "User" WHERE "email" ILIKE $1`,
    [String(email || '').trim()]
  );

  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const elevatedRow = rows.find((row: any) => isElevatedGlobalRole(row?.role));
  return String((elevatedRow || rows[0] || {}).role || '').trim().toLowerCase();
};

const runForcedSync: APIRoute = async ({ locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;

  if (!currentUser?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  try {
    const requesterRole = await resolveRequesterRole(currentUser.email);
    if (!isElevatedGlobalRole(requesterRole)) {
      return json({ error: 'Only teachers can run eval sync' }, 403);
    }

    const result = await forceEvalCatalogSync({
      reason: 'admin-api',
    });

    return json(
      {
        success: result.ok,
        result,
      },
      result.ok ? 200 : 500,
    );
  } catch (error: any) {
    console.error('Error forcing eval sync:', error?.message || error);
    return json({ error: error?.message || 'Failed to run eval sync' }, 500);
  }
};

export const GET = runForcedSync;
export const POST = runForcedSync;

