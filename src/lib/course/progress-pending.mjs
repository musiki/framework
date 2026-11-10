// El punto rojo del ícono de Progreso en el ribbon: hay algo pendiente para hacer.
// Hoy «pendiente» son los repasos vencidos (daily.total de /api/progress/pod).
// El ribbon lo consulta al cargar la página con un caché corto por materia, y el
// pod lo refresca cada vez que carga, así el punto no queda viejo.

export const PENDING_TTL_MS = 5 * 60 * 1000;
export const PENDING_EVENT = 'musiki:progress-pending';

const key = (courseId) => `musiki:progress-pending:${courseId}`;

/** Lo cacheado si sigue vigente, o null. Tolerante a basura. */
export function readCachedPending(raw, now = Date.now()) {
  try {
    const parsed = JSON.parse(raw || 'null');
    if (!parsed || typeof parsed.count !== 'number' || typeof parsed.at !== 'number') return null;
    if (now - parsed.at > PENDING_TTL_MS || parsed.at > now) return null;
    return parsed.count;
  } catch {
    return null;
  }
}

/** Cuántas cosas pendientes hay según la respuesta de /api/progress/pod. */
export function pendingFromPod(data) {
  const total = Number(data?.daily?.total);
  return Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
}

export function pendingLabel(count) {
  if (!count) return '';
  return count === 1 ? 'Una idea pide volver' : `${count} ideas piden volver`;
}

/** Guarda el conteo y avisa al ribbon. Lo llama el pod después de cargar. */
export function publishPending(courseId, count) {
  if (!courseId) return;
  try { sessionStorage.setItem(key(courseId), JSON.stringify({ count, at: Date.now() })); } catch { /* sin storage */ }
  window.dispatchEvent(new CustomEvent(PENDING_EVENT, { detail: { courseId, count } }));
}

/** El conteo de la materia: del caché si está fresco, si no del servidor. */
export async function loadPending(courseId) {
  if (!courseId) return 0;
  let cached = null;
  try { cached = readCachedPending(sessionStorage.getItem(key(courseId))); } catch { /* sin storage */ }
  if (cached !== null) return cached;
  const res = await fetch(`/api/progress/pod?courseId=${encodeURIComponent(courseId)}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) return 0;
  const count = pendingFromPod(await res.json());
  try { sessionStorage.setItem(key(courseId), JSON.stringify({ count, at: Date.now() })); } catch { /* sin storage */ }
  return count;
}
