import type { APIContext } from 'astro';
import { AccessToken } from 'livekit-server-sdk';
import { createSupabaseServerClient, ensureDbUserFromSession } from '../forum-server';
import { canonicalizeCourseId } from '../course-alias';
import { verifyLiveRoomInviteAccess } from './invite';
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
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

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
  const session = (locals as any).session;
  const inviteCode = normalizeText(url.searchParams.get('invite')).toLowerCase();
  const externalName = normalizeText(url.searchParams.get('externalName'));
  const externalEmail = normalizeText(url.searchParams.get('externalEmail')).toLowerCase();
  const externalPassword = url.searchParams.get('externalPassword') || '';
  const inviteVerification = inviteCode
    ? await verifyLiveRoomInviteAccess({
        code: inviteCode,
        password: externalPassword,
      })
    : null;

  if (inviteCode && !inviteVerification?.ok) {
    return json({ error: inviteVerification?.reason || 'Invite not found or expired.' }, 403);
  }

  const activeInvite = inviteVerification?.invite || null;
  const room = normalizeText(activeInvite?.room) || normalizeText(url.searchParams.get('room'));

  if (!room) {
    return json({ error: 'room is required' }, 400);
  }

  const requestedIdentity =
    url.searchParams.get('identity') ||
    url.searchParams.get('user') ||
    url.searchParams.get('username');
  const requestedName = url.searchParams.get('name');
  const isExternalInvite = activeInvite?.inviteType === 'external';
  const isStudentInvite = activeInvite?.inviteType === 'student';
  const requestedCourse = isExternalInvite
    ? ''
    : normalizeText(activeInvite?.courseId) || normalizeText(url.searchParams.get('course'));
  const requestedPageSlug = isExternalInvite
    ? ''
    : normalizeText(activeInvite?.pageSlug) || normalizeText(url.searchParams.get('pageSlug'));

  const sessionName = normalizeText(session?.user?.name);
  const sessionEmail = normalizeText(session?.user?.email);
  const hasSessionUser = Boolean(sessionEmail);
  const normalizedCourseId = await canonicalizeCourseId(requestedCourse);

  if (!hasSessionUser && !isExternalInvite) {
    return json({ error: isStudentInvite ? 'Login required for student invite access' : 'Login required' }, 401);
  }

  if (isExternalInvite) {
    if (!externalName) {
      return json({ error: 'externalName is required for external invites' }, 400);
    }
    if (!externalEmail || !EMAIL_REGEX.test(externalEmail)) {
      return json({ error: 'externalEmail must be a valid email for external invites' }, 400);
    }
  }

  const identity =
    sanitizeIdentity(requestedIdentity) ||
    sanitizeIdentity(isExternalInvite ? externalEmail : '') ||
    sanitizeIdentity(sessionEmail) ||
    sanitizeIdentity(sessionName) ||
    createGuestIdentity();
  const name =
    normalizeText(isExternalInvite ? externalName : requestedName) ||
    sessionName ||
    identity;
  const role = isExternalInvite
    ? 'student'
    : await resolveLiveParticipantRole(session, requestedCourse);
  let userId = '';

  try {
    if (!isExternalInvite && normalizedCourseId) {
      const access = await resolveLiveManageAccess(session, normalizedCourseId);
      userId = normalizeText(access.userId);
    } else if (!isExternalInvite && session?.user?.email) {
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
      audience: isExternalInvite ? 'external' : 'member',
      courseId: isExternalInvite ? '' : normalizedCourseId,
      email: isExternalInvite ? externalEmail : sessionEmail,
      inviteCode: inviteCode || '',
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
