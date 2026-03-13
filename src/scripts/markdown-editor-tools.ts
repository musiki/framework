type StatusTone = 'info' | 'error';

type TemplateConfig = {
  title: string;
  icon: string;
  snippet: string;
  cursorToken?: string;
  cursorSearch?: string;
};

type EnhanceMarkdownTextareaOptions = {
  actionsContainer?: HTMLElement | null;
  status?: (message: string, tone?: StatusTone) => void;
  uploadEndpoint?: string;
  buttonClassName?: string;
  actionSpacerClassName?: string;
  dropzoneClassName?: string;
  dropzoneOverlayClassName?: string;
  dropzoneLabelClassName?: string;
  inputClassName?: string;
  dropLabel?: string;
};

const CURSOR_TOKEN = '<cursor here>';
const DEFAULT_UPLOAD_ENDPOINT = '/api/forum/upload-image';
const DEFAULT_BUTTON_CLASS_NAME = 'forum-action-btn forum-action-f forum-editor-action-btn';
const DEFAULT_ACTION_SPACER_CLASS_NAME = 'forum-editor-action-spacer';
const DEFAULT_DROPZONE_CLASS_NAME = 'forum-editor-dropzone';
const DEFAULT_DROPZONE_OVERLAY_CLASS_NAME = 'forum-editor-dropzone-overlay';
const DEFAULT_DROPZONE_LABEL_CLASS_NAME = 'forum-editor-dropzone-label';
const DEFAULT_INPUT_CLASS_NAME = 'forum-editor-input';

const TEMPLATES: Record<string, TemplateConfig> = {
  lilypond: {
    title: 'Insertar bloque LilyPond',
    icon:
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.75 2v7.1"/><path d="M10.75 2 5.25 3.4v7.35"/><path d="M10.75 5.1 5.25 6.5"/><ellipse cx="4.1" cy="11.8" rx="1.85" ry="1.35"/><ellipse cx="9.6" cy="10.35" rx="1.85" ry="1.35"/></svg>',
    snippet:
      '```lily\n'
      + '\\version "2.24.0" % Specify your LilyPond version\n'
      + '\\paper { \n'
      + 'tagline = ##f  \n'
      + 'paper-height=#(* 2 cm) \n'
      + 'paper-width=#(* 10 cm)  \n'
      + 'system-count=#1 }\n\n'
      + '\\score {\n'
      + `\\new Staff \\relative{c'4 ${CURSOR_TOKEN}}\n`
      + '}\n'
      + '```',
    cursorToken: CURSOR_TOKEN,
  },
  mermaid: {
    title: 'Insertar bloque Mermaid',
    icon:
      '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="2" width="3.5" height="2.5" rx="0.45"/><rect x="10.75" y="2" width="3.5" height="2.5" rx="0.45"/><rect x="6.25" y="11.5" width="3.5" height="2.5" rx="0.45"/><path d="M5.25 3.25h5.5"/><path d="M12.5 4.5v2.05c0 .55-.45 1-1 1H8"/><path d="M3.5 4.5v2.05c0 .55.45 1 1 1H8"/><path d="M8 7.55v3.95"/></svg>',
    snippet: '```mermaid\ngraph LR\na[node] -->|edge| b[hub]\n```',
    cursorSearch: 'node',
  },
};

function emitStatus(
  status: EnhanceMarkdownTextareaOptions['status'],
  message: string,
  tone: StatusTone = 'info',
) {
  if (typeof status === 'function') {
    status(message, tone);
  }
}

function replaceTextareaSelection(
  textarea: HTMLTextAreaElement,
  nextText: string,
  start: number,
  end: number,
  cursorStart: number,
  cursorEnd = cursorStart,
) {
  const value = textarea.value || '';
  textarea.value = `${value.slice(0, start)}${nextText}${value.slice(end)}`;
  textarea.setSelectionRange(cursorStart, cursorEnd);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function insertTemplate(textarea: HTMLTextAreaElement, template: TemplateConfig) {
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? start;
  let snippet = template.snippet;
  let cursorOffset = snippet.length;
  let selectionLength = 0;

  if (template.cursorToken && snippet.includes(template.cursorToken)) {
    cursorOffset = snippet.indexOf(template.cursorToken);
    snippet = snippet.replace(template.cursorToken, '');
  } else if (template.cursorSearch && snippet.includes(template.cursorSearch)) {
    cursorOffset = snippet.indexOf(template.cursorSearch);
    selectionLength = template.cursorSearch.length;
  }

  replaceTextareaSelection(
    textarea,
    snippet,
    start,
    end,
    start + cursorOffset,
    start + cursorOffset + selectionLength,
  );
  textarea.focus();
}

function getUploadKind(file: File): 'image' | 'audio' | 'video' | '' {
  const mime = String(file.type || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  const fileName = String(file.name || '').toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(fileName)) return 'image';
  if (/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(fileName)) return 'audio';
  if (/\.(mp4|m4v|mov|webm|ogv)$/i.test(fileName)) return 'video';
  return '';
}

function extractUploadFiles(
  fileList?: FileList | File[] | null,
  itemList?: DataTransferItemList | null,
): File[] {
  const directFiles = Array.from(fileList || []).filter((file): file is File => file instanceof File);
  if (directFiles.length > 0) {
    return directFiles.filter((file) => getUploadKind(file) !== '');
  }

  const itemFiles = Array.from(itemList || [])
    .filter((item) => item?.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file instanceof File);

  return itemFiles.filter((file) => getUploadKind(file) !== '');
}

async function uploadMediaFile(file: File, uploadEndpoint: string) {
  const uploadForm = new FormData();
  uploadForm.append('file', file, file.name || 'editor-upload');

  const response = await fetch(uploadEndpoint, {
    method: 'POST',
    body: uploadForm,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || 'No se pudo subir el archivo.');
  }

  const mediaUrl = typeof payload?.url === 'string' ? payload.url.trim() : '';
  const kind = typeof payload?.kind === 'string' ? payload.kind.trim() : getUploadKind(file);
  if (!mediaUrl) {
    throw new Error('El servidor no devolvió una URL de archivo.');
  }

  return { url: mediaUrl, kind };
}

function insertMediaEmbeds(
  textarea: HTMLTextAreaElement,
  mediaEntries: Array<{ url: string; kind?: string }>,
) {
  if (!Array.isArray(mediaEntries) || mediaEntries.length === 0) return;

  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? start;
  const currentValue = textarea.value || '';
  const previousChar = start > 0 ? currentValue.slice(start - 1, start) : '';
  const nextChar = end < currentValue.length ? currentValue.slice(end, end + 1) : '';

  let snippet = mediaEntries.map((entry) => `![](${entry.url})`).join('\n');
  if (previousChar && previousChar !== '\n') {
    snippet = `\n${snippet}`;
  }
  if (nextChar && nextChar !== '\n') {
    snippet = `${snippet}\n`;
  }

  replaceTextareaSelection(
    textarea,
    snippet,
    start,
    end,
    start + snippet.length,
  );
  textarea.focus();
}

function describeUploadBatch(files: File[]) {
  let imageCount = 0;
  let audioCount = 0;
  let videoCount = 0;
  for (const file of files) {
    const kind = getUploadKind(file);
    if (kind === 'image') imageCount += 1;
    if (kind === 'audio') audioCount += 1;
    if (kind === 'video') videoCount += 1;
  }

  const labels = [];
  if (imageCount > 0) labels.push(imageCount === 1 ? 'imagen' : `${imageCount} imágenes`);
  if (audioCount > 0) labels.push(audioCount === 1 ? 'audio' : `${audioCount} audios`);
  if (videoCount > 0) labels.push(videoCount === 1 ? 'video' : `${videoCount} videos`);
  return labels.join(' y ') || 'archivo';
}

function attachTypingHelpers(textarea: HTMLTextAreaElement) {
  if (textarea.dataset.markdownTypingEnhanced === 'true') return;
  textarea.dataset.markdownTypingEnhanced = 'true';

  const openerPairs: Record<string, string> = {
    '(': ')',
    '[': ']',
    '{': '}',
    '"': '"',
    "'": "'",
    '`': '`',
  };
  const closers = new Set(Object.values(openerPairs));
  const normalizeMermaidArrows = (rawValue: string) =>
    String(rawValue || '').replace(
      /```mermaid([\s\S]*?)```/g,
      (block) =>
        block
          .replaceAll('→', '-->')
          .replaceAll('⟶', '-->')
          .replaceAll('⇢', '-->')
          .replaceAll('←', '<--')
          .replaceAll('⟵', '<--')
          .replaceAll('⇠', '<--'),
    );

  textarea.addEventListener('beforeinput', (event) => {
    const inputEvent = event as InputEvent;
    if (inputEvent.inputType !== 'insertText') return;
    const text = String(inputEvent.data || '');
    const selectionStart = textarea.selectionStart ?? 0;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;
    const hasSelection = selectionEnd > selectionStart;

    if (Object.prototype.hasOwnProperty.call(openerPairs, text)) {
      const closer = openerPairs[text];
      event.preventDefault();
      const selectedText = hasSelection ? textarea.value.slice(selectionStart, selectionEnd) : '';
      const nextText = `${text}${selectedText}${closer}`;
      const cursorStart = selectionStart + 1;
      const cursorEnd = hasSelection ? selectionEnd + 1 : cursorStart;
      replaceTextareaSelection(textarea, nextText, selectionStart, selectionEnd, cursorStart, cursorEnd);
      return;
    }

    if (closers.has(text) && !hasSelection) {
      const nextChar = textarea.value.slice(selectionStart, selectionStart + 1);
      if (nextChar === text) {
        event.preventDefault();
        textarea.setSelectionRange(selectionStart + 1, selectionStart + 1);
      }
    }
  });

  textarea.addEventListener('input', () => {
    const normalized = normalizeMermaidArrows(textarea.value);
    if (normalized === textarea.value) return;
    const cursor = textarea.selectionStart ?? normalized.length;
    textarea.value = normalized;
    textarea.setSelectionRange(cursor, cursor);
  });
}

function ensureDropzone(
  textarea: HTMLTextAreaElement,
  options: EnhanceMarkdownTextareaOptions,
) {
  const dropzoneClassName = options.dropzoneClassName || DEFAULT_DROPZONE_CLASS_NAME;
  const overlayClassName = options.dropzoneOverlayClassName || DEFAULT_DROPZONE_OVERLAY_CLASS_NAME;
  const labelClassName = options.dropzoneLabelClassName || DEFAULT_DROPZONE_LABEL_CLASS_NAME;

  const existingParent = textarea.parentElement;
  if (existingParent && existingParent.classList.contains(dropzoneClassName)) {
    return existingParent;
  }

  const wrapper = document.createElement('div');
  wrapper.className = dropzoneClassName;

  const overlay = document.createElement('div');
  overlay.className = overlayClassName;
  overlay.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.className = labelClassName;
  label.textContent = options.dropLabel || 'Drop file';
  overlay.appendChild(label);

  textarea.parentNode?.insertBefore(wrapper, textarea);
  wrapper.appendChild(textarea);
  wrapper.appendChild(overlay);
  return wrapper;
}

async function handleMediaUpload(
  textarea: HTMLTextAreaElement,
  files: File[] | FileList | null | undefined,
  sourceLabel: string,
  options: EnhanceMarkdownTextareaOptions,
) {
  const uploadFiles = extractUploadFiles(files);
  if (uploadFiles.length === 0) return false;

  const uploadLabel = describeUploadBatch(uploadFiles);
  const dropzoneClassName = options.dropzoneClassName || DEFAULT_DROPZONE_CLASS_NAME;
  const uploadEndpoint = options.uploadEndpoint || DEFAULT_UPLOAD_ENDPOINT;
  textarea.closest(`.${dropzoneClassName}`)?.classList.add('is-uploading');
  textarea.classList.add('is-uploading');
  emitStatus(options.status, `Subiendo ${uploadLabel} desde ${sourceLabel}...`, 'info');

  try {
    const uploadedEntries = [];
    for (const file of uploadFiles) {
      const uploaded = await uploadMediaFile(file, uploadEndpoint);
      uploadedEntries.push(uploaded);
    }

    insertMediaEmbeds(textarea, uploadedEntries);
    emitStatus(
      options.status,
      uploadFiles.length === 1 ? 'Archivo insertado.' : `${uploadFiles.length} archivos insertados.`,
      'info',
    );
    return true;
  } catch (error: any) {
    console.error('Markdown editor media upload error:', error);
    emitStatus(options.status, error?.message || 'No se pudo subir el archivo.', 'error');
    return true;
  } finally {
    textarea.closest(`.${dropzoneClassName}`)?.classList.remove('is-uploading');
    textarea.closest(`.${dropzoneClassName}`)?.classList.remove('is-upload-target');
    textarea.classList.remove('is-uploading');
    textarea.classList.remove('is-upload-target');
  }
}

function createTemplateButton(
  textarea: HTMLTextAreaElement,
  templateKey: keyof typeof TEMPLATES,
  options: EnhanceMarkdownTextareaOptions,
) {
  const template = TEMPLATES[templateKey];
  const button = document.createElement('button');
  button.type = 'button';
  button.className = options.buttonClassName || DEFAULT_BUTTON_CLASS_NAME;
  button.title = template.title;
  button.setAttribute('aria-label', template.title);
  button.dataset.tooltip = template.title;
  button.innerHTML = template.icon;
  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });
  button.addEventListener('click', () => insertTemplate(textarea, template));
  return button;
}

function createUploadButton(textarea: HTMLTextAreaElement, options: EnhanceMarkdownTextareaOptions) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.hidden = true;
  input.accept = '.png,.jpg,.jpeg,.gif,.webp,.svg,.avif,.mp3,.wav,.ogg,.m4a,.aac,.flac,.mp4,.m4v,.mov,.webm,.ogv,image/*,audio/*,video/*';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = options.buttonClassName || DEFAULT_BUTTON_CLASS_NAME;
  button.title = 'Insertar archivo';
  button.setAttribute('aria-label', 'Insertar archivo');
  button.dataset.tooltip = 'Insertar archivo';
  button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.15 8.95 10.9 4.2a2.1 2.1 0 0 1 2.95 2.95L8.1 12.9A3.3 3.3 0 1 1 3.45 8.25l5.35-5.35"/><path d="M5.7 11.05 11 5.75"/></svg>';
  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });
  button.addEventListener('click', () => {
    input.click();
  });
  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    if (files.length > 0) {
      await handleMediaUpload(textarea, files, 'selector', options);
    }
    input.value = '';
  });

  return { button, input };
}

export function enhanceMarkdownTextarea(
  textarea: HTMLTextAreaElement | null | undefined,
  options: EnhanceMarkdownTextareaOptions = {},
) {
  if (!(textarea instanceof HTMLTextAreaElement)) return;
  if (textarea.dataset.markdownEditorEnhanced === 'true') return;
  textarea.dataset.markdownEditorEnhanced = 'true';

  const inputClassName = options.inputClassName || DEFAULT_INPUT_CLASS_NAME;
  if (inputClassName) {
    textarea.classList.add(...inputClassName.split(/\s+/).filter(Boolean));
  }

  attachTypingHelpers(textarea);

  const dropzone = ensureDropzone(textarea, options);
  let dragDepth = 0;

  const actions = options.actionsContainer;
  if (actions instanceof HTMLElement && textarea.dataset.markdownEditorActionsEnhanced !== 'true') {
    textarea.dataset.markdownEditorActionsEnhanced = 'true';
    const spacer = document.createElement('span');
    spacer.className = options.actionSpacerClassName || DEFAULT_ACTION_SPACER_CLASS_NAME;
    spacer.setAttribute('aria-hidden', 'true');

    const lilypondButton = createTemplateButton(textarea, 'lilypond', options);
    const mermaidButton = createTemplateButton(textarea, 'mermaid', options);
    const { button: uploadButton, input: uploadInput } = createUploadButton(textarea, options);

    actions.prepend(spacer);
    actions.appendChild(uploadInput);
    actions.prepend(uploadButton);
    actions.prepend(mermaidButton);
    actions.prepend(lilypondButton);
  }

  textarea.addEventListener('paste', async (event) => {
    const uploadFiles = extractUploadFiles(
      event.clipboardData?.files,
      event.clipboardData?.items,
    );
    if (uploadFiles.length === 0) return;

    event.preventDefault();
    await handleMediaUpload(textarea, uploadFiles, 'portapapeles', options);
  });

  textarea.addEventListener('dragover', (event) => {
    const uploadFiles = extractUploadFiles(
      event.dataTransfer?.files,
      event.dataTransfer?.items,
    );
    if (uploadFiles.length === 0) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    if (dropzone) dropzone.classList.add('is-upload-target');
    textarea.classList.add('is-upload-target');
  });

  textarea.addEventListener('dragenter', (event) => {
    const uploadFiles = extractUploadFiles(
      event.dataTransfer?.files,
      event.dataTransfer?.items,
    );
    if (uploadFiles.length === 0) return;

    event.preventDefault();
    dragDepth += 1;
    if (dropzone) dropzone.classList.add('is-upload-target');
    textarea.classList.add('is-upload-target');
  });

  textarea.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      if (dropzone) dropzone.classList.remove('is-upload-target');
      textarea.classList.remove('is-upload-target');
    }
  });

  textarea.addEventListener('drop', async (event) => {
    const uploadFiles = extractUploadFiles(
      event.dataTransfer?.files,
      event.dataTransfer?.items,
    );
    if (uploadFiles.length === 0) return;

    event.preventDefault();
    dragDepth = 0;
    if (dropzone) dropzone.classList.remove('is-upload-target');
    textarea.classList.remove('is-upload-target');
    await handleMediaUpload(textarea, uploadFiles, 'arrastre', options);
  });
}
