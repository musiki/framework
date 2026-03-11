const CONNECTIONS = new Map();

const toCourseKey = (courseId) => {
  const cleaned = typeof courseId === 'string' ? courseId.trim() : '';
  return cleaned || '*';
};

const buildSseUrl = (courseId) => {
  const params = new URLSearchParams();
  if (courseId && courseId !== '*') params.set('courseId', courseId);
  const query = params.toString();
  return query ? `/sse/live?${query}` : '/sse/live';
};

const buildSnapshotUrl = (courseId) => {
  const params = new URLSearchParams();
  if (courseId && courseId !== '*') params.set('courseId', courseId);
  const query = params.toString();
  return query ? `/api/live/active?${query}` : '/api/live/active';
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
    latestSnapshot: null,
  };

  const emit = (type, payload) => {
    if (type === 'live.snapshot') {
      state.latestSnapshot = payload || null;
    }

    for (const listener of state.listeners) {
      try {
        listener(type, payload);
      } catch (error) {
        console.error('live client listener error', error);
      }
    }
  };

  const fetchSnapshot = async () => {
    try {
      const response = await fetch(buildSnapshotUrl(courseKey));
      if (!response.ok) return;
      const payload = await response.json().catch(() => null);
      if (!payload) return;
      emit('live.snapshot', payload);
    } catch {
      // silent network fallback
    }
  };

  const stopPolling = () => {
    if (!state.pollId) return;
    window.clearInterval(state.pollId);
    state.pollId = null;
  };

  const startPolling = () => {
    if (state.pollId) return;
    state.pollId = window.setInterval(fetchSnapshot, 5000);
  };

  const connect = () => {
    fetchSnapshot();

    if (typeof window.EventSource !== 'function') {
      startPolling();
      return;
    }

    const source = new EventSource(buildSseUrl(courseKey));
    state.source = source;

    const registerEvent = (eventName) => {
      source.addEventListener(eventName, (event) => {
        const payload = parsePayload(event.data);
        emit(eventName, payload);
      });
    };

    registerEvent('live.snapshot');
    registerEvent('live.started');
    registerEvent('live.updated');
    registerEvent('live.ended');

    source.onerror = () => {
      // Keep resilient behavior via polling while EventSource retries.
      startPolling();
    };

    source.onopen = () => {
      stopPolling();
    };
  };

  const close = () => {
    if (state.source) {
      state.source.close();
      state.source = null;
    }
    stopPolling();
  };

  connect();

  return {
    subscribe(listener) {
      if (typeof listener !== 'function') {
        return () => {};
      }

      state.listeners.add(listener);
      if (state.latestSnapshot) {
        listener('live.snapshot', state.latestSnapshot);
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

export const subscribeToLive = ({ courseId = '', onEvent }) => {
  const key = toCourseKey(courseId);

  let connection = CONNECTIONS.get(key);
  if (!connection) {
    connection = createConnection(key);
    CONNECTIONS.set(key, connection);
  }

  return connection.subscribe(onEvent);
};
