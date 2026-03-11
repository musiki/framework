import { formatCountdown, getRemainingMs } from '../live/countdown.mjs';

const asText = (value, fallback = '') => {
  if (typeof value === 'string') {
    const cleaned = value.trim();
    return cleaned || fallback;
  }
  if (value === undefined || value === null) return fallback;
  return String(value).trim() || fallback;
};

const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

const asObject = (value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null;

const toKey = (value) => asText(value).toLowerCase();

export const normalizeActivityPageSlug = (value) => {
  const raw = asText(value).replace(/^\/+|\/+$/g, '');
  if (!raw) return '';

  const parts = raw
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });

  if (parts[0] === 'cursos' && parts[1] === 'slides' && parts.length >= 3) {
    return parts.slice(2).join('/');
  }

  if (parts[0] === 'cursos' && parts.length >= 2) {
    return parts.slice(1).join('/');
  }

  return parts.join('/');
};

const getTimestamp = (...values) => {
  for (const value of values) {
    const parsed = new Date(String(value || '')).getTime();
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
};

export const buildInteractionHref = ({ sessionId = '', courseId = '' } = {}) => {
  const normalizedSessionId = asText(sessionId);
  if (!normalizedSessionId) return '';

  const url = new URL(`/live/${encodeURIComponent(normalizedSessionId)}`, 'http://local');
  const normalizedCourseId = asText(courseId);
  if (normalizedCourseId) {
    url.searchParams.set('courseId', normalizedCourseId);
  }

  return `${url.pathname}${url.search}`;
};

export const buildClassActivitySnapshot = (input = {}) => {
  const source = asObject(input) || {};
  const existingRoom = asObject(source.room);
  const existingInteraction = asObject(source.interaction);
  const sourceRoom = existingRoom || asObject(source.roomLive) || {};
  const sourceInteraction = existingInteraction || source;

  const courseId = asText(
    source.courseId
      || sourceRoom.courseId
      || sourceInteraction.courseId,
  );

  const roomPageSlug = normalizeActivityPageSlug(sourceRoom.pageSlug);
  const interactionPageSlug = normalizeActivityPageSlug(sourceInteraction.pageSlug);

  const room = {
    active: Boolean(sourceRoom.active && asText(sourceRoom.presenceId || sourceRoom.room || sourceRoom.href)),
    teacherPresent: Boolean(sourceRoom.active && asText(sourceRoom.presenceId || sourceRoom.room || sourceRoom.href)),
    courseId: asText(sourceRoom.courseId || courseId),
    pageSlug: roomPageSlug,
    href: asText(sourceRoom.href),
    presentationHref: asText(sourceRoom.presentationHref),
    room: asText(sourceRoom.room),
    identity: asText(sourceRoom.identity),
    name: asText(sourceRoom.name),
    presenceId: asText(sourceRoom.presenceId),
    startedAt: asText(sourceRoom.startedAt) || null,
    updatedAt: asText(sourceRoom.updatedAt) || null,
  };

  const interactionActive = Boolean(
    sourceInteraction.active
    && asText(sourceInteraction.sessionId || sourceInteraction.interactionId),
  );

  const interaction = {
    active: interactionActive,
    courseId: asText(sourceInteraction.courseId || courseId),
    pageSlug: interactionPageSlug,
    sessionId: asText(sourceInteraction.sessionId),
    interactionId: asText(sourceInteraction.interactionId),
    type: asText(sourceInteraction.type),
    prompt: asText(sourceInteraction.prompt),
    startedAt: asText(sourceInteraction.startedAt) || null,
    endsAt: asText(sourceInteraction.endsAt) || null,
    timed: Boolean(sourceInteraction.timed || sourceInteraction.endsAt),
    totalResponses: Math.max(0, Math.round(asNumber(sourceInteraction.totalResponses, 0))),
    optionCounts: asObject(sourceInteraction.optionCounts) || {},
    wordCounts: asObject(sourceInteraction.wordCounts) || {},
  };

  const updatedAtTs = Math.max(
    getTimestamp(room.updatedAt, room.startedAt),
    getTimestamp(interaction.startedAt, interaction.endsAt),
  );

  return {
    kind: 'class-activity',
    courseId,
    updatedAt: updatedAtTs ? new Date(updatedAtTs).toISOString() : null,
    room,
    interaction,
  };
};

const matchesCourse = (activityCourseId, courseId) => {
  const expected = toKey(courseId);
  if (!expected) return true;
  return toKey(activityCourseId) === expected;
};

const matchesPage = (activityPageSlug, pageSlug, requirePageMatch = false) => {
  const expected = normalizeActivityPageSlug(pageSlug);
  if (!expected) return true;
  if (!activityPageSlug) return !requirePageMatch;
  return activityPageSlug === expected;
};

export const selectRoomBeaconState = (snapshot, context = {}) => {
  const activity = buildClassActivitySnapshot(snapshot);
  const room = activity.room;
  const visible = Boolean(
    room.active
    && room.teacherPresent
    && matchesCourse(room.courseId || activity.courseId, context.courseId)
    && matchesPage(room.pageSlug, context.pageSlug, Boolean(context.requirePageMatch)),
  );

  const href = asText(room.href || context.fallbackHref);
  const titleParts = ['Clase en vivo'];
  if (room.name) titleParts.push(room.name);
  if (room.pageSlug) titleParts.push(room.pageSlug);

  return {
    visible,
    href,
    pageSlug: room.pageSlug,
    courseId: room.courseId || activity.courseId,
    title: titleParts.join(' · '),
  };
};

export const selectInteractionBeaconState = (snapshot, context = {}) => {
  const activity = buildClassActivitySnapshot(snapshot);
  const interaction = activity.interaction;
  const visible = Boolean(
    interaction.active
    && interaction.sessionId
    && matchesCourse(interaction.courseId || activity.courseId, context.courseId)
    && matchesPage(interaction.pageSlug, context.pageSlug, Boolean(context.requirePageMatch)),
  );

  const remainingMs = interaction.endsAt ? getRemainingMs(interaction.endsAt, Date.now()) : null;
  const timed = remainingMs !== null;
  const closing = timed && remainingMs <= 10_000;
  const href = buildInteractionHref({
    sessionId: interaction.sessionId,
    courseId: interaction.courseId || activity.courseId,
  });

  const titleParts = ['Interacción en vivo'];
  if (interaction.prompt) titleParts.push(interaction.prompt);
  if (timed && remainingMs !== null) titleParts.push(formatCountdown(remainingMs));

  return {
    visible,
    href,
    pageSlug: interaction.pageSlug,
    courseId: interaction.courseId || activity.courseId,
    remainingMs,
    timed,
    closing,
    timerLabel: timed && remainingMs !== null ? formatCountdown(remainingMs) : '',
    title: titleParts.join(' · '),
  };
};

export const selectLessonActivityState = (snapshot, context = {}) => ({
  room: selectRoomBeaconState(snapshot, {
    ...context,
    requirePageMatch: true,
  }),
  interaction: selectInteractionBeaconState(snapshot, {
    ...context,
    requirePageMatch: true,
  }),
});
