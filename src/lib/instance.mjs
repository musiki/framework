export const INSTANCES = ['musiki', 'hem'];

export function currentInstance(env = process.env) {
  const raw = String(env?.MUSIKI_INSTANCE ?? '').trim();
  if (!raw) return 'musiki';
  if (!INSTANCES.includes(raw)) {
    throw new Error(`Unknown MUSIKI_INSTANCE "${raw}" (expected musiki or hem)`);
  }
  return raw;
}

export function contentManifestPath(instance) {
  return instance === 'hem' ? 'config/sources.hem.json' : 'config/sources.manifest.json';
}
