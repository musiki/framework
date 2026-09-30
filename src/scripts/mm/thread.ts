// Thread page: votes (toggle buttons with counts) and the curator's "adopt as
// definition" dialog. The dialog loads the post's markdown source from
// GET /api/mm/threads/<id> into a textarea (text, never HTML), lets the
// curator pick en/nb and edit, and POSTs /api/mm/concepts/<slug>/adopt.
// Own posts: "Edit" moves the page's one edit form (move select + textarea
// with @citekey autocomplete, set up by composer.ts) into the post, filled
// with the markdown source (textarea value, never HTML), and PATCHes
// /api/mm/posts/<id> { action: 'edit' }; "Delete" asks in a dialog, then
// PATCHes { action: 'delete' }. Both reload onto the post.

import { mmApi, errorText, flash, pageStrings, reloadAt } from './api.ts';

const VOTE_KEYS: Record<string, 'useful' | 'clarifies' | 'reference'> = { '1': 'useful', '2': 'clarifies', '3': 'reference' };

function applyVotes(group: HTMLElement, votes: Record<string, number>, myVote: number): void {
  group.querySelectorAll<HTMLButtonElement>('button[data-mm-vote]').forEach((b) => {
    const value = b.dataset.mmVote ?? '';
    const key = VOTE_KEYS[value];
    b.setAttribute('aria-pressed', String(Number(value) === myVote));
    const count = b.querySelector('[data-mm-count]');
    if (count && key) count.textContent = String(votes?.[key] ?? 0);
  });
}

document.addEventListener('click', async (event) => {
  const btn = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-mm-vote]') : null;
  if (!btn || btn.disabled) return;
  const group = btn.closest<HTMLElement>('[data-mm-votes]');
  const postId = group?.dataset.postId;
  if (!group || !postId) return;
  const value = btn.getAttribute('aria-pressed') === 'true' ? 0 : Number(btn.dataset.mmVote);
  const buttons = group.querySelectorAll<HTMLButtonElement>('button[data-mm-vote]');
  buttons.forEach((b) => (b.disabled = true));
  try {
    const res = await mmApi<{ votes: Record<string, number>; myVote: number }>(
      `/api/mm/posts/${encodeURIComponent(postId)}/vote`,
      { method: 'POST', body: { value } },
    );
    applyVotes(group, res.votes, res.myVote);
  } catch (err) {
    flash(errorText(err));
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
});

function setupAdopt(): void {
  const dialog = document.querySelector<HTMLDialogElement>('dialog[data-mm-adopt-dialog]');
  if (!dialog) return;
  const form = dialog.querySelector<HTMLFormElement>('form');
  const textarea = dialog.querySelector<HTMLTextAreaElement>('textarea[name="definition"]');
  const lead = dialog.querySelector<HTMLElement>('[data-mm-adopt-lead]');
  const status = dialog.querySelector<HTMLElement>('[data-mm-form-status]');
  const submit = dialog.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!form || !textarea || !lead || !status || !submit) return;
  const s = pageStrings();
  const threadId = dialog.dataset.threadId ?? '';
  const conceptSlug = dialog.dataset.conceptSlug ?? '';
  let postId = '';
  let original = '';

  document.addEventListener('click', async (event) => {
    const btn = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-mm-adopt]') : null;
    if (btn) {
      postId = btn.dataset.postId ?? '';
      original = '';
      lead.textContent = (s['adopt.lead'] || '').replace('{name}', btn.dataset.author ?? '');
      textarea.value = '';
      textarea.placeholder = s['adopt.loading'] || '';
      textarea.disabled = true;
      submit.disabled = true;
      status.hidden = true;
      dialog.showModal();
      try {
        const view = await mmApi<{ posts: Array<{ id: string; body: string | null }> }>(
          `/api/mm/threads/${encodeURIComponent(threadId)}`,
        );
        const post = view.posts.find((p) => p.id === postId);
        original = post?.body ?? '';
        textarea.value = original;
        textarea.disabled = false;
        submit.disabled = false;
        textarea.placeholder = '';
        textarea.focus();
      } catch (err) {
        flash(errorText(err), status);
      }
      return;
    }
    if (event.target instanceof Element && event.target.closest('button[data-mm-dialog-close]')) dialog.close();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const lang = (form.querySelector<HTMLInputElement>('input[name="lang"]:checked')?.value ?? 'en') as 'en' | 'nb';
    const edited = textarea.value.replace(/\r\n/g, '\n');
    const body: Record<string, string> = { postId, lang };
    // Only send the text when the curator changed it; otherwise the server uses the post body.
    if (edited.trim() && edited !== original) body.definition = edited;
    submit.disabled = true;
    status.hidden = true;
    try {
      await mmApi(`/api/mm/concepts/${encodeURIComponent(conceptSlug)}/adopt`, { method: 'POST', body });
      reloadAt(`post-${postId}`);
    } catch (err) {
      flash(errorText(err), status);
      submit.disabled = false;
    }
  });
}

setupAdopt();

function setupOwnEdit(): void {
  const form = document.querySelector<HTMLFormElement>('form[data-mm-edit-form]');
  if (!form) return;
  const textarea = form.querySelector<HTMLTextAreaElement>('textarea[name="body"]');
  const move = form.querySelector<HTMLSelectElement>('select[name="move"]');
  const status = form.querySelector<HTMLElement>('[data-mm-form-status]');
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!textarea || !move || !status || !submit) return;
  const s = pageStrings();
  const threadId = form.dataset.threadId ?? '';
  let postId = '';
  let opener: HTMLButtonElement | null = null;
  let seq = 0;

  const bodyOf = (article: Element | null) => article?.querySelector<HTMLElement>(':scope > .mm-post-body') ?? null;

  const close = (focusOpener: boolean) => {
    seq++;
    const article = form.closest('article');
    const body = bodyOf(article);
    if (body) body.hidden = false;
    form.hidden = true;
    postId = '';
    if (opener) {
      opener.setAttribute('aria-expanded', 'false');
      if (focusOpener) opener.focus();
    }
    opener = null;
  };

  document.addEventListener('click', async (event) => {
    const el = event.target instanceof Element ? event.target : null;
    if (el?.closest('button[data-mm-edit-cancel]')) {
      close(true);
      return;
    }
    const btn = el?.closest<HTMLButtonElement>('button[data-mm-edit]') ?? null;
    if (!btn) return;
    const article = btn.closest('article');
    if (!article) return;
    if (!form.hidden) close(false);
    const mine = ++seq;
    postId = btn.dataset.postId ?? '';
    opener = btn;
    btn.setAttribute('aria-expanded', 'true');
    const body = bodyOf(article);
    const foot = article.querySelector(':scope > footer');
    article.insertBefore(form, foot);
    if (body) body.hidden = true;
    move.value = btn.dataset.move ?? '';
    textarea.value = '';
    textarea.placeholder = s['edit.loading'] || '';
    textarea.disabled = true;
    submit.disabled = true;
    status.hidden = true;
    form.hidden = false;
    try {
      const view = await mmApi<{ posts: Array<{ id: string; body: string | null; move: string | null }> }>(
        `/api/mm/threads/${encodeURIComponent(threadId)}`,
      );
      if (mine !== seq) return;
      const post = view.posts.find((p) => p.id === postId);
      if (!post || post.body === null) throw new Error('post unavailable');
      textarea.value = post.body;
      move.value = post.move ?? '';
      textarea.disabled = false;
      submit.disabled = false;
      textarea.placeholder = '';
      textarea.focus();
    } catch (err) {
      if (mine === seq) flash(errorText(err), status);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!postId || submit.disabled) return;
    const id = postId;
    submit.disabled = true;
    status.hidden = true;
    try {
      await mmApi(`/api/mm/posts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { action: 'edit', body: textarea.value.replace(/\r\n/g, '\n'), move: move.value || null },
      });
      reloadAt(`post-${id}`);
    } catch (err) {
      flash(errorText(err), status);
      submit.disabled = false;
    }
  });

  form.addEventListener('keydown', (event) => {
    // Escape closes the editor unless the citation list is open (composer.ts handles that one).
    if (event.key === 'Escape' && !event.defaultPrevented && textarea.getAttribute('aria-expanded') !== 'true') close(true);
  });
}

function setupOwnDelete(): void {
  const dialog = document.querySelector<HTMLDialogElement>('dialog[data-mm-delete-dialog]');
  const form = dialog?.querySelector<HTMLFormElement>('form');
  const status = dialog?.querySelector<HTMLElement>('[data-mm-form-status]');
  const submit = dialog?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!dialog || !form || !status || !submit) return;
  let postId = '';
  let opener: HTMLButtonElement | null = null;

  dialog.addEventListener('close', () => opener?.focus());

  document.addEventListener('click', (event) => {
    const el = event.target instanceof Element ? event.target : null;
    if (el?.closest('button[data-mm-delete-cancel]')) {
      dialog.close();
      return;
    }
    const btn = el?.closest<HTMLButtonElement>('button[data-mm-delete]') ?? null;
    if (!btn) return;
    postId = btn.dataset.postId ?? '';
    opener = btn;
    status.hidden = true;
    submit.disabled = false;
    dialog.showModal();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!postId) return;
    const id = postId;
    submit.disabled = true;
    status.hidden = true;
    try {
      await mmApi(`/api/mm/posts/${encodeURIComponent(id)}`, { method: 'PATCH', body: { action: 'delete' } });
      reloadAt(`post-${id}`);
    } catch (err) {
      flash(errorText(err), status);
      submit.disabled = false;
    }
  });
}

setupOwnEdit();
setupOwnDelete();
