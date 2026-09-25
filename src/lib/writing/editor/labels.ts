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
