import type { Session } from '@auth/core/types';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getEntry } from 'astro:content';
import { canonicalizeCourseId, getCourseAliases } from './course-alias';

export type ForumDbUser = {
  id: string;
  email: string | null;
  name: string | null;
  role: string | null;
};

export type ForumCourseAccess = {
  canRead: boolean;
  canWrite: boolean;
  isPublicCourse: boolean;
  isEnrolled: boolean;
  isTeacher: boolean;
};

type ServerClientOptions = {
  requireServiceRole?: boolean;
};

function clampLength(value: string, maxLength: number): string {
  if (maxLength <= 0) return value;
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength);
}

function normalizeDbUser(row: any): ForumDbUser {
  return {
    id: String(row.id),
    email: row.email ?? null,
    name: row.name ?? null,
    role: row.role ?? null,
  };
}

function isClearlyPublishableSupabaseKey(key: string): boolean {
  return key.startsWith('sb_publishable_');
}

export function createSupabaseServerClient(options: ServerClientOptions = {}): SupabaseClient {
  const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY || import.meta.env.SUPABASE_SERVICE_KEY;
  const fallbackKey = import.meta.env.SUPABASE_KEY;
  const apiKey = serviceRoleKey || fallbackKey;
  if (!apiKey) {
    throw new Error('SUPABASE_SERVER_KEY_MISSING');
  }
  if (options.requireServiceRole && isClearlyPublishableSupabaseKey(apiKey)) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED_FOR_FORUM');
  }

  return createClient(import.meta.env.SUPABASE_URL, apiKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

export function cleanString(value: unknown, maxLength = 240): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  return clampLength(raw, maxLength);
}

export function cleanBody(value: unknown, maxLength = 4000): string {
  const raw = typeof value === 'string' ? value : '';
  const normalized = raw.replace(/\r\n?/g, '\n').trim();
  return clampLength(normalized, maxLength);
}

export async function ensureDbUserFromSession(
  supabase: SupabaseClient,
  session: Session | null | undefined,
): Promise<ForumDbUser | null> {
  const email = cleanString(session?.user?.email ?? '', 320);
  if (!email) return null;

  const { data: existing, error: existingError } = await supabase
    .from('User')
    .select('id, email, name, role, image')
    .eq('email', email)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) {
    const sessionName = cleanString(session?.user?.name ?? '', 160);
    const sessionImage = cleanString(session?.user?.image ?? '', 1024);

    const nextName = sessionName || cleanString(existing.name ?? email, 160) || email;
    const nextImage = sessionImage || existing.image || null;

    const shouldUpdateName = Boolean(sessionName) && nextName !== (existing.name ?? '');
    const shouldUpdateImage = Boolean(sessionImage) && nextImage !== (existing.image ?? null);

    if (shouldUpdateName || shouldUpdateImage) {
      const { error: updateError } = await supabase
        .from('User')
        .update({
          name: shouldUpdateName ? nextName : existing.name,
          image: shouldUpdateImage ? nextImage : existing.image,
          updatedAt: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (updateError) {
        console.error('Failed to update session profile fields in User table:', updateError);
      } else {
        if (shouldUpdateName) existing.name = nextName;
        if (shouldUpdateImage) existing.image = nextImage;
      }
    }

    return normalizeDbUser(existing);
  }

  const now = new Date().toISOString();
  const insertPayload = {
    id: crypto.randomUUID(),
    email,
    name: cleanString(session?.user?.name ?? email, 160),
    emailVerified: true,
    image: session?.user?.image ?? null,
    role: 'student',
    createdAt: now,
    updatedAt: now,
  };

  const { data: inserted, error: insertError } = await supabase
    .from('User')
    .insert([insertPayload])
    .select('id, email, name, role')
    .single();

  if (!insertError && inserted) {
    return normalizeDbUser(inserted);
  }

  if (insertError && insertError.code !== '23505') {
    throw insertError;
  }

  // Concurrent first-login writes can trigger a duplicate key race.
  const { data: refetched, error: refetchError } = await supabase
    .from('User')
    .select('id, email, name, role')
    .eq('email', email)
    .single();

  if (refetchError) throw refetchError;
  return normalizeDbUser(refetched);
}

async function isPublicCourse(courseId: string): Promise<boolean> {
  const normalizedCourseId = await canonicalizeCourseId(courseId);
  if (!normalizedCourseId) return false;

  try {
    const courseEntry = await getEntry('cursos', `${normalizedCourseId}/_index`);
    return Boolean(courseEntry?.data?.public);
  } catch {
    return false;
  }
}

export async function getForumCourseAccess(
  supabase: SupabaseClient,
  user: ForumDbUser,
  courseId: string,
): Promise<ForumCourseAccess> {
  const normalizedCourseId = await canonicalizeCourseId(courseId);
  const courseAliases = await getCourseAliases(normalizedCourseId || courseId);
  const normalizedGlobalRole = String(user.role || '').trim().toLowerCase();
  const isPublic = await isPublicCourse(normalizedCourseId);

  const { data: enrollments, error: enrollmentError } = await supabase
    .from('Enrollment')
    .select('id, roleInCourse, courseId')
    .eq('userId', user.id)
    .in('courseId', courseAliases.length > 0 ? courseAliases : [normalizedCourseId || courseId]);

  if (enrollmentError) throw enrollmentError;

  const matchingEnrollments = Array.isArray(enrollments) ? enrollments : [];
  const enrollment =
    matchingEnrollments.find(
      (row: any) => String(row?.roleInCourse || '').trim().toLowerCase() === 'teacher',
    ) || matchingEnrollments[0] || null;
  const isEnrolled = matchingEnrollments.length > 0;
  const isTeacherInCourse =
    isEnrolled &&
    (String((enrollment as any)?.roleInCourse || '').trim().toLowerCase() === 'teacher' ||
      normalizedGlobalRole === 'teacher');

  return {
    canRead: isEnrolled,
    canWrite: isEnrolled,
    isPublicCourse: isPublic,
    isEnrolled,
    isTeacher: isTeacherInCourse,
  };
}
