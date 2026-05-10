import { query } from '../db/pool';

const FALLBACK_RESOURCE_TYPES = new Set(['pdf', 'img', 'md', 'tex', 'ly', 'audio', 'link', 'other']);
const FALLBACK_RESOURCE_SOURCES = new Set(['upload', 'chat', 'external-media', 'sa', 'sv', 'paste']);

const enumCache = new Map<string, { labels: Set<string>; loadedAt: number }>();
const ENUM_CACHE_TTL_MS = 60_000;

async function getEnumLabels(typeName: string, fallback: Set<string>): Promise<Set<string>> {
  const cached = enumCache.get(typeName);
  if (cached && Date.now() - cached.loadedAt < ENUM_CACHE_TTL_MS) return cached.labels;

  const result = await query<{ enumlabel: string }>(
    `SELECT e.enumlabel
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = $1
      ORDER BY e.enumsortorder`,
    [typeName],
  );

  const labels = result.error || !result.data?.length
    ? new Set(fallback)
    : new Set(result.data.map((row) => String(row.enumlabel || '').trim()).filter(Boolean));

  enumCache.set(typeName, { labels, loadedAt: Date.now() });
  return labels;
}

export async function normalizeDbResourceType(type: string): Promise<string> {
  const labels = await getEnumLabels('ResourceType', FALLBACK_RESOURCE_TYPES);
  const requested = String(type || '').trim();

  if (requested === 'video' && !labels.has('video')) {
    return labels.has('audio') ? 'audio' : 'other';
  }

  return labels.has(requested) ? requested : 'other';
}

export async function normalizeDbResourceSource(source: string): Promise<string> {
  const labels = await getEnumLabels('ResourceSource', FALLBACK_RESOURCE_SOURCES);
  const requested = String(source || '').trim();

  if (requested === 'vs' && !labels.has('vs')) {
    return labels.has('sv') ? 'sv' : 'upload';
  }

  return labels.has(requested) ? requested : 'upload';
}
