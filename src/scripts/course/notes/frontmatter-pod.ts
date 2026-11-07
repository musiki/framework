// Propiedades de la nota en edición, dentro de la sección «Propiedades» del pod
// Info (como en Obsidian): cada fila clave → valor se vuelve editable en el
// mismo lugar, y debajo queda el YAML completo. Filas y YAML se sincronizan.
// El estado vive en el editor (inline-editor.ts); este módulo lo muestra y
// avisa los cambios con onChange.
import { frontmatterToYaml, parseYamlBlock, type FrontmatterData } from '../../notes-editor/yaml-strip';
import { NOTE_TYPES, NOTE_STATUSES, optionsFor } from '../../notes-editor/note-metadata-schema.mjs';
import type { NoteListItem } from '../../notes-editor/types';

export type FrontmatterPodOptions = {
  owner: HTMLElement;              // el mount del editor; si se desconecta, el pod se suelta
  notes: NoteListItem[];
  data: FrontmatterData;
  rawYaml?: string | null;         // YAML original que no se pudo leer: se muestra tal cual
  error?: string | null;
  onChange: (data: FrontmatterData) => void;
  onRawFixed?: () => void;         // el YAML original ilegible ya se corrigió
};

export type FrontmatterPodHandle = {
  setData: (data: FrontmatterData) => void;
};

// Las que el editor siempre escribe: no se pueden quitar desde acá.
const CORE_KEYS = new Set(['title', 'type', 'chapter', 'status', 'order', 'theme']);

type Mounted = {
  owner: HTMLElement;
  panel: HTMLElement;
  section: HTMLElement;
  createdSection: boolean;
  staticDl: HTMLElement | null;
  editor: HTMLElement;
  badge: HTMLElement;
};
let current: Mounted | null = null;

const debounce = <A extends unknown[]>(fn: (...args: A) => void, ms: number) => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, text = '') => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) node.setAttribute(k, v);
  if (text) node.textContent = text;
  return node;
};

const isScalar = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

const drop = () => {
  if (!current) return;
  current.editor.remove();
  current.badge.remove();
  if (current.staticDl) current.staticDl.hidden = false;
  if (current.createdSection) current.section.remove();
  current.panel.removeAttribute('data-editing-frontmatter');
  current = null;
};

/**
 * Saca el editor de propiedades. Con `owner`, sólo si lo montó ese editor; sin
 * argumento, sólo si su editor ya salió del DOM (otro panel puede seguir
 * editando).
 */
export function releaseFrontmatterPod(owner?: HTMLElement) {
  if (!current) return;
  if (owner ? current.owner !== owner : current.owner.isConnected) return;
  drop();
}

/** La sección «Propiedades» del pod Info, o una nueva si la página no tenía. */
function propertiesSection(panel: HTMLElement): { section: HTMLElement; created: boolean } {
  const found = panel.querySelector<HTMLElement>('.page-info-properties:not(.page-info-history)');
  if (found) return { section: found, created: false };
  const section = el('section', { class: 'page-info-properties', 'aria-label': 'Propiedades' });
  section.appendChild(el('h3', { class: 'page-info-properties-title' }, 'Propiedades'));
  const header = panel.querySelector('.page-info-sidebar-header');
  if (header) header.after(section);
  else panel.prepend(section);
  return { section, created: true };
}

export function mountFrontmatterPod(opts: FrontmatterPodOptions): FrontmatterPodHandle | null {
  const panel = document.getElementById('page-info-sidebar');
  if (!panel) {
    console.error('frontmatter-pod: falta el pod Info; las propiedades no se pueden editar');
    return null;
  }
  drop();

  const { section, created } = propertiesSection(panel);
  const staticDl = section.querySelector<HTMLElement>(':scope > dl.page-info-props');
  if (staticDl) staticDl.hidden = true;
  const badge = el('span', { class: 'note-fm-badge' }, 'editando');
  section.querySelector('.page-info-properties-title')?.appendChild(badge);

  const editor = el('div', { class: 'note-fm-editor' });
  const rowsEl = el('dl', { class: 'page-info-props note-fm-props' });
  const addBtn = el('button', { type: 'button', class: 'note-fm-add' }, '+ propiedad');
  const yamlLabel = el('label', { class: 'note-fm-yaml-label', for: 'note-fm-yaml' }, 'YAML');
  const textarea = el('textarea', {
    id: 'note-fm-yaml', class: 'note-fm-yaml', spellcheck: 'false', autocapitalize: 'off', rows: '10',
  }) as HTMLTextAreaElement;
  const errorEl = el('p', { class: 'note-fm-error', role: 'alert' });
  errorEl.hidden = true;
  const chapterList = el('datalist', { id: 'note-fm-chapters' });
  editor.append(rowsEl, addBtn, yamlLabel, textarea, errorEl, chapterList);
  section.appendChild(editor);
  panel.setAttribute('data-editing-frontmatter', 'true');
  current = { owner: opts.owner, panel, section, createdSection: created, staticDl, editor, badge };

  const chapters = [...new Set(opts.notes.map((n) => n.chapter).filter(Boolean))].sort();
  chapters.forEach((ch) => chapterList.appendChild(el('option', { value: ch })));
  const themes = [...new Set(opts.notes.map((n) => n.theme).filter(Boolean) as string[])].sort();

  let data: FrontmatterData = { ...opts.data };
  let locked = false;
  const alive = () => current?.editor === editor && opts.owner.isConnected;

  const showError = (msg: string | null) => {
    errorEl.textContent = msg ? `YAML inválido: ${msg}. Se conserva el último YAML válido.` : '';
    errorEl.hidden = !msg;
    textarea.classList.toggle('is-invalid', Boolean(msg));
  };

  // Un cambio desde las filas: YAML al día y aviso al editor.
  const commit = (rerender = false) => {
    if (!alive()) return releaseFrontmatterPod(opts.owner);
    textarea.value = frontmatterToYaml(data);
    showError(null);
    if (rerender) renderRows();
    opts.onChange(data);
  };

  const setValue = (key: string, value: unknown) => {
    // Vaciar una propiedad propia la deja como `clave:`; las del editor
    // (chapter, theme) vacías desaparecen, como siempre.
    data = { ...data, [key]: value === '' && !CORE_KEYS.has(key) ? null : value };
  };

  const select = (key: string, options: string[], value: string, withEmpty = false) => {
    const sel = el('select', { 'aria-label': key });
    if (withEmpty) sel.appendChild(el('option', { value: '' }, '—'));
    for (const opt of optionsFor({ options }, value)) sel.appendChild(el('option', { value: opt }, opt));
    sel.value = value;
    sel.addEventListener('change', () => { setValue(key, sel.value); commit(); });
    return sel;
  };

  const chipsControl = (key: string, items: unknown[]) => {
    const wrap = el('span', { class: 'page-info-prop-chips note-fm-chips' });
    items.forEach((item, i) => {
      const chip = el('span', { class: 'page-info-prop-chip is-static' }, String(item));
      const x = el('button', { type: 'button', class: 'note-fm-chip-remove', 'aria-label': `Quitar ${String(item)}` }, '×');
      x.addEventListener('click', () => {
        setValue(key, items.filter((_, j) => j !== i));
        commit(true);
      });
      chip.appendChild(x);
      wrap.appendChild(chip);
    });
    const input = el('input', { class: 'note-fm-chip-input', placeholder: 'agregar…', 'aria-label': `Agregar a ${key}` }) as HTMLInputElement;
    const add = () => {
      const v = input.value.trim();
      if (!v) return;
      setValue(key, [...items, v]);
      commit(true);
      rowsEl.querySelector<HTMLInputElement>(`[data-fm-key="${CSS.escape(key)}"] .note-fm-chip-input`)?.focus();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    input.addEventListener('blur', add);
    wrap.appendChild(input);
    return wrap;
  };

  const control = (key: string, value: unknown): HTMLElement => {
    if (key === 'type') return select(key, NOTE_TYPES, String(value ?? ''));
    if (key === 'status') return select(key, NOTE_STATUSES, String(value ?? ''));
    if (key === 'theme') return select(key, themes, String(value ?? ''), true);
    if (typeof value === 'boolean') {
      const box = el('input', { type: 'checkbox', 'aria-label': key }) as HTMLInputElement;
      box.checked = value;
      box.addEventListener('change', () => { setValue(key, box.checked); commit(); });
      return box;
    }
    if (Array.isArray(value) && value.every(isScalar)) return chipsControl(key, value);
    if (!isScalar(value)) {
      return el('span', { class: 'note-fm-complex', title: 'Estructura anidada: se edita en el YAML de abajo' },
        Array.isArray(value) ? `lista · ${value.length}` : 'mapa · editar en YAML');
    }
    const isNumber = typeof value === 'number';
    const input = el('input', {
      type: isNumber ? 'number' : 'text',
      'aria-label': key,
      ...(key === 'chapter' ? { list: 'note-fm-chapters', placeholder: 'raíz' } : {}),
    }) as HTMLInputElement;
    input.value = value == null ? '' : String(value);
    input.addEventListener('input', debounce(() => {
      setValue(key, isNumber ? (input.value === '' ? 0 : Number(input.value)) : input.value);
      commit();
    }, 300));
    return input;
  };

  function renderRows() {
    rowsEl.replaceChildren(...Object.entries(data)
      .filter(([, v]) => v !== undefined)
      .map(([key, value]) => {
        const row = el('div', { class: 'page-info-prop-row note-fm-row', 'data-fm-key': key });
        const dd = el('dd');
        dd.appendChild(control(key, value));
        row.append(el('dt', {}, key), dd);
        if (!CORE_KEYS.has(key)) {
          const remove = el('button', { type: 'button', class: 'note-fm-remove', 'aria-label': `Quitar ${key}`, title: `Quitar ${key}` }, '×');
          remove.addEventListener('click', () => {
            const { [key]: _gone, ...rest } = data;
            data = rest as FrontmatterData;
            commit(true);
          });
          row.appendChild(remove);
        }
        return row;
      }));
  }

  addBtn.addEventListener('click', () => {
    const row = el('div', { class: 'page-info-prop-row note-fm-row note-fm-row--new' });
    const keyInput = el('input', { class: 'note-fm-key-input', placeholder: 'nombre', 'aria-label': 'Nombre de la propiedad' }) as HTMLInputElement;
    const dt = el('dt');
    dt.appendChild(keyInput);
    row.append(dt, el('dd'));
    rowsEl.appendChild(row);
    keyInput.focus();
    let done = false;
    const accept = () => {
      if (done) return;
      done = true;
      const key = keyInput.value.trim();
      if (!key || key in data) { row.remove(); return; }
      setValue(key, null);
      commit(true);
      rowsEl.querySelector<HTMLInputElement>(`[data-fm-key="${CSS.escape(key)}"] input`)?.focus();
    };
    keyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); accept(); }
      if (e.key === 'Escape') { done = true; row.remove(); }
    });
    keyInput.addEventListener('blur', accept);
  });

  const setLocked = (on: boolean) => {
    locked = on;
    rowsEl.inert = on;
    addBtn.disabled = on;
    editor.classList.toggle('is-locked', on);
  };

  renderRows();
  if (opts.error && opts.rawYaml != null) {
    // La nota ya venía con YAML ilegible: se muestra el original y el editor lo
    // reescribe intacto hasta que se corrija acá.
    textarea.value = opts.rawYaml;
    errorEl.textContent = `El YAML de esta nota no es válido (${opts.error}). Se guarda tal cual hasta que lo corrijas acá.`;
    errorEl.hidden = false;
    textarea.classList.add('is-invalid');
    setLocked(true);
  } else {
    textarea.value = frontmatterToYaml(data);
  }

  textarea.addEventListener('input', debounce(() => {
    if (!alive()) return releaseFrontmatterPod(opts.owner);
    let parsed: Record<string, unknown>;
    try {
      parsed = parseYamlBlock(textarea.value);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
      return;
    }
    showError(null);
    if (locked) {
      setLocked(false);
      opts.onRawFixed?.();
    }
    data = {
      ...parsed,
      title: String(parsed.title ?? ''),
      type: String(parsed.type || 'lesson'),
      chapter: String(parsed.chapter ?? ''),
      status: String(parsed.status || 'draft'),
      order: Number(parsed.order) || 0,
      theme: String(parsed.theme ?? ''),
    };
    renderRows();
    opts.onChange(data);
  }, 400));

  return {
    setData(next) {
      if (!alive()) return releaseFrontmatterPod(opts.owner);
      data = { ...next };
      // No pisar lo que se está escribiendo.
      if (!rowsEl.contains(document.activeElement)) renderRows();
      if (document.activeElement !== textarea) {
        textarea.value = frontmatterToYaml(data);
        showError(null);
      }
    },
  };
}
