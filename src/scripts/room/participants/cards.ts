import { ConnectionState, type Room } from 'livekit-client';

import type { ParticipantRole } from '../session';
import {
  readParticipantHandRaisedFromMetadata,
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
import {
  FALLBACK_PARTICIPANT_COLOR,
  bindParticipantAppearance,
  participantAppearanceStore,
} from './appearance';

const ROSTER_SPEAKER_DECAY_MS = 450;
const rosterLastSpeakerAt = new Map<string, number>();

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
    const speakingIcon = node.querySelector('[data-card-speaking-icon]');

    if (
      !(media instanceof HTMLElement) ||
      !(name instanceof HTMLElement) ||
      !(placeholder instanceof HTMLElement) ||
      !(hand instanceof HTMLElement) ||
      !(speakingIcon instanceof HTMLElement)
    ) {
      throw new Error('Participant card template is invalid.');
    }

    card = {
      card: node,
      hand,
      media,
      name,
      placeholder,
      speakingIcon,
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
  card.card.dataset.identity = identity;
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
      const leftCam = left.isCameraEnabled;
      const rightCam = right.isCameraEnabled;
      if (leftCam !== rightCam) return leftCam ? -1 : 1;

      const leftRole = readRole(left);
      const rightRole = readRole(right);
      if (leftRole !== rightRole) return leftRole === 'teacher' ? -1 : 1;
      return readParticipantName(left).localeCompare(readParticipantName(right), 'es');
    })
    .forEach((participant) => {
      const item = document.createElement('li');
      item.className = 'conference-roster-item';
      const role = readRole(participant);
      const isLocal = isLocalParticipant(room, participant);
      const isHandRaised = readParticipantHandRaisedFromMetadata(participant);
      const isSpeaking = room.activeSpeakers.some((s) => s.identity === participant.identity);
      const now = Date.now();
      if (isSpeaking) rosterLastSpeakerAt.set(participant.identity, now);
      const isSpeakingRecently = participant.isMicrophoneEnabled &&
        now - (rosterLastSpeakerAt.get(participant.identity) ?? 0) < ROSTER_SPEAKER_DECAY_MS;

      item.dataset.identity = participant.identity;
      item.dataset.role = role;
      if (isSpeaking) item.dataset.speaking = 'true';
      if (isHandRaised) item.dataset.handRaised = 'true';

      const mainRow = document.createElement('div');
      mainRow.className = 'conference-roster-item-main';

      const info = document.createElement('div');
      info.className = 'conference-roster-item-info';

      const primary = document.createElement('span');
      primary.className = 'conference-roster-name';
      primary.textContent = readParticipantName(participant);

      const colorDot = document.createElement('span');
      colorDot.className = 'roster-participant-color-dot';
      colorDot.setAttribute('aria-hidden', 'true');
      const applyColorDot = () => {
        const appearance = participantAppearanceStore.get(participant.identity);
        const color = appearance?.color ?? FALLBACK_PARTICIPANT_COLOR;
        colorDot.style.backgroundColor = color.stroke;
        colorDot.style.boxShadow = color.shadow;
      };
      applyColorDot();
      let unsubscribeColorDot = () => {};
      unsubscribeColorDot = bindParticipantAppearance(participant.identity, () => {
        if (!colorDot.isConnected) {
          unsubscribeColorDot();
          return;
        }
        applyColorDot();
      });
      
      const indicators = document.createElement('span');
      indicators.className = 'conference-roster-indicators';
      
      if (isHandRaised) {
        const hand = document.createElement('span');
        hand.className = 'conference-roster-hand';
        hand.textContent = '✋';
        hand.title = 'Mano levantada';
        indicators.appendChild(hand);
      }

      if (participant.isMicrophoneEnabled) {
        const speaker = document.createElement('span');
        speaker.className = 'conference-roster-speaker-icon';
        speaker.dataset.active = isSpeakingRecently ? 'true' : 'false';
        speaker.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-.708.707A7.476 7.476 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303l.708.707z"/><path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.483 5.483 0 0 1 11.025 8a5.483 5.483 0 0 1-1.61 3.89l.706.706z"/><path d="M8.707 11.182A4.486 4.483 0 0 0 10.025 8a4.486 4.483 0 0 0-1.318-3.182L8 5.525A3.489 3.483 0 0 1 9.025 8a3.489 3.483 0 0 1-1.025 2.475l.707.707zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06z"/></svg>';
        speaker.title = isSpeakingRecently ? 'Hablando' : 'Micrófono encendido';
        const syncSpeakerColor = () => {
          const appearance = participantAppearanceStore.get(participant.identity);
          const color = appearance?.color ?? FALLBACK_PARTICIPANT_COLOR;
          speaker.style.setProperty('--roster-speaker-active-color', color.stroke);
        };
        syncSpeakerColor();
        let unsubscribeSpeakerColor = () => {};
        unsubscribeSpeakerColor = bindParticipantAppearance(participant.identity, () => {
          if (!speaker.isConnected) {
            unsubscribeSpeakerColor();
            return;
          }
          syncSpeakerColor();
        });
        indicators.appendChild(speaker);
      }

      // Mic indicator
      if (participant.isMicrophoneEnabled) {
        const micIndicator = document.createElement('span');
        micIndicator.className = 'conference-roster-mic-icon';
        micIndicator.dataset.enabled = 'true';
        micIndicator.title = 'Micrófono encendido';
        micIndicator.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 15.5a3.5 3.5 0 0 0 3.5-3.5V7A3.5 3.5 0 1 0 8.5 7v5a3.5 3.5 0 0 0 3.5 3.5Zm-6-3a1 1 0 1 1 2 0 4 4 0 1 0 8 0 1 1 0 1 1 2 0 6 6 0 0 1-5 5.91V21h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.59A6 6 0 0 1 6 12.5Z"/></svg>';
        indicators.appendChild(micIndicator);
      }

      // Camera indicator
      if (participant.isCameraEnabled) {
        const camIndicator = document.createElement('span');
        camIndicator.className = 'conference-roster-camera-icon';
        camIndicator.dataset.enabled = 'true';
        camIndicator.title = 'Cámara encendida';
        camIndicator.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h7A2.5 2.5 0 0 1 16 7.5v1.13l2.76-1.85A1.5 1.5 0 0 1 21 8.03v7.94a1.5 1.5 0 0 1-2.24 1.25L16 15.37v1.13A2.5 2.5 0 0 1 13.5 19h-7A2.5 2.5 0 0 1 4 16.5v-9Z"/></svg>';
        indicators.appendChild(camIndicator);
      }

      info.append(colorDot, primary, indicators);

      const secondary = document.createElement('span');
      secondary.className = 'conference-roster-role';
      secondary.textContent = isLocal ? 'Vos' : '';

      mainRow.append(info);
      if (secondary.textContent) mainRow.append(secondary);
      item.appendChild(mainRow);

      // Dedicated action row for kick button (if teacher and not local)
      if (!isLocal && (role !== 'teacher' && role !== 'admin')) {
        const actionRow = document.createElement('div');
        actionRow.className = 'conference-roster-item-actions';
        item.appendChild(actionRow);
      }

      participantList.appendChild(item);
    });

  // Start a lightweight loop to update volume levels in real-time for active speaker icons
  if (!(window as any)._rosterVolumeSyncStarted) {
    (window as any)._rosterVolumeSyncStarted = true;
    const updateVolumes = () => {
      const icons = document.querySelectorAll<HTMLElement>('.conference-roster-speaker-icon');
      if (icons.length === 0) {
        (window as any)._rosterVolumeSyncStarted = false;
        return;
      }
      icons.forEach((icon) => {
        const item = icon.closest<HTMLElement>('.conference-roster-item');
        const identity = item?.dataset.identity;
        if (!identity) return;
        
        const p = room.activeSpeakers.find(s => s.identity === identity);
        const volume = p ? p.audioLevel : 0;
        icon.style.setProperty('--roster-speaker-volume', volume.toFixed(3));
        
        const isSpeaking = volume > 0.015;
        const now = Date.now();
        if (isSpeaking) {
          rosterLastSpeakerAt.set(identity, now);
        }
        const isSpeakingRecently = (now - (rosterLastSpeakerAt.get(identity) ?? 0)) < ROSTER_SPEAKER_DECAY_MS;
        icon.dataset.active = isSpeakingRecently ? 'true' : 'false';
      });
      requestAnimationFrame(updateVolumes);
    };
    requestAnimationFrame(updateVolumes);
  }
};
