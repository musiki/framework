import { Cite } from '@citation-js/core';
import '@citation-js/plugin-csl';
import { visit } from 'unist-util-visit';

const CITE_RE = /\[@([A-Za-z0-9:_-]{1,160})\]/g;
const CACHE_TTL_MS = 60_000;
const cache = new Map();

const normalizeHeading = (node) => String(node?.children?.map((child) => child.value || '').join('') || '')
  .trim().toLocaleLowerCase();

async function resolveCitations(keys) {
  const unique = [...new Set(keys)];
  const now = Date.now();
  const found = new Map();
  const missing = [];
  for (const key of unique) {
    const cached = cache.get(key);
    if (cached && cached.expires > now) found.set(key, cached.item);
    else missing.push(key);
  }

  if (missing.length) {
    const token = String(process.env.SESHAT_INTEGRATION_TOKEN || '').trim();
    if (!token) return found;
    const baseUrl = String(process.env.SESHAT_API_URL || 'https://seshat.zztt.org').replace(/\/$/, '');
    const url = new URL('/api/integrations/citations/resolve', baseUrl);
    missing.forEach((key) => url.searchParams.append('key', key));
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Seshat-Owner': String(process.env.SESHAT_CITATION_OWNER_EMAIL || 'integration@musiki.local'),
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Seshat citation resolution failed (${response.status})`);
    const payload = await response.json();
    for (const item of Array.isArray(payload?.items) ? payload.items : []) {
      if (!item?.id) continue;
      cache.set(String(item.id), { item, expires: now + CACHE_TTL_MS });
      found.set(String(item.id), item);
    }
  }
  return found;
}

export default function remarkSeshatCitations(options = {}) {
  const headingText = String(options.headingText || 'Referencias');
  const lang = String(options.lang || 'es-ES');
  const template = String(options.template || 'apa');

  return async (tree, file) => {
    const occurrences = [];
    const keys = [];
    visit(tree, 'text', (node, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      const value = String(node.value || '');
      CITE_RE.lastIndex = 0;
      const matches = [...value.matchAll(CITE_RE)];
      if (!matches.length) return;
      occurrences.push({ node, index, parent, matches });
      matches.forEach((match) => keys.push(match[1]));
    });
    if (!keys.length) return;

    let resolved;
    try {
      resolved = await resolveCitations(keys);
    } catch (error) {
      console.warn('[remark-seshat-citations]', file?.path || 'runtime note', error);
      return;
    }
    const uniqueKeys = [...new Set(keys)];
    const orderedItems = uniqueKeys.map((key) => resolved.get(key)).filter(Boolean);
    if (!orderedItems.length) return;
    const cite = new Cite(orderedItems);

    for (const occurrence of [...occurrences].reverse()) {
      const parts = [];
      let cursor = 0;
      for (const match of occurrence.matches) {
        const start = match.index || 0;
        if (start > cursor) parts.push({ type: 'text', value: occurrence.node.value.slice(cursor, start) });
        const key = match[1];
        if (!resolved.has(key)) {
          parts.push({ type: 'text', value: match[0] });
        } else {
          const html = cite.format('citation', { format: 'html', template, lang, entry: [key] });
          parts.push({ type: 'html', value: `<span class="seshat-citation" data-citekey="${key}">${html}</span>` });
        }
        cursor = start + match[0].length;
      }
      if (cursor < occurrence.node.value.length) parts.push({ type: 'text', value: occurrence.node.value.slice(cursor) });
      occurrence.parent.children.splice(occurrence.index, 1, ...parts);
    }

    const hasReferencesHeading = tree.children.some(
      (node) => node.type === 'heading' && ['referencias', 'references'].includes(normalizeHeading(node)),
    );
    if (!hasReferencesHeading) {
      tree.children.push({ type: 'heading', depth: 1, children: [{ type: 'text', value: headingText }] });
    }
    tree.children.push({
      type: 'html',
      value: `<section class="seshat-references" data-citekeys="${uniqueKeys.join(' ')}">${cite.format('bibliography', {
        format: 'html', template, lang, entry: uniqueKeys,
      })}</section>`,
    });
  };
}
