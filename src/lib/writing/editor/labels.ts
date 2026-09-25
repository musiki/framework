// src/lib/writing/editor/labels.ts
// User-visible strings for `mountDbNoteEditor` (src/scripts/notas/personal-notes-workspace.ts).
// Kept pure (no DOM/astro imports) so it can be unit-tested with plain node:test.
import type { Locale } from '../../tenant/tenants.ts';
import { t } from '../../i18n/index.ts';
import type { ContentLang } from '../lang/index.ts';

export type { ContentLang };

export interface EditorLabels {
  loading: string;
  notFound: string;
  viewRender: string;
  backToEdit: string;
  rendering: string;
  renderError: string;
  commentsTitle: string;
  filterAll: string;
  showResolvedLabel: string;
  versionsTitle: string;
  saveVersionBtn: string;
  commentBtnTitle: string;
  historyBtnTitle: string;
  generalCommentPlaceholder: string;
  commentSubmit: string;
  commentSelectionLabel: string;
  commentOnPlaceholder: string;
  cancelBtn: string;
  noComments: string;
  resolveBtn: string;
  resolvedBadge: string;
  deleteConversationTitle: string;
  defaultUserName: string;
  replyPlaceholder: string;
  sendBtn: string;
  deleteReplyTitle: string;
  confirmDeleteReply: string;
  confirmDeleteConversation: string;
  previewPrefix: string;
  noVersions: string;
  byPrefix: string;
  previewVersionTitle: string;
  renameVersionTitle: string;
  resaveVersionTitle: string;
  restoreVersionTitle: string;
  deleteVersionTitle: string;
  previewLoadError: string;
  renameVersionPrompt: string;
  renameVersionError: string;
  confirmResaveVersion: string;
  resaveVersionSuccess: string;
  resaveVersionError: string;
  confirmRestoreVersion: string;
  restoreVersionError: string;
  confirmDeleteVersion: string;
  deleteVersionError: string;
  saveVersionPrompt: string;
  saveVersionError: string;
  unsavedDraft: string;
  useDraftBtn: string;
  discardDraftBtn: string;
  versionsOnlyNotice: string;
}

// Today's literal Spanish strings from `mountDbNoteEditor`, verbatim — this is the
// runtime default so musiki keeps working without depending on the i18n module.
export const DEFAULT_ES_LABELS: EditorLabels = {
  loading: 'Cargando…',
  notFound: 'Nota no encontrada',
  viewRender: 'Ver render Markdown (Alt+Shift+E)',
  backToEdit: 'Volver a live edit (Alt+Shift+E)',
  rendering: 'Renderizando…',
  renderError: 'No se pudo renderizar la vista Markdown.',
  commentsTitle: 'Comentarios',
  filterAll: 'Todas',
  showResolvedLabel: 'Resueltos',
  versionsTitle: 'Versiones',
  saveVersionBtn: 'Guardar versión...',
  commentBtnTitle: 'Comentarios y Anotaciones',
  historyBtnTitle: 'Historial de versiones',
  generalCommentPlaceholder: 'Escribir un comentario general...',
  commentSubmit: 'Comentar',
  commentSelectionLabel: 'Comentar selección:',
  commentOnPlaceholder: 'Añadir comentario sobre esta {label}...',
  cancelBtn: 'Cancelar',
  noComments: 'No hay comentarios aún',
  resolveBtn: 'Resolver',
  resolvedBadge: '✓ Resuelto',
  deleteConversationTitle: 'Eliminar conversación',
  defaultUserName: 'Usuario',
  replyPlaceholder: 'Responder...',
  sendBtn: 'Enviar',
  deleteReplyTitle: 'Eliminar respuesta',
  confirmDeleteReply: '¿Eliminar esta respuesta?',
  confirmDeleteConversation: '¿Eliminar esta conversación por completo?',
  previewPrefix: 'Vista previa: {name}',
  noVersions: 'No hay versiones guardadas',
  byPrefix: 'Por {name} · {time}',
  previewVersionTitle: 'Previsualizar esta versión',
  renameVersionTitle: 'Cambiar nombre de la versión',
  resaveVersionTitle: 'Sobrescribir esta versión con el contenido actual del editor',
  restoreVersionTitle: 'Restaurar esta versión',
  deleteVersionTitle: 'Eliminar esta versión',
  previewLoadError: 'No se pudo cargar la vista previa de la versión.',
  renameVersionPrompt: 'Cambiar nombre de la versión:',
  renameVersionError: 'No se pudo cambiar el nombre de la versión.',
  confirmResaveVersion: '¿Sobrescribir la versión "{name}" con el contenido actual del editor?',
  resaveVersionSuccess: 'Versión sobrescrita con éxito.',
  resaveVersionError: 'No se pudo sobrescribir la versión.',
  confirmRestoreVersion: '¿Restaurar la versión "{name}"? Se reemplazará el contenido actual del editor.',
  restoreVersionError: 'No se pudo restaurar la versión.',
  confirmDeleteVersion: '¿Eliminar la versión "{name}"? Esta acción no se puede deshacer.',
  deleteVersionError: 'No se pudo eliminar la versión.',
  saveVersionPrompt: 'Nombre de la versión (ej: Primer borrador, Notas de clase):',
  saveVersionError: 'Error al guardar la versión.',
  unsavedDraft: 'Borrador no guardado ({time})',
  useDraftBtn: 'Usar borrador',
  discardDraftBtn: 'Descartar',
  versionsOnlyNotice: 'Solo podés ver las versiones congeladas.',
};

const KEYS = Object.keys(DEFAULT_ES_LABELS) as Array<keyof EditorLabels>;

export function buildEditorLabels(locale: Locale): EditorLabels {
  const out = {} as EditorLabels;
  for (const key of KEYS) {
    out[key] = t(locale, `editor.${key}` as Parameters<typeof t>[1]);
  }
  return out;
}

// Fills `{name}`/`{time}`/`{label}`-style placeholders in a label template.
// Mirrors the `{vars}` interpolation `t()` already does, kept local so the
// editor doesn't need to route through the full i18n module at runtime.
export function formatLabel(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? vars[name] : match));
}

// ── Trace margin labels (src/scripts/course/notes/trace-margin.ts) ─────────
// Same pattern as EditorLabels above: DEFAULT_ES_TRACE_LABELS is today's exact
// literal Spanish UI strings from trace-margin.ts, verbatim, used as the
// runtime default so musiki keeps working unchanged. `role` covers every
// RhetoricalRole key trace-margin.ts defines (keys never change — only the
// display string does); most of those keys don't have an i18n `trace.role.*`
// entry (the creative-mode roles), so buildTraceLabels() falls back to the
// Spanish default for any role a locale doesn't translate.
export interface TraceLabels {
  sectionTrace: string;
  sectionStructure: string;
  sectionFreqZipf: string;
  sectionQa: string;
  liveBadge: string;
  liveBadgeAt: string;
  autoBtn: string;
  autoBtnTitle: string;
  autoBtnNoSuggestions: string;
  modeLabel: string;
  modeSelectTitle: string;
  modeAcademic: string;
  modeThesis: string;
  modeLitArt: string;
  modeArtisticResearch: string;
  modeSeminar: string;
  modeSubmission: string;
  emptyParagraphsLitArt: string;
  emptyParagraphs: string;
  jumpToParagraph: string;
  jumpToParagraphAria: string;
  roleSelectTitle: string;
  roleSelectTitleReadOnly: string;
  roleSelectAriaPrefix: string;
  roleEmptyOption: string;
  roleExternalSuffix: string;
  addCode: string;
  addCodePlaceholder: string;
  conceptsLabelLitArt: string;
  conceptsLabelArtisticResearch: string;
  conceptsLabelDefault: string;
  deleteCode: string;
  emergentCodeTitle: string;
  conceptTooltip: string;
  diagnosticsPrefixCreative: string;
  diagnosticsPrefixDefault: string;
  orphanConcept: string;
  qaCodesMetric: string;
  qaEmergentMetric: string;
  qaRolesMetric: string;
  qaWarningsMetric: string;
  qaCopyLitArt: string;
  qaCopyDefault: string;
  kwicEmptyQuery: string;
  kwicNoMatches: string;
  kwicHeading: string;
  lexicalPlaceholder: string;
  freqHeading: string;
  freqEmpty: string;
  freqRowTitle: string;
  zipfIdealTitle: string;
  zipfInsufficient: string;
  zipfStats: string;
  graphNodeAria: string;
  graphLinkAria: string;
  rhythmSummary: string;
  rhythmClassSingleLongSentence: string;
  rhythmClassShortSentences: string;
  rhythmClassMixedRhythm: string;
  rhythmClassAccumulative: string;
  rhythmClassFragmentary: string;
  rhythmClassQuestioning: string;
  rhythmClassEmphaticClosure: string;
  diagUnreturnedMotif: string;
  diagMotifReturn: string;
  diagVoiceShift: string;
  diagDenseParagraph: string;
  diagUndocumentedDecision: string;
  diagMissingMaterialEvidence: string;
  diagVariantWithoutComparison: string;
  diagReflectionWithoutProcess: string;
  diagProcessWithoutReflection: string;
  role: Record<string, string>;
}

export const DEFAULT_ES_TRACE_LABELS: TraceLabels = {
  sectionTrace: 'Trace',
  sectionStructure: 'Estructura',
  sectionFreqZipf: 'Freq · Zipf',
  sectionQa: 'QA',
  liveBadge: 'LIVE',
  liveBadgeAt: 'LIVE · P{index}',
  autoBtn: '⚡ Auto',
  autoBtnTitle: 'Generar codificación automática (NLP)',
  autoBtnNoSuggestions: 'Sin sugerencias',
  modeLabel: 'Modo',
  modeSelectTitle: 'Modo del análisis estructural',
  modeAcademic: 'Académico',
  modeThesis: 'Tesis',
  modeLitArt: 'Lit Art (Literatura y Arte)',
  modeArtisticResearch: 'Investigación Artística',
  modeSeminar: 'Seminario',
  modeSubmission: 'Entrega',
  emptyParagraphsLitArt: '[sin párrafos extensos para analizar]',
  emptyParagraphs: '[sin párrafos]',
  jumpToParagraph: 'Ir al párrafo',
  jumpToParagraphAria: 'Ir al párrafo {index}',
  roleSelectTitle: 'Rol retórico del párrafo',
  roleSelectTitleReadOnly: 'Rol retórico del párrafo (solo lectura)',
  roleSelectAriaPrefix: 'Rol retórico de ',
  roleEmptyOption: '— rol',
  roleExternalSuffix: ' (externo)',
  addCode: 'Añadir código',
  addCodePlaceholder: 'nombre del código…',
  conceptsLabelLitArt: 'motivos: ',
  conceptsLabelArtisticResearch: 'trazas: ',
  conceptsLabelDefault: 'conceptos: ',
  deleteCode: 'Eliminar',
  emergentCodeTitle: 'Código emergente detectado localmente',
  conceptTooltip: '{estado} · confianza local {pct}%',
  diagnosticsPrefixCreative: 'observación: ',
  diagnosticsPrefixDefault: 'diagnostics: ⚠ ',
  orphanConcept: 'concepto huérfano "{label}"',
  qaCodesMetric: '{count} códigos',
  qaEmergentMetric: '{count} emergentes',
  qaRolesMetric: '{count} roles',
  qaWarningsMetric: '{count} indicios',
  qaCopyLitArt: 'Lit Art: se omiten párrafos breves de una o dos líneas.',
  qaCopyDefault: 'Indicios locales de cohesión: no califican la calidad del argumento.',
  kwicEmptyQuery: 'Selecciona una palabra',
  kwicNoMatches: 'Sin concordancias',
  kwicHeading: 'KWIC',
  lexicalPlaceholder: 'concordancia...',
  freqHeading: 'Rango · frecuencia observada',
  freqEmpty: 'Sin términos suficientes',
  freqRowTitle: 'Ver concordancias',
  zipfIdealTitle: 'Ideal Zipf aproximado: {value}',
  zipfInsufficient: 'Distribución insuficiente para estimar una pendiente.',
  zipfStats: '{tokens} tokens · {vocab} términos · pendiente log-log {slope}',
  graphNodeAria: 'Ir al párrafo {index}',
  graphLinkAria: 'P{to} retoma P{from}: {evidence}',
  rhythmSummary: 'frases: {count} · {summary}',
  rhythmClassSingleLongSentence: 'frase única larga',
  rhythmClassShortSentences: 'frases breves',
  rhythmClassMixedRhythm: 'ritmo mixto',
  rhythmClassAccumulative: 'acumulativo',
  rhythmClassFragmentary: 'fragmentario',
  rhythmClassQuestioning: 'interrogativo',
  rhythmClassEmphaticClosure: 'cierre enfático',
  diagUnreturnedMotif: 'Motivo no retomado: "{keyword}"',
  diagMotifReturn: 'Retorno del motivo "{keyword}"',
  diagVoiceShift: 'Cambio de voz detectado en P{index}',
  diagDenseParagraph: 'Párrafo denso con frases largas',
  diagUndocumentedDecision: 'Decisión sin documentación en el proceso',
  diagMissingMaterialEvidence: 'Observación material sin evidencia de documentación',
  diagVariantWithoutComparison: 'Variante sin comparación de alternativas',
  diagReflectionWithoutProcess: 'Reflexión sin registro previo de proceso',
  diagProcessWithoutReflection: 'Nota de proceso sin reflexión crítica asociada',
  role: {
    excluir: 'Excluir',
    afirmacion: 'afirmación',
    definicion: 'definición',
    contexto: 'contexto',
    literatura: 'literatura',
    ejemplo: 'ejemplo',
    analisis: 'análisis',
    contraste: 'contraste',
    transicion: 'transición',
    sintesis: 'síntesis',
    metodo: 'método',
    reflexion: 'reflexión',
    conclusion: 'conclusión',
    reflection: 'Reflexión',
    method: 'Método',
    example: 'Ejemplo',
    analysis: 'Análisis',
    synthesis: 'Síntesis',
    closure: 'Cierre',
    scene_opening: 'Apertura de escena',
    image: 'Imagen',
    motif_introduction: 'Introducción de motivo',
    motif_return: 'Retorno de motivo',
    variation: 'Variación',
    voice_shift: 'Cambio de voz',
    interruption: 'Interrupción',
    description: 'Descripción',
    action: 'Acción',
    memory: 'Memoria',
    dialogue: 'Diálogo',
    tension: 'Tensión',
    turn: 'Giro',
    ellipsis: 'Elipsis',
    montage: 'Montaje',
    resonance: 'Resonancia',
    process_note: 'Nota de proceso',
    artistic_question: 'Pregunta artística',
    material_observation: 'Observación material',
    technical_constraint: 'Restricción técnica',
    decision: 'Decisión',
    discard: 'Descarte',
    variant: 'Variante',
    documentation: 'Documentación',
    peer_feedback: 'Feedback de pares',
    ai_feedback: 'Feedback IA',
    revision: 'Revisión',
    public_artifact: 'Artefacto público',
  },
};

const TRACE_KEYS = Object.keys(DEFAULT_ES_TRACE_LABELS) as Array<keyof TraceLabels>;
// Rhetorical role keys that have a real i18n `trace.role.*` entry (see
// src/lib/i18n/{en,es}.ts). Every other RhetoricalRole key falls back to the
// Spanish default above, for every locale — there is no translation for the
// creative-mode roles (lit_art / artistic_research) yet.
const TRANSLATED_ROLE_KEYS = [
  'afirmacion', 'definicion', 'contexto', 'literatura', 'ejemplo', 'analisis',
  'contraste', 'transicion', 'sintesis', 'metodo', 'reflexion', 'conclusion', 'excluir',
];

export function buildTraceLabels(locale: Locale): TraceLabels {
  const out = {} as TraceLabels;
  for (const key of TRACE_KEYS) {
    if (key === 'role') continue;
    (out as unknown as Record<string, string>)[key] = t(locale, `trace.ui.${key}` as Parameters<typeof t>[1]);
  }
  const role: Record<string, string> = Object.fromEntries(Object.entries(DEFAULT_ES_TRACE_LABELS.role).map(([key, value]) => [key, locale === 'en' && !TRANSLATED_ROLE_KEYS.includes(key) ? key.replaceAll('_', ' ') : value]));
  for (const key of TRANSLATED_ROLE_KEYS) {
    role[key] = t(locale, `trace.role.${key}` as Parameters<typeof t>[1]);
  }
  out.role = role;
  return out;
}
