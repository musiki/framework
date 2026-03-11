import type { APIContext } from 'astro';
import { AccessToken } from 'livekit-server-sdk';
import { createSupabaseServerClient, ensureDbUserFromSession } from '../forum-server';
import { canonicalizeCourseId } from '../course-alias';
import { resolveLiveManageAccess, resolveLiveParticipantRole } from './access';

export type LiveKitParticipantRole = 'teacher' | 'student';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });

const normalizeText = (value: unknown) => String(value ?? '').trim();

const normalizeRole = (value: unknown): LiveKitParticipantRole =>
  normalizeText(value).toLowerCase() === 'teacher' ? 'teacher' : 'student';

const sanitizeIdentity = (value: unknown) => {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);

  return normalized;
};

const createGuestIdentity = () => `guest-${crypto.randomUUID().slice(0, 8)}`;

export const createLiveKitTokenResponse = async ({ request, locals }: APIContext) => {
  const url = new URL(request.url);
  const room = normalizeText(url.searchParams.get('room'));

  if (!room) {
    return json({ error: 'room is required' }, 400);
  }

  const session = (locals as App.Locals).session;
  const requestedIdentity =
    url.searchParams.get('identity') ||
    url.searchParams.get('user') ||
    url.searchParams.get('username');
  const requestedName = url.searchParams.get('name');
  const requestedCourse = normalizeText(url.searchParams.get('course'));
  const requestedPageSlug = normalizeText(url.searchParams.get('pageSlug'));

  const sessionName = normalizeText(session?.user?.name);
  const sessionEmail = normalizeText(session?.user?.email);
  const normalizedCourseId = await canonicalizeCourseId(requestedCourse);

  const identity =
    sanitizeIdentity(requestedIdentity) ||
    sanitizeIdentity(sessionEmail) ||
    sanitizeIdentity(sessionName) ||
    createGuestIdentity();
  const name = normalizeText(requestedName) || sessionName || identity;
  const role = await resolveLiveParticipantRole(session, requestedCourse);
  let userId = '';

  try {
    if (normalizedCourseId) {
      const access = await resolveLiveManageAccess(session, normalizedCourseId);
      userId = normalizeText(access.userId);
    } else if (session?.user?.email) {
      const supabase = createSupabaseServerClient();
      const dbUser = await ensureDbUserFromSession(supabase, session);
      userId = normalizeText(dbUser?.id);
    }
  } catch (error) {
    console.error('LiveKit token user resolution failed:', error);
  }

  const apiKey = normalizeText(import.meta.env.LIVEKIT_API_KEY);
  const apiSecret = normalizeText(import.meta.env.LIVEKIT_API_SECRET);
  const livekitUrl = normalizeText(import.meta.env.LIVEKIT_URL || import.meta.env.PUBLIC_LIVEKIT_URL);

  if (!apiKey || !apiSecret) {
    return json({ error: 'LiveKit server environment variables are not set' }, 500);
  }

  const accessToken = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    metadata: JSON.stringify({
      courseId: normalizedCourseId,
      pageSlug: requestedPageSlug,
      role,
      name,
      userId,
    }),
  });

  accessToken.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
    canUpdateOwnMetadata: true,
  });

  const token = await accessToken.toJwt();

  return json({
    token,
    room,
    identity,
    livekitUrl,
    name,
    role,
  });
};
