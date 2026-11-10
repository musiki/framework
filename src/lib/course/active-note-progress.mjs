// «En esta nota», el bloque de arriba del pod Progreso: qué se evalúa en la nota
// que se está leyendo y a qué requisito de la rúbrica cuenta cada cosa, para que
// la nota activa se lea sobre el mapa completo. Sin DOM, para poder testearla.

/** Requisito de la rúbrica al que cuenta cada tipo de evaluación (igual que /api/progress/pod). */
export const RUBRIC_KEY_BY_EVAL_TYPE = {
  proyecto: 'proyecto',
  conexion: 'conexiones',
  coloquio: 'coloquios',
  peer_rubric: 'estigmergia',
  short_ai: 'aporte',
  essay_ai: 'aporte',
  reference_ai: 'aporte',
};

export const RUBRIC_KEYS = ['proyecto', 'conexiones', 'coloquios', 'estigmergia', 'aporte'];

/**
 * @param {Array<{ id: string, label?: string, type?: string, complete?: boolean }>} items
 *   las evaluaciones de la nota activa, en orden de aparición
 */
export function summarizeActiveNote(items = []) {
  const evals = items
    .filter((item) => item && item.id)
    .map((item) => ({
      id: String(item.id),
      label: String(item.label || item.id),
      type: String(item.type || ''),
      complete: Boolean(item.complete),
      rubricKey: RUBRIC_KEY_BY_EVAL_TYPE[String(item.type || '')] || '',
    }));
  const reading = evals.filter((e) => e.type === 'mcc');
  return {
    evals,
    done: evals.filter((e) => e.complete).length,
    reading: reading.length
      ? { done: reading.filter((e) => e.complete).length, total: reading.length }
      : null,
    // Requisitos que esta nota toca, en el orden de la rúbrica.
    rubricKeys: RUBRIC_KEYS.filter((key) => evals.some((e) => e.rubricKey === key)),
  };
}
