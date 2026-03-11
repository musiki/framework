import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialBeaconState, liveBeaconReducer, LIVE_STATES } from './beacon-state.mjs';

test('beacon reducer transitions through timed and closing states', () => {
  const baseNow = Date.parse('2026-03-05T12:00:00.000Z');
  const endsAt = new Date(baseNow + 15_000).toISOString();

  let state = createInitialBeaconState();
  state = liveBeaconReducer(state, {
    type: 'STARTED',
    now: baseNow,
    payload: {
      active: true,
      courseId: 'cym06',
      sessionId: 'session-1',
      interactionId: 'poll-1',
      type: 'poll',
      endsAt,
    },
  });

  assert.equal(state.status, LIVE_STATES.TIMED);
  assert.equal(state.show, true);
  assert.equal(state.active, true);

  state = liveBeaconReducer(state, {
    type: 'TICK',
    now: baseNow + 6_000,
  });

  assert.equal(state.status, LIVE_STATES.CLOSING);
  assert.ok(typeof state.remainingMs === 'number');
  assert.ok(state.remainingMs <= 10_000);
});

test('beacon reducer handles ended then hide cycle', () => {
  const baseNow = Date.parse('2026-03-05T12:05:00.000Z');
  let state = createInitialBeaconState();

  state = liveBeaconReducer(state, {
    type: 'STARTED',
    now: baseNow,
    payload: {
      active: true,
      sessionId: 'session-2',
      interactionId: 'poll-2',
      type: 'poll',
    },
  });

  state = liveBeaconReducer(state, {
    type: 'ENDED',
    now: baseNow + 3_000,
  });

  assert.equal(state.status, LIVE_STATES.ENDED);
  assert.equal(state.show, true);
  assert.equal(state.active, false);

  state = liveBeaconReducer(state, { type: 'HIDE_ENDED' });

  assert.equal(state.status, LIVE_STATES.IDLE);
  assert.equal(state.show, false);
  assert.equal(state.sessionId, '');
});
