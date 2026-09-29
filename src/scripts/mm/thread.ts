// Thread page: votes (toggle buttons with counts) and the curator's "adopt as
// definition" dialog. The dialog loads the post's markdown source from
// GET /api/mm/threads/<id> into a textarea (text, never HTML), lets the
// curator pick en/nb and edit, and POSTs /api/mm/concepts/<slug>/adopt.

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
