import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { isElevatedGlobalRole } from '../../../../lib/roles';
import { mergeUsers } from '../../../../lib/user-email';

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

    const supabase = createClient(import.meta.env.SUPABASE_URL, import.meta.env.SUPABASE_KEY);

    // Verify requester is admin/teacher
    const { data: viewerRows } = await supabase
      .from('User')
      .select('id, role')
      .ilike('email', currentUser.email);

    const isElevated = (viewerRows || []).some((row: any) => isElevatedGlobalRole(row?.role));
    if (!isElevated) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    const result = await mergeUsers(supabase, keepId, mergeId);

    if (!result.ok) {
      return new Response(JSON.stringify({ error: result.error }), { status: 400 });
    }

    return new Response(JSON.stringify(result), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
