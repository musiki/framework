import { ConnectionState, type Room } from 'livekit-client';

import type { ParticipantRole } from '../session';
import {
  readParticipantName,
  readParticipantPreviewZoom,
  readParticipantShowCircle,
  type RoomParticipant,
} from './metadata';
import {
  cloneTemplate,
  isLocalParticipant,
  removeMount,
  type MountCollection,
  type ParticipantCardRefs,
  type ScreenCardRefs,
} from './media';

export const listRoomParticipants = (room: Room): RoomParticipant[] => {
  if (room.state === ConnectionState.Disconnected) return [];
  return [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
};

export const ensureParticipantCard = ({
  mounts,
  participant,
  participantCards,
  participantTemplate,
  previewZoom,
  readHandRaised,
  readRole,
  resolveTargetSlot,
  room,
  screenCards,
  showPresentationCircle,
}: {
  mounts: MountCollection;
  participant: RoomParticipant;
  participantCards: Map<string, ParticipantCardRefs>;
  participantTemplate: HTMLTemplateElement;
  previewZoom: number;
  readHandRaised: (participant: RoomParticipant) => boolean;
  readRole: (participant: RoomParticipant) => ParticipantRole;
  resolveTargetSlot: (participant: RoomParticipant) => HTMLElement | null;
  room: Room;
  screenCards: Map<string, ScreenCardRefs>;
  showPresentationCircle: boolean;
}) => {
  const identity = participant.identity;
  const role = readRole(participant);
  const targetSlot = resolveTargetSlot(participant);

  if (!(targetSlot instanceof HTMLElement)) {
    removeParticipantCards({
      identity,
      mounts,
      participantCards,
      screenCards,
    });
    return null;
  }

  let card = participantCards.get(identity);
  if (!card) {
    const node = cloneTemplate(participantTemplate);
    const media = node.querySelector('[data-card-media]');
    const name = node.querySelector('[data-card-name]');
    const placeholder = node.querySelector('[data-card-placeholder]');
    const hand = node.querySelector('[data-card-hand]');

    if (
      !(media instanceof HTMLElement) ||
      !(name instanceof HTMLElement) ||
      !(placeholder instanceof HTMLElement) ||
      !(hand instanceof HTMLElement)
    ) {
      throw new Error('Participant card template is invalid.');
    }

    card = {
      card: node,
      hand,
      media,
      name,
      placeholder,
    };

    participantCards.set(identity, card);
    targetSlot.appendChild(node);
  } else if (card.card.parentElement !== targetSlot) {
    targetSlot.appendChild(card.card);
  }

  const participantPreviewZoom = isLocalParticipant(room, participant)
    ? previewZoom
    : readParticipantPreviewZoom(participant);
  const participantShowCircle = isLocalParticipant(room, participant)
    ? showPresentationCircle
    : readParticipantShowCircle(participant);
  const handRaised = readHandRaised(participant);

  card.card.dataset.role = role;
  card.card.dataset.showCircle = participantShowCircle ? 'true' : 'false';
  card.card.style.setProperty(
    '--conference-participant-preview-zoom',
    participantPreviewZoom.toFixed(2),
  );
  card.name.textContent = readParticipantName(participant);
  card.hand.hidden = !handRaised;
  card.card.dataset.handRaised = handRaised ? 'true' : 'false';

  return card;
};

export const removeParticipantCards = ({
  identity,
  mounts,
  participantCards,
  screenCards,
}: {
  identity: string;
  mounts: MountCollection;
  participantCards: Map<string, ParticipantCardRefs>;
  screenCards: Map<string, ScreenCardRefs>;
}) => {
  removeMount(mounts.participantVideoMounts.get(identity));
  removeMount(mounts.screenVideoMounts.get(identity));
  removeMount(mounts.screenAudioMounts.get(identity));

  mounts.participantVideoMounts.delete(identity);
  mounts.screenVideoMounts.delete(identity);
  mounts.screenAudioMounts.delete(identity);
  Array.from(mounts.participantAudioMounts.keys())
    .filter((key) => key.startsWith(`${identity}:`))
    .forEach((key) => {
      removeMount(mounts.participantAudioMounts.get(key));
      mounts.participantAudioMounts.delete(key);
    });

  participantCards.get(identity)?.card.remove();
  participantCards.delete(identity);

  screenCards.get(identity)?.card.remove();
  screenCards.delete(identity);
};

export const renderParticipantRoster = ({
  participantList,
  participants,
  readRole,
  room,
}: {
  participantList: HTMLElement;
  participants: RoomParticipant[];
  readRole: (participant: RoomParticipant) => ParticipantRole;
  room: Room;
}) => {
  participantList.innerHTML = '';

  if (participants.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'conference-roster-empty';
    empty.textContent = 'Todavia no hay participantes en la sala.';
    participantList.appendChild(empty);
    return;
  }

  participants
    .sort((left, right) => {
      const leftRole = readRole(left);
      const rightRole = readRole(right);
      if (leftRole !== rightRole) return leftRole === 'teacher' ? -1 : 1;
      return readParticipantName(left).localeCompare(readParticipantName(right), 'es');
    })
    .forEach((participant) => {
      const item = document.createElement('li');
      item.className = 'conference-roster-item';

      const primary = document.createElement('span');
      primary.textContent = readParticipantName(participant);

      const secondary = document.createElement('span');
      const role = readRole(participant);
      secondary.textContent = `${role === 'teacher' ? 'Teacher' : 'Student'}${
        isLocalParticipant(room, participant) ? ' · You' : ''
      }`;

      item.append(primary, secondary);
      participantList.appendChild(item);
    });
};
