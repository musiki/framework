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
  const topLiveSpeaker = liveSpeakers[0];

  if (topLiveSpeaker?.identity === focusedParticipantIdentity) {
    return focusedParticipantIdentity;
  }

  if (topLiveSpeaker) {
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
    return topLiveSpeaker.identity;
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

const isUsableSlot = (slot: HTMLElement | null | undefined) => {
  if (!(slot instanceof HTMLElement)) return false;
  if (!slot.isConnected || slot.closest('#musiki-pod-templates')) return false;
  if (slot.hidden || slot.getAttribute('aria-hidden') === 'true') return false;

  const style = window.getComputedStyle(slot);
  return style.display !== 'none' && style.visibility !== 'hidden';
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
  circleSlot,
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
  circleSlot: HTMLElement | null;
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
  const usableTeacherSlot = isUsableSlot(teacherSlot) ? teacherSlot : null;
  const usableGridSlot = isUsableSlot(gridSlot) ? gridSlot : null;
  const usableStudentsSlot = isUsableSlot(studentsSlot) ? studentsSlot : null;
  const secondarySlot = usableStudentsSlot ?? usableGridSlot;

  if (showPresentationCircle && circleSlot && participant.identity === presentationCircleIdentity) {
    return isUsableSlot(circleSlot) ? circleSlot : usableTeacherSlot ?? usableGridSlot ?? secondarySlot;
  }

  if (layout === 'grid') {
    return usableGridSlot ?? secondarySlot ?? usableTeacherSlot;
  }

  const selfHiddenByCircle =
    isLocalParticipant &&
    localRole === 'teacher' &&
    canLeadSession &&
    showPresentationCircle;

  if (layout === 'teacher') {
    if (participant.identity === focusedParticipantIdentity) {
      return usableTeacherSlot ?? usableGridSlot ?? secondarySlot;
    }
    return selfHiddenByCircle ? null : secondarySlot;
  }

  if (layout === 'presentation') {
    if (participant.identity === focusedParticipantIdentity) {
      return usableTeacherSlot ?? usableGridSlot ?? secondarySlot;
    }
    return selfHiddenByCircle ? null : secondarySlot;
  }

  return selfHiddenByCircle ? null : secondarySlot ?? usableTeacherSlot ?? usableGridSlot;
};
