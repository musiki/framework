// Concept page: the "new version" form prefills the textarea with the current
// definition of the chosen language (from data attributes; text only) until
// the writer has typed. Submissions go through forms.ts.

document.querySelectorAll<HTMLFormElement>('form[data-mm-definition-form]').forEach((form) => {
  const select = form.querySelector<HTMLSelectElement>('select[name="lang"]');
  const textarea = form.querySelector<HTMLTextAreaElement>('textarea[name="definition"]');
  if (!select || !textarea) return;
  let touched = false;
  textarea.addEventListener('input', () => (touched = true));
  select.addEventListener('change', () => {
    if (touched && textarea.value.trim()) return;
    textarea.value = select.value === 'nb' ? form.dataset.currentNb ?? '' : form.dataset.currentEn ?? '';
    textarea.lang = select.value;
    touched = false;
  });
});
