// Lógica pura de cohortes: cómo se arma y se valida una etiqueta.
// Separada del endpoint para poder testearla sin base de datos.

const limpiar = (v) => String(v ?? '').trim();

/** Los períodos que la UI ofrece. `anual` es el default de la carrera. */
export const TERMS = ['anual', '1c', '2c', 'verano'];

const TERM_LABEL = {
  anual: '',
  '1c': '1er cuatrimestre',
  '2c': '2do cuatrimestre',
  verano: 'verano',
};

/**
 * Arma la etiqueta visible de una cohorte.
 *
 * Es texto libre en la base a propósito —cada carrera nombra distinto— pero la
 * sugerencia sigue un formato único para que la lista quede ordenable a ojo:
 *
 *   2027
 *   2027 · 2do cuatrimestre
 *   2027 · Comisión 2
 *   2027 · 1er cuatrimestre · Comisión 2
 */
export function suggestCohortLabel({ year, term = 'anual', comision = null } = {}) {
  const partes = [];
  const anio = Number(year);
  partes.push(Number.isFinite(anio) && anio > 0 ? String(Math.trunc(anio)) : String(new Date().getFullYear()));

  const t = limpiar(term).toLowerCase();
  if (t && t !== 'anual') partes.push(TERM_LABEL[t] ?? t);

  const c = limpiar(comision);
  if (c) partes.push(/^\d+$/.test(c) ? `Comisión ${c}` : c);

  return partes.join(' · ');
}

/**
 * Valida y normaliza lo que llega del cliente.
 * Devuelve `{ ok: true, value }` o `{ ok: false, error }`.
 */
export function normalizeCohortInput(body = {}) {
  const courseId = limpiar(body.courseId);
  if (!courseId) return { ok: false, error: 'Falta el courseId.' };

  const term = limpiar(body.term).toLowerCase() || 'anual';
  if (!TERMS.includes(term)) {
    return { ok: false, error: `Período inválido: "${term}". Valores: ${TERMS.join(', ')}.` };
  }

  const yearRaw = body.year == null || limpiar(body.year) === '' ? null : Number(body.year);
  if (yearRaw !== null && (!Number.isFinite(yearRaw) || yearRaw < 2000 || yearRaw > 2100)) {
    return { ok: false, error: 'El año tiene que estar entre 2000 y 2100.' };
  }
  const year = yearRaw === null ? new Date().getFullYear() : Math.trunc(yearRaw);

  const label = limpiar(body.label) || suggestCohortLabel({ year, term, comision: body.comision });
  if (label.length > 120) return { ok: false, error: 'La etiqueta es demasiado larga.' };

  return {
    ok: true,
    value: {
      courseId,
      label,
      year,
      term,
      // Por defecto la cohorte nueva pasa a ser la activa: es lo que uno quiere
      // al apretar el botón en marzo. Se puede crear inactiva para prepararla antes.
      activate: body.activate === undefined ? true : Boolean(body.activate),
      // Los docentes se arrastran; los estudiantes no. Esa es toda la gracia.
      copyTeachers: body.copyTeachers === undefined ? true : Boolean(body.copyTeachers),
    },
  };
}
