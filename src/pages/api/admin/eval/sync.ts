import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { forceEvalCatalogSync } from '../../../../lib/eval-sync';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });

const resolveRequesterRole = async (email: string): Promise<string> => {
  const supabase = createClient(import.meta.env.SUPABASE_URL, import.meta.env.SUPABASE_KEY);
  const { data, error } = await supabase
    .from('User')
    .select('role')
    .eq('email', String(email || '').trim())
    .maybeSingle();

  if (error) throw error;
  return String(data?.role || '').trim().toLowerCase();
};

const runForcedSync: APIRoute = async ({ locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;

  if (!currentUser?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  try {
    const requesterRole = await resolveRequesterRole(currentUser.email);
    if (requesterRole !== 'teacher') {
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
