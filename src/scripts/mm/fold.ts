// Foldable sections (<details data-mm-fold="<section>" id="<section>">) of the
// concept page. Without JS the server's defaults apply (lib/mm/fold.ts). With
// it: the reader's own choice per section is remembered in localStorage
// (`mm-fold:<section>`, the same for every concept; storage failures are
// ignored), and an anchor (#history, #post-…) opens the section it points
// into (on load and on hash changes). Printing shows every section and
// every folded group.

import { FOLD_DEFAULT_OPEN, foldKey, foldValue, hashTarget, initialFoldOpen, parseFoldValue } from '../../lib/mm/fold.ts';

const folds = [...document.querySelectorAll<HTMLDetailsElement>('details[data-mm-fold]')];

const read = (section: string): boolean | null => {
  try {
    return parseFoldValue(window.localStorage.getItem(foldKey(section)));
  } catch {
    return null;
  }
};
const write = (section: string, open: boolean) => {
  try {
    window.localStorage.setItem(foldKey(section), foldValue(open));
  } catch {
    /* private mode, blocked storage: the choice is just not remembered */
  }
};

// Open states this script set itself: their `toggle` events are not the reader's choice.
const programmatic = new WeakSet<HTMLDetailsElement>();
const setOpen = (d: HTMLDetailsElement, open: boolean) => {
  if (d.open === open) return;
  programmatic.add(d);
  d.open = open;
};

/** Every <details> (sections and nested groups) that contains the hash target, outermost first. */
function foldsAround(target: Element | null): HTMLDetailsElement[] {
  const out: HTMLDetailsElement[] = [];
  for (let el = target; el; el = el.parentElement) if (el instanceof HTMLDetailsElement) out.unshift(el);
  return out;
}

function targetOf(hash: string): Element | null {
  const id = hashTarget(hash);
  return id ? document.getElementById(id) : null;
}

function openForHash(scroll: boolean): void {
  const target = targetOf(window.location.hash);
  const around = foldsAround(target);
  if (!around.length) return;
  for (const d of around) setOpen(d, true);
  if (scroll && target) target.scrollIntoView({ block: 'start' });
}

if (folds.length) {
  const target = targetOf(window.location.hash);
  const targeted = new Set(foldsAround(target));
  for (const d of folds) {
    const section = d.dataset.mmFold ?? '';
    const defaultOpen = (FOLD_DEFAULT_OPEN as Record<string, boolean>)[section] ?? d.open;
    setOpen(d, initialFoldOpen({ defaultOpen, stored: read(section), targeted: targeted.has(d) }));
  }
  // Nested groups (history days) the anchor points into.
  for (const d of targeted) setOpen(d, true);
  // The browser scrolled before the section opened: bring the target back into view.
  if (target && targeted.size) requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));

  for (const d of folds) {
    d.addEventListener('toggle', () => {
      if (programmatic.has(d)) {
        programmatic.delete(d);
        return;
      }
      write(d.dataset.mmFold ?? '', d.open);
    });
  }
  window.addEventListener('hashchange', () => openForHash(true));
  // In-page links to an anchor that is already the current hash fire no hashchange.
  document.addEventListener('click', (event) => {
    const a = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
    if (a && a.getAttribute('href') === window.location.hash) openForHash(true);
  });
}

// Print: everything open, then back to how the reader had it.
let beforePrint: Array<[HTMLDetailsElement, boolean]> = [];
window.addEventListener('beforeprint', () => {
  beforePrint = [...document.querySelectorAll<HTMLDetailsElement>('details')].map((d) => [d, d.open]);
  for (const [d] of beforePrint) setOpen(d, true);
});
window.addEventListener('afterprint', () => {
  for (const [d, open] of beforePrint) setOpen(d, open);
  beforePrint = [];
});
