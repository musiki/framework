// Texto del beacon de sincronización (el logo del header): qué materia y qué
// commit se está publicando, o cuál fue lo último que llegó a producción.

const listSources = (sources) =>
  (Array.isArray(sources) ? sources : [])
    .map((s) => [s?.course || s?.repo || '', s?.sha ? `@ ${s.sha}` : ''].filter(Boolean).join(' '))
    .filter(Boolean)
    .join(', ');

/**
 * @param {Record<string, unknown>} payload  respuesta de /api/internal/build-status
 * @param {{ frameworkCommit?: string, formatTime?: (v: unknown) => string }} [opts]
 * @returns {string} '' si no hay nada que decir (el header usa su título por defecto)
 */
export function describeSync(payload, { frameworkCommit = '', formatTime = () => '' } = {}) {
  const state = String(payload?.state || 'unknown').trim() || 'unknown';
  const current = listSources(payload?.sources);
  const last = payload?.lastDeployed && typeof payload.lastDeployed === 'object' ? payload.lastDeployed : null;
  const lastList = listSources(last?.sources);
  const framework = frameworkCommit ? `framework #${frameworkCommit}` : '';
  const join = (...parts) => parts.filter(Boolean).join(' · ');

  if (state === 'running') {
    return join(`Publicando ${current || 'contenido'}`, String(payload?.title || '').trim());
  }
  if (state === 'ok') {
    return join(`Publicado ${lastList || current || 'contenido'}`, formatTime(last?.at || payload?.updatedAt), framework);
  }
  if (state === 'error') {
    return join(
      `Falló la publicación de ${current || 'contenido'}`,
      formatTime(payload?.updatedAt),
      lastList ? `último publicado: ${lastList} (${formatTime(last?.at)})` : '',
    );
  }
  if (state === 'idle') {
    return lastList
      ? join(`Último publicado: ${lastList}`, formatTime(last?.at), framework)
      : join('Sincronización sin cambios', framework);
  }
  return '';
}
