import type { APIRoute } from 'astro';
import { clearLiveRoomPresence, upsertLiveRoomPresence } from '../../../lib/live/server-store.mjs';
import { resolveLiveParticipantRole } from '../../../lib/live/access';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });

const normalizeText = (value: unknown) => String(value ?? '').trim();

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

export const POST: APIRoute = async ({ request, locals }) => {
  const requestUrl = new URL(request.url);
  const body = await request.json().catch(() => null);
  const action = normalizeText((body as Record<string, unknown> | null)?.action).toLowerCase();
  const courseId = normalizeText((body as Record<string, unknown> | null)?.courseId);
  const presenceId = normalizeText((body as Record<string, unknown> | null)?.presenceId);

  if (!presenceId) {
    return json({ error: 'presenceId is required' }, 400);
  }

  if (!courseId) {
    return json({ error: 'courseId is required' }, 400);
  }

  const session = (locals as App.Locals).session;
  const role = await resolveLiveParticipantRole(session, courseId);
  if (role !== 'teacher') {
    return json({ error: 'Only teachers can announce a live room' }, 403);
  }

  if (action === 'stop') {
    return json(clearLiveRoomPresence({ presenceId, courseId }));
  }

  const room = normalizeText((body as Record<string, unknown> | null)?.room);
  if (!room) {
    return json({ error: 'room is required' }, 400);
  }

  const href = normalizeHref((body as Record<string, unknown> | null)?.href, requestUrl);
  const presentationHref = normalizeHref(
    (body as Record<string, unknown> | null)?.presentationHref,
    requestUrl,
  );

  const payload = upsertLiveRoomPresence({
    courseId,
    href,
    identity: normalizeText((body as Record<string, unknown> | null)?.identity),
    name: normalizeText((body as Record<string, unknown> | null)?.name),
    pageSlug: normalizeText((body as Record<string, unknown> | null)?.pageSlug),
    presenceId,
    presentationHref,
    room,
  });

  if (!payload) {
    return json({ error: 'Could not register live room presence' }, 400);
  }

  return json(payload);
};
