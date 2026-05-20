export type OrfActionType =
  | 'chat.message'
  | 'notes.write'
  | 'board.note'
  | 'board.draw'
  | 'midi.sequence'
  | 'lilypond.score';

export type OrfRisk = 'low' | 'medium' | 'high';

export type OrfCitation = {
  title?: string;
  path: string;
  source: 'course' | 'vault' | 'agent' | 'web';
  url?: string;
};

export type OrfMidiEvent = {
  durationMs: number;
  note: number;
  startMs: number;
  velocity?: number;
};

export type OrfBoardPoint = {
  action?: 'start' | 'draw' | 'end';
  x: number;
  y: number;
};

export type OrfBoardStroke = {
  color?: string;
  points: OrfBoardPoint[];
};

export type OrfAction =
  | {
      type: 'chat.message';
      markdown: string;
      roomId?: string;
    }
  | {
      type: 'notes.write';
      markdown: string;
      mode?: 'append' | 'new-note' | 'replace-selection';
      target?: 'course' | 'room' | 'personal';
      title?: string;
    }
  | {
      type: 'board.note';
      color?: string;
      roomId?: string;
      size?: 'sm' | 'lg';
      text: string;
      x: number;
      y: number;
    }
  | {
      type: 'board.draw';
      roomId?: string;
      strokes: OrfBoardStroke[];
    }
  | {
      type: 'midi.sequence';
      events: OrfMidiEvent[];
      explanation?: string;
      target: 'hyperpiano' | 'pod';
      tempo?: number;
    }
  | {
      type: 'lilypond.score';
      renderPreview?: boolean;
      source: string;
      title?: string;
    };

export type OrfResponse = {
  actions: OrfAction[];
  citations?: OrfCitation[];
  summary: string;
  warnings?: string[];
};

export type NormalizedOrfAction = OrfAction & {
  id: string;
  label: string;
  risk: OrfRisk;
};

export type NormalizedOrfResponse = {
  actions: NormalizedOrfAction[];
  citations: OrfCitation[];
  summary: string;
  warnings: string[];
};

const ensureText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const safeId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
};

const riskForAction = (type: OrfActionType): OrfRisk => {
  if (type === 'midi.sequence') return 'high';
  if (type === 'notes.write' || type === 'board.draw' || type === 'board.note' || type === 'lilypond.score') {
    return 'medium';
  }
  return 'low';
};

export const labelForOrfAction = (action: Pick<OrfAction, 'type'>): string => {
  switch (action.type) {
    case 'chat.message':
      return 'chat';
    case 'notes.write':
      return 'notas';
    case 'board.note':
      return 'pizarra texto';
    case 'board.draw':
      return 'pizarra dibujo';
    case 'midi.sequence':
      return 'hyperpiano';
    case 'lilypond.score':
      return 'lilypond';
  }
};

const normalizeMidiEvents = (value: unknown): OrfMidiEvent[] => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 128).map((item) => {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      durationMs: Math.round(clamp(record.durationMs, 40, 120000, 400)),
      note: Math.round(clamp(record.note ?? record.pitch, 0, 127, 60)),
      startMs: Math.round(clamp(record.startMs ?? record.time, 0, 120000, 0)),
      velocity: clamp(record.velocity, 0, 1, 0.72),
    };
  });
};

const normalizeBoardPoint = (value: unknown): OrfBoardPoint | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const action = record.action === 'start' || record.action === 'draw' || record.action === 'end'
    ? record.action
    : undefined;
  return {
    action,
    x: clamp(record.x, 0, 1, 0.5),
    y: clamp(record.y, 0, 1, 0.5),
  };
};

const normalizeBoardStrokes = (value: unknown): OrfBoardStroke[] => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).map((item) => {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const points = Array.isArray(record.points)
      ? record.points.map(normalizeBoardPoint).filter((point): point is OrfBoardPoint => Boolean(point)).slice(0, 200)
      : [];
    return {
      color: ensureText(record.color) || '#ffffff',
      points,
    };
  }).filter((stroke) => stroke.points.length > 0);
};

const normalizeAction = (value: unknown): OrfAction | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const type = ensureText(record.type) as OrfActionType;

  if (type === 'chat.message') {
    const markdown = ensureText(record.markdown ?? record.content ?? record.text);
    return markdown ? { type, markdown, roomId: ensureText(record.roomId) || undefined } : null;
  }

  if (type === 'notes.write') {
    const markdown = ensureText(record.markdown ?? record.content ?? record.text);
    if (!markdown) return null;
    const mode = record.mode === 'new-note' || record.mode === 'replace-selection' ? record.mode : 'append';
    const target = record.target === 'course' || record.target === 'personal' ? record.target : 'room';
    return { type, markdown, mode, target, title: ensureText(record.title) || undefined };
  }

  if (type === 'board.note') {
    const text = ensureText(record.text ?? record.markdown ?? record.content);
    if (!text) return null;
    return {
      type,
      color: ensureText(record.color) || '#ffffff',
      roomId: ensureText(record.roomId) || undefined,
      size: record.size === 'lg' ? 'lg' : 'sm',
      text,
      x: clamp(record.x, 0, 1, 0.12),
      y: clamp(record.y, 0, 1, 0.12),
    };
  }

  if (type === 'board.draw') {
    const strokes = normalizeBoardStrokes(record.strokes);
    return strokes.length ? { type, roomId: ensureText(record.roomId) || undefined, strokes } : null;
  }

  if (type === 'midi.sequence') {
    const events = normalizeMidiEvents(record.events ?? record.midiNotes);
    if (!events.length) return null;
    return {
      type,
      events,
      explanation: ensureText(record.explanation) || undefined,
      target: record.target === 'pod' ? 'pod' : 'hyperpiano',
      tempo: record.tempo === undefined ? undefined : Math.round(clamp(record.tempo, 20, 320, 96)),
    };
  }

  if (type === 'lilypond.score') {
    const source = ensureText(record.source ?? record.content);
    if (!source) return null;
    return {
      type,
      renderPreview: record.renderPreview !== false,
      source,
      title: ensureText(record.title) || undefined,
    };
  }

  return normalizeLegacyAction(record);
};

const normalizeLegacyAction = (record: Record<string, unknown>): OrfAction | null => {
  const kind = ensureText(record.kind);
  const proposal = record.proposal && typeof record.proposal === 'object'
    ? record.proposal as Record<string, unknown>
    : record;

  if (kind === 'write_to_lily_code') {
    const source = ensureText(proposal.source ?? record.content);
    return source ? { type: 'lilypond.score', source, renderPreview: true } : null;
  }
  if (kind === 'write_to_notes') {
    const markdown = ensureText(proposal.markdown ?? record.content);
    return markdown ? { type: 'notes.write', markdown, mode: 'append', target: 'room' } : null;
  }
  if (kind === 'publish_to_room_chat') {
    const markdown = ensureText(proposal.content ?? record.content);
    return markdown ? { type: 'chat.message', markdown } : null;
  }
  if (kind === 'send_midi_to_hyperpiano') {
    const events = normalizeMidiEvents(proposal.midiNotes);
    return events.length ? { type: 'midi.sequence', target: 'hyperpiano', events } : null;
  }
  return null;
};

export const normalizeOrfResponse = (value: unknown): NormalizedOrfResponse => {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const summary = ensureText(record.summary ?? record.message) || 'Preparé una respuesta de ORF.';
  const actions = Array.isArray(record.actions)
    ? record.actions.map(normalizeAction).filter((action): action is OrfAction => Boolean(action))
    : [];
  const citations = Array.isArray(record.citations)
    ? record.citations.map((item): OrfCitation | null => {
      const citation = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const path = ensureText(citation.path ?? citation.sourcePath ?? citation.url);
      if (!path) return null;
      const source = citation.source === 'web' || citation.source === 'agent' || citation.source === 'vault'
        ? citation.source
        : 'course';
      return {
        title: ensureText(citation.title) || undefined,
        path,
        source,
        url: ensureText(citation.url) || undefined,
      };
    }).filter((item): item is OrfCitation => Boolean(item))
    : [];
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.map(ensureText).filter(Boolean)
    : [];

  return {
    actions: actions.map((action) => ({
      ...action,
      id: `orf-action-${safeId()}`,
      label: labelForOrfAction(action),
      risk: riskForAction(action.type),
    })),
    citations,
    summary,
    warnings,
  };
};

export const stringifyOrfForHumans = (response: Pick<NormalizedOrfResponse, 'summary' | 'citations' | 'warnings'>) => {
  const lines = [response.summary.trim()].filter(Boolean);
  if (response.citations.length) {
    lines.push('', `Fuentes: ${response.citations.slice(0, 4).map((c) => c.title || c.path).join('; ')}`);
  }
  if (response.warnings.length) {
    lines.push('', response.warnings.slice(0, 3).map((warning) => `Aviso: ${warning}`).join('\n'));
  }
  return lines.join('\n');
};
