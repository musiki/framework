// Esquema de metadatos de una nota: qué campos tiene, con qué control se editan
// y qué valores ofrecen. Puro y sin DOM, para poder testearlo.
//
// Existe por un bug concreto. El formulario tenía las opciones escritas a mano
// —type: lesson|eval|assignment|info|public-note— y al guardar hacía
// `type: yamlFields.type || 'lesson'`. Un <select> al que se le asigna un valor
// que no está entre sus opciones queda vacío, así que abrir una nota
// `type: concept` y guardarla la convertía en `lesson`. Lo mismo con
// `status: public`, que terminaba en `draft`.
//
// La regla que impide que vuelva a pasar está en `optionsFor`: el valor actual
// de la nota siempre entra a la lista, aunque el esquema no lo conozca.

/** Tipos de nota que el vault usa de verdad, por frecuencia. */
export const NOTE_TYPES = [
  'concept', 'glossary', 'lesson', 'info', 'note',
  'assignment', 'eval', 'public-note',
  'person', 'obra', 'work', 'proyecto', 'technology',
  'latex-template', 'lilypond_recipe', 'service', 'course',
];

/** Estados en uso. `draft` muestra el badge «Material en preparación». */
export const NOTE_STATUSES = ['draft', 'inprocess', 'published', 'public', 'nonshown'];

/**
 * Campos editables.
 *
 * `kinds: null` = se muestra siempre. Si no, sólo para esos `type`.
 * `control`: 'select' | 'text' | 'textarea' | 'number' | 'list' | 'links'
 *   · list  → coma separada, se guarda como array
 *   · links → wikilinks separados por coma, se guardan como ["[[x]]", "[[y]]"]
 */
export const NOTE_FIELDS = [
  { name: 'type', label: 'Tipo', control: 'select', options: NOTE_TYPES, kinds: null },
  { name: 'status', label: 'Estado', control: 'select', options: NOTE_STATUSES, kinds: null },
  { name: 'chapter', label: 'Capítulo', control: 'text', datalist: 'chapter', kinds: null },
  { name: 'order', label: 'Orden', control: 'number', kinds: null },
  { name: 'theme', label: 'Tema', control: 'select', options: [], datalist: 'theme', kinds: ['lesson'] },
  {
    name: 'def', label: 'Sinopsis', control: 'textarea', kinds: ['concept', 'glossary'],
    help: 'Una a tres oraciones autocontenidas. Es lo que se ve en el índice.',
  },
  { name: 'slug', label: 'Slug', control: 'text', kinds: null },
  { name: 'alias', label: 'Alias', control: 'text', kinds: ['concept', 'glossary'] },
  { name: 'tags', label: 'Tags', control: 'list', kinds: null },
  { name: 'hyper', label: 'Más general', control: 'links', kinds: ['concept', 'glossary'] },
  { name: 'hypo', label: 'Más específicos', control: 'links', kinds: ['concept', 'glossary'] },
  { name: 'connect', label: 'Relación lateral', control: 'links', kinds: ['concept', 'glossary'] },
];

/** Los campos que corresponden a una nota de este tipo. */
export function fieldsFor(type) {
  const t = String(type || '').trim();
  return NOTE_FIELDS.filter((f) => !f.kinds || f.kinds.includes(t));
}

/**
 * Opciones de un select, con el valor actual incluido aunque el esquema no lo
 * conozca. Es lo que evita que guardar pierda un valor que no estaba previsto.
 */
export function optionsFor(field, currentValue, extra = []) {
  const base = [...(field.options || []), ...extra.filter(Boolean)];
  const actual = String(currentValue ?? '').trim();
  const vistos = new Set();
  const salida = [];
  for (const v of [...base, actual]) {
    const s = String(v ?? '').trim();
    if (!s || vistos.has(s)) continue;
    vistos.add(s);
    salida.push(s);
  }
  return salida;
}

/** Texto del control a partir del valor del frontmatter. */
export function toControlValue(field, value) {
  if (field.control === 'list' || field.control === 'links') {
    const arr = Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
    return arr.map((v) => String(v).trim()).filter(Boolean).join(', ');
  }
  if (field.control === 'number') return String(Number(value) || 0);
  return value == null ? '' : String(value);
}

/** Valor de frontmatter a partir del texto del control. */
export function fromControlValue(field, raw) {
  const texto = String(raw ?? '').trim();
  if (field.control === 'number') return Number(texto) || 0;
  if (field.control === 'list') {
    return texto ? texto.split(',').map((s) => s.trim()).filter(Boolean) : [];
  }
  if (field.control === 'links') {
    return texto
      ? texto.split(',').map((s) => {
          const limpio = s.trim().replace(/^\[\[|\]\]$/g, '').trim();
          return limpio ? `[[${limpio}]]` : '';
        }).filter(Boolean)
      : [];
  }
  return texto;
}

/**
 * Aplica lo editado sobre el frontmatter existente.
 *
 * Sólo toca los campos que el formulario mostró: lo que no se editó se conserva
 * tal cual, y un campo que quedó vacío se borra en vez de guardarse como ''.
 */
export function applyEdits(current = {}, edits = {}, visibles = null) {
  const salida = { ...current };
  const campos = visibles || NOTE_FIELDS;
  for (const field of campos) {
    if (!(field.name in edits)) continue;
    const valor = fromControlValue(field, edits[field.name]);
    const vacio = valor === '' || (Array.isArray(valor) && valor.length === 0);
    if (vacio) delete salida[field.name];
    else salida[field.name] = valor;
  }
  return salida;
}
