// Botones de copia de los bloques BibTeX renderizados en APA
// (src/lib/bibtex/apa-refs.mjs). Un solo listener delegado para toda la página,
// así sirve también para paneles de Dockview y el foro que se montan después.

type CopyKind = 'apa' | 'bibtex' | 'apa-all' | 'bibtex-all';

// Para pegar en un documento: sin la negrita de pantalla en los autores.
const apaHtml = (entry: Element) => {
  const clone = entry.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.csl-author').forEach((el) => el.replaceWith(...Array.from(el.childNodes)));
  return clone.innerHTML;
};

const writeClipboard = async (text: string, html?: string) => {
  if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
      return;
    } catch {
      // Algunos navegadores no aceptan text/html: queda el texto plano.
    }
  }
  await navigator.clipboard.writeText(text);
};

const payload = (kind: CopyKind, btn: HTMLElement) => {
  const block = btn.closest('[data-bib-refs]');
  const refs = kind.endsWith('-all')
    ? Array.from(block?.querySelectorAll<HTMLElement>('.bib-ref') || [])
    : [btn.closest<HTMLElement>('.bib-ref')].filter((el): el is HTMLElement => Boolean(el));
  if (kind.startsWith('bibtex')) {
    return { text: refs.map((r) => r.dataset.bibtex || '').filter(Boolean).join('\n\n') };
  }
  const entries = refs.map((r) => r.querySelector('.bib-ref-text')).filter((el): el is Element => Boolean(el));
  return {
    text: entries.map((e) => (e.textContent || '').trim()).join('\n'),
    html: entries.map((e) => `<p>${apaHtml(e)}</p>`).join(''),
  };
};

const flash = (btn: HTMLElement, ok: boolean) => {
  const tip = btn.dataset.tip || '';
  btn.dataset.tip = ok ? 'Copiado' : 'No se pudo copiar';
  btn.classList.add(ok ? 'is-copied' : 'is-error');
  window.setTimeout(() => {
    btn.dataset.tip = tip;
    btn.classList.remove('is-copied', 'is-error');
  }, 1300);
};

export function installBibRefsCopy() {
  const w = window as Window & { __musikiBibCopy?: boolean };
  if (w.__musikiBibCopy) return;
  w.__musikiBibCopy = true;
  document.addEventListener('click', (event) => {
    const btn = (event.target as Element | null)?.closest<HTMLElement>('[data-bib-copy]');
    if (!btn) return;
    event.preventDefault();
    const { text, html } = payload(btn.dataset.bibCopy as CopyKind, btn);
    if (!text) return flash(btn, false);
    writeClipboard(text, html).then(() => flash(btn, true), (err) => {
      console.error('[bib-refs] copiar falló', err);
      flash(btn, false);
    });
  });
}
