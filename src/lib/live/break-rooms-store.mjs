/**
 * In-memory store for active break rooms state per LiveKit room.
 * Allows late-joining students to discover active break rooms
 * even when the teacher has already moved to a break room.
 * TTL of 4 hours to auto-expire stale state.
 */

const BREAK_ROOMS_TTL_MS = 4 * 60 * 60 * 1000;

/** @type {Map<string, { rooms: string[], assignments: Record<string, string>, mode: string, terminatingAt?: number, updatedAt: number }>} */
const store = new Map();

/**
 * Store current break rooms state for a room.
 * @param {string} roomName
 * @param {{ rooms: string[], assignments: Record<string, string>, mode: string, terminatingAt?: number }} state
 */
export function setBreakRoomsState(roomName, state) {
  const key = String(roomName || '').trim();
  if (!key) return;
  store.set(key, {
    rooms: Array.isArray(state.rooms) ? state.rooms : [],
    assignments: state.assignments && typeof state.assignments === 'object' ? state.assignments : {},
    mode: String(state.mode || ''),
    ...(state.terminatingAt ? { terminatingAt: Number(state.terminatingAt) } : {}),
    updatedAt: Date.now(),
  });
}

/**
 * Mark break rooms as terminating (countdown started). Keeps rooms data.
 * @param {string} roomName
 * @param {number} terminatingAt - epoch ms when countdown expires
 */
export function setBreakRoomsTerminating(roomName, terminatingAt) {
  const key = String(roomName || '').trim();
  if (!key) return;
  const entry = store.get(key);
  if (entry) {
    store.set(key, { ...entry, terminatingAt: Number(terminatingAt), updatedAt: Date.now() });
  }
}

/**
 * Get current break rooms state for a room. Returns null if not found or expired.
 * @param {string} roomName
 */
export function getBreakRoomsState(roomName) {
  const key = String(roomName || '').trim();
  if (!key) return null;
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > BREAK_ROOMS_TTL_MS) {
    store.delete(key);
    return null;
  }
  return entry;
}

/**
 * Clear break rooms state for a room (called when rooms end).
 * @param {string} roomName
 */
export function clearBreakRoomsState(roomName) {
  const key = String(roomName || '').trim();
  if (key) store.delete(key);
}
