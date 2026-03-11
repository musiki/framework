import { WebhookReceiver, type WebhookEvent } from 'livekit-server-sdk';
import { createSupabaseServerClient } from '../forum-server';

const normalizeText = (value: unknown) => String(value ?? '').trim();
const normalizeRole = (value: unknown) =>
  normalizeText(value).toLowerCase() === 'teacher' ? 'teacher' : 'student';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeUuid = (value: unknown) => {
  const normalized = normalizeText(value);
  return UUID_PATTERN.test(normalized) ? normalized : '';
};

const parseMetadata = (value: unknown) => {
  if (typeof value !== 'string') return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const parsePayload = (value: string) => {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const toIsoFromUnixSeconds = (value: unknown) => {
  const seconds = typeof value === 'bigint' ? Number(value) : Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return new Date().toISOString();
  }
  return new Date(seconds * 1000).toISOString();
};

const createReceiver = () => {
  const apiKey = normalizeText(import.meta.env.LIVEKIT_API_KEY);
  const apiSecret = normalizeText(import.meta.env.LIVEKIT_API_SECRET);

  if (!apiKey || !apiSecret) {
    throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required for webhook validation.');
  }

  return new WebhookReceiver(apiKey, apiSecret);
};

type WebhookContext = {
  courseId: string;
  eventAt: string;
  eventId: string;
  eventName: string;
  pageSlug: string;
  participantIdentity: string;
  participantName: string;
  participantSid: string;
  role: 'teacher' | 'student';
  roomName: string;
  roomSid: string;
  trackName: string;
  trackSid: string;
  userId: string;
};

const getWebhookContext = (event: WebhookEvent): WebhookContext => {
  const participantMetadata = parseMetadata(event.participant?.metadata);
  const roomMetadata = parseMetadata(event.room?.metadata);

  return {
    courseId: normalizeText(participantMetadata.courseId || roomMetadata.courseId),
    eventAt: toIsoFromUnixSeconds(event.createdAt),
    eventId: normalizeText(event.id),
    eventName: normalizeText(event.event),
    pageSlug: normalizeText(participantMetadata.pageSlug || roomMetadata.pageSlug),
    participantIdentity: normalizeText(event.participant?.identity),
    participantName: normalizeText(event.participant?.name),
    participantSid: normalizeText(event.participant?.sid),
    role: normalizeRole(participantMetadata.role),
    roomName: normalizeText(event.room?.name),
    roomSid: normalizeText(event.room?.sid),
    trackName: normalizeText(event.track?.name),
    trackSid: normalizeText(event.track?.sid),
    userId: normalizeUuid(participantMetadata.userId),
  };
};

const eventLogAlreadyStored = async (
  supabase: ReturnType<typeof createSupabaseServerClient>,
  eventId: string,
) => {
  if (!eventId) return false;
  const { data, error } = await supabase
    .from('LiveKitWebhookEvent')
    .select('eventId')
    .eq('eventId', eventId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.eventId);
};

const storeEventLog = async (
  supabase: ReturnType<typeof createSupabaseServerClient>,
  event: WebhookEvent,
  context: WebhookContext,
  rawPayload: Record<string, unknown>,
) => {
  const { error } = await supabase.from('LiveKitWebhookEvent').insert([
    {
      eventId: context.eventId,
      eventName: context.eventName,
      roomSid: context.roomSid || null,
      roomName: context.roomName || null,
      courseId: context.courseId || null,
      pageSlug: context.pageSlug || null,
      participantSid: context.participantSid || null,
      participantIdentity: context.participantIdentity || null,
      participantName: context.participantName || null,
      userId: context.userId || null,
      role: context.role,
      trackSid: context.trackSid || null,
      trackName: context.trackName || null,
      createdAt: context.eventAt,
      payload: rawPayload,
    },
  ]);

  if (error) throw error;
};

const ensureLiveClassSession = async (
  supabase: ReturnType<typeof createSupabaseServerClient>,
  context: WebhookContext,
) => {
  if (!context.roomSid || !context.roomName) return null;

  const { data: existing, error: existingError } = await supabase
    .from('LiveClassSession')
    .select('id, courseId, pageSlug, teacherUserId, finishedAt')
    .eq('livekitRoomSid', context.roomSid)
    .maybeSingle();

  if (existingError) throw existingError;

  const nextTeacherUserId =
    context.role === 'teacher' && context.userId
      ? context.userId
      : normalizeUuid(existing?.teacherUserId);

  if (!existing) {
    const { data: created, error: createError } = await supabase
      .from('LiveClassSession')
      .insert([
        {
          livekitRoomSid: context.roomSid,
          roomName: context.roomName,
          courseId: context.courseId || null,
          pageSlug: context.pageSlug || null,
          teacherUserId: nextTeacherUserId || null,
          startedAt: context.eventAt,
          lastEventAt: context.eventAt,
          finishedAt: context.eventName === 'room_finished' ? context.eventAt : null,
          metadata: {
            source: 'livekit-webhook',
          },
        },
      ])
      .select('id')
      .single();

    if (createError) throw createError;
    return normalizeText(created?.id);
  }

  const updatePayload: Record<string, unknown> = {
    lastEventAt: context.eventAt,
  };

  if (!normalizeText(existing.courseId) && context.courseId) {
    updatePayload.courseId = context.courseId;
  }

  if (!normalizeText(existing.pageSlug) && context.pageSlug) {
    updatePayload.pageSlug = context.pageSlug;
  }

  if (!normalizeUuid(existing.teacherUserId) && nextTeacherUserId) {
    updatePayload.teacherUserId = nextTeacherUserId;
  }

  if (context.eventName === 'room_finished') {
    updatePayload.finishedAt = context.eventAt;
  }

  const { error: updateError } = await supabase
    .from('LiveClassSession')
    .update(updatePayload)
    .eq('id', existing.id);

  if (updateError) throw updateError;
  return normalizeText(existing.id);
};

const upsertAttendance = async (
  supabase: ReturnType<typeof createSupabaseServerClient>,
  sessionId: string,
  context: WebhookContext,
) => {
  if (!sessionId || !context.participantIdentity) return;

  const { data: existing, error: existingError } = await supabase
    .from('LiveClassAttendance')
    .select(
      'id, joinCount, leaveCount, abortedCount, firstJoinedAt, lastJoinedAt, lastLeftAt, lastStatus',
    )
    .eq('sessionId', sessionId)
    .eq('identity', context.participantIdentity)
    .maybeSingle();

  if (existingError) throw existingError;

  const isJoin = context.eventName === 'participant_joined';
  const isLeft = context.eventName === 'participant_left';
  const isAborted = context.eventName === 'participant_connection_aborted';

  if (!existing) {
    const { error: insertError } = await supabase.from('LiveClassAttendance').insert([
      {
        sessionId,
        userId: context.userId || null,
        identity: context.participantIdentity,
        participantSid: context.participantSid || null,
        name: context.participantName || null,
        role: context.role,
        courseId: context.courseId || null,
        pageSlug: context.pageSlug || null,
        firstJoinedAt: isJoin ? context.eventAt : null,
        lastJoinedAt: isJoin ? context.eventAt : null,
        lastLeftAt: isLeft || isAborted ? context.eventAt : null,
        joinCount: isJoin ? 1 : 0,
        leaveCount: isLeft ? 1 : 0,
        abortedCount: isAborted ? 1 : 0,
        lastStatus: isAborted ? 'aborted' : isLeft ? 'left' : isJoin ? 'joined' : 'pending',
        lastEventAt: context.eventAt,
        metadata: {
          source: 'livekit-webhook',
        },
      },
    ]);

    if (insertError) throw insertError;
    return;
  }

  const nextJoinCount = Number(existing.joinCount || 0) + (isJoin ? 1 : 0);
  const nextLeaveCount = Number(existing.leaveCount || 0) + (isLeft ? 1 : 0);
  const nextAbortedCount = Number(existing.abortedCount || 0) + (isAborted ? 1 : 0);

  const { error: updateError } = await supabase
    .from('LiveClassAttendance')
    .update({
      userId: context.userId || null,
      participantSid: context.participantSid || null,
      name: context.participantName || null,
      role: context.role,
      courseId: context.courseId || null,
      pageSlug: context.pageSlug || null,
      firstJoinedAt: normalizeText(existing.firstJoinedAt) || (isJoin ? context.eventAt : null),
      lastJoinedAt: isJoin ? context.eventAt : existing.lastJoinedAt,
      lastLeftAt: isLeft || isAborted ? context.eventAt : existing.lastLeftAt,
      joinCount: nextJoinCount,
      leaveCount: nextLeaveCount,
      abortedCount: nextAbortedCount,
      lastStatus: isAborted ? 'aborted' : isLeft ? 'left' : isJoin ? 'joined' : existing.lastStatus,
      lastEventAt: context.eventAt,
    })
    .eq('id', existing.id);

  if (updateError) throw updateError;
};

const finalizeOpenAttendanceRows = async (
  supabase: ReturnType<typeof createSupabaseServerClient>,
  sessionId: string,
  eventAt: string,
) => {
  if (!sessionId) return;

  const { error } = await supabase
    .from('LiveClassAttendance')
    .update({
      lastLeftAt: eventAt,
      lastEventAt: eventAt,
      lastStatus: 'room_finished',
    })
    .eq('sessionId', sessionId)
    .is('lastLeftAt', null);

  if (error) throw error;
};

export const receiveLiveKitWebhook = async (rawBody: string, authHeader = '') => {
  const receiver = createReceiver();
  return receiver.receive(rawBody, authHeader || undefined);
};

export const persistLiveKitWebhook = async (event: WebhookEvent, rawBody: string) => {
  const supabase = createSupabaseServerClient({ requireServiceRole: true });
  const context = getWebhookContext(event);
  const rawPayload = parsePayload(rawBody) as Record<string, unknown>;

  if (await eventLogAlreadyStored(supabase, context.eventId)) {
    return {
      duplicate: true,
      eventId: context.eventId,
      eventName: context.eventName,
      roomName: context.roomName,
    };
  }

  await storeEventLog(supabase, event, context, rawPayload);

  const sessionId = await ensureLiveClassSession(supabase, context);
  if (
    sessionId &&
    (context.eventName === 'participant_joined' ||
      context.eventName === 'participant_left' ||
      context.eventName === 'participant_connection_aborted')
  ) {
    await upsertAttendance(supabase, sessionId, context);
  }

  if (sessionId && context.eventName === 'room_finished') {
    await finalizeOpenAttendanceRows(supabase, sessionId, context.eventAt);
  }

  return {
    duplicate: false,
    eventId: context.eventId,
    eventName: context.eventName,
    roomName: context.roomName,
    sessionId,
  };
};
