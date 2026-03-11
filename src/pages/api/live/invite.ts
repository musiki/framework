import type { APIRoute } from 'astro';
import { canonicalizeCourseId } from '../../../lib/course-alias';
import {
  getLatestLiveRoomInvite,
  getLiveRoomInviteByCode,
  normalizeLiveRoomInviteType,
  revokeLiveRoomInvite,
  resolveLiveInviteTeacherAccess,
  upsertLiveRoomInvite,
} from '../../../lib/live/invite';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });

const normalizeText = (value: unknown) => String(value ?? '').trim();
const LOCALHOST_HOST_RE = /^(localhost|127(?:\.\d+){3}|0\.0\.0\.0)$/i;

const normalizeOriginCandidate = (value: unknown) => {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  const withProtocol =
    normalized.startsWith('http://') || normalized.startsWith('https://')
      ? normalized
      : `https://${normalized}`;

  try {
    const parsed = new URL(withProtocol);
    return LOCALHOST_HOST_RE.test(parsed.hostname) ? '' : parsed.origin;
  } catch {
    return '';
  }
};

const resolvePublicRequestUrl = (request: Request) => {
  const incoming = new URL(request.url);
  if (!LOCALHOST_HOST_RE.test(incoming.hostname)) return incoming;

  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedHost) {
    const host = forwardedHost.split(',')[0].trim();
    const proto = (forwardedProto?.split(',')[0].trim() || 'https').replace(/:$/, '');
    return new URL(`${proto}://${host}${incoming.pathname}${incoming.search}`);
  }

  const fallbackOrigin =
    normalizeOriginCandidate(import.meta.env.SITE_URL) ||
    normalizeOriginCandidate(import.meta.env.AUTH_URL) ||
    normalizeOriginCandidate(import.meta.env.NEXTAUTH_URL) ||
    normalizeOriginCandidate(import.meta.env.VERCEL_PROJECT_PRODUCTION_URL) ||
    normalizeOriginCandidate(import.meta.env.VERCEL_URL ? `https://${import.meta.env.VERCEL_URL}` : '');

  if (fallbackOrigin) {
    return new URL(`${fallbackOrigin}${incoming.pathname}${incoming.search}`);
  }

  return incoming;
};

const normalizeHref = (value: unknown, requestUrl: URL) => {
  const raw = normalizeText(value);
  if (!raw) return '';

  try {
    const url = new URL(raw, requestUrl.origin);
    if (url.origin !== requestUrl.origin) return '';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '';
  }
};

export const GET: APIRoute = async ({ request, locals }) => {
  const requestUrl = resolvePublicRequestUrl(request);
  const code = normalizeText(requestUrl.searchParams.get('code'));

  try {
    if (code) {
      const invite = await getLiveRoomInviteByCode(code);
      if (!invite) {
        return json({ error: 'Invite not found or expired.' }, 404);
      }
      return json({ invite }, 200);
    }

    const room = normalizeText(requestUrl.searchParams.get('room'));
    if (!room) {
      return json({ error: 'code or room is required' }, 400);
    }

    const courseId = await canonicalizeCourseId(requestUrl.searchParams.get('courseId') || '');
    const access = await resolveLiveInviteTeacherAccess(
      (locals as any).session,
      courseId || '',
    );
    if (!access.canManage) {
      return json({ error: 'Only teachers can inspect room invites.' }, 403);
    }

    const invite = await getLatestLiveRoomInvite({
      inviteType: requestUrl.searchParams.get('inviteType'),
      room,
    });
    return json({ invite }, 200);
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Failed to load live invite.',
      },
      500,
    );
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const requestUrl = resolvePublicRequestUrl(request);
  const body = await request.json().catch(() => null);
  const payload = (body || {}) as Record<string, unknown>;
  const action = normalizeText(payload.action).toLowerCase() || 'create';
  const room = normalizeText(payload.room);
  const inviteType = normalizeLiveRoomInviteType(payload.inviteType);
  const courseId = await canonicalizeCourseId(payload.courseId || '');

  if (!room) {
    return json({ error: 'room is required' }, 400);
  }

  const access = await resolveLiveInviteTeacherAccess(
    (locals as any).session,
    courseId || '',
  );
  if (!access.canManage) {
    return json({ error: 'Only teachers can create live invites.' }, 403);
  }

  try {
    if (action === 'revoke') {
      const invite = await revokeLiveRoomInvite({
        code: payload.code,
        inviteType,
        room,
      });

      return json(
        {
          invite: null,
          revokedInvite: invite,
          revoked: Boolean(invite),
        },
        200,
      );
    }

    if (inviteType === 'external' && !normalizeText(payload.password) && !normalizeText(payload.code)) {
      return json({ error: 'password is required for external invites' }, 400);
    }

    const invite = await upsertLiveRoomInvite({
      courseId,
      createdByUserId: access.userId,
      displayName: payload.displayName,
      expiresAt: payload.expiresAt,
      inviteType,
      metadata: {},
      pageSlug: payload.pageSlug,
      password: payload.password,
      presentationHref: normalizeHref(payload.presentationHref, requestUrl),
      room,
    });

    const inviteUrl = new URL('/room', requestUrl.origin);
    inviteUrl.searchParams.set('invite', invite.code);

    return json(
      {
        invite,
        inviteUrl: inviteUrl.toString(),
      },
      200,
    );
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Failed to save live invite.',
      },
      500,
    );
  }
};
