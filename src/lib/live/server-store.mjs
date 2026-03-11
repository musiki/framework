const STORE_KEY = '__musiki_live_store__';
const MAX_UNTIMED_INTERACTION_MS = 3 * 60 * 60 * 1000;
const MAX_RECENT_SNAPSHOT_MS = 12 * 60 * 60 * 1000;
const ROOM_PRESENCE_TTL_MS = 25_000;

const nowIso = () => new Date().toISOString();

const asText = (value, fallback = '') => {
  if (typeof value === 'string') {
    const cleaned = value.trim();
    return cleaned || fallback;
  }
  if (value === undefined || value === null) return fallback;
  return String(value).trim() || fallback;
};

const asBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'si', 'sí', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
};

const asPositiveInteger = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.round(parsed));
};

const ensureStore = () => {
  if (!globalThis[STORE_KEY]) {
    globalThis[STORE_KEY] = {};
  }

  const store = globalThis[STORE_KEY];
  if (!(store.interactions instanceof Map)) store.interactions = new Map();
  if (!(store.listeners instanceof Map)) store.listeners = new Map();
  if (!(store.roomPresences instanceof Map)) store.roomPresences = new Map();
  if (!(store.roomTimeouts instanceof Map)) store.roomTimeouts = new Map();
  if (!(store.timeouts instanceof Map)) store.timeouts = new Map();
  if (!(store.recentSnapshots instanceof Map)) store.recentSnapshots = new Map();

  return store;
};

const clearInteractionTimeout = (sessionId) => {
  const store = ensureStore();
  const timerId = store.timeouts.get(sessionId);
  if (!timerId) return;
  clearTimeout(timerId);
  store.timeouts.delete(sessionId);
};

const clearRoomPresenceTimeout = (presenceId) => {
  const store = ensureStore();
  const timerId = store.roomTimeouts.get(presenceId);
  if (!timerId) return;
  clearTimeout(timerId);
  store.roomTimeouts.delete(presenceId);
};

const pruneRecentSnapshots = () => {
  const store = ensureStore();
  const now = Date.now();
  for (const [sessionId, entry] of store.recentSnapshots.entries()) {
    const storedAt = Number(entry?.storedAt || 0);
    if (!Number.isFinite(storedAt) || now - storedAt > MAX_RECENT_SNAPSHOT_MS) {
      store.recentSnapshots.delete(sessionId);
    }
  }
};

const getTimestamp = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getTime();
};

const normalizeOptions = (options) => {
  if (!Array.isArray(options)) return [];
  return options
    .map((option, index) => {
      if (typeof option === 'string') {
        const text = option.trim();
        if (!text) return null;
        return { id: `opt-${index + 1}`, text };
      }
      if (!option || typeof option !== 'object') return null;
      const text = asText(option.text || option.label || option.value);
      if (!text) return null;
      return { id: asText(option.id, `opt-${index + 1}`), text };
    })
    .filter(Boolean);
};

const ensureArrayAnswer = (value, allowMultiple) => {
  if (allowMultiple) {
    if (Array.isArray(value)) {
      return Array.from(new Set(value.map((item) => asText(item)).filter(Boolean))).sort();
    }
    const text = asText(value);
    return text ? [text] : [];
  }

  const selected = Array.isArray(value) ? value[0] : value;
  const text = asText(selected);
  return text ? [text] : [];
};

const normalizeWordLabel = (value) =>
  asText(value)
    .replace(/\s+/g, ' ')
    .trim();

const normalizeWordKey = (value) =>
  normalizeWordLabel(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

const parseWordTermsFromText = (value) => {
  const normalized = normalizeWordLabel(value);
  if (!normalized) return [];

  const chunks = normalized
    .split(/[,\n;]+/g)
    .map((chunk) => normalizeWordLabel(chunk))
    .filter(Boolean);

  if (chunks.length === 0) return [];

  const seen = new Set();
  const output = [];
  for (const chunk of chunks) {
    const key = normalizeWordKey(chunk);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push({ key, term: chunk });
  }
  return output;
};

const normalizeWordcloudAnswer = (value) => {
  if (value === undefined || value === null) return null;

  let text = '';
  let suggestionId = '';
  let rawTerms = [];

  if (Array.isArray(value)) {
    const first = value[0];
    text = asText(first);
  } else if (typeof value === 'object') {
    text = asText(value.text || value.value || value.word || value.term);
    suggestionId = asText(value.suggestionId || value.optionId || value.option);
    if (Array.isArray(value.terms)) {
      rawTerms = value.terms.map((item) => asText(item)).filter(Boolean);
    }
  } else {
    text = asText(value);
  }

  const fromText = parseWordTermsFromText(text);
  const fromTerms = rawTerms.flatMap((item) => parseWordTermsFromText(item));
  const merged = [...fromTerms, ...fromText];
  if (merged.length === 0) return null;

  const deduped = [];
  const seen = new Set();
  for (const term of merged) {
    if (!term?.key || seen.has(term.key)) continue;
    seen.add(term.key);
    deduped.push(term);
  }

  const normalizedText = normalizeWordLabel(text) || deduped.map((item) => item.term).join(', ');
  return {
    text: normalizedText,
    suggestionId,
    terms: deduped,
  };
};

const syncWordcloudOptionsFromTerms = (interaction, terms = []) => {
  if (!interaction || !Array.isArray(terms) || terms.length === 0) return;
  if (!Array.isArray(interaction.options)) interaction.options = [];

  const existingOptionIds = new Set(
    interaction.options
      .map((option) => asText(option?.id))
      .filter(Boolean),
  );
  const existingKeys = new Set(
    interaction.options
      .map((option) => normalizeWordKey(option?.text || option?.label || option?.value || option?.id))
      .filter(Boolean),
  );

  for (const item of terms) {
    const key = asText(item?.key);
    const term = normalizeWordLabel(item?.term || item?.label || '');
    if (!key || !term || existingKeys.has(key)) continue;

    const baseId = `wc-${key}`;
    let nextId = baseId;
    let suffix = 2;
    while (existingOptionIds.has(nextId)) {
      nextId = `${baseId}-${suffix}`;
      suffix += 1;
    }

    interaction.options.push({
      id: nextId,
      text: term,
    });
    existingOptionIds.add(nextId);
    existingKeys.add(key);
  }
};

const getOptionCounts = (interaction) => {
  const counts = Object.fromEntries(interaction.options.map((option) => [option.id, 0]));

  for (const response of interaction.responses.values()) {
    const responseAnswers = Array.isArray(response.answers) ? response.answers : [];
    for (const answerId of responseAnswers) {
      if (counts[answerId] === undefined) continue;
      counts[answerId] += 1;
    }
  }

  return counts;
};

const getWordItems = (interaction) => {
  const counts = new Map();

  for (const response of interaction.responses.values()) {
    const terms = Array.isArray(response.wordTerms) ? response.wordTerms : [];
    for (const item of terms) {
      const key = asText(item?.key || '');
      const term = normalizeWordLabel(item?.term || item?.label || '');
      if (!key || !term) continue;

      const current = counts.get(key) || { key, term, count: 0 };
      current.count += 1;
      if (!current.term && term) current.term = term;
      counts.set(key, current);
    }
  }

  return Array.from(counts.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.term.localeCompare(b.term, 'es');
    })
    .map((item) => ({
      key: item.key,
      term: item.term,
      count: item.count,
    }));
};

const toSnapshot = (interaction) => {
  if (!interaction) {
    return {
      active: false,
    };
  }

  const totalResponses = interaction.responses.size;
  const optionCounts = getOptionCounts(interaction);
  const wordItems = getWordItems(interaction);
  const wordCounts = Object.fromEntries(
    wordItems.map((item) => [item.term, item.count]),
  );

  return {
    active: true,
    courseId: interaction.courseId,
    pageSlug: interaction.pageSlug || '',
    sessionId: interaction.sessionId,
    interactionId: interaction.interactionId,
    type: interaction.type,
    prompt: interaction.prompt,
    options: interaction.options,
    anonymous: interaction.anonymous,
    allowMultiple: interaction.allowMultiple,
    showResults: interaction.showResults,
    startedAt: interaction.startedAt,
    endsAt: interaction.endsAt || null,
    timed: Boolean(interaction.endsAt),
    totalResponses,
    optionCounts,
    wordCounts,
    wordItems,
  };
};

const getRoomPresenceTimestamp = (presence) =>
  getTimestamp(presence?.updatedAt) ||
  getTimestamp(presence?.startedAt) ||
  0;

const pruneRoomPresences = () => {
  const store = ensureStore();
  const now = Date.now();

  for (const [presenceId, presence] of store.roomPresences.entries()) {
    const expiresAtMs = getTimestamp(presence?.expiresAt);
    if (expiresAtMs && expiresAtMs > now) continue;
    clearRoomPresenceTimeout(presenceId);
    store.roomPresences.delete(presenceId);
  }
};

const getLatestRoomPresence = (courseId = '') => {
  pruneRoomPresences();
  const store = ensureStore();

  const roomPresences = Array.from(store.roomPresences.values())
    .filter((presence) => !courseId || presence.courseId === courseId)
    .sort((left, right) => getRoomPresenceTimestamp(right) - getRoomPresenceTimestamp(left));

  return roomPresences[0] || null;
};

const toRoomSnapshot = (presence) => {
  if (!presence) {
    return {
      active: false,
    };
  }

  return {
    active: true,
    courseId: presence.courseId,
    pageSlug: presence.pageSlug || '',
    room: presence.room,
    href: presence.href || '',
    presentationHref: presence.presentationHref || '',
    startedAt: presence.startedAt,
    updatedAt: presence.updatedAt,
    identity: presence.identity || '',
    name: presence.name || '',
    presenceId: presence.presenceId,
  };
};

const buildMergedSnapshot = (courseId = '') => {
  const normalizedCourseId = asText(courseId);
  const interaction = getLatestInteraction(normalizedCourseId);
  const interactionSnapshot = toSnapshot(interaction);
  const roomSnapshot = toRoomSnapshot(getLatestRoomPresence(normalizedCourseId));

  return {
    ...interactionSnapshot,
    courseId: interactionSnapshot.courseId || roomSnapshot.courseId || normalizedCourseId,
    roomLive: roomSnapshot,
  };
};

const emit = (eventName, payload) => {
  const store = ensureStore();
  const listeners = Array.from(store.listeners.values());
  for (const listener of listeners) {
    const expectedCourse = listener.courseId;
    if (expectedCourse && payload?.courseId && expectedCourse !== payload.courseId) {
      continue;
    }

    try {
      listener.callback(eventName, payload);
    } catch (error) {
      console.error('Live listener callback error:', error);
    }
  }
};

const scheduleInteractionTimeout = (interaction, onTimeout) => {
  if (!interaction?.sessionId) return;
  clearInteractionTimeout(interaction.sessionId);

  const endsAtMs = getTimestamp(interaction.endsAt);
  if (!endsAtMs) return;

  const delayMs = Math.max(0, endsAtMs - Date.now());
  const store = ensureStore();
  const timerId = setTimeout(() => {
    clearInteractionTimeout(interaction.sessionId);
    onTimeout(interaction.sessionId);
  }, delayMs);

  store.timeouts.set(interaction.sessionId, timerId);
};

const emitMergedSnapshot = (courseId = '') => {
  emit('live.snapshot', getLiveSnapshot(courseId));
};

const scheduleRoomPresenceTimeout = (presence) => {
  const presenceId = asText(presence?.presenceId);
  if (!presenceId) return;

  clearRoomPresenceTimeout(presenceId);

  const expiresAtMs = getTimestamp(presence?.expiresAt);
  if (!expiresAtMs) return;

  const store = ensureStore();
  const delayMs = Math.max(0, expiresAtMs - Date.now());
  const timerId = setTimeout(() => {
    const current = store.roomPresences.get(presenceId);
    if (!current) {
      clearRoomPresenceTimeout(presenceId);
      return;
    }

    const stillExpiresAtMs = getTimestamp(current.expiresAt);
    if (stillExpiresAtMs && stillExpiresAtMs > Date.now()) {
      scheduleRoomPresenceTimeout(current);
      return;
    }

    const courseId = current.courseId;
    clearRoomPresenceTimeout(presenceId);
    store.roomPresences.delete(presenceId);
    emitMergedSnapshot(courseId);
  }, delayMs);

  store.roomTimeouts.set(presenceId, timerId);
};

const endInteractionInternal = (sessionId, reason = 'ended') => {
  const store = ensureStore();
  const interaction = store.interactions.get(sessionId);
  if (!interaction) return null;
  const lastSnapshot = toSnapshot(interaction);

  clearInteractionTimeout(sessionId);
  store.interactions.delete(sessionId);

  store.recentSnapshots.set(sessionId, {
    snapshot: {
      ...lastSnapshot,
      active: false,
      reason,
      endedAt: nowIso(),
    },
    storedAt: Date.now(),
  });
  pruneRecentSnapshots();

  const payload = {
    courseId: interaction.courseId,
    pageSlug: interaction.pageSlug || '',
    sessionId: interaction.sessionId,
    interactionId: interaction.interactionId,
    type: interaction.type,
    reason,
    endedAt: nowIso(),
  };

  emit('live.ended', payload);
  return payload;
};

export const cleanupExpiredInteractions = () => {
  const store = ensureStore();
  const now = Date.now();
  pruneRecentSnapshots();
  pruneRoomPresences();

  for (const [sessionId, interaction] of store.interactions.entries()) {
    const endsAt = getTimestamp(interaction.endsAt);
    if (!endsAt) {
      const startedAt = getTimestamp(interaction.startedAt);
      if (startedAt && now - startedAt > MAX_UNTIMED_INTERACTION_MS) {
        endInteractionInternal(sessionId, 'stale');
      }
      continue;
    }
    if (endsAt > now) continue;
    endInteractionInternal(sessionId, 'timeout');
  }
};

const getLatestInteraction = (courseId = '') => {
  cleanupExpiredInteractions();
  const store = ensureStore();
  const interactions = Array.from(store.interactions.values())
    .filter((item) => !courseId || item.courseId === courseId)
    .sort((a, b) => {
      const aTime = getTimestamp(a.startedAt) || 0;
      const bTime = getTimestamp(b.startedAt) || 0;
      return bTime - aTime;
    });

  return interactions[0] || null;
};

export const getLiveSnapshot = (courseId = '') => {
  return buildMergedSnapshot(asText(courseId));
};

export const getLiveSnapshotBySession = (sessionId = '') => {
  cleanupExpiredInteractions();
  const store = ensureStore();
  const key = asText(sessionId);
  if (!key) return { active: false };
  const live = store.interactions.get(key);
  if (live) return toSnapshot(live);

  const recent = store.recentSnapshots.get(key);
  if (recent?.snapshot && typeof recent.snapshot === 'object') {
    return {
      ...recent.snapshot,
      active: false,
    };
  }

  return { active: false };
};

export const subscribeToLiveEvents = ({ courseId = '', callback }) => {
  const store = ensureStore();
  const listenerId = crypto.randomUUID();
  store.listeners.set(listenerId, {
    id: listenerId,
    courseId: asText(courseId),
    callback,
  });

  return () => {
    store.listeners.delete(listenerId);
  };
};

const buildRoomPresence = (input = {}) => {
  const startedAt = asText(input.startedAt || nowIso(), nowIso());
  const updatedAt = nowIso();
  const ttlMs = asPositiveInteger(input.ttlMs, ROOM_PRESENCE_TTL_MS);

  return {
    presenceId: asText(input.presenceId, crypto.randomUUID()),
    courseId: asText(input.courseId, 'global'),
    pageSlug: asText(input.pageSlug || ''),
    room: asText(input.room || ''),
    href: asText(input.href || ''),
    presentationHref: asText(input.presentationHref || ''),
    identity: asText(input.identity || ''),
    name: asText(input.name || ''),
    startedAt,
    updatedAt,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  };
};

export const upsertLiveRoomPresence = (input = {}) => {
  const nextPresence = buildRoomPresence(input);
  if (!nextPresence.room) {
    return null;
  }

  const store = ensureStore();
  const previous = store.roomPresences.get(nextPresence.presenceId);
  if (previous?.startedAt) {
    nextPresence.startedAt = previous.startedAt;
  }

  store.roomPresences.set(nextPresence.presenceId, nextPresence);
  scheduleRoomPresenceTimeout(nextPresence);
  emitMergedSnapshot(nextPresence.courseId);

  return {
    roomLive: toRoomSnapshot(nextPresence),
    snapshot: getLiveSnapshot(nextPresence.courseId),
  };
};

export const clearLiveRoomPresence = (input = {}) => {
  const store = ensureStore();
  const presenceId = asText(input.presenceId);
  const courseId = asText(input.courseId);

  let removedCourseId = courseId;

  if (presenceId) {
    const existing = store.roomPresences.get(presenceId);
    if (!existing) {
      return {
        snapshot: getLiveSnapshot(courseId),
      };
    }

    removedCourseId = existing.courseId || courseId;
    clearRoomPresenceTimeout(presenceId);
    store.roomPresences.delete(presenceId);
    emitMergedSnapshot(removedCourseId);
    return {
      snapshot: getLiveSnapshot(removedCourseId),
    };
  }

  if (!courseId) {
    return {
      snapshot: getLiveSnapshot(''),
    };
  }

  for (const [key, presence] of store.roomPresences.entries()) {
    if (presence.courseId !== courseId) continue;
    clearRoomPresenceTimeout(key);
    store.roomPresences.delete(key);
  }

  emitMergedSnapshot(courseId);
  return {
    snapshot: getLiveSnapshot(courseId),
  };
};

const buildInteraction = (input = {}) => {
  const courseId = asText(input.courseId, 'global');
  const sessionId = asText(input.sessionId, crypto.randomUUID());
  const interactionId = asText(input.interactionId, sessionId);
  const options = normalizeOptions(input.options);
  const timerSeconds = asPositiveInteger(input.timerSeconds, 0);
  const endsAt = timerSeconds > 0
    ? new Date(Date.now() + timerSeconds * 1000).toISOString()
    : asText(input.endsAt) || null;

  return {
    courseId,
    pageSlug: asText(input.pageSlug || ''),
    sessionId,
    interactionId,
    type: asText(input.type, 'poll'),
    prompt: asText(input.prompt, ''),
    options,
    anonymous: asBoolean(input.anonymous, true),
    allowMultiple: asBoolean(input.allowMultiple, false),
    showResults: asBoolean(input.showResults, true),
    startedAt: nowIso(),
    endsAt,
    responses: new Map(),
  };
};

export const startLiveInteraction = (input = {}) => {
  const store = ensureStore();
  const nextInteraction = buildInteraction(input);
  store.recentSnapshots.delete(nextInteraction.sessionId);

  // One active interaction per course to keep UX deterministic.
  const sessionsToClose = Array.from(store.interactions.values())
    .filter((item) => item.courseId === nextInteraction.courseId)
    .map((item) => item.sessionId);

  for (const sessionId of sessionsToClose) {
    endInteractionInternal(sessionId, 'replaced');
  }

  store.interactions.set(nextInteraction.sessionId, nextInteraction);
  scheduleInteractionTimeout(nextInteraction, (sessionId) => {
    endInteractionInternal(sessionId, 'timeout');
  });

  const payload = {
    ...toSnapshot(nextInteraction),
    active: true,
  };

  emit('live.started', payload);
  return payload;
};

export const updateLiveInteraction = (input = {}) => {
  cleanupExpiredInteractions();
  const store = ensureStore();
  const sessionId = asText(input.sessionId);
  if (!sessionId) return null;

  const existing = store.interactions.get(sessionId);
  if (!existing) return null;

  const timerSeconds = asPositiveInteger(input.timerSeconds, 0);
  if (timerSeconds > 0) {
    existing.endsAt = new Date(Date.now() + timerSeconds * 1000).toISOString();
  } else if (typeof input.endsAt === 'string') {
    existing.endsAt = asText(input.endsAt) || null;
  }

  if (typeof input.prompt === 'string') {
    existing.prompt = asText(input.prompt);
  }

  if (typeof input.showResults !== 'undefined') {
    existing.showResults = asBoolean(input.showResults, existing.showResults);
  }

  if (Array.isArray(input.options)) {
    const nextOptions = normalizeOptions(input.options);
    if (nextOptions.length >= 2) {
      existing.options = nextOptions;
    }
  }

  scheduleInteractionTimeout(existing, (sessionId) => {
    endInteractionInternal(sessionId, 'timeout');
  });

  const payload = toSnapshot(existing);
  emit('live.updated', payload);
  return payload;
};

export const endLiveInteraction = (input = {}) => {
  const sessionId = asText(input.sessionId);
  if (!sessionId) return null;
  return endInteractionInternal(sessionId, asText(input.reason, 'ended'));
};

export const submitLiveResponse = (input = {}) => {
  cleanupExpiredInteractions();
  const store = ensureStore();

  const sessionId = asText(input.sessionId);
  if (!sessionId) {
    return { ok: false, status: 400, error: 'sessionId required' };
  }

  const interaction = store.interactions.get(sessionId);
  if (!interaction) {
    return { ok: false, status: 404, error: 'interaction not found' };
  }

  const participantKey = asText(input.participantKey);
  if (!participantKey) {
    return { ok: false, status: 400, error: 'participantKey required' };
  }

  let answers = ensureArrayAnswer(input.answer, interaction.allowMultiple);
  let answerText = '';
  let wordTerms = [];

  if (interaction.type === 'wordcloud') {
    const parsedWordcloud = normalizeWordcloudAnswer(input.answer);
    if (!parsedWordcloud || parsedWordcloud.terms.length === 0) {
      return { ok: false, status: 400, error: 'answer required' };
    }

    answerText = parsedWordcloud.text;
    wordTerms = parsedWordcloud.terms;
    const suggestionId = asText(parsedWordcloud.suggestionId);
    answers = suggestionId ? [suggestionId] : [];
    syncWordcloudOptionsFromTerms(interaction, wordTerms);
  } else if (answers.length === 0) {
    return { ok: false, status: 400, error: 'answer required' };
  }

  interaction.responses.set(participantKey, {
    participantKey,
    answers,
    answerText,
    wordTerms,
    submittedAt: nowIso(),
    anonymous: Boolean(input.anonymous),
    studentId: asText(input.studentId),
  });

  const payload = toSnapshot(interaction);
  emit('live.updated', payload);

  return {
    ok: true,
    status: 200,
    snapshot: payload,
  };
};
