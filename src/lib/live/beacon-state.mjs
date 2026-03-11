import { getRemainingMs } from './countdown.mjs';

export const LIVE_STATES = {
  IDLE: 'IDLE',
  LIVE: 'LIVE',
  TIMED: 'TIMED',
  CLOSING: 'CLOSING',
  ENDED: 'ENDED',
};

export const createInitialBeaconState = () => ({
  status: LIVE_STATES.IDLE,
  active: false,
  courseId: '',
  sessionId: '',
  interactionId: '',
  type: '',
  title: '',
  prompt: '',
  endsAt: null,
  remainingMs: null,
  show: false,
  endedAt: null,
});

export const resolveLiveStatus = ({ active, endsAt }, now = Date.now()) => {
  if (!active) return LIVE_STATES.IDLE;
  if (!endsAt) return LIVE_STATES.LIVE;

  const remaining = getRemainingMs(endsAt, now);
  if (remaining === null) return LIVE_STATES.LIVE;
  if (remaining <= 10_000) return LIVE_STATES.CLOSING;
  return LIVE_STATES.TIMED;
};

const applyLivePayload = (state, payload, now = Date.now()) => {
  const active = Boolean(payload?.active);
  if (!active) {
    return {
      ...createInitialBeaconState(),
      show: false,
    };
  }

  const endsAt = payload?.endsAt || null;
  const remainingMs = getRemainingMs(endsAt, now);

  return {
    ...state,
    active: true,
    show: true,
    endedAt: null,
    courseId: String(payload?.courseId || ''),
    sessionId: String(payload?.sessionId || ''),
    interactionId: String(payload?.interactionId || ''),
    type: String(payload?.type || ''),
    title: String(payload?.title || ''),
    prompt: String(payload?.prompt || ''),
    endsAt,
    remainingMs,
    status: resolveLiveStatus({ active, endsAt }, now),
  };
};

export const liveBeaconReducer = (state, action) => {
  const now = Number(action?.now || Date.now());

  switch (action?.type) {
    case 'SNAPSHOT':
    case 'STARTED':
    case 'UPDATED':
      return applyLivePayload(state, action.payload, now);

    case 'ENDED':
      return {
        ...state,
        active: false,
        show: true,
        status: LIVE_STATES.ENDED,
        remainingMs: 0,
        endedAt: new Date(now).toISOString(),
      };

    case 'TICK': {
      if (!state.show) return state;
      if (state.status === LIVE_STATES.ENDED) return state;
      if (!state.active || !state.endsAt) return state;

      const remainingMs = getRemainingMs(state.endsAt, now);
      if (remainingMs === null) return state;

      const status = remainingMs <= 10_000 ? LIVE_STATES.CLOSING : LIVE_STATES.TIMED;
      return {
        ...state,
        remainingMs,
        status,
      };
    }

    case 'HIDE_ENDED':
      return createInitialBeaconState();

    default:
      return state;
  }
};
