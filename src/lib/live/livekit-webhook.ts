import { WebhookReceiver, type WebhookEvent } from 'livekit-server-sdk';
import { query } from '../db/pool';

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

const eventLogAlreadyStored = async (eventId: string) => {
  if (!eventId) return false;
  const { data, error } = await query(
    `SELECT "eventId" FROM "LiveKitWebhookEvent" WHERE "eventId" = $1`,
    [eventId]
  );

  if (error) throw error;
  return Boolean(data?.[0]?.eventId);
};

const storeEventLog = async (
  context: WebhookContext,
  rawPayload: Record<string, unknown>,
) => {
  const { error } = await query(
    `INSERT INTO "LiveKitWebhookEvent" (
      "eventId", "eventName", "roomSid", "roomName", "courseId", "pageSlug", 
      "participantSid", "participantIdentity", "participantName", "userId", 
      "role", "trackSid", "trackName", "createdAt", "payload"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      context.eventId,
      context.eventName,
      context.roomSid || null,
      context.roomName || null,
      context.courseId || null,
      context.pageSlug || null,
      context.participantSid || null,
      context.participantIdentity || null,
      context.participantName || null,
      context.userId || null,
      context.role,
      context.trackSid || null,
      context.trackName || null,
      context.eventAt,
      rawPayload,
    ]
  );

  if (error) throw error;
};

const ensureLiveClassSession = async (context: WebhookContext) => {
  if (!context.roomSid || !context.roomName) return null;

  const { data: existingRows, error: existingError } = await query(
    `SELECT id, "courseId", "pageSlug", "teacherUserId", "finishedAt" FROM "LiveClassSession" WHERE "livekitRoomSid" = $1`,
    [context.roomSid]
  );

  if (existingError) throw existingError;
  const existing = existingRows?.[0];

  const nextTeacherUserId =
    context.role === 'teacher' && context.userId
      ? context.userId
      : normalizeUuid(existing?.teacherUserId);

  if (!existing) {
    const { data: createdRows, error: createError } = await query(
      `INSERT INTO "LiveClassSession" (
        "livekitRoomSid", "roomName", "courseId", "pageSlug", 
        "teacherUserId", "startedAt", "lastEventAt", "finishedAt", "metadata"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        context.roomSid,
        context.roomName,
        context.courseId || null,
        context.pageSlug || null,
        nextTeacherUserId || null,
        context.eventAt,
        context.eventAt,
        context.eventName === 'room_finished' ? context.eventAt : null,
        { source: 'livekit-webhook' },
      ]
    );

    if (createError) throw createError;
    return normalizeText(createdRows?.[0]?.id);
  }

  const updateFields: string[] = ['"lastEventAt" = $1'];
  const params: any[] = [context.eventAt];

  if (!normalizeText(existing.courseId) && context.courseId) {
    params.push(context.courseId);
    updateFields.push(`"courseId" = $${params.length}`);
  }

  if (!normalizeText(existing.pageSlug) && context.pageSlug) {
    params.push(context.pageSlug);
    updateFields.push(`"pageSlug" = $${params.length}`);
  }

  if (!normalizeUuid(existing.teacherUserId) && nextTeacherUserId) {
    params.push(nextTeacherUserId);
    updateFields.push(`"teacherUserId" = $${params.length}`);
  }

  if (context.eventName === 'room_finished') {
    params.push(context.eventAt);
    updateFields.push(`"finishedAt" = $${params.length}`);
  }

  params.push(existing.id);
  const { error: updateError } = await query(
    `UPDATE "LiveClassSession" SET ${updateFields.join(', ')} WHERE id = $${params.length}`,
    params
  );

  if (updateError) throw updateError;
  return normalizeText(existing.id);
};

const upsertAttendance = async (
  sessionId: string,
  context: WebhookContext,
) => {
  if (!sessionId || !context.participantIdentity) return;

  const { data: existingRows, error: existingError } = await query(
    `SELECT id, "joinCount", "leaveCount", "abortedCount", "firstJoinedAt", "lastJoinedAt", "lastLeftAt", "lastStatus" 
     FROM "LiveClassAttendance" WHERE "sessionId" = $1 AND "identity" = $2`,
    [sessionId, context.participantIdentity]
  );

  if (existingError) throw existingError;
  const existing = existingRows?.[0];

  const isJoin = context.eventName === 'participant_joined';
  const isLeft = context.eventName === 'participant_left';
  const isAborted = context.eventName === 'participant_connection_aborted';

  if (!existing) {
    const { error: insertError } = await query(
      `INSERT INTO "LiveClassAttendance" (
        "sessionId", "userId", identity, "participantSid", name, role, 
        "courseId", "pageSlug", "firstJoinedAt", "lastJoinedAt", "lastLeftAt", 
        "joinCount", "leaveCount", "abortedCount", "lastStatus", "lastEventAt", metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        sessionId,
        context.userId || null,
        context.participantIdentity,
        context.participantSid || null,
        context.participantName || null,
        context.role,
        context.courseId || null,
        context.pageSlug || null,
        isJoin ? context.eventAt : null,
        isJoin ? context.eventAt : null,
        isLeft || isAborted ? context.eventAt : null,
        isJoin ? 1 : 0,
        isLeft ? 1 : 0,
        isAborted ? 1 : 0,
        isAborted ? 'aborted' : isLeft ? 'left' : isJoin ? 'joined' : 'pending',
        context.eventAt,
        { source: 'livekit-webhook' },
      ]
    );

    if (insertError) throw insertError;
    return;
  }

  const nextJoinCount = Number(existing.joinCount || 0) + (isJoin ? 1 : 0);
  const nextLeaveCount = Number(existing.leaveCount || 0) + (isLeft ? 1 : 0);
  const nextAbortedCount = Number(existing.abortedCount || 0) + (isAborted ? 1 : 0);

  const { error: updateError } = await query(
    `UPDATE "LiveClassAttendance" SET 
      "userId" = $1, "participantSid" = $2, name = $3, role = $4, "courseId" = $5, "pageSlug" = $6, 
      "firstJoinedAt" = $7, "lastJoinedAt" = $8, "lastLeftAt" = $9, "joinCount" = $10, 
      "leaveCount" = $11, "abortedCount" = $12, "lastStatus" = $13, "lastEventAt" = $14
    WHERE id = $15`,
    [
      context.userId || null,
      context.participantSid || null,
      context.participantName || null,
      context.role,
      context.courseId || null,
      context.pageSlug || null,
      normalizeText(existing.firstJoinedAt) || (isJoin ? context.eventAt : null),
      isJoin ? context.eventAt : existing.lastJoinedAt,
      isLeft || isAborted ? context.eventAt : existing.lastLeftAt,
      nextJoinCount,
      nextLeaveCount,
      nextAbortedCount,
      isAborted ? 'aborted' : isLeft ? 'left' : isJoin ? 'joined' : existing.lastStatus,
      context.eventAt,
      existing.id
    ]
  );

  if (updateError) throw updateError;
};

const finalizeOpenAttendanceRows = async (
  sessionId: string,
  eventAt: string,
) => {
  if (!sessionId) return;

  const { error } = await query(
    `UPDATE "LiveClassAttendance" SET "lastLeftAt" = $1, "lastEventAt" = $2, "lastStatus" = $3 
     WHERE "sessionId" = $4 AND "lastLeftAt" IS NULL`,
    [eventAt, eventAt, 'room_finished', sessionId]
  );

  if (error) throw error;
};

export const receiveLiveKitWebhook = async (rawBody: string, authHeader = '') => {
  const receiver = createReceiver();
  return receiver.receive(rawBody, authHeader || undefined);
};

export const persistLiveKitWebhook = async (event: WebhookEvent, rawBody: string) => {
  const context = getWebhookContext(event);
  const rawPayload = parsePayload(rawBody) as Record<string, unknown>;

  if (await eventLogAlreadyStored(context.eventId)) {
    return {
      duplicate: true,
      eventId: context.eventId,
      eventName: context.eventName,
      roomName: context.roomName,
    };
  }

  await storeEventLog(context, rawPayload);

  const sessionId = await ensureLiveClassSession(context);
  if (
    sessionId &&
    (context.eventName === 'participant_joined' ||
      context.eventName === 'participant_left' ||
      context.eventName === 'participant_connection_aborted')
  ) {
    await upsertAttendance(sessionId, context);
  }

  if (sessionId && context.eventName === 'room_finished') {
    await finalizeOpenAttendanceRows(sessionId, context.eventAt);
  }

  return {
    duplicate: false,
    eventId: context.eventId,
    eventName: context.eventName,
    roomName: context.roomName,
    sessionId,
  };
};
