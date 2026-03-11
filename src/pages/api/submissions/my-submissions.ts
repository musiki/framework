import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const GET: APIRoute = async ({ locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;

  if (!currentUser?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const supabase = createClient(import.meta.env.SUPABASE_URL, import.meta.env.SUPABASE_KEY);

  try {
    const { data: user, error: userError } = await supabase
      .from('User')
      .select('id')
      .eq('email', currentUser.email)
      .single();

    if (userError || !user) {
      return json({ submissions: {} }, 200);
    }

    const { data: submissions, error: submissionsError } = await supabase
      .from('Submission')
      .select('id, assignmentId, payload, score, feedback, attempts, submittedAt, gradedAt')
      .eq('userId', user.id)
      .order('submittedAt', { ascending: false });

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
