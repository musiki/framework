import { normalizeText } from '../core/normalize';

const ROOM_NOTES_DRAFT_STORAGE_KEY = 'musiki:room:notes:draft:v1';
const ROOM_NOTES_CACHE_STORAGE_KEY = 'musiki:room:notes:cache:v1';

type RoomNoteRecord = {
  body?: string | null;
  courseId?: string | null;
  createdAt?: string | null;
  id: string;
  noteDate: string;
  renderedHtml?: string | null;
  roomName?: string | null;
  title: string;
  updatedAt?: string | null;
};

type RoomNoteDraft = {
  body: string;
  id: string | null;
  title: string;
  updatedAt: string;
};

type CreateRoomNotesControllerOptions = {
  getCourseId: () => string | null;
  getRoomName: () => string | null;
  notesBodyInput?: HTMLTextAreaElement | null;
  notesDownloadBtn?: HTMLButtonElement | null;
  notesForm?: HTMLFormElement | null;
  notesListEl?: HTMLElement | null;
  notesNewBtn?: HTMLButtonElement | null;
  notesPreviewBtn?: HTMLButtonElement | null;
  notesPreviewEl?: HTMLElement | null;
  notesSaveBtn?: HTMLButtonElement | null;
  notesSection?: Element | null;
  notesTitleInput?: HTMLInputElement | null;
  reportStatus: (message: string) => void;
};

export type RoomNotesController = {
  bind: () => void;
  syncScope: () => void;
};

type NotesWindow = Window & {
  __notesMermaidPromise?: Promise<any>;
  __notesMarkedPromise?: Promise<any>;
  marked?: { parse?: (markdown: string) => string };
  mermaid?: { initialize?: (options: Record<string, unknown>) => void; run?: (options: { nodes: HTMLElement[] }) => void };
};

const buildNotesScopeKey = (courseId: string | null, roomName: string | null) =>
  `${courseId || '_'}::${roomName || '_'}`;

const createMarkedLoader = async () => {
  const notesWindow = window as NotesWindow;
  if (notesWindow.marked?.parse) return notesWindow.marked;
  if (notesWindow.__notesMarkedPromise) return notesWindow.__notesMarkedPromise;

  notesWindow.__notesMarkedPromise = new Promise((resolve) => {
    if (document.querySelector('script[src*="marked"]')) {
      resolve(notesWindow.marked ?? null);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/marked@9/marked.min.js';
    script.onload = () => resolve(notesWindow.marked ?? null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });

  return notesWindow.__notesMarkedPromise;
};

const runMermaidIn = (container: HTMLElement) => {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>('.mermaid'));
  if (nodes.length === 0) return;
  const notesWindow = window as NotesWindow;
  const load = () => {
    if (notesWindow.mermaid?.run) return Promise.resolve(notesWindow.mermaid);
    if (notesWindow.__notesMermaidPromise) return notesWindow.__notesMermaidPromise;
    notesWindow.__notesMermaidPromise = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
      script.onload = () => resolve(notesWindow.mermaid ?? null);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
    return notesWindow.__notesMermaidPromise;
  };

  void load().then((mermaid) => {
    if (!mermaid?.run) return;
    try {
      mermaid.initialize?.({ startOnLoad: false, theme: 'dark' });
      mermaid.run({ nodes });
    } catch {
      // ignore rendering failures
    }
  });
};

export const createRoomNotesController = ({
  getCourseId,
  getRoomName,
  notesBodyInput,
  notesDownloadBtn,
  notesForm,
  notesListEl,
  notesNewBtn,
  notesPreviewBtn,
  notesPreviewEl,
  notesSaveBtn,
  notesSection,
  notesTitleInput,
  reportStatus,
}: CreateRoomNotesControllerOptions): RoomNotesController => {
  let notesCurrentId: string | null = null;
  let notesEditMode = true;
  let notesScopeKey = buildNotesScopeKey(getCourseId(), getRoomName());

  const getCurrentNotesScopeKey = () => buildNotesScopeKey(getCourseId(), getRoomName());
  const getNotesDraftStorageKey = (scopeKey = getCurrentNotesScopeKey()) =>
    `${ROOM_NOTES_DRAFT_STORAGE_KEY}:${scopeKey}`;
  const getNotesCacheStorageKey = (scopeKey = getCurrentNotesScopeKey()) =>
    `${ROOM_NOTES_CACHE_STORAGE_KEY}:${scopeKey}`;

  const readNotesDraft = (scopeKey = notesScopeKey): RoomNoteDraft | null => {
    try {
      const raw = window.localStorage.getItem(getNotesDraftStorageKey(scopeKey));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object'
        ? {
            body: typeof parsed.body === 'string' ? parsed.body : '',
            id: normalizeText(parsed.id) || null,
            title: typeof parsed.title === 'string' ? parsed.title : '',
            updatedAt: normalizeText(parsed.updatedAt) || new Date().toISOString(),
          }
        : null;
    } catch {
      return null;
    }
  };

  const writeNotesDraft = (scopeKey = notesScopeKey) => {
    try {
      const title = notesTitleInput?.value ?? '';
      const body = notesBodyInput?.value ?? '';
      if (!title.trim() && !body.trim()) {
        window.localStorage.removeItem(getNotesDraftStorageKey(scopeKey));
        return;
      }
      const draft: RoomNoteDraft = {
        body,
        id: notesCurrentId,
        title,
        updatedAt: new Date().toISOString(),
      };
      window.localStorage.setItem(getNotesDraftStorageKey(scopeKey), JSON.stringify(draft));
    } catch {
      // ignore storage failures
    }
  };

  const clearNotesDraft = (scopeKey = notesScopeKey) => {
    try {
      window.localStorage.removeItem(getNotesDraftStorageKey(scopeKey));
    } catch {
      // ignore storage failures
    }
  };

  const readNotesCache = (scopeKey = notesScopeKey): RoomNoteRecord[] => {
    try {
      const raw = window.localStorage.getItem(getNotesCacheStorageKey(scopeKey));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => ({
              body: typeof entry.body === 'string' ? entry.body : '',
              courseId: normalizeText(entry.courseId) || null,
              createdAt: normalizeText(entry.createdAt) || null,
              id: normalizeText(entry.id),
              noteDate: normalizeText(entry.noteDate) || new Date().toISOString().slice(0, 10),
              renderedHtml: typeof entry.renderedHtml === 'string' ? entry.renderedHtml : null,
              roomName: normalizeText(entry.roomName) || null,
              title: typeof entry.title === 'string' ? entry.title : '',
              updatedAt: normalizeText(entry.updatedAt) || null,
            }))
            .filter((entry) => entry.id)
        : [];
    } catch {
      return [];
    }
  };

  const writeNotesCache = (notes: RoomNoteRecord[], scopeKey = notesScopeKey) => {
    try {
      window.localStorage.setItem(getNotesCacheStorageKey(scopeKey), JSON.stringify(notes));
    } catch {
      // ignore storage failures
    }
  };

  const sortNotes = (notes: RoomNoteRecord[]) =>
    [...notes].sort((left, right) =>
      normalizeText(right.updatedAt || right.noteDate).localeCompare(
        normalizeText(left.updatedAt || left.noteDate),
      ),
    );

  const upsertNotesCache = (note: RoomNoteRecord, scopeKey = notesScopeKey) => {
    const cached = readNotesCache(scopeKey).filter((entry) => entry.id !== note.id);
    cached.push(note);
    writeNotesCache(sortNotes(cached), scopeKey);
  };

  const syncActiveNoteItem = () => {
    notesListEl?.querySelectorAll<HTMLElement>('[data-note-id]').forEach((element) => {
      element.classList.toggle(
        'conference-notes-item--active',
        element.dataset.noteId === (notesCurrentId ?? ''),
      );
    });
  };

  const setNotesMode = (edit: boolean) => {
    notesEditMode = edit;
    if (!notesPreviewBtn || !notesPreviewEl || !notesTitleInput || !notesBodyInput) return;
    notesTitleInput.hidden = !edit;
    notesBodyInput.hidden = !edit;
    notesPreviewEl.hidden = edit;
    if (edit) {
      notesPreviewBtn.textContent = 'V';
      notesPreviewBtn.title = 'Vista previa';
      return;
    }
    notesPreviewBtn.textContent = 'E';
    notesPreviewBtn.title = 'Editar';
  };

  const renderNoteItem = (note: { id: string; title: string; noteDate: string }): HTMLElement => {
    const element = document.createElement('div');
    element.className = 'conference-notes-item';
    element.dataset.noteId = note.id;

    const title = document.createElement('span');
    title.className = 'conference-notes-item-title';
    title.textContent = note.title || '(sin título)';

    const date = document.createElement('span');
    date.className = 'conference-notes-item-date';
    date.textContent = note.noteDate;

    element.append(title, date);
    element.addEventListener('click', () => {
      void loadNote(note.id);
    });
    return element;
  };

  const renderNotesList = (notes: RoomNoteRecord[]) => {
    if (!notesListEl) return;
    notesListEl.innerHTML = '';
    for (const note of sortNotes(notes)) {
      notesListEl.appendChild(renderNoteItem(note));
    }
  };

  const resetNoteForm = () => {
    notesCurrentId = null;
    if (notesTitleInput) notesTitleInput.value = '';
    if (notesBodyInput) notesBodyInput.value = '';
    if (notesPreviewEl) notesPreviewEl.innerHTML = '';
    clearNotesDraft();
    setNotesMode(true);
    syncActiveNoteItem();
    notesTitleInput?.focus();
  };

  const hydrateNotesDraft = () => {
    const draft = readNotesDraft();
    if (!draft) return;
    notesCurrentId = draft.id;
    if (notesTitleInput) notesTitleInput.value = draft.title;
    if (notesBodyInput) notesBodyInput.value = draft.body;
    if (notesPreviewEl) notesPreviewEl.innerHTML = '';
    setNotesMode(true);
    syncActiveNoteItem();
  };

  const loadNotesList = async () => {
    if (!notesListEl) return;
    const cachedNotes = readNotesCache();
    if (cachedNotes.length > 0) {
      renderNotesList(cachedNotes);
    }
    const params = new URLSearchParams();
    const noteCourseId = getCourseId();
    const noteRoomName = getRoomName();
    if (noteCourseId) params.set('courseId', noteCourseId);
    if (noteRoomName) params.set('roomName', noteRoomName);
    const response = await fetch(`/api/live/notes?${params}`).catch(() => null);
    if (!response?.ok) return;
    const data = await response.json().catch(() => null);
    if (!data?.notes) return;
    const scopedNotes = (data.notes as RoomNoteRecord[]).map((note) => ({
      ...note,
      courseId: noteCourseId,
      roomName: noteRoomName,
    }));
    writeNotesCache(scopedNotes);
    renderNotesList(scopedNotes);
  };

  const loadNote = async (id: string) => {
    const cached = readNotesCache().find((note) => note.id === id);
    if (cached) {
      notesCurrentId = cached.id;
      if (notesTitleInput) notesTitleInput.value = cached.title ?? '';
      if (notesBodyInput) notesBodyInput.value = cached.body ?? '';
      if (notesPreviewEl) {
        notesPreviewEl.innerHTML = cached.renderedHtml ?? '';
        if (cached.renderedHtml) runMermaidIn(notesPreviewEl);
      }
      setNotesMode(true);
      syncActiveNoteItem();
    }

    const params = new URLSearchParams();
    params.set('id', id);
    const noteCourseId = getCourseId();
    if (noteCourseId) params.set('courseId', noteCourseId);
    const response = await fetch(`/api/live/notes?${params}&limit=1`).catch(() => null);
    if (!response?.ok) return;
    const data = await response.json().catch(() => null);
    const note = (data?.notes ?? []).find((entry: any) => entry.id === id);
    if (!note) return;

    notesCurrentId = note.id;
    if (notesTitleInput) notesTitleInput.value = note.title ?? '';
    if (notesBodyInput) notesBodyInput.value = note.body ?? '';
    if (notesPreviewEl && note.renderedHtml) {
      notesPreviewEl.innerHTML = note.renderedHtml;
      runMermaidIn(notesPreviewEl);
    }
    upsertNotesCache({
      ...note,
      courseId: getCourseId(),
      roomName: getRoomName(),
    });
    setNotesMode(true);
    syncActiveNoteItem();
    writeNotesDraft();
  };

  const renderClientPreview = async (body: string) => {
    const notesWindow = window as NotesWindow;
    if (!notesWindow.marked?.parse) {
      await createMarkedLoader();
    }
    return notesWindow.marked?.parse ? String(notesWindow.marked.parse(body)) : `<pre>${body}</pre>`;
  };

  const submitNotesForm = () => {
    if (typeof notesForm?.requestSubmit === 'function') {
      notesForm.requestSubmit(notesSaveBtn ?? undefined);
      return;
    }
    if (notesSaveBtn) {
      notesSaveBtn.click();
      return;
    }
    notesForm?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  };

  const persistNotesDraft = () => {
    writeNotesDraft();
  };

  const downloadCurrentNote = () => {
    const title = notesTitleInput?.value.trim() || 'nota';
    const body = notesBodyInput?.value ?? '';
    if (!body.trim()) return;
    const content = title ? `# ${title}\n\n${body}` : body;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `nota-${date}-${title.replace(/[^a-z0-9]/gi, '_').slice(0, 40) || 'sin_titulo'}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const syncScope = () => {
    const nextScopeKey = getCurrentNotesScopeKey();
    if (nextScopeKey === notesScopeKey) return;
    writeNotesDraft(notesScopeKey);
    notesScopeKey = nextScopeKey;
    notesCurrentId = null;
    if (notesTitleInput) notesTitleInput.value = '';
    if (notesBodyInput) notesBodyInput.value = '';
    if (notesPreviewEl) notesPreviewEl.innerHTML = '';
    setNotesMode(true);
    syncActiveNoteItem();
    renderNotesList(readNotesCache());
    hydrateNotesDraft();
    void loadNotesList();
  };

  const saveCurrentNote = async () => {
    const title = notesTitleInput?.value.trim() ?? '';
    const body = notesBodyInput?.value ?? '';
    if (!body.trim()) return;

    const currentNotesScopeKey = getCurrentNotesScopeKey();
    if (currentNotesScopeKey !== notesScopeKey) {
      notesScopeKey = currentNotesScopeKey;
    }
    const noteCourseId = getCourseId();
    const noteRoomName = getRoomName();
    const payload: Record<string, string | null> = {
      title,
      body,
      courseId: noteCourseId,
      roomName: noteRoomName,
      noteDate: new Date().toISOString().slice(0, 10),
    };
    if (notesCurrentId) payload.id = notesCurrentId;

    const response = await fetch('/api/live/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);
    if (!response?.ok) {
      reportStatus('Error al guardar nota');
      return;
    }

    const data = await response.json().catch(() => null);
    notesCurrentId = data?.note?.id ?? notesCurrentId;
    upsertNotesCache({
      body,
      courseId: noteCourseId,
      createdAt: normalizeText(data?.note?.createdAt) || null,
      id: notesCurrentId || crypto.randomUUID(),
      noteDate: payload.noteDate || new Date().toISOString().slice(0, 10),
      renderedHtml: notesPreviewEl?.innerHTML || null,
      roomName: noteRoomName,
      title,
      updatedAt: normalizeText(data?.note?.updatedAt) || new Date().toISOString(),
    });
    clearNotesDraft();

    if (notesPreviewEl) {
      const preview = await renderClientPreview(notesBodyInput?.value ?? '');
      notesPreviewEl.innerHTML = preview;
      runMermaidIn(notesPreviewEl);
      setNotesMode(false);

      const savedNoteId = notesCurrentId;
      window.setTimeout(async () => {
        if (notesCurrentId !== savedNoteId) return;
        const pollResponse = await fetch(`/api/live/notes?limit=1&id=${savedNoteId}`).catch(() => null);
        if (!pollResponse?.ok) return;
        const pollData = await pollResponse.json().catch(() => null);
        const updated = (pollData?.notes ?? []).find((entry: any) => entry.id === savedNoteId);
        if (updated?.renderedHtml && notesPreviewEl && notesCurrentId === savedNoteId) {
          notesPreviewEl.innerHTML = updated.renderedHtml;
          runMermaidIn(notesPreviewEl);
          upsertNotesCache({
            ...updated,
            courseId: getCourseId(),
            roomName: getRoomName(),
          });
        }
      }, 3000);
    }

    void loadNotesList();
  };

  const bind = () => {
    if (notesPreviewBtn && notesPreviewEl && notesBodyInput) {
      notesPreviewBtn.addEventListener('click', () => {
        if (notesEditMode && !notesPreviewEl.innerHTML.trim()) {
          const body = notesBodyInput.value;
          if (body.trim()) {
            void renderClientPreview(body).then((preview) => {
              notesPreviewEl.innerHTML = preview;
              runMermaidIn(notesPreviewEl);
            });
          }
        }
        setNotesMode(!notesEditMode);
      });
    }

    notesNewBtn?.addEventListener('click', resetNoteForm);
    notesDownloadBtn?.addEventListener('click', downloadCurrentNote);

    [notesTitleInput, notesBodyInput].forEach((input) => {
      input?.addEventListener('input', persistNotesDraft);
      input?.addEventListener('change', persistNotesDraft);
      input?.addEventListener('keydown', (event) => {
        const keyboardEvent = event as KeyboardEvent;
        if ((keyboardEvent.metaKey || keyboardEvent.ctrlKey) && keyboardEvent.key === 'Enter') {
          keyboardEvent.preventDefault();
          submitNotesForm();
        }
      });
    });

    notesForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      void saveCurrentNote();
    });

    hydrateNotesDraft();
    renderNotesList(readNotesCache());

    if (notesSection && typeof IntersectionObserver === 'function') {
      const notesObserver = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadNotesList();
          notesObserver.disconnect();
        }
      }, { threshold: 0.1 });
      notesObserver.observe(notesSection);
      return;
    }

    void loadNotesList();
  };

  return {
    bind,
    syncScope,
  };
};
