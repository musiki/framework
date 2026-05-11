export {
  readParticipantHandRaisedFromMetadata,
  readParticipantMetadata,
  readParticipantName,
  readParticipantPreviewZoom,
  readParticipantRole,
  readParticipantShowCircle,
} from './metadata';

export {
  cloneTemplate,
  createMediaElement,
  getTrackSid,
  hasCameraTrack,
  isLocalParticipant,
  removeMount,
  syncParticipantAudio,
  syncParticipantVideo,
  syncScreenAudio,
  syncScreenVideo,
} from './media';
export {
  chooseFocusParticipantIdentity,
  getPresentationCircleIdentity,
  hasActiveScreenShare,
  resolveParticipantTargetSlot,
} from './focus';
export {
  FALLBACK_PARTICIPANT_COLOR,
  LEAD_TEACHER_COLOR,
  assignParticipantAppearances,
  bindParticipantAppearance,
  normalizeParticipantAppearance,
  participantAppearanceStore,
} from './appearance';
export {
  ensureParticipantCard,
  listRoomParticipants,
  removeParticipantCards,
  renderParticipantRoster,
} from './cards';

export type {
  MediaMount,
  MountCollection,
  ParticipantCardRefs,
  ParticipantMount,
  ScreenCardRefs,
} from './media';
export type {
  ParticipantAppearance,
  ParticipantAppearanceColor,
  ParticipantAppearanceKind,
} from './appearance';
export type { RoomParticipant } from './metadata';
