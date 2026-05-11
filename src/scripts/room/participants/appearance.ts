import { normalizeText } from '../core/normalize';
import type { ParticipantRole } from '../session/messages';

export type ParticipantAppearanceColor = {
  stroke: string;
  fill: string;
  text: string;
  shadow: string;
};

export type ParticipantAppearanceKind = 'lead-teacher' | 'teacher' | 'participant';

export type ParticipantAppearance = {
  assignedAt: number;
  authorityId: string;
  color: ParticipantAppearanceColor;
  kind: ParticipantAppearanceKind;
  role: ParticipantRole;
  userId: string;
};

export type ParticipantAppearanceInput = {
  identity: string;
  role: ParticipantRole;
};

export const LEAD_TEACHER_COLOR: ParticipantAppearanceColor = {
  stroke: '#39ff14',
  fill: '#0f2a12',
  text: '#ffffff',
  shadow: '0 0 8px rgba(57, 255, 20, 0.85)',
};

export const FALLBACK_PARTICIPANT_COLOR: ParticipantAppearanceColor = {
  stroke: '#14e7ff',
  fill: '#09232a',
  text: '#ffffff',
  shadow: '0 0 8px rgba(20, 231, 255, 0.72)',
};

const TEACHER_COLORS: ParticipantAppearanceColor[] = [
  {
    stroke: '#00ff7f',
    fill: '#0a2718',
    text: '#ffffff',
    shadow: '0 0 8px rgba(0, 255, 127, 0.72)',
  },
  {
    stroke: '#76ff03',
    fill: '#182606',
    text: '#ffffff',
    shadow: '0 0 8px rgba(118, 255, 3, 0.7)',
  },
  {
    stroke: '#1de9b6',
    fill: '#082923',
    text: '#ffffff',
    shadow: '0 0 8px rgba(29, 233, 182, 0.68)',
  },
  {
    stroke: '#aeea00',
    fill: '#202800',
    text: '#ffffff',
    shadow: '0 0 8px rgba(174, 234, 0, 0.68)',
  },
  {
    stroke: '#64dd17',
    fill: '#112507',
    text: '#ffffff',
    shadow: '0 0 8px rgba(100, 221, 23, 0.68)',
  },
];

const PARTICIPANT_COLORS: ParticipantAppearanceColor[] = [
  {
    stroke: '#ff2bd6',
    fill: '#2c0827',
    text: '#ffffff',
    shadow: '0 0 8px rgba(255, 43, 214, 0.7)',
  },
  {
    stroke: '#14e7ff',
    fill: '#08252c',
    text: '#ffffff',
    shadow: '0 0 8px rgba(20, 231, 255, 0.72)',
  },
  {
    stroke: '#7c4dff',
    fill: '#170d33',
    text: '#ffffff',
    shadow: '0 0 8px rgba(124, 77, 255, 0.72)',
  },
  {
    stroke: '#ff4d6d',
    fill: '#310a14',
    text: '#ffffff',
    shadow: '0 0 8px rgba(255, 77, 109, 0.72)',
  },
  {
    stroke: '#00b0ff',
    fill: '#061f30',
    text: '#ffffff',
    shadow: '0 0 8px rgba(0, 176, 255, 0.72)',
  },
  {
    stroke: '#ff7a18',
    fill: '#321707',
    text: '#ffffff',
    shadow: '0 0 8px rgba(255, 122, 24, 0.72)',
  },
  {
    stroke: '#f50057',
    fill: '#330013',
    text: '#ffffff',
    shadow: '0 0 8px rgba(245, 0, 87, 0.72)',
  },
  {
    stroke: '#40c4ff',
    fill: '#082432',
    text: '#ffffff',
    shadow: '0 0 8px rgba(64, 196, 255, 0.7)',
  },
];

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

const normalizeColor = (
  value: Partial<ParticipantAppearanceColor> | null | undefined,
  fallback: ParticipantAppearanceColor,
): ParticipantAppearanceColor => ({
  stroke: HEX_COLOR_RE.test(normalizeText(value?.stroke)) ? normalizeText(value?.stroke).toLowerCase() : fallback.stroke,
  fill: HEX_COLOR_RE.test(normalizeText(value?.fill)) ? normalizeText(value?.fill).toLowerCase() : fallback.fill,
  text: HEX_COLOR_RE.test(normalizeText(value?.text)) ? normalizeText(value?.text).toLowerCase() : fallback.text,
  shadow: normalizeText(value?.shadow) || fallback.shadow,
});

const normalizeKind = (value: unknown): ParticipantAppearanceKind => {
  const normalized = normalizeText(value);
  if (normalized === 'lead-teacher' || normalized === 'teacher') return normalized;
  return 'participant';
};

export const normalizeParticipantAppearance = (value: unknown): ParticipantAppearance | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ParticipantAppearance>;
  const userId = normalizeText(candidate.userId);
  const authorityId = normalizeText(candidate.authorityId);
  const kind = normalizeKind(candidate.kind);
  const fallback = kind === 'lead-teacher'
    ? LEAD_TEACHER_COLOR
    : kind === 'teacher'
      ? TEACHER_COLORS[0]
      : FALLBACK_PARTICIPANT_COLOR;

  if (!userId || !authorityId) return null;

  return {
    assignedAt: Math.max(0, Number(candidate.assignedAt) || Date.now()),
    authorityId,
    color: normalizeColor(candidate.color, fallback),
    kind,
    role: candidate.role === 'teacher' || candidate.role === 'admin' || candidate.role === 'external'
      ? candidate.role
      : 'student',
    userId,
  };
};

class ParticipantAppearanceStore {
  private appearances = new Map<string, ParticipantAppearance>();
  private listeners = new Map<string, Set<(appearance: ParticipantAppearance | null) => void>>();

  get(userId: string) {
    return this.appearances.get(normalizeText(userId)) ?? null;
  }

  list() {
    return Array.from(this.appearances.values()).sort((left, right) => left.userId.localeCompare(right.userId));
  }

  apply(appearance: ParticipantAppearance) {
    const normalized = normalizeParticipantAppearance(appearance);
    if (!normalized) return false;

    const previous = this.appearances.get(normalized.userId);
    if (previous && JSON.stringify(previous) === JSON.stringify(normalized)) {
      return false;
    }

    this.appearances.set(normalized.userId, normalized);
    this.emit(normalized.userId);
    return true;
  }

  applySnapshot(appearances: ParticipantAppearance[]) {
    let changed = false;
    appearances.forEach((appearance) => {
      changed = this.apply(appearance) || changed;
    });
    return changed;
  }

  subscribe(userId: string, listener: (appearance: ParticipantAppearance | null) => void) {
    const normalizedUserId = normalizeText(userId);
    if (!normalizedUserId) return () => {};
    const listeners = this.listeners.get(normalizedUserId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(normalizedUserId, listeners);
    listener(this.get(normalizedUserId));
    return () => {
      const current = this.listeners.get(normalizedUserId);
      current?.delete(listener);
      if (current && current.size === 0) this.listeners.delete(normalizedUserId);
    };
  }

  private emit(userId: string) {
    const appearance = this.get(userId);
    this.listeners.get(userId)?.forEach((listener) => listener(appearance));
  }
}

export const participantAppearanceStore = new ParticipantAppearanceStore();

const kindForParticipant = (
  participant: ParticipantAppearanceInput,
  leadTeacherIdentity: string,
): ParticipantAppearanceKind => {
  if (participant.role === 'teacher') {
    return participant.identity === leadTeacherIdentity ? 'lead-teacher' : 'teacher';
  }
  return 'participant';
};

const colorPoolForKind = (kind: ParticipantAppearanceKind) =>
  kind === 'teacher' ? TEACHER_COLORS : PARTICIPANT_COLORS;

const countAssignedInKind = (kind: ParticipantAppearanceKind) =>
  participantAppearanceStore.list().filter((appearance) => appearance.kind === kind).length;

const colorForKind = (kind: ParticipantAppearanceKind, existing?: ParticipantAppearance | null) => {
  if (kind === 'lead-teacher') return LEAD_TEACHER_COLOR;
  if (existing && existing.kind === kind) return existing.color;
  const pool = colorPoolForKind(kind);
  return pool[countAssignedInKind(kind) % pool.length] ?? FALLBACK_PARTICIPANT_COLOR;
};

export const assignParticipantAppearances = ({
  authorityId,
  leadTeacherIdentity,
  participants,
}: {
  authorityId: string;
  leadTeacherIdentity: string;
  participants: ParticipantAppearanceInput[];
}) => {
  const normalizedAuthorityId = normalizeText(authorityId);
  if (!normalizedAuthorityId) return [];

  const assigned: ParticipantAppearance[] = [];
  participants.forEach((participant) => {
    const userId = normalizeText(participant.identity);
    if (!userId) return;

    const kind = kindForParticipant({ ...participant, identity: userId }, normalizeText(leadTeacherIdentity));
    const existing = participantAppearanceStore.get(userId);
    const next: ParticipantAppearance = {
      assignedAt: existing?.assignedAt || Date.now(),
      authorityId: normalizedAuthorityId,
      color: colorForKind(kind, existing),
      kind,
      role: participant.role,
      userId,
    };

    if (participantAppearanceStore.apply(next)) {
      assigned.push(next);
    }
  });

  return assigned;
};

export const bindParticipantAppearance = (
  userId: string,
  apply: (appearance: ParticipantAppearance | null) => void,
) => participantAppearanceStore.subscribe(userId, apply);
