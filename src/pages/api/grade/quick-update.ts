import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { isElevatedGlobalRole } from '../../../lib/roles';

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;

  if (!currentUser?.email) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(import.meta.env.SUPABASE_URL, import.meta.env.SUPABASE_KEY);

  // Verify user is a teacher/admin across possible duplicate rows
  const { data: users } = await supabase.from('User').select('role').ilike('email', currentUser.email);
  const user = (users || []).find((row: any) => isElevatedGlobalRole(row?.role)) || users?.[0];
  
  if (!user || !isElevatedGlobalRole(user.role)) {
    return new Response(JSON.stringify({ error: 'Unauthorized - Teacher only' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { submissionId, score, feedback } = body;
    
    if (!submissionId) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const hasScore = !(score === undefined || score === null || score === '');
    const hasFeedback = typeof feedback === 'string';

    if (!hasScore && !hasFeedback) {
      return new Response(JSON.stringify({ error: 'Nothing to update' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const updatePayload: Record<string, unknown> = {};
    let numericScore: number | null = null;

    if (hasScore) {
      numericScore = parseFloat(score);
      if (isNaN(numericScore) || numericScore < 0 || numericScore > 10) {
        return new Response(JSON.stringify({ error: 'Invalid score (must be 0-10)' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      updatePayload.score = numericScore;
      updatePayload.gradedAt = new Date();
    }

    if (hasFeedback) {
      const normalizedFeedback = String(feedback).trim();
      updatePayload.feedback = normalizedFeedback || null;
      if (!('gradedAt' in updatePayload) && normalizedFeedback) {
        updatePayload.gradedAt = new Date();
      }
    }

    // Update submission fields in one call
    const { error } = await supabase.from('Submission')
      .update(updatePayload)
      .eq('id', submissionId);

    if (error) throw error;

    return new Response(JSON.stringify({ 
      success: true,
      score: numericScore,
      feedback: hasFeedback ? (String(feedback).trim() || null) : undefined,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error updating grade:', error);
    return new Response(JSON.stringify({ error: 'Failed to update grade' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
