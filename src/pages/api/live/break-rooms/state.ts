import type { APIRoute } from 'astro';
import { resolveLiveParticipantRole } from '../../../../lib/live/access';
import { setBreakRoomsState, getBreakRoomsState, clearBreakRoomsState, setBreakRoomsTerminating } from '../../../../lib/live/break-rooms-store.mjs';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// GET /api/live/break-rooms/state?room=X&courseId=Y
// Any authenticated course participant can fetch the state.
export const GET: APIRoute = async ({ url, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) return json({ error: 'Not authenticated' }, 401);

  const courseId = url.searchParams.get('courseId') ?? '';
  const room = (url.searchParams.get('room') ?? '').trim();
  if (!courseId || !room) return json({ error: 'courseId and room are required' }, 400);

  try {
    const role = await resolveLiveParticipantRole(session, courseId);
    if (!role) return json({ error: 'Not enrolled' }, 403);

    const state = getBreakRoomsState(room);
    return json({ state: state ?? null });
  } catch (err: any) {
    console.error('break-rooms/state GET error:', err?.message || err);
    return json({ error: 'Failed to load break rooms state' }, 500);
  }
};

// POST /api/live/break-rooms/state
// Teacher stores or clears break rooms state.
export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) return json({ error: 'Not authenticated' }, 401);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const courseId = String(body?.courseId || '').trim();
  const room = String(body?.room || '').trim();
  if (!courseId || !room) return json({ error: 'courseId and room are required' }, 400);

  try {
    const role = await resolveLiveParticipantRole(session, courseId);
    if (role !== 'teacher') return json({ error: 'Teachers only' }, 403);

    if (body?.clear === true) {
      clearBreakRoomsState(room);
      return json({ ok: true });
    }

    // Countdown started: mark existing state as terminating without clearing rooms
    if (body?.terminatingAt) {
      setBreakRoomsTerminating(room, Number(body.terminatingAt));
      return json({ ok: true });
    }

    const rooms = Array.isArray(body?.rooms) ? body.rooms : [];
    const assignments = body?.assignments && typeof body.assignments === 'object' ? body.assignments : {};
    const mode = String(body?.mode || '');

    setBreakRoomsState(room, { rooms, assignments, mode });
    return json({ ok: true });
  } catch (err: any) {
    console.error('break-rooms/state POST error:', err?.message || err);
    return json({ error: 'Failed to update break rooms state' }, 500);
  }
};
