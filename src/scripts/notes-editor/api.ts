import type { NoteListItem, NoteContent } from './types';

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

export function listNotes(courseId: string): Promise<{ notes: NoteListItem[] }> {
  return apiFetch(`/api/notes/list?courseId=${encodeURIComponent(courseId)}`);
}

export function getNote(courseId: string, slug: string, options: { rendered?: boolean } = {}): Promise<NoteContent> {
  const rendered = options.rendered ? '&rendered=true' : '';
  return apiFetch(`/api/notes/get?courseId=${encodeURIComponent(courseId)}&slug=${encodeURIComponent(slug)}${rendered}`);
}

export function saveNote(courseId: string, slug: string, content: string): Promise<{ ok: boolean }> {
  return apiFetch('/api/notes/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseId, slug, content }),
  });
}

export function createNote(courseId: string, opts: {
  slug: string; title: string; type: string; chapter: string; status: string; order: number;
}): Promise<{ ok: boolean; slug: string; content: string }> {
  return apiFetch('/api/notes/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseId, ...opts }),
  });
}

export function deleteNote(courseId: string, slug: string): Promise<{ ok: boolean }> {
  return apiFetch('/api/notes/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseId, slug }),
  });
}

export function moveNote(courseId: string, slug: string, newSlug: string): Promise<{ ok: boolean; slug: string }> {
  return apiFetch('/api/notes/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseId, slug, newSlug }),
  });
}
