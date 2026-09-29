// Composer helpers: `@citekey` autocomplete against the forum's bibliography
// (GET /api/mm/forums/<group slug | forum id>/citations?q=; a channel is
// addressed by id and uses its effective, inherited bibliography) and reply
// targeting.
//
// <textarea data-mm-cite="<group slug | channel id>"> gets a listbox of references while
// the caret follows `@partial`; ArrowUp/Down move, Enter/Tab insert, Escape
// closes. Results are rendered with textContent only.
//
// <button data-mm-reply data-post-id data-author> fills the composer's hidden
// parentPostId and shows "Replying to …" with a cancel button.

import { findCitekeyQuery, insertCitekey } from '../../lib/mm/client-core.ts';
import { pageStrings } from './api.ts';

type Citation = { citekey: string; title: string; authors: string[]; year: number | null };

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;
let listSeq = 0;

function setupCite(textarea: HTMLTextAreaElement): void {
  const forum = textarea.dataset.mmCite;
  if (!forum) return;
  const s = pageStrings();
  const listId = `mm-cite-list-${++listSeq}`;

  const wrap = document.createElement('div');
  wrap.className = 'mm-cite-wrap';
  textarea.parentElement?.insertBefore(wrap, textarea);
  wrap.appendChild(textarea);

  const list = document.createElement('ul');
  list.id = listId;
  list.className = 'mm-cite-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', s['cite.label'] || 'References');
  list.hidden = true;
  wrap.appendChild(list);

  const status = document.createElement('p');
  status.className = 'mm-cite-status';
  status.setAttribute('aria-live', 'polite');
  wrap.after(status);

  textarea.setAttribute('aria-autocomplete', 'list');
  textarea.setAttribute('aria-controls', listId);
  textarea.setAttribute('aria-expanded', 'false');

  let items: Citation[] = [];
  let active = -1;
  let span: { start: number; query: string } | null = null;
  let timer: number | undefined;
  let seq = 0;
  let disabledUntil = 0;

  const close = () => {
    list.hidden = true;
    list.replaceChildren();
    items = [];
    active = -1;
    textarea.setAttribute('aria-expanded', 'false');
    textarea.removeAttribute('aria-activedescendant');
  };

  const highlight = (i: number) => {
    active = i;
    list.querySelectorAll('li').forEach((li, j) => li.setAttribute('aria-selected', j === i ? 'true' : 'false'));
    const li = list.children[i] as HTMLElement | undefined;
    if (li) {
      textarea.setAttribute('aria-activedescendant', li.id);
      li.scrollIntoView({ block: 'nearest' });
    }
  };

  const choose = (i: number) => {
    const item = items[i];
    if (!item || !span) return;
    const { text, caret } = insertCitekey(textarea.value, span.start, textarea.selectionStart ?? textarea.value.length, item.citekey);
    textarea.value = text;
    textarea.setSelectionRange(caret, caret);
    textarea.focus();
    status.textContent = '';
    close();
  };

  const render = () => {
    list.replaceChildren();
    items.forEach((item, i) => {
      const li = document.createElement('li');
      li.id = `${listId}-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      const key = document.createElement('span');
      key.className = 'mm-cite-key';
      key.textContent = `@${item.citekey}`;
      const rest = document.createElement('span');
      const who = [item.authors?.slice(0, 2).join(', '), item.year ?? ''].filter(Boolean).join(', ');
      rest.textContent = ` ${item.title || ''}${who ? ` (${who})` : ''}`;
      li.append(key, rest);
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        choose(i);
      });
      list.appendChild(li);
    });
    list.hidden = items.length === 0;
    textarea.setAttribute('aria-expanded', items.length ? 'true' : 'false');
    if (items.length) highlight(0);
  };

  const search = async (query: string) => {
    const mine = ++seq;
    status.textContent = s['cite.searching'] || '';
    try {
      const res = await fetch(`/api/mm/forums/${encodeURIComponent(forum)}/citations?q=${encodeURIComponent(query)}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (mine !== seq) return;
      if (res.status === 429) {
        // Back off quietly; the writer can keep typing the key by hand.
        disabledUntil = Date.now() + 30_000;
        status.textContent = s['error.rateLimited'] || '';
        close();
        return;
      }
      if (!res.ok) {
        status.textContent = s['cite.unavailable'] || '';
        close();
        return;
      }
      const data = await res.json();
      if (mine !== seq) return;
      items = Array.isArray(data?.items) ? data.items.filter((c: any) => c && typeof c.citekey === 'string') : [];
      status.textContent = items.length ? '' : s['cite.none'] || '';
      render();
    } catch {
      if (mine === seq) {
        status.textContent = s['cite.unavailable'] || '';
        close();
      }
    }
  };

  textarea.addEventListener('input', () => {
    window.clearTimeout(timer);
    span = findCitekeyQuery(textarea.value, textarea.selectionStart ?? 0);
    if (!span || span.query.length < MIN_QUERY || Date.now() < disabledUntil) {
      if (!span) status.textContent = '';
      close();
      return;
    }
    const query = span.query;
    timer = window.setTimeout(() => search(query), DEBOUNCE_MS);
  });

  textarea.addEventListener('keydown', (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlight((active + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlight((active - 1 + items.length) % items.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (active >= 0) {
        e.preventDefault();
        choose(active);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  textarea.addEventListener('blur', () => window.setTimeout(close, 150));
}

function setupReplies(): void {
  const form = document.querySelector<HTMLFormElement>('form[data-mm-reply-form]');
  if (!form) return;
  const parent = form.querySelector<HTMLInputElement>('input[name="parentPostId"]');
  const note = form.querySelector<HTMLElement>('[data-mm-replying]');
  const noteText = form.querySelector<HTMLElement>('[data-mm-replying-text]');
  const textarea = form.querySelector<HTMLTextAreaElement>('textarea');
  const s = pageStrings();

  document.addEventListener('click', (event) => {
    const btn = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-mm-reply]') : null;
    if (btn && parent && note && noteText) {
      parent.value = btn.dataset.postId ?? '';
      noteText.textContent = (s['reply.to'] || '{name}').replace('{name}', btn.dataset.author ?? '');
      note.hidden = false;
      form.scrollIntoView({ block: 'start' });
      textarea?.focus();
      return;
    }
    const cancel = event.target instanceof Element ? event.target.closest('button[data-mm-reply-cancel]') : null;
    if (cancel && parent && note) {
      parent.value = '';
      note.hidden = true;
      textarea?.focus();
    }
  });
}

document.querySelectorAll<HTMLTextAreaElement>('textarea[data-mm-cite]').forEach(setupCite);
setupReplies();
