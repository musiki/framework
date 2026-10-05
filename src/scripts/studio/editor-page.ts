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

  // Publish status (so tenant only): polls fast while a rebuild is in flight.
  const publishUrl = root.dataset.publishUrl;
  const publishEl = document.querySelector<HTMLElement>('#studio-publish');
  if (publishUrl && publishEl) {
    const pl = JSON.parse(root.dataset.publishLabels || '{}') as { publishing?: string; published?: string; failed?: string };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const render = (st: { state?: string; publishedAt?: string | null }) => {
      let text = '';
      if (st.state === 'pending' || st.state === 'building') text = pl.publishing || '';
      else if (st.state === 'failed') text = pl.failed || '';
      else if (st.state === 'published' && st.publishedAt) {
        const d = new Date(st.publishedAt);
        if (!Number.isNaN(d.getTime())) {
          const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
          text = (pl.published || '').replace('{time}', time);
        }
      }
      publishEl.textContent = text;
    };
    const poll = async () => {
      timer = undefined;
      if (document.hidden) return; // resumed by visibilitychange
      let delay = 30000;
      try {
        const res = await fetch(publishUrl, { credentials: 'same-origin', cache: 'no-store' });
        if (res.ok) {
          const st = await res.json();
          render(st);
          if (st.state === 'pending' || st.state === 'building') delay = 5000;
        }
      } catch { /* keep polling */ }
      if (!document.hidden) timer = setTimeout(poll, delay);
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (timer) clearTimeout(timer); timer = undefined; }
      else if (!timer) void poll();
    });
    void poll();
  }
}
