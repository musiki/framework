import { subscribeToLive } from './client.mjs';
import { createInitialBeaconState, liveBeaconReducer, LIVE_STATES } from './beacon-state.mjs';
import { formatCountdown, getRemainingMs } from './countdown.mjs';

const COURSE_PATH_RE = /^\/cursos\/([^/]+)/i;

const inferCourseFromPath = () => {
  const match = window.location.pathname.match(COURSE_PATH_RE);
  return match ? decodeURIComponent(match[1] || '') : '';
};

const normalizeCourseId = (value) => {
  const normalized = String(value || '').trim();
  return normalized;
};

const normalizePageSlug = (value) => String(value || '').trim();

const inferPageSlugFromPath = () => {
  const path = String(window.location.pathname || '');
  if (!path.startsWith('/cursos/')) return '';

  const parts = path
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });

  if (parts.length < 3 || parts[0] !== 'cursos') return '';
  return normalizePageSlug(parts.slice(1).join('/'));
};

const dedupeCourseIds = (values) => {
  const output = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeCourseId(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
};

const parseCourseIdsFromDataset = (value) => {
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return dedupeCourseIds(parsed);
  } catch {
    // Fall back to comma-separated values.
  }

  return dedupeCourseIds(
    trimmed
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
};

const parseEvalIdsFromDataset = (value) => {
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  const normalizeEvalId = (entry) => String(entry || '').trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return Array.from(
        new Set(parsed.map((entry) => normalizeEvalId(entry)).filter(Boolean)),
      );
    }
  } catch {
    // Fall back to comma-separated values.
  }

  return Array.from(
    new Set(
      trimmed
        .split(',')
        .map((entry) => normalizeEvalId(entry))
        .filter(Boolean),
    ),
  );
};

const toPayloadTimestamp = (payload) => {
  if (!payload || typeof payload !== 'object') return 0;
  const candidate = payload.startedAt || payload.updatedAt || payload.endsAt || payload.endedAt;
  const parsed = new Date(candidate || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const isPayloadExpired = (payload) => {
  if (!payload || typeof payload !== 'object') return false;
  const endsAt = payload.endsAt;
  if (!endsAt) return false;
  const endsAtMs = new Date(String(endsAt)).getTime();
  if (!Number.isFinite(endsAtMs)) return false;
  return endsAtMs <= Date.now();
};

const ensureClientId = () => {
  try {
    const storageKey = 'live:client-id';
    const existing = window.localStorage.getItem(storageKey);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(storageKey, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
};

const trackEvent = (eventName, context = {}) => {
  console.log('trackEvent', {
    eventName,
    timestamp: new Date().toISOString(),
    ...context,
  });
};

const toLiveRoute = (sessionId, courseId) => {
  const session = String(sessionId || '').trim();
  if (!session) return '/';

  const url = new URL(`/live/${encodeURIComponent(session)}`, window.location.origin);
  if (courseId) url.searchParams.set('courseId', courseId);
  return `${url.pathname}${url.search}`;
};

const fetchEnrolledCourseIds = async () => {
  try {
    const response = await fetch('/api/live/courses', {
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
    if (!response.ok) return [];
    const payload = await response.json().catch(() => null);
    if (!payload || !Array.isArray(payload.courseIds)) return [];
    return dedupeCourseIds(payload.courseIds);
  } catch {
    return [];
  }
};

export const mountLiveInteractionBeacon = (root) => {
  if (!(root instanceof HTMLElement)) return () => {};

  const button = root.querySelector('[data-live-beacon-button]');
  const labelNode = root.querySelector('[data-live-beacon-label]');
  const countdownNode = root.querySelector('[data-live-beacon-countdown]');
  const ledNode = root.querySelector('[data-live-beacon-led]');

  if (!(button instanceof HTMLButtonElement)) return () => {};

  const clientId = ensureClientId();
  const studentId = String(root.dataset.studentId || '').trim();
  const explicitCourseId = normalizeCourseId(root.dataset.courseId || '');
  const explicitPageSlug = normalizePageSlug(root.dataset.pageSlug || '');
  const seededCourseIds = parseCourseIdsFromDataset(root.dataset.courseIds || '');
  const hasClasstimeEval = String(root.dataset.hasClasstime || '').trim().toLowerCase() === 'true';
  const classtimeEvalIds = parseEvalIdsFromDataset(root.dataset.classtimeEvalIds || '');
  const classtimeEvalIdSet = new Set(classtimeEvalIds);
  const inferredCourseId = inferCourseFromPath();
  const inferredPageSlug = inferPageSlugFromPath();
  const contextCourseId = explicitCourseId || inferredCourseId;
  const contextPageSlug = explicitPageSlug || inferredPageSlug;
  const hasLocalClasstime = hasClasstimeEval && classtimeEvalIdSet.size > 0 && Boolean(contextCourseId);

  let state = createInitialBeaconState();
  let destroyed = false;
  let trackedVisibleKey = '';
  const activeByCourse = new Map();
  const unsubscribers = [];

  const render = () => {
    root.dataset.state = state.status;

    const isActiveState =
      state.status === LIVE_STATES.LIVE ||
      state.status === LIVE_STATES.TIMED ||
      state.status === LIVE_STATES.CLOSING;
    const hasLiveIdentity = Boolean(state.sessionId || state.interactionId);
    const remainingMs = state.endsAt ? getRemainingMs(state.endsAt, Date.now()) : null;
    const timerExpired = remainingMs !== null && remainingMs <= 0;
    const isLiveVisible =
      hasLocalClasstime &&
      state.show &&
      state.active &&
      isActiveState &&
      hasLiveIdentity &&
      !timerExpired;
    const isClosing = state.status === LIVE_STATES.CLOSING;
    const shouldShowIdle = false;

    if (!isLiveVisible && !shouldShowIdle) {
      root.hidden = true;
      root.classList.remove('is-visible', 'is-live', 'is-idle', 'is-closing');
      button.title = '';
      button.disabled = true;
      if (labelNode) labelNode.textContent = '';
      if (ledNode instanceof HTMLElement) {
        ledNode.classList.remove('is-closing');
        ledNode.classList.remove('is-idle');
      }
      if (countdownNode) {
        countdownNode.hidden = true;
        countdownNode.textContent = '';
      }
      return;
    }

    root.hidden = false;
    root.classList.toggle('is-visible', isLiveVisible);
    root.classList.toggle('is-live', isLiveVisible);
    root.classList.toggle('is-idle', !isLiveVisible);
    root.classList.toggle('is-closing', isLiveVisible && isClosing);

    if (!isLiveVisible) {
      const idleMessage = 'Interacción en clase disponible en esta nota';
      button.title = idleMessage;
      button.setAttribute('aria-label', idleMessage);
      button.disabled = true;
      if (labelNode) labelNode.textContent = idleMessage;
      if (ledNode instanceof HTMLElement) {
        ledNode.classList.remove('is-closing');
        ledNode.classList.add('is-idle');
      }
      if (countdownNode) {
        countdownNode.hidden = true;
        countdownNode.textContent = '';
      }
      return;
    }

    button.disabled = false;
    const detailParts = ['Interacción en vivo activa'];
    if (state.prompt) detailParts.push(state.prompt);
    if (state.type) detailParts.push(`Tipo: ${state.type}`);
    if (state.courseId || contextCourseId) detailParts.push(`Curso: ${state.courseId || contextCourseId}`);
    button.title = detailParts.join(' · ');
    button.setAttribute('aria-label', detailParts.join('. '));
    if (labelNode) labelNode.textContent = detailParts.join('. ');
    if (ledNode instanceof HTMLElement) {
      ledNode.classList.remove('is-idle');
      ledNode.classList.toggle('is-closing', isClosing);
    }

    if (state.status === LIVE_STATES.TIMED || state.status === LIVE_STATES.CLOSING) {
      if (countdownNode) {
        countdownNode.hidden = false;
        countdownNode.textContent = formatCountdown(remainingMs ?? state.remainingMs);
      }
      return;
    }

    if (countdownNode) {
      countdownNode.hidden = true;
      countdownNode.textContent = '';
    }
  };

  const dispatch = (action) => {
    state = liveBeaconReducer(state, action);
    render();
  };

  const matchesCurrentLesson = (payload) => {
    if (!payload || typeof payload !== 'object') return false;
    if (!hasLocalClasstime) return false;

    const payloadCourseId = normalizeCourseId(payload.courseId || '');
    if (contextCourseId && payloadCourseId && payloadCourseId !== contextCourseId) {
      return false;
    }

    const interactionId = String(payload.interactionId || '').trim();
    if (!interactionId || !classtimeEvalIdSet.has(interactionId)) {
      return false;
    }

    const payloadPageSlug = normalizePageSlug(payload.pageSlug || '');
    if (contextPageSlug && !payloadPageSlug) {
      return false;
    }
    if (contextPageSlug && payloadPageSlug !== contextPageSlug) {
      return false;
    }

    return true;
  };

  const pickVisiblePayload = () => {
    if (!hasLocalClasstime) return null;

    if (contextCourseId && activeByCourse.has(contextCourseId)) {
      const scopedPayload = activeByCourse.get(contextCourseId) || null;
      if (isPayloadExpired(scopedPayload)) {
        activeByCourse.delete(contextCourseId);
      } else if (matchesCurrentLesson(scopedPayload)) {
        return scopedPayload;
      }
    }

    let winner = null;
    let winnerScore = -1;
    for (const [courseId, payload] of activeByCourse.entries()) {
      if (isPayloadExpired(payload)) {
        activeByCourse.delete(courseId);
        continue;
      }
      if (!matchesCurrentLesson(payload)) continue;
      const score = toPayloadTimestamp(payload);
      if (!winner || score > winnerScore) {
        winner = payload;
        winnerScore = score;
      }
    }
    return winner;
  };

  const syncFromActiveMap = () => {
    const payload = pickVisiblePayload();
    if (payload) {
      dispatch({ type: 'SNAPSHOT', payload: { ...payload, active: true } });
      const visibleKey = String(payload.interactionId || payload.sessionId || '');
      if (visibleKey && visibleKey !== trackedVisibleKey) {
        trackedVisibleKey = visibleKey;
      }
      return;
    }

    trackedVisibleKey = '';
    dispatch({ type: 'SNAPSHOT', payload: { active: false } });
  };

  const emitLiveEventToWindow = (eventName, payload) => {
    window.dispatchEvent(
      new CustomEvent('live:event', {
        detail: {
          eventName,
          payload,
        },
      }),
    );
  };

  const updateActiveMap = (eventName, payload, scopedCourseId) => {
    const normalizedCourseId = normalizeCourseId(payload?.courseId || scopedCourseId || '');
    const normalizedPayload =
      payload && typeof payload === 'object'
        ? { ...payload, courseId: normalizedCourseId || payload.courseId || '' }
        : payload;
    const payloadExpired = isPayloadExpired(normalizedPayload);

    if (eventName === 'live.ended') {
      if (normalizedCourseId) activeByCourse.delete(normalizedCourseId);
      return normalizedPayload;
    }

    if (eventName === 'live.snapshot') {
      if (normalizedPayload?.active && !payloadExpired) {
        if (normalizedCourseId) activeByCourse.set(normalizedCourseId, normalizedPayload);
      } else if (normalizedCourseId) {
        activeByCourse.delete(normalizedCourseId);
      }
      return payloadExpired ? { ...normalizedPayload, active: false } : normalizedPayload;
    }

    if (eventName === 'live.started' || eventName === 'live.updated') {
      if (payloadExpired) {
        if (normalizedCourseId) activeByCourse.delete(normalizedCourseId);
        return { ...normalizedPayload, active: false };
      }
      if (normalizedPayload?.active !== false && normalizedCourseId) {
        activeByCourse.set(normalizedCourseId, {
          ...normalizedPayload,
          active: true,
        });
      }
      return normalizedPayload;
    }

    return normalizedPayload;
  };

  const handleLiveEvent = (eventName, payload, scopedCourseId = '') => {
    const nextPayload = updateActiveMap(eventName, payload, scopedCourseId);
    emitLiveEventToWindow(eventName, nextPayload);
    syncFromActiveMap();

    if (eventName === 'live.snapshot' && nextPayload?.active) {
      const eventKey = `${nextPayload.interactionId || nextPayload.sessionId || ''}:${nextPayload.courseId || ''}`;
      if (eventKey && eventKey !== trackedVisibleKey) {
        trackEvent('beacon_shown', {
          studentId,
          clientId,
          courseId: nextPayload.courseId || contextCourseId,
          sessionId: nextPayload.sessionId,
          interactionId: nextPayload.interactionId,
          type: nextPayload.type,
        });
        trackedVisibleKey = eventKey;
      }
      return;
    }

    if (eventName === 'live.started') {
      trackEvent('beacon_shown', {
        studentId,
        clientId,
        courseId: nextPayload?.courseId || contextCourseId,
        sessionId: nextPayload?.sessionId,
        interactionId: nextPayload?.interactionId,
        type: nextPayload?.type,
      });
      if (nextPayload?.endsAt) {
        trackEvent('countdown_started', {
          studentId,
          clientId,
          courseId: nextPayload?.courseId || contextCourseId,
          sessionId: nextPayload?.sessionId,
          interactionId: nextPayload?.interactionId,
          type: nextPayload?.type,
        });
      }
      return;
    }

    if (eventName === 'live.ended') {
      trackEvent('interaction_ended', {
        studentId,
        clientId,
        courseId: nextPayload?.courseId || contextCourseId,
        sessionId: nextPayload?.sessionId,
        interactionId: nextPayload?.interactionId,
        type: nextPayload?.type,
      });
      trackEvent('countdown_ended', {
        studentId,
        clientId,
        courseId: nextPayload?.courseId || contextCourseId,
        sessionId: nextPayload?.sessionId,
        interactionId: nextPayload?.interactionId,
        type: nextPayload?.type,
      });
    }
  };

  const subscribeToCourses = (courseIds) => {
    for (const courseId of courseIds) {
      const unsubscribe = subscribeToLive({
        courseId,
        onEvent: (eventName, payload) => {
          handleLiveEvent(eventName, payload, courseId);
        },
      });
      unsubscribers.push(unsubscribe);
    }
  };

  const resolveCourseIds = async () => {
    const seeded = dedupeCourseIds([...seededCourseIds, contextCourseId]);
    if (seeded.length > 0) return seeded;
    if (!studentId) return seeded;

    const enrolled = await fetchEnrolledCourseIds();
    return dedupeCourseIds([...enrolled, contextCourseId]);
  };

  const initialize = async () => {
    const courseIds = await resolveCourseIds();
    if (destroyed) return;

    if (courseIds.length === 0) {
      syncFromActiveMap();
      return;
    }

    root.dataset.courseScope = courseIds.join(',');
    subscribeToCourses(courseIds);
    syncFromActiveMap();
  };

  const tickId = window.setInterval(() => {
    dispatch({ type: 'TICK' });
  }, 1000);

  const onClick = () => {
    if (!state.sessionId) return;

    trackEvent('beacon_clicked', {
      studentId,
      clientId,
      courseId: state.courseId || contextCourseId,
      sessionId: state.sessionId,
      interactionId: state.interactionId,
      type: state.type,
    });

    window.location.href = toLiveRoute(state.sessionId, state.courseId || contextCourseId);
  };

  button.addEventListener('click', onClick);
  render();
  initialize();

  return () => {
    destroyed = true;
    for (const unsubscribe of unsubscribers) {
      try {
        unsubscribe();
      } catch {
        // ignore teardown failures
      }
    }
    button.removeEventListener('click', onClick);
    window.clearInterval(tickId);
  };
};
