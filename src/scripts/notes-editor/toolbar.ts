import { insertAtCursor } from './editor';

const SNIPPETS: Record<string, string> = {
  cover: '%%cover%%\n<grid drag="60 55" drop="5 10">\n# título\n</grid>\n',
  lily: '```lily\n\\relative c\' {\n  c d e f g a b c\n}\n```\n',
  mermaid: '```mermaid\ngraph TD\n  A --> B\n```\n',
  iframe: '<iframe src="URL" width="100%" height="400" frameborder="0" allowfullscreen></iframe>\n',
  eval: '```eval\nevalType: class-reveal\n```\n',
};

async function uploadImageToS3(file: File, _courseId: string): Promise<string | null> {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/forum/upload-image', { method: 'POST', body: formData });
    if (!res.ok) return null;
    const data = await res.json();
    return data.url || data.publicUrl || data.imageUrl || null;
  } catch {
    return null;
  }
}

function detectVideoEmbed(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]+)/);
  if (yt) return `<iframe src="https://www.youtube.com/embed/${yt[1]}" width="100%" height="400" frameborder="0" allowfullscreen></iframe>\n`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `<iframe src="https://player.vimeo.com/video/${vimeo[1]}" width="100%" height="400" frameborder="0" allowfullscreen></iframe>\n`;
  return null;
}

export function initToolbar(courseId: string, statusFn: (msg: string, type?: 'ok' | 'error') => void) {
  document.querySelectorAll<HTMLButtonElement>('.snip-btn[data-snippet]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.snippet!;

      if (key === 'img') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          statusFn('Subiendo imagen...');
          const url = await uploadImageToS3(file, courseId);
          if (url) {
            insertAtCursor(`![](${url})\n`);
            statusFn('Imagen subida', 'ok');
          } else {
            statusFn('Error al subir imagen', 'error');
          }
        };
        input.click();
        return;
      }

      const snippet = SNIPPETS[key];
      if (snippet) insertAtCursor(snippet);
    });
  });

  const editorWrap = document.getElementById('editor-cm-wrap');
  if (!editorWrap) return;

  editorWrap.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  });

  editorWrap.addEventListener('drop', async e => {
    e.preventDefault();

    const file = Array.from(e.dataTransfer?.files || []).find(f => f.type.startsWith('image/'));
    if (file) {
      statusFn('Subiendo imagen...');
      const url = await uploadImageToS3(file, courseId);
      if (url) {
        insertAtCursor(`![](${url})\n`);
        statusFn('Imagen subida', 'ok');
      } else {
        statusFn('Error al subir imagen', 'error');
      }
      return;
    }

    const text = e.dataTransfer?.getData('text/plain')?.trim();
    if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
      const embed = detectVideoEmbed(text);
      if (embed) { insertAtCursor(embed); return; }
      insertAtCursor(`[${text}](${text})\n`);
    }
  });

  document.addEventListener('paste', async e => {
    const imageItem = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    e.preventDefault();
    statusFn('Subiendo imagen pegada...');
    const url = await uploadImageToS3(file, courseId);
    if (url) {
      insertAtCursor(`![](${url})\n`);
      statusFn('Imagen subida', 'ok');
    } else {
      statusFn('Error al subir imagen', 'error');
    }
  });
}
