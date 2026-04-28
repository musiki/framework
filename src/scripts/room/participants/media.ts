import {
  Room,
  Track,
  type TrackPublication,
} from 'livekit-client';

import { normalizeText } from '../core/normalize';
import { readParticipantName, type RoomParticipant } from './metadata';

export type ParticipantCardRefs = {
  card: HTMLElement;
  hand: HTMLElement;
  media: HTMLElement;
  name: HTMLElement;
  placeholder: HTMLElement;
  speakingIcon: HTMLElement;
};

export type ScreenCardRefs = {
  card: HTMLElement;
  media: HTMLElement;
  name: HTMLElement;
};

export type MediaMount = {
  attached?: boolean;
  cleanup?: () => void;
  element: HTMLMediaElement;
  track: Track;
  trackSid: string;
};

export type ParticipantMount = MediaMount & {
  wrapper: HTMLElement;
};

export type MountCollection = {
  participantAudioMounts: Map<string, MediaMount>;
  participantVideoMounts: Map<string, ParticipantMount>;
  screenAudioMounts: Map<string, MediaMount>;
  screenVideoMounts: Map<string, ParticipantMount>;
};

type AudioMountHandler = (
  key: string,
  track: MediaStreamTrack | null | undefined,
) => (() => void) | void;

export const createMediaElement = (track: Track, muted = false) => {
  const element = document.createElement(
    track.kind === Track.Kind.Video ? 'video' : 'audio',
  ) as HTMLMediaElement;
  element.autoplay = true;
  element.muted = muted;
  if (element instanceof HTMLVideoElement) {
    element.playsInline = true;
  }
  if (track.kind === Track.Kind.Audio) {
    element.hidden = true;
  }
  return element;
};

export const removeMount = (mount: MediaMount | ParticipantMount | undefined) => {
  if (!mount) return;
  mount.cleanup?.();
  if (mount.attached !== false) {
    mount.track.detach(mount.element);
  }
  mount.element.remove();
  if ('wrapper' in mount) {
    mount.wrapper.remove();
  }
};

export const cloneTemplate = (template: HTMLTemplateElement) => {
  const firstChild = template.content.firstElementChild;
  if (!(firstChild instanceof HTMLElement)) {
    throw new Error('Conference template is empty.');
  }
  return firstChild.cloneNode(true) as HTMLElement;
};

export const getTrackSid = (publication: TrackPublication) => normalizeText(publication.trackSid);

export const isLocalParticipant = (room: Room, participant: RoomParticipant) =>
  participant.identity === room.localParticipant.identity;

export const hasCameraTrack = (participant: RoomParticipant) =>
  Array.from(participant.videoTrackPublications.values() as Iterable<TrackPublication>).some(
    (entry) => entry.track && entry.source !== Track.Source.ScreenShare,
  );

export const syncParticipantVideo = (
  room: Room,
  participant: RoomParticipant,
  card: ParticipantCardRefs,
  mounts: MountCollection,
  options: {
    blurLocalVideo?: boolean;
    isTrackBackgroundBlurred?: (track: unknown) => boolean;
    renderBackdrop?: (options: { track?: MediaStreamTrack | null; wrapper: HTMLElement }) => void;
  } = {},
) => {
  const publication = Array.from(
    participant.videoTrackPublications.values() as Iterable<TrackPublication>,
  ).find(
    (entry) => entry.track && entry.source !== Track.Source.ScreenShare,
  );
  const identity = participant.identity;
  const existingMount = mounts.participantVideoMounts.get(identity);
  const localParticipant = isLocalParticipant(room, participant);

  if (!publication?.track) {
    removeMount(existingMount);
    mounts.participantVideoMounts.delete(identity);
    card.media.innerHTML = '';
    card.placeholder.hidden = false;
    return;
  }

  const trackSid = getTrackSid(publication);
  const trackAlreadyBlurred = options.isTrackBackgroundBlurred?.(publication.track) ?? false;
  const shouldRenderBackdrop = Boolean(options.blurLocalVideo && localParticipant && !trackAlreadyBlurred);
  const hasRenderedBackdrop = Boolean(existingMount?.wrapper.querySelector('.conference-media-backdrop'));
  if (
    existingMount &&
    existingMount.trackSid === trackSid &&
    existingMount.track === publication.track &&
    shouldRenderBackdrop === hasRenderedBackdrop &&
    existingMount.wrapper.isConnected &&
    card.media.contains(existingMount.wrapper)
  ) {
    card.placeholder.hidden = true;
    return;
  }

  removeMount(existingMount);
  card.media.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = localParticipant
    ? 'conference-media-frame conference-media-frame--local-camera'
    : 'conference-media-frame';

  if (shouldRenderBackdrop && options.renderBackdrop) {
    const backdropTrack = (
      publication.track as { mediaStreamTrack?: MediaStreamTrack | null } | undefined
    )?.mediaStreamTrack;
    options.renderBackdrop({
      track: backdropTrack,
      wrapper,
    });
  }

  const element = createMediaElement(publication.track, localParticipant);
  wrapper.appendChild(element);
  card.media.appendChild(wrapper);
  publication.track.attach(element);
  if (element instanceof HTMLVideoElement) {
    void element.play().catch(() => undefined);
  }

  mounts.participantVideoMounts.set(identity, {
    element,
    track: publication.track,
    trackSid,
    wrapper,
  });

  card.placeholder.hidden = true;
};

export const syncParticipantAudio = (
  room: Room,
  participant: RoomParticipant,
  card: ParticipantCardRefs,
  mounts: MountCollection,
  options: {
    onAudioMount?: AudioMountHandler;
  } = {},
) => {
  const identity = participant.identity;
  const identityPrefix = `${identity}:`;
  const existingKeys = Array.from(mounts.participantAudioMounts.keys()).filter((key) =>
    key.startsWith(identityPrefix),
  );

  if (isLocalParticipant(room, participant)) {
    existingKeys.forEach((key) => {
      removeMount(mounts.participantAudioMounts.get(key));
      mounts.participantAudioMounts.delete(key);
    });
    return;
  }

  const publications = Array.from(
    participant.audioTrackPublications.values() as Iterable<TrackPublication>,
  ).filter(
    (entry) => entry.track && entry.source !== Track.Source.ScreenShareAudio,
  );

  if (publications.length === 0) {
    existingKeys.forEach((key) => {
      removeMount(mounts.participantAudioMounts.get(key));
      mounts.participantAudioMounts.delete(key);
    });
    return;
  }

  const activeKeys = new Set<string>();

  publications.forEach((publication) => {
    if (!publication.track) return;
    const trackSid = getTrackSid(publication);
    const mountKey = `${identity}:${trackSid || publication.source || 'audio'}`;
    activeKeys.add(mountKey);
    const existingMount = mounts.participantAudioMounts.get(mountKey);
    if (existingMount && existingMount.trackSid === trackSid && existingMount.track === publication.track) {
      return;
    }

    removeMount(existingMount);

    const element = createMediaElement(publication.track, true);
    card.card.appendChild(element);
    publication.track.attach(element);
    void element.play().catch(() => undefined);

    const mediaStreamTrack = (
      publication.track as { mediaStreamTrack?: MediaStreamTrack | null } | undefined
    )?.mediaStreamTrack;
    const mixerKey = `participant:${mountKey}`;
    const cleanupAudioMount = options.onAudioMount?.(mixerKey, mediaStreamTrack);

    mounts.participantAudioMounts.set(mountKey, {
      attached: true,
      cleanup: typeof cleanupAudioMount === 'function' ? cleanupAudioMount : undefined,
      element,
      track: publication.track,
      trackSid,
    });
  });

  existingKeys.forEach((key) => {
    if (activeKeys.has(key)) return;
    removeMount(mounts.participantAudioMounts.get(key));
    mounts.participantAudioMounts.delete(key);
  });
};

export const syncScreenVideo = (
  participant: RoomParticipant,
  screenSlot: HTMLElement,
  screenTemplate: HTMLTemplateElement,
  screenCards: Map<string, ScreenCardRefs>,
  mounts: MountCollection,
) => {
  const identity = participant.identity;
  const publication = Array.from(
    participant.videoTrackPublications.values() as Iterable<TrackPublication>,
  ).find(
    (entry) => entry.track && entry.source === Track.Source.ScreenShare,
  );
  const existingMount = mounts.screenVideoMounts.get(identity);

  if (!publication?.track) {
    removeMount(existingMount);
    mounts.screenVideoMounts.delete(identity);
    const screenCard = screenCards.get(identity);
    if (screenCard) {
      removeMount(mounts.screenAudioMounts.get(identity));
      mounts.screenAudioMounts.delete(identity);
      screenCard.card.remove();
      screenCards.delete(identity);
    }
    return;
  }

  let screenCard = screenCards.get(identity);
  if (!screenCard) {
    const card = cloneTemplate(screenTemplate);
    const media = card.querySelector('[data-screen-media]');
    const name = card.querySelector('[data-screen-name]');

    if (!(media instanceof HTMLElement) || !(name instanceof HTMLElement)) {
      throw new Error('Screen card template is invalid.');
    }

    screenCard = { card, media, name };
    screenCards.set(identity, screenCard);
    screenSlot.appendChild(card);
  } else if (screenCard.card.parentElement !== screenSlot) {
    screenSlot.appendChild(screenCard.card);
  }

  screenCard.name.textContent = readParticipantName(participant);

  const trackSid = getTrackSid(publication);
  if (
    existingMount &&
    existingMount.trackSid === trackSid &&
    existingMount.track === publication.track &&
    existingMount.wrapper.isConnected &&
    screenCard.media.contains(existingMount.wrapper)
  ) {
    return;
  }

  removeMount(existingMount);
  screenCard.media.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'conference-media-frame conference-media-frame--screen';

  const element = createMediaElement(publication.track);
  wrapper.appendChild(element);
  screenCard.media.appendChild(wrapper);
  publication.track.attach(element);
  if (element instanceof HTMLVideoElement) {
    void element.play().catch(() => undefined);
  }

  mounts.screenVideoMounts.set(identity, {
    element,
    track: publication.track,
    trackSid,
    wrapper,
  });
};

export const syncScreenAudio = (
  room: Room,
  participant: RoomParticipant,
  screenCards: Map<string, ScreenCardRefs>,
  mounts: MountCollection,
  options: {
    onAudioMount?: AudioMountHandler;
  } = {},
) => {
  const identity = participant.identity;
  const existingMount = mounts.screenAudioMounts.get(identity);
  const screenCard = screenCards.get(identity);

  if (!screenCard || isLocalParticipant(room, participant)) {
    removeMount(existingMount);
    mounts.screenAudioMounts.delete(identity);
    return;
  }

  const publication = Array.from(
    participant.audioTrackPublications.values() as Iterable<TrackPublication>,
  ).find(
    (entry) => entry.track && entry.source === Track.Source.ScreenShareAudio,
  );

  if (!publication?.track) {
    removeMount(existingMount);
    mounts.screenAudioMounts.delete(identity);
    return;
  }

  const trackSid = getTrackSid(publication);
  if (existingMount && existingMount.trackSid === trackSid && existingMount.track === publication.track) {
    return;
  }

  removeMount(existingMount);

  const element = createMediaElement(publication.track, true);
  screenCard.card.appendChild(element);
  publication.track.attach(element);
  void element.play().catch(() => undefined);

  const mediaStreamTrack = (
    publication.track as { mediaStreamTrack?: MediaStreamTrack | null } | undefined
  )?.mediaStreamTrack;
  const mixerKey = `screen:${identity}`;
  const cleanupAudioMount = options.onAudioMount?.(mixerKey, mediaStreamTrack);

  mounts.screenAudioMounts.set(identity, {
    attached: true,
    cleanup: typeof cleanupAudioMount === 'function' ? cleanupAudioMount : undefined,
    element,
    track: publication.track,
    trackSid,
  });
};
