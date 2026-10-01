// Progressive forms and action buttons of the mm pages.
//
// <form data-mm-form data-endpoint="/api/mm/…" data-method="POST|PATCH" data-then="…">
//   Named fields become a JSON object; empty values are left out (optional
//   Bokmål fields, "no move"). data-then:
//     reload        reload the page
//     reload-post   reload at #post-<response.post.id>
//     go-thread     go to <data-forum-path>/t/<response.threadId> (the board's
//                   public path: /f/<group> or /f/<group>/<channel>)
//     go-concept    go to the concept's permalink (response.path: /<slug>, or
//                   /c/<slug> for an older slug; propose and rename answer it)
//   Errors (429 included) show in the form's [data-mm-form-status]; a concept
//   slug error (taken / reserved / format) gets its own message and marks the
//   [data-mm-slug] field invalid.
//
// <button data-mm-action data-endpoint data-method data-body='{"…"}' data-then="reload">
//   One-click calls (hide/unhide a post, remove a relation). Errors show in
//   the page's [data-mm-flash].

import { mmApi, errorText, flash, pageStrings, reloadAt, ApiFailure } from './api.ts';
import { slugErrorKind } from '../../lib/mm/client-core.ts';

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
      const base = el.dataset.forumPath ?? '';
      // Only a same-site /f/… path (built server-side by boardPath) is followed.
      if (result?.threadId && /^\/f\/[^/?#]+(\/[^/?#]+)?$/.test(base)) {
        window.location.assign(`${base}/t/${encodeURIComponent(result.threadId)}`);
        return;
      }
      reloadAt();
      return;
    }
    case 'go-concept':
      // Only a same-site permalink built server-side (view.ts conceptPath) is followed.
      if (typeof result?.path === 'string' && /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*|c\/[^/?#]+)$/.test(result.path)) {
        window.location.assign(result.path);
        return;
      }
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
    const slugField = form.querySelector<HTMLInputElement>('input[data-mm-slug]');
    const kind = slugField && err instanceof ApiFailure ? slugErrorKind(err.status, err.detail) : null;
    if (slugField && kind) {
      flash(pageStrings()[`slug.${kind}`] || errorText(err), status);
      slugField.setAttribute('aria-invalid', 'true');
      slugField.focus();
    } else {
      flash(errorText(err), status);
    }
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
