import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { canonicalizeCourseId } from '../../lib/course-alias';

const normalizeText = (value: unknown) => String(value || '').trim();
const normalizeRole = (value: unknown) => normalizeText(value).toLowerCase();

const resolveSessionUsers = async (supabase: ReturnType<typeof createClient>, email: string) => {
  const normalizedEmail = normalizeText(email).toLowerCase();
  if (!normalizedEmail) return [];

  const { data, error } = await supabase
    .from('User')
    .select('id, role, email')
    .ilike('email', normalizedEmail);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

export const POST: APIRoute = async ({ request, locals }) => {
  const session = locals.session as any;
  const currentUser = session?.user;

  if (!currentUser) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const { courseId } = await request.json();
    if (!courseId) return new Response(JSON.stringify({ error: 'Missing courseId' }), { status: 400 });

    const supabase = createClient(import.meta.env.SUPABASE_URL, import.meta.env.SUPABASE_KEY);

    const users = await resolveSessionUsers(supabase, currentUser.email);
    const user = users[0];
    if (!user) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });

    // Check existing enrollment
    const { data: existing } = await supabase.from('Enrollment').select('id').eq('userId', user.id).eq('courseId', courseId).single();
    
    if (existing) {
      return new Response(JSON.stringify({ message: 'Already enrolled' }), { status: 200 });
    }

    // Determine role for the course based on the user's global role
    const roleInCourse = user.role === 'teacher' ? 'teacher' : 'student';

    // Insert Enrollment
    const { error } = await supabase.from('Enrollment').insert([{
      userId: user.id,
      courseId: courseId,
      roleInCourse: roleInCourse
    }]);

    if (error) throw error;

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const session = locals.session as any;
  const currentUser = session?.user;

  if (!currentUser?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const { enrollmentId } = await request.json();
    const normalizedEnrollmentId = normalizeText(enrollmentId);
    if (!normalizedEnrollmentId) {
      return new Response(JSON.stringify({ error: 'Missing enrollmentId' }), { status: 400 });
    }

    const supabase = createClient(import.meta.env.SUPABASE_URL, import.meta.env.SUPABASE_KEY);

    const users = await resolveSessionUsers(supabase, currentUser.email);
    const actingUserIds = Array.from(new Set(users.map((user) => normalizeText(user?.id)).filter(Boolean)));
    if (actingUserIds.length === 0) {
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });
    }

    const { data: targetEnrollment, error: targetEnrollmentError } = await supabase
      .from('Enrollment')
      .select('id, userId, courseId, roleInCourse')
      .eq('id', normalizedEnrollmentId)
      .single();

    if (targetEnrollmentError) throw targetEnrollmentError;
    if (!targetEnrollment) {
      return new Response(JSON.stringify({ error: 'Enrollment not found' }), { status: 404 });
    }

    const targetRole = normalizeRole(targetEnrollment.roleInCourse);
    const targetCourseId = await canonicalizeCourseId(targetEnrollment.courseId);
    const { data: teacherEnrollments, error: teacherEnrollmentsError } = await supabase
      .from('Enrollment')
      .select('courseId, roleInCourse, userId')
      .in('userId', actingUserIds);

    if (teacherEnrollmentsError) throw teacherEnrollmentsError;

    const manageableCourses = new Set<string>();
    for (const enrollment of teacherEnrollments || []) {
      if (normalizeRole(enrollment?.roleInCourse) !== 'teacher') continue;
      const canonicalCourseId = await canonicalizeCourseId(enrollment?.courseId);
      if (canonicalCourseId) manageableCourses.add(canonicalCourseId);
    }

    if (!targetCourseId || !manageableCourses.has(targetCourseId)) {
      return new Response(JSON.stringify({ error: 'You can only manage enrollments in your own courses' }), { status: 403 });
    }

    if (targetRole === 'teacher') {
      const isOwnTeacherEnrollment = actingUserIds.includes(normalizeText(targetEnrollment.userId));
      if (!isOwnTeacherEnrollment) {
        return new Response(JSON.stringify({ error: 'You can only remove your own teacher enrollment' }), { status: 403 });
      }

      const { data: courseEnrollments, error: courseEnrollmentsError } = await supabase
        .from('Enrollment')
        .select('id, courseId, roleInCourse');

      if (courseEnrollmentsError) throw courseEnrollmentsError;

      let teacherCount = 0;
      for (const enrollment of courseEnrollments || []) {
        if (normalizeRole(enrollment?.roleInCourse) !== 'teacher') continue;
        const enrollmentCourseId = await canonicalizeCourseId(enrollment?.courseId);
        if (enrollmentCourseId === targetCourseId) {
          teacherCount += 1;
        }
      }

      if (teacherCount <= 1) {
        return new Response(JSON.stringify({ error: 'Cannot remove the last teacher enrollment in this course' }), { status: 403 });
      }
    } else if (targetRole !== 'student') {
      return new Response(JSON.stringify({ error: 'Unsupported enrollment role' }), { status: 403 });
    }

    const { error: deleteError } = await supabase
      .from('Enrollment')
      .delete()
      .eq('id', normalizedEnrollmentId);

    if (deleteError) throw deleteError;

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  const session = locals.session as any;
  const currentUser = session?.user;

  if (!currentUser?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const { enrollmentId, roleInCourse } = await request.json();
    const normalizedEnrollmentId = normalizeText(enrollmentId);
    const normalizedNextRole = normalizeRole(roleInCourse);
    if (!normalizedEnrollmentId) {
      return new Response(JSON.stringify({ error: 'Missing enrollmentId' }), { status: 400 });
    }
    if (!['student', 'teacher'].includes(normalizedNextRole)) {
      return new Response(JSON.stringify({ error: 'Unsupported roleInCourse' }), { status: 400 });
    }

    const supabase = createClient(import.meta.env.SUPABASE_URL, import.meta.env.SUPABASE_KEY);
    const users = await resolveSessionUsers(supabase, currentUser.email);
    const actingUserIds = Array.from(new Set(users.map((user) => normalizeText(user?.id)).filter(Boolean)));
    if (actingUserIds.length === 0) {
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });
    }

    const { data: targetEnrollment, error: targetEnrollmentError } = await supabase
      .from('Enrollment')
      .select('id, userId, courseId, roleInCourse')
      .eq('id', normalizedEnrollmentId)
      .single();

    if (targetEnrollmentError) throw targetEnrollmentError;
    if (!targetEnrollment) {
      return new Response(JSON.stringify({ error: 'Enrollment not found' }), { status: 404 });
    }

    const targetCourseId = await canonicalizeCourseId(targetEnrollment.courseId);
    const currentRole = normalizeRole(targetEnrollment.roleInCourse);
    if (!targetCourseId) {
      return new Response(JSON.stringify({ error: 'Course not found for enrollment' }), { status: 404 });
    }

    const { data: actingEnrollments, error: actingEnrollmentsError } = await supabase
      .from('Enrollment')
      .select('courseId, roleInCourse, userId')
      .in('userId', actingUserIds);

    if (actingEnrollmentsError) throw actingEnrollmentsError;

    const manageableCourses = new Set<string>();
    for (const enrollment of actingEnrollments || []) {
      if (normalizeRole(enrollment?.roleInCourse) !== 'teacher') continue;
      const canonicalCourseId = await canonicalizeCourseId(enrollment?.courseId);
      if (canonicalCourseId) manageableCourses.add(canonicalCourseId);
    }

    if (!manageableCourses.has(targetCourseId)) {
      return new Response(JSON.stringify({ error: 'You can only manage roles in your own courses' }), { status: 403 });
    }

    if (currentRole === normalizedNextRole) {
      return new Response(JSON.stringify({ success: true, enrollment: targetEnrollment }), { status: 200 });
    }

    if (currentRole === 'teacher' && normalizedNextRole === 'student') {
      const { data: courseEnrollments, error: courseEnrollmentsError } = await supabase
        .from('Enrollment')
        .select('id, courseId, roleInCourse');

      if (courseEnrollmentsError) throw courseEnrollmentsError;

      let teacherCount = 0;
      for (const enrollment of courseEnrollments || []) {
        if (normalizeRole(enrollment?.roleInCourse) !== 'teacher') continue;
        const enrollmentCourseId = await canonicalizeCourseId(enrollment?.courseId);
        if (enrollmentCourseId === targetCourseId) {
          teacherCount += 1;
        }
      }

      if (teacherCount <= 1) {
        return new Response(JSON.stringify({ error: 'Cannot demote the last teacher in this course' }), { status: 403 });
      }
    }

    const { data: updatedEnrollment, error: updateError } = await supabase
      .from('Enrollment')
      .update({ roleInCourse: normalizedNextRole })
      .eq('id', normalizedEnrollmentId)
      .select('id, userId, courseId, roleInCourse')
      .single();

    if (updateError) throw updateError;

    return new Response(JSON.stringify({ success: true, enrollment: updatedEnrollment }), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
