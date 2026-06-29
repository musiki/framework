// Shared builder for the "Propiedades" section of the page-info sidebar.
// Used by [...slug].astro (server render) and /api/get-note-content (so the
// panel can refresh client-side when the active note changes in Dockview).

export type PagePropertyKind = 'links' | 'list' | 'text' | 'json';

export interface PageProperty {
  key: string;
  kind: PagePropertyKind;
  value: string;
  items: string[];
}

const PROPERTY_ORDER = [
  'type', 'def', 'alias', 'status', 'project', 'person', 'year',
  'tags', 'hyper', 'hypo', 'connect', 'author', 'source', 'work', 'parent', 'spaced',
];
const PROPERTY_HIDDEN = new Set([
  'title', 'slug', 'shortSlug', 'summary', 'description', 'theme', 'slideTheme',
  'revealTheme', 'reveal', 'coverImage', 'coverUrl', 'img', 'image', 'photo',
  'url', 'visibility', 'order', 'chapter', 'updatedAt', 'updatedBy', 'editSummary',
]);
const RELATION_KEYS = new Set(['hypo', 'hyper', 'connect', 'parent']);

export const stripWikilink = (value: string): string =>
  String(value).replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();

export function buildPageProperties(data: Record<string, unknown> | null | undefined): PageProperty[] {
  const source = (data || {}) as Record<string, unknown>;
  const keys = Object.keys(source);
  const ordered = [
    ...PROPERTY_ORDER.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !PROPERTY_ORDER.includes(k)),
  ];
  const out: PageProperty[] = [];
  for (const key of ordered) {
    if (PROPERTY_HIDDEN.has(key)) continue;
    const raw = source[key];
    if (raw === undefined || raw === null || raw === '') continue;
    if (Array.isArray(raw)) {
      const items = raw.map((v) => String(v ?? '').trim()).filter(Boolean);
      if (items.length === 0) continue;
      if (RELATION_KEYS.has(key)) out.push({ key, kind: 'links', value: '', items: items.map(stripWikilink) });
      else out.push({ key, kind: 'list', value: '', items });
    } else if (typeof raw === 'object') {
      out.push({ key, kind: 'json', value: JSON.stringify(raw), items: [] });
    } else if (RELATION_KEYS.has(key)) {
      out.push({ key, kind: 'links', value: '', items: [stripWikilink(String(raw))] });
    } else {
      out.push({ key, kind: 'text', value: String(raw), items: [] });
    }
  }
  return out;
}
