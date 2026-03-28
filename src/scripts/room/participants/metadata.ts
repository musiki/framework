import type { LocalParticipant, RemoteParticipant } from 'livekit-client';

import { normalizePreviewZoom, normalizeText } from '../core/normalize';
import { normalizeRole, type ParticipantRole } from '../session';

export type RoomParticipant = LocalParticipant | RemoteParticipant;

export const readParticipantMetadata = (participant: RoomParticipant) => {
  try {
    const parsed = JSON.parse(participant.metadata || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export const readParticipantRole = ({
  localIdentity,
  localRole,
  participant,
}: {
  localIdentity: string;
  localRole: ParticipantRole;
  participant: RoomParticipant;
}): ParticipantRole => {
  const participantIdentity = normalizeText(participant.identity);
  if (participantIdentity && participantIdentity === normalizeText(localIdentity)) {
    return localRole;
  }

  const parsed = readParticipantMetadata(participant);
  const role = normalizeText(parsed?.role);
  return role
    ? normalizeRole(role)
    : participantIdentity.toLowerCase().startsWith('teacher')
      ? 'teacher'
      : 'student';
};

export const readParticipantName = (participant: RoomParticipant) =>
  normalizeText(participant.name) || normalizeText(participant.identity) || 'Participant';

export const readParticipantHandRaisedFromMetadata = (participant: RoomParticipant) =>
  Boolean(readParticipantMetadata(participant).handRaised);

export const readParticipantPreviewZoom = (participant: RoomParticipant) =>
  normalizePreviewZoom(readParticipantMetadata(participant).previewZoom, 1);

export const readParticipantShowCircle = (participant: RoomParticipant) => {
  const value = readParticipantMetadata(participant).showCircle;
  return typeof value === 'boolean' ? value : true;
};
