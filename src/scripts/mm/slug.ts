// Concept slug fields (<input data-mm-slug data-mm-slug-from="<id of the label input>">):
// prefilled from the label with the server's rule (lib/mm/slugs.ts
// slugifyLabel) until the writer edits the slug themselves; normalized to
// the canonical form when the field loses focus; the URL preview
// ([data-mm-slug-preview]) follows. While the slug is only the suggestion,
// the field is not submitted (no name): the server then picks the slug from
// the label and adds -2, -3… when it is taken. A slug the writer typed is
// sent and must be free (409 otherwise). The server still validates
// (format, reserved words, taken) — this only helps.

import { slugifyLabel } from '../../lib/mm/slugs.ts';

document.querySelectorAll<HTMLInputElement>('input[data-mm-slug]').forEach((field) => {
  const from = field.dataset.mmSlugFrom ? document.getElementById(field.dataset.mmSlugFrom) : null;
  const preview = field.form?.querySelector<HTMLElement>('[data-mm-slug-preview]') ?? null;
  const name = field.name || 'slug';
  let edited = field.value.trim() !== '' && !from;
  const sync = () => {
    field.name = edited || !from ? name : '';
  };
  const show = () => {
    sync();
    if (preview) preview.textContent = `/${field.value.trim() || '…'}`;
  };
  const clearInvalid = () => field.removeAttribute('aria-invalid');
  if (from instanceof HTMLInputElement) {
    from.addEventListener('input', () => {
      if (edited) return;
      field.value = slugifyLabel(from.value);
      clearInvalid();
      show();
    });
  }
  field.addEventListener('input', () => {
    edited = field.value.trim() !== '';
    clearInvalid();
    show();
  });
  field.addEventListener('blur', () => {
    const v = slugifyLabel(field.value);
    if (v !== field.value) field.value = v;
    if (!v && from instanceof HTMLInputElement) {
      edited = false;
      field.value = slugifyLabel(from.value);
    }
    show();
  });
  show();
});
