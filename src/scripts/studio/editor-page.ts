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
          const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
          text = (pl.published || '').replace('{time}', time);
        }
      }
      publishEl.textContent = text;
    };
    let inFlight = false;
    let stopped = false;
    const schedule = (delay: number) => {
      if (timer) clearTimeout(timer);
      timer = stopped || document.hidden ? undefined : setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (inFlight || stopped || document.hidden) return;
      inFlight = true;
      let delay = 30000;
      try {
        const res = await fetch(publishUrl, { credentials: 'same-origin', cache: 'no-store' });
        if (res.status === 401 || res.status === 404) {
          stopped = true; // expired session or non-so tenant: stop, show nothing
          publishEl.textContent = '';
        } else if (res.ok) {
          const st = await res.json();
          render(st);
          if (st.state === 'pending' || st.state === 'building') delay = 5000;
        }
      } catch { /* keep polling */ }
      inFlight = false;
      schedule(delay);
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (timer) clearTimeout(timer); timer = undefined; }
      else void poll();
    });
    // After the editor's own save completes (status dot turns "saved"), poll
    // soon so "Publishing…" shows up right away.
    let wasSaved = status.classList.contains('saved');
    new MutationObserver(() => {
      const saved = status.classList.contains('saved');
      if (saved && !wasSaved) schedule(2000);
      wasSaved = saved;
    }).observe(status, { attributes: true, attributeFilter: ['class'] });
    void poll();
  }
}
