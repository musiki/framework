import type { NoteListItem } from './types';

export type FrontmatterData = {
  title: string;
  type: string;
  chapter: string;
  status: string;
  order: number;
  theme: string;
  [key: string]: unknown;
};

// Browser-safe frontmatter parser — handles scalars and simple arrays
function parseYamlBlock(yaml: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  let currentKey: string | null = null;
  for (const line of yaml.split('\n')) {
    // YAML array item under a previous key: "  - value"
    const arrItem = /^[ \t]+-\s+(.*)$/.exec(line);
    if (arrItem && currentKey) {
      const existing = data[currentKey];
      const item = arrItem[1].trim();
      data[currentKey] = Array.isArray(existing) ? [...existing, item] : [item];
      continue;
    }
    const m = /^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) { currentKey = null; continue; }
    currentKey = m[1];
    let val: unknown = m[2].trim();
    if (val === '') {
      // empty value — may be followed by array items
      data[currentKey] = '';
      continue;
    }
    if (/^['"][\s\S]*['"]$/.test(val as string)) {
      val = (val as string).slice(1, -1);
    } else if (!isNaN(Number(val as string))) {
      val = Number(val);
    } else if (val === 'true') {
      val = true;
    } else if (val === 'false') {
      val = false;
    }
    data[currentKey] = val;
  }
  return data;
}

function stringifyYamlValue(v: unknown): string {
  if (Array.isArray(v)) {
    return '\n' + v.map(item => `  - ${stringifyYamlValue(item)}`).join('\n');
  }
  if (typeof v === 'string') {
    return /[:#\[\]{}|>&!'",%@`\n]/.test(v) ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : v;
  }
  return String(v);
}

export function parseFrontmatter(content: string): { data: FrontmatterData; body: string } {
  const normalized = content.replace(/^\uFEFF/, '');
  const match = /^(?:[ \t]*\r?\n)*---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(normalized);
  const raw = match ? parseYamlBlock(match[1]) : {};
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
  };
}

export function serializeFrontmatter(data: FrontmatterData, body: string): string {
  const fm: Record<string, unknown> = { ...data };
  if (!fm.theme) delete fm.theme;
  const lines = ['---'];
  for (const [k, v] of Object.entries(fm)) {
    if (v === null || v === undefined || v === '') continue;
    lines.push(`${k}: ${stringifyYamlValue(v)}`);
  }
  lines.push('---', '');
  const trimmed = body.replace(/^\n+/, '');
  return lines.join('\n') + trimmed;
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

  const themes = [...new Set(notes.map(n => n.theme).filter(Boolean) as string[])].sort();
  themeEl.innerHTML = '<option value="">—</option>';
  for (const th of themes) {
    const opt = document.createElement('option');
    opt.value = th;
    opt.textContent = th;
    themeEl.appendChild(opt);
  }

  typeEl.value = data.type;
  chapterEl.value = data.chapter || '';
  statusEl.value = data.status;
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
