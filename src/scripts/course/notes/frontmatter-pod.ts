// Propiedades de la nota que se está editando, en el pod Info del sidebar
// derecho: campos frecuentes arriba y el YAML completo abajo, sincronizados.
// El estado vive en el editor (inline-editor.ts); este módulo sólo lo muestra
// y avisa los cambios con onChange.
import {
  frontmatterToYaml,
  parseYamlBlock,
  populateYamlStrip,
  readYamlStrip,
  type FrontmatterData,
} from '../../notes-editor/yaml-strip';
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

const HOST_SELECTOR = '[data-note-frontmatter-host]';
let current: { owner: HTMLElement; host: HTMLElement } | null = null;

const debounce = <A extends unknown[]>(fn: (...args: A) => void, ms: number) => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

const drop = () => {
  if (!current) return;
  current.host.replaceChildren();
  current.host.closest('#page-info-sidebar')?.removeAttribute('data-editing-frontmatter');
  current = null;
};

/**
 * Saca el bloque del pod. Con `owner`, sólo si lo montó ese editor; sin
 * argumento, sólo si su editor ya salió del DOM (otro panel puede seguir
 * editando).
 */
export function releaseFrontmatterPod(owner?: HTMLElement) {
  if (!current) return;
  if (owner ? current.owner !== owner : current.owner.isConnected) return;
  drop();
}

export function mountFrontmatterPod(opts: FrontmatterPodOptions): FrontmatterPodHandle | null {
  const host = document.querySelector<HTMLElement>(HOST_SELECTOR);
  if (!host) {
    console.error('frontmatter-pod: falta el contenedor del pod Info; las propiedades no se pueden editar');
    return null;
  }
  drop();
  current = { owner: opts.owner, host };
  host.closest('#page-info-sidebar')?.setAttribute('data-editing-frontmatter', 'true');

  host.innerHTML = `
    <section class="note-fm-pod" aria-label="Propiedades de la nota en edición">
      <h3 class="page-info-properties-title">Propiedades <span class="note-fm-pod-badge">editando</span></h3>
      <form class="note-fm-fields" data-fm-fields><fieldset>
        <label>Tipo <select id="fm-type"></select></label>
        <label>Estado <select id="fm-status"></select></label>
        <label>Capítulo <input id="fm-chapter" list="fm-chapter-list" placeholder="raíz" /><datalist id="fm-chapter-list"></datalist></label>
        <label>Orden <input id="fm-order" type="number" step="1" /></label>
        <label>Tema <select id="fm-theme"><option value="">—</option></select></label>
      </fieldset></form>
      <label class="note-fm-yaml-label" for="note-fm-yaml">YAML</label>
      <textarea id="note-fm-yaml" class="note-fm-yaml" spellcheck="false" autocapitalize="off" rows="10"></textarea>
      <p class="note-fm-error" data-fm-error role="alert" hidden></p>
    </section>
  `;
  const form = host.querySelector<HTMLFormElement>('[data-fm-fields]')!;
  const textarea = host.querySelector<HTMLTextAreaElement>('#note-fm-yaml')!;
  const errorEl = host.querySelector<HTMLElement>('[data-fm-error]')!;
  const fieldset = form.querySelector('fieldset')!;

  let data: FrontmatterData = { ...opts.data };
  const showError = (msg: string | null) => {
    errorEl.textContent = msg ? `YAML inválido: ${msg}. Se conserva el último YAML válido.` : '';
    errorEl.hidden = !msg;
    textarea.classList.toggle('is-invalid', Boolean(msg));
  };
  const alive = () => current?.host === host && opts.owner.isConnected;

  populateYamlStrip(opts.notes, data, form);
  if (opts.error && opts.rawYaml != null) {
    // La nota ya venía con YAML que no se puede leer: se muestra el original y el
    // editor lo reescribe intacto hasta que se corrija acá.
    textarea.value = opts.rawYaml;
    errorEl.textContent = `El YAML de esta nota no es válido (${opts.error}). Se guarda tal cual hasta que lo corrijas acá.`;
    errorEl.hidden = false;
    textarea.classList.add('is-invalid');
    fieldset.disabled = true;
  } else {
    textarea.value = frontmatterToYaml(data);
  }

  const onFields = () => {
    if (!alive()) return releaseFrontmatterPod(opts.owner);
    const fields = readYamlStrip(form);
    data = {
      ...data,
      type: fields.type || data.type,
      status: fields.status || data.status,
      chapter: fields.chapter || '',
      order: fields.order ?? 0,
      theme: fields.theme || '',
    };
    textarea.value = frontmatterToYaml(data);
    showError(null);
    opts.onChange(data);
  };
  form.addEventListener('change', onFields);
  form.addEventListener('input', debounce(onFields, 300));

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
    if (fieldset.disabled) {
      fieldset.disabled = false;
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
    populateYamlStrip(opts.notes, data, form);
    opts.onChange(data);
  }, 400));

  return {
    setData(next) {
      if (!alive()) return releaseFrontmatterPod(opts.owner);
      data = { ...next };
      populateYamlStrip(opts.notes, data, form);
      // No pisar lo que se está escribiendo en el YAML.
      if (document.activeElement !== textarea) {
        textarea.value = frontmatterToYaml(data);
        showError(null);
      }
    },
  };
}
