// Editor del itinerario en el pod Progreso (sólo docentes). Arma la lista de
// paradas de la cohorte: arrastrando notas desde el árbol de la izquierda o el
// reservorio, o buscándolas. Guarda solo, con control de versión: si otra
// pestaña guardó en el medio, recarga lo del servidor en vez de pisarlo.
import {
  BRANCHES,
  ITINERARY_KINDS,
  STRUCTURE_KINDS,
  isStructural,
  moveNoteTo as moveNote,
  moveStopTo,
  kindForNoteType,
  reservoirOf,
  slugKey,
  stopFromNote,
  newStopId,
} from '../../lib/itinerary/itinerary.mjs';
import { listNotes } from '../notes-editor/api';

type Stop = { id: string; title: string; kind: string; notes: string[]; branch?: string };
type Cohort = { id: string; label: string; isActive: boolean; stopCount: number };
type NoteRef = { slug: string; title: string; type: string };
type ItineraryResponse = {
  canEdit: boolean;
  cohort: Cohort | null;
  cohorts: Cohort[];
  itinerary: { stops: Stop[]; version: number } | null;
};

const NOTE_MIME = 'text/x-musiki-course-note';
const STOP_MIME = 'text/x-musiki-itinerary-stop';
const CHIP_MIME = 'text/x-musiki-itinerary-chip';
const SAVE_DELAY_MS = 600;

/** Lo que edita el docente, al momento: el Recorrido del pod lo dibuja al lado. */
export const ITINERARY_DRAFT_EVENT = 'musiki:itinerary-draft';

const kindOf = (id: string) =>
  ITINERARY_KINDS.find((k) => k.id === id) ?? STRUCTURE_KINDS.find((k) => k.id === id) ?? ITINERARY_KINDS[2];

/** Para cada parada, si está entre una bifurcación y su vuelta al tronco. */
function insideFork(stops: Stop[]): boolean[] {
  let open = false;
  return stops.map((stop) => {
    if (stop.kind === 'bifurcacion') { open = true; return false; }
    if (stop.kind === 'union') { open = false; return false; }
    return open;
  });
}

export function mountItineraryEditor(root: HTMLElement, courseId: string): () => void {
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);
  const list = q<HTMLOListElement>('[data-it-stops]')!;
  const status = q<HTMLElement>('[data-it-status]')!;
  const cohortSelect = q<HTMLSelectElement>('[data-it-cohort]')!;
  const search = q<HTMLInputElement>('[data-it-search]')!;
  const datalist = q<HTMLDataListElement>('[data-it-notes]')!;
  const addBtn = q<HTMLButtonElement>('[data-it-add]')!;
  const forkBtn = q<HTMLButtonElement>('[data-it-fork]')!;
  const dupBtn = q<HTMLButtonElement>('[data-it-duplicate]')!;
  const reservoir = q<HTMLElement>('[data-it-reservoir]')!;
  const reservoirCount = q<HTMLElement>('[data-it-reservoir-count]')!;
  const empty = q<HTMLElement>('[data-it-empty]')!;

  const ctrl = new AbortController();
  const { signal } = ctrl;
  let stops: Stop[] = [];
  let version = 0;
  let cohort: Cohort | null = null;
  let cohorts: Cohort[] = [];
  let notes: NoteRef[] = [];
  let selectedId = '';
  let saveTimer = 0;
  let saving = false;
  let dirtyWhileSaving = false;

  const setStatus = (text: string, tone: '' | 'error' = '') => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  const noteOf = (slug: string) => notes.find((n) => slugKey(n.slug, courseId) === slugKey(slug, courseId));
  const noteKindOf = (slug: string) => kindForNoteType(noteOf(slug)?.type) || 'concepto';

  const publishDraft = () => {
    window.dispatchEvent(new CustomEvent(ITINERARY_DRAFT_EVENT, {
      detail: { courseId, cohortId: cohort?.id || '', stops: stops.map((stop) => ({ ...stop, notes: [...stop.notes] })) },
    }));
  };

  const titleOf = (slug: string) =>
    notes.find((n) => slugKey(n.slug, courseId) === slugKey(slug, courseId))?.title
    || slug.split('/').pop()?.replace(/[-_]+/g, ' ')
    || slug;

  // ── Notas de la materia: las del repo más los conceptos globales de la sidebar.
  async function loadNotes() {
    const out = new Map<string, NoteRef>();
    try {
      const { notes: own } = await listNotes(courseId);
      for (const n of own) out.set(slugKey(n.slug, courseId), { slug: n.slug, title: n.title || n.slug, type: n.type });
    } catch { /* el docente sin repo local igual puede buscar conceptos */ }
    const raw = document.querySelector<HTMLElement>('[data-notes-sidebar]')?.dataset.globalConcepts;
    if (raw) {
      try {
        for (const entry of JSON.parse(raw) as Array<{ id: string; data?: { title?: string; type?: string } }>) {
          const key = slugKey(entry.id, courseId);
          if (!out.has(key)) {
            out.set(key, { slug: entry.id, title: entry.data?.title || entry.id.split('/').pop() || entry.id, type: entry.data?.type || 'concept' });
          }
        }
      } catch { /* atributo roto: sin conceptos globales */ }
    }
    // Lo que no va al itinerario (recursos de apoyo) igual se puede buscar; el
    // reservorio muestra sólo lo que tiene kind.
    notes = [...out.values()].sort((a, b) => a.title.localeCompare(b.title, 'es'));
    datalist.replaceChildren(...notes.map((n) => {
      const opt = document.createElement('option');
      opt.value = n.title;
      opt.label = n.slug;
      return opt;
    }));
  }

  async function load(cohortId = '') {
    setStatus('Cargando…');
    const params = new URLSearchParams({ courseId });
    if (cohortId) params.set('cohortId', cohortId);
    const res = await fetch(`/api/progress/itinerary?${params}`, { headers: { Accept: 'application/json' }, signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data.error || 'No se pudo cargar el itinerario.', 'error');
      return;
    }
    const body = data as ItineraryResponse;
    cohort = body.cohort;
    cohorts = body.cohorts || [];
    stops = body.itinerary?.stops ?? [];
    version = body.itinerary?.version ?? 0;
    cohortSelect.replaceChildren(...cohorts.map((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.isActive ? `${c.label} · activa` : c.label;
      opt.selected = c.id === cohort?.id;
      return opt;
    }));
    cohortSelect.disabled = cohorts.length < 2;
    setStatus(cohort ? '' : 'La materia no tiene cohortes.', cohort ? '' : 'error');
    render();
  }

  // ── Guardado
  function scheduleSave() {
    publishDraft();
    window.clearTimeout(saveTimer);
    setStatus('Sin guardar…');
    saveTimer = window.setTimeout(() => void save(), SAVE_DELAY_MS);
  }

  async function save() {
    if (!cohort) return;
    if (saving) { dirtyWhileSaving = true; return; }
    saving = true;
    setStatus('Guardando…');
    try {
      const res = await fetch('/api/progress/itinerary', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, cohortId: cohort.id, version, stops }),
        signal,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        version = data.itinerary.version;
        setStatus('Guardado');
      } else if (res.status === 409) {
        stops = data.itinerary?.stops ?? [];
        version = data.itinerary?.version ?? 0;
        dirtyWhileSaving = false;
        render();
        setStatus('Otra pestaña guardó cambios: se muestra lo último guardado.', 'error');
      } else {
        setStatus(data.error || 'No se pudo guardar.', 'error');
      }
    } catch (error) {
      if (!signal.aborted) setStatus('Error de red: no se guardó.', 'error');
    } finally {
      saving = false;
      if (dirtyWhileSaving) { dirtyWhileSaving = false; void save(); }
    }
  }

  function commit() {
    render();
    scheduleSave();
  }

  // ── Edición
  function addNote(note: NoteRef) {
    const target = stops.find((s) => s.id === selectedId);
    if (target) {
      if (!target.notes.some((s) => slugKey(s, courseId) === slugKey(note.slug, courseId))) target.notes.push(note.slug);
    } else {
      const stop = stopFromNote(note) as Stop;
      stops.push(stop);
      selectedId = stop.id;
    }
    commit();
  }

  function moveNoteTo(slug: string, fromStopId: string, toStopId: string, beforeSlug = '') {
    stops = moveNote(stops, slug, fromStopId, toStopId, beforeSlug, courseId) as Stop[];
    commit();
  }

  function moveStop(stopId: string, targetId: string, after = false) {
    stops = moveStopTo(stops, stopId, targetId, after) as Stop[];
    commit();
  }

  const dropAfter = (e: DragEvent, el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    return e.clientY > box.top + box.height / 2;
  };
  const clearDropMarks = () => list.querySelectorAll('.is-drop-before, .is-drop-after, .is-drop').forEach((n) => n.classList.remove('is-drop-before', 'is-drop-after', 'is-drop'));

  const noteFromSlug = (slug: string): NoteRef =>
    notes.find((n) => slugKey(n.slug, courseId) === slugKey(slug, courseId))
    ?? { slug, title: titleOf(slug), type: '' };

  // ── Render
  function renderStop(stop: Stop, index: number, inFork: boolean): HTMLLIElement {
    const structural = isStructural(stop);
    const li = document.createElement('li');
    li.className = 'cpp-it-stop';
    li.classList.toggle('is-structural', structural);
    li.classList.toggle('is-branch', inFork);
    li.dataset.stopId = stop.id;
    li.dataset.kind = stop.kind;
    li.classList.toggle('is-selected', stop.id === selectedId);
    // Toda la parada se arrastra, salvo cuando se escribe o se aprieta un botón.
    li.addEventListener('pointerdown', (e) => {
      li.draggable = !(e.target as HTMLElement).closest('input, button, .cpp-it-chip');
    });
    li.addEventListener('dragstart', (e) => {
      if (e.target !== li) return;
      e.dataTransfer?.setData(STOP_MIME, stop.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      li.classList.add('is-dragging');
    });
    li.addEventListener('dragend', () => { li.classList.remove('is-dragging'); clearDropMarks(); });

    const head = document.createElement('div');
    head.className = 'cpp-it-stop-head';

    // El número de la parada, en un círculo lleno del color de su kind, es la
    // manija para arrastrarla.
    const num = document.createElement('span');
    num.className = 'cpp-it-num';
    num.textContent = String(index + 1);
    num.title = 'Arrastrar para reordenar';
    num.draggable = true;
    num.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      e.dataTransfer?.setData(STOP_MIME, stop.id);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setDragImage(li, 12, 12);
      }
      li.classList.add('is-dragging');
    });
    num.addEventListener('dragend', () => { li.classList.remove('is-dragging'); clearDropMarks(); });

    const kind = kindOf(stop.kind);
    const kindBtn = document.createElement('button');
    kindBtn.type = 'button';
    kindBtn.className = 'cpp-it-kind';
    kindBtn.textContent = kind.icon;
    kindBtn.title = structural ? kind.label : `${kind.label} · click para cambiar`;
    kindBtn.disabled = structural;
    kindBtn.addEventListener('click', () => {
      const i = ITINERARY_KINDS.findIndex((k) => k.id === stop.kind);
      stop.kind = ITINERARY_KINDS[(i + 1) % ITINERARY_KINDS.length].id;
      commit();
    });

    const title = document.createElement('input');
    title.className = 'cpp-it-title';
    title.value = stop.title;
    title.maxLength = 120;
    title.setAttribute('aria-label', `Nombre de la parada ${index + 1}`);
    title.addEventListener('change', () => {
      const next = title.value.replace(/\s+/g, ' ').trim();
      if (!next) { title.value = stop.title; return; }
      stop.title = next;
      scheduleSave();
    });
    title.addEventListener('focus', () => { selectedId = stop.id; markSelected(); });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'cpp-it-remove';
    remove.textContent = '×';
    remove.title = 'Quitar la parada (sus notas vuelven al reservorio)';
    remove.addEventListener('click', () => {
      // Una bifurcación se va con su vuelta al tronco (y al revés); sus ramas quedan en el tronco.
      const drop = new Set([stop.id]);
      if (stop.kind === 'bifurcacion') {
        const pair = stops.slice(index + 1).find((s) => s.kind === 'union');
        if (pair) drop.add(pair.id);
      } else if (stop.kind === 'union') {
        const pair = stops.slice(0, index).reverse().find((s) => s.kind === 'bifurcacion');
        if (pair) drop.add(pair.id);
      }
      stops = stops.filter((s) => !drop.has(s.id));
      if (selectedId === stop.id) selectedId = '';
      commit();
    });

    // En una rama: la letra, que cambia con click (A → B → … hasta una más de las usadas).
    const branchBtn = document.createElement('button');
    branchBtn.type = 'button';
    branchBtn.className = 'cpp-it-branch';
    branchBtn.textContent = stop.branch || 'A';
    branchBtn.title = `Rama ${stop.branch || 'A'} · click para cambiar`;
    branchBtn.addEventListener('click', () => {
      const used = stops.filter((s, i) => insideFork(stops)[i]).map((s) => BRANCHES.indexOf(s.branch || 'A'));
      const limit = Math.min(BRANCHES.length, Math.max(...used, 0) + 2);
      stop.branch = BRANCHES[(BRANCHES.indexOf(stop.branch || 'A') + 1) % limit];
      commit();
    });

    head.append(num, kindBtn, ...(inFork ? [branchBtn] : []), title, remove);
    if (structural) {
      li.append(head);
      li.addEventListener('dragover', (e) => {
        if (!e.dataTransfer?.types.includes(STOP_MIME)) return;
        e.preventDefault();
        clearDropMarks();
        li.classList.add(dropAfter(e, li) ? 'is-drop-after' : 'is-drop-before');
      });
      li.addEventListener('dragleave', () => li.classList.remove('is-drop-before', 'is-drop-after'));
      li.addEventListener('drop', (e) => {
        const stopId = e.dataTransfer?.getData(STOP_MIME);
        clearDropMarks();
        if (!stopId) return;
        e.preventDefault();
        e.stopPropagation();
        moveStop(stopId, stop.id, dropAfter(e, li));
      });
      return li;
    }

    const chips = document.createElement('ul');
    chips.className = 'cpp-it-notes';
    for (const slug of stop.notes) {
      const chip = document.createElement('li');
      chip.className = 'cpp-it-chip';
      const noteKind = noteKindOf(slug);
      chip.dataset.kind = noteKind;
      chip.draggable = true;
      chip.title = slug;
      chip.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData(CHIP_MIME, JSON.stringify({ slug, from: stop.id }));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      const glyph = document.createElement('i');
      glyph.className = 'cpp-it-chip-kind';
      glyph.textContent = kindOf(noteKind).icon;
      glyph.title = kindOf(noteKind).label;
      const label = document.createElement('span');
      label.textContent = titleOf(slug);
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.title = 'Sacar la nota de esta parada';
      x.addEventListener('click', () => {
        stop.notes = stop.notes.filter((s) => s !== slug);
        commit();
      });
      chip.addEventListener('dragstart', (e) => e.stopPropagation());
      chip.addEventListener('dragover', (e) => {
        const types = e.dataTransfer?.types ?? [];
        if (!types.includes(CHIP_MIME) && !types.includes(NOTE_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        clearDropMarks();
        chip.classList.add('is-drop-before');
      });
      chip.addEventListener('dragleave', () => chip.classList.remove('is-drop-before'));
      chip.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        clearDropMarks();
        if (!dt) return;
        const moved = dt.getData(CHIP_MIME);
        const fromTree = dt.getData(NOTE_MIME).trim();
        if (!moved && !fromTree) return;
        e.preventDefault();
        e.stopPropagation();
        if (moved) {
          try { const { slug: other, from } = JSON.parse(moved); moveNoteTo(other, from, stop.id, slug); } catch { /* payload ajeno */ }
        } else {
          moveNoteTo(fromTree, '', stop.id, slug);
        }
      });
      chip.append(glyph, label, x);
      chips.appendChild(chip);
    }
    if (!stop.notes.length) {
      const hint = document.createElement('li');
      hint.className = 'cpp-it-drop-hint';
      hint.textContent = 'Arrastrá notas acá';
      chips.appendChild(hint);
    }

    li.append(head, chips);
    li.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button, input')) return;
      selectedId = selectedId === stop.id ? '' : stop.id;
      markSelected();
    });

    // Destino de arrastre: notas del árbol o del reservorio, chips de otra parada,
    // u otra parada que se reordena (cae antes de ésta).
    li.addEventListener('dragover', (e) => {
      const types = e.dataTransfer?.types ?? [];
      if (!types.includes(NOTE_MIME) && !types.includes(CHIP_MIME) && !types.includes(STOP_MIME)) return;
      e.preventDefault();
      clearDropMarks();
      // Una parada cae antes o después según la mitad; una nota cae adentro.
      if (types.includes(STOP_MIME)) li.classList.add(dropAfter(e, li) ? 'is-drop-after' : 'is-drop-before');
      else li.classList.add('is-drop');
    });
    li.addEventListener('dragleave', (e) => {
      if (!li.contains(e.relatedTarget as Node)) li.classList.remove('is-drop', 'is-drop-before', 'is-drop-after');
    });
    li.addEventListener('drop', (e) => {
      clearDropMarks();
      const dt = e.dataTransfer;
      if (!dt) return;
      e.preventDefault();
      e.stopPropagation();
      const stopId = dt.getData(STOP_MIME);
      if (stopId) { moveStop(stopId, stop.id, dropAfter(e, li)); return; }
      const chip = dt.getData(CHIP_MIME);
      if (chip) {
        try { const { slug, from } = JSON.parse(chip); moveNoteTo(slug, from, stop.id); } catch { /* payload ajeno */ }
        return;
      }
      const slug = dt.getData(NOTE_MIME).trim();
      if (slug) moveNoteTo(slug, '', stop.id);
    });
    return li;
  }

  function markSelected() {
    list.querySelectorAll<HTMLElement>('.cpp-it-stop').forEach((li) => {
      li.classList.toggle('is-selected', li.dataset.stopId === selectedId);
    });
    search.placeholder = selectedId ? 'Buscar nota para la parada elegida…' : 'Buscar nota: crea una parada';
  }

  function renderReservoir() {
    const left = reservoirOf(notes, stops, courseId).filter((n: NoteRef) => kindForNoteType(n.type));
    reservoirCount.textContent = String(left.length);
    const ul = reservoir.querySelector('ul')!;
    ul.replaceChildren(...left.map((note: NoteRef) => {
      const li = document.createElement('li');
      li.className = 'cpp-it-res-item';
      li.draggable = true;
      li.title = `${note.slug} · arrastrá a una parada o hacé click para agregar`;
      li.addEventListener('dragstart', (e) => e.dataTransfer?.setData(NOTE_MIME, note.slug));
      li.addEventListener('click', () => addNote(note));
      const icon = document.createElement('span');
      icon.className = 'cpp-it-res-kind';
      icon.dataset.kind = kindForNoteType(note.type) || 'concepto';
      icon.textContent = kindOf(kindForNoteType(note.type)).icon;
      const label = document.createElement('span');
      label.textContent = note.title;
      li.append(icon, label);
      return li;
    }));
  }

  function render() {
    const forked = insideFork(stops);
    list.replaceChildren(...stops.map((stop, index) => renderStop(stop, index, forked[index])));
    empty.hidden = stops.length > 0;
    const source = cohorts.find((c) => c.id !== cohort?.id && c.stopCount > 0);
    dupBtn.hidden = !(cohort && stops.length === 0 && source);
    if (source) {
      dupBtn.textContent = `Duplicar el itinerario de «${source.label}» (${source.stopCount} paradas)`;
      dupBtn.dataset.from = source.id;
    }
    markSelected();
    renderReservoir();
    publishDraft();
  }

  // ── Controles
  forkBtn.addEventListener('click', () => {
    const branchA: Stop = { id: newStopId(), title: 'Rama A', kind: 'concepto', notes: [], branch: 'A' };
    stops.push(
      { id: newStopId(), title: 'Elegí tu camino', kind: 'bifurcacion', notes: [] },
      branchA,
      { id: newStopId(), title: 'Rama B', kind: 'concepto', notes: [], branch: 'B' },
      { id: newStopId(), title: 'Vuelta al tronco', kind: 'union', notes: [] },
    );
    selectedId = branchA.id;
    commit();
  }, { signal });

  addBtn.addEventListener('click', () => {
    const stop: Stop = { id: newStopId(), title: 'Nueva parada', kind: 'clase', notes: [] };
    stops.push(stop);
    selectedId = stop.id;
    commit();
    list.querySelector<HTMLInputElement>(`[data-stop-id="${stop.id}"] .cpp-it-title`)?.select();
  }, { signal });

  search.addEventListener('change', () => {
    const value = search.value.trim().toLowerCase();
    if (!value) return;
    const note = notes.find((n) => n.title.toLowerCase() === value || n.slug.toLowerCase() === value);
    if (!note) { setStatus('No hay una nota con ese nombre.', 'error'); return; }
    search.value = '';
    addNote(note);
  }, { signal });

  cohortSelect.addEventListener('change', () => {
    window.clearTimeout(saveTimer);
    selectedId = '';
    void load(cohortSelect.value);
  }, { signal });

  dupBtn.addEventListener('click', async () => {
    if (!cohort || !dupBtn.dataset.from) return;
    setStatus('Duplicando…');
    const res = await fetch('/api/progress/itinerary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId, fromCohortId: dupBtn.dataset.from, toCohortId: cohort.id }),
      signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setStatus(data.error || 'No se pudo duplicar.', 'error'); return; }
    await load(cohort.id);
    setStatus('Duplicado');
  }, { signal });

  // Soltar una nota en el espacio libre de la lista crea una parada nueva.
  list.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes(NOTE_MIME) || e.dataTransfer?.types.includes(STOP_MIME)) e.preventDefault();
  }, { signal });
  list.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (!dt) return;
    e.preventDefault();
    const stopId = dt.getData(STOP_MIME);
    if (stopId) { moveStop(stopId, ''); return; }
    const slug = dt.getData(NOTE_MIME).trim();
    if (!slug) return;
    selectedId = '';
    addNote(noteFromSlug(slug));
  }, { signal });

  root.hidden = false;
  void loadNotes().then(() => load()).catch(() => setStatus('No se pudo cargar el itinerario.', 'error'));

  return () => {
    // Un cambio en espera no se pierde al navegar: sale con keepalive.
    if (saveTimer && status.textContent === 'Sin guardar…' && cohort) {
      void fetch('/api/progress/itinerary', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, cohortId: cohort.id, version, stops }),
        keepalive: true,
      }).catch(() => {});
    }
    window.clearTimeout(saveTimer);
    ctrl.abort();
  };
}
