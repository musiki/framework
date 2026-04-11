export const COURSE_AGENDA_CONFIG_META_KIND = 'course_agenda_config';
export const COURSE_AGENDA_STUDENT_META_KIND = 'course_agenda_student';
export const COURSE_AGENDA_EVENTS_META_KIND = 'course_agenda_events';

export const COURSE_AGENDA_CONFIG_PREFIX = '__meta__:course-agenda-config';
export const COURSE_AGENDA_STUDENT_PREFIX = '__meta__:course-agenda-student';
export const COURSE_AGENDA_EVENTS_PREFIX = '__meta__:course-agenda-events';

export type AgendaConfig = {
  courseId: string;
  year: string;
  startTime: string;
  endTime: string;
  teacherSlotMinutes: number;
  studentSlotMinutes: number;
  maxStudentMinutes: number;
  minMeetings: number;
  comment: string;
  updatedAt: string;
};

export type AgendaBlock = {
  id: string;
  dateKey: string;
  startMinute: number;
  endMinute: number;
  comment: string;
  updatedAt: string;
};

export type AgendaStudentPayload = {
  courseId: string;
  year: string;
  studentId: string;
  color: string;
  blocks: AgendaBlock[];
  updatedAt: string;
};

export type AgendaEvent = {
  id: string;
  dateKey: string;
  startMinute: number;
  endMinute: number;
  text: string;
  color: string;
  virtual?: boolean;
  updatedAt: string;
};

export type AgendaEventsPayload = {
  courseId: string;
  year: string;
  events: AgendaEvent[];
  updatedAt: string;
};

export const AGENDA_DEFAULT_START_TIME = '09:00';
export const AGENDA_DEFAULT_END_TIME = '18:00';
export const AGENDA_DEFAULT_SLOT_MINUTES = 30;
export const AGENDA_DEFAULT_MAX_STUDENT_MINUTES = 60;
export const AGENDA_DEFAULT_MIN_MEETINGS = 0;
export const AGENDA_DEFAULT_COMMENT = '';

const AGENDA_EVENT_PALETTE = [
  '#f2d0a9',
  '#d8e2dc',
  '#cddafd',
  '#d7e3fc',
  '#f7cad0',
  '#cdeac0',
  '#f9dcc4',
  '#e2ece9',
  '#fff1c1',
  '#cfe1b9',
];

const AGENDA_STUDENT_PALETTE = [
  '#ffb4a2',
  '#a2d2ff',
  '#bde0fe',
  '#cdb4db',
  '#90dbf4',
  '#98f5e1',
  '#ffd6a5',
  '#fdffb6',
  '#b9fbc0',
  '#a9def9',
];

export const normalizeText = (value: unknown) => String(value || '').trim();

export const normalizeAgendaCourseId = (value: unknown) => {
  const raw = normalizeText(value);
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

export const normalizeAgendaYear = (value: unknown) => {
  const raw = normalizeText(value);
  return /^\d{4}$/.test(raw) ? raw : String(new Date().getFullYear());
};

export const normalizeAgendaDateKey = (value: unknown) => {
  const raw = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
};

export const clampAgendaSlotMinutes = (value: unknown) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return AGENDA_DEFAULT_SLOT_MINUTES;
  const clamped = Math.max(5, Math.min(180, parsed));
  const snapped = Math.round(clamped / 5) * 5;
  return snapped > 0 ? snapped : AGENDA_DEFAULT_SLOT_MINUTES;
};

export const clampAgendaMaxStudentMinutes = (value: unknown) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return AGENDA_DEFAULT_MAX_STUDENT_MINUTES;
  return Math.max(15, Math.min(600, parsed));
};

export const clampAgendaMinMeetings = (value: unknown) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return AGENDA_DEFAULT_MIN_MEETINGS;
  return Math.max(0, Math.min(60, parsed));
};

export const timeStringToMinutes = (value: unknown, fallback = AGENDA_DEFAULT_START_TIME) => {
  const raw = normalizeText(value || fallback);
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return timeStringToMinutes(fallback, fallback);
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return timeStringToMinutes(fallback, fallback);
  const safeHours = Math.max(0, Math.min(23, hours));
  const safeMinutes = Math.max(0, Math.min(59, minutes));
  return safeHours * 60 + safeMinutes;
};

export const minutesToTimeString = (value: unknown, fallback = AGENDA_DEFAULT_START_TIME) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  const safe = Math.max(0, Math.min(23 * 60 + 59, parsed));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

export const normalizeAgendaTimeString = (value: unknown, fallback = AGENDA_DEFAULT_START_TIME) =>
  minutesToTimeString(timeStringToMinutes(value, fallback), fallback);

export const normalizeAgendaComment = (value: unknown, maxLength = 50) =>
  normalizeText(value)
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);

export const normalizeAgendaEventText = (value: unknown, maxLength = 120) =>
  normalizeText(value)
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);

export const normalizeAgendaHexColor = (value: unknown, fallback = '#a2d2ff') => {
  const raw = normalizeText(value);
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  return fallback.toLowerCase();
};

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
};

export const buildAgendaStudentColor = (seed: unknown) => {
  const normalized = normalizeText(seed) || 'student';
  return AGENDA_STUDENT_PALETTE[hashString(normalized) % AGENDA_STUDENT_PALETTE.length];
};

const AGENDA_MUTED_EVENT_TEXTS = new Set(['feriado', 'paro']);

export const buildAgendaEventColor = (seed: unknown) => {
  const normalized = normalizeText(seed) || 'evento';
  if (AGENDA_MUTED_EVENT_TEXTS.has(normalized.toLowerCase())) return '#b8bcc8';
  return AGENDA_EVENT_PALETTE[hashString(normalized.toLowerCase()) % AGENDA_EVENT_PALETTE.length];
};

export const isMutedAgendaEvent = (text: unknown) =>
  AGENDA_MUTED_EVENT_TEXTS.has(normalizeText(text).toLowerCase());

export const buildAgendaDefaultConfig = (courseId: string, year: string): AgendaConfig => ({
  courseId,
  year,
  startTime: AGENDA_DEFAULT_START_TIME,
  endTime: AGENDA_DEFAULT_END_TIME,
  teacherSlotMinutes: AGENDA_DEFAULT_SLOT_MINUTES,
  studentSlotMinutes: AGENDA_DEFAULT_SLOT_MINUTES,
  maxStudentMinutes: AGENDA_DEFAULT_MAX_STUDENT_MINUTES,
  minMeetings: AGENDA_DEFAULT_MIN_MEETINGS,
  comment: AGENDA_DEFAULT_COMMENT,
  updatedAt: '',
});

export const buildAgendaConfigAssignmentId = (courseId: string, year: string) =>
  `${COURSE_AGENDA_CONFIG_PREFIX}:${encodeURIComponent(courseId)}:${year}`;

export const buildAgendaStudentAssignmentId = (courseId: string, year: string) =>
  `${COURSE_AGENDA_STUDENT_PREFIX}:${encodeURIComponent(courseId)}:${year}`;

export const buildAgendaEventsAssignmentId = (courseId: string, year: string) =>
  `${COURSE_AGENDA_EVENTS_PREFIX}:${encodeURIComponent(courseId)}:${year}`;

export const createAgendaBlockId = () => `agenda_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

export const normalizeAgendaBlock = (value: any): AgendaBlock | null => {
  const dateKey = normalizeAgendaDateKey(value?.dateKey);
  const startMinute = Number.parseInt(String(value?.startMinute ?? ''), 10);
  const endMinute = Number.parseInt(String(value?.endMinute ?? ''), 10);
  if (!dateKey || !Number.isFinite(startMinute) || !Number.isFinite(endMinute)) return null;
  if (endMinute <= startMinute) return null;
  return {
    id: normalizeText(value?.id) || createAgendaBlockId(),
    dateKey,
    startMinute: Math.max(0, startMinute),
    endMinute: Math.min(24 * 60, endMinute),
    comment: normalizeAgendaComment(value?.comment, 280),
    updatedAt: normalizeText(value?.updatedAt),
  };
};

export const sortAgendaBlocks = (blocks: AgendaBlock[]) =>
  [...(blocks || [])].sort((left, right) => {
    if (left.dateKey !== right.dateKey) return left.dateKey.localeCompare(right.dateKey, 'es');
    if (left.startMinute !== right.startMinute) return left.startMinute - right.startMinute;
    if (left.endMinute !== right.endMinute) return left.endMinute - right.endMinute;
    return left.id.localeCompare(right.id, 'es');
  });

export const dedupeAgendaBlocks = (blocks: AgendaBlock[]) => {
  const deduped = new Map<string, AgendaBlock>();
  sortAgendaBlocks(blocks).forEach((block) => {
    const key = `${block.dateKey}::${block.startMinute}::${block.endMinute}::${block.id}`;
    deduped.set(key, block);
  });
  return Array.from(deduped.values());
};

export const getAgendaBlockDurationMinutes = (block: AgendaBlock) =>
  Math.max(0, Number(block.endMinute || 0) - Number(block.startMinute || 0));

export const normalizeAgendaConfigPayload = (payload: any, courseId: string, year: string): AgendaConfig => {
  const base = buildAgendaDefaultConfig(courseId, year);
  const teacherSlotMinutes = clampAgendaSlotMinutes(payload?.teacherSlotMinutes ?? payload?.slotMinutes);
  const studentSlotMinutes = clampAgendaSlotMinutes(payload?.studentSlotMinutes ?? payload?.slotMinutes);
  const startTime = normalizeAgendaTimeString(payload?.startTime, base.startTime);
  const endTimeCandidate = normalizeAgendaTimeString(payload?.endTime, base.endTime);
  let endTime = endTimeCandidate;
  if (timeStringToMinutes(endTime) <= timeStringToMinutes(startTime)) {
    endTime = minutesToTimeString(
      timeStringToMinutes(startTime) + Math.min(teacherSlotMinutes, studentSlotMinutes),
    );
  }

  return {
    courseId,
    year,
    startTime,
    endTime,
    teacherSlotMinutes,
    studentSlotMinutes,
    maxStudentMinutes: clampAgendaMaxStudentMinutes(payload?.maxStudentMinutes ?? payload?.assignedMinutes),
    minMeetings: clampAgendaMinMeetings(payload?.minMeetings),
    comment: normalizeAgendaComment(payload?.comment, 50),
    updatedAt: normalizeText(payload?.updatedAt),
  };
};

export const normalizeAgendaStudentPayload = (
  payload: any,
  courseId: string,
  year: string,
  fallbackStudentId = '',
): AgendaStudentPayload | null => {
  const studentId = normalizeText(payload?.studentId || fallbackStudentId);
  if (!studentId) return null;
  const blocks = dedupeAgendaBlocks(
    (Array.isArray(payload?.blocks) ? payload.blocks : [])
      .map((block) => normalizeAgendaBlock(block))
      .filter((block): block is AgendaBlock => Boolean(block)),
  );

  return {
    courseId,
    year,
    studentId,
    color: normalizeAgendaHexColor(payload?.color, buildAgendaStudentColor(studentId)),
    blocks,
    updatedAt: normalizeText(payload?.updatedAt),
  };
};

export const normalizeAgendaEventsPayload = (payload: any, courseId: string, year: string): AgendaEventsPayload => {
  const events = (Array.isArray(payload?.events) ? payload.events : [])
    .map((event) => {
      const block = normalizeAgendaBlock(event);
      if (!block) return null;
      const text = normalizeAgendaEventText(event?.text, 120);
      if (!text) return null;
      return {
        ...block,
        text,
        color: isMutedAgendaEvent(text) ? buildAgendaEventColor(text) : normalizeAgendaHexColor(event?.color, buildAgendaEventColor(text)),
        virtual: Boolean(event?.virtual),
      } as AgendaEvent;
    })
    .filter((event): event is AgendaEvent => Boolean(event));

  return {
    courseId,
    year,
    events: events.sort((left, right) => {
      if (left.dateKey !== right.dateKey) return left.dateKey.localeCompare(right.dateKey, 'es');
      if (left.startMinute !== right.startMinute) return left.startMinute - right.startMinute;
      return left.text.localeCompare(right.text, 'es');
    }),
    updatedAt: normalizeText(payload?.updatedAt),
  };
};

export const sumAgendaBlocksMinutes = (blocks: AgendaBlock[]) =>
  (blocks || []).reduce((total, block) => total + getAgendaBlockDurationMinutes(block), 0);

export const countAgendaMeetingDays = (blocks: AgendaBlock[]) =>
  new Set(
    (blocks || [])
      .map((block) => normalizeAgendaDateKey(block?.dateKey))
      .filter(Boolean),
  ).size;

export const buildAgendaShareUrlPath = (courseId: string, year: string) => {
  const params = new URLSearchParams();
  if (courseId) params.set('course', courseId);
  if (year) params.set('year', year);
  return `/dashboard?${params.toString()}#student-agenda`;
};
