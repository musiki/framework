// Relation modeler (graph page table + type form; also the form on /r/<slug>).
//
// Table (the graph's key and filter):
//   [data-mm-rt-show][data-slug]  visibility checkbox → CustomEvent
//     'mm:relation-filter' {visible: slugs} on document (graph.ts hides the
//     edges of the other types); rows of the relations table carrying
//     data-mm-rel-type follow too. A live line says how many are shown.
//   [data-mm-rt-move="-1|1"]      reorder (PUT /api/mm/relation-types {slugs})
//   [data-mm-rt-archive="true|false"]  archive / restore (PATCH {archived})
//   [data-mm-rt-add], [data-mm-rt-edit][data-type]  open the form
// Form [data-mm-rt-form]: rules (area → hierarchical; symmetric ⟂
// hierarchical), live preview, validation mirroring the server, FLAT JSON
// body with real booleans. All DOM text via textContent; the preview SVG is
// built with createElementNS.

import { mmApi, errorText, flash, reloadAt, ApiFailure } from './api.ts';
import {
  RELATION_FILTER_EVENT, buildTypeBody, formRules, moveSlug, sampleSpec, svgAttrs, visibleSlugs, typePath,
  type FormValues, type RelationFilterDetail,
} from '../../lib/mm/relation-type-ui.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
type Strings = Record<string, string>;

function readStrings(el: HTMLElement | null, attr = 'strings'): Strings {
  try {
    return JSON.parse(el?.dataset[attr] ?? '{}') as Strings;
  } catch {
    return {};
  }
}
const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

// ---------------------------------------------------------------------------
// Visibility filter
// ---------------------------------------------------------------------------

function initFilter(table: HTMLElement): void {
  const boxes = [...table.querySelectorAll<HTMLInputElement>('input[data-mm-rt-show]')];
  if (!boxes.length) return;
  const status = document.querySelector<HTMLElement>('[data-mm-rt-filter-status]');
  const template = table.dataset.shownTemplate ?? '';
  const emit = (announce: boolean) => {
    const visible = visibleSlugs(boxes.map((b) => ({ slug: b.dataset.slug ?? '', checked: b.checked })));
    const detail: RelationFilterDetail = { visible };
    document.dispatchEvent(new CustomEvent(RELATION_FILTER_EVENT, { detail }));
    const shown = new Set(visible);
    document.querySelectorAll<HTMLElement>('[data-mm-rel-type]').forEach((row) => {
      row.hidden = !shown.has(row.dataset.mmRelType ?? '');
    });
    if (announce && status && template) status.textContent = fill(template, { shown: visible.length, total: boxes.length });
  };
  for (const b of boxes) b.addEventListener('change', () => emit(true));
  // Browsers restore checkbox state on back/forward: send the state once the
  // graph script (which listens from load) is ready.
  window.setTimeout(() => emit(false), 0);
  window.addEventListener('pageshow', (e) => { if ((e as PageTransitionEvent).persisted) emit(false); });
}

// ---------------------------------------------------------------------------
// Reorder / archive
// ---------------------------------------------------------------------------

function initRowActions(table: HTMLElement): void {
  const body = table.querySelector('tbody');
  const status = document.querySelector<HTMLElement>('[data-mm-rt-status]');
  const say = (text: string) => { if (status) status.textContent = text; };
  const rows = () => [...(body?.querySelectorAll<HTMLTableRowElement>('tr[data-slug]') ?? [])];
  const refreshMoveButtons = () => {
    const all = rows();
    all.forEach((r, i) => {
      const up = r.querySelector<HTMLButtonElement>('[data-mm-rt-move="-1"]');
      const down = r.querySelector<HTMLButtonElement>('[data-mm-rt-move="1"]');
      if (up) up.disabled = i === 0;
      if (down) down.disabled = i === all.length - 1;
    });
  };
  refreshMoveButtons();

  table.addEventListener('click', async (event) => {
    const btn = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
    if (!btn || btn.disabled || !table.contains(btn)) return;
    const row = btn.closest<HTMLTableRowElement>('tr[data-slug]');
    const slug = row?.dataset.slug ?? '';
    if (!row || !slug) return;

    if (btn.dataset.mmRtMove) {
      const dir = btn.dataset.mmRtMove === '-1' ? -1 : 1;
      const order = moveSlug(rows().map((r) => r.dataset.slug ?? ''), slug, dir);
      btn.disabled = true;
      table.setAttribute('aria-busy', 'true');
      try {
        await mmApi('/api/mm/relation-types', { method: 'PUT', body: { slugs: order } });
        const sibling = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
        if (sibling) {
          if (dir < 0) sibling.before(row);
          else sibling.after(row);
        }
        refreshMoveButtons();
        // Keep focus on the control that moved (or its partner at an end).
        const again = row.querySelector<HTMLButtonElement>(`[data-mm-rt-move="${dir}"]`);
        const other = row.querySelector<HTMLButtonElement>(`[data-mm-rt-move="${-dir}"]`);
        (again && !again.disabled ? again : other)?.focus();
        say(table.dataset.orderSaved ?? '');
      } catch (err) {
        flash(errorText(err));
        refreshMoveButtons();
      } finally {
        table.removeAttribute('aria-busy');
      }
      return;
    }

    if (btn.dataset.mmRtArchive) {
      const archived = btn.dataset.mmRtArchive === 'true';
      btn.disabled = true;
      try {
        await mmApi(`/api/mm/relation-types/${encodeURIComponent(slug)}`, { method: 'PATCH', body: { archived } });
        reloadAt(`mm-rt-row-${slug}`);
      } catch (err) {
        flash(errorText(err));
        btn.disabled = false;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

type TypeData = FormValues & { slug?: string };

function initForm(form: HTMLFormElement): void {
  const panel = form.closest<HTMLElement>('[data-mm-rt-panel]');
  const title = panel?.querySelector<HTMLElement>('[data-mm-rt-title]') ?? null;
  const summary = form.querySelector<HTMLElement>('[data-mm-rt-summary]');
  const submit = form.querySelector<HTMLButtonElement>('[data-mm-rt-submit]');
  const createOnly = form.querySelector<HTMLElement>('[data-mm-rt-create-only]');
  const preview = form.querySelector<HTMLElement>('[data-mm-rt-preview]');
  const live = form.querySelector<HTMLElement>('[data-mm-rt-live]');
  const s = readStrings(form);
  let opener: HTMLElement | null = null;

  const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement | RadioNodeList | HTMLTextAreaElement | null;
  const box = (name: string) => form.querySelector<HTMLInputElement>(`input[type="checkbox"][name="${name}"]`);
  const radioValue = (name: string) => form.querySelector<HTMLInputElement>(`input[type="radio"][name="${name}"]:checked`)?.value ?? '';
  const setRadio = (name: string, value: string) =>
    form.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`).forEach((r) => { r.checked = r.value === value; });
  const textValue = (name: string) => {
    const el = input(name);
    return el && 'value' in el && typeof el.value === 'string' ? el.value : '';
  };
  const setText = (name: string, value: string | null | undefined) => {
    const el = input(name);
    if (el && 'value' in el) (el as HTMLInputElement).value = value ?? '';
  };

  const values = (): FormValues => ({
    label: textValue('label'), labelNb: textValue('labelNb'), inverseLabel: textValue('inverseLabel'), inverseLabelNb: textValue('inverseLabelNb'),
    render: radioValue('render'), stroke: radioValue('stroke'), color: radioValue('color'),
    arrow: box('arrow')?.checked === true, symmetric: box('symmetric')?.checked === true,
    transitive: box('transitive')?.checked === true, hierarchical: box('hierarchical')?.checked === true,
    skos: textValue('skos'), wikidata: textValue('wikidata'), definition: textValue('definition'),
  });

  const drawPreview = () => {
    if (!preview) return;
    const v = values();
    const spec = sampleSpec({ render: v.render ?? 'line', stroke: v.stroke ?? 'solid', arrow: v.arrow === true, color: v.color ?? 'ink', symmetric: v.symmetric === true });
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'mm-rt-sample');
    svg.setAttribute('viewBox', `0 0 ${spec.width} ${spec.height}`);
    svg.setAttribute('width', String(spec.width));
    svg.setAttribute('height', String(spec.height));
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('role', 'img');
    const color = s[`color.${v.color}`] ?? v.color ?? '';
    const stroke = s[`stroke.${v.stroke}`] ?? v.stroke ?? '';
    const tpl = v.render === 'area' ? s.sampleArea : v.arrow && !v.symmetric ? s.sampleArrow : s.sampleLine;
    svg.setAttribute('aria-label', fill(tpl ?? '', { color, stroke }));
    for (const shape of spec.shapes) {
      const el = document.createElementNS(SVG_NS, shape.tag);
      for (const [k, val] of Object.entries(svgAttrs(shape))) el.setAttribute(k, val);
      svg.append(el);
    }
    preview.replaceChildren(svg);
  };

  const applyRules = () => {
    const sym = box('symmetric');
    const hier = box('hierarchical');
    const area = form.querySelector<HTMLInputElement>('input[name="render"][value="area"]');
    // The rules close options; a closed option is never left checked (except the forced hierarchical).
    let r = formRules({ render: radioValue('render'), symmetric: sym?.checked === true, hierarchical: hier?.checked === true });
    if (r.forceHierarchical && hier) hier.checked = true;
    if (r.disabled.symmetric && sym?.checked) sym.checked = false;
    r = formRules({ render: radioValue('render'), symmetric: sym?.checked === true, hierarchical: hier?.checked === true });
    if (sym) sym.disabled = r.disabled.symmetric;
    if (hier) hier.disabled = r.disabled.hierarchical;
    if (area) area.disabled = r.disabled.area;
    form.querySelectorAll<HTMLElement>('[data-mm-rt-rule]').forEach((li) => {
      const on = li.dataset.mmRtRule === 'area' ? radioValue('render') === 'area' : sym?.checked === true || hier?.checked === true;
      li.classList.toggle('is-active', on);
    });
    drawPreview();
  };

  const clearErrors = () => {
    if (summary) { summary.hidden = true; summary.textContent = ''; }
    form.querySelectorAll<HTMLElement>('.mm-field-error').forEach((e) => { e.hidden = true; e.textContent = ''; });
    form.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
  };

  const showErrors = (errors: { field: string; code: string }[]) => {
    let first: HTMLElement | null = null;
    for (const e of errors) {
      const slot = form.querySelector<HTMLElement>(`.mm-field-error[data-for="${e.field}"]`);
      if (slot) { slot.textContent = s[`error.${e.code}`] ?? e.code; slot.hidden = false; }
      const control = form.querySelector<HTMLElement>(`[name="${e.field}"]`);
      if (control) {
        control.setAttribute('aria-invalid', 'true');
        first ??= control;
      }
    }
    if (summary) {
      summary.textContent = fill(s.errorSummary ?? '', { count: errors.length });
      summary.hidden = false;
      summary.focus();
    } else first?.focus();
  };

  const setMode = (mode: 'create' | 'edit', data: TypeData | null) => {
    form.dataset.mode = mode;
    form.dataset.slug = data?.slug ?? '';
    clearErrors();
    const d: TypeData = data ?? { render: 'line', stroke: 'solid', color: 'ink', arrow: true };
    for (const k of ['label', 'labelNb', 'inverseLabel', 'inverseLabelNb', 'skos', 'wikidata'] as const) setText(k, (d[k] as string | null) ?? '');
    setText('definition', '');
    setRadio('render', d.render ?? 'line');
    setRadio('stroke', d.stroke ?? 'solid');
    setRadio('color', d.color ?? 'ink');
    for (const k of ['arrow', 'symmetric', 'transitive', 'hierarchical'] as const) {
      const b = box(k);
      if (b) { b.disabled = false; b.checked = d[k] === true; }
    }
    const area = form.querySelector<HTMLInputElement>('input[name="render"][value="area"]');
    if (area) area.disabled = false;
    if (createOnly) createOnly.hidden = mode !== 'create';
    if (submit) submit.textContent = mode === 'create' ? s.create ?? '' : s.save ?? '';
    if (title) title.textContent = mode === 'create' ? s.addTitle ?? '' : fill(s.editTitle ?? '', { label: d.label ?? '' });
    applyRules();
  };

  const open = (mode: 'create' | 'edit', data: TypeData | null, from: HTMLElement | null) => {
    opener = from;
    setMode(mode, data);
    if (panel) panel.hidden = false;
    document.querySelectorAll<HTMLElement>('[data-mm-rt-add], [data-mm-rt-edit]').forEach((b) => b.setAttribute('aria-expanded', String(b === from)));
    panel?.scrollIntoView({ block: 'start' });
    title?.focus({ preventScroll: true });
  };
  const close = () => {
    if (panel) panel.hidden = true;
    document.querySelectorAll<HTMLElement>('[data-mm-rt-add], [data-mm-rt-edit]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    opener?.focus();
    opener = null;
  };

  form.addEventListener('change', (e) => {
    const name = (e.target as HTMLInputElement | null)?.name;
    if (['render', 'symmetric', 'hierarchical', 'stroke', 'color', 'arrow'].includes(name ?? '')) applyRules();
  });
  form.querySelector('[data-mm-rt-cancel]')?.addEventListener('click', close);
  panel?.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { e.preventDefault(); close(); } });

  document.addEventListener('click', (event) => {
    const btn = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-mm-rt-add], [data-mm-rt-edit]') : null;
    if (!btn) return;
    event.preventDefault();
    if (btn.hasAttribute('data-mm-rt-add')) {
      open('create', null, btn);
      return;
    }
    let data: TypeData | null = null;
    try {
      data = JSON.parse(btn.dataset.type ?? 'null');
    } catch {
      data = null;
    }
    if (data?.slug) open('edit', data, btn);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (form.getAttribute('aria-busy') === 'true') return;
    clearErrors();
    const mode = form.dataset.mode === 'edit' ? 'edit' : 'create';
    const built = buildTypeBody(values(), mode);
    if (!built.ok) {
      showErrors(built.errors);
      return;
    }
    const slug = form.dataset.slug ?? '';
    form.setAttribute('aria-busy', 'true');
    if (submit) submit.disabled = true;
    try {
      const result = mode === 'create'
        ? await mmApi<{ slug: string }>('/api/mm/relation-types', { method: 'POST', body: built.body })
        : await mmApi(`/api/mm/relation-types/${encodeURIComponent(slug)}`, { method: 'PATCH', body: built.body });
      if (live) live.textContent = s.saved ?? '';
      const newSlug = mode === 'create' ? (result as { slug?: string })?.slug : slug;
      // On the graph page, land on the type's row; elsewhere (its own page) reload.
      if (document.querySelector('[data-mm-rt-table]')) reloadAt(newSlug ? `mm-rt-row-${newSlug}` : 'mm-rt');
      else if (mode === 'create' && newSlug) window.location.assign(typePath(newSlug));
      else reloadAt();
    } catch (err) {
      form.removeAttribute('aria-busy');
      if (submit) submit.disabled = false;
      if (summary) {
        const detail = err instanceof ApiFailure && (err.status === 400 || err.status === 409) && err.detail ? ` (${err.detail})` : '';
        summary.textContent = errorText(err) + detail;
        summary.hidden = false;
        summary.focus();
      } else flash(errorText(err));
    }
  });

  applyRules();
}

// ---------------------------------------------------------------------------

const table = document.querySelector<HTMLElement>('[data-mm-rt-table]');
if (table) {
  initFilter(table);
  initRowActions(table);
}
document.querySelectorAll<HTMLFormElement>('form[data-mm-rt-form]').forEach(initForm);
