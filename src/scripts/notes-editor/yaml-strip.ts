import matter from 'gray-matter';
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

export function parseFrontmatter(content: string): { data: FrontmatterData; body: string } {
  const parsed = matter(content);
  return {
    data: {
      title: String(parsed.data.title || ''),
      type: String(parsed.data.type || 'lesson'),
      chapter: String(parsed.data.chapter || ''),
      status: String(parsed.data.status || 'draft'),
      order: Number(parsed.data.order) || 0,
      theme: String(parsed.data.theme || ''),
      ...parsed.data,
    },
    body: parsed.content,
  };
}

export function serializeFrontmatter(data: FrontmatterData, body: string): string {
  const fm: Record<string, unknown> = { ...data };
  if (!fm.theme) delete fm.theme;
  return matter.stringify(body, fm);
}

export function populateYamlStrip(notes: NoteListItem[], data: FrontmatterData) {
  const typeEl = document.getElementById('fm-type') as HTMLSelectElement;
  const chapterEl = document.getElementById('fm-chapter') as HTMLSelectElement;
  const statusEl = document.getElementById('fm-status') as HTMLSelectElement;
  const orderEl = document.getElementById('fm-order') as HTMLInputElement;
  const themeEl = document.getElementById('fm-theme') as HTMLSelectElement;

  const chapters = [...new Set(notes.map(n => n.chapter).filter(Boolean))].sort();
  chapterEl.innerHTML = '';
  for (const ch of chapters) {
    const opt = document.createElement('option');
    opt.value = ch;
    opt.textContent = ch;
    chapterEl.appendChild(opt);
  }
  if (data.chapter && !chapters.includes(data.chapter)) {
    const opt = document.createElement('option');
    opt.value = data.chapter;
    opt.textContent = data.chapter;
    chapterEl.insertBefore(opt, chapterEl.firstChild);
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
  chapterEl.value = data.chapter;
  statusEl.value = data.status;
  orderEl.value = String(data.order);
  themeEl.value = data.theme || '';
}

export function readYamlStrip(): Partial<FrontmatterData> {
  return {
    type: (document.getElementById('fm-type') as HTMLSelectElement).value,
    chapter: (document.getElementById('fm-chapter') as HTMLSelectElement).value,
    status: (document.getElementById('fm-status') as HTMLSelectElement).value,
    order: Number((document.getElementById('fm-order') as HTMLInputElement).value) || 0,
    theme: (document.getElementById('fm-theme') as HTMLSelectElement).value || undefined,
  };
}
