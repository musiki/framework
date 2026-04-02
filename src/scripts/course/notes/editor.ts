import { enhanceMarkdownTextarea } from '../../markdown-editor-tools.ts';
import { enhanceCourseNotesContent } from './content.ts';

type MountIntegratedCourseNotesEditorOptions = {
  contentSelector?: string;
  editorSelector?: string;
  formId?: string;
  publishEndpoint?: string;
  statusId?: string;
};

type ContentPublishResponse = {
  error?: string;
  fileSha?: string;
  path?: string;
  renderedHtml?: string;
};

type CourseNotesWindow = Window & {
  __musikiCourseContentBootKey?: string;
};

const DEFAULT_OPTIONS: Required<MountIntegratedCourseNotesEditorOptions> = {
  contentSelector: '[data-class-content]',
  editorSelector: '[data-inline-editor]',
  formId: 'integrated-content-editor-form',
  publishEndpoint: '/api/content-admin/publish',
  statusId: 'integrated-editor-status',
};

function parsePublishResponse(raw: string): ContentPublishResponse {
  if (!raw) return {};

  try {
    return JSON.parse(raw) as ContentPublishResponse;
  } catch {
    return { error: raw || 'Error al publicar' };
  }
}

export function mountIntegratedCourseNotesEditor(
  options: MountIntegratedCourseNotesEditorOptions = {},
): void {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const form = document.getElementById(resolved.formId);
  const statusNode = document.getElementById(resolved.statusId);
  if (!(form instanceof HTMLFormElement) || !(statusNode instanceof HTMLElement)) return;
  if (form.dataset.bound === 'true') return;
  form.dataset.bound = 'true';

  const textarea = form.elements.namedItem('content');
  const actionsContainer = form.querySelector('.editor-actions');

  if (textarea instanceof HTMLTextAreaElement) {
    enhanceMarkdownTextarea(textarea, {
      actionsContainer: actionsContainer instanceof HTMLElement ? actionsContainer : null,
      status: (message, tone = 'info') => {
        statusNode.dataset.tone = tone === 'error' ? 'error' : 'idle';
        statusNode.textContent = message;
      },
      buttonClassName: 'editor-markdown-tool-btn',
      actionSpacerClassName: 'editor-markdown-tool-spacer',
      dropzoneClassName: 'editor-markdown-dropzone',
      dropzoneOverlayClassName: 'editor-markdown-dropzone-overlay',
      dropzoneLabelClassName: 'editor-markdown-dropzone-label',
      inputClassName: '',
      dropLabel: 'Drop file',
      useCodeMirror: true,
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = true;

    statusNode.dataset.tone = 'idle';
    statusNode.textContent = 'Guardando...';

    try {
      const payload = Object.fromEntries(new FormData(form).entries());
      const response = await fetch(resolved.publishEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = parsePublishResponse(await response.text());
      if (!response.ok) {
        throw new Error(result.error || 'Error al publicar');
      }

      const contentNode = document.querySelector(resolved.contentSelector);
      const editorNode = document.querySelector(resolved.editorSelector);
      const contentArea = document.querySelector('.content-area');
      const nextHref = String(form.dataset.cleanHref || window.location.pathname).trim() || window.location.pathname;
      const mode = String(form.dataset.mode || payload.mode || '').trim().toLowerCase();

      if (contentNode instanceof HTMLElement && typeof result.renderedHtml === 'string' && result.renderedHtml.trim()) {
        contentNode.innerHTML = result.renderedHtml;
        contentNode.hidden = false;
        enhanceCourseNotesContent(contentNode);
      }

      if (editorNode instanceof HTMLElement) {
        editorNode.hidden = true;
      }

      if (contentArea instanceof HTMLElement) {
        contentArea.classList.remove('is-editor-active');
      }

      statusNode.dataset.tone = 'success';
      statusNode.textContent = mode === 'create'
        ? 'Nota creada. Vista previa cargada.'
        : '¡Guardado correctamente!';

      const shaInput = form.elements.namedItem('sha');
      if (shaInput instanceof HTMLInputElement && typeof result.fileSha === 'string') {
        shaInput.value = result.fileSha;
      }

      const pathInput = form.elements.namedItem('targetPath');
      if (pathInput instanceof HTMLInputElement && typeof result.path === 'string' && result.path) {
        pathInput.value = result.path;
      }

      const modeInput = form.elements.namedItem('mode');
      if (modeInput instanceof HTMLInputElement && mode === 'create') {
        modeInput.value = 'edit';
      }

      window.history.replaceState({}, '', nextHref);
      (window as CourseNotesWindow).__musikiCourseContentBootKey = '';
      document.dispatchEvent(new Event('astro:page-load'));
    } catch (error) {
      statusNode.dataset.tone = 'error';
      statusNode.textContent = error instanceof Error ? error.message : 'Error al publicar';
      if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = false;
      return;
    }

    if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = false;
  });
}
