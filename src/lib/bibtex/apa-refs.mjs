// Bloques ```bibtex → referencias APA 7 con botones de copia (APA y BibTeX).
// El formato lo hace citation-js con la plantilla CSL de APA, la misma que usan
// las citas de Seshat; acá sólo se arma el HTML alrededor.
import { Cite } from '@citation-js/core';
import '@citation-js/plugin-bibtex';
import '@citation-js/plugin-csl';

const escapeAttr = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Autores en negrita: lo que va antes del año entre paréntesis. Cubre `(1960)`,
 * `(1960a)`, `(2020, marzo 3)`, `(s. f.)` y `(n.d.)`. Si no hay año, no marca nada.
 */
export const accentBibliographyAuthors = (html) => String(html).replace(
  /(<div[^>]*class="csl-entry"[^>]*>)(.*?)(?=\s+\((?:\d{4}[a-z]?(?:,[^)]*)?|s\.\s*f\.|n\.d\.)\))/g,
  '$1<span class="csl-author">$2</span>',
);

/**
 * Corta el texto en entradas `@tipo{clave, ...}` respetando llaves anidadas
 * (`title = {El {Bach} tardío}`), que un regex corta en la primera `}`.
 */
export function splitBibtexEntries(source) {
  const s = String(source || '').replace(/^﻿/, '');
  const entries = [];
  const head = /@(\w+)\s*([{(])/g;
  let m;
  while ((m = head.exec(s)) !== null) {
    if (/^(comment|preamble|string)$/i.test(m[1])) continue;
    const open = m[2];
    const close = open === '{' ? '}' : ')';
    let depth = 0;
    let end = -1;
    for (let i = m.index + m[0].length - 1; i < s.length; i += 1) {
      const ch = s[i];
      if (ch === open || (open === '(' && ch === '{')) depth += 1;
      else if (ch === close || (open === '(' && ch === '}')) {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) break; // entrada sin cerrar: lo que sigue no es confiable
    const raw = s.slice(m.index, end + 1);
    const key = (/^@\w+\s*[{(]\s*([^,\s]+)/.exec(raw) || [])[1] || '';
    entries.push({ key, raw });
    head.lastIndex = end + 1;
  }
  return entries;
}

const ICONS = {
  apa: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M5.5 4.5h7M5.5 8h7M5.5 11.5h4.5"/><path fill="currentColor" d="M2.2 3.6h1.6v1.6H2.2zM2.2 7.2h1.6v1.6H2.2zM2.2 10.7h1.6v1.6H2.2z"/></svg>',
  bibtex: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M5.5 2.5c-1.5 0-2 .6-2 1.8v1.6c0 1-.5 1.6-1.5 2.1 1 .5 1.5 1.1 1.5 2.1v1.6c0 1.2.5 1.8 2 1.8M10.5 2.5c1.5 0 2 .6 2 1.8v1.6c0 1 .5 1.6 1.5 2.1-1 .5-1.5 1.1-1.5 2.1v1.6c0 1.2-.5 1.8-2 1.8"/></svg>',
};

const TIPS = {
  apa: 'Copiar en APA 7 — al pegar en Word o Docs conserva las cursivas',
  bibtex: 'Copiar BibTeX — para Zotero, LaTeX o tu gestor de referencias',
  'apa-all': 'Copiar todas en APA 7 — al pegar en Word o Docs conserva las cursivas',
  'bibtex-all': 'Copiar todo el BibTeX',
};

const button = (kind) =>
  `<button type="button" class="bib-copy-btn" data-bib-copy="${kind}" data-tip="${escapeAttr(TIPS[kind])}" aria-label="${escapeAttr(TIPS[kind])}">${ICONS[kind.replace('-all', '')]}</button>`;

// DOI y URLs como links; citation-js los deja como texto.
const linkify = (html) => html.replace(
  /(^|[\s>])(https?:\/\/[^\s<]+?)(?=[.,;]?(?:\s|<|$))/g,
  (_, pre, url) => `${pre}<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${url}</a>`,
);

// `{\'\i}` sale como ı + acento combinado, que no compone a í.
const fixGlyphs = (html) => html.normalize('NFC').replace(/ı́/g, 'í').replace(/ı̀/g, 'ì');

export class BibtexRenderError extends Error {}

/**
 * HTML de un bloque BibTeX, o null si no tiene entradas. Lanza
 * BibtexRenderError si alguna entrada no se pudo leer: mejor dejar el bloque
 * crudo que publicar una lista a la que le falta una referencia.
 */
export function renderBibtexBlock(source, { lang = 'es-ES' } = {}) {
  const entries = splitBibtexEntries(source);
  if (!entries.length) return null;
  const rawByKey = new Map(entries.map((e) => [e.key, e.raw]));

  let cite;
  try {
    cite = new Cite(entries.map((e) => e.raw).join('\n\n'));
  } catch (err) {
    throw new BibtexRenderError(err instanceof Error ? err.message : String(err));
  }
  const parsed = new Set(cite.data.map((d) => String(d.id)));
  const lost = entries.filter((e) => !parsed.has(e.key)).map((e) => e.key || e.raw.slice(0, 40));
  if (lost.length) throw new BibtexRenderError(`entradas ilegibles: ${lost.join(', ')}`);

  const bibliography = accentBibliographyAuthors(
    cite.format('bibliography', { format: 'html', template: 'apa', lang }),
  );
  const items = [];
  const entryRe = /<div data-csl-entry-id="([^"]*)" class="csl-entry">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = entryRe.exec(bibliography)) !== null) {
    const key = m[1];
    const text = linkify(fixGlyphs(m[2].trim()));
    items.push(
      `<div class="bib-ref" data-bib-key="${escapeAttr(key)}" data-bibtex="${escapeAttr(rawByKey.get(key) || '')}">` +
      `<div class="bib-ref-text csl-entry">${text}</div>` +
      `<div class="bib-ref-actions">${button('apa')}${button('bibtex')}</div>` +
      '</div>',
    );
  }
  if (items.length !== entries.length) {
    throw new BibtexRenderError(`se formatearon ${items.length} de ${entries.length} entradas`);
  }

  const toolbar = items.length > 1
    ? `<div class="bib-refs-toolbar">${button('apa-all')}${button('bibtex-all')}</div>`
    : '';
  return `<div class="bib-refs" data-bib-refs>${toolbar}<div class="bib-refs-list">${items.join('')}</div></div>`;
}
