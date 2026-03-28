import { Track, type TrackPublication } from 'livekit-client';

import type { LayoutMode } from '../../layout-controller';
import type { ParticipantRole } from '../session';
import { hasCameraTrack } from './media';
import type { RoomParticipant } from './metadata';

export const chooseFocusParticipantIdentity = ({
  activeSpeakers,
  focusChangedAtMs,
  focusedParticipantIdentity,
  now,
  participants,
  readRole,
}: {
  activeSpeakers: RoomParticipant[];
  focusChangedAtMs: number;
  focusedParticipantIdentity: string;
  now: number;
  participants: RoomParticipant[];
  readRole: (participant: RoomParticipant) => ParticipantRole;
}) => {
  const liveSpeakers = activeSpeakers.filter(hasCameraTrack);
  if (liveSpeakers.some((participant) => participant.identity === focusedParticipantIdentity)) {
    return focusedParticipantIdentity;
  }

  if (liveSpeakers[0]) {
    if (
      focusedParticipantIdentity &&
      now - focusChangedAtMs < 1400 &&
      participants.some(
        (participant) =>
          participant.identity === focusedParticipantIdentity &&
          hasCameraTrack(participant),
      )
    ) {
      return focusedParticipantIdentity;
    }
    return liveSpeakers[0].identity;
  }

  const focusedParticipant = participants.find(
    (participant) =>
      participant.identity === focusedParticipantIdentity &&
      hasCameraTrack(participant),
  );
  if (focusedParticipant) {
    return focusedParticipant.identity;
  }

  const teacherParticipant = participants.find(
    (participant) => readRole(participant) === 'teacher' && hasCameraTrack(participant),
  );
  if (teacherParticipant) {
    return teacherParticipant.identity;
  }

  const firstParticipantWithCamera = participants.find(hasCameraTrack);
  return firstParticipantWithCamera?.identity || '';
};

export const hasActiveScreenShare = (participants: RoomParticipant[]) =>
  participants.some((participant) =>
    Array.from(participant.videoTrackPublications.values() as Iterable<TrackPublication>).some(
      (entry) => entry.track && entry.source === Track.Source.ScreenShare,
    ),
  );

export const getPresentationCircleIdentity = ({
  chooseFallbackIdentity,
  focusedParticipantIdentity,
  leaderIdentity,
  participants,
}: {
  chooseFallbackIdentity: () => string;
  focusedParticipantIdentity: string;
  leaderIdentity: string;
  participants: RoomParticipant[];
}) => {
  if (
    leaderIdentity &&
    participants.some(
      (participant) =>
        participant.identity === leaderIdentity &&
        hasCameraTrack(participant),
    )
  ) {
    return leaderIdentity;
  }

  return focusedParticipantIdentity || chooseFallbackIdentity();
};

export const resolveParticipantTargetSlot = ({
  canLeadSession,
  focusedParticipantIdentity,
  gridSlot,
  isLocalParticipant,
  layout,
  localRole,
  participant,
  presentationCircleIdentity,
  showPresentationCircle,
  studentsSlot,
  teacherSlot,
}: {
  canLeadSession: boolean;
  focusedParticipantIdentity: string;
  gridSlot: HTMLElement;
  isLocalParticipant: boolean;
  layout: LayoutMode;
  localRole: ParticipantRole;
  participant: RoomParticipant;
  presentationCircleIdentity: string;
  showPresentationCircle: boolean;
  studentsSlot: HTMLElement;
  teacherSlot: HTMLElement;
}) => {
  if (layout === 'grid') {
    return gridSlot;
  }

  const selfHiddenByCircle =
    isLocalParticipant &&
    localRole === 'teacher' &&
    canLeadSession &&
    showPresentationCircle;

  if (layout === 'teacher') {
    if (participant.identity === focusedParticipantIdentity) {
      return teacherSlot;
    }
    return selfHiddenByCircle ? null : studentsSlot;
  }

  if (layout === 'presentation') {
    if (participant.identity === presentationCircleIdentity) {
      return teacherSlot;
    }
    return selfHiddenByCircle ? null : studentsSlot;
  }

  return selfHiddenByCircle ? null : studentsSlot;
};
