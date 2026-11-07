import type { NoteListItem } from './types';
import { load, dump, CORE_SCHEMA } from 'js-yaml';
import { NOTE_TYPES, NOTE_STATUSES, optionsFor } from './note-metadata-schema.mjs';

/**
 * Carga las opciones de un <select> desde el esquema, incluyendo siempre el valor
 * actual de la nota aunque el esquema no lo conozca.
 *
 * Sin esto, asignar `select.value = 'concept'` a un select que sólo ofrece
 * lesson/eval/assignment/info deja el control vacío, y al guardar la nota se
 * degradaba a `lesson`. Lo mismo pasaba con `status: public` → `draft`.
 */
function fillSelect(el: HTMLSelectElement, opciones: string[], actual: string) {
  const lista = optionsFor({ options: opciones }, actual);
  el.innerHTML = '';
  for (const valor of lista) {
    const opt = document.createElement('option');
    opt.value = valor;
    opt.textContent = valor;
    el.appendChild(opt);
  }
  el.value = actual || lista[0] || '';
}

export type FrontmatterData = {
  title: string;
  type: string;
  chapter: string;
  status: string;
  order: number;
  theme: string;
  [key: string]: unknown;
};

// El frontmatter se lee y escribe con js-yaml. El parser casero anterior sólo
// entendía `clave: valor` y listas simples: claves con espacios (`born in
// city:`), mapas anidados o bloques `|` se perdían al guardar desde el editor.
// CORE_SCHEMA: sin timestamps, para que `date: 2026-03-01` vuelva como texto.
const YAML_OPTIONS = { schema: CORE_SCHEMA };

export class FrontmatterYamlError extends Error {}

/** Parsea el bloque YAML (sin los `---`). Lanza FrontmatterYamlError si no es válido. */
export function parseYamlBlock(yaml: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = load(yaml, YAML_OPTIONS);
  } catch (err) {
    const reason = err instanceof Error ? err.message.split('\n')[0] : String(err);
    throw new FrontmatterYamlError(reason);
  }
  if (parsed == null) return {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new FrontmatterYamlError('el frontmatter tiene que ser una lista de clave: valor');
  }
  return parsed as Record<string, unknown>;
}

/** Texto YAML de las propiedades (sin `---`). Omite las vacías salvo null, que queda como `clave:`. */
export function frontmatterToYaml(data: Record<string, unknown>): string {
  const fm: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === '') continue;
    fm[k] = v;
  }
  if (!Object.keys(fm).length) return '';
  return dump(fm, { ...YAML_OPTIONS, lineWidth: -1, noRefs: true, styles: { '!!null': 'empty' } });
}

const FRONTMATTER_RE = /^(?:[ \t]*\r?\n)*---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

export function parseFrontmatter(content: string): { data: FrontmatterData; body: string; raw: string; error: string | null } {
  const normalized = content.replace(/^\uFEFF/, '');
  const match = FRONTMATTER_RE.exec(normalized);
  const rawYaml = match ? match[1] : '';
  let raw: Record<string, unknown> = {};
  let error: string | null = null;
  try {
    raw = rawYaml ? parseYamlBlock(rawYaml) : {};
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const body = match ? normalized.slice(match[0].length) : normalized;
  return {
    data: {
      title: String(raw.title || ''),
      type: String(raw.type || 'lesson'),
      chapter: String(raw.chapter || ''),
      status: String(raw.status || 'draft'),
      order: Number(raw.order) || 0,
      theme: String(raw.theme || ''),
      ...raw,
    },
    body,
    raw: rawYaml,
    error,
  };
}

export function serializeFrontmatter(data: FrontmatterData, body: string): string {
  const fm: Record<string, unknown> = { ...data };
  if (!fm.theme) delete fm.theme;
  return joinFrontmatter(frontmatterToYaml(fm), body);
}

/** Arma la nota con un bloque YAML ya escrito (p. ej. el original, intacto). */
export function joinFrontmatter(yaml: string, body: string): string {
  const trimmed = body.replace(/^\n+/, '');
  return `---\n${yaml.replace(/\n*$/, '\n')}---\n${trimmed}`;
}

export function populateYamlStrip(notes: NoteListItem[], data: FrontmatterData, root: ParentNode = document) {
  const typeEl = root.querySelector<HTMLSelectElement>('#fm-type');
  const chapterEl = root.querySelector<HTMLInputElement>('#fm-chapter');
  const chapterList = root.querySelector<HTMLDataListElement>('#fm-chapter-list');
  const statusEl = root.querySelector<HTMLSelectElement>('#fm-status');
  const orderEl = root.querySelector<HTMLInputElement>('#fm-order');
  const themeEl = root.querySelector<HTMLSelectElement>('#fm-theme');
  if (!typeEl || !chapterEl || !statusEl || !orderEl || !themeEl) return;

  const chapters = [...new Set(notes.map(n => n.chapter).filter(Boolean))].sort();
  if (chapterList) {
    chapterList.innerHTML = '';
    for (const ch of chapters) {
      const opt = document.createElement('option');
      opt.value = ch;
      chapterList.appendChild(opt);
    }
  }

  // El tema sale de lo que usan las otras notas, más el de esta por si es nuevo.
  const themes = [...new Set(notes.map(n => n.theme).filter(Boolean) as string[])].sort();
  themeEl.innerHTML = '<option value="">—</option>';
  for (const th of optionsFor({ options: themes }, String(data.theme || ''))) {
    const opt = document.createElement('option');
    opt.value = th;
    opt.textContent = th;
    themeEl.appendChild(opt);
  }

  fillSelect(typeEl, NOTE_TYPES, String(data.type || ''));
  fillSelect(statusEl, NOTE_STATUSES, String(data.status || ''));
  chapterEl.value = data.chapter || '';
  orderEl.value = String(data.order);
  themeEl.value = data.theme || '';
}

export function readYamlStrip(root: ParentNode = document): Partial<FrontmatterData> {
  const typeEl = root.querySelector<HTMLSelectElement>('#fm-type');
  const chapterEl = root.querySelector<HTMLInputElement>('#fm-chapter');
  const statusEl = root.querySelector<HTMLSelectElement>('#fm-status');
  const orderEl = root.querySelector<HTMLInputElement>('#fm-order');
  const themeEl = root.querySelector<HTMLSelectElement>('#fm-theme');
  return {
    type: typeEl?.value,
    chapter: (chapterEl?.value || '').trim(),
    status: statusEl?.value,
    order: Number(orderEl?.value) || 0,
    theme: themeEl?.value || undefined,
  };
}
