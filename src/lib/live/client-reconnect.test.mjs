import test from 'node:test';
import assert from 'node:assert/strict';

const waitForMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('client replays latest live.snapshot to late subscribers', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;

  try {
    let fetchCount = 0;

    globalThis.window = {
      EventSource: undefined,
      setInterval,
      clearInterval,
    };

    globalThis.fetch = async () => {
      fetchCount += 1;
      return {
        ok: true,
        json: async () => ({
          active: true,
          courseId: 'cym06',
          sessionId: 'session-reconnect',
          interactionId: 'poll-reconnect',
          type: 'poll',
        }),
      };
    };

    const { subscribeToLive } = await import(`./client.mjs?test=${Date.now()}`);

    const firstEvents = [];
    const unsubscribeFirst = subscribeToLive({
      courseId: 'cym06',
      onEvent: (eventName, payload) => {
        firstEvents.push({ eventName, payload });
      },
    });

    await waitForMicrotasks();

    assert.ok(firstEvents.some((entry) => entry.eventName === 'live.snapshot'));
    assert.equal(fetchCount, 1);

    const secondEvents = [];
    const unsubscribeSecond = subscribeToLive({
      courseId: 'cym06',
      onEvent: (eventName, payload) => {
        secondEvents.push({ eventName, payload });
      },
    });

    assert.equal(secondEvents.length, 1);
    assert.equal(secondEvents[0].eventName, 'live.snapshot');
    assert.equal(secondEvents[0].payload?.sessionId, 'session-reconnect');

    unsubscribeSecond();
    unsubscribeFirst();
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});
