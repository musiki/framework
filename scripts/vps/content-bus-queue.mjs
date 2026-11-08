// Lógica pura del Content Bus: la cola de avisos, lo que se muestra en el beacon
// y el comando de recarga. Sin servidor ni procesos, para poder testearla.

export const normalizeBranchName = (value) => String(value || '').trim().replace(/^refs\/heads\//, '');

export const normalizeRepoSlug = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('git@github.com:')) {
    return text.slice('git@github.com:'.length).replace(/\.git$/i, '').toLowerCase();
  }
  return text
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+/, '')
    .toLowerCase();
};

export const normalizeCommitSha = (value) => {
  const text = String(value || '').trim();
  return /^[0-9a-f]{7,40}$/i.test(text) ? text : '';
};

/**
 * Suma avisos a la cola, uno por repo: si el mismo repo avisa dos veces, queda
 * el último (su commit es el más nuevo) y pasa al final. Un pipeline trae todos
 * los repos, así que alcanza con una corrida para todos los avisos pendientes.
 */
export function mergePending(pending = [], incoming = []) {
  const byRepo = new Map();
  for (const payload of [...pending, ...incoming]) {
    if (!payload || typeof payload !== 'object') continue;
    const key = normalizeRepoSlug(payload.source_repo) || '(sin repo)';
    byRepo.delete(key);
    byRepo.set(key, payload);
  }
  return [...byRepo.values()];
}

/** Lo que el beacon muestra de una corrida: materia y commit de cada aviso. */
export function sourcesOf(payloads = []) {
  return payloads.map((p) => {
    const repo = normalizeRepoSlug(p?.source_repo);
    return {
      repo,
      course: repo.split('/').pop() || '',
      sha: normalizeCommitSha(p?.source_sha).slice(0, 7),
      ref: normalizeBranchName(p?.source_ref),
    };
  });
}

/**
 * Recarga de las apps del ecosystem salvo el propio bus. Si el bus se recarga
 * a sí mismo, pm2 mata también al deploy que lanzó (treekill) y se pierden el
 * resultado y los avisos en cola. `pm2 reload --only` no acepta listas, por eso
 * va una app por vez.
 */
export function reloadCommandFor(apps = [], busScript = 'scripts/vps/content-bus.mjs') {
  const names = apps.filter((a) => a && a.script !== busScript).map((a) => a.name).filter(Boolean);
  return names
    .map((n) => `{ pm2 reload ecosystem.config.cjs --only ${n} --update-env || pm2 start ecosystem.config.cjs --only ${n} --update-env; }`)
    .join(' && ');
}
