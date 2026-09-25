import { mountDbNoteEditor } from '../../lib/writing/editor';
import type { EditorLabels, TraceLabels } from '../../lib/writing/editor/labels';
import type { ContentLang } from '../../lib/writing/lang';
const root = document.querySelector<HTMLElement>('#studio-editor');
if (root) {
  const body = document.querySelector<HTMLElement>('#studio-editor-body')!;
  const status = document.querySelector<HTMLElement>('#studio-status')!;
  const trace = document.querySelector<HTMLButtonElement>('#studio-trace')!;
  const edit = document.querySelector<HTMLButtonElement>('#studio-edit')!;
  const download = document.querySelector<HTMLButtonElement>('#studio-download')!;
  const menu = document.querySelector<HTMLElement>('#studio-download-menu')!;
  void mountDbNoteEditor(body, status, trace, root.dataset.note!, edit, download, menu, {
    apiBase: '/api/studio/notes', previewUrl: '/api/studio/preview-markdown', uploadUrl: '/api/studio/upload-image',
    spaceId: root.dataset.space!, contentLang: (root.dataset.lang || 'en') as ContentLang,
    labels: JSON.parse(root.dataset.labels!) as EditorLabels, traceLabels: JSON.parse(root.dataset.traceLabels!) as TraceLabels,
  });
}
