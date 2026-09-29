// Progressive forms and action buttons of the mm pages.
//
// <form data-mm-form data-endpoint="/api/mm/…" data-method="POST|PATCH" data-then="…">
//   Named fields become a JSON object; empty values are left out (optional
//   Bokmål fields, "no move"). data-then:
//     reload        reload the page
//     reload-post   reload at #post-<response.post.id>
//     go-thread     go to /f/<data-forum>/t/<response.threadId>
//     go-concept    go to /c/<response.slug>
//   Errors (429 included) show in the form's [data-mm-form-status].
//
// <button data-mm-action data-endpoint data-method data-body='{"…"}' data-then="reload">
//   One-click calls (hide/unhide a post, remove a relation). Errors show in
//   the page's [data-mm-flash].

import { mmApi, errorText, flash, reloadAt } from './api.ts';

function formBody(form: HTMLFormElement): Record<string, string> {
  const body: Record<string, string> = {};
  for (const [key, value] of new FormData(form).entries()) {
    if (typeof value !== 'string') continue;
    const v = value.trim();
    if (v) body[key] = value.replace(/\r\n/g, '\n');
  }
  return body;
}

function after(then: string | undefined, result: any, el: HTMLElement): void {
  switch (then) {
    case 'reload-post':
      reloadAt(result?.post?.id ? `post-${result.post.id}` : undefined);
      return;
    case 'go-thread': {
      const forum = el.dataset.forum ?? '';
      if (result?.threadId && forum) {
        window.location.assign(`/f/${encodeURIComponent(forum)}/t/${encodeURIComponent(result.threadId)}`);
        return;
      }
      reloadAt();
      return;
    }
    case 'go-concept':
      if (result?.slug) {
        window.location.assign(`/c/${encodeURIComponent(result.slug)}`);
        return;
      }
      reloadAt();
      return;
    default:
      reloadAt(el.dataset.hash);
  }
}

function setBusy(el: HTMLElement, busy: boolean): void {
  el.setAttribute('aria-busy', busy ? 'true' : 'false');
  for (const b of el.querySelectorAll<HTMLButtonElement>('button[type="submit"], button:not([type])')) b.disabled = busy;
  if (el instanceof HTMLButtonElement) el.disabled = busy;
}

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-mm-form')) return;
  event.preventDefault();
  if (form.getAttribute('aria-busy') === 'true') return;
  const status = form.querySelector<HTMLElement>('[data-mm-form-status]');
  if (status) status.hidden = true;
  setBusy(form, true);
  try {
    const result = await mmApi(form.dataset.endpoint ?? '', { method: form.dataset.method ?? 'POST', body: formBody(form) });
    after(form.dataset.then, result, form);
  } catch (err) {
    flash(errorText(err), status);
    setBusy(form, false);
  }
});

document.addEventListener('click', async (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-mm-action]') : null;
  if (!target || target.disabled) return;
  event.preventDefault();
  let body: unknown;
  if (target.dataset.body) {
    try {
      body = JSON.parse(target.dataset.body);
    } catch {
      body = undefined;
    }
  }
  setBusy(target, true);
  try {
    const result = await mmApi(target.dataset.endpoint ?? '', { method: target.dataset.method ?? 'POST', body });
    after(target.dataset.then, result, target);
  } catch (err) {
    flash(errorText(err));
    setBusy(target, false);
  }
});
