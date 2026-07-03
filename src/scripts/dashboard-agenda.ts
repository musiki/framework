import {
  buildAgendaShareUrlPath,
  buildAgendaEventColor,
  countAgendaMeetingDays,
  isMutedAgendaEvent,
  minutesToTimeString,
  normalizeAgendaComment,
  normalizeAgendaDateKey,
  normalizeAgendaHexColor,
  normalizeAgendaTimeString,
  normalizeAgendaYear,
  normalizeText,
  timeStringToMinutes,
} from '../lib/dashboard/agenda';

type AgendaDateColumn = { dateKey: string; label?: string; isoWeekday?: number; };
type AgendaConfig = { courseId: string; year: string; startTime: string; endTime: string; teacherSlotMinutes: number; studentSlotMinutes: number; maxStudentMinutes: number; minMeetings: number; comment: string; updatedAt: string; };
type AgendaBlock = { id: string; dateKey: string; startMinute: number; endMinute: number; comment: string; updatedAt: string; };
type AgendaStudent = { studentId: string; name: string; email: string; color: string; totalMinutes: number; blocks: AgendaBlock[]; grupo?: string; };
type AgendaEvent = { id: string; dateKey: string; startMinute: number; endMinute: number; text: string; color: string; virtual?: boolean; updatedAt?: string; };
type AgendaData = { courseId: string; courseTitle: string; year: string; dates: AgendaDateColumn[]; config: AgendaConfig; students: AgendaStudent[]; events: AgendaEvent[]; viewer: { userId: string; isTeacher: boolean; grupo?: string; }; shareUrlPath?: string; };
type AgendaSlot = { startMinute: number; endMinute: number; label: string; rowIndex: number; };
type SelectionRect = { rowStart: number; rowEnd: number; colStart: number; colEnd: number; dateKeys: string[]; startMinute: number; endMinute: number; };
type AgendaDragItem = { blockId: string; dateKey: string; startMinute: number; endMinute: number; canDrag: boolean; };
type AgendaDragState = {
  item: AgendaDragItem;
  pointerId: number;
  startX: number;
  startY: number;
  targetCell: HTMLElement | null;
  dragging: boolean;
};

const parseJsonScript = <T>(id: string, fallback: T): T => {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLScriptElement)) return fallback;
  try { return JSON.parse(node.textContent || 'null') ?? fallback; } catch { return fallback; }
};

const escapeHtml = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const getAgendaTeacherSlotMinutes = (config: AgendaConfig) => Math.max(5, Number(config.teacherSlotMinutes || 30));
const getAgendaStudentSlotMinutes = (config: AgendaConfig) => Math.max(5, Number(config.studentSlotMinutes || getAgendaTeacherSlotMinutes(config) || 30));
const blockOverlapsSlot = (block: AgendaBlock | AgendaEvent, slotStart: number, slotEnd: number) => Number(block.startMinute || 0) < slotEnd && Number(block.endMinute || 0) > slotStart;
const formatStudentName = (name: string) => {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name;
  return `${parts[0]} ${parts[parts.length - 1]}`;
};

const buildUnifiedSlots = (data: AgendaData, isTeacher: boolean) => {
  const startTime = timeStringToMinutes(data.config.startTime || '09:00');
  const endTime = timeStringToMinutes(data.config.endTime || '18:00');
  const slotMin = isTeacher ? getAgendaTeacherSlotMinutes(data.config) : getAgendaStudentSlotMinutes(data.config);

  const boundaries = new Set<number>();
  boundaries.add(startTime);
  boundaries.add(endTime);

  // Generate regular-grid boundaries unconditionally across the entire range
  let cursor = startTime;
  while (cursor + slotMin <= endTime) {
    cursor += slotMin;
    boundaries.add(cursor);
  }

  // Add event boundaries so each event occupies its own slot(s)
  const eventSegments = (data.events || [])
    .map(e => ({ start: Math.max(startTime, e.startMinute), end: Math.min(endTime, e.endMinute) }))
    .filter(e => e.start < e.end);
  eventSegments.forEach(e => { boundaries.add(e.start); boundaries.add(e.end); });

  // Add student block boundaries so each reservation occupies its own slot(s)
  const studentSegments = (data.students || [])
    .flatMap(s => (s.blocks || []))
    .map(b => ({ start: Math.max(startTime, b.startMinute), end: Math.min(endTime, b.endMinute) }))
    .filter(b => b.start < b.end);
  studentSegments.forEach(b => { boundaries.add(b.start); boundaries.add(b.end); });

  const sorted = Array.from(boundaries).sort((a, b) => a - b);
  const slots: AgendaSlot[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    slots.push({ startMinute: sorted[i], endMinute: sorted[i + 1], label: minutesToTimeString(sorted[i]), rowIndex: i });
  }
  return slots;
};

// ── Optimistic local state ───────────────────────────────────────────────────
// Applies an action payload to a cloned AgendaData immediately, before the
// server call. The rerender() callback renders the result right away; the real
// server write happens in the background. On error we rerender with the
// original snapshot to roll back.
let _optimisticSeq = 0;
const tempId = () => `__opt_${++_optimisticSeq}_${Date.now().toString(36)}`;

const blockDuration = (b: { startMinute: number; endMinute: number }) =>
  Math.max(0, b.endMinute - b.startMinute);

const applyLocalAction = (src: AgendaData, p: Record<string, any>): AgendaData => {
  // Deep-clone via JSON so we never mutate the original snapshot.
  const d: AgendaData = JSON.parse(JSON.stringify(src));

  switch (p.action) {
    case 'reserve-self': {
      const student = d.students.find(s => String(s.studentId || '').toLowerCase() === d.viewer.userId.toLowerCase());
      if (student) {
        for (const dateKey of (p.dateKeys as string[] || [])) {
          student.blocks.push({ id: tempId(), dateKey, startMinute: p.startMinute, endMinute: p.endMinute, comment: '', updatedAt: new Date().toISOString() });
        }
        student.totalMinutes = student.blocks.reduce((s, b) => s + blockDuration(b), 0);
      }
      break;
    }
    case 'delete-block': {
      d.students.forEach(s => {
        s.blocks = s.blocks.filter(b => b.id !== p.blockId);
        s.totalMinutes = s.blocks.reduce((acc, b) => acc + blockDuration(b), 0);
      });
      d.events = d.events.filter(e => e.id !== p.blockId);
      break;
    }
    case 'assign-event': {
      for (const dateKey of (p.dateKeys as string[] || [])) {
        d.events.push({ id: tempId(), dateKey, startMinute: p.startMinute, endMinute: p.endMinute, text: p.text || '', color: buildAgendaEventColor(p.text || ''), virtual: Boolean(p.virtual), updatedAt: new Date().toISOString() });
      }
      break;
    }
    case 'add-highlight': {
      if (!d.config.highlights) d.config.highlights = [];
      for (const dateKey of (p.dateKeys as string[] || [])) {
        d.config.highlights.push({
          id: tempId(),
          dateKey,
          startMinute: p.startMinute,
          endMinute: p.endMinute,
          color: p.color || '#38bdf8',
          text: p.text || ''
        });
      }
      break;
    }
    case 'clear-highlight': {
      if (d.config.highlights) {
        const dates = new Set<string>(p.dateKeys || []);
        d.config.highlights = d.config.highlights.filter(
          h => !dates.has(h.dateKey) || !blockOverlapsSlot(h, p.startMinute, p.endMinute)
        );
      }
      break;
    }
    case 'update-block':
    case 'move-block': {
      d.events = d.events.map(e => e.id === p.blockId ? { ...e, text: p.text ?? e.text, virtual: p.virtual !== undefined ? Boolean(p.virtual) : e.virtual, dateKey: p.dateKey ?? e.dateKey, startMinute: p.startMinute ?? e.startMinute, endMinute: p.endMinute ?? e.endMinute } : e);
      d.students.forEach(s => {
        s.blocks = s.blocks.map(b => b.id === p.blockId ? { ...b, comment: p.comment ?? b.comment, dateKey: p.dateKey ?? b.dateKey, startMinute: p.startMinute ?? b.startMinute, endMinute: p.endMinute ?? b.endMinute } : b);
      });
      break;
    }
    case 'copy-block': {
      const originalEvent = d.events.find(e => e.id === p.blockId);
      if (originalEvent) {
        d.events.push({
          ...originalEvent,
          id: tempId(),
          dateKey: p.dateKey ?? originalEvent.dateKey,
          startMinute: p.startMinute ?? originalEvent.startMinute,
          endMinute: p.endMinute ?? originalEvent.endMinute,
          updatedAt: new Date().toISOString()
        });
      }
      d.students.forEach(s => {
        const originalBlock = s.blocks.find(b => b.id === p.blockId);
        if (originalBlock) {
          s.blocks.push({
            ...originalBlock,
            id: tempId(),
            dateKey: p.dateKey ?? originalBlock.dateKey,
            startMinute: p.startMinute ?? originalBlock.startMinute,
            endMinute: p.endMinute ?? originalBlock.endMinute,
            updatedAt: new Date().toISOString()
          });
          s.totalMinutes = s.blocks.reduce((acc, b) => acc + blockDuration(b), 0);
        }
      });
      break;
    }
    case 'clear-range': {
      const dates = new Set<string>(p.dateKeys || []);
      d.students.forEach(s => {
        s.blocks = s.blocks.filter(b => !dates.has(b.dateKey) || !blockOverlapsSlot(b, p.startMinute, p.endMinute));
        s.totalMinutes = s.blocks.reduce((acc, b) => acc + blockDuration(b), 0);
      });
      d.events = d.events.filter(e => !dates.has(e.dateKey) || !blockOverlapsSlot(e, p.startMinute, p.endMinute));
      break;
    }
    case 'assign-students': {
      const ids = new Set<string>(p.studentIds || []);
      for (const dateKey of (p.dateKeys as string[] || [])) {
        d.students.forEach(s => {
          if (!ids.has(s.studentId)) return;
          s.blocks.push({ id: tempId(), dateKey, startMinute: p.startMinute, endMinute: p.endMinute, comment: '', updatedAt: new Date().toISOString() });
          s.totalMinutes = s.blocks.reduce((acc, b) => acc + blockDuration(b), 0);
        });
      }
      break;
    }
    case 'reserve-group': {
      const grupo = normalizeText(p.grupo);
      const targetStudents = d.students.filter(s => normalizeText(s.grupo) === grupo);
      for (const dateKey of (p.dateKeys as string[] || [])) {
        targetStudents.forEach(s => {
          s.blocks.push({ id: tempId(), dateKey, startMinute: p.startMinute, endMinute: p.endMinute, comment: '', updatedAt: new Date().toISOString() });
          s.totalMinutes = s.blocks.reduce((acc, b) => acc + blockDuration(b), 0);
        });
      }
      break;
    }
    case 'save-config': {
      d.config = {
        ...d.config,
        startTime: p.startTime ?? d.config.startTime,
        endTime: p.endTime ?? d.config.endTime,
        teacherSlotMinutes: p.teacherSlotMinutes ?? d.config.teacherSlotMinutes,
        studentSlotMinutes: p.studentSlotMinutes ?? d.config.studentSlotMinutes,
        maxStudentMinutes: p.maxStudentMinutes ?? d.config.maxStudentMinutes,
        minMeetings: p.minMeetings ?? d.config.minMeetings,
        comment: p.comment ?? d.config.comment,
      };
      break;
    }
  }
  return d;
};
// ─────────────────────────────────────────────────────────────────────────────

const postAgendaAction = async (payload: Record<string, any>) => {
  const response = await fetch('/api/dashboard/agenda', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result?.error || 'No se pudo actualizar la agenda'); }
  return response.json();
};

const findSelectionRect = (root: HTMLElement) => {
  const selectedCells = Array.from(root.querySelectorAll<HTMLElement>('.agenda-cell.is-selected'));
  if (!selectedCells.length) return null;
  const rowIndices = selectedCells.map((cell) => Number.parseInt(cell.dataset.rowIndex || '', 10)).filter(Number.isFinite);
  const colIndices = selectedCells.map((cell) => Number.parseInt(cell.dataset.colIndex || '', 10)).filter(Number.isFinite);
  const dateKeys = Array.from(new Set(selectedCells.map((cell) => normalizeAgendaDateKey(cell.dataset.dateKey)).filter(Boolean)));
  const startMinutes = selectedCells.map((cell) => Number.parseInt(cell.dataset.startMinute || '', 10)).filter(Number.isFinite);
  const endMinutes = selectedCells.map((cell) => Number.parseInt(cell.dataset.endMinute || '', 10)).filter(Number.isFinite);
  if (!rowIndices.length || !colIndices.length || !dateKeys.length) return null;
  return { rowStart: Math.min(...rowIndices), rowEnd: Math.max(...rowIndices), colStart: Math.min(...colIndices), colEnd: Math.max(...colIndices), dateKeys, startMinute: Math.min(...startMinutes), endMinute: Math.max(...endMinutes) } as SelectionRect;
};

const renderAgenda = (host: HTMLElement, data: AgendaData, rerender?: (nextData: AgendaData) => void) => {
  const mode = host.getAttribute('data-dashboard-agenda-mode');
  const isTeacher = mode === 'teacher';
  const viewerId = normalizeText(data?.viewer?.userId);
  const dates = Array.isArray(data?.dates) ? data.dates : [];
  const slots = buildUnifiedSlots(data, isTeacher);
  const studentById = new Map((data.students || []).map((student) => [student.studentId, student]));
  const viewerStudent = studentById.get(viewerId) || null;
  const teacherHeaderTitle = normalizeText(data.config?.comment);
  const shareUrl = `${window.location.origin}${data.shareUrlPath || ''}`;

  if (!normalizeText(data.courseId) || dates.length === 0 || slots.length === 0) {
    host.innerHTML = `<article class="student-empty">${isTeacher ? 'Definí primero el rango semanal en Tabla / Asistencia para habilitar la Agenda.' : 'La agenda todavía no está disponible para este curso.'}</article>`;
    return () => { host.innerHTML = ''; };
  }

  const resolveAgendaCellFromTarget = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('.agenda-cell') : null;
  const getCellStartMinute = (cell: HTMLElement | null) => Number.parseInt(cell?.dataset.startMinute || '', 10);
  const getCellDateKey = (cell: HTMLElement | null) => normalizeAgendaDateKey(cell?.dataset.dateKey);
  const getLastSlotEndMinute = () => Math.max(...slots.map((slot) => slot.endMinute));
  const getQuantizedStartMinute = (targetStartMinute: number, duration: number) => {
    const gridEndMinute = getLastSlotEndMinute();
    const validStarts = slots
      .map((slot) => slot.startMinute)
      .filter((startMinute) => startMinute + duration <= gridEndMinute);
    if (!validStarts.length) return null;
    const exact = validStarts.find((startMinute) => startMinute === targetStartMinute);
    if (exact !== undefined) return exact;
    return validStarts.reduce((best, startMinute) =>
      Math.abs(startMinute - targetStartMinute) < Math.abs(best - targetStartMinute) ? startMinute : best,
    validStarts[0]);
  };

  const findDragItemFromTarget = (target: EventTarget | null): AgendaDragItem | null => {
    if (!(target instanceof Element)) return null;
    const blockTarget = target.closest<HTMLElement>('[data-agenda-block-id]');
    const eventTarget = target.closest<HTMLElement>('[data-agenda-event-id]');
    const blockId = blockTarget?.dataset.agendaBlockId || eventTarget?.dataset.agendaEventId || '';
    if (!blockId) return null;

    const event = data.events.find((entry) => entry.id === blockId);
    if (event) {
      return {
        blockId,
        dateKey: event.dateKey,
        startMinute: event.startMinute,
        endMinute: event.endMinute,
        canDrag: isTeacher,
      };
    }

    for (const student of data.students || []) {
      const block = (student.blocks || []).find((entry) => entry.id === blockId);
      if (!block) continue;
      const isOwn = String(student.studentId || '').toLowerCase() === viewerId.toLowerCase();
      return {
        blockId,
        dateKey: block.dateKey,
        startMinute: block.startMinute,
        endMinute: block.endMinute,
        canDrag: isTeacher || isOwn,
      };
    }
    return null;
  };

  const renderCellEntries = (dateKey: string, slot: AgendaSlot, colIndex: number) => {
    const overlappingEvents = (data.events || []).filter(e => e.dateKey === dateKey && blockOverlapsSlot(e, slot.startMinute, slot.endMinute));
    const primaryEvent = overlappingEvents[0] || null;
    const isFirstSlotOfEvent = primaryEvent && !slots.some(s => s.rowIndex < slot.rowIndex && blockOverlapsSlot(primaryEvent, s.startMinute, s.endMinute));
    const isSame = (dk: string, ev: AgendaEvent) => (data.events || []).some(e => e.dateKey === dk && e.id === ev.id);
    let colStart = colIndex; if (primaryEvent) { while (colStart > 0 && isSame(dates[colStart - 1]?.dateKey, primaryEvent)) colStart--; }
    const isFirstColOfEvent = primaryEvent ? colIndex === colStart : false;

    const studentStarts = (data.students || [])
      .flatMap(student => (student.blocks || [])
        .filter(block => block.dateKey === dateKey && blockOverlapsSlot(block, slot.startMinute, slot.endMinute))
        .filter(block => !slots.some(s => s.rowIndex < slot.rowIndex && blockOverlapsSlot(block, s.startMinute, s.endMinute)))
        .map(block => ({ student, block }))
      );

    const MONITOR_SVG = `<svg class="agenda-event-virtual-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-label="evento virtual" title="evento virtual"><path d="M3 4.75A1.75 1.75 0 0 1 4.75 3h14.5A1.75 1.75 0 0 1 21 4.75v10.5A1.75 1.75 0 0 1 19.25 17h-5.5l1.2 3h1.8a.75.75 0 0 1 0 1.5h-9.5a.75.75 0 0 1 0-1.5h1.8l1.2-3h-6.5A1.75 1.75 0 0 1 3 15.25V4.75Zm1.5 0v10.5c0 .14.11.25.25.25h14.5a.25.25 0 0 0 .25-.25V4.75a.25.25 0 0 0-.25-.25H4.75a.25.25 0 0 0-.25.25Zm6.36 15.25h2.28l-1-2.5h-.28l-1 2.5Z"/></svg>`;
    const eventRowSpan = primaryEvent ? slots.filter(s => blockOverlapsSlot(primaryEvent, s.startMinute, s.endMinute)).length : 0;
    const eventMarkup = (isFirstSlotOfEvent && isFirstColOfEvent) ? `<span class="agenda-event-label" style="height: ${eventRowSpan * 100}%">${escapeHtml(primaryEvent.text)}${primaryEvent.virtual ? MONITOR_SVG : ''}</span>` : '';

    const activeHighlights = (data.config.highlights || []).filter(h => h.dateKey === dateKey && blockOverlapsSlot(h, slot.startMinute, slot.endMinute));
    const primaryHighlight = activeHighlights[0] || null;
    const isHighlightTop = primaryHighlight && !slots.some(s => s.rowIndex < slot.rowIndex && blockOverlapsSlot(primaryHighlight, s.startMinute, s.endMinute));
    const isHighlightBottom = primaryHighlight && !slots.some(s => s.rowIndex > slot.rowIndex && blockOverlapsSlot(primaryHighlight, s.startMinute, s.endMinute));

    let borderStyles = '';
    let dogearMarkup = '';
    if (primaryHighlight) {
      const color = primaryHighlight.color || '#38bdf8';
      borderStyles += `border-left: 2.5px solid ${color}; border-right: 2.5px solid ${color};`;
      if (isHighlightTop) {
        borderStyles += `border-top: 2.5px solid ${color}; border-top-left-radius: 4px; border-top-right-radius: 4px;`;
        dogearMarkup = `<span class="agenda-highlight-dogear" style="--highlight-color: ${escapeHtml(color)}" title="${escapeHtml(primaryHighlight.text)}" role="img" aria-label="destacado"></span>`;
      }
      if (isHighlightBottom) {
        borderStyles += `border-bottom: 2.5px solid ${color}; border-bottom-left-radius: 4px; border-bottom-right-radius: 4px;`;
      }
    }

    const studentMarkup = studentStarts.map(({ student, block }) => {
      const isOwn = String(student.studentId || '').toLowerCase() === viewerId.toLowerCase();
      const fullName = formatStudentName(student.name);
      const nameParts = fullName.trim().split(/\s+/);
      const nameHtml = nameParts.length > 1
        ? `${escapeHtml(nameParts[0])}<br>${escapeHtml(nameParts.slice(1).join(' '))}`
        : escapeHtml(fullName);
      const blockRowSpan = slots.filter(s => blockOverlapsSlot(block, s.startMinute, s.endMinute)).length;
      return `<span class="agenda-student-block ${isOwn ? 'is-own' : ''}" style="background-color: ${escapeHtml(student.color)}; height: ${blockRowSpan * 100}%" ${isTeacher || isOwn ? `data-agenda-block-id="${escapeHtml(block.id)}"` : ''}><span class="agenda-student-block__name">${nameHtml}</span></span>`;
    }).join('');

    const effectiveEventColor = primaryEvent
      ? isMutedAgendaEvent(primaryEvent.text) ? '#b8bcc8' : primaryEvent.color || '#f2d0a9'
      : '';
    const classes = [
      'agenda-cell',
      primaryEvent ? 'agenda-cell--event' : '',
      primaryEvent && isMutedAgendaEvent(primaryEvent.text) ? 'agenda-cell--event-muted' : '',
      (studentStarts.length > 0) ? 'agenda-cell--busy' : '',
      primaryHighlight ? 'agenda-cell--highlighted' : ''
    ].filter(Boolean).join(' ');

    let style = primaryEvent ? `--agenda-event-color: ${escapeHtml(effectiveEventColor)};` : '';
    if (borderStyles) {
      style += ` ${borderStyles}`;
    }

    return { classes, style, markup: `${eventMarkup}${studentMarkup}`, dogearMarkup, eventId: primaryEvent?.id || null };
  };

  host.innerHTML = `
    <div class="agenda-shell">
      <div class="agenda-head">
        <div class="agenda-head__title">
          <p class="agenda-head__eyebrow">${escapeHtml(data.courseTitle || data.courseId)}, ${escapeHtml(data.year)}</p>
          ${isTeacher ? `<div class="agenda-title-edit"><div class="agenda-title-edit__display ${teacherHeaderTitle ? '' : 'is-empty'}" data-agenda-comment-display role="button">${escapeHtml(teacherHeaderTitle || 'Título')}</div><input type="text" class="agenda-title-edit__input" data-agenda-comment-input-inline value="${escapeHtml(teacherHeaderTitle)}" hidden /></div>` : teacherHeaderTitle ? `<p class="agenda-head__note">${escapeHtml(teacherHeaderTitle)}</p>` : ''}
        </div>
        ${isTeacher ? `
          <div class="agenda-config-bar">
            <label class="agenda-config-field"><span>Inicio</span><input type="time" value="${normalizeAgendaTimeString(data.config.startTime)}" data-agenda-config="startTime" /></label>
            <label class="agenda-config-field"><span>Fin</span><input type="time" value="${normalizeAgendaTimeString(data.config.endTime)}" data-agenda-config="endTime" /></label>
            <label class="agenda-config-field agenda-config-field--tiny" title="Duración del slot del docente / Cuantización de la grilla (en minutos)"><span>Dur.T</span><input type="number" step="5" value="${data.config.teacherSlotMinutes}" data-agenda-config="teacherSlotMinutes" title="Duración del slot del docente / Cuantización de la grilla (en minutos)" /></label>
            <label class="agenda-config-field agenda-config-field--tiny" title="Duración del slot de reserva para los estudiantes (en minutos)"><span>Dur.S</span><input type="number" step="5" value="${data.config.studentSlotMinutes}" data-agenda-config="studentSlotMinutes" title="Duración del slot de reserva para los estudiantes (en minutos)" /></label>
            <label class="agenda-config-field agenda-config-field--small"><span>Tope min</span><input type="number" step="5" value="${data.config.maxStudentMinutes}" data-agenda-config="maxStudentMinutes" /></label>
            <label class="agenda-config-field agenda-config-field--small"><span>Cant. mín.</span><input type="number" step="1" value="${data.config.minMeetings || 0}" data-agenda-config="minMeetings" /></label>
            <button type="button" class="dashboard-grid-btn dashboard-grid-btn--primary" data-agenda-share>Compartir</button>
          </div>
        ` : `
          <div class="agenda-head__stats">
            <span class="agenda-stat">Mis min: <strong>${viewerStudent?.totalMinutes || 0}</strong></span>
            <span class="agenda-stat">Tope: <strong>${data.config.maxStudentMinutes}</strong></span>
            ${(data.config?.minMeetings || 0) > 0 ? `<span class="agenda-stat">Encuentros: <strong>${countAgendaMeetingDays(viewerStudent?.blocks || [])}/${data.config.minMeetings}</strong></span>` : ''}
          </div>
        `}
      </div>
      <div class="agenda-grid-wrap">
        <table class="agenda-grid">
          <thead><tr><th class="agenda-grid__time-head">Hora</th>${dates.map(d => `<th class="agenda-grid__day-head"><span>${escapeHtml(d.label || d.dateKey)}</span></th>`).join('')}</tr></thead>
          <tbody>
            ${slots.map(slot => `
              <tr>
                <th class="agenda-grid__time">${escapeHtml(slot.label)}</th>
                ${dates.map((date, colIndex) => {
                  const cell = renderCellEntries(date.dateKey, slot, colIndex);
                  return `<td><button type="button" class="${cell.classes}" style="${cell.style}" data-row-index="${slot.rowIndex}" data-col-index="${colIndex}" data-date-key="${escapeHtml(date.dateKey)}" data-start-minute="${slot.startMinute}" data-end-minute="${slot.endMinute}" ${cell.eventId ? `data-agenda-event-id="${escapeHtml(cell.eventId)}"` : ''}><span class="agenda-cell__fill"></span><span class="agenda-cell__content">${cell.markup}</span>${cell.dogearMarkup || ''}</button></td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="agenda-popover" data-agenda-popover hidden></div>
      <div class="agenda-modal" data-agenda-modal hidden></div>
    </div>
  `;

  const gridWrap = host.querySelector<HTMLElement>('.agenda-grid-wrap');
  const popover = host.querySelector<HTMLElement>('[data-agenda-popover]');
  const modal = host.querySelector<HTMLElement>('[data-agenda-modal]');
  
  let anchorCell: HTMLElement | null = null;
  let hoveredCell: HTMLElement | null = null;
  let selecting = false;
  let activePointerId: number | null = null;
  let longPressTimer: any = null;
  let dragState: AgendaDragState | null = null;

  const stopUiEvent = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
  const stopUiPropagation = (e: Event) => e.stopPropagation();

  const clearSelection = () => {
    host.querySelectorAll('.agenda-cell.is-selected').forEach(c => c.classList.remove('is-selected'));
    host.querySelectorAll('.agenda-cell.is-drag-target').forEach(c => c.classList.remove('is-drag-target'));
    host.classList.remove('is-agenda-dragging');
    if (popover) popover.hidden = true;
  };

  const paintSelection = () => {
    if (!anchorCell || !hoveredCell) return;
    const aR = Number(anchorCell.dataset.rowIndex); const hR = Number(hoveredCell.dataset.rowIndex);
    const aC = Number(anchorCell.dataset.colIndex); const hC = Number(hoveredCell.dataset.colIndex);
    const rS = Math.min(aR, hR); const rE = Math.max(aR, hR);
    const cS = Math.min(aC, hC); const cE = Math.max(aC, hC);
    host.querySelectorAll<HTMLElement>('.agenda-cell').forEach(c => {
      const r = Number(c.dataset.rowIndex); const col = Number(c.dataset.colIndex);
      c.classList.toggle('is-selected', r >= rS && r <= rE && col >= cS && col <= cE);
    });
  };

  const reloadAfterAction = async (p: any) => {
    // 1. Close popover/modal and clear selection immediately.
    if (popover) popover.hidden = true;
    if (modal) modal.hidden = true;
    clearSelection();

    // 2. Optimistic: apply change locally and rerender right away so the user
    //    sees the result without waiting for the network.
    const snapshot = data;
    const optimisticData = applyLocalAction(data, p);
    if (rerender) rerender(optimisticData);

    // 3. Persist to server in the background — no reload needed, optimistic
    //    state is already correct. Temp IDs are reconciled on success.
    try {
      const result = await postAgendaAction(p);
      if (result.success) {
        // Reconcile IDs: Replace optimistic blocks/events with real ones from server
        // so they can be edited/deleted immediately without a page reload.
        if (result.student) {
          const sIdx = optimisticData.students.findIndex(s => String(s.studentId || '').toLowerCase() === String(result.student.studentId || '').toLowerCase());
          if (sIdx !== -1) {
            optimisticData.students[sIdx] = { ...optimisticData.students[sIdx], ...result.student };
            if (rerender) rerender(optimisticData);
          }
        }
        if (Array.isArray(result.students)) {
          result.students.forEach((rs: any) => {
            const sIdx = optimisticData.students.findIndex(s => String(s.studentId || '').toLowerCase() === String(rs.studentId || '').toLowerCase());
            if (sIdx !== -1) optimisticData.students[sIdx] = { ...optimisticData.students[sIdx], ...rs };
          });
          if (rerender) rerender(optimisticData);
        }
        if (Array.isArray(result.events)) {
          optimisticData.events = result.events;
          if (rerender) rerender(optimisticData);
        }
      }
    } catch (e: any) {
      // Rollback: rerender with the original snapshot.
      if (rerender) rerender(snapshot);
      window.console.warn(e.message || 'Error');
    }
  };

  const paintDragTarget = (cell: HTMLElement | null) => {
    host.querySelectorAll('.agenda-cell.is-drag-target').forEach(c => c.classList.remove('is-drag-target'));
    if (cell) cell.classList.add('is-drag-target');
  };

  const clearDragState = () => {
    paintDragTarget(null);
    host.classList.remove('is-agenda-dragging');
    dragState = null;
  };

  const moveDraggedBlock = async (cell: HTMLElement | null, altKey = false) => {
    if (!dragState || !cell) return;
    const dateKey = getCellDateKey(cell);
    const targetStartMinute = getCellStartMinute(cell);
    const duration = blockDuration(dragState.item);
    if (!dateKey || !Number.isFinite(targetStartMinute) || duration <= 0) return;

    const startMinute = getQuantizedStartMinute(targetStartMinute, duration);
    if (startMinute === null) return;
    const endMinute = startMinute + duration;
    if (
      !altKey
      && dateKey === dragState.item.dateKey
      && startMinute === dragState.item.startMinute
      && endMinute === dragState.item.endMinute
    ) {
      return;
    }

    const action = altKey ? 'copy-block' : 'move-block';

    await reloadAfterAction({
      action,
      courseId: data.courseId,
      year: data.year,
      blockId: dragState.item.blockId,
      dateKey,
      startMinute,
      endMinute,
    });
  };

  const openBlockModal = (selection: SelectionRect, blockId?: string) => {
    if (!modal) return;
    const student = data.students.find(s => s.blocks.some(b => b.id === blockId));
    const block = student?.blocks.find(b => b.id === blockId);
    if (!block) return;
    
    modal.hidden = false;
    modal.innerHTML = `<div class="agenda-modal__backdrop" data-close></div><div class="agenda-modal__dialog"><h3>Editar Reserva</h3><p style="margin-bottom:1rem; opacity:.7">${escapeHtml(student?.name)}</p><label class="agenda-modal__label">Comentario</label><textarea class="agenda-modal__input" data-comment style="min-height:80px" placeholder="Alguna nota...">${escapeHtml(block.comment || '')}</textarea><div class="agenda-modal__actions"><button type="button" class="dashboard-grid-btn" data-close>Cancelar</button><button type="button" class="dashboard-grid-btn dashboard-grid-btn--primary" data-save>Guardar</button></div></div>`;
    modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => modal.hidden = true));
    modal.querySelector('[data-save]')?.addEventListener('click', async () => {
      const comment = modal.querySelector<HTMLTextAreaElement>('[data-comment]')?.value || '';
      modal.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = true; });
      await reloadAfterAction({ action: 'update-block', courseId: data.courseId, year: data.year, blockId, comment });
    });
  };

  const openEventModal = (selection: SelectionRect, eventId?: string) => {
    if (!modal) return;
    const existing = eventId ? data.events.find(e => e.id === eventId) : null;
    modal.hidden = false;
    modal.innerHTML = `<div class="agenda-modal__backdrop" data-close></div><div class="agenda-modal__dialog"><h3>${existing ? 'Editar Evento' : 'Asignar Evento'}</h3><input type="text" class="agenda-modal__input" data-text value="${existing?.text || ''}" placeholder="Título" /><label class="agenda-modal__check-row"><input type="checkbox" data-virtual ${existing?.virtual ? 'checked' : ''} /><span>Virtual</span></label><div class="agenda-modal__actions"><button type="button" class="dashboard-grid-btn" data-close>Cancelar</button><button type="button" class="dashboard-grid-btn dashboard-grid-btn--primary" data-save>Guardar</button></div></div>`;
    modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => modal.hidden = true));
    modal.querySelector('[data-save]')?.addEventListener('click', async () => {
      const text = modal.querySelector<HTMLInputElement>('[data-text]')?.value;
      if (!text) return;
      const virtual = modal.querySelector<HTMLInputElement>('[data-virtual]')?.checked || false;
      modal.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = true; });
      await reloadAfterAction({ action: existing ? 'update-block' : 'assign-event', courseId: data.courseId, year: data.year, blockId: eventId, dateKeys: selection.dateKeys, startMinute: selection.startMinute, endMinute: selection.endMinute, text, virtual });
    });
  };

  const openHighlightModal = (selection: SelectionRect) => {
    if (!modal) return;
    modal.hidden = false;
    modal.innerHTML = `<div class="agenda-modal__backdrop" data-close></div><div class="agenda-modal__dialog"><h3>Destacar Rango</h3><label class="agenda-modal__label">Propósito / Texto explicativo</label><input type="text" class="agenda-modal__input" data-highlight-text placeholder="ej. Anotarse aquí turno mañana..." /><label class="agenda-modal__label">Color</label><select class="agenda-modal__input" data-highlight-color><option value="#38bdf8" style="background-color: #38bdf8; color: #000;">Celeste</option><option value="#34d399" style="background-color: #34d399; color: #000;">Verde</option><option value="#fbbf24" style="background-color: #fbbf24; color: #000;">Amarillo</option><option value="#f87171" style="background-color: #f87171; color: #000;">Rojo</option><option value="#c084fc" style="background-color: #c084fc; color: #000;">Violeta</option></select><div class="agenda-modal__actions"><button type="button" class="dashboard-grid-btn" data-close>Cancelar</button><button type="button" class="dashboard-grid-btn dashboard-grid-btn--primary" data-save>Destacar</button></div></div>`;
    modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => modal.hidden = true));
    modal.querySelector('[data-save]')?.addEventListener('click', async () => {
      const text = modal.querySelector<HTMLInputElement>('[data-highlight-text]')?.value || '';
      const color = modal.querySelector<HTMLSelectElement>('[data-highlight-color]')?.value || '#38bdf8';
      if (!text) return;
      modal.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = true; });
      await reloadAfterAction({ action: 'add-highlight', courseId: data.courseId, year: data.year, dateKeys: selection.dateKeys, startMinute: selection.startMinute, endMinute: selection.endMinute, text, color });
    });
  };

  const openStudentAssignmentModal = (selection: SelectionRect) => {
    if (!modal) return;
    const selectedIds = new Set<string>();
    const renderList = () => (data.students || []).map(s => `<label class="agenda-student-row"><input type="checkbox" value="${s.studentId}" ${selectedIds.has(s.studentId) ? 'checked' : ''} /><span>${escapeHtml(s.name)}</span></label>`).join('');
    modal.hidden = false;
    modal.innerHTML = `<div class="agenda-modal__backdrop" data-close></div><div class="agenda-modal__dialog"><h3>Asignar Estudiantes</h3><div class="agenda-student-list">${renderList()}</div><div class="agenda-modal__actions"><button type="button" class="dashboard-grid-btn" data-close>Cancelar</button><button type="button" class="dashboard-grid-btn dashboard-grid-btn--primary" data-save>Asignar</button></div></div>`;
    modal.querySelectorAll('input[type="checkbox"]').forEach(i => i.addEventListener('change', (e) => {
      const id = (e.target as HTMLInputElement).value;
      if ((e.target as HTMLInputElement).checked) selectedIds.add(id); else selectedIds.delete(id);
    }));
    modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => modal.hidden = true));
    modal.querySelector('[data-save]')?.addEventListener('click', async () => {
      if (selectedIds.size === 0) return;
      modal.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = true; });
      await reloadAfterAction({ action: 'assign-students', courseId: data.courseId, year: data.year, dateKeys: selection.dateKeys, startMinute: selection.startMinute, endMinute: selection.endMinute, studentIds: Array.from(selectedIds) });
    });
  };

  const openGrupoAssignmentModal = (selection: SelectionRect, grupos: string[]) => {
    if (!modal) return;
    modal.hidden = false;
    const grupoStudentCounts = grupos.map(g => ({
      grupo: g,
      count: (data.students || []).filter(s => normalizeText(s.grupo) === g).length,
    }));
    modal.innerHTML = `<div class="agenda-modal__backdrop" data-close></div><div class="agenda-modal__dialog"><h3>Asignar Grupo</h3><div class="agenda-student-list">${grupoStudentCounts.map(({ grupo, count }) => `<button type="button" class="dashboard-grid-btn" data-assign-grupo="${escapeHtml(grupo)}">Grupo ${escapeHtml(grupo)} <span style="opacity:.6;font-size:.8em">(${count})</span></button>`).join('')}</div><div class="agenda-modal__actions"><button type="button" class="dashboard-grid-btn" data-close>Cancelar</button></div></div>`;
    modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { modal.hidden = true; }));
    modal.querySelectorAll<HTMLButtonElement>('[data-assign-grupo]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const grupo = btn.dataset.assignGrupo || '';
        modal.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = true; });
        await reloadAfterAction({ action: 'reserve-group', courseId: data.courseId, year: data.year, grupo, dateKeys: selection.dateKeys, startMinute: selection.startMinute, endMinute: selection.endMinute });
      });
    });
  };

  const openSelectionActions = (selection: SelectionRect, options: { pos?: { x: number; y: number }, targetBlockId?: string, targetEventId?: string } = {}) => {
    if (!popover) return;
    const ownBlocks = (data.students.find(s => String(s.studentId || '').toLowerCase() === viewerId.toLowerCase())?.blocks || [])
      .filter(b => selection.dateKeys.includes(b.dateKey) && blockOverlapsSlot(b, selection.startMinute, selection.endMinute));
    const firstOwnBlockId = options.targetBlockId || ownBlocks[0]?.id;
    const ev = options.targetEventId ? data.events.find(e => e.id === options.targetEventId) : data.events.find(ev => selection.dateKeys.includes(ev.dateKey) && ev.startMinute < selection.endMinute && ev.endMinute > selection.startMinute);

    const viewerGrupo = normalizeText(data.viewer.grupo);
    const allGrupos = [...new Set((data.students || []).map(s => normalizeText(s.grupo)).filter(Boolean))].sort();

    let html = '<div class="agenda-popover__actions">';
    if (isTeacher) {
      html += `<button type="button" class="dashboard-grid-btn" data-act="students">Alumnos</button>`;
      if (allGrupos.length > 0) {
        html += `<button type="button" class="dashboard-grid-btn" data-act="grupos">Grupos</button>`;
      }
      html += `<button type="button" class="dashboard-grid-btn" data-act="event">Evento</button>`;
      html += `<button type="button" class="dashboard-grid-btn" data-act="highlight">Destacar</button>`;
      const hasHighlightOverlap = (data.config.highlights || []).some(h => selection.dateKeys.includes(h.dateKey) && blockOverlapsSlot(h, selection.startMinute, selection.endMinute));
      if (hasHighlightOverlap) {
        html += `<button type="button" class="dashboard-grid-btn dashboard-grid-btn--danger" data-act="clear-highlight">Quitar Destacado</button>`;
      }
      if (ev) html += `<button type="button" class="dashboard-grid-btn" data-act="edit">Editar</button>`;
      html += `<button type="button" class="dashboard-grid-btn dashboard-grid-btn--danger" data-act="clear">Borrar Todo</button>`;
      if (options.targetBlockId || options.targetEventId) {
        html += `<button type="button" class="dashboard-grid-btn dashboard-grid-btn--danger" data-act="delete-block" data-block-id="${escapeHtml(options.targetBlockId || options.targetEventId || '')}">${options.targetEventId ? 'Eliminar Evento' : 'Eliminar Bloque'}</button>`;
      }
    } else {
      html += `<button type="button" class="dashboard-grid-btn dashboard-grid-btn--primary" data-act="reserve">RESERVAR (como alumnx)</button>`;
      if (viewerGrupo) {
        html += `<button type="button" class="dashboard-grid-btn" data-act="reserve-group" data-grupo="${escapeHtml(viewerGrupo)}">RESERVAR con mi Grupo</button>`;
      }
      if (firstOwnBlockId) {
        const isOwn = (data.students.find(s => String(s.studentId || '').toLowerCase() === viewerId.toLowerCase())?.blocks || []).some(b => b.id === firstOwnBlockId);
        if (isOwn) {
          html += `<button type="button" class="dashboard-grid-btn" data-act="edit-block" data-block-id="${escapeHtml(firstOwnBlockId)}">Editar</button>`;
          html += `<button type="button" class="dashboard-grid-btn dashboard-grid-btn--danger" data-act="delete-block" data-block-id="${escapeHtml(firstOwnBlockId)}">Eliminar Reserva</button>`;
        }
      }
    }
    html += '</div>';
    popover.innerHTML = html;
    popover.hidden = false;

    if (options.pos) {
      popover.style.left = `${options.pos.x}px`; popover.style.top = `${options.pos.y}px`;
    } else {
      const rect = getSelectionViewportRect();
      if (rect) { popover.style.left = `${rect.left}px`; popover.style.top = `${rect.bottom + 8}px`; }
    }

    popover.querySelector('[data-act="students"]')?.addEventListener('click', (e) => { stopUiEvent(e); openStudentAssignmentModal(selection); });
    popover.querySelector('[data-act="grupos"]')?.addEventListener('click', (e) => { stopUiEvent(e); openGrupoAssignmentModal(selection, allGrupos); });
    popover.querySelector('[data-act="event"]')?.addEventListener('click', (e) => { stopUiEvent(e); openEventModal(selection); });
    popover.querySelector('[data-act="edit"]')?.addEventListener('click', (e) => { stopUiEvent(e); openEventModal(selection, ev?.id); });
    popover.querySelector('[data-act="highlight"]')?.addEventListener('click', (e) => { stopUiEvent(e); openHighlightModal(selection); });
    popover.querySelector('[data-act="clear-highlight"]')?.addEventListener('click', (e) => { stopUiEvent(e); reloadAfterAction({ action: 'clear-highlight', courseId: data.courseId, year: data.year, dateKeys: selection.dateKeys, startMinute: selection.startMinute, endMinute: selection.endMinute }); });
    popover.querySelector('[data-act="edit-block"]')?.addEventListener('click', (e) => {
      const bid = (e.currentTarget as HTMLElement).dataset.blockId;
      stopUiEvent(e); openBlockModal(selection, bid);
    });
    popover.querySelector('[data-act="clear"]')?.addEventListener('click', (e) => { stopUiEvent(e); reloadAfterAction({ action: 'clear-range', courseId: data.courseId, year: data.year, dateKeys: selection.dateKeys, startMinute: selection.startMinute, endMinute: selection.endMinute }); });
    popover.querySelector('[data-act="reserve"]')?.addEventListener('click', (e) => { stopUiEvent(e); reloadAfterAction({ action: 'reserve-self', courseId: data.courseId, year: data.year, dateKeys: selection.dateKeys, startMinute: selection.startMinute, endMinute: selection.endMinute }); });
    popover.querySelector('[data-act="reserve-group"]')?.addEventListener('click', (e) => {
      const grupo = (e.currentTarget as HTMLElement).dataset.grupo || '';
      stopUiEvent(e); reloadAfterAction({ action: 'reserve-group', courseId: data.courseId, year: data.year, grupo, dateKeys: selection.dateKeys, startMinute: selection.startMinute, endMinute: selection.endMinute });
    });
    popover.querySelector('[data-act="delete-block"]')?.addEventListener('click', (e) => {
      const bid = (e.currentTarget as HTMLElement).dataset.blockId;
      stopUiEvent(e); reloadAfterAction({ action: 'delete-block', courseId: data.courseId, year: data.year, blockId: bid });
    });
  };

  const getSelectionViewportRect = () => {
    const selected = Array.from(host.querySelectorAll<HTMLElement>('.agenda-cell.is-selected'));
    if (!selected.length) return null;
    const rects = selected.map(c => c.getBoundingClientRect());
    return { top: Math.min(...rects.map(r => r.top)), bottom: Math.max(...rects.map(r => r.bottom)), left: Math.min(...rects.map(r => r.left)), right: Math.max(...rects.map(r => r.right)) };
  };

  const handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const cell = resolveAgendaCellFromTarget(e.target); if (!cell) return;
    e.preventDefault();
    const dragItem = findDragItemFromTarget(e.target);
    if (dragItem?.canDrag) {
      dragState = {
        item: dragItem,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        targetCell: cell,
        dragging: false,
      };
    }
    const bid = (e.target as HTMLElement).closest('[data-agenda-block-id]') as HTMLElement;
    const eid = (e.target as HTMLElement).closest('[data-agenda-event-id]') as HTMLElement;
    if (bid || eid) {
      longPressTimer = setTimeout(() => {
        const selection = findSelectionRect(host);
        if (selection) openSelectionActions(selection, { pos: { x: e.clientX, y: e.clientY }, targetBlockId: bid?.dataset.agendaBlockId, targetEventId: eid?.dataset.agendaEventId });
      }, 800);
    }
    selecting = true; activePointerId = e.pointerId; anchorCell = cell; hoveredCell = cell;
    try { cell.setPointerCapture(e.pointerId); } catch(err){}
    paintSelection(); if (popover) popover.hidden = true;
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (dragState && dragState.pointerId === e.pointerId) {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      const next = resolveAgendaCellFromTarget(document.elementFromPoint(e.clientX, e.clientY));
      const movedEnough = Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY) > 6;
      if (movedEnough || dragState.dragging) {
        if (!dragState.dragging) {
          clearSelection();
          if (popover) popover.hidden = true;
        }
        dragState.dragging = true;
        dragState.targetCell = next || dragState.targetCell;
        selecting = false;
        host.classList.add('is-agenda-dragging');
        paintDragTarget(dragState.targetCell);
        return;
      }
    }
    if (!selecting || (activePointerId !== null && e.pointerId !== activePointerId)) return;
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    const next = resolveAgendaCellFromTarget(document.elementFromPoint(e.clientX, e.clientY));
    if (!next || next === hoveredCell) return;
    hoveredCell = next; paintSelection();
  };

  const handlePointerUp = (e: PointerEvent) => {
    if (e.type === 'pointercancel') {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      if (activePointerId !== null && anchorCell) { try { anchorCell.releasePointerCapture(activePointerId); } catch(err){} }
      selecting = false;
      activePointerId = null;
      clearDragState();
      return;
    }
    if (dragState && dragState.pointerId === e.pointerId && dragState.dragging) {
      const targetCell = resolveAgendaCellFromTarget(document.elementFromPoint(e.clientX, e.clientY)) || dragState.targetCell;
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      if (activePointerId !== null && anchorCell) { try { anchorCell.releasePointerCapture(activePointerId); } catch(err){} }
      activePointerId = null; selecting = false;
      const dragged = dragState;
      clearDragState();
      dragState = dragged;
      void moveDraggedBlock(targetCell, e.altKey).finally(() => { dragState = null; });
      return;
    }
    if (dragState && dragState.pointerId === e.pointerId) clearDragState();
    if (!selecting || (activePointerId !== null && e.pointerId !== activePointerId)) return;
    selecting = false; if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    if (activePointerId !== null && anchorCell) { try { anchorCell.releasePointerCapture(activePointerId); } catch(err){} }
    activePointerId = null;
    const selection = findSelectionRect(host); if (selection) openSelectionActions(selection);
  };

  gridWrap?.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerUp);
  gridWrap?.addEventListener('contextmenu', (e: MouseEvent) => {
    stopUiEvent(e);
    const cell = resolveAgendaCellFromTarget(e.target);
    if (cell) {
      clearSelection();
      cell.classList.add('is-selected');
      const selection = findSelectionRect(host);
      const bid = (e.target as HTMLElement).closest('[data-agenda-block-id]') as HTMLElement;
      const eid = (e.target as HTMLElement).closest('[data-agenda-event-id]') as HTMLElement;
      if (selection) openSelectionActions(selection, { pos: { x: e.clientX, y: e.clientY }, targetBlockId: bid?.dataset.agendaBlockId, targetEventId: eid?.dataset.agendaEventId });
    }
  });

  if (isTeacher) {
    host.querySelectorAll<HTMLInputElement>('[data-agenda-config]').forEach(i => i.addEventListener('change', () => {
      const p = {
        action: 'save-config', courseId: data.courseId, year: data.year,
        startTime: host.querySelector<HTMLInputElement>('[data-agenda-config="startTime"]')?.value || data.config.startTime,
        endTime: host.querySelector<HTMLInputElement>('[data-agenda-config="endTime"]')?.value || data.config.endTime,
        teacherSlotMinutes: Number.parseInt(host.querySelector<HTMLInputElement>('[data-agenda-config="teacherSlotMinutes"]')?.value || `${data.config.teacherSlotMinutes}`, 10),
        studentSlotMinutes: Number.parseInt(host.querySelector<HTMLInputElement>('[data-agenda-config="studentSlotMinutes"]')?.value || `${data.config.studentSlotMinutes}`, 10),
        maxStudentMinutes: Number.parseInt(host.querySelector<HTMLInputElement>('[data-agenda-config="maxStudentMinutes"]')?.value || `${data.config.maxStudentMinutes}`, 10),
        minMeetings: Number.parseInt(host.querySelector<HTMLInputElement>('[data-agenda-config="minMeetings"]')?.value || `${data.config.minMeetings}`, 10),
        comment: data.config.comment,
        highlights: data.config.highlights
      };
      reloadAfterAction(p);
    }));

    const display = host.querySelector<HTMLElement>('[data-agenda-comment-display]');
    const input = host.querySelector<HTMLInputElement>('[data-agenda-comment-input-inline]');
    if (display && input) {
      display.addEventListener('click', () => {
        display.hidden = true;
        input.hidden = false;
        input.focus();
        input.select();
      });
      const saveTitle = () => {
        const nextValue = input.value.trim();
        if (nextValue !== data.config.comment) {
          const p = {
            action: 'save-config', courseId: data.courseId, year: data.year,
            startTime: host.querySelector<HTMLInputElement>('[data-agenda-config="startTime"]')?.value || data.config.startTime,
            endTime: host.querySelector<HTMLInputElement>('[data-agenda-config="endTime"]')?.value || data.config.endTime,
            teacherSlotMinutes: Number.parseInt(host.querySelector<HTMLInputElement>('[data-agenda-config="teacherSlotMinutes"]')?.value || `${data.config.teacherSlotMinutes}`, 10),
            studentSlotMinutes: Number.parseInt(host.querySelector<HTMLInputElement>('[data-agenda-config="studentSlotMinutes"]')?.value || `${data.config.studentSlotMinutes}`, 10),
            maxStudentMinutes: Number.parseInt(host.querySelector<HTMLInputElement>('[data-agenda-config="maxStudentMinutes"]')?.value || `${data.config.maxStudentMinutes}`, 10),
            minMeetings: Number.parseInt(host.querySelector<HTMLInputElement>('[data-agenda-config="minMeetings"]')?.value || `${data.config.minMeetings}`, 10),
            comment: nextValue,
            highlights: data.config.highlights
          };
          reloadAfterAction(p);
        } else {
          display.hidden = false;
          input.hidden = true;
        }
      };
      input.addEventListener('blur', saveTitle);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          saveTitle();
        } else if (e.key === 'Escape') {
          input.value = data.config.comment || '';
          display.hidden = false;
          input.hidden = true;
        }
      });
    }

    host.querySelector<HTMLButtonElement>('[data-agenda-share]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      try {
        await navigator.clipboard.writeText(shareUrl);
        const prev = btn.textContent;
        btn.textContent = '✓ Copiado';
        setTimeout(() => { btn.textContent = prev; }, 1800);
      } catch {
        window.prompt('Copiá este link para compartir la agenda:', shareUrl);
      }
    });
  }

  const handleDocClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement; if (!t.closest('.agenda-cell') && !t.closest('.agenda-popover') && !t.closest('.agenda-modal') && !t.closest('.agenda-context-menu')) clearSelection();
  };
  document.addEventListener('click', handleDocClick);

  return () => {
    gridWrap?.removeEventListener('pointerdown', handlePointerDown); window.removeEventListener('pointermove', handlePointerMove); window.removeEventListener('pointerup', handlePointerUp); window.removeEventListener('pointercancel', handlePointerUp); document.removeEventListener('click', handleDocClick); host.innerHTML = '';
  };
};

export const mountDashboardAgenda = (root: HTMLElement) => {
  const scriptNode = document.getElementById('dashboard-agenda-data');
  const initialData = parseJsonScript<AgendaData>('dashboard-agenda-data', { courseId: '', courseTitle: '', year: '', dates: [], config: { courseId: '', year: '', startTime: '09:00', endTime: '18:00', teacherSlotMinutes: 30, studentSlotMinutes: 30, maxStudentMinutes: 60, minMeetings: 0, comment: '', updatedAt: '' }, students: [], events: [], viewer: { userId: '', isTeacher: false } });
  const hosts = Array.from(root.querySelectorAll<HTMLElement>('[data-dashboard-agenda]'));
  hosts.forEach(host => {
    let currentDestroy: (() => void) | null = null;
    const renderHost = (nextData: AgendaData) => { 
      if (typeof currentDestroy === 'function') currentDestroy(); 
      currentDestroy = renderAgenda(host, nextData, renderHost); 
    };
    renderHost(initialData);
  });
};
