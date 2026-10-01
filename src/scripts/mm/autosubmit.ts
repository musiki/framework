// GET forms marked data-mm-autosubmit: a changed <select> submits the form
// (the page works the same without JS through its submit button).

document.querySelectorAll<HTMLFormElement>('form[data-mm-autosubmit]').forEach((form) => {
  form.addEventListener('change', (event) => {
    if (event.target instanceof HTMLSelectElement) form.requestSubmit();
  });
});
