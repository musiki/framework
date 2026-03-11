import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

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

  const supabase = createClient(import.meta.env.SUPABASE_URL, import.meta.env.SUPABASE_KEY);

  try {
    const { data: user, error: userError } = await supabase
      .from('User')
      .select('id, role')
      .eq('email', currentUser.email)
      .single();

    if (userError || !user) {
      return json({ error: 'User not found' }, 404);
    }

    const isTeacher = String(user.role || '').trim().toLowerCase() === 'teacher';
    let deleteQuery = supabase.from('Submission').delete().eq('id', submissionId);

    if (!isTeacher) {
      const { data: submission, error: submissionError } = await supabase
        .from('Submission')
        .select('id')
        .eq('id', submissionId)
        .eq('userId', user.id)
        .maybeSingle();

      if (submissionError || !submission) {
        return json({ error: 'Submission not found' }, 404);
      }

      deleteQuery = deleteQuery.eq('userId', user.id);
    } else {
      const { data: submission, error: submissionError } = await supabase
        .from('Submission')
        .select('id')
        .eq('id', submissionId)
        .maybeSingle();

      if (submissionError || !submission) {
        return json({ error: 'Submission not found' }, 404);
      }
    }

    const { error: deleteError } = await deleteQuery;

    if (deleteError) throw deleteError;

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
