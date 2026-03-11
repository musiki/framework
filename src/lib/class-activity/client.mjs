import { buildClassActivitySnapshot } from './model.mjs';

const CONNECTIONS = new Map();

const toCourseKey = (courseId) => {
  const cleaned = typeof courseId === 'string' ? courseId.trim() : '';
  return cleaned || '*';
};

const buildSseUrl = (courseId) => {
  const params = new URLSearchParams();
  if (courseId && courseId !== '*') params.set('courseId', courseId);
  const query = params.toString();
  return query ? `/sse/class-activity?${query}` : '/sse/class-activity';
};

const buildSnapshotUrl = (courseId) => {
  const params = new URLSearchParams();
  if (courseId && courseId !== '*') params.set('courseId', courseId);
  const query = params.toString();
  return query ? `/api/class-activity/active?${query}` : '/api/class-activity/active';
};

const parsePayload = (input) => {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
};

const createConnection = (courseKey) => {
  const state = {
    key: courseKey,
    listeners: new Set(),
    source: null,
    pollId: null,
    reconnectId: null,
    latestSnapshot: null,
  };

  const emit = (eventName, payload) => {
    const snapshot = buildClassActivitySnapshot(payload);
    state.latestSnapshot = snapshot;

    for (const listener of state.listeners) {
      try {
        listener(eventName, snapshot, payload);
      } catch (error) {
        console.error('class activity client listener error', error);
      }
    }
  };

  const fetchSnapshot = async () => {
    try {
      const response = await fetch(buildSnapshotUrl(courseKey));
      if (!response.ok) return;
      const payload = await response.json().catch(() => null);
      if (!payload) return;
      emit('class.activity', payload);
    } catch {
      // silent network fallback
    }
  };

  const stopPolling = () => {
    if (!state.pollId) return;
    window.clearInterval(state.pollId);
    state.pollId = null;
  };

  const stopReconnect = () => {
    if (!state.reconnectId) return;
    window.clearTimeout(state.reconnectId);
    state.reconnectId = null;
  };

  const startPolling = () => {
    if (state.pollId) return;
    state.pollId = window.setInterval(fetchSnapshot, 5000);
  };

  const scheduleReconnect = () => {
    if (state.reconnectId || state.listeners.size === 0) return;
    state.reconnectId = window.setTimeout(() => {
      state.reconnectId = null;
      connect();
    }, 1500);
  };

  const connect = () => {
    fetchSnapshot();

    if (typeof window.EventSource !== 'function') {
      startPolling();
      return;
    }

    if (state.source) {
      state.source.close();
      state.source = null;
    }

    const source = new EventSource(buildSseUrl(courseKey));
    state.source = source;

    source.addEventListener('class.activity', (event) => {
      const payload = parsePayload(event.data);
      emit('class.activity', payload);
    });

    source.onerror = () => {
      if (state.source === source) {
        state.source.close();
        state.source = null;
      }
      startPolling();
      scheduleReconnect();
    };

    source.onopen = () => {
      stopPolling();
      stopReconnect();
    };
  };

  const close = () => {
    if (state.source) {
      state.source.close();
      state.source = null;
    }
    stopPolling();
    stopReconnect();
  };

  connect();

  return {
    subscribe(listener) {
      if (typeof listener !== 'function') {
        return () => {};
      }

      state.listeners.add(listener);
      if (state.latestSnapshot) {
        listener('class.activity', state.latestSnapshot, state.latestSnapshot);
      }

      return () => {
        state.listeners.delete(listener);
        if (state.listeners.size === 0) {
          close();
          CONNECTIONS.delete(courseKey);
        }
      };
    },
  };
};

export const subscribeToClassActivity = ({ courseId = '', onEvent }) => {
  const key = toCourseKey(courseId);

  let connection = CONNECTIONS.get(key);
  if (!connection) {
    connection = createConnection(key);
    CONNECTIONS.set(key, connection);
  }

  return connection.subscribe(onEvent);
};
