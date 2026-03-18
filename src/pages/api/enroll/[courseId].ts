import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const POST: APIRoute = async ({ params, locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;

  if (!currentUser?.email) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const courseId = params.courseId;

  if (!courseId) {
    return new Response(JSON.stringify({ error: 'Course ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(import.meta.env.SUPABASE_URL, import.meta.env.SUPABASE_KEY);

  try {
    // Get or create user record (first Google login may not have a DB row yet)
    let { data: user } = await supabase.from('User').select('id, role').eq('email', currentUser.email).maybeSingle();

    if (!user) {
      const name = typeof currentUser.name === 'string' ? currentUser.name.trim() : '';
      const { data: created, error: createError } = await supabase
        .from('User')
        .insert([{ email: currentUser.email, name, role: 'student' }])
        .select('id, role')
        .single();
      if (createError || !created) {
        return new Response(JSON.stringify({ error: 'Could not create user record' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      user = created;
    }

    // Check if already enrolled
    const { data: existing } = await supabase.from('Enrollment').select('id').eq('userId', user.id).eq('courseId', courseId).single();

    if (existing) {
      return new Response(JSON.stringify({ message: 'Already enrolled' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create enrollment
    await supabase.from('Enrollment').insert([{
      userId: user.id,
      courseId: courseId,
      roleInCourse: user.role === 'teacher' ? 'teacher' : 'student',
    }]);

    return new Response(JSON.stringify({ success: true, message: 'Enrolled successfully' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Enrollment error:', error);
    return new Response(JSON.stringify({ error: 'Failed to enroll' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
