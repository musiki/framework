import {
  ConnectionState,
  DataPacket_Kind,
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  RoomEvent,
  RemoteTrackPublication,
  Track,
  type LocalParticipant,
  type TrackPublication,
} from 'livekit-client';

import { subscribeToLive } from '../lib/live/client.mjs';
import { formatCountdown, getRemainingMs } from '../lib/live/countdown.mjs';
import { normalizeLayoutMode, setLayout } from './layout-controller';
import { createPresentationController } from './presentation';
import { createRoomChatController } from './room/chat';
import { createClaseController } from './room/clase/controller';
import { createRoomDeviceSelectController, createRoomMicMeterController } from './room/devices';
import { createRoomNotesController } from './room/notes';
import { normalizePreviewZoom, normalizeText } from './room/core/normalize';
import { buildRoomQueryUrl } from './room/layout';
import {
  chooseFocusParticipantIdentity as chooseRoomFocusParticipantIdentity,
  cloneTemplate,
  createMediaElement,
  ensureParticipantCard as ensureRoomParticipantCard,
  getPresentationCircleIdentity as resolvePresentationCircleIdentity,
  getTrackSid,
  hasActiveScreenShare as hasParticipantScreenshare,
  isLocalParticipant,
  listRoomParticipants,
  removeMount,
  readParticipantHandRaisedFromMetadata,
  readParticipantMetadata,
  readParticipantName,
  readParticipantRole as resolveParticipantRole,
  resolveParticipantTargetSlot as resolveRoomParticipantTargetSlot,
  removeParticipantCards,
  renderParticipantRoster,
  syncParticipantAudio,
  syncParticipantVideo,
  syncScreenAudio,
  syncScreenVideo,
  type MountCollection,
  type ParticipantCardRefs,
  type ParticipantMount,
  type RoomParticipant,
  type ScreenCardRefs,
} from './room/participants';
import {
  type ExternalMediaPlaybackState,
  type ExternalMediaProvider,
  MESSAGE_TOPIC,
  REACTION_EMOJIS,
  REACTION_SHORTCUTS_BY_CODE,
  normalizeRole,
  normalizeSlideState,
  parseConferenceMessage,
  type ConferenceMessage,
  type ParticipantRole,
  type PresentationMediaState,
  type ReactionKind,
  type SlideState,
} from './room/session';

type Participant = RoomParticipant;

type LiveSnapshot = {
  active?: boolean;
  courseId?: string;
  pageSlug?: string;
  sessionId?: string;
  interactionId?: string;
  endsAt?: string | null;
  prompt?: string;
  type?: string;
    };

type LocalPreviewStreamMount = {
  cleanup?: () => Promise<void> | void;
  deviceId: string;
  element: HTMLVideoElement;
  processed: boolean;
  sourceStream?: MediaStream;
  stream: MediaStream;
  wrapper: HTMLElement;
};

type ExternalMediaSessionState = {
  currentTime: number;
  mediaId: string;
  playbackState: ExternalMediaPlaybackState;
  provider: ExternalMediaProvider;
  sourceUrl: string;
  title: string;
};

type ExternalMediaSearchResult = {
  channelTitle: string;
  mediaId: string;
  publishedAt: string;
  thumbnailUrl: string;
  title: string;
};

type BackgroundImageSearchResult = {
  imageUrl: string;
  sourceLabel: string;
  sourceUrl: string;
  thumbnailUrl: string;
  title: string;
};

type PresentationEmbeddedMediaState = PresentationMediaState;

type YouTubePlayerStateChangeEvent = {
  data: number;
  target: YouTubePlayer;
};

type YouTubePlayer = {
  destroy: () => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  getVideoData: () => { title?: string; video_id?: string };
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
};

type YouTubePlayerCtor = new (
  element: HTMLElement,
  options: {
    events?: {
      onReady?: () => void;
      onStateChange?: (event: YouTubePlayerStateChangeEvent) => void;
    };
    height?: string;
    playerVars?: Record<string, number | string>;
    videoId: string;
    width?: string;
  },
) => YouTubePlayer;

type YouTubeWindow = Window & {
  YT?: {
    Player: YouTubePlayerCtor;
    PlayerState?: Record<string, number>;
  };
  __musikiYouTubeApiPromise?: Promise<YouTubePlayerCtor>;
  onYouTubeIframeAPIReady?: () => void;
};

type WebkitDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

type WebkitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type PersistedRoomSetup = {
  handTrackEnabled?: boolean;
  handRampMs?: number;
  gravityBallEnabled?: boolean;
  gravityBallGravity?: number;
  gravityBallMirror?: boolean;
  identity?: string;
  instrumentsOpen?: boolean;
  limiterEnabled?: boolean;
  limiterRelease?: number;
  limiterThreshold?: number;
  name?: string;
  preferredAudioInputId?: string;
  preferredVideoInputId?: string;
  backgroundColor?: string;
  backgroundEffectMode?: BackgroundEffectMode;
  backgroundImageLabel?: string;
  backgroundImageUrl?: string;
  previewBlur?: boolean;
  previewInvert?: boolean;
  previewZoom?: number;
  recordingPreset?: RecordingPresetKey;
  delayFeedback?: number;
  delayMix?: number;
  delayTime?: number;
  delayTone?: number;
  reverbMix?: number;
  reverbTime?: number;
  showCircle?: boolean;
  compressorAttack?: number;
  compressorEnabled?: boolean;
  compressorKnee?: number;
  compressorRatio?: number;
  compressorRelease?: number;
  compressorThreshold?: number;
  mixerIncomingGain?: number;
  mixerIncomingMuted?: boolean;
  mixerIncomingPan?: number;
  mixerBallGain?: number;
  mixerBallDelaySend?: number;
  mixerBallMuted?: boolean;
  mixerBallPan?: number;
  mixerBallReverbSend?: number;
  mixerMasterGain?: number;
  mixerMasterMuted?: boolean;
  mixerMasterPan?: number;
  mixerSynthGain?: number;
  mixerSynthDelaySend?: number;
  mixerSynthMuted?: boolean;
  mixerSynthPan?: number;
  mixerSynthReverbSend?: number;
  mixerIncomingDelaySend?: number;
  mixerIncomingReverbSend?: number;
  videoBypassed?: boolean;
  videoBrightness?: number;
  videoContrast?: number;
  videoLuma?: number;
  videoSaturation?: number;
  videoTint?: number;
  synthControlRanges?: Partial<Record<HandControlKey, Partial<HandControlRange>>>;
  room?: string;
  streamingProfile?: StreamingProfileKey;
  optimizeSpeaker?: boolean;
  limitGridQuality?: boolean;
};

type StreamingProfileKey = 'auto' | 'high' | 'medium' | 'low';

type BandwidthProfile = {
  fps: number;
  height: number;
  maxBitrate: number;
  width: number;
};

const BANDWIDTH_PROFILES: Record<StreamingProfileKey, BandwidthProfile> = {
  auto:   { fps: 24, height: 720,  maxBitrate: 1_200_000, width: 1280 },
  high:   { fps: 30, height: 1080, maxBitrate: 2_500_000, width: 1920 },
  medium: { fps: 24, height: 480,  maxBitrate: 800_000,   width: 854  },
  low:    { fps: 15, height: 360,  maxBitrate: 300_000,   width: 640  },
};

const getStreamingProfile = (
  role: string,
  profileKey: StreamingProfileKey = 'auto',
): BandwidthProfile => {
  if (profileKey !== 'auto') return BANDWIDTH_PROFILES[profileKey];
  return role === 'teacher' ? BANDWIDTH_PROFILES.high : BANDWIDTH_PROFILES.medium;
};

type VideoTrackProcessorLike = {
  destroy: () => Promise<void>;
  init: (opts: {
    element?: HTMLMediaElement;
    kind: Track.Kind.Video;
    track: MediaStreamTrack;
  }) => Promise<void>;
  name: string;
  processedTrack?: MediaStreamTrack;
  restart: (opts: {
    element?: HTMLMediaElement;
    kind: Track.Kind.Video;
    track: MediaStreamTrack;
  }) => Promise<void>;
};

type LocalCameraTrackLike = {
  getProcessor?: () => { name?: string } | undefined;
  kind: Track.Kind.Video;
  setProcessor?: (
    processor: VideoTrackProcessorLike,
    showProcessedStreamLocally?: boolean,
  ) => Promise<void>;
  stopProcessor?: (keepElement?: boolean) => Promise<void>;
};

type VisionTasksModule = typeof import('@mediapipe/tasks-vision');
type ThreeModule = typeof import('three');
type VisionMask = import('@mediapipe/tasks-vision').MPMask;
type VisionHandLandmarker = InstanceType<VisionTasksModule['HandLandmarker']>;
type HandLandmarkPoint = {
  x: number;
  y: number;
  z: number;
};
type HandOverlayProjection = {
  drawHeight: number;
  drawWidth: number;
  drawX: number;
  drawY: number;
  height: number;
  width: number;
};
type GravityBallHandPoint = {
  index: number;
  radius: number;
  vx: number;
  vy: number;
  x: number;
  y: number;
};
type GravityBallGrabAnchor = {
  span: number;
  vx: number;
  vy: number;
  x: number;
  y: number;
};
type GravityBallHandState = {
  anchor: GravityBallGrabAnchor | null;
  canGrab: boolean;
  points: GravityBallHandPoint[] | null;
};
type HandSynthTelemetry = {
  carrier: number;
  cutoff: number;
  distortion: number;
  gain: number;
  modulator: number;
  resonance: number;
  waveformMorph: number;
};
type HandControlKey =
  | 'carrier'
  | 'modulator'
  | 'gain'
  | 'cutoff'
  | 'resonance'
  | 'waveformMorph'
  | 'distortion';
type HandControlRange = {
  max: number;
  min: number;
};
type HandControlValues = Record<HandControlKey, number>;
type VideoMixKey = 'brightness' | 'contrast' | 'luma' | 'saturation' | 'tint';
type VideoMixSettings = Record<VideoMixKey, number>;
type BackgroundEffectMode = 'none' | 'blur' | 'image' | 'color';
type BackgroundRgbaColor = {
  a: number;
  b: number;
  g: number;
  r: number;
};
type RecordingPresetKey = 'landscape-1080' | 'instagram-story' | 'tiktok';
type RecordingPresetConfig = {
  height: number;
  key: RecordingPresetKey;
  label: string;
  width: number;
};

const GRAVITY_BALL_LUNAR_MS2 = 1.62;
const GRAVITY_BALL_EARTH_MS2 = 9.8;
const GRAVITY_BALL_HEAVY_MS2 = 14.7;
const GRAVITY_BALL_SIM_EARTH = 0.35;
const RECORDING_PRESET_CONFIGS: Record<RecordingPresetKey, RecordingPresetConfig> = {
  'instagram-story': {
    height: 1920,
    key: 'instagram-story',
    label: 'Instagram Story',
    width: 1080,
  },
  'landscape-1080': {
    height: 1080,
    key: 'landscape-1080',
    label: '1080p',
    width: 1920,
  },
  tiktok: {
    height: 1920,
    key: 'tiktok',
    label: 'TikTok',
    width: 1080,
  },
};
const ROOM_SETUP_STORAGE_KEY = 'musiki:room:setup:v1';
const BACKGROUND_BLUR_PROCESSOR_NAME = 'musiki-background-blur';
const DEFAULT_BACKGROUND_COLOR = '#101820';
const BACKGROUND_BLUR_MODEL_ASSET =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite';
const HAND_LANDMARKER_MODEL_ASSET =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const BACKGROUND_BLUR_WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm';
const textEncoder = new TextEncoder();
let visionTasksModulePromise: Promise<VisionTasksModule> | null = null;
let visionTasksFilesetPromise: Promise<unknown> | null = null;
let threeModulePromise: Promise<ThreeModule> | null = null;
const localCameraHandOverlayState: {
  enabled: boolean;
  landmarks: HandLandmarkPoint[] | null;
} = {
  enabled: false,
  landmarks: null,
};
const localCameraProcessorState = {
  backgroundColor: DEFAULT_BACKGROUND_COLOR,
  backgroundEffectMode: 'none' as BackgroundEffectMode,
  backgroundImageUrl: '',
  blurEnabled: false,
  invertEnabled: false,
  overlayEnabled: false,
  videoMix: createNeutralVideoMix(),
};
const localCameraGravityBallStreamState: {
  canvas: HTMLCanvasElement | null;
  enabled: boolean;
} = {
  canvas: null,
  enabled: false,
};

const normalizeRecordingPreset = (
  value: unknown,
  fallback: RecordingPresetKey = 'landscape-1080',
): RecordingPresetKey => {
  const normalized = normalizeText(value) as RecordingPresetKey;
  return normalized in RECORDING_PRESET_CONFIGS ? normalized : fallback;
};

const normalizeBackgroundEffectMode = (
  value: unknown,
  fallback: BackgroundEffectMode = 'none',
): BackgroundEffectMode => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'blur' || normalized === 'image' || normalized === 'color' || normalized === 'none') {
    return normalized;
  }
  return fallback;
};

const normalizeBackgroundColor = (value: unknown, fallback = DEFAULT_BACKGROUND_COLOR) => {
  const normalized = normalizeText(value);
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toUpperCase() : fallback.toUpperCase();
};

const hexToBackgroundRgba = (value: string): BackgroundRgbaColor => {
  const normalized = normalizeBackgroundColor(value, DEFAULT_BACKGROUND_COLOR).slice(1);
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return {
    a: 255,
    b,
    g,
    r,
  };
};

const canPersistBackgroundImageUrl = (value: string) => Boolean(value) && !value.startsWith('blob:');

const buildBackgroundImageProxyUrl = (value: string) => {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  return `/api/live/background-image/proxy?url=${encodeURIComponent(normalized)}`;
};

const getRecordingPresetConfig = (
  value: unknown,
  fallback: RecordingPresetKey = 'landscape-1080',
): RecordingPresetConfig => RECORDING_PRESET_CONFIGS[normalizeRecordingPreset(value, fallback)];

const getAspectFitRect = (width: number, height: number, targetAspectRatio: number) => {
  const safeWidth = Math.max(2, width);
  const safeHeight = Math.max(2, height);
  const currentAspectRatio = safeWidth / safeHeight;

  if (Math.abs(currentAspectRatio - targetAspectRatio) < 0.0001) {
    return { height: safeHeight, width: safeWidth, x: 0, y: 0 };
  }

  if (currentAspectRatio > targetAspectRatio) {
    const nextWidth = safeHeight * targetAspectRatio;
    return {
      height: safeHeight,
      width: nextWidth,
      x: (safeWidth - nextWidth) / 2,
      y: 0,
    };
  }

  const nextHeight = safeWidth / targetAspectRatio;
  return {
    height: nextHeight,
    width: safeWidth,
    x: 0,
    y: (safeHeight - nextHeight) / 2,
  };
};

const loadVisionTasksModule = () => {
  if (!visionTasksModulePromise) {
    visionTasksModulePromise = import('@mediapipe/tasks-vision');
  }
  return visionTasksModulePromise;
};

const loadVisionTasksFileset = async () => {
  if (!visionTasksFilesetPromise) {
    const vision = await loadVisionTasksModule();
    visionTasksFilesetPromise = vision.FilesetResolver.forVisionTasks(BACKGROUND_BLUR_WASM_BASE);
  }
  return visionTasksFilesetPromise;
};

const loadThreeModule = () => {
  if (!threeModulePromise) {
    threeModulePromise = import('three');
  }
  return threeModulePromise;
};

const formatRoleLabel = (role: ParticipantRole) => (role === 'teacher' ? 'Teacher' : 'Student');

const normalizeUnitValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, Math.round(parsed * 100) / 100));
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const lerp = (start: number, end: number, amount: number) => start + (end - start) * amount;
const roundTo = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const HAND_CONTROL_KEYS: HandControlKey[] = [
  'carrier',
  'modulator',
  'gain',
  'cutoff',
  'resonance',
  'waveformMorph',
  'distortion',
];

const normalizeMasterGain = (value: unknown, fallback = 0.35) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, Math.round(parsed * 100) / 100));
};

const normalizeVideoMixValue = (value: unknown, fallback = 0) =>
  clampNumber(value, -1, 1, fallback, 2);

const hasActiveVideoMix = (settings: VideoMixSettings) =>
  Object.values(settings).some((entry) => Math.abs(entry) > 0.01);

function createNeutralVideoMix(): VideoMixSettings {
  return {
    brightness: 0,
    contrast: 0,
    luma: 0,
    saturation: 0,
    tint: 0,
  };
}

const SYNTH_BASE_MASTER_GAIN = 0.35;

const clampNumber = (value: unknown, minimum: number, maximum: number, fallback: number, digits = 3) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const factor = 10 ** digits;
  return Math.round(Math.min(maximum, Math.max(minimum, parsed)) * factor) / factor;
};

const createImpulseResponseBuffer = (
  context: AudioContext,
  durationSeconds: number,
  decay: number,
) => {
  const sampleRate = context.sampleRate;
  const frameCount = Math.max(1, Math.round(sampleRate * durationSeconds));
  const buffer = context.createBuffer(2, frameCount, sampleRate);

  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const channel = buffer.getChannelData(channelIndex);
    for (let index = 0; index < frameCount; index += 1) {
      const t = index / frameCount;
      const envelope = Math.pow(1 - t, decay);
      channel[index] = (Math.random() * 2 - 1) * envelope;
    }
  }

  return buffer;
};

const formatDelayTimeLabel = (value: number) =>
  value >= 1 ? `${value.toFixed(2)}s` : `${Math.round(value * 1000)}ms`;

const formatFrequencyLabel = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}kHz` : `${Math.round(value)}Hz`;

const createDefaultHandControlRanges = (): Record<HandControlKey, HandControlRange> => ({
  carrier: { min: 0, max: 1 },
  modulator: { min: 0, max: 1 },
  gain: { min: 0, max: 1 },
  cutoff: { min: 0, max: 1 },
  resonance: { min: 0, max: 1 },
  waveformMorph: { min: 0, max: 1 },
  distortion: { min: 0, max: 1 },
});

const readPersistedHandControlRanges = (
  value: PersistedRoomSetup['synthControlRanges'],
): Record<HandControlKey, HandControlRange> => {
  const ranges = createDefaultHandControlRanges();
  if (!value || typeof value !== 'object') return ranges;

  HAND_CONTROL_KEYS.forEach((key) => {
    const nextValue = value[key];
    if (!nextValue || typeof nextValue !== 'object') return;
    ranges[key] = {
      min: clampNumber(nextValue.min, 0, 1, ranges[key].min, 3),
      max: clampNumber(nextValue.max, 0, 1, ranges[key].max, 3),
    };
  });

  return ranges;
};

const remapHandControl = (value: number, range: HandControlRange) => {
  const min = clamp01(range.min);
  const max = clamp01(range.max);
  if (Math.abs(max - min) < 0.001) return clamp01(value);
  return clamp01((value - min) / (max - min));
};

class FMSynthVoice {
  private channelGain = 1;
  private channelGainNode: GainNode | null = null;
  private channelMeterAnalyser: AnalyserNode | null = null;
  private channelMeterData: Uint8Array | null = null;
  private channelPan = 0;
  private channelPanNode: StereoPannerNode | null = null;
  private compressorAttack = 0.003;
  private compressorEnabled = true;
  private compressorKnee = 12;
  private compressorNode: DynamicsCompressorNode | null = null;
  private compressorRatio = 3;
  private compressorRelease = 0.25;
  private compressorThreshold = -18;
  private context: AudioContext | null = null;
  private carrierGains: GainNode[] = [];
  private carrierOscillators: OscillatorNode[] = [];
  private convolverNode: ConvolverNode | null = null;
  private delayFeedback = 0.38;
  private delayFeedbackNode: GainNode | null = null;
  private delayFilterNode: BiquadFilterNode | null = null;
  private delayMix = 0.32;
  private delayNode: DelayNode | null = null;
  private delaySend = 0;
  private delaySendNode: GainNode | null = null;
  private delayTone = 4200;
  private delayTime = 0.38;
  private delayReturnGainNode: GainNode | null = null;
  private dryGainNode: GainNode | null = null;
  private distortionAmount = 0;
  private distortionNode: WaveShaperNode | null = null;
  private distortionRampFrame = 0;
  private distortionRampGeneration = 0;
  private dynamicGain: GainNode | null = null;
  private filterNode: BiquadFilterNode | null = null;
  private handRampTimeSeconds = 0.5;
  private limiterEnabled = true;
  private limiterNode: DynamicsCompressorNode | null = null;
  private limiterRelease = 0.05;
  private limiterThreshold = -1;
  private masterGainNode: GainNode | null = null;
  private masterMeterAnalyser: AnalyserNode | null = null;
  private masterMeterData: Uint8Array | null = null;
  private masterPan = 0;
  private masterPanNode: StereoPannerNode | null = null;
  private modulatorDepthGains: GainNode[] = [];
  private modulatorOscillators: OscillatorNode[] = [];
  private outputDestination: MediaStreamAudioDestinationNode | null = null;
  private ready = false;
  private masterGain = 0.35;
  private reverbMix = 0.5;
  private reverbSend = 0.55;
  private reverbSendNode: GainNode | null = null;
  private reverbTime = 3;
  private wetGainNode: GainNode | null = null;
  private readonly waveformTypes: OscillatorType[] = ['sine', 'triangle', 'sawtooth', 'square'];

  private getAudioContextCtor() {
    return (
      window.AudioContext ||
      (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext ||
      null
    );
  }

  async ensureReady() {
    if (this.ready && this.context) {
      if (this.context.state !== 'running') {
        await this.context.resume().catch(() => undefined);
      }
      return;
    }

    const AudioContextCtor = this.getAudioContextCtor();
    if (!AudioContextCtor) {
      throw new Error('Web Audio is not available in this browser.');
    }

    const context = new AudioContextCtor({ sampleRate: 48_000 });
    this.context = context;

    const filterNode = context.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.frequency.value = 800;
    filterNode.Q.value = 1;

    const dynamicGain = context.createGain();
    dynamicGain.gain.value = 0;

    const channelGainNode = context.createGain();
    channelGainNode.gain.value = this.channelGain;
    const channelPanNode = context.createStereoPanner();
    channelPanNode.pan.value = this.channelPan;
    const masterGainNode = context.createGain();
    masterGainNode.gain.value = this.masterGain;
    const masterPanNode = context.createStereoPanner();
    masterPanNode.pan.value = this.masterPan;
    const channelMeterAnalyser = context.createAnalyser();
    channelMeterAnalyser.fftSize = 256;
    channelMeterAnalyser.smoothingTimeConstant = 0.86;
    const masterMeterAnalyser = context.createAnalyser();
    masterMeterAnalyser.fftSize = 256;
    masterMeterAnalyser.smoothingTimeConstant = 0.88;
    const dryGainNode = context.createGain();
    dryGainNode.gain.value = 1;
    const reverbSendNode = context.createGain();
    reverbSendNode.gain.value = this.reverbSend;
    const wetGainNode = context.createGain();
    wetGainNode.gain.value = this.reverbMix;
    const convolverNode = context.createConvolver();
    convolverNode.buffer = createImpulseResponseBuffer(context, this.reverbTime, 2.8);
    const delaySendNode = context.createGain();
    delaySendNode.gain.value = this.delaySend;
    const delayNode = context.createDelay(2);
    delayNode.delayTime.value = this.delayTime;
    const delayFeedbackNode = context.createGain();
    delayFeedbackNode.gain.value = this.delayFeedback;
    const delayFilterNode = context.createBiquadFilter();
    delayFilterNode.type = 'lowpass';
    delayFilterNode.frequency.value = this.delayTone;
    delayFilterNode.Q.value = 0.2;
    const delayReturnGainNode = context.createGain();
    delayReturnGainNode.gain.value = this.delayMix;
    const distortionNode = context.createWaveShaper();
    distortionNode.oversample = '4x';
    const compressorNode = context.createDynamicsCompressor();
    const limiterNode = context.createDynamicsCompressor();
    const outputDestination = context.createMediaStreamDestination();

    this.waveformTypes.forEach((waveformType) => {
      const carrierOscillator = context.createOscillator();
      carrierOscillator.type = waveformType;
      carrierOscillator.frequency.value = 220;

      const carrierGain = context.createGain();
      carrierGain.gain.value = waveformType === 'sine' ? 1 : 0;

      const modulatorOscillator = context.createOscillator();
      modulatorOscillator.type = waveformType;
      modulatorOscillator.frequency.value = 220;

      const modulatorDepth = context.createGain();
      modulatorDepth.gain.value = waveformType === 'sine' ? 45 : 0;

      modulatorOscillator.connect(modulatorDepth);
      modulatorDepth.connect(carrierOscillator.frequency);
      carrierOscillator.connect(carrierGain);
      carrierGain.connect(filterNode);

      carrierOscillator.start();
      modulatorOscillator.start();

      this.carrierOscillators.push(carrierOscillator);
      this.carrierGains.push(carrierGain);
      this.modulatorOscillators.push(modulatorOscillator);
      this.modulatorDepthGains.push(modulatorDepth);
    });

    filterNode.connect(dynamicGain);
    dynamicGain.connect(distortionNode);
    distortionNode.connect(dryGainNode);
    distortionNode.connect(reverbSendNode);
    reverbSendNode.connect(convolverNode);
    convolverNode.connect(wetGainNode);
    distortionNode.connect(delaySendNode);
    delaySendNode.connect(delayNode);
    delayNode.connect(delayFilterNode);
    delayFilterNode.connect(delayReturnGainNode);
    delayFilterNode.connect(delayFeedbackNode);
    delayFeedbackNode.connect(delayNode);
    dryGainNode.connect(compressorNode);
    wetGainNode.connect(compressorNode);
    delayReturnGainNode.connect(compressorNode);
    compressorNode.connect(limiterNode);
    limiterNode.connect(channelGainNode);
    channelGainNode.connect(channelPanNode);
    channelPanNode.connect(channelMeterAnalyser);
    channelMeterAnalyser.connect(masterGainNode);
    masterGainNode.connect(masterPanNode);
    masterPanNode.connect(masterMeterAnalyser);
    masterMeterAnalyser.connect(context.destination);
    masterMeterAnalyser.connect(outputDestination);

    this.channelGainNode = channelGainNode;
    this.channelMeterAnalyser = channelMeterAnalyser;
    this.channelMeterData = new Uint8Array(channelMeterAnalyser.fftSize);
    this.channelPanNode = channelPanNode;
    this.compressorNode = compressorNode;
    this.convolverNode = convolverNode;
    this.delayFeedbackNode = delayFeedbackNode;
    this.delayFilterNode = delayFilterNode;
    this.delayNode = delayNode;
    this.delaySendNode = delaySendNode;
    this.delayReturnGainNode = delayReturnGainNode;
    this.dryGainNode = dryGainNode;
    this.distortionNode = distortionNode;
    this.filterNode = filterNode;
    this.dynamicGain = dynamicGain;
    this.limiterNode = limiterNode;
    this.masterGainNode = masterGainNode;
    this.masterMeterAnalyser = masterMeterAnalyser;
    this.masterMeterData = new Uint8Array(masterMeterAnalyser.fftSize);
    this.masterPanNode = masterPanNode;
    this.outputDestination = outputDestination;
    this.reverbSendNode = reverbSendNode;
    this.wetGainNode = wetGainNode;
    this.ready = true;

    this.applyReverbLevels();
    this.refreshReverbImpulse();
    this.applyDelayState();
    this.applyDistortionState();
    this.applyCompressorState();
    this.applyLimiterState();

    if (context.state !== 'running') {
      await context.resume().catch(() => undefined);
    }
  }

  private getWaveformWeights(morph: number) {
    const normalizedMorph = clamp01(morph);
    const scaled = normalizedMorph * (this.waveformTypes.length - 1);
    const baseIndex = Math.floor(scaled);
    const fraction = scaled - baseIndex;
    const weights = new Array(this.waveformTypes.length).fill(0);
    const nextIndex = Math.min(this.waveformTypes.length - 1, baseIndex + 1);

    weights[baseIndex] = 1 - fraction;
    weights[nextIndex] += fraction;

    return weights;
  }

  private makeDistortionCurve(amount: number) {
    if (!this.context) return null;
    const normalizedAmount = clamp01(amount);
    if (normalizedAmount <= 0.001) return null;

    const k = lerp(0, 400, normalizedAmount);
    const sampleCount = this.context.sampleRate || 48_000;
    const curve = new Float32Array(sampleCount);

    for (let index = 0; index < sampleCount; index += 1) {
      const x = (index * 2) / sampleCount - 1;
      curve[index] = (3 + k) * Math.atan(Math.sinh(x * 0.25) * 5) / (Math.PI + k * Math.abs(x));
    }

    return curve;
  }

  setMasterGain(value: number) {
    this.masterGain = normalizeMasterGain(value, this.masterGain);
    if (this.masterGainNode && this.context) {
      this.masterGainNode.gain.setTargetAtTime(this.masterGain, this.context.currentTime, 0.03);
    }
  }

  setChannelGain(value: number) {
    this.channelGain = normalizeMasterGain(value, this.channelGain);
    if (this.channelGainNode && this.context) {
      this.channelGainNode.gain.setTargetAtTime(this.channelGain, this.context.currentTime, 0.03);
    }
  }

  setChannelPan(value: number) {
    this.channelPan = Math.min(1, Math.max(-1, Number(value) || 0));
    if (this.channelPanNode && this.context) {
      this.channelPanNode.pan.setTargetAtTime(this.channelPan, this.context.currentTime, 0.03);
    }
  }

  setMasterPan(value: number) {
    this.masterPan = Math.min(1, Math.max(-1, Number(value) || 0));
    if (this.masterPanNode && this.context) {
      this.masterPanNode.pan.setTargetAtTime(this.masterPan, this.context.currentTime, 0.03);
    }
  }

  private applyReverbLevels() {
    if (this.dryGainNode && this.context) {
      this.dryGainNode.gain.setTargetAtTime(1, this.context.currentTime, 0.03);
    }
    if (this.reverbSendNode && this.context) {
      this.reverbSendNode.gain.setTargetAtTime(this.reverbSend, this.context.currentTime, 0.03);
    }
    if (this.wetGainNode && this.context) {
      this.wetGainNode.gain.setTargetAtTime(this.reverbMix, this.context.currentTime, 0.03);
    }
  }

  private refreshReverbImpulse() {
    if (this.convolverNode && this.context) {
      this.convolverNode.buffer = createImpulseResponseBuffer(this.context, this.reverbTime, 2.8);
    }
  }

  setReverbMix(value: number) {
    this.reverbMix = clampNumber(value, 0, 1, this.reverbMix, 2);
    this.applyReverbLevels();
  }

  setReverbSend(value: number) {
    this.reverbSend = clampNumber(value, 0, 1, this.reverbSend, 2);
    this.applyReverbLevels();
  }

  setReverbTime(value: number) {
    this.reverbTime = clampNumber(value, 0.4, 8, this.reverbTime, 2);
    this.refreshReverbImpulse();
  }

  private applyDelayState() {
    if (!this.context) return;
    if (this.delaySendNode) {
      this.delaySendNode.gain.setTargetAtTime(this.delaySend, this.context.currentTime, 0.03);
    }
    if (this.delayNode) {
      this.delayNode.delayTime.setTargetAtTime(this.delayTime, this.context.currentTime, 0.03);
    }
    if (this.delayFeedbackNode) {
      this.delayFeedbackNode.gain.setTargetAtTime(this.delayFeedback, this.context.currentTime, 0.03);
    }
    if (this.delayFilterNode) {
      this.delayFilterNode.frequency.setTargetAtTime(this.delayTone, this.context.currentTime, 0.03);
    }
    if (this.delayReturnGainNode) {
      this.delayReturnGainNode.gain.setTargetAtTime(this.delayMix, this.context.currentTime, 0.03);
    }
  }

  setDelaySend(value: number) {
    this.delaySend = clampNumber(value, 0, 1, this.delaySend, 2);
    this.applyDelayState();
  }

  setDelayTime(value: number) {
    this.delayTime = clampNumber(value, 0.05, 1.2, this.delayTime, 2);
    this.applyDelayState();
  }

  setDelayFeedback(value: number) {
    this.delayFeedback = clampNumber(value, 0, 0.95, this.delayFeedback, 2);
    this.applyDelayState();
  }

  setDelayMix(value: number) {
    this.delayMix = clampNumber(value, 0, 1, this.delayMix, 2);
    this.applyDelayState();
  }

  setDelayTone(value: number) {
    this.delayTone = clampNumber(value, 400, 8000, this.delayTone, 0);
    this.applyDelayState();
  }

  setHandRampTimeMs(value: number) {
    this.handRampTimeSeconds = clampNumber(value, 10, 4000, this.handRampTimeSeconds * 1000, 0) / 1000;
  }

  private rampAudioParam(param: AudioParam | null, target: number, durationSeconds: number) {
    if (!param || !this.context) return;
    const now = this.context.currentTime;
    const duration = Math.max(0, durationSeconds);

    if (duration <= 0.0001) {
      param.cancelScheduledValues(now);
      param.setValueAtTime(target, now);
      return;
    }

    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(now);
    } else {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
    }

    param.linearRampToValueAtTime(target, now + duration);
  }

  private applyDistortionState() {
    if (!this.distortionNode) return;
    this.distortionNode.curve = this.makeDistortionCurve(this.distortionAmount);
  }

  private stopDistortionRamp() {
    this.distortionRampGeneration += 1;
    if (this.distortionRampFrame) {
      window.cancelAnimationFrame(this.distortionRampFrame);
      this.distortionRampFrame = 0;
    }
  }

  setDistortionAmount(value: number) {
    this.distortionAmount = clampNumber(value, 0, 1, this.distortionAmount, 2);
    this.applyDistortionState();
  }

  private rampDistortionAmount(value: number, durationSeconds: number) {
    const target = clampNumber(value, 0, 1, this.distortionAmount, 2);
    const duration = Math.max(0, durationSeconds);

    this.stopDistortionRamp();

    if (duration <= 0.0001) {
      this.setDistortionAmount(target);
      return;
    }

    const start = this.distortionAmount;
    const startedAt = performance.now();
    const generation = this.distortionRampGeneration;
    const durationMs = duration * 1000;

    const step = (frameAt: number) => {
      if (generation !== this.distortionRampGeneration) return;
      const progress = clamp01((frameAt - startedAt) / durationMs);
      this.distortionAmount = roundTo(lerp(start, target, progress), 3);
      this.applyDistortionState();
      if (progress >= 1) {
        this.distortionRampFrame = 0;
        return;
      }
      this.distortionRampFrame = window.requestAnimationFrame(step);
    };

    this.distortionRampFrame = window.requestAnimationFrame(step);
  }

  private applyCompressorState() {
    if (!this.compressorNode || !this.context) return;
    const now = this.context.currentTime;
    const threshold = this.compressorEnabled ? this.compressorThreshold : 0;
    const ratio = this.compressorEnabled ? this.compressorRatio : 1;
    const attack = this.compressorEnabled ? this.compressorAttack : 0.001;
    const release = this.compressorEnabled ? this.compressorRelease : 0.05;
    const knee = this.compressorEnabled ? this.compressorKnee : 0;

    this.compressorNode.threshold.setTargetAtTime(threshold, now, 0.03);
    this.compressorNode.ratio.setTargetAtTime(ratio, now, 0.03);
    this.compressorNode.attack.setTargetAtTime(attack, now, 0.03);
    this.compressorNode.release.setTargetAtTime(release, now, 0.03);
    this.compressorNode.knee.setTargetAtTime(knee, now, 0.03);
  }

  setCompressorEnabled(value: boolean) {
    this.compressorEnabled = Boolean(value);
    this.applyCompressorState();
  }

  setCompressorThreshold(value: number) {
    this.compressorThreshold = clampNumber(value, -48, 0, this.compressorThreshold, 1);
    this.applyCompressorState();
  }

  setCompressorRatio(value: number) {
    this.compressorRatio = clampNumber(value, 1, 20, this.compressorRatio, 2);
    this.applyCompressorState();
  }

  setCompressorAttack(value: number) {
    this.compressorAttack = clampNumber(value, 0.001, 0.2, this.compressorAttack, 3);
    this.applyCompressorState();
  }

  setCompressorRelease(value: number) {
    this.compressorRelease = clampNumber(value, 0.02, 1, this.compressorRelease, 3);
    this.applyCompressorState();
  }

  setCompressorKnee(value: number) {
    this.compressorKnee = clampNumber(value, 0, 40, this.compressorKnee, 1);
    this.applyCompressorState();
  }

  private applyLimiterState() {
    if (!this.limiterNode || !this.context) return;
    const now = this.context.currentTime;
    const threshold = this.limiterEnabled ? this.limiterThreshold : 0;
    const ratio = this.limiterEnabled ? 20 : 1;
    const release = this.limiterEnabled ? this.limiterRelease : 0.05;

    this.limiterNode.threshold.setTargetAtTime(threshold, now, 0.03);
    this.limiterNode.ratio.setTargetAtTime(ratio, now, 0.03);
    this.limiterNode.attack.setTargetAtTime(0.003, now, 0.03);
    this.limiterNode.release.setTargetAtTime(release, now, 0.03);
    this.limiterNode.knee.setTargetAtTime(0, now, 0.03);
  }

  setLimiterEnabled(value: boolean) {
    this.limiterEnabled = Boolean(value);
    this.applyLimiterState();
  }

  setLimiterThreshold(value: number) {
    this.limiterThreshold = clampNumber(value, -12, 0, this.limiterThreshold, 1);
    this.applyLimiterState();
  }

  setLimiterRelease(value: number) {
    this.limiterRelease = clampNumber(value, 0.01, 0.5, this.limiterRelease, 3);
    this.applyLimiterState();
  }

  getOutputTrack() {
    return this.outputDestination?.stream.getAudioTracks()[0] || null;
  }

  private readMeterLevel(analyser: AnalyserNode | null, data: Uint8Array | null, scale = 4.6) {
    if (!analyser || !data) return 0;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let index = 0; index < data.length; index += 1) {
      const normalizedSample = (data[index] - 128) / 128;
      sum += normalizedSample * normalizedSample;
    }
    const rms = Math.sqrt(sum / data.length);
    return clamp01(rms * scale);
  }

  getMeterLevels() {
    return {
      channel: this.readMeterLevel(this.channelMeterAnalyser, this.channelMeterData),
      master: this.readMeterLevel(this.masterMeterAnalyser, this.masterMeterData),
    };
  }

  clearHand() {
    if (!this.dynamicGain || !this.context) return;
    this.rampAudioParam(this.dynamicGain.gain, 0, this.handRampTimeSeconds);
  }

  update(telemetry: HandSynthTelemetry) {
    if (
      !this.context ||
      !this.filterNode ||
      !this.dynamicGain ||
      this.carrierOscillators.length === 0 ||
      this.modulatorOscillators.length === 0
    ) {
      return;
    }

    const carrier = Math.max(20, telemetry.carrier);
    const modulatorFrequency = Math.max(20, telemetry.modulator);
    const filterCutoff = Math.max(80, telemetry.cutoff);
    const resonance = Math.max(0.5, telemetry.resonance);
    const gain = clamp01(telemetry.gain);
    const modulationDepth = Math.min(720, Math.max(18, 18 + modulatorFrequency * 0.52));
    const weights = this.getWaveformWeights(telemetry.waveformMorph);
    const ramp = this.handRampTimeSeconds;

    this.carrierOscillators.forEach((oscillator, index) => {
      this.rampAudioParam(oscillator.frequency, carrier, ramp);
      this.rampAudioParam(this.carrierGains[index]?.gain ?? null, weights[index] ?? 0, ramp);
    });

    this.modulatorOscillators.forEach((oscillator, index) => {
      this.rampAudioParam(oscillator.frequency, modulatorFrequency, ramp);
      this.rampAudioParam(
        this.modulatorDepthGains[index]?.gain ?? null,
        modulationDepth * (weights[index] ?? 0),
        ramp,
      );
    });

    this.rampAudioParam(this.filterNode.frequency, filterCutoff, ramp);
    this.rampAudioParam(this.filterNode.Q, resonance, ramp);
    this.rampAudioParam(this.dynamicGain.gain, gain * 0.32, ramp);
    this.rampDistortionAmount(telemetry.distortion, ramp);
  }

  async destroy() {
    this.stopDistortionRamp();
    this.carrierOscillators.forEach((oscillator) => {
      oscillator.stop();
      oscillator.disconnect();
    });
    this.carrierOscillators = [];
    this.carrierGains.forEach((gainNode) => gainNode.disconnect());
    this.carrierGains = [];

    this.modulatorOscillators.forEach((oscillator) => {
      oscillator.stop();
      oscillator.disconnect();
    });
    this.modulatorOscillators = [];
    this.modulatorDepthGains.forEach((gainNode) => gainNode.disconnect());
    this.modulatorDepthGains = [];

    this.dryGainNode?.disconnect();
    this.dryGainNode = null;
    this.delaySendNode?.disconnect();
    this.delaySendNode = null;
    this.delayNode?.disconnect();
    this.delayNode = null;
    this.delayFeedbackNode?.disconnect();
    this.delayFeedbackNode = null;
    this.delayFilterNode?.disconnect();
    this.delayFilterNode = null;
    this.delayReturnGainNode?.disconnect();
    this.delayReturnGainNode = null;
    this.distortionNode?.disconnect();
    this.distortionNode = null;
    this.convolverNode?.disconnect();
    this.convolverNode = null;
    this.reverbSendNode?.disconnect();
    this.reverbSendNode = null;
    this.wetGainNode?.disconnect();
    this.wetGainNode = null;
    this.compressorNode?.disconnect();
    this.compressorNode = null;
    this.channelGainNode?.disconnect();
    this.channelGainNode = null;
    this.channelPanNode?.disconnect();
    this.channelPanNode = null;
    this.filterNode?.disconnect();
    this.filterNode = null;
    this.limiterNode?.disconnect();
    this.limiterNode = null;
    this.dynamicGain?.disconnect();
    this.dynamicGain = null;
    this.masterGainNode?.disconnect();
    this.masterGainNode = null;
    this.channelMeterAnalyser?.disconnect();
    this.channelMeterAnalyser = null;
    this.channelMeterData = null;
    this.masterMeterAnalyser?.disconnect();
    this.masterMeterAnalyser = null;
    this.masterMeterData = null;
    this.masterPanNode?.disconnect();
    this.masterPanNode = null;
    this.outputDestination?.disconnect();
    this.outputDestination = null;
    this.ready = false;

    if (this.context && this.context.state !== 'closed') {
      await this.context.close().catch(() => undefined);
    }
    this.context = null;
  }
}

const readPersistedRoomSetup = (): PersistedRoomSetup => {
  try {
    const raw = window.localStorage.getItem(ROOM_SETUP_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as PersistedRoomSetup) : {};
  } catch {
    return {};
  }
};

const writePersistedRoomSetup = (nextSetup: PersistedRoomSetup) => {
  try {
    window.localStorage.setItem(ROOM_SETUP_STORAGE_KEY, JSON.stringify(nextSetup));
  } catch {
    // ignore storage failures
  }
};

const readParticipantRole = (
  room: Room,
  participant: Participant,
  localRole: ParticipantRole,
): ParticipantRole => {
  return resolveParticipantRole({
    localIdentity: room.localParticipant?.identity || '',
    localRole,
    participant,
  });
};

const connectionStateLabel = (state: ConnectionState) => {
  switch (state) {
    case ConnectionState.Connected:
      return 'Conectado';
    case ConnectionState.Connecting:
      return 'Conectando...';
    case ConnectionState.Reconnecting:
    case ConnectionState.SignalReconnecting:
      return 'Reconectando...';
    case ConnectionState.Disconnected:
    default:
      return 'Desconectado';
  }
};

const safeErrorMessage = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Unexpected LiveKit error.';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const sanitizeClientIdentity = (value: unknown) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);

const createClientGuestIdentity = () => {
  const randomSuffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `guest-${randomSuffix}`;
};

const getFirstName = (value: string) => normalizeText(value).split(/\s+/).filter(Boolean)[0] || normalizeText(value);

const normalizeCoursePathPart = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const toPresentationHrefKey = (href: string | null | undefined) => {
  const normalizedHref = normalizeText(href);
  if (!normalizedHref) return '';

  try {
    const url = new URL(normalizedHref, window.location.origin);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return normalizedHref;
  }
};

const readPresentationCoursePathSegment = (href: string | null | undefined) => {
  const normalizedHref = normalizeText(href);
  if (!normalizedHref) return '';

  try {
    const url = new URL(normalizedHref, window.location.origin);
    const parts = url.pathname
      .split('/')
      .filter(Boolean)
      .map(normalizeCoursePathPart);

    if (parts[0] === 'cursos' && parts[1] === 'slides' && parts[2]) {
      return parts[2];
    }

    if (parts[0] === 'cursos' && parts[1]) {
      return parts[1];
    }

    return '';
  } catch {
    return '';
  }
};

const readPresentationPageSlug = (href: string | null | undefined) => {
  const normalizedHref = normalizeText(href);
  if (!normalizedHref) return '';

  try {
    const url = new URL(normalizedHref, window.location.origin);
    const parts = url.pathname
      .split('/')
      .filter(Boolean)
      .map(normalizeCoursePathPart);

    if (parts[0] === 'cursos' && parts[1] === 'slides' && parts.length >= 4) {
      return [parts[2], ...parts.slice(3)].join('/');
    }

    if (parts[0] === 'cursos' && parts.length >= 3) {
      return parts.slice(1).join('/');
    }

    return '';
  } catch {
    return '';
  }
};

const formatElapsedTime = (elapsedMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
};

const buildYouTubeEmbedUrl = (mediaId: string) => {
  const normalizedMediaId = normalizeText(mediaId);
  if (!normalizedMediaId) return '';

  const embedUrl = new URL(`https://www.youtube-nocookie.com/embed/${normalizedMediaId}`);
  embedUrl.searchParams.set('enablejsapi', '1');
  embedUrl.searchParams.set('playsinline', '1');
  embedUrl.searchParams.set('rel', '0');
  embedUrl.searchParams.set('modestbranding', '1');
  embedUrl.searchParams.set('origin', window.location.origin);
  return embedUrl.toString();
};

const normalizeYouTubeMediaUrl = (rawUrl: string): { mediaId: string; sourceUrl: string } | null => {
  const normalizedUrl = normalizeText(rawUrl);
  if (!normalizedUrl) return null;

  try {
    const url = new URL(normalizedUrl, window.location.origin);
    const host = url.hostname.toLowerCase();
    const isYouTube =
      host.includes('youtube.com') ||
      host.includes('youtu.be') ||
      host.includes('youtube-nocookie.com');

    if (!isYouTube) return null;

    let mediaId = '';
    if (host.includes('youtu.be')) {
      mediaId = normalizeText(url.pathname.split('/').filter(Boolean)[0]);
    } else if (url.pathname.startsWith('/embed/')) {
      mediaId = normalizeText(url.pathname.split('/').filter(Boolean)[1]);
    } else if (url.pathname.startsWith('/shorts/')) {
      mediaId = normalizeText(url.pathname.split('/').filter(Boolean)[1]);
    } else {
      mediaId = normalizeText(url.searchParams.get('v'));
    }

    if (!mediaId) return null;

    return {
      mediaId,
      sourceUrl: buildYouTubeEmbedUrl(mediaId),
    };
  } catch {
    return null;
  }
};

const loadYouTubePlayerApi = async (): Promise<YouTubePlayerCtor> => {
  const youtubeWindow = window as YouTubeWindow;
  if (youtubeWindow.YT?.Player) return youtubeWindow.YT.Player;
  if (youtubeWindow.__musikiYouTubeApiPromise) return youtubeWindow.__musikiYouTubeApiPromise;

  youtubeWindow.__musikiYouTubeApiPromise = new Promise<YouTubePlayerCtor>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    const previousReady = youtubeWindow.onYouTubeIframeAPIReady;

    youtubeWindow.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      if (youtubeWindow.YT?.Player) {
        resolve(youtubeWindow.YT.Player);
      } else {
        reject(new Error('YouTube iframe API did not initialize.'));
      }
    };

    if (existingScript) {
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      reject(new Error('Could not load the YouTube iframe API.'));
    };
    document.head.appendChild(script);
  });

  return youtubeWindow.__musikiYouTubeApiPromise;
};

const readYouTubePlaybackState = (player: YouTubePlayer | null): ExternalMediaPlaybackState => {
  const state = Number(player?.getPlayerState?.() ?? -1);
  if (state === 1) return 'playing';
  if (state === 0) return 'ended';
  return 'paused';
};

const isPresentationMediaPlaybackState = (
  value: string,
): value is PresentationEmbeddedMediaState['playbackState'] =>
  value === 'playing' || value === 'paused' || value === 'ended';

const normalizePresentationMediaState = (
  value: Partial<PresentationEmbeddedMediaState> | null | undefined,
): PresentationEmbeddedMediaState | null => {
  if (!value || typeof value !== 'object') return null;

  const embedId = normalizeText(value.embedId);
  const mediaId = normalizeText(value.mediaId);
  const playbackState = normalizeText(value.playbackState);
  const provider = normalizeText(value.provider);

  if (!embedId || !mediaId || provider !== 'youtube' || !isPresentationMediaPlaybackState(playbackState)) {
    return null;
  }

  return {
    capturedAt: Math.max(0, Number(value.capturedAt) || Date.now()),
    currentTime: Math.max(0, Number(value.currentTime) || 0),
    embedId,
    mediaId,
    playbackState,
    provider: 'youtube',
  };
};

const isLocalCameraTrackLike = (value: unknown): value is LocalCameraTrackLike =>
  Boolean(
    value &&
      typeof value === 'object' &&
      (value as { kind?: Track.Kind }).kind === Track.Kind.Video &&
      typeof (value as { setProcessor?: unknown }).setProcessor === 'function',
  );

const isBackgroundBlurProcessorActive = (track: LocalCameraTrackLike | null | undefined) =>
  normalizeText(track?.getProcessor?.()?.name) === BACKGROUND_BLUR_PROCESSOR_NAME;

const shouldProcessLocalCameraVideo = ({
  backgroundEffectMode,
  gravityBallEnabled,
  handTrackEnabled,
  previewInvert,
  videoMix,
}: {
  backgroundEffectMode: BackgroundEffectMode;
  gravityBallEnabled: boolean;
  handTrackEnabled: boolean;
  previewInvert: boolean;
  videoMix: VideoMixSettings;
}) =>
  backgroundEffectMode !== 'none' ||
  previewInvert ||
  handTrackEnabled ||
  gravityBallEnabled ||
  hasActiveVideoMix(videoMix);

class BackgroundBlurVideoProcessor implements VideoTrackProcessorLike {
  name = BACKGROUND_BLUR_PROCESSOR_NAME;
  processedTrack?: MediaStreamTrack;

  private animationId = 0;
  private allowGpuDelegate = true;
  private backgroundCanvas: HTMLCanvasElement | null = null;
  private backgroundContext: CanvasRenderingContext2D | null = null;
  private backgroundImageElement: HTMLImageElement | null = null;
  private backgroundImageLoaded = false;
  private backgroundImageUrl = '';
  private blurCanvas: HTMLCanvasElement | null = null;
  private blurContext: CanvasRenderingContext2D | null = null;
  private cpuFallbackScheduled = false;
  private destroyed = false;
  private drawingUtils: InstanceType<VisionTasksModule['DrawingUtils']> | null = null;
  private element: HTMLVideoElement | null = null;
  private lastMask: VisionMask | null = null;
  private lastSegmentationAt = 0;
  private outputCanvas: HTMLCanvasElement | null = null;
  private outputContext: CanvasRenderingContext2D | null = null;
  private outputStream: MediaStream | null = null;
  private personMaskIndex = 0;
  private segmenterDelegate: 'CPU' | 'GPU' = 'CPU';
  private segmenter: InstanceType<VisionTasksModule['ImageSegmenter']> | null = null;
  private segmenterGpuCanvas: HTMLCanvasElement | null = null;
  private segmenterGpuContext: WebGL2RenderingContext | null = null;
  private segmenterInitPromise: Promise<void> | null = null;

  private closeMask(mask: VisionMask | null | undefined) {
    try {
      mask?.close();
    } catch {
      // ignore mask close failures
    }
  }

  private ensureSegmenterGpuBridge() {
    if (this.segmenterGpuCanvas && this.segmenterGpuContext) {
      return {
        canvas: this.segmenterGpuCanvas,
        context: this.segmenterGpuContext,
      };
    }

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      stencil: false,
    });

    if (!context) {
      return null;
    }

    this.segmenterGpuCanvas = canvas;
    this.segmenterGpuContext = context;

    return {
      canvas,
      context,
    };
  }

  private async createSegmenter() {
    const vision = await loadVisionTasksModule();
    const wasmFileset = await loadVisionTasksFileset();
    const baseOptions = {
      modelAssetPath: BACKGROUND_BLUR_MODEL_ASSET,
    };

    let lastError: unknown = null;

    const gpuBridge = this.allowGpuDelegate ? this.ensureSegmenterGpuBridge() : null;
    if (gpuBridge) {
      try {
        const segmenter = await vision.ImageSegmenter.createFromOptions(wasmFileset as never, {
          baseOptions: {
            ...baseOptions,
            delegate: 'GPU',
          },
          canvas: gpuBridge.canvas,
          outputCategoryMask: false,
          outputConfidenceMasks: true,
          runningMode: 'VIDEO',
        });
        this.segmenterDelegate = 'GPU';
        return segmenter;
      } catch (error) {
        lastError = error;
      }
    }

    try {
      const segmenter = await vision.ImageSegmenter.createFromOptions(wasmFileset as never, {
        baseOptions: {
          ...baseOptions,
          delegate: 'CPU',
        },
        outputCategoryMask: false,
        outputConfidenceMasks: true,
        runningMode: 'VIDEO',
      });

      this.segmenterDelegate = 'CPU';
      this.cpuFallbackScheduled = false;
      return segmenter;
    } catch (error) {
      lastError = error;
    }

    throw lastError instanceof Error ? lastError : new Error('Could not initialize background blur.');
  }

  private async ensureSegmenterReady() {
    if (this.segmenter || this.segmenterInitPromise || !this.outputContext) return;
    this.segmenterInitPromise = (async () => {
      const vision = await loadVisionTasksModule();
      this.segmenter = await this.createSegmenter();
      this.drawingUtils =
        this.segmenterDelegate === 'GPU' && this.segmenterGpuContext
          ? new vision.DrawingUtils(
              this.outputContext as CanvasRenderingContext2D,
              this.segmenterGpuContext,
            )
          : new vision.DrawingUtils(this.outputContext as CanvasRenderingContext2D);

      const labels: string[] = this.segmenter.getLabels?.() || [];
      const maskIndex = labels.findIndex((label) => /person|selfie|foreground/i.test(String(label)));
      this.personMaskIndex = maskIndex >= 0 ? maskIndex : Math.max(0, labels.length - 1);
    })()
      .catch(() => undefined)
      .finally(() => {
        this.segmenterInitPromise = null;
      });
    await this.segmenterInitPromise;
  }

  private ensureCanvasSize(width: number, height: number) {
    if (!this.outputCanvas || !this.blurCanvas || !this.backgroundCanvas) return;
    if (this.outputCanvas.width === width && this.outputCanvas.height === height) return;

    this.outputCanvas.width = width;
    this.outputCanvas.height = height;
    this.blurCanvas.width = width;
    this.blurCanvas.height = height;
    this.backgroundCanvas.width = width;
    this.backgroundCanvas.height = height;
    if (this.segmenterGpuCanvas) {
      this.segmenterGpuCanvas.width = width;
      this.segmenterGpuCanvas.height = height;
    }
  }

  private syncBackgroundImage(url: string) {
    if (url === this.backgroundImageUrl) {
      return;
    }

    this.backgroundImageUrl = url;
    this.backgroundImageLoaded = false;

    if (!url) {
      this.backgroundImageElement = null;
      return;
    }

    const image = new Image();
    image.decoding = 'async';
    if (!url.startsWith('blob:') && !url.startsWith('data:')) {
      image.crossOrigin = 'anonymous';
    }
    image.onload = () => {
      if (this.backgroundImageElement !== image) return;
      this.backgroundImageLoaded = true;
    };
    image.onerror = () => {
      if (this.backgroundImageElement !== image) return;
      this.backgroundImageLoaded = false;
    };
    this.backgroundImageElement = image;
    image.src = url;
  }

  private drawBackgroundImageCover(width: number, height: number) {
    if (!this.backgroundCanvas || !this.backgroundContext || !this.backgroundImageElement || !this.backgroundImageLoaded) {
      return null;
    }

    const imageWidth = Math.max(1, this.backgroundImageElement.naturalWidth || this.backgroundImageElement.width || width);
    const imageHeight = Math.max(1, this.backgroundImageElement.naturalHeight || this.backgroundImageElement.height || height);
    const scale = Math.max(width / imageWidth, height / imageHeight);
    const drawWidth = imageWidth * scale;
    const drawHeight = imageHeight * scale;
    const drawX = (width - drawWidth) * 0.5;
    const drawY = (height - drawHeight) * 0.5;

    this.backgroundContext.save();
    this.backgroundContext.setTransform(1, 0, 0, 1, 0, 0);
    this.backgroundContext.clearRect(0, 0, width, height);
    this.backgroundContext.drawImage(this.backgroundImageElement, drawX, drawY, drawWidth, drawHeight);
    this.backgroundContext.restore();

    return this.backgroundCanvas;
  }

  private getBackgroundReplacementTexture(width: number, height: number) {
    const mode = localCameraProcessorState.backgroundEffectMode;
    if (mode === 'blur') {
      return this.blurCanvas;
    }

    if (mode === 'color') {
      return hexToBackgroundRgba(localCameraProcessorState.backgroundColor);
    }

    if (mode === 'image') {
      const nextImageUrl = normalizeText(localCameraProcessorState.backgroundImageUrl);
      this.syncBackgroundImage(nextImageUrl);
      return this.drawBackgroundImageCover(width, height);
    }

    return null;
  }

  private mirrorOutput(width: number, height: number) {
    if (!this.outputCanvas || !this.outputContext || !this.blurCanvas || !this.blurContext) {
      return;
    }

    this.blurContext.save();
    this.blurContext.setTransform(1, 0, 0, 1, 0, 0);
    this.blurContext.clearRect(0, 0, width, height);
    this.blurContext.translate(width, 0);
    this.blurContext.scale(-1, 1);
    this.blurContext.drawImage(this.outputCanvas, 0, 0, width, height);
    this.blurContext.restore();

    this.outputContext.save();
    this.outputContext.setTransform(1, 0, 0, 1, 0, 0);
    this.outputContext.clearRect(0, 0, width, height);
    this.outputContext.drawImage(this.blurCanvas, 0, 0, width, height);
    this.outputContext.restore();
  }

  private applyVideoMix(width: number, height: number) {
    if (!this.outputCanvas || !this.outputContext || !this.blurContext || !hasActiveVideoMix(localCameraProcessorState.videoMix)) {
      return;
    }

    const { brightness, contrast, luma, saturation, tint } = localCameraProcessorState.videoMix;
    const brightnessFactor = Math.max(0.2, 1 + brightness * 0.8);
    const contrastFactor = Math.max(0.2, 1 + contrast * 1.1);
    const saturationFactor = Math.max(0, 1 + saturation * 1.5);
    const tintDegrees = Math.round(tint * 180);

    this.blurContext.save();
    this.blurContext.clearRect(0, 0, width, height);
    this.blurContext.filter =
      `brightness(${brightnessFactor.toFixed(3)}) ` +
      `contrast(${contrastFactor.toFixed(3)}) ` +
      `saturate(${saturationFactor.toFixed(3)}) ` +
      `hue-rotate(${tintDegrees}deg)`;
    this.blurContext.drawImage(this.outputCanvas, 0, 0, width, height);
    this.blurContext.restore();

    this.outputContext.save();
    this.outputContext.clearRect(0, 0, width, height);
    this.outputContext.drawImage(this.blurCanvas, 0, 0, width, height);
    if (Math.abs(luma) > 0.01) {
      if (luma > 0) {
        this.outputContext.globalCompositeOperation = 'screen';
        this.outputContext.fillStyle = `rgba(255, 255, 255, ${(0.2 * luma).toFixed(3)})`;
      } else {
        this.outputContext.globalCompositeOperation = 'source-over';
        this.outputContext.fillStyle = `rgba(0, 0, 0, ${(0.24 * Math.abs(luma)).toFixed(3)})`;
      }
      this.outputContext.fillRect(0, 0, width, height);
    }
    this.outputContext.restore();
  }

  private readPersonMask(result: Awaited<ReturnType<InstanceType<VisionTasksModule['ImageSegmenter']>['segmentForVideo']>>) {
    const masks = result?.confidenceMasks;
    if (!masks || masks.length === 0) {
      this.closeMask(result?.categoryMask);
      return null;
    }

    const selectedMask = masks[this.personMaskIndex] || masks[masks.length - 1] || null;
    const clonedMask = selectedMask?.clone() || null;

    masks.forEach((mask) => this.closeMask(mask));
    this.closeMask(result.categoryMask);

    return clonedMask;
  }

  private resetSegmenterState() {
    this.closeMask(this.lastMask);
    this.lastMask = null;
    this.drawingUtils?.close?.();
    this.drawingUtils = null;
    this.segmenter?.close?.();
    this.segmenter = null;
    this.segmenterInitPromise = null;
    this.lastSegmentationAt = 0;
  }

  private scheduleCpuFallback(error: unknown) {
    if (this.cpuFallbackScheduled || this.segmenterDelegate !== 'GPU') {
      return;
    }

    this.cpuFallbackScheduled = true;
    this.allowGpuDelegate = false;
    console.warn('Background blur GPU path failed, retrying on CPU.', error);
    this.resetSegmenterState();
  }

  private renderFrame = () => {
    if (
      this.destroyed ||
      !this.element ||
      !this.outputCanvas ||
      !this.outputContext ||
      !this.blurCanvas ||
      !this.blurContext
    ) {
      return;
    }

    const width = Math.max(2, Math.round(this.element.videoWidth || 0));
    const height = Math.max(2, Math.round(this.element.videoHeight || 0));
    const backgroundMode = localCameraProcessorState.backgroundEffectMode;
    const shouldProcessBackground = backgroundMode !== 'none';

    if (this.element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || width < 2 || height < 2) {
      this.animationId = window.requestAnimationFrame(this.renderFrame);
      return;
    }

    this.ensureCanvasSize(width, height);
    const now = performance.now();

    this.outputContext.clearRect(0, 0, width, height);
    if (!shouldProcessBackground) {
      this.outputContext.drawImage(this.element, 0, 0, width, height);
    } else {
      void this.ensureSegmenterReady();
      if (backgroundMode === 'blur') {
        const overscanX = Math.round(width * 0.03);
        const overscanY = Math.round(height * 0.03);
        this.blurContext.clearRect(0, 0, width, height);
        this.blurContext.save();
        this.blurContext.filter = 'blur(20px) saturate(0.92)';
        this.blurContext.drawImage(
          this.element,
          -overscanX,
          -overscanY,
          width + overscanX * 2,
          height + overscanY * 2,
        );
        this.blurContext.restore();
      }

      if (this.segmenter && now - this.lastSegmentationAt >= 80) {
        this.lastSegmentationAt = now;
        try {
          const nextResult = this.segmenter.segmentForVideo(this.element, now);
          const nextMask = this.readPersonMask(nextResult);
          if (nextMask) {
            this.closeMask(this.lastMask);
            this.lastMask = nextMask;
          }
        } catch (error) {
          this.scheduleCpuFallback(error);
          // Keep the last valid mask if a frame fails.
        }
      }

      const backgroundTexture = this.getBackgroundReplacementTexture(width, height);
      if (this.lastMask && this.drawingUtils && backgroundTexture) {
        try {
          this.drawingUtils.drawConfidenceMask(this.lastMask, backgroundTexture, this.element);
        } catch (error) {
          this.scheduleCpuFallback(error);
          this.outputContext.drawImage(this.element, 0, 0, width, height);
        }
      } else {
        this.outputContext.drawImage(this.element, 0, 0, width, height);
      }
    }

    this.applyVideoMix(width, height);

    if (localCameraProcessorState.invertEnabled) {
      this.mirrorOutput(width, height);
    }

    if (localCameraProcessorState.overlayEnabled && localCameraHandOverlayState.landmarks?.length) {
      drawStylizedHandOverlay(
        this.outputContext,
        {
          drawHeight: height,
          drawWidth: width,
          drawX: 0,
          drawY: 0,
          height,
          width,
        },
        localCameraHandOverlayState.landmarks,
        now * 0.0024,
        localCameraProcessorState.invertEnabled,
      );
    }

    if (localCameraGravityBallStreamState.enabled && localCameraGravityBallStreamState.canvas) {
      this.outputContext.drawImage(
        localCameraGravityBallStreamState.canvas,
        0,
        0,
        width,
        height,
      );
    }

    this.animationId = window.requestAnimationFrame(this.renderFrame);
  };

  async init(opts: {
    element?: HTMLMediaElement;
    kind: Track.Kind.Video;
    track: MediaStreamTrack;
  }) {
    this.destroyed = false;
    this.element =
      opts.element instanceof HTMLVideoElement
        ? opts.element
        : document.createElement('video');
    this.element.autoplay = true;
    this.element.muted = true;
    this.element.playsInline = true;
    if (!this.element.srcObject) {
      this.element.srcObject = new MediaStream([opts.track]);
    }
    this.backgroundCanvas = document.createElement('canvas');
    this.outputCanvas = document.createElement('canvas');
    this.blurCanvas = document.createElement('canvas');
    this.backgroundContext = this.backgroundCanvas.getContext('2d', { alpha: false });
    this.outputContext = this.outputCanvas.getContext('2d', { alpha: false });
    this.blurContext = this.blurCanvas.getContext('2d', { alpha: false });

    if (!this.backgroundContext || !this.outputContext || !this.blurContext) {
      throw new Error('Could not initialize background blur compositor.');
    }

    this.backgroundContext.imageSmoothingEnabled = true;
    this.backgroundContext.imageSmoothingQuality = 'high';
    this.outputContext.imageSmoothingEnabled = true;
    this.outputContext.imageSmoothingQuality = 'high';
    this.blurContext.imageSmoothingEnabled = true;
    this.blurContext.imageSmoothingQuality = 'high';

    this.outputStream = this.outputCanvas.captureStream(30);
    const processedTrack = this.outputStream.getVideoTracks()[0];
    if (!processedTrack) {
      throw new Error('Canvas captureStream returned no video track.');
    }
    this.processedTrack = processedTrack;
    if (localCameraProcessorState.backgroundEffectMode !== 'none') {
      void this.ensureSegmenterReady();
    }
    void this.element.play().catch(() => undefined);
    this.renderFrame();
  }

  async restart(opts: {
    element?: HTMLMediaElement;
    kind: Track.Kind.Video;
    track: MediaStreamTrack;
  }) {
    await this.destroy();
    await this.init(opts);
  }

  async destroy() {
    this.destroyed = true;
    if (this.animationId) {
      window.cancelAnimationFrame(this.animationId);
      this.animationId = 0;
    }

    this.resetSegmenterState();
    this.outputStream?.getTracks().forEach((track) => track.stop());
    this.outputStream = null;
    this.processedTrack = undefined;
    this.backgroundCanvas = null;
    this.backgroundContext = null;
    this.backgroundImageElement = null;
    this.backgroundImageLoaded = false;
    this.backgroundImageUrl = '';
    this.outputCanvas = null;
    this.outputContext = null;
    this.blurCanvas = null;
    this.blurContext = null;
    if (this.element) {
      this.element.pause();
      this.element.srcObject = null;
    }
    this.element = null;
    this.segmenterGpuCanvas = null;
    this.segmenterGpuContext = null;
    this.segmenterDelegate = 'CPU';
    this.cpuFallbackScheduled = false;
  }
}

const createHandLandmarker = async (): Promise<VisionHandLandmarker> => {
  const vision = await loadVisionTasksModule();
  const wasmFileset = await loadVisionTasksFileset();
  const baseOptions = {
    modelAssetPath: HAND_LANDMARKER_MODEL_ASSET,
  };

  let lastError: unknown = null;
  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      return await vision.HandLandmarker.createFromOptions(wasmFileset as never, {
        baseOptions: {
          ...baseOptions,
          delegate,
        },
        numHands: 1,
        runningMode: 'VIDEO',
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Could not initialize hand tracking.');
};

const appendBlurBackdrop = ({
  stream,
  track,
  wrapper,
}: {
  stream?: MediaStream | null;
  track?: MediaStreamTrack | null;
  wrapper: HTMLElement;
}) => {
  const sourceStream = stream || (track ? new MediaStream([track]) : null);
  if (!sourceStream) return;

  const backdrop = document.createElement('video');
  backdrop.autoplay = true;
  backdrop.muted = true;
  backdrop.playsInline = true;
  backdrop.className = 'conference-media-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.srcObject = sourceStream;

  wrapper.classList.add('conference-media-frame--with-backdrop');
  wrapper.appendChild(backdrop);
  void backdrop.play().catch(() => undefined);
};

const parseObjectPositionComponent = (value: string | undefined, fallback: number) => {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return fallback;
  if (normalized === 'left' || normalized === 'top') return 0;
  if (normalized === 'center') return 0.5;
  if (normalized === 'right' || normalized === 'bottom') return 1;
  if (normalized.endsWith('%')) {
    const parsed = Number.parseFloat(normalized);
    if (Number.isFinite(parsed)) {
      return Math.min(1, Math.max(0, parsed / 100));
    }
  }
  const parsed = Number.parseFloat(normalized);
  if (Number.isFinite(parsed)) {
    return Math.min(1, Math.max(0, parsed));
  }
  return fallback;
};

const readScaleFromTransform = (value: string | undefined) => {
  const normalized = normalizeText(value);
  if (!normalized || normalized === 'none') return 1;

  try {
    const matrix = new DOMMatrixReadOnly(normalized);
    const scaleX = Math.hypot(matrix.a, matrix.b);
    if (Number.isFinite(scaleX) && scaleX > 0) return scaleX;
  } catch {
    const match = normalized.match(/scale\(([^)]+)\)/i);
    if (match) {
      const parsed = Number.parseFloat(match[1] || '');
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }

  return 1;
};

const HAND_GODRAY_PARAMS = [
  {
    blobRadius: 0.05,
    color: [1.0, 0.26, 0.08] as const,
    decay: 0.965,
    density: 0.97,
    energy: 2,
    exposure: 0.22,
    pulseFreq: 1.2,
    weight: 0.45,
  },
  {
    blobRadius: 0.044,
    color: [0.18, 0.48, 1.0] as const,
    decay: 0.96,
    density: 0.95,
    energy: 1.7,
    exposure: 0.18,
    pulseFreq: 0.9,
    weight: 0.4,
  },
  {
    blobRadius: 0.046,
    color: [0.08, 0.95, 0.55] as const,
    decay: 0.958,
    density: 0.96,
    energy: 1.8,
    exposure: 0.2,
    pulseFreq: 1.1,
    weight: 0.42,
  },
  {
    blobRadius: 0.042,
    color: [0.88, 0.22, 0.98] as const,
    decay: 0.955,
    density: 0.94,
    energy: 1.5,
    exposure: 0.17,
    pulseFreq: 0.8,
    weight: 0.38,
  },
  {
    blobRadius: 0.038,
    color: [1.0, 0.88, 0.08] as const,
    decay: 0.952,
    density: 0.93,
    energy: 1.3,
    exposure: 0.15,
    pulseFreq: 1.3,
    weight: 0.35,
  },
] as const;

let handOverlayOccCanvas: HTMLCanvasElement | null = null;
let handOverlayOccContext: CanvasRenderingContext2D | null = null;

const getHandOverlayOccBuffer = (width: number, height: number) => {
  if (
    !handOverlayOccCanvas ||
    !handOverlayOccContext ||
    handOverlayOccCanvas.width !== width ||
    handOverlayOccCanvas.height !== height
  ) {
    handOverlayOccCanvas = document.createElement('canvas');
    handOverlayOccCanvas.width = width;
    handOverlayOccCanvas.height = height;
    handOverlayOccContext = handOverlayOccCanvas.getContext('2d');
  }

  return {
    canvas: handOverlayOccCanvas,
    context: handOverlayOccContext,
  };
};

const toRgba = (color: readonly [number, number, number], alpha: number) => {
  const [red, green, blue] = color.map((channel) =>
    Math.round(Math.min(1, Math.max(0, channel)) * 255),
  ) as [number, number, number];
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, alpha)})`;
};

const drawStylizedHandOverlay = (
  context: CanvasRenderingContext2D,
  projection: HandOverlayProjection,
  landmarks: HandLandmarkPoint[],
  pulseSeed: number,
  mirrorX = false,
) => {
  const connections = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20],
    [0, 17],
  ] as const;

  const wrist = landmarks[0];
  const middleMcp = landmarks[9] || landmarks[0];
  const palmX = ((wrist?.x ?? 0.5) + (middleMcp?.x ?? 0.5)) * 0.5;
  const palmY = ((wrist?.y ?? 0.5) + (middleMcp?.y ?? 0.5)) * 0.5;
  const unit = Math.min(projection.drawWidth, projection.drawHeight);
  const pointAt = (point: HandLandmarkPoint) => ({
    x: projection.drawX + (mirrorX ? 1 - point.x : point.x) * projection.drawWidth,
    y: projection.drawY + point.y * projection.drawHeight,
  });
  const glowColor = 'rgba(96, 214, 255, 0.86)';
  const accentColor = 'rgba(226, 248, 255, 0.92)';
  const fingerTips = [
    { base: 3, tip: 4 },
    { base: 7, tip: 8 },
    { base: 11, tip: 12 },
    { base: 15, tip: 16 },
    { base: 19, tip: 20 },
  ] as const;
  const occBuffer = getHandOverlayOccBuffer(context.canvas.width, context.canvas.height);
  const occContext = occBuffer.context;

  context.save();
  context.globalCompositeOperation = 'lighter';

  fingerTips.forEach(({ base, tip }, fingerIndex) => {
    if (!occContext) return;
    const basePoint = landmarks[base];
    const tipPoint = landmarks[tip];
    if (!basePoint || !tipPoint) return;
    const config = HAND_GODRAY_PARAMS[fingerIndex] || HAND_GODRAY_PARAMS[1];

    const start = pointAt(tipPoint);
    const from = pointAt(basePoint);
    const directionX = start.x - from.x;
    const directionY = start.y - from.y;
    const baseAngle = Math.atan2(directionY, directionX);
    const pulse = 0.7 + 0.3 * Math.sin(pulseSeed * config.pulseFreq + fingerIndex * 0.85);
    const energy = config.energy * pulse;
    const radius = unit * config.blobRadius * (0.86 + pulse * 0.24);
    const coreColor = toRgba(config.color, 0.84);
    const haloColor = toRgba(config.color, 0.38);

    occContext.clearRect(0, 0, occBuffer.canvas.width, occBuffer.canvas.height);
    occContext.save();
    occContext.globalCompositeOperation = 'source-over';
    occContext.translate(start.x, start.y);
    occContext.rotate(baseAngle);
    occContext.scale(1.16, 0.92);
    const occGradient = occContext.createRadialGradient(0, 0, 0, 0, 0, radius * 1.7);
    occGradient.addColorStop(0, toRgba(config.color, 0.96));
    occGradient.addColorStop(0.36, toRgba(config.color, 0.52));
    occGradient.addColorStop(0.7, toRgba(config.color, 0.14));
    occGradient.addColorStop(1, toRgba(config.color, 0));
    occContext.fillStyle = occGradient;
    occContext.beginPath();
    occContext.arc(0, 0, radius * 1.7, 0, Math.PI * 2);
    occContext.fill();
    occContext.restore();

    const steps = 18;
    for (let step = 0; step < steps; step += 1) {
      const progress = (step + 1) / steps;
      const scale = 1 + progress * (0.08 + config.density * 0.22);
      const alpha = config.exposure * Math.pow(config.decay, step) * config.weight * energy * 0.36;
      context.save();
      context.globalCompositeOperation = 'lighter';
      context.globalAlpha = alpha;
      context.translate(start.x, start.y);
      context.scale(scale, scale);
      context.translate(-start.x, -start.y);
      context.drawImage(occBuffer.canvas, 0, 0);
      context.restore();
    }

    context.save();
    const tipGlow = context.createRadialGradient(
      start.x,
      start.y,
      0,
      start.x,
      start.y,
      radius * 1.8,
    );
    tipGlow.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    tipGlow.addColorStop(0.18, coreColor);
    tipGlow.addColorStop(0.5, haloColor);
    tipGlow.addColorStop(1, toRgba(config.color, 0));
    context.fillStyle = tipGlow;
    context.beginPath();
    context.arc(start.x, start.y, radius * 1.8, 0, Math.PI * 2);
    context.fill();
    context.restore();
  });

  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.filter = 'blur(10px)';
  context.strokeStyle = glowColor;
  context.lineWidth = unit * 0.012;
  connections.forEach(([startIndex, endIndex]) => {
    const start = landmarks[startIndex];
    const end = landmarks[endIndex];
    if (!start || !end) return;
    const startPoint = pointAt(start);
    const endPoint = pointAt(end);
    context.beginPath();
    context.moveTo(startPoint.x, startPoint.y);
    context.lineTo(endPoint.x, endPoint.y);
    context.stroke();
  });

  context.filter = 'none';
  context.strokeStyle = accentColor;
  context.lineWidth = unit * 0.004;
  connections.forEach(([startIndex, endIndex]) => {
    const start = landmarks[startIndex];
    const end = landmarks[endIndex];
    if (!start || !end) return;
    const startPoint = pointAt(start);
    const endPoint = pointAt(end);
    context.beginPath();
    context.moveTo(startPoint.x, startPoint.y);
    context.lineTo(endPoint.x, endPoint.y);
    context.stroke();
  });

  landmarks.forEach((point, index) => {
    const pointPosition = pointAt(point);
    const isFingerTip = [4, 8, 12, 16, 20].includes(index);
    const radius = unit * (isFingerTip ? 0.02 : index === 0 || index === 9 ? 0.018 : 0.012);
    const gradient = context.createRadialGradient(
      pointPosition.x,
      pointPosition.y,
      0,
      pointPosition.x,
      pointPosition.y,
      radius,
    );
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.28, 'rgba(208, 255, 255, 0.95)');
    gradient.addColorStop(0.56, 'rgba(82, 206, 255, 0.88)');
    gradient.addColorStop(1, 'rgba(82, 206, 255, 0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(pointPosition.x, pointPosition.y, radius, 0, Math.PI * 2);
    context.fill();
  });

  context.restore();
};

const normalizeGravityBallGravity = (value: unknown, fallback = GRAVITY_BALL_EARTH_MS2) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return clampNumber(fallback, GRAVITY_BALL_LUNAR_MS2, GRAVITY_BALL_HEAVY_MS2, GRAVITY_BALL_EARTH_MS2, 2);
  }

  // Backward compatibility for old persisted normalized values like 0.35.
  if (parsed > 0 && parsed <= 1.5) {
    const converted = (parsed / GRAVITY_BALL_SIM_EARTH) * GRAVITY_BALL_EARTH_MS2;
    return clampNumber(
      converted,
      GRAVITY_BALL_LUNAR_MS2,
      GRAVITY_BALL_HEAVY_MS2,
      GRAVITY_BALL_EARTH_MS2,
      2,
    );
  }

  return clampNumber(
    parsed,
    GRAVITY_BALL_LUNAR_MS2,
    GRAVITY_BALL_HEAVY_MS2,
    clampNumber(fallback, GRAVITY_BALL_LUNAR_MS2, GRAVITY_BALL_HEAVY_MS2, GRAVITY_BALL_EARTH_MS2, 2),
    2,
  );
};

const createGravityBallMesh = () => {
  // 24×32 segments — smooth sphere, ~1 500 triangles, similar to Three.js default quality
  const latitudeSegments = 24;
  const longitudeSegments = 32;
  const positions: number[] = [];
  const normals: number[] = [];

  // For a perfect sphere the smooth normal equals the unit-sphere position.
  // Returning [x, y, z, nx, ny, nz] avoids re-computing trig in the normal step.
  const createVertex = (u: number, v: number): readonly [number, number, number, number, number, number] => {
    const theta = u * Math.PI * 2;
    const phi = v * Math.PI;
    const sinPhi = Math.sin(phi);
    const nx = Math.cos(theta) * sinPhi;
    const ny = Math.cos(phi);
    const nz = Math.sin(theta) * sinPhi;
    return [nx, ny, nz, nx, ny, nz] as const;
  };

  const pushVert = (v: readonly [number, number, number, number, number, number]) => {
    positions.push(v[0], v[1], v[2]);
    normals.push(v[3], v[4], v[5]);
  };

  for (let lat = 0; lat < latitudeSegments; lat += 1) {
    for (let lon = 0; lon < longitudeSegments; lon += 1) {
      const u0 = lon / longitudeSegments;
      const u1 = (lon + 1) / longitudeSegments;
      const v0 = lat / latitudeSegments;
      const v1 = (lat + 1) / latitudeSegments;
      const a = createVertex(u0, v0);
      const b = createVertex(u1, v0);
      const c = createVertex(u1, v1);
      const d = createVertex(u0, v1);
      // Triangle 1
      pushVert(a); pushVert(b); pushVert(c);
      // Triangle 2
      pushVert(a); pushVert(c); pushVert(d);
    }
  }

  return {
    normals: new Float32Array(normals),
    positions: new Float32Array(positions),
    vertexCount: positions.length / 3,
  };
};

class GravityBallFoley {
  private airBandpassNode: BiquadFilterNode | null = null;
  private airGainNode: GainNode | null = null;
  private airNoiseSource: AudioBufferSourceNode | null = null;
  private channelAnalyser: AnalyserNode | null = null;
  private channelMeterData: Uint8Array | null = null;
  private channelGain = 1;
  private channelGainNode: GainNode | null = null;
  private channelPan = 0;
  private channelPanNode: StereoPannerNode | null = null;
  private context: AudioContext | null = null;
  private delayFeedback = 0.38;
  private delayFeedbackNode: GainNode | null = null;
  private delayFilterNode: BiquadFilterNode | null = null;
  private delayMix = 0.32;
  private delayNode: DelayNode | null = null;
  private delaySend = 0;
  private delaySendNode: GainNode | null = null;
  private delayTone = 4200;
  private delayTime = 0.38;
  private delayReturnGainNode: GainNode | null = null;
  private initPromise: Promise<void> | null = null;
  private lastImpactAt = 0;
  private outputNode: AudioNode | null = null;
  private outputDestination: MediaStreamAudioDestinationNode | null = null;
  private reverbMix = 0.5;
  private reverbSend = 0;
  private reverbTime = 3;
  private reverbSendNode: GainNode | null = null;
  private reverbReturnGainNode: GainNode | null = null;
  private reverbConvolverNode: ConvolverNode | null = null;
  private spatialPannerNode: PannerNode | null = null;

  private async ensureReady() {
    if (this.context && this.spatialPannerNode && this.outputNode) {
      return;
    }

    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = (async () => {
      const AudioContextCtor =
        window.AudioContext ||
        (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error('AudioContext is not available in this browser.');
      }

      const context = new AudioContextCtor({ sampleRate: 48_000 });
      const spatialPannerNode = new PannerNode(context, {
        coneInnerAngle: 360,
        coneOuterAngle: 360,
        coneOuterGain: 1,
        distanceModel: 'inverse',
        maxDistance: 8,
        panningModel: 'HRTF',
        positionX: 0,
        positionY: 0,
        positionZ: 0,
        refDistance: 0.85,
        rolloffFactor: 1.6,
      });
      const channelPanNode = context.createStereoPanner();
      const channelGainNode = context.createGain();
      const channelAnalyser = context.createAnalyser();
      const outputDestination = context.createMediaStreamDestination();
      const airBandpassNode = context.createBiquadFilter();
      const airGainNode = context.createGain();
      const dryGainNode = context.createGain();
      const reverbSendNode = context.createGain();
      const reverbConvolverNode = context.createConvolver();
      const reverbReturnGainNode = context.createGain();
      const delaySendNode = context.createGain();
      const delayNode = context.createDelay(2);
      const delayFeedbackNode = context.createGain();
      const delayFilterNode = context.createBiquadFilter();
      const delayReturnGainNode = context.createGain();

      const noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const noiseData = noiseBuffer.getChannelData(0);
      for (let index = 0; index < noiseData.length; index += 1) {
        noiseData[index] = (Math.random() * 2 - 1) * 0.22;
      }
      const airNoiseSource = context.createBufferSource();
      airNoiseSource.buffer = noiseBuffer;
      airNoiseSource.loop = true;

      airBandpassNode.type = 'bandpass';
      airBandpassNode.frequency.value = 900;
      airBandpassNode.Q.value = 2.4;
      airGainNode.gain.value = 0.00001;
      dryGainNode.gain.value = 1;
      reverbSendNode.gain.value = this.reverbSend;
      reverbConvolverNode.buffer = createImpulseResponseBuffer(context, this.reverbTime, 2.8);
      reverbReturnGainNode.gain.value = this.reverbMix;
      delaySendNode.gain.value = this.delaySend;
      delayNode.delayTime.value = this.delayTime;
      delayFeedbackNode.gain.value = this.delayFeedback;
      delayFilterNode.type = 'lowpass';
      delayFilterNode.frequency.value = this.delayTone;
      delayFilterNode.Q.value = 0.2;
      delayReturnGainNode.gain.value = this.delayMix;

      airNoiseSource.connect(airBandpassNode);
      airBandpassNode.connect(airGainNode);
      airGainNode.connect(spatialPannerNode);
      spatialPannerNode.connect(dryGainNode);
      spatialPannerNode.connect(reverbSendNode);
      reverbSendNode.connect(reverbConvolverNode);
      reverbConvolverNode.connect(reverbReturnGainNode);
      spatialPannerNode.connect(delaySendNode);
      delaySendNode.connect(delayNode);
      delayNode.connect(delayFilterNode);
      delayFilterNode.connect(delayReturnGainNode);
      delayFilterNode.connect(delayFeedbackNode);
      delayFeedbackNode.connect(delayNode);
      dryGainNode.connect(channelPanNode);
      reverbReturnGainNode.connect(channelPanNode);
      delayReturnGainNode.connect(channelPanNode);
      channelPanNode.connect(channelGainNode);
      channelGainNode.connect(channelAnalyser);
      channelAnalyser.connect(context.destination);
      channelAnalyser.connect(outputDestination);
      channelAnalyser.fftSize = 256;
      channelPanNode.pan.value = this.channelPan;
      channelGainNode.gain.value = this.channelGain;

      this.spatialPannerNode = spatialPannerNode;
      this.airBandpassNode = airBandpassNode;
      this.airGainNode = airGainNode;
      this.airNoiseSource = airNoiseSource;
      this.channelPanNode = channelPanNode;
      this.channelGainNode = channelGainNode;
      this.channelAnalyser = channelAnalyser;
      this.channelMeterData = new Uint8Array(channelAnalyser.fftSize);
      this.context = context;
      this.delayFeedbackNode = delayFeedbackNode;
      this.delayFilterNode = delayFilterNode;
      this.delayNode = delayNode;
      this.delaySendNode = delaySendNode;
      this.delayReturnGainNode = delayReturnGainNode;
      this.outputNode = spatialPannerNode;
      this.outputDestination = outputDestination;
      this.reverbSendNode = reverbSendNode;
      this.reverbReturnGainNode = reverbReturnGainNode;
      this.reverbConvolverNode = reverbConvolverNode;
      airNoiseSource.start();
      this.applyReverbLevels();
      this.refreshReverbImpulse();
      this.applyDelayState();
    })().finally(() => {
      this.initPromise = null;
    });

    await this.initPromise;
  }

  async prime() {
    await this.ensureReady();
    if (this.context && this.context.state !== 'running') {
      await this.context.resume().catch(() => undefined);
    }
  }

  private updatePosition(xNorm: number, yNorm: number, zNorm: number) {
    if (!this.spatialPannerNode) return;
    const x = (clamp01(xNorm) - 0.5) * 2.6;
    const y = (0.5 - clamp01(yNorm)) * 1.8;
    const z = clampNumber(zNorm, -1, 1, 0, 3) * 2.8;
    const context = this.context;
    if (!context) return;
    this.spatialPannerNode.positionX.setValueAtTime(x, context.currentTime);
    this.spatialPannerNode.positionY.setValueAtTime(y, context.currentTime);
    this.spatialPannerNode.positionZ.setValueAtTime(z, context.currentTime);
  }

  setMotion(speedNorm: number) {
    const context = this.context;
    if (!context || !this.airGainNode || !this.airBandpassNode) return;
    const speed = clampNumber(speedNorm, 0, 1.4, 0, 3);
    const gain = speed <= 0.04 ? 0.00001 : Math.min(0.055, Math.pow(speed, 1.5) * 0.026);
    const frequency = lerp(950, 3600, clamp01(speed));
    const q = lerp(2.4, 7.2, clamp01(speed));
    this.airGainNode.gain.setTargetAtTime(gain, context.currentTime, 0.08);
    this.airBandpassNode.frequency.setTargetAtTime(frequency, context.currentTime, 0.09);
    this.airBandpassNode.Q.setTargetAtTime(q, context.currentTime, 0.1);
  }

  private applyReverbLevels() {
    if (!this.context) return;
    if (this.reverbSendNode) {
      this.reverbSendNode.gain.setTargetAtTime(this.reverbSend, this.context.currentTime, 0.03);
    }
    if (this.reverbReturnGainNode) {
      this.reverbReturnGainNode.gain.setTargetAtTime(this.reverbMix, this.context.currentTime, 0.03);
    }
  }

  private refreshReverbImpulse() {
    if (!this.context) return;
    if (this.reverbConvolverNode) {
      this.reverbConvolverNode.buffer = createImpulseResponseBuffer(this.context, this.reverbTime, 2.8);
    }
  }

  setReverbMix(value: number) {
    this.reverbMix = clampNumber(value, 0, 1, this.reverbMix, 2);
    this.applyReverbLevels();
  }

  setReverbSend(value: number) {
    this.reverbSend = clampNumber(value, 0, 1, this.reverbSend, 2);
    this.applyReverbLevels();
  }

  setReverbTime(value: number) {
    this.reverbTime = clampNumber(value, 0.4, 8, this.reverbTime, 2);
    this.refreshReverbImpulse();
  }

  private applyDelayState() {
    if (!this.context) return;
    if (this.delaySendNode) {
      this.delaySendNode.gain.setTargetAtTime(this.delaySend, this.context.currentTime, 0.03);
    }
    if (this.delayNode) {
      this.delayNode.delayTime.setTargetAtTime(this.delayTime, this.context.currentTime, 0.03);
    }
    if (this.delayFeedbackNode) {
      this.delayFeedbackNode.gain.setTargetAtTime(this.delayFeedback, this.context.currentTime, 0.03);
    }
    if (this.delayFilterNode) {
      this.delayFilterNode.frequency.setTargetAtTime(this.delayTone, this.context.currentTime, 0.03);
    }
    if (this.delayReturnGainNode) {
      this.delayReturnGainNode.gain.setTargetAtTime(this.delayMix, this.context.currentTime, 0.03);
    }
  }

  setDelaySend(value: number) {
    this.delaySend = clampNumber(value, 0, 1, this.delaySend, 2);
    this.applyDelayState();
  }

  setDelayTime(value: number) {
    this.delayTime = clampNumber(value, 0.05, 1.2, this.delayTime, 2);
    this.applyDelayState();
  }

  setDelayFeedback(value: number) {
    this.delayFeedback = clampNumber(value, 0, 0.95, this.delayFeedback, 2);
    this.applyDelayState();
  }

  setDelayMix(value: number) {
    this.delayMix = clampNumber(value, 0, 1, this.delayMix, 2);
    this.applyDelayState();
  }

  setDelayTone(value: number) {
    this.delayTone = clampNumber(value, 400, 8000, this.delayTone, 0);
    this.applyDelayState();
  }

  async playBounce(
    intensity: number,
    xNorm: number,
    yNorm: number,
    zNorm: number,
    impactSpeed = intensity,
    tangentialSpeed = 0,
  ) {
    const now = performance.now();
    const clampedIntensity = clamp01(intensity);
    if (clampedIntensity < 0.05 || now - this.lastImpactAt < 28) {
      return;
    }
    this.lastImpactAt = now;

    await this.prime();
    if (!this.context || !this.outputNode) return;

    this.updatePosition(xNorm, yNorm, zNorm);

    const context = this.context;
    const startAt = context.currentTime + 0.002;
    const duration = 0.14 + clampedIntensity * 0.14;
    const impactNorm = clamp01(impactSpeed);
    const tangentialNorm = clamp01(tangentialSpeed);
    const baseFrequency = lerp(24, 112, impactNorm) + tangentialNorm * 18;
    const endFrequency = lerp(7, 18, impactNorm * 0.82);
    const gainValue = (0.045 + clampedIntensity * 0.16) * 2.6;

    const oscillator = context.createOscillator();
    const subOscillator = context.createOscillator();
    const clickOscillator = context.createOscillator();
    const gainNode = context.createGain();
    const subGainNode = context.createGain();
    const clickGainNode = context.createGain();
    const lowpass = context.createBiquadFilter();
    const subLowpass = context.createBiquadFilter();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(baseFrequency, startAt);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, startAt + duration);

    clickOscillator.type = 'triangle';
    clickOscillator.frequency.setValueAtTime(baseFrequency * (1.1 + tangentialNorm * 0.28), startAt);
    clickOscillator.frequency.exponentialRampToValueAtTime(baseFrequency * 0.24, startAt + duration * 0.65);

    const subDuration = duration * 1.16;
    const subStartFrequency = lerp(32, 68, impactNorm) + tangentialNorm * 4;
    const subEndFrequency = lerp(15, 24, impactNorm * 0.78);
    subOscillator.type = 'sine';
    subOscillator.frequency.setValueAtTime(subStartFrequency, startAt);
    subOscillator.frequency.exponentialRampToValueAtTime(subEndFrequency, startAt + subDuration);

    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(320 + clampedIntensity * 720 + tangentialNorm * 560, startAt);
    lowpass.frequency.exponentialRampToValueAtTime(110, startAt + duration);
    lowpass.Q.setValueAtTime(0.8 + clampedIntensity * 2.1 + tangentialNorm * 0.9, startAt);

    subLowpass.type = 'lowpass';
    subLowpass.frequency.setValueAtTime(120 + clampedIntensity * 60, startAt);
    subLowpass.frequency.exponentialRampToValueAtTime(52, startAt + subDuration);
    subLowpass.Q.setValueAtTime(1.1 + impactNorm * 0.6, startAt);

    gainNode.gain.setValueAtTime(0.0001, startAt);
    gainNode.gain.linearRampToValueAtTime(gainValue, startAt + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    const subGainValue = gainValue * (0.34 + impactNorm * 0.24);
    subGainNode.gain.setValueAtTime(0.0001, startAt);
    subGainNode.gain.linearRampToValueAtTime(subGainValue, startAt + 0.008);
    subGainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + subDuration);

    clickGainNode.gain.setValueAtTime(0.0001, startAt);
    clickGainNode.gain.linearRampToValueAtTime(gainValue * 0.32, startAt + 0.004);
    clickGainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + duration * 0.42);

    oscillator.connect(lowpass);
    subOscillator.connect(subLowpass);
    clickOscillator.connect(clickGainNode);
    clickGainNode.connect(lowpass);
    lowpass.connect(gainNode);
    subLowpass.connect(subGainNode);
    gainNode.connect(this.outputNode);
    subGainNode.connect(this.outputNode);

    const stopAt = startAt + Math.max(duration, subDuration) + 0.02;
    oscillator.start(startAt);
    subOscillator.start(startAt);
    clickOscillator.start(startAt);
    oscillator.stop(stopAt);
    subOscillator.stop(stopAt);
    clickOscillator.stop(stopAt);

    subOscillator.onended = () => {
      oscillator.disconnect();
      subOscillator.disconnect();
      clickOscillator.disconnect();
      gainNode.disconnect();
      subGainNode.disconnect();
      clickGainNode.disconnect();
      lowpass.disconnect();
      subLowpass.disconnect();
    };
  }

  setChannelGain(value: number) {
    this.channelGain = normalizeMasterGain(value, this.channelGain);
    if (this.channelGainNode && this.context) {
      this.channelGainNode.gain.setTargetAtTime(this.channelGain, this.context.currentTime, 0.03);
    }
  }

  setChannelPan(value: number) {
    this.channelPan = Math.min(1, Math.max(-1, Number(value) || 0));
    if (this.channelPanNode && this.context) {
      this.channelPanNode.pan.setTargetAtTime(this.channelPan, this.context.currentTime, 0.03);
    }
  }

  getMeterLevel() {
    if (!this.channelAnalyser || !this.channelMeterData) return 0;
    this.channelAnalyser.getByteTimeDomainData(this.channelMeterData);
    let sum = 0;
    for (let index = 0; index < this.channelMeterData.length; index += 1) {
      const normalizedSample = (this.channelMeterData[index] - 128) / 128;
      sum += normalizedSample * normalizedSample;
    }
    return clamp01(Math.sqrt(sum / this.channelMeterData.length) * 4.2);
  }

  getOutputTrack() {
    return this.outputDestination?.stream.getAudioTracks()[0] || null;
  }

  async destroy() {
    if (this.context && this.context.state !== 'closed') {
      await this.context.close().catch(() => undefined);
    }
    this.channelAnalyser = null;
    this.channelMeterData = null;
    this.channelGainNode = null;
    this.channelPanNode = null;
    this.context = null;
    this.delayFeedbackNode = null;
    this.delayFilterNode = null;
    this.delayNode = null;
    this.delaySendNode = null;
    this.delayReturnGainNode = null;
    this.outputDestination = null;
    this.spatialPannerNode = null;
    this.airBandpassNode = null;
    this.airGainNode = null;
    this.airNoiseSource?.stop?.();
    this.airNoiseSource = null;
    this.outputNode = null;
    this.reverbSendNode = null;
    this.reverbReturnGainNode = null;
    this.reverbConvolverNode = null;
    this.initPromise = null;
  }
}

class GravityBallRenderer {
  private animationFrame = 0;
  private canvas: HTMLCanvasElement;
  private enabled = false;
  private forcedCanvasHeight = 0;
  private forcedCanvasWidth = 0;
  private gl: WebGLRenderingContext | null = null;
  private gravity = GRAVITY_BALL_EARTH_MS2;
  private grabAnchor: GravityBallGrabAnchor | null = null;
  private handPoints: GravityBallHandPoint[] | null = null;
  private isGrabbed = false;
  private lastGrabAnchor = { at: 0, x: 0, y: 0 };
  private previousHandPoints = new Map<number, { x: number; y: number; at: number }>();
  private lastFrameAt = 0;
  private prevCanvasWidth = 0;
  private prevCanvasHeight = 0;
  private position = { x: 0, y: 0, z: 0 };
  // Escher env-map: offscreen composite canvas + WebGL texture
  private envCanvas: HTMLCanvasElement | null = null;
  private envCtx: CanvasRenderingContext2D | null = null;
  private envTexture: WebGLTexture | null = null;
  private uniformEnvMap: WebGLUniformLocation | null = null;
  private uniformEnvBlend: WebGLUniformLocation | null = null;
  private envMirrorEnabled = false;
  private _envFrameCounter = 0;
  private _envCanvasRect: DOMRect | null = null;
  private _envRectsCacheTime = 0;
  private extraEnvCanvases: HTMLCanvasElement[] = [];
  // ResizeObserver keeps forcedCanvasWidth/Height in sync with CSS layout
  private canvasObserver: ResizeObserver | null = null;
  // Projected shadow
  private shadowProgram: WebGLProgram | null = null;
  private shadowBuffer: WebGLBuffer | null = null;
  private shadowAttribCorner = -1;
  private shadowUniformCenter: WebGLUniformLocation | null = null;
  private shadowUniformRadius: WebGLUniformLocation | null = null;
  private shadowUniformAlpha: WebGLUniformLocation | null = null;
  private velocity = { x: 140, y: -90, z: 0.14 };
  private radius = 42;
  private rotation = { x: 0.34, y: -0.26, z: 0.18 };
  private angularVelocity = { x: 1.2, y: -1.5, z: 0.9 };
  private foley = new GravityBallFoley();
  private program: WebGLProgram | null = null;
  private attribPosition = -1;
  private attribNormal = -1;
  private uniformAspect: WebGLUniformLocation | null = null;
  private uniformBaseColor: WebGLUniformLocation | null = null;
  private uniformCenter: WebGLUniformLocation | null = null;
  private uniformDepth: WebGLUniformLocation | null = null;
  private uniformLightDir: WebGLUniformLocation | null = null;
  private uniformRotation: WebGLUniformLocation | null = null;
  private uniformScale: WebGLUniformLocation | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private normalBuffer: WebGLBuffer | null = null;
  private vertexCount = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.initialize();
  }

  private initialize() {
    const gl = this.canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    });
    if (!gl) return;

    const compileShader = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vertexShader = compileShader(
      gl.VERTEX_SHADER,
      `
        attribute vec3 aPosition;
        attribute vec3 aNormal;
        uniform mat3 uRotation;
        uniform vec2 uCenter;
        uniform float uScale;
        uniform float uAspect;
        uniform float uDepth;
        varying vec3 vNormal;

        void main() {
          vec3 rotatedPosition = uRotation * aPosition;
          vec3 rotatedNormal = normalize(uRotation * aNormal);
          vec3 clipPosition = rotatedPosition * uScale;
          clipPosition.x /= max(0.001, uAspect);
          clipPosition.xy += uCenter;
          clipPosition.z = rotatedPosition.z * (uScale * 0.6) + uDepth;
          gl_Position = vec4(clipPosition, 1.0);
          vNormal = rotatedNormal;
        }
      `,
    );
    const fragmentShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
        precision mediump float;
        uniform vec3  uBaseColor;
        uniform vec3  uLightDir;
        uniform sampler2D uEnvMap;
        uniform float uEnvBlend;
        varying vec3  vNormal;

        const float PI = 3.14159265;

        // Anisotropic GGX NDF — different roughness along tangent (ax) and bitangent (ay)
        float D_GGX_aniso(float NdotH, float TdotH, float BdotH, float ax, float ay) {
          float a = TdotH / ax;
          float b = BdotH / ay;
          float d = a*a + b*b + NdotH*NdotH;
          return 1.0 / (PI * ax * ay * d * d + 0.0001);
        }

        // Smith visibility (isotropic approx, using geometric mean of ax/ay)
        float V_SmithGGX(float NdotL, float NdotV, float a2) {
          float GGXL = NdotV * sqrt(NdotL * NdotL * (1.0 - a2) + a2);
          float GGXV = NdotL * sqrt(NdotV * NdotV * (1.0 - a2) + a2);
          return 0.5 / (GGXL + GGXV + 0.0001);
        }

        vec3 F_Schlick(float cosTheta, vec3 F0) {
          return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
        }

        void main() {
          vec3 N = normalize(vNormal);
          vec3 L = normalize(uLightDir);
          vec3 V = vec3(0.0, 0.0, 1.0);
          vec3 H = normalize(L + V);

          float NdotL = max(dot(N, L), 0.0);
          float NdotV = max(dot(N, V), 0.001);
          float NdotH = max(dot(N, H), 0.0);
          float VdotH = max(dot(V, H), 0.0);

          // Tangent frame from normal (rotates with the ball spin via uRotation)
          // Avoids the pole singularity at N = (0,±1,0)
          vec3 up = abs(N.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
          vec3 T  = normalize(cross(up, N));
          vec3 B  = cross(N, T);

          float TdotH = dot(T, H);
          float BdotH = dot(B, H);

          // roughness = 0.6, anisotropy: tighter along T, wider along B
          float ax = 0.32;  // tighter axis (roughness_T ≈ 0.57)
          float ay = 0.62;  // wider  axis (roughness_B ≈ 0.79)
          float a2_vis = ax * ay;

          vec3 F0  = uBaseColor;
          vec3 F   = F_Schlick(VdotH, F0);
          float D  = D_GGX_aniso(NdotH, TdotH, BdotH, ax, ay);
          float Vis = V_SmithGGX(NdotL, NdotV, a2_vis * a2_vis);
          vec3 specular = F * D * Vis * PI;

          // ── Escher sphere-map with zoom + anisotropic UV warp ─────────────
          // Blinn sphere-map: R = reflect(-V, N)
          //   m = 2·|R+(0,0,1)|,  base UV = R.xy/m + 0.5
          vec3 R = reflect(-V, N);
          float m = 2.0 * sqrt(R.x*R.x + R.y*R.y + (R.z + 1.0)*(R.z + 1.0));
          vec2 baseUV = vec2(R.x / m + 0.5, R.y / m + 0.5);
          // Anisotropic warp: T/B-frame offsets stretch the reflection
          // along the rotating tangent, giving the "brushed" Escher distortion
          float warpT = dot(T.xy, R.xy) * 0.14;
          float warpB = dot(B.xy, R.xy) * 0.07;
          vec2 warpedUV = baseUV + vec2(warpT, warpB);
          // Zoom in: envZoom < 1 samples a smaller window → magnified reflection
          float envZoom = 0.42;
          vec2 sphereUV = clamp((warpedUV - 0.5) * envZoom + 0.5, 0.002, 0.998);
          vec3 envSample = texture2D(uEnvMap, sphereUV).rgb;

          vec3 Fenv = F_Schlick(NdotV, F0);

          float hemi = N.y * 0.5 + 0.5;
          vec3 envFallback = mix(
            uBaseColor * vec3(0.04, 0.05, 0.02),
            uBaseColor * vec3(0.40, 0.52, 0.20),
            hemi
          ) * 0.55;

          vec3 envLight = mix(envFallback, envSample * 1.1, uEnvBlend * 0.78) * Fenv;

          vec3 color = envLight + specular * NdotL * 2.4;

          gl_FragColor = vec4(color, 0.97);
        }
      `,
    );

    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return;
    }

    const mesh = createGravityBallMesh();
    const vertexBuffer = gl.createBuffer();
    const normalBuffer = gl.createBuffer();
    if (!vertexBuffer || !normalBuffer) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.gl = gl;
    this.program = program;
    this.vertexBuffer = vertexBuffer;
    this.normalBuffer = normalBuffer;
    this.vertexCount = mesh.vertexCount;
    this.attribPosition = gl.getAttribLocation(program, 'aPosition');
    this.attribNormal = gl.getAttribLocation(program, 'aNormal');
    this.uniformAspect = gl.getUniformLocation(program, 'uAspect');
    this.uniformBaseColor = gl.getUniformLocation(program, 'uBaseColor');
    this.uniformCenter = gl.getUniformLocation(program, 'uCenter');
    this.uniformDepth = gl.getUniformLocation(program, 'uDepth');
    this.uniformLightDir = gl.getUniformLocation(program, 'uLightDir');
    this.uniformRotation = gl.getUniformLocation(program, 'uRotation');
    this.uniformScale = gl.getUniformLocation(program, 'uScale');
    this.uniformEnvMap   = gl.getUniformLocation(program, 'uEnvMap');
    this.uniformEnvBlend = gl.getUniformLocation(program, 'uEnvBlend');

    // Offscreen canvas used each frame to composite video + hand canvas → env texture
    // 256×256 gives enough texel density for the sphere-map reflection detail
    const envCanvas = document.createElement('canvas');
    envCanvas.width = 256;
    envCanvas.height = 256;
    this.envCanvas = envCanvas;
    this.envCtx = envCanvas.getContext('2d');

    const envTex = gl.createTexture();
    if (envTex) {
      gl.bindTexture(gl.TEXTURE_2D, envTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // Seed with a 1×1 transparent pixel so the sampler never reads garbage
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
      gl.bindTexture(gl.TEXTURE_2D, null);
      this.envTexture = envTex;
    }

    // Shadow: simple flat quad rendered before the ball
    const shadowVert = compileShader(gl.VERTEX_SHADER, `
      attribute vec2 aCorner;
      uniform vec2 uCenter;
      uniform vec2 uRadius;
      varying vec2 vCorner;
      void main() {
        vCorner = aCorner;
        gl_Position = vec4(uCenter + aCorner * uRadius, 0.9, 1.0);
      }
    `);
    const shadowFrag = compileShader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform float uAlpha;
      varying vec2 vCorner;
      void main() {
        float d = length(vCorner);
        float a = (1.0 - smoothstep(0.15, 1.0, d)) * uAlpha;
        gl_FragColor = vec4(0.0, 0.0, 0.0, a);
      }
    `);
    if (shadowVert && shadowFrag) {
      const sp = gl.createProgram();
      if (sp) {
        gl.attachShader(sp, shadowVert);
        gl.attachShader(sp, shadowFrag);
        gl.linkProgram(sp);
        if (gl.getProgramParameter(sp, gl.LINK_STATUS)) {
          this.shadowProgram = sp;
          this.shadowAttribCorner = gl.getAttribLocation(sp, 'aCorner');
          this.shadowUniformCenter = gl.getUniformLocation(sp, 'uCenter');
          this.shadowUniformRadius = gl.getUniformLocation(sp, 'uRadius');
          this.shadowUniformAlpha = gl.getUniformLocation(sp, 'uAlpha');
        } else {
          gl.deleteProgram(sp);
        }
      }
    }
    if (shadowVert) gl.deleteShader(shadowVert);
    if (shadowFrag) gl.deleteShader(shadowFrag);

    const shadowBuf = gl.createBuffer();
    if (shadowBuf) {
      gl.bindBuffer(gl.ARRAY_BUFFER, shadowBuf);
      // Two triangles forming a unit quad, corners [-1,1]²
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,  1, -1,  1,  1,
        -1, -1,  1,  1, -1,  1,
      ]), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.shadowBuffer = shadowBuf;
    }

    // Keep forcedCanvasWidth/Height in sync with CSS layout so resizeCanvas()
    // always has a correct aspect ratio even when clientWidth/clientHeight is 0.
    if (typeof ResizeObserver !== 'undefined') {
      this.canvasObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            this.forcedCanvasWidth = Math.round(width);
            this.forcedCanvasHeight = Math.round(height);
          }
        }
      });
      this.canvasObserver.observe(this.canvas);
    }
  }

  private resizeCanvas() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    // Prefer forcedCanvasWidth/Height (set by ResizeObserver on layout changes)
    // over clientWidth/Height which can be 0 or stale mid-layout.
    // Never fall back to canvas.width/height — those are buffer pixels and
    // would get double-multiplied by dpr, producing a wrong aspect ratio.
    const cssW = this.forcedCanvasWidth > 0 ? this.forcedCanvasWidth
      : this.canvas.clientWidth > 0 ? this.canvas.clientWidth : 0;
    const cssH = this.forcedCanvasHeight > 0 ? this.forcedCanvasHeight
      : this.canvas.clientHeight > 0 ? this.canvas.clientHeight : 0;
    if (cssW <= 0 || cssH <= 0) return { width: this.canvas.width || 2, height: this.canvas.height || 2 };
    const width = Math.max(2, Math.round(cssW * dpr));
    const height = Math.max(2, Math.round(cssH * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    return { height, width };
  }

  getCanvas() {
    return this.canvas;
  }

  setCanvasSize(width: number, height: number) {
    this.forcedCanvasWidth = Math.max(2, Math.round(width));
    this.forcedCanvasHeight = Math.max(2, Math.round(height));
  }

  private clearCanvas() {
    const gl = this.gl;
    if (!gl) return;
    this.resizeCanvas();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  private start() {
    if (this.animationFrame) return;
    this.lastFrameAt = 0;
    const step = (now: number) => {
      if (!this.enabled) {
        this.animationFrame = 0;
        this.clearCanvas();
        return;
      }
      this.animationFrame = window.requestAnimationFrame(step);
      this.render(now);
    };
    this.animationFrame = window.requestAnimationFrame(step);
  }

  private stop() {
    if (this.animationFrame) {
      window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
    this.clearCanvas();
  }

  setEnabled(value: boolean) {
    this.enabled = Boolean(value);
    if (!this.enabled) {
      this.stop();
      return;
    }
    void this.foley.prime().catch(() => undefined);
    this.start();
  }

  /** Pass extra canvas sources (e.g. the hand overlay) to be composited into the env texture. */
  setEnvCanvases(canvases: HTMLCanvasElement[]) {
    this.extraEnvCanvases = canvases;
  }

  /** Toggle Escher mirror reflection. Off by default (uses procedural fallback only). */
  setEnvMirrorEnabled(value: boolean) {
    this.envMirrorEnabled = Boolean(value);
  }

  /**
   * Build the sphere-map environment texture for the Escher reflection.
   *
   * The shader samples this texture using Blinn sphere-map UVs derived from
   * the reflection vector R = reflect(-V, N).  UV (0.5, 0.5) corresponds to
   * the "straight back" direction — i.e., what is directly behind the ball.
   *
   * Previous bug: every video was stretched to fill the full 128×128 env
   * canvas, so env-center always showed the video frame's center rather than
   * what's spatially behind the ball.
   *
   * Fix: each video is drawn at its actual screen position relative to the
   * ball, so the ball's own position maps to env canvas center (W/2, H/2).
   * We cache getBoundingClientRect every 500 ms to avoid layout thrash.
   *
   * captureRadius controls how much of the scene (in ball-radii) is mapped
   * into the 128×128 env.  Larger = wider "field of view" of the reflection.
   */
  private updateEnvTexture() {
    const gl = this.gl;
    const ctx = this.envCtx;
    const envCanvas = this.envCanvas;
    if (!gl || !ctx || !envCanvas || !this.envTexture) return;

    const W = envCanvas.width;   // 256
    const H = envCanvas.height;  // 256
    ctx.clearRect(0, 0, W, H);

    // Capture window: ball center ± captureRadius canvas pixels → full env canvas
    // 3× ball radius gives ~180° field of view for the sphere-map hemisphere
    const captureRadius = this.radius * 3;
    const captureScale  = W / (captureRadius * 2);

    const stage = this.canvas.parentElement;
    if (stage) {
      // Refresh the canvas's bounding rect every 500 ms (cheap layout read)
      const now = performance.now();
      if (!this._envCanvasRect || now - this._envRectsCacheTime > 500) {
        this._envCanvasRect = this.canvas.getBoundingClientRect();
        this._envRectsCacheTime = now;
      }
      const canvasRect = this._envCanvasRect;

      for (const video of stage.querySelectorAll<HTMLVideoElement>('video')) {
        if (video.readyState < 2) continue;

        // Video's CSS rect relative to the ball canvas
        const vr    = video.getBoundingClientRect();
        const vLeft = vr.left - canvasRect.left;
        const vTop  = vr.top  - canvasRect.top;

        // Map the capture window to env-canvas coordinates:
        //   env_x = (canvas_x − (ballX − captureRadius)) * captureScale
        const envX  = (vLeft - (this.position.x - captureRadius)) * captureScale;
        const envY  = (vTop  - (this.position.y - captureRadius)) * captureScale;

        try { ctx.drawImage(video, envX, envY, vr.width * captureScale, vr.height * captureScale); } catch { /* not ready */ }
      }
    }

    // Composite hand-overlay and any extra canvases with the same transform.
    // These share the main canvas pixel space, so the same captureScale applies.
    for (const src of this.extraEnvCanvases) {
      const ex = -(this.position.x - captureRadius) * captureScale;
      const ey = -(this.position.y - captureRadius) * captureScale;
      try { ctx.drawImage(src, ex, ey, src.width * captureScale, src.height * captureScale); } catch { /* skip */ }
    }

    // Upload — flip Y so canvas top = texture top (sphere-map UV convention)
    gl.bindTexture(gl.TEXTURE_2D, this.envTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, envCanvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  setGravity(value: number) {
    this.gravity = normalizeGravityBallGravity(value, this.gravity);
  }

  setAudioChannelGain(value: number) {
    this.foley.setChannelGain(value);
  }

  async primeAudio() {
    await this.foley.prime();
  }

  setAudioChannelPan(value: number) {
    this.foley.setChannelPan(value);
  }

  setAudioDelaySend(value: number) {
    this.foley.setDelaySend(value);
  }

  setAudioReverbSend(value: number) {
    this.foley.setReverbSend(value);
  }

  setDelayFeedback(value: number) {
    this.foley.setDelayFeedback(value);
  }

  setDelayMix(value: number) {
    this.foley.setDelayMix(value);
  }

  setDelayTime(value: number) {
    this.foley.setDelayTime(value);
  }

  setDelayTone(value: number) {
    this.foley.setDelayTone(value);
  }

  getAudioMeterLevel() {
    return this.foley.getMeterLevel();
  }

  getOutputTrack() {
    return this.foley.getOutputTrack();
  }

  setReverbMix(value: number) {
    this.foley.setReverbMix(value);
  }

  setReverbTime(value: number) {
    this.foley.setReverbTime(value);
  }

  setHandState(state: GravityBallHandState | null, at = performance.now()) {
    if (!state?.points?.length) {
      this.handPoints = null;
      this.grabAnchor = null;
      this.isGrabbed = false;
      this.lastGrabAnchor = { at: 0, x: 0, y: 0 };
      this.previousHandPoints.clear();
      return;
    }

    const nextPoints = state.points.map((point) => {
      const previous = this.previousHandPoints.get(point.index);
      const deltaMs = previous ? Math.max(8, at - previous.at) : 16;
      const deltaSeconds = deltaMs / 1000;
      const vx = previous ? (point.x - previous.x) / deltaSeconds : 0;
      const vy = previous ? (point.y - previous.y) / deltaSeconds : 0;
      this.previousHandPoints.set(point.index, { at, x: point.x, y: point.y });
      return {
        index: point.index,
        radius: point.index % 4 === 0 ? 12 : 9,
        vx,
        vy,
        x: point.x,
        y: point.y,
      } satisfies GravityBallHandPoint;
    });

    this.handPoints = nextPoints;

    if (!state.canGrab || !state.anchor) {
      this.grabAnchor = null;
      this.isGrabbed = false;
      this.lastGrabAnchor = { at: 0, x: 0, y: 0 };
      return;
    }

    const previousAnchor = this.lastGrabAnchor.at > 0 ? this.lastGrabAnchor : null;
    const deltaMs = previousAnchor ? Math.max(8, at - previousAnchor.at) : 16;
    const deltaSeconds = deltaMs / 1000;
    const anchorVx = previousAnchor ? (state.anchor.x - previousAnchor.x) / deltaSeconds : 0;
    const anchorVy = previousAnchor ? (state.anchor.y - previousAnchor.y) / deltaSeconds : 0;
    this.grabAnchor = {
      ...state.anchor,
      vx: anchorVx,
      vy: anchorVy,
    };
    this.lastGrabAnchor = {
      at,
      x: state.anchor.x,
      y: state.anchor.y,
    };
  }

  private buildRotationMatrix() {
    const cx = Math.cos(this.rotation.x);
    const sx = Math.sin(this.rotation.x);
    const cy = Math.cos(this.rotation.y);
    const sy = Math.sin(this.rotation.y);
    const cz = Math.cos(this.rotation.z);
    const sz = Math.sin(this.rotation.z);

    return new Float32Array([
      cy * cz,
      cy * sz,
      -sy,
      sx * sy * cz - cx * sz,
      sx * sy * sz + cx * cz,
      sx * cy,
      cx * sy * cz + sx * sz,
      cx * sy * sz - sx * cz,
      cx * cy,
    ]);
  }

  private applyPhysics(dt: number, width: number, height: number) {
    const minSide = Math.min(width, height);
    const palmSpan = this.handPoints && this.handPoints.length > 17
      ? Math.hypot(
          this.handPoints[5].x - this.handPoints[17].x,
          this.handPoints[5].y - this.handPoints[17].y,
        )
      : minSide * 0.12;
    const targetRadius = Math.min(minSide * 0.12, Math.max(minSide * 0.045, palmSpan * 0.48));
    const radiusEase = 1 - Math.exp(-dt * 5.4);
    this.radius += (targetRadius - this.radius) * radiusEase;

    const gravityForce = (this.gravity / GRAVITY_BALL_EARTH_MS2) * GRAVITY_BALL_SIM_EARTH * height * 0.42;
    const airDrag = Math.pow(0.992, dt * 60);
    const angularDrag = Math.pow(0.985, dt * 60);
    const playImpact = (impactVelocity: number, tangentialVelocity = 0) => {
      const normalizedImpact = clampNumber(impactVelocity / Math.max(120, height * 0.5), 0, 1.25, 0, 3);
      const normalizedTangential = clampNumber(
        tangentialVelocity / Math.max(80, width * 0.38),
        0,
        1.25,
        0,
        3,
      );
      void this.foley.playBounce(
        normalizedImpact,
        this.position.x / Math.max(1, width),
        this.position.y / Math.max(1, height),
        this.position.z,
        normalizedImpact,
        normalizedTangential,
      ).catch(() => undefined);
    };

    if (this.grabAnchor) {
      const targetRadius = Math.min(minSide * 0.12, Math.max(minSide * 0.045, this.grabAnchor.span * 0.48));
      const anchorDistance = Math.hypot(
        this.position.x - this.grabAnchor.x,
        this.position.y - (this.grabAnchor.y - targetRadius * 0.78),
      );

      if (!this.isGrabbed && anchorDistance <= targetRadius * 1.28) {
        this.isGrabbed = true;
      }
    } else {
      this.isGrabbed = false;
    }

    if (this.isGrabbed && this.grabAnchor) {
      const targetX = this.grabAnchor.x;
      const targetY = this.grabAnchor.y - this.radius * 0.78;
      const follow = 1 - Math.exp(-dt * 18);
      this.position.x += (targetX - this.position.x) * follow;
      this.position.y += (targetY - this.position.y) * follow;
      this.velocity.x = this.grabAnchor.vx;
      this.velocity.y = this.grabAnchor.vy;
      this.velocity.z *= Math.pow(0.82, dt * 60);
      this.position.z *= Math.pow(0.9, dt * 60);
      this.angularVelocity.x = this.grabAnchor.vy * 0.0034;
      this.angularVelocity.y = -this.grabAnchor.vx * 0.0038;
      this.angularVelocity.z *= Math.pow(0.86, dt * 60);
      this.rotation.x += this.angularVelocity.x * dt;
      this.rotation.y += this.angularVelocity.y * dt;
      this.rotation.z += this.angularVelocity.z * dt;
      return;
    }

    this.velocity.y += gravityForce * dt;
    this.velocity.x *= airDrag;
    this.velocity.y *= airDrag;
    this.velocity.z *= Math.pow(0.994, dt * 60);
    this.angularVelocity.x *= angularDrag;
    this.angularVelocity.y *= angularDrag;
    this.angularVelocity.z *= angularDrag;
    const planarSpeed = Math.hypot(this.velocity.x, this.velocity.y);
    const depthSpeed = Math.abs(this.velocity.z) * Math.max(width, height) * 0.22;
    this.foley.setMotion(
      clampNumber((planarSpeed + depthSpeed) / Math.max(160, Math.min(width, height) * 0.7), 0, 1.4, 0, 3),
    );

    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.position.z += this.velocity.z * dt;

    const restitution = 0.86;
    if (this.position.x < this.radius) {
      this.position.x = this.radius;
      const impactVelocity = Math.abs(this.velocity.x);
      const tangentialVelocity = Math.abs(this.velocity.y);
      this.velocity.x = Math.abs(this.velocity.x) * restitution;
      this.angularVelocity.y += 0.8;
      playImpact(impactVelocity, tangentialVelocity);
    } else if (this.position.x > width - this.radius) {
      this.position.x = width - this.radius;
      const impactVelocity = Math.abs(this.velocity.x);
      const tangentialVelocity = Math.abs(this.velocity.y);
      this.velocity.x = -Math.abs(this.velocity.x) * restitution;
      this.angularVelocity.y -= 0.8;
      playImpact(impactVelocity, tangentialVelocity);
    }

    if (this.position.y < this.radius) {
      this.position.y = this.radius;
      const impactVelocity = Math.abs(this.velocity.y);
      const tangentialVelocity = Math.abs(this.velocity.x);
      this.velocity.y = Math.abs(this.velocity.y) * restitution;
      this.angularVelocity.x += 0.7;
      playImpact(impactVelocity, tangentialVelocity);
    } else if (this.position.y > height - this.radius) {
      this.position.y = height - this.radius;
      const impactVelocity = Math.abs(this.velocity.y);
      const tangentialVelocity = Math.abs(this.velocity.x);
      this.velocity.y = -Math.abs(this.velocity.y) * restitution;
      this.angularVelocity.x -= 1.1;
      playImpact(impactVelocity, tangentialVelocity);
    }

    if (this.position.z < -0.38) {
      this.position.z = -0.38;
      this.velocity.z = Math.abs(this.velocity.z) * 0.88;
    } else if (this.position.z > 0.38) {
      this.position.z = 0.38;
      this.velocity.z = -Math.abs(this.velocity.z) * 0.88;
    }

    this.handPoints?.forEach((point) => {
      const deltaX = this.position.x - point.x;
      const deltaY = this.position.y - point.y;
      const distance = Math.hypot(deltaX, deltaY) || 0.0001;
      const minimumDistance = this.radius + point.radius;
      if (distance >= minimumDistance) return;

      const normalX = deltaX / distance;
      const normalY = deltaY / distance;
      const penetration = minimumDistance - distance;
      this.position.x += normalX * penetration;
      this.position.y += normalY * penetration;

      const relativeVelocity =
        (this.velocity.x - point.vx) * normalX + (this.velocity.y - point.vy) * normalY;
      if (relativeVelocity < 0) {
        const impulse = -(1 + 0.98) * relativeVelocity;
        const tangentX = -normalY;
        const tangentY = normalX;
        const tangentialVelocity = Math.abs(
          (this.velocity.x - point.vx) * tangentX + (this.velocity.y - point.vy) * tangentY,
        );
        this.velocity.x += normalX * impulse;
        this.velocity.y += normalY * impulse;
        playImpact(
          Math.abs(relativeVelocity) + (Math.abs(point.vx) + Math.abs(point.vy)) * 0.18,
          tangentialVelocity,
        );
      }

      this.velocity.x += point.vx * 0.12 + normalX * 80;
      this.velocity.y += point.vy * 0.12 + normalY * 80;
      this.velocity.z += Math.min(0.25, (Math.abs(point.vx) + Math.abs(point.vy)) / 1600) * (normalX - normalY);
      this.angularVelocity.x += normalY * 1.4;
      this.angularVelocity.y -= normalX * 1.6;
      this.angularVelocity.z += (point.vx - point.vy) * 0.0007;
    });

    this.rotation.x += this.angularVelocity.x * dt;
    this.rotation.y += this.angularVelocity.y * dt;
    this.rotation.z += this.angularVelocity.z * dt;
  }

  private render(now: number) {
    const gl = this.gl;
    const program = this.program;
    const vertexBuffer = this.vertexBuffer;
    const normalBuffer = this.normalBuffer;
    if (!gl || !program || !vertexBuffer || !normalBuffer || this.vertexCount <= 0) return;

    const { width, height } = this.resizeCanvas();
    const deltaSeconds = this.lastFrameAt ? Math.min(0.04, (now - this.lastFrameAt) / 1000) : 1 / 60;
    this.lastFrameAt = now;

    if (this.position.x <= 0 || this.position.y <= 0) {
      this.position.x = width * 0.56;
      this.position.y = height * 0.34;
    } else if (this.prevCanvasWidth > 0 && this.prevCanvasHeight > 0 &&
               (width !== this.prevCanvasWidth || height !== this.prevCanvasHeight)) {
      // Rescale position proportionally on window resize so the ball doesn't warp
      this.position.x = (this.position.x / this.prevCanvasWidth) * width;
      this.position.y = (this.position.y / this.prevCanvasHeight) * height;
    }
    this.prevCanvasWidth = width;
    this.prevCanvasHeight = height;

    this.applyPhysics(deltaSeconds, width, height);

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const aspect = width / Math.max(1, height);
    const centerX = (this.position.x / width) * 2 - 1;
    const centerY = 1 - (this.position.y / height) * 2;
    const scale = (this.radius / height) * 2;
    const rotationMatrix = this.buildRotationMatrix();

    // ── Halo shadow: soft dark disc AT ball position, dims video behind it ──
    // Unlike a floor shadow this sits right behind the ball in screen space,
    // giving the impression the ball is blocking/absorbing ambient light from
    // the video — like a real opaque object over a lit surface.
    if (this.shadowProgram && this.shadowBuffer) {
      gl.useProgram(this.shadowProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.shadowBuffer);
      gl.enableVertexAttribArray(this.shadowAttribCorner);
      gl.vertexAttribPointer(this.shadowAttribCorner, 2, gl.FLOAT, false, 0, 0);
      // Radius ~1.6× the ball so shadow bleeds softly past the edge
      const haloRX = (scale / aspect) * 1.6;
      const haloRY = scale * 1.6;
      gl.uniform2f(this.shadowUniformCenter, centerX, centerY);
      gl.uniform2f(this.shadowUniformRadius, haloRX, haloRY);
      gl.uniform1f(this.shadowUniformAlpha, 0.42);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.disableVertexAttribArray(this.shadowAttribCorner);
    }

    // ── Ball: restore ball program + attrib state after shadow pass ──────────
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.enableVertexAttribArray(this.attribPosition);
    gl.vertexAttribPointer(this.attribPosition, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.enableVertexAttribArray(this.attribNormal);
    gl.vertexAttribPointer(this.attribNormal, 3, gl.FLOAT, false, 0, 0);

    // Env-map: capture video frames every 3rd frame when mirror mode is on (saves GPU/CPU)
    if (this.envMirrorEnabled && ++this._envFrameCounter % 3 === 0) this.updateEnvTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.envTexture);
    gl.uniform1i(this.uniformEnvMap, 0);
    gl.uniform1f(this.uniformEnvBlend, this.envMirrorEnabled ? 1.0 : 0.0);

    gl.uniform1f(this.uniformAspect, aspect);
    if (this.isGrabbed) {
      gl.uniform3f(this.uniformBaseColor, 1.0, 0.64, 0.24);
    } else {
      gl.uniform3f(this.uniformBaseColor, 0.71, 0.92, 0.18);
    }
    gl.uniform2f(this.uniformCenter, centerX, centerY);
    gl.uniform1f(this.uniformDepth, this.position.z);
    gl.uniform3f(this.uniformLightDir, -0.4, 0.72, 1.15);
    gl.uniformMatrix3fv(this.uniformRotation, false, rotationMatrix);
    gl.uniform1f(this.uniformScale, scale);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
  }

  destroy() {
    this.stop();
    void this.foley.destroy().catch(() => undefined);
    const gl = this.gl;
    if (gl) {
      if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
      if (this.normalBuffer) gl.deleteBuffer(this.normalBuffer);
      if (this.shadowBuffer) gl.deleteBuffer(this.shadowBuffer);
      if (this.envTexture) gl.deleteTexture(this.envTexture);
      if (this.shadowProgram) gl.deleteProgram(this.shadowProgram);
      if (this.program) gl.deleteProgram(this.program);
    }
    this.vertexBuffer = null;
    this.normalBuffer = null;
    this.shadowBuffer = null;
    this.shadowProgram = null;
    this.envTexture = null;
    this.envCanvas = null;
    this.envCtx = null;
    this.program = null;
    this.gl = null;
    this.handPoints = null;
    this.previousHandPoints.clear();
  }
}

export const mountLiveKitRoom = (root: HTMLElement) => {
  if (root.dataset.mounted === 'true') {
    return () => {};
  }

  let livekitUrl = normalizeText(root.dataset.livekitUrl);
  const courseId = normalizeText(root.dataset.courseId);
  const inviteMode = normalizeText(root.dataset.inviteMode).toLowerCase();
  const inviteCode = normalizeText(root.dataset.inviteCode).toLowerCase();
  const inviteError = normalizeText(root.dataset.inviteError);
  const isExternalInviteMode = inviteMode === 'external';
  const isInvalidInviteMode = inviteMode === 'invalid';

  const roomInput = root.querySelector('[data-room-input]');
  const identityInput = root.querySelector('[data-identity-input]');
  const nameInput = root.querySelector('[data-name-input]');
  const roleInput = root.querySelector('[data-role-input]');
  const roleLabel = root.querySelector('[data-role-label]');
  const layoutInput = root.querySelector('[data-layout-input]');
  const audioInputSelects = Array.from(root.querySelectorAll('[data-audio-input-select]')).filter(
    (node): node is HTMLSelectElement => node instanceof HTMLSelectElement,
  );
  const videoInputSelects = Array.from(root.querySelectorAll('[data-video-input-select]')).filter(
    (node): node is HTMLSelectElement => node instanceof HTMLSelectElement,
  );
  const audioInputSelect = audioInputSelects[0] || null;
  const videoInputSelect = videoInputSelects[0] || null;
  const presentationSelect = root.querySelector('[data-presentation-select]');
  const sessionSetupDetails = root.querySelector('[data-session-setup]');
  const previewZoomInput = root.querySelector('[data-preview-zoom-input]');
  const previewZoomOutput = root.querySelector('[data-preview-zoom-output]');
  const backgroundBlurToggleButton = root.querySelector('[data-action="background-blur-toggle"]');
  const backgroundReplaceToggleButton = root.querySelector('[data-action="background-replace-toggle"]');
  const backgroundReplacePopup = root.querySelector('[data-background-replace-popup]');
  const backgroundReplaceCloseButton = root.querySelector('[data-action="background-replace-close"]');
  const backgroundEffectClearButton = root.querySelector('[data-action="background-effect-clear"]');
  const backgroundImagePreviewShell = root.querySelector('[data-background-image-preview-shell]');
  const backgroundImagePreview = root.querySelector('[data-background-image-preview]');
  const backgroundImageLabel = root.querySelector('[data-background-image-label]');
  const backgroundImageClearButton = root.querySelector('[data-action="background-image-clear"]');
  const backgroundImageFileInput = root.querySelector('[data-background-image-file-input]');
  const backgroundImageDropzone = root.querySelector('[data-background-image-dropzone]');
  const backgroundImagePickButton = root.querySelector('[data-action="background-image-pick"]');
  const backgroundImageSearchInput = root.querySelector('[data-background-image-search-input]');
  const backgroundImageSearchButton = root.querySelector('[data-action="background-image-search"]');
  const backgroundImageStatus = root.querySelector('[data-background-image-status]');
  const backgroundImageResults = root.querySelector('[data-background-image-results]');
  const backgroundColorInput = root.querySelector('[data-background-color-input]');
  const backgroundColorApplyButton = root.querySelector('[data-action="background-color-apply"]');
  const previewInvertInput = root.querySelector('[data-preview-invert-input]');
  const showCircleInput = root.querySelector('[data-show-circle-input]');
  const statusNode = root.querySelector('[data-room-status]');
  const stateNode = root.querySelector('[data-room-state]');
  const countNode = root.querySelector('[data-participant-count]');
  const connectToggleButton = root.querySelector('[data-action="connect-toggle"]');
  const connectButton = root.querySelector('[data-action="connect"]');
  const disconnectButton = root.querySelector('[data-action="disconnect"]');
  const cameraButton = root.querySelector('[data-action="camera"]');
  const microphoneButton = root.querySelector('[data-action="microphone"]');
  const micMeter = root.querySelector('[data-mic-meter]');
  const shareScreenButton = root.querySelector('[data-action="screen-share"]');
  const presentationButton = root.querySelector('[data-action="presentation"]');
  const presentationClearButton = root.querySelector('[data-action="presentation-clear"]');
  const layoutChoiceButtons = Array.from(root.querySelectorAll('[data-layout-choice]'));
  const audioInputPanel = root.querySelector('[data-audio-input-panel]');
  const videoInputPanel = root.querySelector('[data-video-input-panel]');
  const teacherSlot = root.querySelector('[data-slot="teacher"]');
  const gridSlot = root.querySelector('[data-slot="grid"]');
  const studentsSlot = root.querySelector('[data-slot="students"]');
  const screenSlot = root.querySelector('[data-slot="screen"]');
  const identityPreviewSlot = root.querySelector('[data-slot="identity-preview"]');
  const teacherPanel = root.querySelector('[data-panel="teacher"]');
  const participantList = root.querySelector('[data-participant-list]');
  const stage = root.querySelector('[data-stage]');
  const stageFrameNode = root.querySelector('.conference-stage-frame');
  const gravityBallCanvas = root.querySelector('[data-gravity-ball-canvas]');
  const recordingGuide = root.querySelector('[data-recording-guide]');
  const reactionsLayer = root.querySelector('[data-reactions-layer]');
  const stageHandOverlay = root.querySelector('[data-stage-hand-overlay]');
  const participantTemplate = root.querySelector('[data-template="participant-card"]');
  const screenTemplate = root.querySelector('[data-template="screen-card"]');
  const presentationFrame = root.querySelector('[data-presentation-frame]');
  const presentationPlaceholder = root.querySelector('[data-presentation-placeholder]');
  const liveActivityButton = root.querySelector('[data-live-activity-button]');
  const liveActivityTimer = root.querySelector('[data-live-activity-timer]');
  const sessionTimer = root.querySelector('[data-session-timer]');
  const recordButton = root.querySelector('[data-action="record"]');
  const fullscreenButton = root.querySelector('[data-action="fullscreen"]');
  const shortcutsHelpButton = root.querySelector('[data-action="shortcuts-help"]');
  const sidebarToggleButton = root.querySelector('[data-action="sidebar-toggle"]');
  const instrumentsToggleButton = root.querySelector('[data-action="instruments-toggle"]');
  const shortcutsModal = root.querySelector('[data-shortcuts-modal]');
  const shortcutsCloseButton = root.querySelector('[data-shortcuts-close]');
  const externalInviteGate = root.querySelector('[data-external-invite-gate]');
  const externalInviteCloseButton = root.querySelector('[data-external-invite-close]');
  const externalInviteNameInput = root.querySelector('[data-external-invite-name]');
  const externalInviteEmailInput = root.querySelector('[data-external-invite-email]');
  const externalInvitePasswordInput = root.querySelector('[data-external-invite-password]');
  const externalInviteGateStatus = root.querySelector('[data-external-invite-gate-status]');
  const externalInviteJoinButton = root.querySelector('[data-action="external-invite-join"]');
  const externalInviteTeacherPasswordInput = root.querySelector('[data-external-password-input]');
  const externalInviteExpirySelect = root.querySelector('[data-external-expiry-select]');
  const externalInviteLinkOutput = root.querySelector('[data-external-invite-link-output]');
  const externalInviteStatus = root.querySelector('[data-external-invite-status]');
  const externalInviteCreateButton = root.querySelector('[data-action="external-invite-create"]');
  const externalInviteCopyButton = root.querySelector('[data-action="external-invite-copy"]');
  const externalInviteRevokeButton = root.querySelector('[data-action="external-invite-revoke"]');
  const studentInviteExpirySelect = root.querySelector('[data-student-expiry-select]');
  const studentInviteLinkOutput = root.querySelector('[data-student-invite-link-output]');
  const studentInviteStatus = root.querySelector('[data-student-invite-status]');
  const studentInviteCreateButton = root.querySelector('[data-action="student-invite-create"]');
  const studentInviteCopyButton = root.querySelector('[data-action="student-invite-copy"]');
  const studentInviteRevokeButton = root.querySelector('[data-action="student-invite-revoke"]');
  const chatList = root.querySelector('[data-chat-list]');
  const chatInput = root.querySelector('[data-chat-input]');
  const chatSection = root.querySelector('[data-chat-section]');
  const chatFocusButton = root.querySelector('[data-action="chat-focus"]');
  const chatUnreadDot = root.querySelector('[data-chat-unread]');
  const chatSendButton = root.querySelector('[data-action="chat-send"]');
  const chatDownloadButton = root.querySelector('[data-action="chat-download"]');
  const raiseHandButton = root.querySelector('[data-action="raise-hand"]');
  const handTrackInput = root.querySelector('[data-hand-track-input]');
  const handTrackToggleButton = root.querySelector('[data-hand-track-toggle]');
  const handRampInput = root.querySelector('[data-hand-ramp-input]');
  const gravityBallInput = root.querySelector('[data-gravity-ball-input]');
  const gravityBallToggleButton = root.querySelector('[data-gravity-ball-toggle]');
  const gravityBallGravityInput = root.querySelector('[data-gravity-ball-gravity-input]');
  const gravityBallMirrorInput = root.querySelector('[data-gravity-ball-mirror-input]');
  const synthMappingResetButton = root.querySelector('[data-synth-mapping-reset]');
  const recordingPresetSelect = root.querySelector('[data-recording-preset-select]');
  const sessionControlsField = root.querySelector('[data-session-controls-field]');
  const sessionAllowInstrumentsInput = root.querySelector('[data-session-allow-instruments-input]');
  const breakRoomsShell = root.querySelector('[data-break-rooms-shell]');
  const breakRoomsPopup = root.querySelector('[data-break-rooms-popup]');
  const breakRoomsPopupSetup = root.querySelector('[data-break-rooms-popup-setup]');
  const breakRoomsPopupDivider = root.querySelector('[data-break-rooms-popup-divider]');
  const breakRoomsList = root.querySelector('[data-break-rooms-list]');
  const breakRoomsStatusNote = root.querySelector('[data-break-rooms-status]');
  const breakRoomsSizeInput = root.querySelector('[data-break-rooms-size]');
  const breakRoomsCustomInputsContainer = root.querySelector('[data-break-rooms-custom-inputs]');
  const breakRoomsBBtn = root.querySelector('[data-break-rooms-btn]');
  const breakRoomsEndBtn = root.querySelector('[data-break-rooms-end-btn]');
  const breakRoomsKillBtn = root.querySelector('[data-break-rooms-kill-btn]');
  const externalMediaControlsShell = root.querySelector('[data-external-media-controls-shell]');
  const externalMediaBtn = root.querySelector('[data-external-media-btn]');
  const externalMediaPopup = root.querySelector('[data-external-media-popup]');
  const externalMediaInput = root.querySelector('[data-external-media-input]');
  const externalMediaOpenButton = root.querySelector('[data-action="external-media-open"]');
  const externalMediaResults = root.querySelector('[data-external-media-results]');
  const externalMediaStatus = root.querySelector('[data-external-media-status]');
  const externalMediaStage = root.querySelector('[data-external-media-stage]');
  const externalMediaPlayerHost = root.querySelector('[data-external-media-player-host]');
  const externalMediaEmpty = root.querySelector('[data-external-media-empty]');
  const externalMediaTitle = root.querySelector('[data-external-media-title]');
  const externalMediaProviderLabel = root.querySelector('[data-external-media-provider-label]');
  const externalMediaPlayToggleButtons = Array.from(
    root.querySelectorAll('[data-action="external-media-play-toggle"]'),
  );
  const externalMediaCloseButtons = Array.from(
    root.querySelectorAll('[data-action="external-media-close"], [data-action="external-media-stop"]'),
  );
  const brCountdownEl = root.querySelector('[data-br-countdown]');
  const brCountdownText = root.querySelector('[data-br-countdown-text]');
  const sessionMuteAllButton = root.querySelector('[data-session-mute-all-button]');
  const recentSpeakersEls = Array.from(root.querySelectorAll('[data-recent-speakers]'));
  const streamingProfileSelect = root.querySelector('[data-streaming-profile-select]');
  const optimizeSpeakerInput = root.querySelector('[data-optimize-speaker-input]');
  const limitGridQualityInput = root.querySelector('[data-limit-grid-input]');
  const synthCarrierInput = root.querySelector('[data-synth-carrier-input]');
  const synthCarrierOutput = root.querySelector('[data-synth-carrier-output]');
  const synthModulatorInput = root.querySelector('[data-synth-modulator-input]');
  const synthModulatorOutput = root.querySelector('[data-synth-modulator-output]');
  const synthGainInput = root.querySelector('[data-synth-gain-input]');
  const synthGainOutput = root.querySelector('[data-synth-gain-output]');
  const synthCutoffInput = root.querySelector('[data-synth-cutoff-input]');
  const synthCutoffOutput = root.querySelector('[data-synth-cutoff-output]');
  const synthResonanceInput = root.querySelector('[data-synth-resonance-input]');
  const synthResonanceOutput = root.querySelector('[data-synth-resonance-output]');
  const synthWaveformInput = root.querySelector('[data-synth-waveform-input]');
  const synthWaveformOutput = root.querySelector('[data-synth-waveform-output]');
  const synthDistortionInput = root.querySelector('[data-synth-distortion-input]');
  const synthDistortionOutput = root.querySelector('[data-synth-distortion-output]');
  const synthMapButtons = Array.from(root.querySelectorAll('[data-synth-map-capture]'));
  const sessionLeaderField = root.querySelector('[data-session-leader-field]');
  const sessionLeaderSelect = root.querySelector('[data-session-leader-select]');
  const mixerSynthGainInput = root.querySelector('[data-mixer-synth-gain]');
  const mixerSynthMeter = root.querySelector('[data-mixer-meter="synth"]');
  const mixerSynthMuteButton = root.querySelector('[data-mixer-synth-mute]');
  const mixerSynthPanInput = root.querySelector('[data-mixer-synth-pan]');
  const mixerSynthPanKnob = root.querySelector('[data-mixer-synth-pan-knob]');
  const mixerSynthReverbSendInput = root.querySelector('[data-mixer-synth-reverb-send]');
  const mixerSynthReverbSendKnob = root.querySelector('[data-mixer-synth-reverb-send-knob]');
  const mixerSynthDelaySendInput = root.querySelector('[data-mixer-synth-delay-send]');
  const mixerSynthDelaySendKnob = root.querySelector('[data-mixer-synth-delay-send-knob]');
  const mixerBallGainInput = root.querySelector('[data-mixer-ball-gain]');
  const mixerBallMeter = root.querySelector('[data-mixer-meter="ball"]');
  const mixerBallMuteButton = root.querySelector('[data-mixer-ball-mute]');
  const mixerBallPanInput = root.querySelector('[data-mixer-ball-pan]');
  const mixerBallPanKnob = root.querySelector('[data-mixer-ball-pan-knob]');
  const mixerBallReverbSendInput = root.querySelector('[data-mixer-ball-reverb-send]');
  const mixerBallReverbSendKnob = root.querySelector('[data-mixer-ball-reverb-send-knob]');
  const mixerBallDelaySendInput = root.querySelector('[data-mixer-ball-delay-send]');
  const mixerBallDelaySendKnob = root.querySelector('[data-mixer-ball-delay-send-knob]');
  const mixerIncomingGainInput = root.querySelector('[data-mixer-incoming-gain]');
  const mixerIncomingMeter = root.querySelector('[data-mixer-meter="incoming"]');
  const mixerIncomingMuteButton = root.querySelector('[data-mixer-incoming-mute]');
  const mixerIncomingPanInput = root.querySelector('[data-mixer-incoming-pan]');
  const mixerIncomingPanKnob = root.querySelector('[data-mixer-incoming-pan-knob]');
  const mixerIncomingReverbSendInput = root.querySelector('[data-mixer-incoming-reverb-send]');
  const mixerIncomingReverbSendKnob = root.querySelector('[data-mixer-incoming-reverb-send-knob]');
  const mixerIncomingDelaySendInput = root.querySelector('[data-mixer-incoming-delay-send]');
  const mixerIncomingDelaySendKnob = root.querySelector('[data-mixer-incoming-delay-send-knob]');
  const mixerMasterGainInput = root.querySelector('[data-mixer-master-gain]');
  const mixerMasterMeter = root.querySelector('[data-mixer-meter="master"]');
  const mixerMasterMuteButton = root.querySelector('[data-mixer-master-mute]');
  const mixerMasterPanInput = root.querySelector('[data-mixer-master-pan]');
  const mixerMasterPanKnob = root.querySelector('[data-mixer-master-pan-knob]');
  const mixerVideoLumaInput = root.querySelector('[data-mixer-video-luma]');
  const mixerVideoLumaKnob = root.querySelector('[data-mixer-video-luma-knob]');
  const mixerVideoTintInput = root.querySelector('[data-mixer-video-tint]');
  const mixerVideoTintKnob = root.querySelector('[data-mixer-video-tint-knob]');
  const mixerVideoSaturationInput = root.querySelector('[data-mixer-video-saturation]');
  const mixerVideoSaturationKnob = root.querySelector('[data-mixer-video-saturation-knob]');
  const mixerVideoContrastInput = root.querySelector('[data-mixer-video-contrast]');
  const mixerVideoContrastKnob = root.querySelector('[data-mixer-video-contrast-knob]');
  const mixerVideoBrightnessInput = root.querySelector('[data-mixer-video-brightness]');
  const mixerVideoBrightnessKnob = root.querySelector('[data-mixer-video-brightness-knob]');
  const videoBypassToggleButton = root.querySelector('[data-video-bypass-toggle]');
  const mixerResetButtonNodes = Array.from(root.querySelectorAll('[data-mixer-reset-button]'));
  const mixerResetScopeNodes = Array.from(root.querySelectorAll('[data-mixer-reset-scope]'));
  const mixerResetControlNodes = Array.from(root.querySelectorAll('[data-mixer-reset-control]'));
  const summaryActionButtons = Array.from(root.querySelectorAll('[data-summary-action]'));
  const synthReverbTimeInput = root.querySelector('[data-synth-reverb-time-input]');
  const synthReverbTimeOutput = root.querySelector('[data-synth-reverb-time-output]');
  const synthReverbMixInput = root.querySelector('[data-synth-reverb-mix-input]');
  const synthReverbMixOutput = root.querySelector('[data-synth-reverb-mix-output]');
  const synthDelayTimeInput = root.querySelector('[data-synth-delay-time-input]');
  const synthDelayTimeOutput = root.querySelector('[data-synth-delay-time-output]');
  const synthDelayFeedbackInput = root.querySelector('[data-synth-delay-feedback-input]');
  const synthDelayFeedbackOutput = root.querySelector('[data-synth-delay-feedback-output]');
  const synthDelayMixInput = root.querySelector('[data-synth-delay-mix-input]');
  const synthDelayMixOutput = root.querySelector('[data-synth-delay-mix-output]');
  const synthDelayToneInput = root.querySelector('[data-synth-delay-tone-input]');
  const synthDelayToneOutput = root.querySelector('[data-synth-delay-tone-output]');
  const synthCompToggle = root.querySelector('[data-synth-comp-toggle]');
  const synthCompThresholdInput = root.querySelector('[data-synth-comp-threshold-input]');
  const synthCompThresholdOutput = root.querySelector('[data-synth-comp-threshold-output]');
  const synthCompRatioInput = root.querySelector('[data-synth-comp-ratio-input]');
  const synthCompRatioOutput = root.querySelector('[data-synth-comp-ratio-output]');
  const synthCompAttackInput = root.querySelector('[data-synth-comp-attack-input]');
  const synthCompAttackOutput = root.querySelector('[data-synth-comp-attack-output]');
  const synthCompReleaseInput = root.querySelector('[data-synth-comp-release-input]');
  const synthCompReleaseOutput = root.querySelector('[data-synth-comp-release-output]');
  const synthCompKneeInput = root.querySelector('[data-synth-comp-knee-input]');
  const synthCompKneeOutput = root.querySelector('[data-synth-comp-knee-output]');
  const synthLimiterToggle = root.querySelector('[data-synth-limiter-toggle]');
  const synthLimiterThresholdInput = root.querySelector('[data-synth-limiter-threshold-input]');
  const synthLimiterThresholdOutput = root.querySelector('[data-synth-limiter-threshold-output]');
  const synthLimiterReleaseInput = root.querySelector('[data-synth-limiter-release-input]');
  const synthLimiterReleaseOutput = root.querySelector('[data-synth-limiter-release-output]');

  if (
    !(roomInput instanceof HTMLInputElement) ||
    !(identityInput instanceof HTMLInputElement) ||
    !(nameInput instanceof HTMLInputElement) ||
    !(roleInput instanceof HTMLInputElement) ||
    !(layoutInput instanceof HTMLSelectElement) ||
    !(presentationSelect instanceof HTMLSelectElement) ||
    !(statusNode instanceof HTMLElement) ||
    !(stateNode instanceof HTMLElement) ||
    !(countNode instanceof HTMLElement) ||
    !(cameraButton instanceof HTMLButtonElement) ||
    !(microphoneButton instanceof HTMLButtonElement) ||
    !(shareScreenButton instanceof HTMLButtonElement) ||
    !(teacherSlot instanceof HTMLElement) ||
    !(gridSlot instanceof HTMLElement) ||
    !(studentsSlot instanceof HTMLElement) ||
    !(screenSlot instanceof HTMLElement) ||
    !(participantList instanceof HTMLElement) ||
    !(stage instanceof HTMLElement) ||
    !(participantTemplate instanceof HTMLTemplateElement) ||
    !(screenTemplate instanceof HTMLTemplateElement) ||
    !(presentationFrame instanceof HTMLIFrameElement) ||
    !(presentationPlaceholder instanceof HTMLElement) ||
    !(sessionTimer instanceof HTMLElement) ||
    !(recordButton instanceof HTMLButtonElement) ||
    !(chatList instanceof HTMLElement) ||
    !(chatInput instanceof HTMLTextAreaElement) ||
    !(chatSendButton instanceof HTMLButtonElement) ||
    !(chatDownloadButton instanceof HTMLButtonElement)
  ) {
    const missingDomNodes: string[] = [];
    if (!(roomInput instanceof HTMLInputElement)) missingDomNodes.push('room input');
    if (!(identityInput instanceof HTMLInputElement)) missingDomNodes.push('identity input');
    if (!(nameInput instanceof HTMLInputElement)) missingDomNodes.push('name input');
    if (!(roleInput instanceof HTMLInputElement)) missingDomNodes.push('role input');
    if (!(layoutInput instanceof HTMLSelectElement)) missingDomNodes.push('layout select');
    if (!(presentationSelect instanceof HTMLSelectElement)) missingDomNodes.push('presentation select');
    if (!(statusNode instanceof HTMLElement)) missingDomNodes.push('status node');
    if (!(stateNode instanceof HTMLElement)) missingDomNodes.push('state node');
    if (!(countNode instanceof HTMLElement)) missingDomNodes.push('participant count');
    if (
      !(connectToggleButton instanceof HTMLButtonElement) &&
      !(connectButton instanceof HTMLButtonElement)
    ) {
      missingDomNodes.push('connect control');
    }
    if (!(cameraButton instanceof HTMLButtonElement)) missingDomNodes.push('camera button');
    if (!(microphoneButton instanceof HTMLButtonElement)) missingDomNodes.push('microphone button');
    if (!(shareScreenButton instanceof HTMLButtonElement)) missingDomNodes.push('screen share button');
    if (!(teacherSlot instanceof HTMLElement)) missingDomNodes.push('teacher slot');
    if (!(gridSlot instanceof HTMLElement)) missingDomNodes.push('grid slot');
    if (!(studentsSlot instanceof HTMLElement)) missingDomNodes.push('students slot');
    if (!(screenSlot instanceof HTMLElement)) missingDomNodes.push('screen slot');
    if (!(participantList instanceof HTMLElement)) missingDomNodes.push('participant list');
    if (!(stage instanceof HTMLElement)) missingDomNodes.push('stage');
    if (!(participantTemplate instanceof HTMLTemplateElement)) missingDomNodes.push('participant template');
    if (!(screenTemplate instanceof HTMLTemplateElement)) missingDomNodes.push('screen template');
    if (!(presentationFrame instanceof HTMLIFrameElement)) missingDomNodes.push('presentation frame');
    if (!(presentationPlaceholder instanceof HTMLElement)) missingDomNodes.push('presentation placeholder');
    if (!(sessionTimer instanceof HTMLElement)) missingDomNodes.push('session timer');
    if (!(recordButton instanceof HTMLButtonElement)) missingDomNodes.push('record button');
    if (!(chatList instanceof HTMLElement)) missingDomNodes.push('chat list');
    if (!(chatInput instanceof HTMLTextAreaElement)) missingDomNodes.push('chat input');
    if (!(chatSendButton instanceof HTMLButtonElement)) missingDomNodes.push('chat send button');
    if (!(chatDownloadButton instanceof HTMLButtonElement)) missingDomNodes.push('chat download button');

    console.error(`Conference room DOM is incomplete: ${missingDomNodes.join(', ')}`);
    if (statusNode instanceof HTMLElement) {
      statusNode.textContent = 'La interfaz de la sala no pudo inicializarse correctamente.';
    }
    root.dataset.mounted = 'false';
    return () => {
      root.dataset.mounted = 'false';
    };
  }

  root.dataset.mounted = 'true';
  root.dataset.state = 'disconnected';

  const serverDefaultRoom = normalizeText(roomInput.value);
  const serverDefaultName = normalizeText(nameInput.value);
  const query = new URLSearchParams(window.location.search);
  const persistedSetup = readPersistedRoomSetup();
  let externalInviteGuestName = '';
  let externalInviteGuestEmail = '';
  let externalInviteGuestPassword = '';
  let currentExternalInviteUrl = '';
  let currentExternalInviteCode = '';
  let currentStudentInviteUrl = '';
  let currentStudentInviteCode = '';
  let inviteReloadTimeoutId = 0;

  if (!query.has('room') && normalizeText(persistedSetup.room)) {
    roomInput.value = normalizeText(persistedSetup.room);
  }
  if (!query.has('identity') && normalizeText(persistedSetup.identity)) {
    identityInput.value = normalizeText(persistedSetup.identity);
  }
  if (!query.has('name') && normalizeText(persistedSetup.name)) {
    nameInput.value = normalizeText(persistedSetup.name);
  }

  if (isExternalInviteMode) {
    roomInput.value = serverDefaultRoom;
    roomInput.readOnly = true;
    identityInput.readOnly = true;
    identityInput.value = '';
    if (!query.has('name')) {
      nameInput.value = serverDefaultName;
    }
    presentationSelect.value = '';
    if (sessionSetupDetails instanceof HTMLDetailsElement) {
      sessionSetupDetails.open = false;
    }
  }

  const presentationCourseIdByHrefKey = new Map<string, string>();
  const presentationPageSlugByHrefKey = new Map<string, string>();
  const presentationCourseIdByPathSegment = new Map<string, string>();

  Array.from(presentationSelect.options).forEach((option) => {
    const href = normalizeText(option.value);
    if (!href) return;

    const hrefKey = toPresentationHrefKey(href);
    const optionCourseId = normalizeText(option.dataset.courseId);
    const optionLessonId = normalizeText(option.dataset.lessonId);
    const coursePathSegment = readPresentationCoursePathSegment(href);

    if (hrefKey) {
      if (optionCourseId) {
        presentationCourseIdByHrefKey.set(hrefKey, optionCourseId);
      }
      if (optionLessonId) {
        presentationPageSlugByHrefKey.set(hrefKey, optionLessonId);
      }
    }

    if (coursePathSegment && optionCourseId && !presentationCourseIdByPathSegment.has(coursePathSegment)) {
      presentationCourseIdByPathSegment.set(coursePathSegment, optionCourseId);
    }
  });

  const room = new Room({
    adaptiveStream: {
      pixelDensity: 'screen',
    },
    dynacast: true,
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const presentation = createPresentationController({
    frame: presentationFrame,
    placeholder: presentationPlaceholder,
  });

  const participantCards = new Map<string, ParticipantCardRefs>();
  const screenCards = new Map<string, ScreenCardRefs>();
  const mounts: MountCollection = {
    participantAudioMounts: new Map(),
    participantVideoMounts: new Map(),
    screenAudioMounts: new Map(),
    screenVideoMounts: new Map(),
  };
  const reactionBursts = new Map<string, number>();

  let destroyed = false;
  let localRole = normalizeRole(roleInput.value);
  let pendingPresentationTask = 0;
  let preferredAudioInputId = normalizeText(persistedSetup.preferredAudioInputId) || normalizeText(audioInputSelect?.value);
  let preferredVideoInputId = normalizeText(persistedSetup.preferredVideoInputId) || normalizeText(videoInputSelect?.value);
  let focusedParticipantIdentity = '';
  let localPreviewMount: ParticipantMount | null = null;
  let localPreviewStreamMount: LocalPreviewStreamMount | null = null;
  let disconnectedStagePreviewMount: LocalPreviewStreamMount | null = null;
  let disconnectedCameraPreviewEnabled = false;
  let rawTrackingDeviceId = '';
  let rawTrackingStream: MediaStream | null = null;
  let rawTrackingVideo: HTMLVideoElement | null = null;
  let layoutBeforeAutoScreenshare = normalizeLayoutMode(layoutInput.value);
  let autoSwitchedToScreenshare = false;
  let screenshareWasActive = false;
  let currentSlideState: SlideState | null = null;
  let pendingRemoteSlideState: SlideState | null = null;
  let lastPublishedSlideKey = '';
  let currentPresentationMediaState: PresentationEmbeddedMediaState | null = null;
  let pendingRemotePresentationMediaState: PresentationEmbeddedMediaState | null = null;
  let lastPublishedPresentationMediaKey = '';
  let presentationStateRecoveryRequestTimeoutIds: number[] = [];
  let unsubscribeLiveActivity: (() => void) | null = null;
  let activeLiveSnapshot: LiveSnapshot | null = null;
  let liveActivityTickId = 0;
  let vpsStatsTickId = 0;
  let immersiveFullscreenActive = false;
  let connectedAtMs = 0;
  let recentSpeakers: string[] = [];
  let recordingAnimationId = 0;
  let recordingAudioContext: AudioContext | null = null;
  let recordingCanvas: HTMLCanvasElement | null = null;
  let recordingCanvasContext: CanvasRenderingContext2D | null = null;
  let recordingDisplayStream: MediaStream | null = null;
  let recordingDisplayVideo: HTMLVideoElement | null = null;
  let recordingMediaElementSources: AudioNode[] = [];
  let recordingMicTrackClones: MediaStreamTrack[] = [];
  let recordingStream: MediaStream | null = null;
  let recordingChunks: Blob[] = [];
  let mediaRecorder: MediaRecorder | null = null;
  let recordingDataRequestId = 0;
  let recordingPresentationImage: HTMLImageElement | null = null;
  let recordingPresentationUrl = '';
  let recordingPresentationSnapshotTask: Promise<void> | null = null;
  let recordingPresentationLastSnapshotAt = 0;
  let disconnectedLiveStream: MediaStream | null = null;
  let disconnectedMicStream: MediaStream | null = null;
  let disconnectedPreviewProcessor: BackgroundBlurVideoProcessor | null = null;
  let disconnectedPreviewSourceVideo: HTMLVideoElement | null = null;
  let reverseMicKeyActive = false;
  let reverseMicRestoreState: boolean | null = null;
  let localHandRaised = false;
  let previewZoom = normalizePreviewZoom(
    previewZoomInput instanceof HTMLInputElement
      ? previewZoomInput.value
      : persistedSetup.previewZoom,
    normalizePreviewZoom(persistedSetup.previewZoom, 2.25),
  );
  let backgroundEffectMode = normalizeBackgroundEffectMode(
    persistedSetup.backgroundEffectMode,
    persistedSetup.previewBlur ? 'blur' : 'none',
  );
  let backgroundColor = normalizeBackgroundColor(persistedSetup.backgroundColor, DEFAULT_BACKGROUND_COLOR);
  let backgroundImageUrl =
    canPersistBackgroundImageUrl(normalizeText(persistedSetup.backgroundImageUrl))
      ? normalizeText(persistedSetup.backgroundImageUrl)
      : '';
  let backgroundImageSelectionLabel = normalizeText(persistedSetup.backgroundImageLabel);
  let backgroundImageObjectUrl = '';
  let backgroundImageSearchRequestId = 0;
  let backgroundImageSearchLoading = false;
  let backgroundImageSearchQuery = '';
  let backgroundImageSearchResultsState: BackgroundImageSearchResult[] = [];
  let backgroundReplacePopupOpen = false;
  if (backgroundEffectMode === 'image' && !backgroundImageUrl) {
    backgroundEffectMode = 'none';
  }
  let previewBlur = backgroundEffectMode === 'blur';
  let previewInvert = Boolean(persistedSetup.previewInvert);
  let recordingPreset = normalizeRecordingPreset(
    recordingPresetSelect instanceof HTMLSelectElement
      ? recordingPresetSelect.value
      : persistedSetup.recordingPreset,
    normalizeRecordingPreset(persistedSetup.recordingPreset, 'landscape-1080'),
  );
  let presentationCircleZoom = previewZoom;
  let showPresentationCircle = persistedSetup.showCircle !== false;
  if (streamingProfileSelect instanceof HTMLSelectElement && persistedSetup.streamingProfile) {
    streamingProfileSelect.value = persistedSetup.streamingProfile;
  }
  if (optimizeSpeakerInput instanceof HTMLInputElement && persistedSetup.optimizeSpeaker !== undefined) {
    optimizeSpeakerInput.checked = persistedSetup.optimizeSpeaker;
  }
  if (limitGridQualityInput instanceof HTMLInputElement && persistedSetup.limitGridQuality !== undefined) {
    limitGridQualityInput.checked = persistedSetup.limitGridQuality;
  }
  let instrumentsOpen = persistedSetup.instrumentsOpen === true;
  let handTrackEnabled = Boolean(persistedSetup.handTrackEnabled);
  let handRampMs = clampNumber(persistedSetup.handRampMs, 10, 4000, 500, 0);
  let gravityBallEnabled = Boolean(persistedSetup.gravityBallEnabled);
  let gravityBallMirror = Boolean(persistedSetup.gravityBallMirror);
  if (gravityBallMirrorInput instanceof HTMLInputElement) {
    gravityBallMirrorInput.checked = gravityBallMirror;
  }
  let gravityBallGravity = normalizeGravityBallGravity(
    persistedSetup.gravityBallGravity,
    GRAVITY_BALL_EARTH_MS2,
  );
  let sessionAllowsInstruments = true;
  let sidebarCollapsed = root.dataset.sidebarCollapsed === 'true';
  let graphVisible = false;
  let externalMediaSession: ExternalMediaSessionState | null = null;
  let externalMediaPlayer: YouTubePlayer | null = null;
  let externalMediaPlayerReady = false;
  let externalMediaSyncIntervalId = 0;
  let externalMediaApplyingRemoteState = false;
  let externalMediaLastBroadcastAt = 0;
  let externalMediaStatusClearTimer: number | null = null;
  let externalMediaSearchDebounceId = 0;
  let externalMediaSearchRequestId = 0;
  let externalMediaSearchLoading = false;
  let externalMediaSearchQuery = '';
  let externalMediaSearchResultsState: ExternalMediaSearchResult[] = [];
  let handTrackingAnimationId = 0;
  let handTrackingGeneration = 0;
  let handTrackingLandmarker: VisionHandLandmarker | null = null;
  let handTrackingLastDetectionAt = 0;
  let handOverlayPulse = 0;
  let currentHandLandmarks: HandLandmarkPoint[] | null = null;
  let currentHandControlValues: HandControlValues | null = null;
  let incomingAudioContext: AudioContext | null = null;
  let incomingAudioGroupAnalyser: AnalyserNode | null = null;
  let incomingAudioGroupMeterData: Uint8Array | null = null;
  let incomingAudioGroupGainNode: GainNode | null = null;
  let incomingAudioGroupPannerNode: StereoPannerNode | null = null;
  let incomingAudioDelayFeedbackGainNode: GainNode | null = null;
  let incomingAudioDelayFilterNode: BiquadFilterNode | null = null;
  let incomingAudioDelayNode: DelayNode | null = null;
  let incomingAudioDelayReturnGainNode: GainNode | null = null;
  let incomingAudioDelaySendNode: GainNode | null = null;
  let incomingAudioDryGainNode: GainNode | null = null;
  let incomingAudioMasterAnalyser: AnalyserNode | null = null;
  let incomingAudioMasterMeterData: Uint8Array | null = null;
  let incomingAudioMasterGainNode: GainNode | null = null;
  let incomingAudioMasterPannerNode: StereoPannerNode | null = null;
  let incomingAudioReverbConvolverNode: ConvolverNode | null = null;
  let incomingAudioReverbReturnGainNode: GainNode | null = null;
  let incomingAudioReverbSendNode: GainNode | null = null;
  const incomingAudioSources = new Map<
    string,
    {
      gain: GainNode;
      panner: StereoPannerNode;
      source: MediaStreamAudioSourceNode;
    }
  >();
  let manualSessionLeaderIdentity = '';
  let focusChangedAtMs = 0;

  // ── Break rooms state ─────────────────────────────────────────────
  let breakRoomsActive: Array<{ name: string; label: string }> = [];
  /** Room name before entering any break room — used to return. */
  let mainRoomName = '';
  /** mode: 'random' | 'grupos' | 'custom' | '' */
  let breakRoomsMode = '';
  /** identity → break room name, for teacher-assigned rooms. */
  let breakRoomAssignments: Record<string, string> = {};
  let sessionLeaderIdentity = '';
  let mixerSynthGain = normalizeMasterGain(persistedSetup.mixerSynthGain, 0.5);
  let mixerSynthReverbSend = clampNumber(persistedSetup.mixerSynthReverbSend, 0, 1, 0.55, 2);
  let mixerSynthDelaySend = clampNumber(persistedSetup.mixerSynthDelaySend, 0, 1, 0, 2);
  let mixerSynthMuted = Boolean(persistedSetup.mixerSynthMuted);
  let mixerSynthPan = Math.min(1, Math.max(-1, Number(persistedSetup.mixerSynthPan) || 0));
  let mixerBallGain = normalizeMasterGain(persistedSetup.mixerBallGain, 0.5);
  let mixerBallReverbSend = clampNumber(persistedSetup.mixerBallReverbSend, 0, 1, 0, 2);
  let mixerBallDelaySend = clampNumber(persistedSetup.mixerBallDelaySend, 0, 1, 0, 2);
  let mixerBallMuted = Boolean(persistedSetup.mixerBallMuted);
  let mixerBallPan = Math.min(1, Math.max(-1, Number(persistedSetup.mixerBallPan) || 0));
  let mixerIncomingGain = normalizeMasterGain(persistedSetup.mixerIncomingGain, 0.5);
  let mixerIncomingReverbSend = clampNumber(persistedSetup.mixerIncomingReverbSend, 0, 1, 0, 2);
  let mixerIncomingDelaySend = clampNumber(persistedSetup.mixerIncomingDelaySend, 0, 1, 0, 2);
  let mixerIncomingMuted = persistedSetup.mixerIncomingMuted !== false;
  let mixerIncomingPan = Math.min(1, Math.max(-1, Number(persistedSetup.mixerIncomingPan) || 0));
  let mixerMasterGain = normalizeMasterGain(persistedSetup.mixerMasterGain, 0.5);
  let mixerMasterMuted = Boolean(persistedSetup.mixerMasterMuted);
  let mixerMasterPan = Math.min(1, Math.max(-1, Number(persistedSetup.mixerMasterPan) || 0));
  let videoMixBypassed = Boolean(persistedSetup.videoBypassed);
  let videoMix = {
    brightness: normalizeVideoMixValue(persistedSetup.videoBrightness, 0),
    contrast: normalizeVideoMixValue(persistedSetup.videoContrast, 0),
    luma: normalizeVideoMixValue(persistedSetup.videoLuma, 0),
    saturation: normalizeVideoMixValue(persistedSetup.videoSaturation, 0),
    tint: normalizeVideoMixValue(persistedSetup.videoTint, 0),
  } satisfies VideoMixSettings;
  const getEffectiveVideoMix = (): VideoMixSettings =>
    videoMixBypassed ? createNeutralVideoMix() : { ...videoMix };
  let mixerMeterAnimationId = 0;
  let synthControlRanges = readPersistedHandControlRanges(persistedSetup.synthControlRanges);
  let synthDelayTime = clampNumber(persistedSetup.delayTime, 0.05, 1.2, 0.38, 2);
  let synthDelayFeedback = clampNumber(persistedSetup.delayFeedback, 0, 0.95, 0.38, 2);
  let synthDelayMix = clampNumber(persistedSetup.delayMix, 0, 1, 0.32, 2);
  let synthDelayTone = clampNumber(persistedSetup.delayTone, 400, 8000, 4200, 0);
  let synthReverbTime = clampNumber(persistedSetup.reverbTime, 0.4, 8, 3, 2);
  let synthReverbMix = clampNumber(persistedSetup.reverbMix, 0, 1, 0.5, 2);
  let synthCompressorEnabled = persistedSetup.compressorEnabled !== false;
  let synthCompressorThreshold = clampNumber(persistedSetup.compressorThreshold, -48, 0, -18, 1);
  let synthCompressorRatio = clampNumber(persistedSetup.compressorRatio, 1, 20, 3, 2);
  let synthCompressorAttack = clampNumber(persistedSetup.compressorAttack, 0.001, 0.2, 0.003, 3);
  let synthCompressorRelease = clampNumber(persistedSetup.compressorRelease, 0.02, 1, 0.25, 3);
  let synthCompressorKnee = clampNumber(persistedSetup.compressorKnee, 0, 40, 12, 1);
  let synthLimiterEnabled = persistedSetup.limiterEnabled !== false;
  let synthLimiterThreshold = clampNumber(persistedSetup.limiterThreshold, -12, 0, -1, 1);
  let synthLimiterRelease = clampNumber(persistedSetup.limiterRelease, 0.01, 0.5, 0.05, 3);
  let publishedBallTrack: LocalAudioTrack | null = null;
  let publishedSynthTrack: LocalAudioTrack | null = null;
  let compositorVideoTrack: LocalVideoTrack | null = null;
  let compositorOutputStream: MediaStream | null = null;
  let compositorInStage = false;
  const fmSynth = new FMSynthVoice();
  const gravityBallRenderer =
    gravityBallCanvas instanceof HTMLCanvasElement ? new GravityBallRenderer(gravityBallCanvas) : null;
  localCameraGravityBallStreamState.canvas = gravityBallCanvas instanceof HTMLCanvasElement ? gravityBallCanvas : null;
  // Feed hand-overlay canvas into Escher env-map composite
  if (gravityBallRenderer && stageHandOverlay instanceof HTMLCanvasElement) {
    gravityBallRenderer.setEnvCanvases([stageHandOverlay]);
  }
  localCameraGravityBallStreamState.enabled = gravityBallEnabled;

  const deviceController = createRoomDeviceSelectController({
    audioInputPanel: audioInputPanel instanceof HTMLElement ? audioInputPanel : null,
    audioInputSelects,
    getActiveAudioDeviceId: () => normalizeText(room.getActiveDevice('audioinput')),
    getActiveVideoDeviceId: () => normalizeText(room.getActiveDevice('videoinput')),
    getPreferredAudioInputId: () => preferredAudioInputId,
    getPreferredVideoInputId: () => preferredVideoInputId,
    onAudioInputChange: async (nextDeviceId) => {
      preferredAudioInputId = nextDeviceId;
      persistSetupState();

      try {
        await room.switchActiveDevice('audioinput', nextDeviceId);
        await deviceController.refreshOptions(false);
      } catch (error) {
        setStatus(
          room.state === ConnectionState.Connected
            ? safeErrorMessage(error)
            : 'Microfono preferido listo para la proxima conexion.',
        );
      }
    },
    onVideoInputChange: async (nextDeviceId) => {
      preferredVideoInputId = nextDeviceId;
      releaseRawTrackingSource();
      persistSetupState();

      if (room.state === ConnectionState.Disconnected) {
        if (!disconnectedCameraPreviewEnabled) {
          setStatus('Camara preferida lista para la proxima conexion.');
          setControlState();
          return;
        }

        try {
          await enableDisconnectedCameraPreview();
          setControlState();
        } catch (error) {
          disableDisconnectedCameraPreview();
          setStatus(safeErrorMessage(error));
          setControlState();
        }
        return;
      }

      try {
        await room.switchActiveDevice('videoinput', nextDeviceId);
        if (shouldRunHandTracking()) {
          await ensureRawTrackingVideo().catch(() => undefined);
        }
        await syncLocalBackgroundBlurProcessor().catch(() => undefined);
        await deviceController.refreshOptions(false);
      } catch (error) {
        setStatus(
          room.state === ConnectionState.Connected
            ? safeErrorMessage(error)
            : 'Camara preferida lista para la proxima conexion.',
        );
      }
    },
    syncControlState: () => {
      setControlState();
    },
    videoInputPanel: videoInputPanel instanceof HTMLElement ? videoInputPanel : null,
    videoInputSelects,
  });

  const micMeterController = createRoomMicMeterController({
    micMeter: micMeter instanceof HTMLElement ? micMeter : null,
  });

  const getLocalCameraTrack = (): LocalCameraTrackLike | null => {
    const publication = Array.from(room.localParticipant.videoTrackPublications.values()).find(
      (entry) => entry.track && entry.source !== Track.Source.ScreenShare,
    );

    return isLocalCameraTrackLike(publication?.track) ? publication.track : null;
  };

  const syncLocalBackgroundBlurProcessor = async () => {
    const localCameraTrack = getLocalCameraTrack();
    if (!localCameraTrack) return;

    localCameraHandOverlayState.enabled = handTrackEnabled;
    const shouldProcessVideo = shouldProcessLocalCameraVideo({
      backgroundEffectMode,
      gravityBallEnabled,
      handTrackEnabled,
      previewInvert,
      videoMix: localCameraProcessorState.videoMix,
    });

    if (!shouldProcessVideo) {
      if (isBackgroundBlurProcessorActive(localCameraTrack)) {
        await localCameraTrack.stopProcessor?.().catch(() => undefined);
      }
      return;
    }

    if (isBackgroundBlurProcessorActive(localCameraTrack)) {
      return;
    }

    try {
      await localCameraTrack.setProcessor?.(new BackgroundBlurVideoProcessor(), true);
    } catch {
      // If the processor fails to initialize (WASM load error, canvas context failure, etc.),
      // disable the background effect gracefully so the camera track keeps working.
      backgroundEffectMode = 'none';
      applyBackgroundEffectState();
      persistSetupState();
      await localCameraTrack.stopProcessor?.().catch(() => undefined);
    }
  };

  const ensureDisconnectedBackgroundPreviewForEffect = async () => {
    if (room.state !== ConnectionState.Disconnected || backgroundEffectMode === 'none') return;

    const hasManagedPreview = Boolean(localPreviewStreamMount?.stream.getVideoTracks()[0]);
    if (disconnectedLiveStream && !hasManagedPreview) {
      stopDisconnectedLivePreview();
    }

    if (!disconnectedCameraPreviewEnabled || !hasManagedPreview) {
      await enableDisconnectedCameraPreview();
    }
  };

  const refreshBackgroundVideoProcessing = async () => {
    if (room.state === ConnectionState.Disconnected) {
      await ensureDisconnectedBackgroundPreviewForEffect();
      await syncDisconnectedPreviewProcessing();
      syncIdentityPreview();
      syncAllParticipants();
      setControlState();
      return;
    }

    if (room.state === ConnectionState.Connected) {
      await syncLocalBackgroundBlurProcessor();
      syncIdentityPreview();
      syncAllParticipants();
      return;
    }

    syncIdentityPreview();
    syncAllParticipants();
  };

  const resolvePresentationCourseId = (href: string | null | undefined) => {
    const hrefKey = toPresentationHrefKey(href);
    if (hrefKey) {
      const mappedByHref = presentationCourseIdByHrefKey.get(hrefKey);
      if (mappedByHref) return mappedByHref;
    }

    const coursePathSegment = readPresentationCoursePathSegment(href);
    if (coursePathSegment) {
      return presentationCourseIdByPathSegment.get(coursePathSegment) || coursePathSegment;
    }

    return '';
  };

  const resolvePresentationPageSlug = (href: string | null | undefined) => {
    const hrefKey = toPresentationHrefKey(href);
    if (hrefKey) {
      const mappedByHref = presentationPageSlugByHrefKey.get(hrefKey);
      if (mappedByHref) return mappedByHref;
    }

    return readPresentationPageSlug(href);
  };

  const getCurrentLayout = () => setLayout(stage, layoutInput.value);

  const getFullscreenTarget = () => root as WebkitFullscreenElement;

  const getFullscreenElement = () =>
    document.fullscreenElement ||
    (document as WebkitDocument).webkitFullscreenElement ||
    null;

  const canRequestFullscreen = () => {
    const target = getFullscreenTarget();
    return Boolean(target.requestFullscreen || target.webkitRequestFullscreen);
  };

  const canExitFullscreen = () =>
    Boolean(document.exitFullscreen || (document as WebkitDocument).webkitExitFullscreen);

  const applyImmersiveFullscreenState = (active: boolean) => {
    immersiveFullscreenActive = active;
    root.dataset.immersive = active ? 'true' : 'false';
    document.body.classList.toggle('room-page--immersive', active);

    if (active) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }

    window.setTimeout(updateRecordingGuideLayout, 0);
  };

  const syncFullscreenButton = () => {
    if (!(fullscreenButton instanceof HTMLButtonElement)) return;

    const active = Boolean(getFullscreenElement()) || immersiveFullscreenActive;
    const supported = true;
    fullscreenButton.disabled = !supported;
    fullscreenButton.dataset.active = active ? 'true' : 'false';
    fullscreenButton.title = active ? 'Salir de pantalla completa' : 'Pantalla completa';
    fullscreenButton.setAttribute(
      'aria-label',
      active ? 'Salir de pantalla completa' : 'Pantalla completa',
    );
  };

  const toggleFullscreen = async () => {
    const fullscreenElement = getFullscreenElement();
    const target = getFullscreenTarget();

    if (fullscreenElement) {
      const exitFullscreen =
        document.exitFullscreen?.bind(document) ||
        (document as WebkitDocument).webkitExitFullscreen?.bind(document);
      await exitFullscreen?.();
      applyImmersiveFullscreenState(false);
      return;
    }

    if (immersiveFullscreenActive) {
      applyImmersiveFullscreenState(false);
      return;
    }

    const requestFullscreen =
      target.requestFullscreen?.bind(target) || target.webkitRequestFullscreen?.bind(target);

    if (requestFullscreen) {
      await requestFullscreen();
      applyImmersiveFullscreenState(false);
      return;
    }

    applyImmersiveFullscreenState(true);
  };

  const setShortcutsModalOpen = (open: boolean) => {
    if (!(shortcutsModal instanceof HTMLElement)) return;
    shortcutsModal.hidden = !open;
    shortcutsModal.dataset.open = open ? 'true' : 'false';
  };

  const openSessionSetup = () => {
    if (sidebarCollapsed) {
      sidebarCollapsed = false;
      applySidebarCollapsedState();
    }
    if (sessionSetupDetails instanceof HTMLDetailsElement) {
      sessionSetupDetails.open = true;
    }
  };

  const toggleCheckboxInput = (input: Element | null) => {
    if (!(input instanceof HTMLInputElement)) return;
    input.checked = !input.checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  summaryActionButtons.forEach((node) => {
    if (!(node instanceof HTMLButtonElement)) return;
    node.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
    });
    node.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  });

  const cycleVideoInput = () => {
    deviceController.cycleVideoInput();
  };

  const copyInviteLink = async () => {
    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard API is not available in this browser.');
    }

    if (localRole === 'teacher' && currentStudentInviteUrl) {
      await navigator.clipboard.writeText(currentStudentInviteUrl);
      setStudentInviteStatusMessage('Link estudiantes copiado.');
      setStatus('Link estudiantes copiado.');
      return;
    }

    const inviteUrl = new URL(window.location.href);
    ['identity', 'name', 'user', 'role'].forEach((key) => inviteUrl.searchParams.delete(key));
    await navigator.clipboard.writeText(inviteUrl.toString());
    setStatus('Invite link copied.');
  };

  const setExternalInviteStatusMessage = (message: string, isError = false) => {
    if (!(externalInviteStatus instanceof HTMLElement)) return;
    externalInviteStatus.textContent = message;
    externalInviteStatus.dataset.error = isError ? 'true' : 'false';
  };

  const setStudentInviteStatusMessage = (message: string, isError = false) => {
    if (!(studentInviteStatus instanceof HTMLElement)) return;
    studentInviteStatus.textContent = message;
    studentInviteStatus.dataset.error = isError ? 'true' : 'false';
  };

  const setExternalInviteGateMessage = (message: string, isError = false) => {
    if (!(externalInviteGateStatus instanceof HTMLElement)) return;
    externalInviteGateStatus.textContent = message;
    externalInviteGateStatus.dataset.error = isError ? 'true' : 'false';
  };

  const resolveInviteExpiryIso = (value: unknown) => {
    const minutes = Number.parseInt(normalizeText(value), 10);
    if (!Number.isFinite(minutes) || minutes <= 0) return '';
    return new Date(Date.now() + minutes * 60_000).toISOString();
  };

  const formatInviteExpiryLabel = (expiresAt: string) => {
    const timestamp = Date.parse(normalizeText(expiresAt));
    if (!Number.isFinite(timestamp)) return '';
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      month: '2-digit',
    }).format(new Date(timestamp));
  };

  const buildInviteUrlFromCode = (code: string) => {
    const normalizedCode = normalizeText(code).toLowerCase();
    if (!normalizedCode) return '';
    const url = new URL('/room', window.location.origin);
    url.searchParams.set('invite', normalizedCode);
    return url.toString();
  };

  const normalizeInviteUrl = (rawUrl: unknown, code: unknown = '') => {
    const normalizedCode = normalizeText(code).toLowerCase();
    if (normalizedCode) {
      return buildInviteUrlFromCode(normalizedCode);
    }

    const normalizedRawUrl = normalizeText(rawUrl);
    if (!normalizedRawUrl) return '';

    try {
      const parsed = new URL(normalizedRawUrl, window.location.origin);
      const normalized = new URL(`${parsed.pathname}${parsed.search}${parsed.hash}`, window.location.origin);
      return normalized.toString();
    } catch {
      return normalizedRawUrl;
    }
  };

  const syncInviteExpirySelect = (inviteType: 'external' | 'student', expiresAt: string) => {
    const select = inviteType === 'external' ? externalInviteExpirySelect : studentInviteExpirySelect;
    if (!(select instanceof HTMLSelectElement)) return;
    const normalizedExpiresAt = normalizeText(expiresAt);
    if (!normalizedExpiresAt) {
      select.value = '';
      return;
    }
    const diffMinutes = Math.round((Date.parse(normalizedExpiresAt) - Date.now()) / 60_000);
    if (Math.abs(diffMinutes - 60) <= 2) {
      select.value = '60';
      return;
    }
    if (Math.abs(diffMinutes - 1440) <= 15) {
      select.value = '1440';
      return;
    }
    if (Math.abs(diffMinutes - 10080) <= 120) {
      select.value = '10080';
      return;
    }
    select.value = '';
  };

  const syncInviteLinkOutput = (
    inviteType: 'external' | 'student',
    nextUrl = '',
    nextCode = '',
  ) => {
    const normalizedUrl = normalizeInviteUrl(nextUrl, nextCode);
    const normalizedCode = normalizeText(nextCode).toLowerCase();

    if (inviteType === 'external') {
      currentExternalInviteUrl = normalizedUrl;
      currentExternalInviteCode = normalizedCode;
      if (externalInviteLinkOutput instanceof HTMLInputElement) {
        externalInviteLinkOutput.value = currentExternalInviteUrl;
      }
      if (externalInviteCopyButton instanceof HTMLButtonElement) {
        externalInviteCopyButton.disabled = !currentExternalInviteUrl || localRole !== 'teacher';
      }
      if (externalInviteRevokeButton instanceof HTMLButtonElement) {
        externalInviteRevokeButton.disabled = !currentExternalInviteCode || localRole !== 'teacher';
      }
      return;
    }

    currentStudentInviteUrl = normalizedUrl;
    currentStudentInviteCode = normalizedCode;
    if (studentInviteLinkOutput instanceof HTMLInputElement) {
      studentInviteLinkOutput.value = currentStudentInviteUrl;
    }
    if (studentInviteCopyButton instanceof HTMLButtonElement) {
      studentInviteCopyButton.disabled = !currentStudentInviteUrl || localRole !== 'teacher';
    }
    if (studentInviteRevokeButton instanceof HTMLButtonElement) {
      studentInviteRevokeButton.disabled = !currentStudentInviteCode || localRole !== 'teacher';
    }
  };

  const openExternalInviteGate = () => {
    if (!(externalInviteGate instanceof HTMLElement)) return;
    externalInviteGate.hidden = false;
    window.requestAnimationFrame(() => {
      if (externalInviteNameInput instanceof HTMLInputElement && !externalInviteNameInput.value.trim()) {
        externalInviteNameInput.focus();
        return;
      }
      if (externalInviteEmailInput instanceof HTMLInputElement && !externalInviteEmailInput.value.trim()) {
        externalInviteEmailInput.focus();
        return;
      }
      if (externalInvitePasswordInput instanceof HTMLInputElement) {
        externalInvitePasswordInput.focus();
      }
    });
  };

  const closeExternalInviteGate = () => {
    if (externalInviteGate instanceof HTMLElement) {
      externalInviteGate.hidden = true;
    }
  };

  const leaveExternalInviteFlow = () => {
    window.location.assign('/');
  };

  const createInviteLink = async (inviteType: 'external' | 'student') => {
    if (localRole !== 'teacher') {
      if (inviteType === 'external') {
        setExternalInviteStatusMessage('Solo teachers pueden generar invites externos.', true);
      } else {
        setStudentInviteStatusMessage('Solo teachers pueden generar invites para estudiantes.', true);
      }
      return;
    }

    const password = inviteType === 'external' && externalInviteTeacherPasswordInput instanceof HTMLInputElement
      ? externalInviteTeacherPasswordInput.value
      : '';
    if (
      inviteType === 'external' &&
      !normalizeText(password) &&
      !currentExternalInviteCode
    ) {
      setExternalInviteStatusMessage('Define un password antes de generar el link externo.', true);
      if (externalInviteTeacherPasswordInput instanceof HTMLInputElement) {
        externalInviteTeacherPasswordInput.focus();
      }
      return;
    }

    const roomName = roomInput.value.trim();
    if (!roomName) {
      setExternalInviteStatusMessage('La sala necesita un nombre antes de generar el invite.', true);
      roomInput.focus();
      return;
    }

    const expiresAt = resolveInviteExpiryIso(
      inviteType === 'external'
        ? externalInviteExpirySelect instanceof HTMLSelectElement
          ? externalInviteExpirySelect.value
          : ''
        : studentInviteExpirySelect instanceof HTMLSelectElement
          ? studentInviteExpirySelect.value
          : '',
    );
    const activeCreateButton = inviteType === 'external'
      ? externalInviteCreateButton
      : studentInviteCreateButton;
    const activeCopyButton = inviteType === 'external'
      ? externalInviteCopyButton
      : studentInviteCopyButton;

    if (activeCreateButton instanceof HTMLButtonElement) {
      activeCreateButton.disabled = true;
    }
    if (activeCopyButton instanceof HTMLButtonElement) {
      activeCopyButton.disabled = true;
    }

    if (inviteType === 'external') {
      setExternalInviteStatusMessage('Guardando invite externo...');
    } else {
      setStudentInviteStatusMessage('Guardando invite para estudiantes...');
    }

    try {
      const selectedPresentationHref = normalizeText(presentationSelect.value) || presentation.getHref();
      const response = await fetch('/api/live/invite', {
        body: JSON.stringify({
          code: inviteType === 'external' ? currentExternalInviteCode : currentStudentInviteCode,
          courseId: getEffectiveCourseId(),
          displayName: roomName,
          expiresAt,
          inviteType,
          pageSlug: getCurrentPresentationPageSlug(),
          password,
          presentationHref: inviteType === 'student' ? normalizeText(selectedPresentationHref) : '',
          room: roomName,
        }),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !normalizeText(payload?.inviteUrl)) {
        throw new Error(
          normalizeText(payload?.error) ||
            (inviteType === 'external'
              ? 'No fue posible generar el link externo.'
              : 'No fue posible generar el link de estudiantes.'),
        );
      }

      const inviteCodeFromPayload = normalizeText(payload?.invite?.code);
      const inviteUrl = normalizeInviteUrl(payload?.inviteUrl, inviteCodeFromPayload);
      syncInviteLinkOutput(inviteType, inviteUrl, inviteCodeFromPayload);
      syncInviteExpirySelect(inviteType, normalizeText(payload?.invite?.expiresAt));
      const expiryLabel = formatInviteExpiryLabel(normalizeText(payload?.invite?.expiresAt));
      const successMessage = expiryLabel
        ? `Link actualizado. Expira ${expiryLabel}.`
        : 'Link actualizado sin vencimiento.';
      if (inviteType === 'external') {
        setExternalInviteStatusMessage(successMessage);
      } else {
        setStudentInviteStatusMessage(successMessage);
      }
    } catch (error) {
      if (inviteType === 'external') {
        setExternalInviteStatusMessage(safeErrorMessage(error), true);
      } else {
        setStudentInviteStatusMessage(safeErrorMessage(error), true);
      }
    } finally {
      if (activeCreateButton instanceof HTMLButtonElement) {
        activeCreateButton.disabled = false;
      }
      if (activeCopyButton instanceof HTMLButtonElement) {
        activeCopyButton.disabled =
          inviteType === 'external'
            ? !currentExternalInviteUrl || localRole !== 'teacher'
            : !currentStudentInviteUrl || localRole !== 'teacher';
      }
    }
  };

  const revokeInviteLink = async (inviteType: 'external' | 'student') => {
    if (localRole !== 'teacher') return;

    const currentCode = inviteType === 'external' ? currentExternalInviteCode : currentStudentInviteCode;
    if (!currentCode) {
      if (inviteType === 'external') {
        setExternalInviteStatusMessage('No hay invite externo activo para revocar.', true);
      } else {
        setStudentInviteStatusMessage('No hay invite de estudiantes activo para revocar.', true);
      }
      return;
    }

    try {
      const response = await fetch('/api/live/invite', {
        body: JSON.stringify({
          action: 'revoke',
          code: currentCode,
          courseId: getEffectiveCourseId(),
          inviteType,
          room: roomInput.value.trim(),
        }),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          normalizeText(payload?.error) ||
            (inviteType === 'external'
              ? 'No fue posible revocar el invite externo.'
              : 'No fue posible revocar el invite de estudiantes.'),
        );
      }

      syncInviteLinkOutput(inviteType, '', '');
      syncInviteExpirySelect(inviteType, '');
      if (inviteType === 'external') {
        setExternalInviteStatusMessage('Invite externo revocado.');
      } else {
        setStudentInviteStatusMessage('Invite de estudiantes revocado.');
      }
    } catch (error) {
      if (inviteType === 'external') {
        setExternalInviteStatusMessage(safeErrorMessage(error), true);
      } else {
        setStudentInviteStatusMessage(safeErrorMessage(error), true);
      }
    }
  };

  const loadInviteLink = async (inviteType: 'external' | 'student') => {
    if (localRole !== 'teacher') return;

    const roomName = roomInput.value.trim();
    if (!roomName) {
      syncInviteLinkOutput(inviteType, '', '');
      return;
    }

    try {
      const url = new URL('/api/live/invite', window.location.origin);
      url.searchParams.set('inviteType', inviteType);
      url.searchParams.set('room', roomName);
      const effectiveCourseId = getEffectiveCourseId();
      if (effectiveCourseId) {
        url.searchParams.set('courseId', effectiveCourseId);
      }
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
        },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(normalizeText(payload?.error) || 'No fue posible cargar el invite.');
      }
      const invite = payload?.invite;
      const nextCode = normalizeText(invite?.code);
      const nextUrl = buildInviteUrlFromCode(nextCode);
      syncInviteLinkOutput(inviteType, nextUrl, nextCode);
      syncInviteExpirySelect(inviteType, normalizeText(invite?.expiresAt));
      const expiryLabel = formatInviteExpiryLabel(normalizeText(invite?.expiresAt));
      const statusMessage = nextCode
        ? expiryLabel
          ? `Invite activo. Expira ${expiryLabel}.`
          : 'Invite activo sin vencimiento.'
        : inviteType === 'external'
          ? 'No hay invite externo activo.'
          : 'No hay invite de estudiantes activo.';
      if (inviteType === 'external') {
        setExternalInviteStatusMessage(statusMessage);
      } else {
        setStudentInviteStatusMessage(statusMessage);
      }
    } catch (error) {
      if (inviteType === 'external') {
        setExternalInviteStatusMessage(safeErrorMessage(error), true);
      } else {
        setStudentInviteStatusMessage(safeErrorMessage(error), true);
      }
    }
  };

  const copyInviteLinkByType = async (inviteType: 'external' | 'student') => {
    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard API is not available in this browser.');
    }
    const inviteUrl = inviteType === 'external' ? currentExternalInviteUrl : currentStudentInviteUrl;
    if (!inviteUrl) {
      throw new Error(
        inviteType === 'external'
          ? 'No external invite link is available yet.'
          : 'No student invite link is available yet.',
      );
    }
    await navigator.clipboard.writeText(inviteUrl);
    if (inviteType === 'external') {
      setExternalInviteStatusMessage('Link externo copiado.');
      setStatus('Link externo copiado.');
    } else {
      setStudentInviteStatusMessage('Link estudiantes copiado.');
      setStatus('Link estudiantes copiado.');
    }
  };

  const setGraphVisible = (open: boolean, source: 'local' | 'remote' = 'local') => {
    graphVisible = open;
    window.dispatchEvent(
      new CustomEvent('graph:set', {
        detail: {
          open,
          source,
        },
      }),
    );
  };

  const triggerGraphToggle = () => {
    setGraphVisible(!graphVisible, 'local');
  };

  const openGlobalSearch = () => {
    const openSearch = (window as Window & { openSearch?: () => void }).openSearch;
    if (typeof openSearch === 'function') {
      openSearch();
    }
  };

  const searchWindow = window as Window & {
    handleSearchNavigation?: (payload: { href: string; title?: string }) => boolean | Promise<boolean>;
  };
  const previousSearchNavigationHandler = searchWindow.handleSearchNavigation;

  const normalizeRoomSearchHref = (value: string) => {
    const raw = normalizeText(value);
    if (!raw) return null;

    try {
      const url = new URL(raw, window.location.origin);
      if (url.origin !== window.location.origin) return null;

      if (url.pathname.startsWith('/cursos/') && !url.pathname.startsWith('/cursos/slides/')) {
        url.pathname = url.pathname.replace('/cursos/', '/cursos/slides/');
      }

      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return null;
    }
  };

  let _statusClearTimer: ReturnType<typeof setTimeout> | null = null;
  const setStatus = (message: string, autoClearMs = 4000) => {
    if (!(statusNode instanceof HTMLElement)) return;
    statusNode.textContent = message;
    statusNode.dataset.visible = message ? 'true' : 'false';
    if (_statusClearTimer) clearTimeout(_statusClearTimer);
    if (autoClearMs > 0 && message) {
      _statusClearTimer = setTimeout(() => {
        if (!(statusNode instanceof HTMLElement)) return;
        statusNode.textContent = '';
        statusNode.dataset.visible = 'false';
        _statusClearTimer = null;
      }, autoClearMs);
    }
  };

  const applySidebarCollapsedState = () => {
    root.dataset.sidebarCollapsed = sidebarCollapsed ? 'true' : 'false';
    if (sidebarToggleButton instanceof HTMLButtonElement) {
      sidebarToggleButton.dataset.collapsed = sidebarCollapsed ? 'true' : 'false';
      sidebarToggleButton.title = sidebarCollapsed
        ? 'Abrir sidebar (Cmd/Ctrl + Shift + \\)'
        : 'Plegar sidebar (Cmd/Ctrl + Shift + \\)';
      sidebarToggleButton.setAttribute(
        'aria-label',
        sidebarCollapsed ? 'Abrir sidebar' : 'Plegar sidebar',
      );
      sidebarToggleButton.setAttribute('aria-pressed', sidebarCollapsed ? 'true' : 'false');
    }
    window.setTimeout(updateRecordingGuideLayout, 0);
  };

  const applyPreviewZoomState = () => {
    root.style.setProperty('--conference-self-preview-zoom', previewZoom.toFixed(2));
    root.style.setProperty('--conference-circle-preview-zoom', presentationCircleZoom.toFixed(2));
    if (previewZoomInput instanceof HTMLInputElement) {
      previewZoomInput.value = previewZoom.toFixed(2);
    }
    if (previewZoomOutput instanceof HTMLOutputElement || previewZoomOutput instanceof HTMLElement) {
      previewZoomOutput.textContent = `${previewZoom.toFixed(2)}x`;
    }
  };

  const applyShowCircleState = () => {
    root.dataset.showCircle = showPresentationCircle ? 'true' : 'false';
    if (showCircleInput instanceof HTMLInputElement) {
      showCircleInput.checked = showPresentationCircle;
    }
  };

  const setBackgroundImageStatus = (message: string, isError = false) => {
    if (!(backgroundImageStatus instanceof HTMLElement)) return;
    backgroundImageStatus.textContent = message;
    backgroundImageStatus.dataset.error = isError ? 'true' : 'false';
  };

  const revokeBackgroundImageObjectUrl = () => {
    if (!backgroundImageObjectUrl) return;
    URL.revokeObjectURL(backgroundImageObjectUrl);
    backgroundImageObjectUrl = '';
  };

  const syncBackgroundImagePreview = () => {
    const hasPreview = Boolean(backgroundImageUrl);
    if (backgroundImagePreviewShell instanceof HTMLElement) {
      backgroundImagePreviewShell.hidden = !hasPreview;
    }
    if (backgroundImagePreview instanceof HTMLImageElement) {
      backgroundImagePreview.src = hasPreview ? backgroundImageUrl : '';
    }
    if (backgroundImageLabel instanceof HTMLElement) {
      backgroundImageLabel.textContent = hasPreview
        ? backgroundImageSelectionLabel || 'Selected image'
        : 'No image selected';
    }
  };

  const renderBackgroundImageSearchResults = () => {
    if (!(backgroundImageResults instanceof HTMLElement)) return;
    if (backgroundImageSearchButton instanceof HTMLButtonElement) {
      backgroundImageSearchButton.disabled = backgroundImageSearchLoading;
    }

    const shouldShow =
      Boolean(
        backgroundImageSearchQuery || backgroundImageSearchLoading || backgroundImageSearchResultsState.length > 0,
      );

    backgroundImageResults.hidden = !shouldShow;
    backgroundImageResults.replaceChildren();
    if (!shouldShow) return;

    if (backgroundImageSearchLoading) {
      const loadingState = document.createElement('div');
      loadingState.className = 'conference-background-inline-status';
      loadingState.textContent = 'Searching images...';
      backgroundImageResults.appendChild(loadingState);
      return;
    }

    if (backgroundImageSearchResultsState.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'conference-background-inline-status';
      emptyState.textContent = backgroundImageSearchQuery
        ? 'No image results for that search.'
        : 'Search Google Images from here.';
      backgroundImageResults.appendChild(emptyState);
      return;
    }

    backgroundImageSearchResultsState.forEach((result) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'conference-background-result';

      const preview = document.createElement('img');
      preview.alt = '';
      preview.loading = 'lazy';
      preview.decoding = 'async';
      preview.src = result.thumbnailUrl || result.imageUrl;

      const meta = document.createElement('span');
      meta.className = 'conference-background-result-meta';

      const title = document.createElement('strong');
      title.textContent = result.title || 'Image result';

      const subtitle = document.createElement('span');
      subtitle.textContent = result.sourceLabel || 'Google Images';

      meta.append(title, subtitle);
      button.append(preview, meta);
      button.addEventListener('click', () => {
        revokeBackgroundImageObjectUrl();
        backgroundImageUrl = buildBackgroundImageProxyUrl(result.imageUrl);
        backgroundImageSelectionLabel = result.title || result.sourceLabel || 'Google Images';
        backgroundEffectMode = 'image';
        applyBackgroundEffectState();
        syncBackgroundImagePreview();
        persistSetupState();
        setBackgroundImageStatus('Background image selected.');
        closeBackgroundReplacePopup();
        void refreshBackgroundVideoProcessing().catch((error) => {
          setStatus(safeErrorMessage(error));
        });
      });
      backgroundImageResults.appendChild(button);
    });
  };

  const clearBackgroundImageSearchResults = () => {
    backgroundImageSearchLoading = false;
    backgroundImageSearchQuery = '';
    backgroundImageSearchResultsState = [];
    renderBackgroundImageSearchResults();
  };

  const openBackgroundReplacePopup = () => {
    backgroundReplacePopupOpen = true;
    if (backgroundReplacePopup instanceof HTMLElement) {
      backgroundReplacePopup.hidden = false;
    }
    renderBackgroundImageSearchResults();
    syncBackgroundImagePreview();
    if (backgroundImageSearchInput instanceof HTMLInputElement) {
      window.setTimeout(() => {
        backgroundImageSearchInput.focus();
      }, 0);
    }
  };

  const closeBackgroundReplacePopup = () => {
    backgroundReplacePopupOpen = false;
    if (backgroundReplacePopup instanceof HTMLElement) {
      backgroundReplacePopup.hidden = true;
    }
  };

  const applyBackgroundEffectState = () => {
    previewBlur = backgroundEffectMode === 'blur';
    root.dataset.previewBlur = previewBlur ? 'true' : 'false';
    root.dataset.backgroundEffect = backgroundEffectMode;
    localCameraProcessorState.backgroundColor = backgroundColor;
    localCameraProcessorState.backgroundEffectMode = backgroundEffectMode;
    localCameraProcessorState.backgroundImageUrl = backgroundImageUrl;
    localCameraProcessorState.blurEnabled = previewBlur;
    if (backgroundBlurToggleButton instanceof HTMLButtonElement) {
      backgroundBlurToggleButton.dataset.active = previewBlur ? 'true' : 'false';
      backgroundBlurToggleButton.setAttribute('aria-pressed', previewBlur ? 'true' : 'false');
    }
    if (backgroundReplaceToggleButton instanceof HTMLButtonElement) {
      const replaceActive = backgroundEffectMode === 'image' || backgroundEffectMode === 'color';
      backgroundReplaceToggleButton.dataset.active = replaceActive ? 'true' : 'false';
      backgroundReplaceToggleButton.setAttribute('aria-pressed', replaceActive ? 'true' : 'false');
    }
    if (backgroundColorInput instanceof HTMLInputElement) {
      backgroundColorInput.value = backgroundColor;
    }
    syncBackgroundImagePreview();
    renderBackgroundImageSearchResults();
  };

  const syncLocalVideoDisplayFlip = () => {
    const shouldMirrorViaCss =
      previewInvert &&
      room.state !== ConnectionState.Connected &&
      !isDisconnectedPreviewProcessingActive();
    root.style.setProperty('--conference-local-video-flip', shouldMirrorViaCss ? '-1' : '1');
  };

  const applyPreviewInvertState = () => {
    root.dataset.previewInvert = previewInvert ? 'true' : 'false';
    localCameraProcessorState.invertEnabled = previewInvert;
    syncLocalVideoDisplayFlip();
    if (previewInvertInput instanceof HTMLInputElement) {
      previewInvertInput.checked = previewInvert;
    }
  };

  const setRecordingGuideSuppressed = (active: boolean) => {
    root.dataset.recordingGuideSuppressed = active ? 'true' : 'false';
  };

  const updateRecordingGuideLayout = () => {
    if (!(recordingGuide instanceof HTMLElement)) return;
    const preset = getRecordingPresetConfig(recordingPreset);
    const shouldShowGuide = preset.key !== 'landscape-1080';
    root.dataset.recordingGuideVisible = shouldShowGuide ? 'true' : 'false';

    if (!shouldShowGuide) {
      recordingGuide.style.left = '0px';
      recordingGuide.style.top = '0px';
      recordingGuide.style.width = '0px';
      recordingGuide.style.height = '0px';
      return;
    }

    const width = Math.max(2, stageFrame.clientWidth);
    const height = Math.max(2, stageFrame.clientHeight);
    const crop = getAspectFitRect(width, height, preset.width / preset.height);
    recordingGuide.style.left = `${Math.round(crop.x)}px`;
    recordingGuide.style.top = `${Math.round(crop.y)}px`;
    recordingGuide.style.width = `${Math.round(crop.width)}px`;
    recordingGuide.style.height = `${Math.round(crop.height)}px`;
  };

  const applyRecordingPresetState = () => {
    const normalizedPreset = getRecordingPresetConfig(recordingPreset);
    recordingPreset = normalizedPreset.key;
    root.dataset.recordingPreset = normalizedPreset.key;
    if (recordingPresetSelect instanceof HTMLSelectElement) {
      recordingPresetSelect.value = normalizedPreset.key;
    }
    updateRecordingGuideLayout();
  };

  const getWaveformMorphLabel = (morph: number) => {
    const normalized = clamp01(morph);
    const segments = [
      ['SIN', 'TRI'],
      ['TRI', 'SAW'],
      ['SAW', 'SQUARE'],
    ] as const;
    const scaled = normalized * segments.length;
    const index = Math.min(segments.length - 1, Math.floor(scaled));
    const fraction = scaled - index;
    const [left, right] = segments[index];
    if (fraction <= 0.02) return left;
    if (fraction >= 0.98) return right;
    return `${left}/${right}`;
  };

  const applyHandControlMapping = (controls: HandControlValues): HandControlValues => ({
    carrier: remapHandControl(controls.carrier, synthControlRanges.carrier),
    modulator: remapHandControl(controls.modulator, synthControlRanges.modulator),
    gain: remapHandControl(controls.gain, synthControlRanges.gain),
    cutoff: remapHandControl(controls.cutoff, synthControlRanges.cutoff),
    resonance: remapHandControl(controls.resonance, synthControlRanges.resonance),
    waveformMorph: remapHandControl(controls.waveformMorph, synthControlRanges.waveformMorph),
    distortion: remapHandControl(controls.distortion, synthControlRanges.distortion),
  });

  const buildHandSynthTelemetry = (controls: HandControlValues): HandSynthTelemetry => {
    const mapped = applyHandControlMapping(controls);
    return {
      carrier: roundTo(lerp(20, 1320, mapped.carrier), 0),
      modulator: roundTo(Math.exp(lerp(Math.log(30), Math.log(1600), mapped.modulator)), 0),
      distortion: roundTo(mapped.distortion, 2),
      gain: roundTo(mapped.gain, 2),
      cutoff: roundTo(Math.exp(lerp(Math.log(140), Math.log(7600), mapped.cutoff)), 0),
      resonance: roundTo(lerp(0.8, 18, mapped.resonance), 1),
      waveformMorph: roundTo(mapped.waveformMorph, 2),
    };
  };

  const renderSynthTelemetry = (telemetry: HandSynthTelemetry) => {
    if (synthCarrierInput instanceof HTMLInputElement) {
      synthCarrierInput.value = String(Math.round(telemetry.carrier));
    }
    if (synthCarrierOutput instanceof HTMLOutputElement || synthCarrierOutput instanceof HTMLElement) {
      synthCarrierOutput.textContent = `${Math.round(telemetry.carrier)} Hz`;
    }

    if (synthModulatorInput instanceof HTMLInputElement) {
      synthModulatorInput.value = String(Math.round(telemetry.modulator));
    }
    if (synthModulatorOutput instanceof HTMLOutputElement || synthModulatorOutput instanceof HTMLElement) {
      synthModulatorOutput.textContent = `${Math.round(telemetry.modulator)} Hz`;
    }

    if (synthGainInput instanceof HTMLInputElement) {
      synthGainInput.value = telemetry.gain.toFixed(2);
    }
    if (synthGainOutput instanceof HTMLOutputElement || synthGainOutput instanceof HTMLElement) {
      synthGainOutput.textContent = telemetry.gain.toFixed(2);
    }

    if (synthCutoffInput instanceof HTMLInputElement) {
      synthCutoffInput.value = String(Math.round(telemetry.cutoff));
    }
    if (synthCutoffOutput instanceof HTMLOutputElement || synthCutoffOutput instanceof HTMLElement) {
      synthCutoffOutput.textContent = `${Math.round(telemetry.cutoff)} Hz`;
    }

    if (synthResonanceInput instanceof HTMLInputElement) {
      synthResonanceInput.value = telemetry.resonance.toFixed(1);
    }
    if (
      synthResonanceOutput instanceof HTMLOutputElement ||
      synthResonanceOutput instanceof HTMLElement
    ) {
      synthResonanceOutput.textContent = `${telemetry.resonance.toFixed(1)} Q`;
    }

    if (synthWaveformInput instanceof HTMLInputElement) {
      synthWaveformInput.value = telemetry.waveformMorph.toFixed(2);
    }
    if (synthWaveformOutput instanceof HTMLOutputElement || synthWaveformOutput instanceof HTMLElement) {
      synthWaveformOutput.textContent = getWaveformMorphLabel(telemetry.waveformMorph);
    }

    if (synthDistortionInput instanceof HTMLInputElement) {
      synthDistortionInput.value = telemetry.distortion.toFixed(2);
    }
    if (
      synthDistortionOutput instanceof HTMLOutputElement ||
      synthDistortionOutput instanceof HTMLElement
    ) {
      synthDistortionOutput.textContent = `${Math.round(telemetry.distortion * 100)}%`;
    }
  };

  const applyInstrumentsOpenState = () => {
    root.dataset.instrumentsOpen = instrumentsOpen ? 'true' : 'false';
    if (instrumentsToggleButton instanceof HTMLButtonElement) {
      instrumentsToggleButton.dataset.active = instrumentsOpen ? 'true' : 'false';
      instrumentsToggleButton.setAttribute('aria-pressed', instrumentsOpen ? 'true' : 'false');
      instrumentsToggleButton.title = instrumentsOpen
        ? 'Hide Instruments (Cmd/Ctrl + \\)'
        : 'Instruments (Cmd/Ctrl + \\)';
    }
  };

  const applyHandTrackState = () => {
    root.dataset.handTrack = handTrackEnabled ? 'true' : 'false';
    localCameraHandOverlayState.enabled = handTrackEnabled;
    localCameraProcessorState.overlayEnabled = handTrackEnabled;
    if (handTrackInput instanceof HTMLInputElement) {
      handTrackInput.checked = handTrackEnabled;
    }
    if (handTrackToggleButton instanceof HTMLButtonElement) {
      handTrackToggleButton.dataset.active = handTrackEnabled ? 'true' : 'false';
      handTrackToggleButton.setAttribute('aria-pressed', handTrackEnabled ? 'true' : 'false');
    }
  };

  const shouldRunHandTracking = () => handTrackEnabled || gravityBallEnabled;

  const applyGravityBallState = () => {
    root.dataset.gravityBall = gravityBallEnabled ? 'true' : 'false';
    localCameraGravityBallStreamState.enabled = gravityBallEnabled;
    applyGravityBallStageVisibilityState();
    if (gravityBallInput instanceof HTMLInputElement) {
      gravityBallInput.checked = gravityBallEnabled;
    }
    if (gravityBallToggleButton instanceof HTMLButtonElement) {
      gravityBallToggleButton.dataset.active = gravityBallEnabled ? 'true' : 'false';
      gravityBallToggleButton.setAttribute('aria-pressed', gravityBallEnabled ? 'true' : 'false');
    }
    if (gravityBallGravityInput instanceof HTMLInputElement) {
      gravityBallGravityInput.value = gravityBallGravity.toFixed(2);
      gravityBallGravityInput.disabled = !gravityBallEnabled || !canUseInstruments();
    }
    if (gravityBallInput instanceof HTMLInputElement) {
      gravityBallInput.disabled = !canUseInstruments();
    }
    gravityBallRenderer?.setGravity(gravityBallGravity);
    gravityBallRenderer?.setEnabled(gravityBallEnabled);
    gravityBallRenderer?.setEnvMirrorEnabled(gravityBallMirror);
    if (gravityBallRenderer) {
      gravityBallRenderer.setAudioChannelGain(mixerBallMuted ? 0 : mixerBallGain);
      gravityBallRenderer.setAudioChannelPan(mixerBallPan);
    }
  };

  const applyGravityBallStageVisibilityState = () => {
    const stageVisible =
      gravityBallEnabled &&
      room.state !== ConnectionState.Connected &&
      !isDisconnectedPreviewProcessingActive();
    root.dataset.gravityBallStageVisible = stageVisible ? 'true' : 'false';
  };

  const applyHandRampState = () => {
    if (handRampInput instanceof HTMLInputElement) {
      handRampInput.value = String(Math.round(handRampMs));
    }
    fmSynth.setHandRampTimeMs(handRampMs);
  };

  const canUseInstruments = () => localRole === 'teacher' || sessionAllowsInstruments;

  const forceSessionInstrumentShutdown = () => {
    if (localRole !== 'student') return;
    if (handTrackEnabled) {
      handTrackEnabled = false;
      applyHandTrackState();
    }
    if (gravityBallEnabled) {
      gravityBallEnabled = false;
      applyGravityBallState();
    }
    stopHandTracking();
    fmSynth.clearHand();
    void unpublishSynthTrack().catch(() => undefined);
    void unpublishBallTrack().catch(() => undefined);
    if (room.state === ConnectionState.Connected) {
      void syncLocalBackgroundBlurProcessor().catch(() => undefined);
    }
  };

  const applySessionControlState = () => {
    root.dataset.instrumentsAllowed = sessionAllowsInstruments ? 'true' : 'false';

    if (sessionControlsField instanceof HTMLElement) {
      sessionControlsField.hidden = localRole !== 'teacher';
    }

    if (sessionAllowInstrumentsInput instanceof HTMLInputElement) {
      sessionAllowInstrumentsInput.checked = sessionAllowsInstruments;
      sessionAllowInstrumentsInput.disabled =
        localRole !== 'teacher' ||
        (room.state === ConnectionState.Connected && !canLeadSession());
    }

    if (sessionMuteAllButton instanceof HTMLButtonElement) {
      sessionMuteAllButton.disabled =
        room.state !== ConnectionState.Connected || !canLeadSession();
    }

    const instrumentsEnabled = canUseInstruments();
    if (handTrackInput instanceof HTMLInputElement) {
      handTrackInput.disabled = !instrumentsEnabled;
    }
    if (handTrackToggleButton instanceof HTMLButtonElement) {
      handTrackToggleButton.disabled = !instrumentsEnabled;
    }
    if (gravityBallInput instanceof HTMLInputElement) {
      gravityBallInput.disabled = !instrumentsEnabled;
    }
    if (gravityBallToggleButton instanceof HTMLButtonElement) {
      gravityBallToggleButton.disabled = !instrumentsEnabled;
    }
    if (gravityBallGravityInput instanceof HTMLInputElement) {
      gravityBallGravityInput.disabled = !instrumentsEnabled || !gravityBallEnabled;
    }
    if (synthMappingResetButton instanceof HTMLButtonElement) {
      synthMappingResetButton.disabled = !instrumentsEnabled;
    }
    synthMapButtons.forEach((button) => {
      if (button instanceof HTMLButtonElement) {
        button.disabled = !instrumentsEnabled;
      }
    });
  };

  // ── Break rooms ───────────────────────────────────────────────────

  const toBreakRoomSlug = (label: string) =>
    label.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'sala';

  const toBreakRoomName = (base: string, label: string) =>
    `${base}__br__${toBreakRoomSlug(label)}`;

  const isInBreakRoom = () => Boolean(mainRoomName);

  const currentBreakRoomLabel = () => {
    const current = normalizeText(roomInput instanceof HTMLInputElement ? roomInput.value : '');
    return breakRoomsActive.find((r) => r.name === current)?.label ?? '';
  };

  /** Render the B-button popup. */
  const renderBreakRoomsPopup = () => {
    if (!(breakRoomsList instanceof HTMLElement)) return;

    breakRoomsList.innerHTML = '';

    const currentRoom = normalizeText(roomInput instanceof HTMLInputElement ? roomInput.value : '');
    const hasActiveRooms = breakRoomsActive.length > 0 || isInBreakRoom();

    if (breakRoomsPopupSetup instanceof HTMLElement) {
      breakRoomsPopupSetup.hidden = localRole !== 'teacher';
    }
    if (breakRoomsPopupDivider instanceof HTMLElement) {
      breakRoomsPopupDivider.hidden = !(localRole === 'teacher' && hasActiveRooms);
    }

    // "Return to main room" at top
    if (isInBreakRoom()) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '← Sala principal';
      btn.dataset.active = currentRoom === mainRoomName ? 'true' : 'false';
      btn.addEventListener('click', () => {
        void joinBreakRoom(mainRoomName, true);
      });
      li.appendChild(btn);
      breakRoomsList.appendChild(li);

      const div = document.createElement('li');
      div.className = 'conference-break-rooms-divider';
      div.setAttribute('aria-hidden', 'true');
      breakRoomsList.appendChild(div);
    }

    breakRoomsActive.forEach((br) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = br.label;
      btn.dataset.active = currentRoom === br.name ? 'true' : 'false';
      btn.addEventListener('click', () => {
        void joinBreakRoom(br.name, false);
      });
      li.appendChild(btn);
      breakRoomsList.appendChild(li);
    });

    if (breakRoomsActive.length === 0 && !isInBreakRoom() && localRole !== 'teacher') {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Sin break rooms activos';
      btn.disabled = true;
      li.appendChild(btn);
      breakRoomsList.appendChild(li);
    }

    // "Terminar" option — teachers only
    if (localRole === 'teacher' && (breakRoomsActive.length > 0 || isInBreakRoom())) {
      const divEnd = document.createElement('li');
      divEnd.className = 'conference-break-rooms-divider';
      divEnd.setAttribute('aria-hidden', 'true');
      breakRoomsList.appendChild(divEnd);

      const liEnd = document.createElement('li');
      const btnEnd = document.createElement('button');
      btnEnd.type = 'button';
      btnEnd.textContent = 'Terminar Break Rooms';
      btnEnd.dataset.end = 'true';
      btnEnd.addEventListener('click', () => {
        if (breakRoomsPopup instanceof HTMLElement) breakRoomsPopup.hidden = true;
        void handleBreakRoomsEnd();
      });
      liEnd.appendChild(btnEnd);
      breakRoomsList.appendChild(liEnd);
    }
  };

  /** Show/hide the B button shell + active state + T button. */
  const syncBreakRoomsShell = () => {
    if (!(breakRoomsShell instanceof HTMLElement)) return;
    const hasActive = breakRoomsActive.length > 0 || isInBreakRoom();
    // Teachers always see B; students only see it when rooms are active
    const show = localRole === 'teacher' ? true : hasActive;
    breakRoomsShell.hidden = !show;

    // Yellow B when break rooms are active (created or inside one)
    breakRoomsShell.dataset.active = hasActive ? 'true' : 'false';

    // Hover title on B shows current break room name
    if (breakRoomsBBtn instanceof HTMLElement) {
      const label = currentBreakRoomLabel();
      breakRoomsBBtn.title = label ? `Break Rooms — ${label}` : 'Break Rooms';
    }

    // C/T buttons visible only to teachers when break rooms are active
    const teacherActive = localRole === 'teacher' && (breakRoomsActive.length > 0 || isInBreakRoom());
    if (breakRoomsEndBtn instanceof HTMLElement) {
      breakRoomsEndBtn.hidden = !teacherActive;
    }
    if (breakRoomsKillBtn instanceof HTMLElement) {
      breakRoomsKillBtn.hidden = !teacherActive;
    }

    if (breakRoomsPopupSetup instanceof HTMLElement) {
      breakRoomsPopupSetup.hidden = localRole !== 'teacher';
    }
    if (breakRoomsPopupDivider instanceof HTMLElement) {
      breakRoomsPopupDivider.hidden = !(localRole === 'teacher' && hasActive);
    }
  };

  const getExternalMediaDefaultStatus = () => {
    if (!externalMediaSession) {
      return 'Pega un link de YouTube para abrir una sesión externa sincronizada.';
    }
    return `${externalMediaSession.provider === 'youtube' ? 'YouTube' : 'Media externa'} activa.`;
  };

  const setExternalMediaStatus = (message: string, isError = false, autoClearMs = 4000) => {
    if (!(externalMediaStatus instanceof HTMLElement)) return;
    externalMediaStatus.textContent = message || getExternalMediaDefaultStatus();
    externalMediaStatus.dataset.error = isError ? 'true' : 'false';
    if (externalMediaStatusClearTimer) {
      window.clearTimeout(externalMediaStatusClearTimer);
      externalMediaStatusClearTimer = null;
    }
    if (autoClearMs > 0) {
      externalMediaStatusClearTimer = window.setTimeout(() => {
        if (!(externalMediaStatus instanceof HTMLElement)) return;
        externalMediaStatus.textContent = getExternalMediaDefaultStatus();
        externalMediaStatus.dataset.error = 'false';
        externalMediaStatusClearTimer = null;
      }, autoClearMs);
    }
  };

  const renderExternalMediaSearchResults = () => {
    if (!(externalMediaResults instanceof HTMLElement)) return;

    const inputValue = normalizeText(externalMediaInput instanceof HTMLInputElement ? externalMediaInput.value : '');
    const isUrlInput = Boolean(normalizeYouTubeMediaUrl(inputValue));
    const shouldShowResults =
      !isUrlInput &&
      Boolean(externalMediaSearchQuery || externalMediaSearchLoading || externalMediaSearchResultsState.length > 0);

    externalMediaResults.hidden = !shouldShowResults;
    externalMediaResults.replaceChildren();
    if (!shouldShowResults) return;

    if (externalMediaSearchLoading) {
      const loadingState = document.createElement('div');
      loadingState.className = 'conference-external-media-results-empty';
      loadingState.textContent = 'Buscando en YouTube...';
      externalMediaResults.appendChild(loadingState);
      return;
    }

    if (externalMediaSearchResultsState.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'conference-external-media-results-empty';
      emptyState.textContent = externalMediaSearchQuery
        ? 'Sin resultados. Prueba otro término o pega el link.'
        : 'Escribe para buscar en YouTube.';
      externalMediaResults.appendChild(emptyState);
      return;
    }

    externalMediaSearchResultsState.forEach((result) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'conference-external-media-result';

      const thumb = document.createElement('img');
      thumb.className = 'conference-external-media-result-thumb';
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.decoding = 'async';
      thumb.src = result.thumbnailUrl || 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

      const meta = document.createElement('span');
      meta.className = 'conference-external-media-result-meta';

      const title = document.createElement('strong');
      title.className = 'conference-external-media-result-title';
      title.textContent = result.title;

      const subtitle = document.createElement('span');
      subtitle.className = 'conference-external-media-result-subtitle';
      const publishedYear = normalizeText(result.publishedAt) ? new Date(result.publishedAt).getFullYear() : '';
      subtitle.textContent = [result.channelTitle, Number.isFinite(publishedYear) ? String(publishedYear) : '']
        .filter(Boolean)
        .join(' / ');

      meta.append(title, subtitle);
      button.append(thumb, meta);
      button.addEventListener('click', () => {
        void applyExternalMediaSession(
          {
            currentTime: 0,
            mediaId: result.mediaId,
            playbackState: 'playing',
            provider: 'youtube',
            sourceUrl: buildYouTubeEmbedUrl(result.mediaId),
            title: result.title,
          },
          'local',
        );
      });
      externalMediaResults.appendChild(button);
    });
  };

  const clearExternalMediaSearchResults = () => {
    externalMediaSearchLoading = false;
    externalMediaSearchQuery = '';
    externalMediaSearchResultsState = [];
    renderExternalMediaSearchResults();
  };

  const runExternalMediaSearch = async (query: string) => {
    const normalizedQuery = normalizeText(query);
    if (normalizedQuery.length < 2 || normalizeYouTubeMediaUrl(normalizedQuery)) {
      clearExternalMediaSearchResults();
      return;
    }

    const requestId = externalMediaSearchRequestId + 1;
    externalMediaSearchRequestId = requestId;
    externalMediaSearchLoading = true;
    externalMediaSearchQuery = normalizedQuery;
    renderExternalMediaSearchResults();

    try {
      const searchUrl = new URL('/api/live/external-media/search', window.location.origin);
      const effectiveCourseId = getEffectiveCourseId();
      if (effectiveCourseId) {
        searchUrl.searchParams.set('courseId', effectiveCourseId);
      }
      searchUrl.searchParams.set('q', normalizedQuery);

      const response = await fetch(searchUrl, {
        headers: {
          Accept: 'application/json',
        },
      });
      const payload = await response.json().catch(() => null);
      if (requestId !== externalMediaSearchRequestId) return;

      if (!response.ok) {
        throw new Error(
          normalizeText(payload?.error) || 'No fue posible buscar en YouTube.',
        );
      }

      externalMediaSearchResultsState = Array.isArray(payload?.items)
        ? payload.items
            .map((item: any) => ({
              channelTitle: normalizeText(item?.channelTitle),
              mediaId: normalizeText(item?.mediaId),
              publishedAt: normalizeText(item?.publishedAt),
              thumbnailUrl: normalizeText(item?.thumbnailUrl),
              title: normalizeText(item?.title) || 'YouTube',
            }))
            .filter((item: ExternalMediaSearchResult) => item.mediaId)
        : [];
      externalMediaSearchLoading = false;
      externalMediaSearchQuery = normalizedQuery;
      renderExternalMediaSearchResults();
      setExternalMediaStatus(
        externalMediaSearchResultsState.length
          ? `${externalMediaSearchResultsState.length} resultados en YouTube.`
          : 'Sin resultados para esa búsqueda.',
        false,
        2200,
      );
    } catch (error) {
      if (requestId !== externalMediaSearchRequestId) return;
      externalMediaSearchLoading = false;
      externalMediaSearchResultsState = [];
      externalMediaSearchQuery = normalizedQuery;
      renderExternalMediaSearchResults();
      setExternalMediaStatus(safeErrorMessage(error), true, 4200);
    }
  };

  const clearBackgroundImageSelection = async () => {
    revokeBackgroundImageObjectUrl();
    backgroundImageUrl = '';
    backgroundImageSelectionLabel = '';
    if (backgroundEffectMode === 'image') {
      backgroundEffectMode = 'none';
    }
    applyBackgroundEffectState();
    persistSetupState();
    setBackgroundImageStatus('Background image cleared.');
    closeBackgroundReplacePopup();
    await refreshBackgroundVideoProcessing();
  };

  const applyBackgroundImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setBackgroundImageStatus('Please choose an image file.', true);
      return;
    }

    revokeBackgroundImageObjectUrl();
    backgroundImageObjectUrl = URL.createObjectURL(file);
    backgroundImageUrl = backgroundImageObjectUrl;
    backgroundImageSelectionLabel = normalizeText(file.name) || 'Uploaded image';
    backgroundEffectMode = 'image';
    applyBackgroundEffectState();
    persistSetupState();
    setBackgroundImageStatus('Background image loaded.');
    closeBackgroundReplacePopup();
    await refreshBackgroundVideoProcessing();
  };

  const runBackgroundImageSearch = async (query: string) => {
    const normalizedQuery = normalizeText(query);
    if (normalizedQuery.length < 2) {
      clearBackgroundImageSearchResults();
      setBackgroundImageStatus('Type at least 2 characters to search images.');
      return;
    }

    const requestId = backgroundImageSearchRequestId + 1;
    backgroundImageSearchRequestId = requestId;
    backgroundImageSearchLoading = true;
    backgroundImageSearchQuery = normalizedQuery;
    renderBackgroundImageSearchResults();
    setBackgroundImageStatus('Searching Google Images...');

    try {
      const searchUrl = new URL('/api/live/background-image/search', window.location.origin);
      searchUrl.searchParams.set('q', normalizedQuery);

      const response = await fetch(searchUrl, {
        headers: {
          Accept: 'application/json',
        },
      });
      const payload = await response.json().catch(() => null);
      if (requestId !== backgroundImageSearchRequestId) return;

      if (!response.ok) {
        throw new Error(normalizeText(payload?.error) || 'Image search failed.');
      }

      backgroundImageSearchResultsState = Array.isArray(payload?.items)
        ? payload.items
            .map((item: any) => ({
              imageUrl: normalizeText(item?.imageUrl),
              sourceLabel: normalizeText(item?.sourceLabel),
              sourceUrl: normalizeText(item?.sourceUrl),
              thumbnailUrl: normalizeText(item?.thumbnailUrl),
              title: normalizeText(item?.title) || 'Image result',
            }))
            .filter((item: BackgroundImageSearchResult) => item.imageUrl)
        : [];

      backgroundImageSearchLoading = false;
      backgroundImageSearchQuery = normalizedQuery;
      renderBackgroundImageSearchResults();
      setBackgroundImageStatus(
        backgroundImageSearchResultsState.length
          ? `${backgroundImageSearchResultsState.length} image results found.`
          : 'No image results for that search.',
      );
    } catch (error) {
      if (requestId !== backgroundImageSearchRequestId) return;
      backgroundImageSearchLoading = false;
      backgroundImageSearchResultsState = [];
      backgroundImageSearchQuery = normalizedQuery;
      renderBackgroundImageSearchResults();
      setBackgroundImageStatus(safeErrorMessage(error), true);
    }
  };

  const queueExternalMediaSearch = () => {
    const query = normalizeText(externalMediaInput instanceof HTMLInputElement ? externalMediaInput.value : '');
    if (externalMediaSearchDebounceId) {
      window.clearTimeout(externalMediaSearchDebounceId);
      externalMediaSearchDebounceId = 0;
    }

    if (!query || normalizeYouTubeMediaUrl(query)) {
      clearExternalMediaSearchResults();
      if (query && normalizeYouTubeMediaUrl(query)) {
        setExternalMediaStatus('Link detectado. Pulsa O para abrirlo.', false, 2200);
      }
      return;
    }

    externalMediaSearchDebounceId = window.setTimeout(() => {
      externalMediaSearchDebounceId = 0;
      void runExternalMediaSearch(query);
    }, 260);
  };

  const closeExternalMediaPopup = () => {
    if (externalMediaPopup instanceof HTMLElement) {
      externalMediaPopup.hidden = true;
    }
  };

  const stopExternalMediaSyncLoop = () => {
    if (!externalMediaSyncIntervalId) return;
    window.clearInterval(externalMediaSyncIntervalId);
    externalMediaSyncIntervalId = 0;
  };

  const getExternalMediaAuthority = () =>
    localRole === 'teacher' && (room.state !== ConnectionState.Connected || canLeadSession());

  const captureExternalMediaSessionSnapshot = (): ExternalMediaSessionState | null => {
    if (!externalMediaSession) return null;
    const videoData = externalMediaPlayer?.getVideoData?.() ?? {};
    return {
      ...externalMediaSession,
      currentTime: Math.max(
        0,
        Number(externalMediaPlayer?.getCurrentTime?.() ?? externalMediaSession.currentTime) || 0,
      ),
      mediaId: normalizeText(videoData.video_id) || externalMediaSession.mediaId,
      playbackState: externalMediaPlayerReady
        ? readYouTubePlaybackState(externalMediaPlayer)
        : externalMediaSession.playbackState,
      title: normalizeText(videoData.title) || externalMediaSession.title,
    };
  };

  const syncExternalMediaShell = () => {
    const isTeacher = localRole === 'teacher';
    const canControl = getExternalMediaAuthority();
    const isActive = Boolean(externalMediaSession);
    const playbackState = externalMediaSession?.playbackState ?? 'paused';

    if (externalMediaControlsShell instanceof HTMLElement) {
      externalMediaControlsShell.hidden = !isTeacher;
      externalMediaControlsShell.dataset.active = isActive ? 'true' : 'false';
    }

    if (externalMediaBtn instanceof HTMLButtonElement) {
      externalMediaBtn.disabled = isTeacher && room.state === ConnectionState.Connected ? !canLeadSession() : false;
      externalMediaBtn.title = isActive ? 'External Media activa' : 'External Media';
      externalMediaBtn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }

    if (externalMediaOpenButton instanceof HTMLButtonElement) {
      externalMediaOpenButton.disabled = !canControl;
    }

    if (externalMediaStage instanceof HTMLElement) {
      externalMediaStage.hidden = !isActive;
      externalMediaStage.dataset.playbackState = playbackState;
    }

    if (externalMediaTitle instanceof HTMLElement) {
      externalMediaTitle.textContent = externalMediaSession?.title || 'External Media Session';
    }

    if (externalMediaProviderLabel instanceof HTMLElement) {
      externalMediaProviderLabel.textContent = externalMediaSession?.provider === 'youtube'
        ? 'YouTube'
        : 'External Media';
    }

    if (externalMediaEmpty instanceof HTMLElement) {
      externalMediaEmpty.hidden = isActive && externalMediaPlayerReady;
      externalMediaEmpty.textContent = isActive
        ? 'Cargando YouTube sincronizado...'
        : 'Pega un link de YouTube para abrir una sesión externa sincronizada.';
    }

    if (externalMediaStatus instanceof HTMLElement && !externalMediaStatus.textContent?.trim()) {
      externalMediaStatus.textContent = getExternalMediaDefaultStatus();
      externalMediaStatus.dataset.error = 'false';
    }

    externalMediaPlayToggleButtons.forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      button.disabled = !isActive || !externalMediaPlayerReady || !canControl;
      const isPlaying = playbackState === 'playing';
      button.textContent = isPlaying ? '||' : 'P';
      button.title = isPlaying ? 'Pausar media externa' : 'Reproducir media externa';
      button.setAttribute('aria-label', isPlaying ? 'Pausar media externa' : 'Reproducir media externa');
    });

    externalMediaCloseButtons.forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      button.disabled = !isActive || !canControl;
    });

    stopExternalMediaSyncLoop();
    if (isActive && playbackState === 'playing' && canControl && room.state === ConnectionState.Connected) {
      externalMediaSyncIntervalId = window.setInterval(() => {
        void broadcastExternalMediaState('sync');
      }, 2500);
    }
  };

  const clearExternalMediaPlayer = () => {
    stopExternalMediaSyncLoop();
    externalMediaApplyingRemoteState = false;
    externalMediaPlayerReady = false;
    try {
      externalMediaPlayer?.destroy?.();
    } catch {
      // ignore teardown errors from YouTube iframe
    }
    externalMediaPlayer = null;
    if (externalMediaPlayerHost instanceof HTMLElement) {
      externalMediaPlayerHost.replaceChildren();
    }
  };

  const withExternalMediaRemoteGuard = (callback: () => void) => {
    externalMediaApplyingRemoteState = true;
    try {
      callback();
    } finally {
      window.setTimeout(() => {
        externalMediaApplyingRemoteState = false;
      }, 320);
    }
  };

  const broadcastExternalMediaState = async (
    action: 'open' | 'sync' | 'close',
    force = false,
  ) => {
    if (!getExternalMediaAuthority() || room.state !== ConnectionState.Connected) return;

    if (action === 'close') {
      await publishMessage({
        type: 'external-media',
        action: 'close',
      });
      externalMediaLastBroadcastAt = Date.now();
      return;
    }

    const snapshot = captureExternalMediaSessionSnapshot();
    if (!snapshot) return;

    const now = Date.now();
    if (!force && action === 'sync' && now - externalMediaLastBroadcastAt < 450) {
      return;
    }

    externalMediaSession = snapshot;
    await publishMessage({
      type: 'external-media',
      action,
      currentTime: snapshot.currentTime,
      mediaId: snapshot.mediaId,
      playbackState: snapshot.playbackState,
      provider: snapshot.provider,
      sourceUrl: snapshot.sourceUrl,
      title: snapshot.title,
    });
    externalMediaLastBroadcastAt = now;
  };

  const syncExternalMediaPlayerState = (session: ExternalMediaSessionState) => {
    const player = externalMediaPlayer;
    if (!externalMediaPlayerReady || !player) return;

    withExternalMediaRemoteGuard(() => {
      const currentTime = Math.max(0, Number(player.getCurrentTime?.() ?? 0) || 0);
      if (Math.abs(currentTime - session.currentTime) > 1.25) {
        player.seekTo(session.currentTime, true);
      }

      if (session.playbackState === 'playing') {
        player.playVideo();
      } else {
        player.pauseVideo();
      }
    });
  };

  const ensureExternalMediaPlayer = async (session: ExternalMediaSessionState) => {
    if (!(externalMediaPlayerHost instanceof HTMLElement)) return;
    const currentVideoId = normalizeText(externalMediaPlayer?.getVideoData?.()?.video_id);

    if (externalMediaPlayer && externalMediaPlayerReady && currentVideoId === session.mediaId) {
      syncExternalMediaPlayerState(session);
      return;
    }

    clearExternalMediaPlayer();
    const playerMount = document.createElement('div');
    playerMount.dataset.externalMediaPlayer = 'youtube';
    externalMediaPlayerHost.appendChild(playerMount);

    const Player = await loadYouTubePlayerApi();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (callback?: () => void) => {
        if (settled) return;
        settled = true;
        callback?.();
      };

      externalMediaPlayer = new Player(playerMount, {
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: 1,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          start: Math.max(0, Math.floor(session.currentTime)),
        },
        videoId: session.mediaId,
        width: '100%',
        events: {
          onReady: () => {
            externalMediaPlayerReady = true;
            const nextSnapshot = captureExternalMediaSessionSnapshot();
            if (nextSnapshot) {
              externalMediaSession = nextSnapshot;
            }
            syncExternalMediaPlayerState(session);
            syncExternalMediaShell();
            finish(resolve);
          },
          onStateChange: (event) => {
            const currentSession = externalMediaSession;
            if (!currentSession) return;
            const videoData = event.target.getVideoData?.() ?? {};
            externalMediaSession = {
              ...currentSession,
              currentTime: Math.max(0, Number(event.target.getCurrentTime?.() ?? currentSession.currentTime) || 0),
              mediaId: normalizeText(videoData.video_id) || currentSession.mediaId,
              playbackState: readYouTubePlaybackState(event.target),
              title: normalizeText(videoData.title) || currentSession.title,
            };
            syncExternalMediaShell();
            if (!externalMediaApplyingRemoteState && getExternalMediaAuthority()) {
              void broadcastExternalMediaState('sync');
            }
          },
        },
      });

      window.setTimeout(() => {
        finish(() => {
          reject(new Error('YouTube player tardó demasiado en responder.'));
        });
      }, 12000);
    });
  };

  const applyExternalMediaSession = async (
    nextSession: ExternalMediaSessionState | null,
    source: 'local' | 'remote',
  ) => {
    if (!nextSession) {
      externalMediaSession = null;
      clearExternalMediaPlayer();
      syncExternalMediaShell();
      if (source === 'local') {
        closeExternalMediaPopup();
        setExternalMediaStatus('Sesión externa cerrada.');
        if (room.state === ConnectionState.Connected) {
          await broadcastExternalMediaState('close', true);
        }
      }
      return;
    }

    externalMediaSession = {
      ...nextSession,
      currentTime: Math.max(0, Number(nextSession.currentTime) || 0),
      playbackState: nextSession.playbackState,
      title: normalizeText(nextSession.title) || 'YouTube',
    };
    syncExternalMediaShell();

    try {
      await ensureExternalMediaPlayer(externalMediaSession);
      externalMediaSession = captureExternalMediaSessionSnapshot() ?? externalMediaSession;
      syncExternalMediaShell();
      if (source === 'local') {
        closeExternalMediaPopup();
        if (externalMediaInput instanceof HTMLInputElement) {
          externalMediaInput.value = '';
        }
        clearExternalMediaSearchResults();
        setExternalMediaStatus('YouTube sincronizado listo.');
        if (room.state === ConnectionState.Connected) {
          await broadcastExternalMediaState('open', true);
        }
      }
    } catch (error) {
      if (source === 'local') {
        setExternalMediaStatus(safeErrorMessage(error), true, 5200);
      } else {
        setStatus(safeErrorMessage(error));
      }
      if (source === 'local') {
        externalMediaSession = null;
        clearExternalMediaPlayer();
        syncExternalMediaShell();
      }
    }
  };

  const openExternalMediaFromInput = async () => {
    if (!(externalMediaInput instanceof HTMLInputElement)) return;
    if (!getExternalMediaAuthority()) {
      syncExternalMediaShell();
      return;
    }

    const normalizedInput = normalizeText(externalMediaInput.value);
    const parsedMedia = normalizeYouTubeMediaUrl(normalizedInput);
    if (!parsedMedia) {
      await runExternalMediaSearch(normalizedInput);
      return;
    }

    setExternalMediaStatus('Cargando YouTube...');
    await applyExternalMediaSession(
      {
        currentTime: 0,
        mediaId: parsedMedia.mediaId,
        playbackState: 'playing',
        provider: 'youtube',
        sourceUrl: parsedMedia.sourceUrl,
        title: 'YouTube',
      },
      'local',
    );
  };

  const toggleExternalMediaPlayback = () => {
    if (!externalMediaSession || !externalMediaPlayerReady || !externalMediaPlayer || !getExternalMediaAuthority()) {
      syncExternalMediaShell();
      return;
    }

    if (externalMediaSession.playbackState === 'playing') {
      externalMediaPlayer.pauseVideo();
    } else {
      externalMediaPlayer.playVideo();
    }
  };

  let _brBlinkTimer: ReturnType<typeof setTimeout> | null = null;

  const startBBtnBlink = (continuous: boolean) => {
    if (!(breakRoomsBBtn instanceof HTMLElement)) return;
    if (_brBlinkTimer) { clearTimeout(_brBlinkTimer); _brBlinkTimer = null; }
    breakRoomsBBtn.classList.add('conference-break-rooms-btn--blink');
    if (!continuous) {
      _brBlinkTimer = setTimeout(() => {
        breakRoomsBBtn.classList.remove('conference-break-rooms-btn--blink');
        _brBlinkTimer = null;
      }, 2000);
    }
  };

  const stopBBtnBlink = () => {
    if (!(breakRoomsBBtn instanceof HTMLElement)) return;
    if (_brBlinkTimer) { clearTimeout(_brBlinkTimer); _brBlinkTimer = null; }
    breakRoomsBBtn.classList.remove('conference-break-rooms-btn--blink');
  };

  let _brCountdownTimer: ReturnType<typeof setInterval> | null = null;
  let _brPollTimer: ReturnType<typeof setInterval> | null = null;

  /** Start polling server state so students in break rooms detect when teacher ends them. */
  const startBreakRoomPoll = () => {
    if (_brPollTimer) return;
    _brPollTimer = setInterval(async () => {
      if (!isInBreakRoom()) {
        stopBreakRoomPoll();
        return;
      }
      const cid = getEffectiveCourseId();
      const savedMain = mainRoomName;
      if (!cid || !savedMain) return;
      try {
        const res = await fetch(
          `/api/live/break-rooms/state?room=${encodeURIComponent(savedMain)}&courseId=${encodeURIComponent(cid)}`,
        );
        const payload = await res.json().catch(() => null);
        const state = payload?.state;

        // Kill: state cleared immediately
        if (payload && state === null) {
          stopBreakRoomPoll();
          breakRoomsActive = [];
          breakRoomsMode = '';
          breakRoomAssignments = {};
          syncBreakRoomsShell();
          void joinBreakRoom(savedMain, true);
          return;
        }

        // Countdown started: show overlay and start local timer
        if (state?.terminatingAt && !_brCountdownTimer) {
          stopBreakRoomPoll();
          const remaining = Math.max(0, Math.round((state.terminatingAt - Date.now()) / 1000));
          breakRoomsActive = [];
          breakRoomsMode = '';
          breakRoomAssignments = {};
          syncBreakRoomsShell();
          startBreakRoomsCountdown(remaining || 1, savedMain);
        }
      } catch {
        // best-effort
      }
    }, 4000);
  };

  const stopBreakRoomPoll = () => {
    if (_brPollTimer) {
      clearInterval(_brPollTimer);
      _brPollTimer = null;
    }
  };

  /** Show the N-second countdown overlay and auto-return everyone. */
  const startBreakRoomsCountdown = (seconds: number, targetRoom: string) => {
    if (_brCountdownTimer) {
      clearInterval(_brCountdownTimer);
      _brCountdownTimer = null;
    }

    let remaining = seconds;

    const updateOverlay = () => {
      if (!(brCountdownEl instanceof HTMLElement) || !(brCountdownText instanceof HTMLElement)) return;
      brCountdownEl.hidden = remaining <= 0;
      brCountdownText.textContent = remaining > 0 ? `${remaining}s` : '';
    };

    updateOverlay();

    _brCountdownTimer = setInterval(() => {
      remaining -= 1;
      updateOverlay();
      if (remaining <= 0) {
        clearInterval(_brCountdownTimer!);
        _brCountdownTimer = null;
        void joinBreakRoom(targetRoom, true);
      }
    }, 1000);
  };

  /** Teacher: end break rooms, broadcast countdown, start own countdown. */
  const handleBreakRoomsEnd = async () => {
    const target = mainRoomName || (roomInput instanceof HTMLInputElement ? normalizeText(roomInput.value) : '');
    if (!target) return;

    const COUNTDOWN_SECS = 60;

    if (room.state === ConnectionState.Connected && localRole === 'teacher') {
      await publishMessage({
        type: 'break-rooms-end',
        countdown: COUNTDOWN_SECS,
        mainRoom: target,
      }).catch(() => undefined);
    }

    // Clear break rooms list so they don't reappear
    breakRoomsActive = [];
    breakRoomsMode = '';
    breakRoomAssignments = {};
    syncBreakRoomsShell();

    // Signal countdown to students in break rooms via server state
    const terminatingAt = Date.now() + COUNTDOWN_SECS * 1000;
    void (async () => {
      const cid = getEffectiveCourseId();
      if (!cid) return;
      try {
        await fetch('/api/live/break-rooms/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseId: cid, room: target, terminatingAt }),
        });
        // Clear after countdown elapses
        window.setTimeout(() => void syncBreakRoomsStateToServer(target, null), COUNTDOWN_SECS * 1000 + 2000);
      } catch { /* best-effort */ }
    })();

    startBreakRoomsCountdown(COUNTDOWN_SECS, target);
  };

  /** Teacher: terminate break rooms immediately, no countdown. */
  const handleBreakRoomsKill = async () => {
    const target = mainRoomName || (roomInput instanceof HTMLInputElement ? normalizeText(roomInput.value) : '');
    if (!target) return;

    if (room.state === ConnectionState.Connected && localRole === 'teacher') {
      await publishMessage({
        type: 'break-rooms-kill',
        mainRoom: target,
      }).catch(() => undefined);
    }

    breakRoomsActive = [];
    breakRoomsMode = '';
    breakRoomAssignments = {};
    syncBreakRoomsShell();

    void syncBreakRoomsStateToServer(target, null);

    // Return teacher to main room immediately
    void joinBreakRoom(target, true);
  };

  /** Join a room by name. isMain = returning to main room. */
  const joinBreakRoom = async (targetRoomName: string, isMain: boolean) => {
    if (!(roomInput instanceof HTMLInputElement)) return;
    if (!(breakRoomsPopup instanceof HTMLElement)) return;

    breakRoomsPopup.hidden = true;

    // Switch to grid layout when entering a break room
    if (!isMain) {
      layoutInput.value = 'grid';
      setLayout(stage, 'grid');
      layoutBeforeAutoScreenshare = 'grid';
    }

    if (!isMain && !mainRoomName) {
      mainRoomName = normalizeText(roomInput.value);
    }

    // Stop blink and any running countdown
    stopBBtnBlink();
    if (_brCountdownTimer) {
      clearInterval(_brCountdownTimer);
      _brCountdownTimer = null;
    }
    if (brCountdownEl instanceof HTMLElement) brCountdownEl.hidden = true;

    roomInput.value = targetRoomName;

    // Clear mainRoomName when actually returning to the main room
    if (isMain) {
      mainRoomName = '';
      stopBreakRoomPoll();
    } else {
      // Entering a break room — start polling so we detect when teacher ends rooms
      startBreakRoomPoll();
    }

    syncBreakRoomsShell();

    if (room.state === ConnectionState.Connected) {
      room.disconnect();
      // wait for disconnect to propagate, then reconnect
      await new Promise<void>((resolve) => {
        room.once(RoomEvent.Disconnected, () => { resolve(); });
        window.setTimeout(() => { resolve(); }, 1200);
      });
    }

    void connectRoom();
  };

  /** Persist/clear break rooms state server-side so late-joining students can discover it. */
  const syncBreakRoomsStateToServer = async (
    roomName: string,
    state: { rooms: any[]; assignments: Record<string, string>; mode: string } | null,
  ) => {
    const effectiveCourseId = getEffectiveCourseId();
    if (!effectiveCourseId || !roomName) return;
    try {
      await fetch('/api/live/break-rooms/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          state
            ? { courseId: effectiveCourseId, room: roomName, ...state }
            : { courseId: effectiveCourseId, room: roomName, clear: true },
        ),
      });
    } catch {
      // best-effort, non-blocking
    }
  };

  /** Build break rooms from a list of labels, broadcast to students. */
  const activateBreakRooms = async (
    labels: string[],
    mode: string,
    assignments: Record<string, string> = {},
  ) => {
    if (!(roomInput instanceof HTMLInputElement)) return;
    const base = normalizeText(roomInput.value);
    if (!base) {
      setBreakRoomsStatus('Necesitás estar en una sala para crear break rooms.', true);
      return;
    }

    const rooms = labels
      .map((l) => l.trim())
      .filter(Boolean)
      .map((label) => ({ name: toBreakRoomName(base, label), label }));

    if (rooms.length === 0) {
      setBreakRoomsStatus('Ingresá al menos un nombre de grupo.', true);
      return;
    }

    breakRoomsActive = rooms;
    breakRoomsMode = mode;
    breakRoomAssignments = assignments;
    mainRoomName = mainRoomName || base;

    syncBreakRoomsShell();
    renderBreakRoomsPopup();
    setBreakRoomsStatus(`${rooms.length} break rooms creados.`, false);

    // Persist state server-side for late-joining students
    void syncBreakRoomsStateToServer(base, { rooms, assignments, mode });

    // Broadcast to connected students
    if (room.state === ConnectionState.Connected && localRole === 'teacher') {
      await publishMessage({
        type: 'break-rooms',
        rooms,
        assignments,
        mode,
      }).catch(() => undefined);
    }
  };

  const setBreakRoomsStatus = (msg: string, isError: boolean) => {
    if (!(breakRoomsStatusNote instanceof HTMLElement)) return;
    breakRoomsStatusNote.textContent = msg;
    breakRoomsStatusNote.dataset.error = isError ? 'true' : 'false';
  };

  /** Slug from last name(s) of connected student participants. */
  const buildRandomGroupLabel = (names: string[]) => {
    const lastNames = names
      .map((n) => {
        const parts = n.trim().split(/\s+/);
        return parts[parts.length - 1] ?? n;
      })
      .filter(Boolean);
    return lastNames.join('-') || 'grupo';
  };

  /** Handler: 3.1 Random groups */
  const handleBreakRoomsRandom = async () => {
    const size = Math.max(2, Math.min(20, Number(
      breakRoomsSizeInput instanceof HTMLInputElement ? breakRoomsSizeInput.value : 3,
    ) || 3));

    const students = allParticipants().filter(
      (p) => readParticipantRole(room, p, localRole) === 'student',
    );

    if (students.length === 0) {
      setBreakRoomsStatus('No hay estudiantes conectados.', true);
      return;
    }

    // Fisher-Yates shuffle
    const shuffled = [...students];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const assignments: Record<string, string> = {};
    const labels: string[] = [];

    for (let i = 0; i < shuffled.length; i += size) {
      const group = shuffled.slice(i, i + size);
      const label = buildRandomGroupLabel(group.map(readParticipantName));
      labels.push(label);
      for (const p of group) {
        const rName = toBreakRoomName(
          normalizeText(roomInput instanceof HTMLInputElement ? roomInput.value : ''),
          label,
        );
        assignments[p.identity] = rName;
      }
    }

    await activateBreakRooms(labels, 'random', assignments);
  };

  /** Handler: 3.2 Student grupos from Supabase */
  const handleBreakRoomsGrupos = async () => {
    const effectiveCourseId = getEffectiveCourseId();
    if (!effectiveCourseId) {
      setBreakRoomsStatus('Seleccioná un curso primero.', true);
      return;
    }

    setBreakRoomsStatus('Cargando grupos...', false);

    try {
      const res = await fetch(
        `/api/live/break-rooms/students?courseId=${encodeURIComponent(effectiveCourseId)}`,
        { headers: { Accept: 'application/json' } },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.students) {
        setBreakRoomsStatus(normalizeText(payload?.error) || 'Error al cargar grupos.', true);
        return;
      }

      type StudentMeta = { userId: string; name: string; email: string; grupo: string };
      const students: StudentMeta[] = payload.students;

      // Sanitize email → LiveKit identity (mirrors livekit-token.ts sanitizeIdentity)
      const sanitizeIdentity = (v: string) =>
        v.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96);

      // Map sanitized-email → grupo
      const emailToGrupo = new Map<string, string>();
      for (const s of students) {
        if (s.email && s.grupo) {
          emailToGrupo.set(sanitizeIdentity(s.email), s.grupo);
        }
      }

      const byGrupo = new Map<string, string[]>();
      for (const s of students) {
        const g = s.grupo || 'Sin grupo';
        if (!byGrupo.has(g)) byGrupo.set(g, []);
        byGrupo.get(g)!.push(s.name);
      }

      const base = roomInput instanceof HTMLInputElement ? normalizeText(roomInput.value) : '';
      const labels = Array.from(byGrupo.keys()).sort().map((g) => `GRUPO ${g}`);

      // Build assignments: identity → break room name
      const assignments: Record<string, string> = {};
      for (const p of allParticipants()) {
        const grupo = emailToGrupo.get(p.identity);
        if (grupo) {
          const label = `GRUPO ${grupo}`;
          assignments[p.identity] = toBreakRoomName(base, label);
        }
      }

      await activateBreakRooms(labels, 'grupos', assignments);
    } catch {
      setBreakRoomsStatus('Error al cargar grupos.', true);
    }
  };

  /** Handler: 3.3 Custom groups */
  const handleBreakRoomsCustom = async () => {
    if (!(breakRoomsCustomInputsContainer instanceof HTMLElement)) return;
    const inputs = Array.from(
      breakRoomsCustomInputsContainer.querySelectorAll<HTMLInputElement>('.conference-break-rooms-custom-name'),
    );
    const labels = inputs.map((i) => i.value.trim()).filter(Boolean);
    await activateBreakRooms(labels, 'custom');
  };

  /** Add a new custom group input field */
  const addCustomGroupInput = () => {
    if (!(breakRoomsCustomInputsContainer instanceof HTMLElement)) return;
    const count = breakRoomsCustomInputsContainer.querySelectorAll('.conference-break-rooms-custom-name').length;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'conference-break-rooms-custom-name';
    input.placeholder = `Grupo ${String.fromCharCode(65 + count)}`;
    breakRoomsCustomInputsContainer.appendChild(input);
    input.focus();
  };

  const applyIncomingFxState = (refreshReverbImpulse = false) => {
    if (!incomingAudioContext) return;

    if (incomingAudioReverbSendNode) {
      incomingAudioReverbSendNode.gain.setTargetAtTime(
        mixerIncomingReverbSend,
        incomingAudioContext.currentTime,
        0.03,
      );
    }
    if (incomingAudioReverbReturnGainNode) {
      incomingAudioReverbReturnGainNode.gain.setTargetAtTime(
        synthReverbMix,
        incomingAudioContext.currentTime,
        0.03,
      );
    }
    if (refreshReverbImpulse && incomingAudioReverbConvolverNode) {
      incomingAudioReverbConvolverNode.buffer = createImpulseResponseBuffer(
        incomingAudioContext,
        synthReverbTime,
        2.8,
      );
    }
    if (incomingAudioDelaySendNode) {
      incomingAudioDelaySendNode.gain.setTargetAtTime(
        mixerIncomingDelaySend,
        incomingAudioContext.currentTime,
        0.03,
      );
    }
    if (incomingAudioDelayNode) {
      incomingAudioDelayNode.delayTime.setTargetAtTime(
        synthDelayTime,
        incomingAudioContext.currentTime,
        0.03,
      );
    }
    if (incomingAudioDelayFeedbackGainNode) {
      incomingAudioDelayFeedbackGainNode.gain.setTargetAtTime(
        synthDelayFeedback,
        incomingAudioContext.currentTime,
        0.03,
      );
    }
    if (incomingAudioDelayFilterNode) {
      incomingAudioDelayFilterNode.frequency.setTargetAtTime(
        synthDelayTone,
        incomingAudioContext.currentTime,
        0.03,
      );
    }
    if (incomingAudioDelayReturnGainNode) {
      incomingAudioDelayReturnGainNode.gain.setTargetAtTime(
        synthDelayMix,
        incomingAudioContext.currentTime,
        0.03,
      );
    }
  };

  const applyMixerState = () => {
    if (mixerSynthGainInput instanceof HTMLInputElement) {
      mixerSynthGainInput.value = mixerSynthGain.toFixed(2);
    }
    if (mixerSynthPanInput instanceof HTMLInputElement) {
      mixerSynthPanInput.value = mixerSynthPan.toFixed(2);
    }
    if (mixerSynthReverbSendInput instanceof HTMLInputElement) {
      mixerSynthReverbSendInput.value = mixerSynthReverbSend.toFixed(2);
    }
    if (mixerSynthDelaySendInput instanceof HTMLInputElement) {
      mixerSynthDelaySendInput.value = mixerSynthDelaySend.toFixed(2);
    }
    if (mixerBallGainInput instanceof HTMLInputElement) {
      mixerBallGainInput.value = mixerBallGain.toFixed(2);
    }
    if (mixerBallPanInput instanceof HTMLInputElement) {
      mixerBallPanInput.value = mixerBallPan.toFixed(2);
    }
    if (mixerBallReverbSendInput instanceof HTMLInputElement) {
      mixerBallReverbSendInput.value = mixerBallReverbSend.toFixed(2);
    }
    if (mixerBallDelaySendInput instanceof HTMLInputElement) {
      mixerBallDelaySendInput.value = mixerBallDelaySend.toFixed(2);
    }
    if (mixerIncomingGainInput instanceof HTMLInputElement) {
      mixerIncomingGainInput.value = mixerIncomingGain.toFixed(2);
    }
    if (mixerIncomingPanInput instanceof HTMLInputElement) {
      mixerIncomingPanInput.value = mixerIncomingPan.toFixed(2);
    }
    if (mixerIncomingReverbSendInput instanceof HTMLInputElement) {
      mixerIncomingReverbSendInput.value = mixerIncomingReverbSend.toFixed(2);
    }
    if (mixerIncomingDelaySendInput instanceof HTMLInputElement) {
      mixerIncomingDelaySendInput.value = mixerIncomingDelaySend.toFixed(2);
    }
    if (mixerMasterGainInput instanceof HTMLInputElement) {
      mixerMasterGainInput.value = mixerMasterGain.toFixed(2);
    }
    if (mixerMasterPanInput instanceof HTMLInputElement) {
      mixerMasterPanInput.value = mixerMasterPan.toFixed(2);
    }
    if (mixerSynthMuteButton instanceof HTMLButtonElement) {
      mixerSynthMuteButton.dataset.active = mixerSynthMuted ? 'false' : 'true';
      mixerSynthMuteButton.setAttribute('aria-pressed', mixerSynthMuted ? 'true' : 'false');
    }
    if (mixerBallMuteButton instanceof HTMLButtonElement) {
      mixerBallMuteButton.dataset.active = mixerBallMuted ? 'false' : 'true';
      mixerBallMuteButton.setAttribute('aria-pressed', mixerBallMuted ? 'true' : 'false');
    }
    if (mixerIncomingMuteButton instanceof HTMLButtonElement) {
      mixerIncomingMuteButton.dataset.active = mixerIncomingMuted ? 'false' : 'true';
      mixerIncomingMuteButton.setAttribute('aria-pressed', mixerIncomingMuted ? 'true' : 'false');
    }
    if (mixerMasterMuteButton instanceof HTMLButtonElement) {
      mixerMasterMuteButton.dataset.active = mixerMasterMuted ? 'false' : 'true';
      mixerMasterMuteButton.setAttribute('aria-pressed', mixerMasterMuted ? 'true' : 'false');
    }

    syncPanKnob(mixerSynthPanKnob, mixerSynthPan);
    syncPanKnob(mixerBallPanKnob, mixerBallPan);
    syncPanKnob(mixerIncomingPanKnob, mixerIncomingPan);
    syncPanKnob(mixerMasterPanKnob, mixerMasterPan);
    syncValueKnob(mixerSynthReverbSendKnob, mixerSynthReverbSendInput, mixerSynthReverbSend);
    syncValueKnob(mixerSynthDelaySendKnob, mixerSynthDelaySendInput, mixerSynthDelaySend);
    syncValueKnob(mixerBallReverbSendKnob, mixerBallReverbSendInput, mixerBallReverbSend);
    syncValueKnob(mixerBallDelaySendKnob, mixerBallDelaySendInput, mixerBallDelaySend);
    syncValueKnob(mixerIncomingReverbSendKnob, mixerIncomingReverbSendInput, mixerIncomingReverbSend);
    syncValueKnob(mixerIncomingDelaySendKnob, mixerIncomingDelaySendInput, mixerIncomingDelaySend);

    fmSynth.setChannelGain(mixerSynthMuted ? 0 : mixerSynthGain);
    fmSynth.setChannelPan(mixerSynthPan);
    fmSynth.setReverbSend(mixerSynthReverbSend);
    fmSynth.setDelaySend(mixerSynthDelaySend);
    gravityBallRenderer?.setAudioChannelGain(
      Math.min(1, Math.max(0, (mixerBallMuted ? 0 : mixerBallGain) * (mixerMasterMuted ? 0 : mixerMasterGain))),
    );
    gravityBallRenderer?.setAudioChannelPan(Math.max(-1, Math.min(1, mixerBallPan + mixerMasterPan * 0.5)));
    gravityBallRenderer?.setAudioReverbSend(mixerBallReverbSend);
    gravityBallRenderer?.setAudioDelaySend(mixerBallDelaySend);
    fmSynth.setMasterPan(mixerMasterPan);
    fmSynth.setMasterGain(
      Math.min(1, Math.max(0, SYNTH_BASE_MASTER_GAIN * (mixerMasterMuted ? 0 : mixerMasterGain))),
    );

    if (incomingAudioGroupGainNode && incomingAudioContext) {
      incomingAudioGroupGainNode.gain.setTargetAtTime(
        mixerIncomingMuted ? 0 : mixerIncomingGain,
        incomingAudioContext.currentTime,
        0.03,
      );
    }
    if (incomingAudioGroupPannerNode && incomingAudioContext) {
      incomingAudioGroupPannerNode.pan.setTargetAtTime(mixerIncomingPan, incomingAudioContext.currentTime, 0.03);
    }
    if (incomingAudioMasterGainNode && incomingAudioContext) {
      incomingAudioMasterGainNode.gain.setTargetAtTime(
        mixerMasterMuted ? 0 : mixerMasterGain,
        incomingAudioContext.currentTime,
        0.03,
      );
    }
    if (incomingAudioMasterPannerNode && incomingAudioContext) {
      incomingAudioMasterPannerNode.pan.setTargetAtTime(mixerMasterPan, incomingAudioContext.currentTime, 0.03);
    }

    applyIncomingFxState();
  };

  const syncValueKnob = (
    knob: Element | null,
    input: Element | null,
    value: number,
  ) => {
    if (!(knob instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;
    const minimum = Number(input.min || '-1');
    const maximum = Number(input.max || '1');
    const safeMin = Number.isFinite(minimum) ? minimum : -1;
    const safeMax = Number.isFinite(maximum) ? maximum : 1;
    const normalized = safeMax === safeMin
      ? 0.5
      : clamp01((value - safeMin) / (safeMax - safeMin));
    const angle = lerp(-135, 135, normalized);
    knob.style.setProperty('--angle', `${angle.toFixed(2)}deg`);
    knob.setAttribute('aria-valuenow', value.toFixed(2));
  };

  const applyVideoMixerState = () => {
    localCameraProcessorState.videoMix = videoMixBypassed ? createNeutralVideoMix() : { ...videoMix };
    root.dataset.videoBypassed = videoMixBypassed ? 'true' : 'false';

    if (mixerVideoLumaInput instanceof HTMLInputElement) {
      mixerVideoLumaInput.value = videoMix.luma.toFixed(2);
    }
    if (mixerVideoTintInput instanceof HTMLInputElement) {
      mixerVideoTintInput.value = videoMix.tint.toFixed(2);
    }
    if (mixerVideoSaturationInput instanceof HTMLInputElement) {
      mixerVideoSaturationInput.value = videoMix.saturation.toFixed(2);
    }
    if (mixerVideoContrastInput instanceof HTMLInputElement) {
      mixerVideoContrastInput.value = videoMix.contrast.toFixed(2);
    }
    if (mixerVideoBrightnessInput instanceof HTMLInputElement) {
      mixerVideoBrightnessInput.value = videoMix.brightness.toFixed(2);
    }

    syncValueKnob(mixerVideoLumaKnob, mixerVideoLumaInput, videoMix.luma);
    syncValueKnob(mixerVideoTintKnob, mixerVideoTintInput, videoMix.tint);
    syncValueKnob(mixerVideoSaturationKnob, mixerVideoSaturationInput, videoMix.saturation);
    syncValueKnob(mixerVideoContrastKnob, mixerVideoContrastInput, videoMix.contrast);
    syncValueKnob(mixerVideoBrightnessKnob, mixerVideoBrightnessInput, videoMix.brightness);
    if (videoBypassToggleButton instanceof HTMLButtonElement) {
      videoBypassToggleButton.dataset.active = videoMixBypassed ? 'false' : 'true';
      videoBypassToggleButton.setAttribute('aria-pressed', videoMixBypassed ? 'true' : 'false');
    }
  };

  const setMixerMeterLevel = (meter: Element | null, level: number) => {
    if (!(meter instanceof HTMLElement)) return;
    meter.style.setProperty('--conference-meter-level', clamp01(level).toFixed(3));
  };

  const readAnalyserLevel = (analyser: AnalyserNode | null, data: Uint8Array | null, scale = 4.6) => {
    if (!analyser || !data) return 0;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let index = 0; index < data.length; index += 1) {
      const normalizedSample = (data[index] - 128) / 128;
      sum += normalizedSample * normalizedSample;
    }
    return clamp01(Math.sqrt(sum / data.length) * scale);
  };

  const renderMixerMeters = () => {
    const synthLevels = fmSynth.getMeterLevels();
    const ballLevel = gravityBallRenderer?.getAudioMeterLevel() || 0;
    const incomingLevel = readAnalyserLevel(incomingAudioGroupAnalyser, incomingAudioGroupMeterData, 4.2);
    const incomingMasterLevel = readAnalyserLevel(incomingAudioMasterAnalyser, incomingAudioMasterMeterData, 4.2);
    setMixerMeterLevel(mixerSynthMeter, synthLevels.channel);
    setMixerMeterLevel(mixerBallMeter, ballLevel);
    setMixerMeterLevel(mixerIncomingMeter, incomingLevel);
    setMixerMeterLevel(mixerMasterMeter, Math.max(synthLevels.master, ballLevel, incomingMasterLevel));
    mixerMeterAnimationId = window.requestAnimationFrame(renderMixerMeters);
  };

  const startMixerMeters = () => {
    if (mixerMeterAnimationId) {
      window.cancelAnimationFrame(mixerMeterAnimationId);
    }
    renderMixerMeters();
  };

  const stopMixerMeters = () => {
    if (mixerMeterAnimationId) {
      window.cancelAnimationFrame(mixerMeterAnimationId);
      mixerMeterAnimationId = 0;
    }
    setMixerMeterLevel(mixerSynthMeter, 0);
    setMixerMeterLevel(mixerBallMeter, 0);
    setMixerMeterLevel(mixerIncomingMeter, 0);
    setMixerMeterLevel(mixerMasterMeter, 0);
  };

  const syncPanKnob = (knob: Element | null, value: number) => {
    if (!(knob instanceof HTMLElement)) return;
    const normalized = Math.min(1, Math.max(-1, Number(value) || 0));
    const angle = lerp(-135, 135, (normalized + 1) / 2);
    knob.style.setProperty('--angle', `${angle.toFixed(2)}deg`);
    knob.setAttribute('aria-valuenow', normalized.toFixed(2));
    knob.setAttribute(
      'aria-valuetext',
      normalized === 0
        ? 'Center'
        : normalized < 0
          ? `L ${Math.round(Math.abs(normalized) * 100)}`
          : `R ${Math.round(normalized * 100)}`,
    );
  };

  const applySynthFxState = () => {
    if (synthReverbTimeInput instanceof HTMLInputElement) {
      synthReverbTimeInput.value = synthReverbTime.toFixed(2);
    }
    if (synthReverbTimeOutput instanceof HTMLOutputElement || synthReverbTimeOutput instanceof HTMLElement) {
      synthReverbTimeOutput.textContent = `${synthReverbTime.toFixed(1)}s`;
    }
    if (synthReverbMixInput instanceof HTMLInputElement) {
      synthReverbMixInput.value = synthReverbMix.toFixed(2);
    }
    if (synthReverbMixOutput instanceof HTMLOutputElement || synthReverbMixOutput instanceof HTMLElement) {
      synthReverbMixOutput.textContent = `${Math.round(synthReverbMix * 100)}%`;
    }
    if (synthDelayTimeInput instanceof HTMLInputElement) {
      synthDelayTimeInput.value = synthDelayTime.toFixed(2);
    }
    if (synthDelayTimeOutput instanceof HTMLOutputElement || synthDelayTimeOutput instanceof HTMLElement) {
      synthDelayTimeOutput.textContent = formatDelayTimeLabel(synthDelayTime);
    }
    if (synthDelayFeedbackInput instanceof HTMLInputElement) {
      synthDelayFeedbackInput.value = synthDelayFeedback.toFixed(2);
    }
    if (synthDelayFeedbackOutput instanceof HTMLOutputElement || synthDelayFeedbackOutput instanceof HTMLElement) {
      synthDelayFeedbackOutput.textContent = `${Math.round(synthDelayFeedback * 100)}%`;
    }
    if (synthDelayMixInput instanceof HTMLInputElement) {
      synthDelayMixInput.value = synthDelayMix.toFixed(2);
    }
    if (synthDelayMixOutput instanceof HTMLOutputElement || synthDelayMixOutput instanceof HTMLElement) {
      synthDelayMixOutput.textContent = `${Math.round(synthDelayMix * 100)}%`;
    }
    if (synthDelayToneInput instanceof HTMLInputElement) {
      synthDelayToneInput.value = synthDelayTone.toFixed(0);
    }
    if (synthDelayToneOutput instanceof HTMLOutputElement || synthDelayToneOutput instanceof HTMLElement) {
      synthDelayToneOutput.textContent = formatFrequencyLabel(synthDelayTone);
    }
    if (synthCompToggle instanceof HTMLButtonElement) {
      synthCompToggle.dataset.active = synthCompressorEnabled ? 'true' : 'false';
    }
    if (synthCompThresholdInput instanceof HTMLInputElement) {
      synthCompThresholdInput.value = synthCompressorThreshold.toFixed(1);
      synthCompThresholdInput.disabled = !synthCompressorEnabled;
    }
    if (synthCompThresholdOutput instanceof HTMLOutputElement || synthCompThresholdOutput instanceof HTMLElement) {
      synthCompThresholdOutput.textContent = `${synthCompressorThreshold.toFixed(0)} dB`;
    }
    if (synthCompRatioInput instanceof HTMLInputElement) {
      synthCompRatioInput.value = synthCompressorRatio.toFixed(2);
      synthCompRatioInput.disabled = !synthCompressorEnabled;
    }
    if (synthCompRatioOutput instanceof HTMLOutputElement || synthCompRatioOutput instanceof HTMLElement) {
      synthCompRatioOutput.textContent = synthCompressorRatio.toFixed(1);
    }
    if (synthCompAttackInput instanceof HTMLInputElement) {
      synthCompAttackInput.value = synthCompressorAttack.toFixed(3);
      synthCompAttackInput.disabled = !synthCompressorEnabled;
    }
    if (synthCompAttackOutput instanceof HTMLOutputElement || synthCompAttackOutput instanceof HTMLElement) {
      synthCompAttackOutput.textContent = `${synthCompressorAttack.toFixed(3)}s`;
    }
    if (synthCompReleaseInput instanceof HTMLInputElement) {
      synthCompReleaseInput.value = synthCompressorRelease.toFixed(3);
      synthCompReleaseInput.disabled = !synthCompressorEnabled;
    }
    if (synthCompReleaseOutput instanceof HTMLOutputElement || synthCompReleaseOutput instanceof HTMLElement) {
      synthCompReleaseOutput.textContent = `${synthCompressorRelease.toFixed(2)}s`;
    }
    if (synthCompKneeInput instanceof HTMLInputElement) {
      synthCompKneeInput.value = synthCompressorKnee.toFixed(1);
      synthCompKneeInput.disabled = !synthCompressorEnabled;
    }
    if (synthCompKneeOutput instanceof HTMLOutputElement || synthCompKneeOutput instanceof HTMLElement) {
      synthCompKneeOutput.textContent = `${synthCompressorKnee.toFixed(0)} dB`;
    }
    if (synthLimiterToggle instanceof HTMLButtonElement) {
      synthLimiterToggle.dataset.active = synthLimiterEnabled ? 'true' : 'false';
    }
    if (synthLimiterThresholdInput instanceof HTMLInputElement) {
      synthLimiterThresholdInput.value = synthLimiterThreshold.toFixed(1);
      synthLimiterThresholdInput.disabled = !synthLimiterEnabled;
    }
    if (synthLimiterThresholdOutput instanceof HTMLOutputElement || synthLimiterThresholdOutput instanceof HTMLElement) {
      synthLimiterThresholdOutput.textContent = `${synthLimiterThreshold.toFixed(0)} dB`;
    }
    if (synthLimiterReleaseInput instanceof HTMLInputElement) {
      synthLimiterReleaseInput.value = synthLimiterRelease.toFixed(3);
      synthLimiterReleaseInput.disabled = !synthLimiterEnabled;
    }
    if (synthLimiterReleaseOutput instanceof HTMLOutputElement || synthLimiterReleaseOutput instanceof HTMLElement) {
      synthLimiterReleaseOutput.textContent = `${synthLimiterRelease.toFixed(2)}s`;
    }

    syncPanKnob(mixerSynthPanKnob, mixerSynthPan);
    syncPanKnob(mixerBallPanKnob, mixerBallPan);
    syncPanKnob(mixerIncomingPanKnob, mixerIncomingPan);
    syncPanKnob(mixerMasterPanKnob, mixerMasterPan);

    fmSynth.setReverbTime(synthReverbTime);
    fmSynth.setReverbMix(synthReverbMix);
    fmSynth.setDelayTime(synthDelayTime);
    fmSynth.setDelayFeedback(synthDelayFeedback);
    fmSynth.setDelayMix(synthDelayMix);
    fmSynth.setDelayTone(synthDelayTone);
    gravityBallRenderer?.setReverbTime(synthReverbTime);
    gravityBallRenderer?.setReverbMix(synthReverbMix);
    gravityBallRenderer?.setDelayTime(synthDelayTime);
    gravityBallRenderer?.setDelayFeedback(synthDelayFeedback);
    gravityBallRenderer?.setDelayMix(synthDelayMix);
    gravityBallRenderer?.setDelayTone(synthDelayTone);
    applyIncomingFxState(true);
    fmSynth.setCompressorEnabled(synthCompressorEnabled);
    fmSynth.setCompressorThreshold(synthCompressorThreshold);
    fmSynth.setCompressorRatio(synthCompressorRatio);
    fmSynth.setCompressorAttack(synthCompressorAttack);
    fmSynth.setCompressorRelease(synthCompressorRelease);
    fmSynth.setCompressorKnee(synthCompressorKnee);
    fmSynth.setLimiterEnabled(synthLimiterEnabled);
    fmSynth.setLimiterThreshold(synthLimiterThreshold);
    fmSynth.setLimiterRelease(synthLimiterRelease);
  };

  const ensureIncomingAudioContext = async () => {
    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextCtor) return null;

    if (!incomingAudioContext || incomingAudioContext.state === 'closed') {
      incomingAudioContext = new AudioContextCtor({ sampleRate: 48_000 });
      incomingAudioGroupGainNode = incomingAudioContext.createGain();
      incomingAudioGroupPannerNode = incomingAudioContext.createStereoPanner();
      incomingAudioDryGainNode = incomingAudioContext.createGain();
      incomingAudioDryGainNode.gain.value = 1;
      incomingAudioReverbSendNode = incomingAudioContext.createGain();
      incomingAudioReverbSendNode.gain.value = mixerIncomingReverbSend;
      incomingAudioReverbConvolverNode = incomingAudioContext.createConvolver();
      incomingAudioReverbConvolverNode.buffer = createImpulseResponseBuffer(
        incomingAudioContext,
        synthReverbTime,
        2.8,
      );
      incomingAudioReverbReturnGainNode = incomingAudioContext.createGain();
      incomingAudioReverbReturnGainNode.gain.value = synthReverbMix;
      incomingAudioDelaySendNode = incomingAudioContext.createGain();
      incomingAudioDelaySendNode.gain.value = mixerIncomingDelaySend;
      incomingAudioDelayNode = incomingAudioContext.createDelay(2);
      incomingAudioDelayNode.delayTime.value = synthDelayTime;
      incomingAudioDelayFeedbackGainNode = incomingAudioContext.createGain();
      incomingAudioDelayFeedbackGainNode.gain.value = synthDelayFeedback;
      incomingAudioDelayFilterNode = incomingAudioContext.createBiquadFilter();
      incomingAudioDelayFilterNode.type = 'lowpass';
      incomingAudioDelayFilterNode.frequency.value = synthDelayTone;
      incomingAudioDelayFilterNode.Q.value = 0.2;
      incomingAudioDelayReturnGainNode = incomingAudioContext.createGain();
      incomingAudioDelayReturnGainNode.gain.value = synthDelayMix;
      incomingAudioGroupAnalyser = incomingAudioContext.createAnalyser();
      incomingAudioGroupAnalyser.fftSize = 256;
      incomingAudioGroupAnalyser.smoothingTimeConstant = 0.86;
      incomingAudioGroupMeterData = new Uint8Array(incomingAudioGroupAnalyser.fftSize);
      incomingAudioMasterGainNode = incomingAudioContext.createGain();
      incomingAudioMasterPannerNode = incomingAudioContext.createStereoPanner();
      incomingAudioMasterAnalyser = incomingAudioContext.createAnalyser();
      incomingAudioMasterAnalyser.fftSize = 256;
      incomingAudioMasterAnalyser.smoothingTimeConstant = 0.88;
      incomingAudioMasterMeterData = new Uint8Array(incomingAudioMasterAnalyser.fftSize);

      incomingAudioGroupGainNode.connect(incomingAudioGroupPannerNode);
      incomingAudioGroupPannerNode.connect(incomingAudioDryGainNode);
      incomingAudioGroupPannerNode.connect(incomingAudioReverbSendNode);
      incomingAudioReverbSendNode.connect(incomingAudioReverbConvolverNode);
      incomingAudioReverbConvolverNode.connect(incomingAudioReverbReturnGainNode);
      incomingAudioGroupPannerNode.connect(incomingAudioDelaySendNode);
      incomingAudioDelaySendNode.connect(incomingAudioDelayNode);
      incomingAudioDelayNode.connect(incomingAudioDelayFilterNode);
      incomingAudioDelayFilterNode.connect(incomingAudioDelayReturnGainNode);
      incomingAudioDelayFilterNode.connect(incomingAudioDelayFeedbackGainNode);
      incomingAudioDelayFeedbackGainNode.connect(incomingAudioDelayNode);
      incomingAudioDryGainNode.connect(incomingAudioGroupAnalyser);
      incomingAudioReverbReturnGainNode.connect(incomingAudioGroupAnalyser);
      incomingAudioDelayReturnGainNode.connect(incomingAudioGroupAnalyser);
      incomingAudioGroupAnalyser.connect(incomingAudioMasterGainNode);
      incomingAudioMasterGainNode.connect(incomingAudioMasterPannerNode);
      incomingAudioMasterPannerNode.connect(incomingAudioMasterAnalyser);
      incomingAudioMasterAnalyser.connect(incomingAudioContext.destination);
    }

    if (incomingAudioContext.state !== 'running') {
      await incomingAudioContext.resume().catch(() => undefined);
    }

    applyMixerState();
    return incomingAudioContext;
  };

  const disconnectIncomingAudioSource = (key: string) => {
    const entry = incomingAudioSources.get(key);
    if (!entry) return;
    try {
      entry.source.disconnect();
    } catch {
      // ignore disconnected nodes
    }
    try {
      entry.gain.disconnect();
    } catch {
      // ignore disconnected nodes
    }
    try {
      entry.panner.disconnect();
    } catch {
      // ignore disconnected nodes
    }
    incomingAudioSources.delete(key);
  };

  const connectIncomingAudioTrack = async (key: string, mediaStreamTrack: MediaStreamTrack | null | undefined) => {
    if (!mediaStreamTrack || mediaStreamTrack.kind !== 'audio' || mediaStreamTrack.readyState !== 'live') return null;
    disconnectIncomingAudioSource(key);
    const audioContext = await ensureIncomingAudioContext();
    if (!audioContext || !incomingAudioGroupGainNode) return null;

    const source = audioContext.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
    const gain = audioContext.createGain();
    const panner = audioContext.createStereoPanner();
    gain.gain.value = 1;
    panner.pan.value = 0;
    source.connect(gain);
    gain.connect(panner);
    panner.connect(incomingAudioGroupGainNode);

    incomingAudioSources.set(key, { gain, panner, source });
    return () => {
      disconnectIncomingAudioSource(key);
    };
  };

  const cleanupIncomingAudioContext = () => {
    incomingAudioSources.forEach((_, key) => disconnectIncomingAudioSource(key));
    if (incomingAudioContext && incomingAudioContext.state !== 'closed') {
      void incomingAudioContext.close().catch(() => undefined);
    }
    incomingAudioContext = null;
    incomingAudioDelayFeedbackGainNode = null;
    incomingAudioDelayFilterNode = null;
    incomingAudioDelayNode = null;
    incomingAudioDelayReturnGainNode = null;
    incomingAudioDelaySendNode = null;
    incomingAudioDryGainNode = null;
    incomingAudioGroupAnalyser = null;
    incomingAudioGroupMeterData = null;
    incomingAudioGroupGainNode = null;
    incomingAudioGroupPannerNode = null;
    incomingAudioMasterAnalyser = null;
    incomingAudioMasterMeterData = null;
    incomingAudioMasterGainNode = null;
    incomingAudioMasterPannerNode = null;
    incomingAudioReverbConvolverNode = null;
    incomingAudioReverbReturnGainNode = null;
    incomingAudioReverbSendNode = null;
  };

  const getParticipantJoinedAtMs = (participant: Participant | null | undefined) => {
    const joinedAt = participant?.joinedAt;
    if (!(joinedAt instanceof Date)) return Number.POSITIVE_INFINITY;
    const joinedAtMs = joinedAt.getTime();
    return Number.isFinite(joinedAtMs) ? joinedAtMs : Number.POSITIVE_INFINITY;
  };

  const compareParticipantsForDisplay = (left: Participant, right: Participant) => {
    const leftHasCamera = hasCameraTrack(left);
    const rightHasCamera = hasCameraTrack(right);
    if (leftHasCamera !== rightHasCamera) return leftHasCamera ? -1 : 1;

    const leftRole = readParticipantRole(room, left, localRole);
    const rightRole = readParticipantRole(room, right, localRole);
    if (leftRole !== rightRole) return leftRole === 'teacher' ? -1 : 1;

    const joinedAtDifference = getParticipantJoinedAtMs(left) - getParticipantJoinedAtMs(right);
    if (joinedAtDifference !== 0) return joinedAtDifference;

    const nameDifference = readParticipantName(left).localeCompare(readParticipantName(right), 'es');
    if (nameDifference !== 0) return nameDifference;

    return left.identity.localeCompare(right.identity, 'es');
  };

  const getDisplayOrderedParticipants = () => [...allParticipants()].sort(compareParticipantsForDisplay);

  const reorderParticipantCardsInSlot = (slot: HTMLElement, identities: string[]) => {
    identities
      .map((identity) => participantCards.get(identity)?.card)
      .filter((card): card is HTMLElement => card instanceof HTMLElement && card.parentElement === slot)
      .forEach((card, index) => {
        if (slot.children.item(index) !== card) {
          slot.appendChild(card);
        }
      });
  };

  const createRecentSpeakerSeparator = () => {
    const separator = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    separator.setAttribute('viewBox', '0 0 20 20');
    separator.setAttribute('aria-hidden', 'true');
    separator.setAttribute('fill', 'currentColor');
    separator.classList.add('conference-recent-speakers-icon');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute(
      'd',
      'M3 9v2a7 7 0 0 0 5.5 6.83V19h3v-1.17A7 7 0 0 0 17 11V9h-2v2a5 5 0 0 1-10 0V9H3zm7-7a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z',
    );
    separator.appendChild(path);
    return separator;
  };

  const renderRecentSpeakers = (container: Element, names: string[]) => {
    if (!(container instanceof HTMLElement)) return;
    container.replaceChildren();

    names.forEach((name, index) => {
      if (index > 0) {
        container.appendChild(createRecentSpeakerSeparator());
      }

      const label = document.createElement('span');
      label.className = 'conference-recent-speakers-name';
      label.textContent = name;
      container.appendChild(label);
    });

    container.hidden = names.length === 0;
  };

  const compareSessionLeaderCandidates = (left: Participant, right: Participant) => {
    const joinedAtDifference = getParticipantJoinedAtMs(left) - getParticipantJoinedAtMs(right);
    if (joinedAtDifference !== 0) return joinedAtDifference;

    const localIdentity = normalizeText(room.localParticipant?.identity);
    if (left.identity === localIdentity && right.identity !== localIdentity) return -1;
    if (right.identity === localIdentity && left.identity !== localIdentity) return 1;

    return left.identity.localeCompare(right.identity, 'es');
  };

  const getFallbackSessionLeaderIdentity = () => {
    const teachers = allParticipants()
      .filter((participant) => readParticipantRole(room, participant, localRole) === 'teacher')
      .sort(compareSessionLeaderCandidates);
    return teachers[0]?.identity || '';
  };

  const getResolvedSessionLeaderIdentity = () => {
    if (
      manualSessionLeaderIdentity &&
      allParticipants().some(
        (participant) =>
          participant.identity === manualSessionLeaderIdentity &&
          readParticipantRole(room, participant, localRole) === 'teacher',
      )
    ) {
      return manualSessionLeaderIdentity;
    }
    return getFallbackSessionLeaderIdentity();
  };

  const isSessionLeader = (participant: Participant | { identity: string } | null | undefined) =>
    Boolean(participant && getResolvedSessionLeaderIdentity() && participant.identity === getResolvedSessionLeaderIdentity());

  const canLeadSession = () =>
    localRole === 'teacher' &&
    room.state === ConnectionState.Connected &&
    room.localParticipant.identity === getResolvedSessionLeaderIdentity();

  const applySessionLeaderState = () => {
    sessionLeaderIdentity = getResolvedSessionLeaderIdentity();
    root.dataset.sessionLeaderIdentity = sessionLeaderIdentity;

    if (sessionControlsField instanceof HTMLElement) {
      sessionControlsField.hidden = localRole !== 'teacher';
    }

    if (sessionLeaderSelect instanceof HTMLSelectElement) {
      const teachers = allParticipants()
        .filter((participant) => readParticipantRole(room, participant, localRole) === 'teacher')
        .sort((left, right) => readParticipantName(left).localeCompare(readParticipantName(right), 'es'));

      sessionLeaderSelect.innerHTML = '';
      teachers.forEach((participant) => {
        const option = document.createElement('option');
        option.value = participant.identity;
        option.textContent = readParticipantName(participant);
        sessionLeaderSelect.appendChild(option);
      });

      if (!sessionLeaderSelect.options.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Sin teachers conectados';
        sessionLeaderSelect.appendChild(option);
      }

      sessionLeaderSelect.value = sessionLeaderIdentity;
      sessionLeaderSelect.disabled = localRole !== 'teacher' || !canLeadSession();
    }

    applySessionControlState();
    syncPresentationSessionControl();
  };

  const publishSessionLeaderIdentity = async (identity: string) => {
    if (room.state !== ConnectionState.Connected || localRole !== 'teacher') return;
    await publishMessage({
      type: 'session-leader',
      identity,
    });
  };

  const publishSessionControlState = async () => {
    if (!canLeadSession()) return;
    await publishMessage({
      type: 'session-control',
      allowInstruments: sessionAllowsInstruments,
    });
  };

  const muteStudentsLocally = async () => {
    if (room.state !== ConnectionState.Connected || localRole !== 'student') return;
    if (room.localParticipant.isScreenShareEnabled) return;
    if (isSessionLeader(room.localParticipant)) return;
    await room.localParticipant.setMicrophoneEnabled(false);
  };

  const clearHandOverlays = () => {
    if (!(stageHandOverlay instanceof HTMLCanvasElement)) return;
    const context = stageHandOverlay.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, stageHandOverlay.width, stageHandOverlay.height);
  };

  const resizeOverlayCanvas = (canvas: HTMLCanvasElement) => {
    if (!(stageFrameNode instanceof HTMLElement)) return null;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(2, Math.round(stageFrameNode.clientWidth * dpr));
    const height = Math.max(2, Math.round(stageFrameNode.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return { dpr, height, width };
  };

  const getStageOverlayVideo = () => {
    if (!(stage instanceof HTMLElement)) return null;
    let bestVideo: HTMLVideoElement | null = null;
    let bestArea = 0;
    const candidates = Array.from(
      stage.querySelectorAll('.conference-media-frame--local-camera > video:not(.conference-media-backdrop)'),
    );

    candidates.forEach((candidate) => {
      if (!(candidate instanceof HTMLVideoElement)) return;
      const rect = candidate.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const panel = candidate.closest('.conference-stage-panel');
      if (panel instanceof HTMLElement) {
        const panelStyle = window.getComputedStyle(panel);
        if (
          panelStyle.display === 'none' ||
          panelStyle.visibility === 'hidden' ||
          Number(panelStyle.opacity) === 0
        ) {
          return;
        }
      }
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestVideo = candidate;
        bestArea = area;
      }
    });

    return bestVideo;
  };

  const getHandOverlayProjection = (canvas: HTMLCanvasElement, video: HTMLVideoElement) => {
    if (!(stageFrameNode instanceof HTMLElement)) return null;
    if (video.videoWidth < 2 || video.videoHeight < 2) return null;
    const stageRect = stageFrameNode.getBoundingClientRect();
    const videoRect = video.getBoundingClientRect();
    if (stageRect.width < 2 || stageRect.height < 2 || videoRect.width < 2 || videoRect.height < 2) {
      return null;
    }

    const computedStyle = window.getComputedStyle(video);
    const fit = computedStyle.objectFit === 'contain' ? 'contain' : 'cover';
    const [rawX = '50%', rawY = '50%'] = computedStyle.objectPosition.split(/\s+/);
    const offsetX = parseObjectPositionComponent(rawX, 0.5);
    const offsetY = parseObjectPositionComponent(rawY, 0.5);
    const zoom = readScaleFromTransform(computedStyle.transform);

    const canvasScaleX = canvas.width / Math.max(1, stageRect.width);
    const canvasScaleY = canvas.height / Math.max(1, stageRect.height);
    const targetWidth = Math.max(1, videoRect.width * canvasScaleX);
    const targetHeight = Math.max(1, videoRect.height * canvasScaleY);
    const sourceWidth = Math.max(1, video.videoWidth);
    const sourceHeight = Math.max(1, video.videoHeight);
    const sourceAspect = sourceWidth / sourceHeight;
    const targetAspect = targetWidth / targetHeight;

    let drawWidth = targetWidth;
    let drawHeight = targetHeight;

    if (fit === 'contain') {
      drawWidth = targetWidth;
      drawHeight = drawWidth / sourceAspect;
      if (drawHeight > targetHeight) {
        drawHeight = targetHeight;
        drawWidth = drawHeight * sourceAspect;
      }
    } else if (sourceAspect > targetAspect) {
      drawHeight = targetHeight;
      drawWidth = drawHeight * sourceAspect;
    } else {
      drawWidth = targetWidth;
      drawHeight = drawWidth / sourceAspect;
    }

    drawWidth *= zoom;
    drawHeight *= zoom;

    return {
      drawHeight,
      drawWidth,
      drawX:
        (videoRect.left - stageRect.left) * canvasScaleX +
        (targetWidth - drawWidth) * offsetX,
      drawY:
        (videoRect.top - stageRect.top) * canvasScaleY +
        (targetHeight - drawHeight) * offsetY,
      height: canvas.height,
      width: canvas.width,
    };
  };

  const renderHandOverlays = (landmarks: HandLandmarkPoint[] | null, now = performance.now()) => {
    if (
      !landmarks ||
      !handTrackEnabled ||
      room.state === ConnectionState.Connected ||
      isDisconnectedPreviewProcessingActive() ||
      !(stageHandOverlay instanceof HTMLCanvasElement)
    ) {
      clearHandOverlays();
      return;
    }

    handOverlayPulse = now * 0.0024;
    const size = resizeOverlayCanvas(stageHandOverlay);
    const video = getStageOverlayVideo();
    const projection = video ? getHandOverlayProjection(stageHandOverlay, video) : null;
    const context = stageHandOverlay.getContext('2d');
    if (!size || !projection || !context) {
      clearHandOverlays();
      return;
    }

    const { width, height } = size;
    context.clearRect(0, 0, width, height);
    drawStylizedHandOverlay(context, projection, landmarks, handOverlayPulse, previewInvert);
  };

  const buildGravityBallHandState = (
    projection: HandOverlayProjection,
    landmarks: HandLandmarkPoint[],
  ): GravityBallHandState => {
    const pointAt = (point: HandLandmarkPoint) => ({
      x: projection.drawX + (previewInvert ? 1 - point.x : point.x) * projection.drawWidth,
      y: projection.drawY + point.y * projection.drawHeight,
    });

    const projectedPoints = landmarks.map((point, index) => ({
      index,
      x: pointAt(point).x,
      y: pointAt(point).y,
    }));

    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const indexMcp = landmarks[5];
    const indexTip = landmarks[8];
    const middleMcp = landmarks[9];
    const middleTip = landmarks[12];
    const ringMcp = landmarks[13];
    const ringTip = landmarks[16];
    const pinkyMcp = landmarks[17];
    const pinkyTip = landmarks[20];

    if (
      !wrist ||
      !thumbTip ||
      !indexMcp ||
      !indexTip ||
      !middleMcp ||
      !middleTip ||
      !ringMcp ||
      !ringTip ||
      !pinkyMcp ||
      !pinkyTip
    ) {
      return {
        anchor: null,
        canGrab: false,
        points: projectedPoints,
      };
    }

    const pointWrist = pointAt(wrist);
    const pointIndexMcp = pointAt(indexMcp);
    const pointMiddleMcp = pointAt(middleMcp);
    const pointRingMcp = pointAt(ringMcp);
    const pointPinkyMcp = pointAt(pinkyMcp);
    const pointThumbTip = pointAt(thumbTip);
    const pointIndexTip = pointAt(indexTip);
    const pointMiddleTip = pointAt(middleTip);
    const pointRingTip = pointAt(ringTip);
    const pointPinkyTip = pointAt(pinkyTip);

    const palmSpan = Math.max(
      12,
      Math.hypot(pointIndexMcp.x - pointPinkyMcp.x, pointIndexMcp.y - pointPinkyMcp.y),
    );
    const fingerLiftThreshold = palmSpan * 0.16;
    const openFingers = [
      pointIndexMcp.y - pointIndexTip.y > fingerLiftThreshold,
      pointMiddleMcp.y - pointMiddleTip.y > fingerLiftThreshold,
      pointRingMcp.y - pointRingTip.y > fingerLiftThreshold,
      pointPinkyMcp.y - pointPinkyTip.y > fingerLiftThreshold,
    ].filter(Boolean).length;
    const thumbSpread =
      Math.hypot(pointThumbTip.x - pointIndexMcp.x, pointThumbTip.y - pointIndexMcp.y) > palmSpan * 0.48;
    const levelPalm = Math.abs(pointIndexMcp.y - pointPinkyMcp.y) < palmSpan * 0.18;
    const wristBelowPalm =
      pointWrist.y >
      ((pointIndexMcp.y + pointMiddleMcp.y + pointRingMcp.y + pointPinkyMcp.y) / 4) + palmSpan * 0.08;
    const trayCurl =
      pointMiddleTip.y <
      ((pointIndexMcp.y + pointMiddleMcp.y + pointRingMcp.y + pointPinkyMcp.y) / 4) - palmSpan * 0.12;

    const canGrab = openFingers >= 3 && thumbSpread && levelPalm && wristBelowPalm && trayCurl;
    const anchorX =
      (pointIndexMcp.x + pointMiddleMcp.x + pointRingMcp.x + pointPinkyMcp.x) / 4;
    const anchorY =
      ((pointIndexMcp.y + pointMiddleMcp.y + pointRingMcp.y + pointPinkyMcp.y) / 4) -
      palmSpan * 0.06;

    return {
      anchor: canGrab
        ? {
            span: palmSpan,
            vx: 0,
            vy: 0,
            x: anchorX,
            y: anchorY,
          }
        : null,
      canGrab,
      points: projectedPoints,
    };
  };

  const renderGravityBallOverlay = (landmarks: HandLandmarkPoint[] | null, now = performance.now()) => {
    if (!gravityBallRenderer) return;
    if (!gravityBallEnabled || !landmarks?.length || !(gravityBallCanvas instanceof HTMLCanvasElement)) {
      gravityBallRenderer.setHandState(null, now);
      return;
    }

    const size = resizeOverlayCanvas(gravityBallCanvas);
    const video = getStageOverlayVideo();
    const projection = video ? getHandOverlayProjection(gravityBallCanvas, video) : null;
    if (!size || !projection) {
      gravityBallRenderer.setHandState(null, now);
      return;
    }

    gravityBallRenderer.setHandState(buildGravityBallHandState(projection, landmarks), now);
  };

  const persistSetupState = () => {
    writePersistedRoomSetup({
      handTrackEnabled,
      handRampMs,
      gravityBallEnabled,
      gravityBallGravity,
      gravityBallMirror,
      backgroundColor,
      backgroundEffectMode,
      backgroundImageLabel: canPersistBackgroundImageUrl(backgroundImageUrl) ? backgroundImageSelectionLabel : '',
      backgroundImageUrl: canPersistBackgroundImageUrl(backgroundImageUrl) ? backgroundImageUrl : '',
      room: normalizeText(roomInput.value),
      identity: normalizeText(identityInput.value),
      instrumentsOpen,
      name: normalizeText(nameInput.value),
      preferredAudioInputId,
      preferredVideoInputId,
      previewBlur,
      previewInvert,
      previewZoom,
      recordingPreset,
      showCircle: showPresentationCircle,
      mixerIncomingGain,
      mixerIncomingDelaySend,
      mixerIncomingMuted,
      mixerIncomingPan,
      mixerIncomingReverbSend,
      mixerBallGain,
      mixerBallDelaySend,
      mixerBallMuted,
      mixerBallPan,
      mixerBallReverbSend,
      mixerMasterGain,
      mixerMasterMuted,
      mixerMasterPan,
      mixerSynthGain,
      mixerSynthDelaySend,
      mixerSynthMuted,
      mixerSynthPan,
      mixerSynthReverbSend,
      videoBypassed: videoMixBypassed,
      videoBrightness: videoMix.brightness,
      videoContrast: videoMix.contrast,
      videoLuma: videoMix.luma,
      videoSaturation: videoMix.saturation,
      videoTint: videoMix.tint,
      synthControlRanges,
      delayFeedback: synthDelayFeedback,
      delayMix: synthDelayMix,
      delayTime: synthDelayTime,
      delayTone: synthDelayTone,
      reverbMix: synthReverbMix,
      reverbTime: synthReverbTime,
      compressorAttack: synthCompressorAttack,
      compressorEnabled: synthCompressorEnabled,
      compressorKnee: synthCompressorKnee,
      compressorRatio: synthCompressorRatio,
      compressorRelease: synthCompressorRelease,
      compressorThreshold: synthCompressorThreshold,
      limiterEnabled: synthLimiterEnabled,
      limiterRelease: synthLimiterRelease,
      limiterThreshold: synthLimiterThreshold,
    });
  };

  const releaseRawTrackingSource = () => {
    if (rawTrackingVideo) {
      rawTrackingVideo.pause();
      rawTrackingVideo.srcObject = null;
      rawTrackingVideo = null;
    }
    if (rawTrackingStream) {
      rawTrackingStream.getTracks().forEach((track) => track.stop());
      rawTrackingStream = null;
    }
    rawTrackingDeviceId = '';
  };

  const ensureRawTrackingVideo = async (): Promise<HTMLVideoElement | null> => {
    if (!navigator.mediaDevices?.getUserMedia) return null;

    const requestedDeviceId =
      normalizeText(preferredVideoInputId) ||
      normalizeText(localPreviewStreamMount?.deviceId) ||
      normalizeText(rawTrackingDeviceId);

    const currentTrack = rawTrackingStream?.getVideoTracks()[0];
    if (
      rawTrackingVideo &&
      rawTrackingStream &&
      currentTrack?.readyState === 'live' &&
      (!requestedDeviceId || requestedDeviceId === rawTrackingDeviceId)
    ) {
      return rawTrackingVideo;
    }

    releaseRawTrackingSource();

    const exactConstraints =
      requestedDeviceId
        ? ({ video: { deviceId: { exact: requestedDeviceId } }, audio: false } satisfies MediaStreamConstraints)
        : ({ video: true, audio: false } satisfies MediaStreamConstraints);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(exactConstraints);
    } catch (error) {
      if (!requestedDeviceId) throw error;
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play().catch(() => undefined);

    rawTrackingStream = stream;
    rawTrackingVideo = video;
    rawTrackingDeviceId =
      normalizeText(stream.getVideoTracks()[0]?.getSettings?.().deviceId) || requestedDeviceId;
    return rawTrackingVideo;
  };

  const getTrackingVideoElement = (): HTMLVideoElement | null => {
    if (rawTrackingVideo instanceof HTMLVideoElement) {
      return rawTrackingVideo;
    }
    if (localPreviewStreamMount?.element instanceof HTMLVideoElement) {
      return localPreviewStreamMount.element;
    }
    if (localPreviewMount?.element instanceof HTMLVideoElement) {
      return localPreviewMount.element;
    }
    if (!(identityPreviewSlot instanceof HTMLElement)) return null;
    const element = identityPreviewSlot.querySelector('video:not(.conference-media-backdrop)');
    return element instanceof HTMLVideoElement ? element : null;
  };

  const computeHandTelemetry = (landmarks: HandLandmarkPoint[]): HandSynthTelemetry | null => {
    const wrist = landmarks[0];
    const indexMcp = landmarks[5];
    const middleMcp = landmarks[9];
    const ringMcp = landmarks[13];
    const pinkyMcp = landmarks[17];
    const thumbMcp = landmarks[2];
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const middleTip = landmarks[12];
    const ringTip = landmarks[16];
    const pinkyTip = landmarks[20];

    if (
      !wrist ||
      !indexMcp ||
      !middleMcp ||
      !ringMcp ||
      !pinkyMcp ||
      !thumbMcp ||
      !thumbTip ||
      !indexTip ||
      !middleTip ||
      !ringTip ||
      !pinkyTip
    ) {
      return null;
    }

    const palmX = clamp01((wrist.x + middleMcp.x + indexMcp.x) / 3);
    const palmY = clamp01((wrist.y + middleMcp.y) / 2);
    const thumbDistance = Math.hypot(thumbTip.x - thumbMcp.x, thumbTip.y - thumbMcp.y);
    const thumbGain = clamp01((thumbDistance - 0.04) / 0.22);
    const indexLift = clamp01(((indexMcp.y - indexTip.y) - 0.03) / 0.28);
    const middleLift = clamp01(((middleMcp.y - middleTip.y) - 0.03) / 0.3);
    const ringLift = clamp01(((ringMcp.y - ringTip.y) - 0.03) / 0.3);
    const pinkyLift = clamp01(((pinkyMcp.y - pinkyTip.y) - 0.03) / 0.3);
    currentHandControlValues = {
      carrier: roundTo(1 - palmY, 3),
      modulator: roundTo(palmX, 3),
      distortion: roundTo(pinkyLift, 3),
      gain: roundTo(thumbGain, 3),
      cutoff: roundTo(indexLift, 3),
      resonance: roundTo(ringLift, 3),
      waveformMorph: roundTo(middleLift, 3),
    };

    return buildHandSynthTelemetry(currentHandControlValues);
  };

  const clearHandTrackingOutput = () => {
    currentHandLandmarks = null;
    currentHandControlValues = null;
    localCameraHandOverlayState.landmarks = null;
    fmSynth.clearHand();
    renderSynthTelemetry({
      carrier: 220,
      modulator: 110,
      distortion: 0,
      gain: 0,
      cutoff: 800,
      resonance: 1,
      waveformMorph: 0,
    });
    clearHandOverlays();
    renderGravityBallOverlay(null);
  };

  const stopHandTracking = () => {
    handTrackingGeneration += 1;
    handTrackingLastDetectionAt = 0;
    if (handTrackingAnimationId) {
      window.cancelAnimationFrame(handTrackingAnimationId);
      handTrackingAnimationId = 0;
    }
    releaseRawTrackingSource();
    clearHandTrackingOutput();
  };

  const ensureHandLandmarker = async () => {
    if (handTrackingLandmarker) return handTrackingLandmarker;
    handTrackingLandmarker = await createHandLandmarker();
    return handTrackingLandmarker;
  };

  const startHandTracking = async () => {
    if (!shouldRunHandTracking() || destroyed) {
      stopHandTracking();
      return;
    }

    const generation = handTrackingGeneration + 1;
    handTrackingGeneration = generation;
    if (handTrackingAnimationId) {
      window.cancelAnimationFrame(handTrackingAnimationId);
      handTrackingAnimationId = 0;
    }

    try {
      if (handTrackEnabled) {
        await fmSynth.ensureReady();
        await ensurePublishedSynthTrack().catch(() => undefined);
        applyMixerState();
        applySynthFxState();
      }
      if (gravityBallEnabled) {
        await ensurePublishedBallTrack().catch(() => undefined);
        applyMixerState();
      }
      const landmarker = await ensureHandLandmarker();
      await ensureRawTrackingVideo().catch(() => null);
      if (!shouldRunHandTracking() || destroyed || generation !== handTrackingGeneration) return;

      const tick = () => {
        if (!shouldRunHandTracking() || destroyed || generation !== handTrackingGeneration) {
          return;
        }

        const video = getTrackingVideoElement();
        if (
          !video ||
          video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
          video.videoWidth < 2 ||
          video.videoHeight < 2
        ) {
          clearHandTrackingOutput();
          handTrackingAnimationId = window.requestAnimationFrame(tick);
          return;
        }

        const now = performance.now();
        if (now - handTrackingLastDetectionAt >= 50) {
          handTrackingLastDetectionAt = now;
          try {
            const result = landmarker.detectForVideo(video, now);
            const landmarks = Array.isArray(result.landmarks) && result.landmarks[0]
              ? (result.landmarks[0] as HandLandmarkPoint[])
              : null;
            const telemetry = landmarks ? computeHandTelemetry(landmarks) : null;

            if (landmarks) {
              currentHandLandmarks = landmarks;
              localCameraHandOverlayState.landmarks = landmarks;
              renderGravityBallOverlay(landmarks, now);
              if (telemetry && handTrackEnabled) {
                renderSynthTelemetry(telemetry);
                fmSynth.update(telemetry);
              }
            } else {
              clearHandTrackingOutput();
            }
          } catch {
            clearHandTrackingOutput();
          }
        }

        renderHandOverlays(currentHandLandmarks, now);
        if (!currentHandLandmarks) {
          renderGravityBallOverlay(null, now);
        }

        handTrackingAnimationId = window.requestAnimationFrame(tick);
      };

      handTrackingAnimationId = window.requestAnimationFrame(tick);
    } catch (error) {
      handTrackEnabled = false;
      applyHandTrackState();
      persistSetupState();
      clearHandTrackingOutput();
      setStatus(safeErrorMessage(error));
    }
  };

  const syncRoleUi = () => {
    roleInput.value = localRole;
    root.dataset.role = localRole;
    if (roleLabel instanceof HTMLElement) {
      roleLabel.textContent = formatRoleLabel(localRole);
    }
    if (sessionControlsField instanceof HTMLElement) {
      sessionControlsField.hidden = localRole !== 'teacher';
    }
    syncBreakRoomsShell();
    syncExternalMediaShell();
  };

  const readParticipantHandRaised = (participant: Participant) =>
    isLocalParticipant(room, participant)
      ? localHandRaised
      : readParticipantHandRaisedFromMetadata(participant);

  const syncRaiseHandUi = () => {
    if (!(raiseHandButton instanceof HTMLButtonElement)) return;
    raiseHandButton.dataset.active = localHandRaised ? 'true' : 'false';
    raiseHandButton.setAttribute('aria-pressed', localHandRaised ? 'true' : 'false');
    raiseHandButton.title = localHandRaised ? 'Bajar la mano (M)' : 'Levantar la mano (M)';
    raiseHandButton.setAttribute(
      'aria-label',
      localHandRaised ? 'Bajar la mano' : 'Levantar la mano',
    );
  };

  const updateLocalParticipantMetadata = async (metadata: string) => {
    const participant = room.localParticipant as LocalParticipant & {
      setMetadata?: (value: string) => Promise<void> | void;
    };
    if (typeof participant.setMetadata !== 'function') return;
    await participant.setMetadata(metadata);
  };

  const syncLocalParticipantMetadata = async () => {
    if (room.state !== ConnectionState.Connected) return;
    const currentMetadata = readParticipantMetadata(room.localParticipant as unknown as Participant);
    await updateLocalParticipantMetadata(
      JSON.stringify({
        ...currentMetadata,
        courseId: getEffectiveCourseId() || normalizeText(currentMetadata.courseId),
        pageSlug: getCurrentPresentationPageSlug() || normalizeText(currentMetadata.pageSlug),
        role: localRole,
        handRaised: localHandRaised,
        previewZoom,
        showCircle: showPresentationCircle,
      }),
    );
  };

  const ensurePublishedSynthTrack = async () => {
    if (room.state !== ConnectionState.Connected) return;
    const existingTrackState = (publishedSynthTrack as unknown as {
      mediaStreamTrack?: MediaStreamTrack | null;
    } | null)?.mediaStreamTrack?.readyState;
    if (publishedSynthTrack && existingTrackState === 'live') return;
    if (publishedSynthTrack) {
      await unpublishSynthTrack().catch(() => undefined);
    }

    const outputTrack = fmSynth.getOutputTrack();
    if (!outputTrack) return;

    const localAudioTrack = new LocalAudioTrack(outputTrack, undefined, false, undefined);
    localAudioTrack.source = Track.Source.Unknown;
    publishedSynthTrack = localAudioTrack;
    try {
      await room.localParticipant.publishTrack(localAudioTrack, {
        name: 'FM synth',
      });
    } catch (error) {
      publishedSynthTrack = null;
      localAudioTrack.stop();
      throw error;
    }
  };

  const ensurePublishedBallTrack = async () => {
    if (room.state !== ConnectionState.Connected || !gravityBallEnabled) return;
    const existingTrackState = (publishedBallTrack as unknown as {
      mediaStreamTrack?: MediaStreamTrack | null;
    } | null)?.mediaStreamTrack?.readyState;
    if (publishedBallTrack && existingTrackState === 'live') return;
    if (publishedBallTrack) {
      await unpublishBallTrack().catch(() => undefined);
    }

    if (gravityBallRenderer) {
      await gravityBallRenderer.primeAudio().catch(() => undefined);
    }
    const outputTrack = gravityBallRenderer?.getOutputTrack() || null;
    if (!outputTrack) return;

    const localAudioTrack = new LocalAudioTrack(outputTrack, undefined, false, undefined);
    localAudioTrack.source = Track.Source.Unknown;
    publishedBallTrack = localAudioTrack;
    try {
      await room.localParticipant.publishTrack(localAudioTrack, {
        name: 'Gravity ball',
      });
    } catch (error) {
      publishedBallTrack = null;
      localAudioTrack.stop();
      throw error;
    }
  };

  const syncPublishedBallTrack = async () => {
    if (room.state !== ConnectionState.Connected) return;
    if (!gravityBallEnabled || !canUseInstruments()) {
      await unpublishBallTrack().catch(() => undefined);
      return;
    }
    await ensurePublishedBallTrack().catch(() => undefined);
  };

  const unpublishSynthTrack = async () => {
    if (!publishedSynthTrack) return;
    try {
      await room.localParticipant.unpublishTrack(publishedSynthTrack, false);
    } catch {
      // ignore unpublish failures during disconnect
    }
    publishedSynthTrack.stop();
    publishedSynthTrack = null;
  };

  const unpublishBallTrack = async () => {
    if (!publishedBallTrack) return;
    try {
      await room.localParticipant.unpublishTrack(publishedBallTrack, false);
    } catch {
      // ignore unpublish failures during disconnect
    }
    publishedBallTrack.stop();
    publishedBallTrack = null;
  };

  // ── Compositor track publish / unpublish ──────────────────────────────────

  const unpublishCompositorTrack = async () => {
    if (!compositorVideoTrack) return;
    try {
      await room.localParticipant.unpublishTrack(compositorVideoTrack, false);
    } catch {
      // ignore unpublish errors during disconnect
    }
    compositorVideoTrack.stop();
    compositorVideoTrack = null;
  };

  const publishCompositorStream = async (stream: MediaStream) => {
    await unpublishCompositorTrack();
    if (room.state !== ConnectionState.Connected) return;
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;
    // Disable the regular camera so both tracks don't occupy the same slot
    try {
      await room.localParticipant.setCameraEnabled(false);
    } catch {
      // best-effort
    }
    const localTrack = new LocalVideoTrack(videoTrack, undefined, false);
    localTrack.source = Track.Source.Camera;
    compositorVideoTrack = localTrack;
    try {
      await room.localParticipant.publishTrack(localTrack, {
        name: 'Compositor',
        source: Track.Source.Camera,
      });
    } catch (error) {
      compositorVideoTrack = null;
      localTrack.stop();
      throw error;
    }
  };

  // ── Compositor stage routing (offline preview) ────────────────────────────

  const showCompositorInStage = (stream: MediaStream) => {
    if (!(teacherSlot instanceof HTMLElement)) return;
    forceDisconnectedPreviewLayout();

    // If the regular disconnected preview card is already mounted, just swap its
    // video srcObject — avoids rebuilding the participant card DOM.
    if (disconnectedStagePreviewMount) {
      disconnectedStagePreviewMount.element.srcObject = stream;
      compositorInStage = true;
      return;
    }

    // Otherwise build a minimal participant card for the compositor output
    const node = cloneTemplate(participantTemplate);
    if (!node) return;
    const media = node.querySelector('[data-card-media]');
    const namEl = node.querySelector('[data-card-name]');
    const placeholder = node.querySelector('[data-card-placeholder]');
    if (!(media instanceof HTMLElement)) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'conference-media-frame conference-media-frame--local-camera';
    wrapper.dataset.compositorStagePreview = 'true';

    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    wrapper.appendChild(video);
    media.appendChild(wrapper);
    if (namEl instanceof HTMLElement) namEl.textContent = 'Compositor';
    if (placeholder instanceof HTMLElement) placeholder.hidden = true;
    node.dataset.role = localRole;

    teacherSlot.innerHTML = '';
    teacherSlot.appendChild(node);
    void video.play().catch(() => undefined);
    compositorInStage = true;
  };

  const clearCompositorFromStage = () => {
    compositorInStage = false;

    // If we swapped the srcObject of the regular preview, restore it
    if (disconnectedStagePreviewMount) {
      const regularStream = localPreviewStreamMount?.stream ?? null;
      disconnectedStagePreviewMount.element.srcObject = regularStream;
      return;
    }

    // Remove the compositor-only card
    if (teacherSlot instanceof HTMLElement) {
      teacherSlot.querySelector('[data-compositor-stage-preview]')?.closest('[data-card-placeholder]')?.parentElement?.remove();
      // Simpler: just clear the slot and let syncAllParticipants rebuild
      const compositorCard = teacherSlot.querySelector('[data-compositor-stage-preview]');
      compositorCard?.parentElement?.parentElement?.remove();
      // Fallback: clear entirely so next sync repopulates correctly
      if (teacherSlot.querySelector('[data-compositor-stage-preview]')) {
        teacherSlot.innerHTML = '';
      }
    }

    syncAllParticipants();
  };

  document.addEventListener('compositor:started', (e) => {
    const stream = (e as CustomEvent<{ stream: MediaStream | null }>).detail?.stream;
    compositorOutputStream = stream || null;
    if (!stream) return;

    if (room.state === ConnectionState.Connected) {
      void publishCompositorStream(stream).catch(() => undefined);
    } else {
      // Offline: show compositor canvas in teacher slot so user sees output
      showCompositorInStage(stream);
    }
  });

  document.addEventListener('compositor:stopped', () => {
    compositorOutputStream = null;
    clearCompositorFromStage();
    void unpublishCompositorTrack().then(async () => {
      if (room.state === ConnectionState.Connected) {
        await room.localParticipant.setCameraEnabled(true).catch(() => undefined);
        syncAllParticipants();
      }
    });
  });

  const toggleRaisedHand = async () => {
    localHandRaised = !localHandRaised;
    syncRaiseHandUi();
    syncAllParticipants();

    if (room.state !== ConnectionState.Connected) return;

    try {
      await syncLocalParticipantMetadata();
    } catch (error) {
      localHandRaised = !localHandRaised;
      syncRaiseHandUi();
      syncAllParticipants();
      setStatus(safeErrorMessage(error));
    }
  };

  const toggleSidebarCollapsed = () => {
    sidebarCollapsed = !sidebarCollapsed;
    applySidebarCollapsedState();
    persistSetupState();
    queuePreferredRemoteVideoDimensionsSync();
  };

  const toggleInstrumentsOpen = () => {
    instrumentsOpen = !instrumentsOpen;
    applyInstrumentsOpenState();
    persistSetupState();
  };

  const shouldIgnoreRoomShortcut = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'));
  };

  const closeDevicePanels = () => {
    deviceController.closePanels();
  };

  const openDevicePanel = (kind: 'audio' | 'video') => {
    deviceController.togglePanel(kind);
  };

  const syncLayoutChoiceButtons = () => {
    const layoutLocked = layoutInput.disabled;
    layoutChoiceButtons.forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      const buttonLayout = normalizeLayoutMode(button.dataset.layoutChoice || '');
      const isActive = buttonLayout === layoutInput.value;
      button.disabled = layoutLocked;
      button.dataset.active = isActive ? 'true' : 'false';
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  };

  const requestRemotePublicationDimensions = (
    publication: TrackPublication | undefined,
    target: HTMLElement,
    minimumWidth: number,
    minimumHeight: number,
  ) => {
    if (!(publication instanceof RemoteTrackPublication)) return;

    const rect = target.getBoundingClientRect();
    const pixelDensity = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(minimumWidth, Math.round(rect.width * pixelDensity));
    const height = Math.max(minimumHeight, Math.round(rect.height * pixelDensity));

    publication.setVideoDimensions({ width, height });
    if (typeof publication.setVideoFPS === 'function') {
      publication.setVideoFPS(30);
    }
  };

  const syncPreferredRemoteVideoDimensions = () => {
    const currentLayout = getCurrentLayout();
    const optimizeSpeaker = (optimizeSpeakerInput as HTMLInputElement)?.checked ?? true;
    const limitGridQuality = (limitGridQualityInput as HTMLInputElement)?.checked ?? true;
    const activeSpeakers = new Set(room.activeSpeakers.map((p) => p.identity));

    allParticipants().forEach((participant) => {
      if (isLocalParticipant(room, participant)) return;

      const isSpeaker = activeSpeakers.has(participant.identity);
      const isFocused = participant.identity === focusedParticipantIdentity;

      participant.videoTrackPublications.forEach((publication) => {
        if (publication.source === Track.Source.ScreenShare) {
          requestRemotePublicationDimensions(publication, screenSlot, 1920, 1080);
          return;
        }

        if (isFocused || (optimizeSpeaker && isSpeaker)) {
          const target = isFocused ? teacherSlot : gridSlot;
          requestRemotePublicationDimensions(publication, target, 1280, 720);
          return;
        }

        if (currentLayout === 'teacher' && participant.identity === focusedParticipantIdentity) {
          requestRemotePublicationDimensions(publication, teacherSlot, 1280, 720);
          return;
        }

        if (limitGridQuality) {
          requestRemotePublicationDimensions(publication, gridSlot, 320, 180);
        } else {
          requestRemotePublicationDimensions(publication, gridSlot, 640, 360);
        }
      });
    });
  };

  const queuePreferredRemoteVideoDimensionsSync = () => {
    window.requestAnimationFrame(() => {
      syncPreferredRemoteVideoDimensions();
    });
  };

  const getCurrentPresentationHref = () =>
    normalizeText(presentationSelect.value) || presentation.getHref() || null;

  const getSelectedPresentationCourseId = () => {
    const selectedOption = presentationSelect.selectedOptions.item(0);
    if (selectedOption instanceof HTMLOptionElement) {
      const selectedCourseId = normalizeText(selectedOption.dataset.courseId);
      if (selectedCourseId) return selectedCourseId;
    }
    return resolvePresentationCourseId(
      selectedOption instanceof HTMLOptionElement
        ? normalizeText(selectedOption.value) || presentationSelect.value
        : presentationSelect.value,
    );
  };

  const getEffectiveCourseId = () =>
    getSelectedPresentationCourseId() ||
    resolvePresentationCourseId(getCurrentPresentationHref()) ||
    courseId;

  const getCurrentPresentationPageSlug = () => resolvePresentationPageSlug(getCurrentPresentationHref());

  const getLiveActivityHref = (snapshot: LiveSnapshot | null) => {
    const sessionId = normalizeText(snapshot?.sessionId);
    if (!sessionId) return '';
    const url = new URL(`/live/${encodeURIComponent(sessionId)}`, window.location.origin);
    const effectiveCourseId = getEffectiveCourseId() || normalizeText(snapshot?.courseId);
    if (effectiveCourseId) {
      url.searchParams.set('courseId', effectiveCourseId);
    }
    return `${url.pathname}${url.search}`;
  };

  const renderLiveActivity = () => {
    if (!(liveActivityButton instanceof HTMLButtonElement)) return;

    const snapshot = activeLiveSnapshot;
    const effectiveCourseId = getEffectiveCourseId();
    const effectivePageSlug = getCurrentPresentationPageSlug();
    const snapshotCourseId = normalizeText(snapshot?.courseId);
    const snapshotPageSlug = normalizeText(snapshot?.pageSlug);
    const remainingMs = snapshot?.endsAt ? getRemainingMs(snapshot.endsAt, Date.now()) : null;
    const courseMatches =
      !effectiveCourseId ||
      !snapshotCourseId ||
      snapshotCourseId === effectiveCourseId;
    const pageMatches =
      !effectivePageSlug ||
      !snapshotPageSlug ||
      snapshotPageSlug === effectivePageSlug;
    const isVisible = Boolean(
      snapshot?.active &&
      normalizeText(snapshot?.sessionId) &&
      (remainingMs === null || remainingMs > 0) &&
      (courseMatches || pageMatches),
    );

    liveActivityButton.hidden = !isVisible;
    liveActivityButton.disabled = !isVisible;
    if (!isVisible) {
      liveActivityButton.removeAttribute('data-live-href');
      if (liveActivityTimer instanceof HTMLElement) {
        liveActivityTimer.textContent = '--:--';
      }
      return;
    }

    const href = getLiveActivityHref(snapshot);
    liveActivityButton.dataset.liveHref = href;
    liveActivityButton.title = snapshot?.prompt
      ? `Interacción activa: ${snapshot.prompt}`
      : 'Interacción activa';

    if (liveActivityTimer instanceof HTMLElement) {
      liveActivityTimer.textContent = formatCountdown(remainingMs);
    }
  };

  const renderSessionTimer = () => {
    if (!(sessionTimer instanceof HTMLElement)) return;
    sessionTimer.textContent = connectedAtMs
      ? formatElapsedTime(Date.now() - connectedAtMs)
      : '00:00:00';
  };

  const syncMicMeter = () => {
    const connected = room.state === ConnectionState.Connected;

    if (!connected) {
      // Offline: feed meter from test stream audio or disconnected mic stream
      const offlineTrack =
        testStream?.getAudioTracks()[0] ??
        disconnectedMicStream?.getAudioTracks()[0] ??
        null;
      if (offlineTrack && offlineTrack.readyState === 'live') {
        void micMeterController.start(offlineTrack).catch(() => micMeterController.stop());
      } else {
        micMeterController.stop();
      }
      return;
    }

    const microphoneEnabled = room.localParticipant.isMicrophoneEnabled;
    const localMicPublication = Array.from(room.localParticipant.audioTrackPublications.values()).find(
      (entry) => entry.track && entry.source !== Track.Source.ScreenShareAudio,
    );

    const localMicTrack = (localMicPublication?.track as { mediaStreamTrack?: MediaStreamTrack } | undefined)
      ?.mediaStreamTrack;

    if (!microphoneEnabled || !localMicTrack || localMicTrack.readyState !== 'live') {
      micMeterController.stop();
      return;
    }

    void micMeterController.start(localMicTrack).catch(() => {
      micMeterController.stop();
    });
  };

  const canRecordCurrentStage = () => {
    const connecting =
      room.state === ConnectionState.Connecting ||
      room.state === ConnectionState.Reconnecting ||
      room.state === ConnectionState.SignalReconnecting;
    if (connecting) return false;
    if (room.state === ConnectionState.Connected) return true;
    if (disconnectedCameraPreviewEnabled) return true;
    if (Boolean(presentation.getHref())) return true;
    if (gravityBallEnabled || handTrackEnabled) return true;
    return getVisibleVideoElements().length > 0;
  };

  const setRecordState = (isRecording: boolean) => {
    if (!(recordButton instanceof HTMLButtonElement)) return;
    root.dataset.recording = isRecording ? 'true' : 'false';
    recordButton.dataset.recording = isRecording ? 'true' : 'false';
    recordButton.title = isRecording ? 'Detener grabacion' : 'Grabar escena';
    recordButton.setAttribute(
      'aria-label',
      isRecording ? 'Detener grabacion' : 'Grabar escena',
    );
  };

  const cancelRecordingFrame = () => {
    if (!recordingAnimationId) return;
    window.cancelAnimationFrame(recordingAnimationId);
    recordingAnimationId = 0;
  };

  const cleanupRecordingAudio = () => {
    recordingMediaElementSources.forEach((node) => {
      try {
        node.disconnect();
      } catch {
        // ignore disconnected nodes
      }
    });
    recordingMediaElementSources = [];

    recordingMicTrackClones.forEach((track) => track.stop());
    recordingMicTrackClones = [];

    if (recordingAudioContext) {
      void recordingAudioContext.close().catch(() => undefined);
      recordingAudioContext = null;
    }
  };

  const cleanupRecording = () => {
    cancelRecordingFrame();
    if (recordingDataRequestId) {
      window.clearInterval(recordingDataRequestId);
      recordingDataRequestId = 0;
    }
    cleanupRecordingAudio();
    if (recordingDisplayStream) {
      recordingDisplayStream.getTracks().forEach((track) => track.stop());
      recordingDisplayStream = null;
    }
    if (recordingDisplayVideo) {
      recordingDisplayVideo.pause();
      recordingDisplayVideo.srcObject = null;
      recordingDisplayVideo = null;
    }
    if (recordingStream) {
      recordingStream.getTracks().forEach((track) => track.stop());
      recordingStream = null;
    }
    recordingCanvasContext = null;
    recordingCanvas = null;
    mediaRecorder = null;
    recordingChunks = [];
    if (recordingPresentationUrl) {
      URL.revokeObjectURL(recordingPresentationUrl);
      recordingPresentationUrl = '';
    }
    recordingPresentationImage = null;
    recordingPresentationSnapshotTask = null;
    recordingPresentationLastSnapshotAt = 0;
    setRecordingGuideSuppressed(false);
    setRecordState(false);
  };

  const downloadRecording = (blob: Blob) => {
    const roomName = normalizeText(roomInput.value) || 'room';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const href = URL.createObjectURL(blob);
    const normalizedType = normalizeText(blob.type).toLowerCase();
    const extension = normalizedType.includes('mp4')
      ? 'mp4'
      : normalizedType.includes('webm')
        ? 'webm'
        : 'bin';
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `${roomName}-${stamp}.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => {
      URL.revokeObjectURL(href);
    }, 1000);
  };

  const downloadStageImage = (blob: Blob) => {
    const roomName = normalizeText(roomInput.value) || 'room';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `${roomName}-${stamp}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => {
      URL.revokeObjectURL(href);
    }, 1000);
  };

  const stopRecording = () => {
    if (!mediaRecorder) {
      cleanupRecording();
      return;
    }

    if (mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      return;
    }

    cleanupRecording();
  };

  const getVisibleVideoElements = () =>
    Array.from(stageFrame.querySelectorAll('video')).filter((element): element is HTMLVideoElement => {
      if (!(element instanceof HTMLVideoElement)) return false;
      if (element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;

      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;

      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        return false;
      }

      return true;
    });

  const stageFrame =
    stageFrameNode instanceof HTMLElement
      ? stageFrameNode
      : stage;

  const getRecordingViewportRect = () => {
    const frameRect = stageFrame.getBoundingClientRect();
    const preset = getRecordingPresetConfig(recordingPreset);
    const crop = getAspectFitRect(frameRect.width, frameRect.height, preset.width / preset.height);

    return new DOMRect(
      frameRect.left + crop.x,
      frameRect.top + crop.y,
      crop.width,
      crop.height,
    );
  };

  const getRecordingViewportSourceRect = (video: HTMLVideoElement) => {
    const viewportRect = getRecordingViewportRect();
    const viewportWidth = Math.max(1, window.innerWidth);
    const viewportHeight = Math.max(1, window.innerHeight);
    const scaleX = video.videoWidth / viewportWidth;
    const scaleY = video.videoHeight / viewportHeight;

    return {
      sx: Math.max(0, Math.round(viewportRect.left * scaleX)),
      sy: Math.max(0, Math.round(viewportRect.top * scaleY)),
      sw: Math.max(2, Math.round(viewportRect.width * scaleX)),
      sh: Math.max(2, Math.round(viewportRect.height * scaleY)),
    };
  };

  const createRecordingDisplayConstraints = () => ({
    video: {
      frameRate: 30,
      width: { ideal: 2560, max: 3840 },
      height: { ideal: 1440, max: 2160 },
    },
    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
      sampleRate: 48_000,
      suppressLocalAudioPlayback: false,
    },
    selfBrowserSurface: 'include',
    surfaceSwitching: 'include',
    systemAudio: 'include',
  });

  const startRecordingDisplayCapture = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) return false;

    const stream = await navigator.mediaDevices.getDisplayMedia(
      createRecordingDisplayConstraints() as MediaStreamConstraints,
    );

    const [videoTrack] = stream.getVideoTracks();
    if (!videoTrack) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('No se pudo obtener video de la captura.');
    }
    try {
      videoTrack.contentHint = 'detail';
    } catch {
      // ignore unsupported hint
    }

    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('No se pudo iniciar la captura de la pestaña.'));
    });

    await video.play().catch(() => undefined);

    videoTrack.addEventListener('ended', () => {
      if (mediaRecorder?.state === 'recording') {
        stopRecording();
      } else {
        cleanupRecording();
      }
    });

    recordingDisplayStream = stream;
    recordingDisplayVideo = video;
    return true;
  };

  const drawVideoIntoRect = ({
    context,
    fit = 'cover',
    offsetX = 0.5,
    offsetY = 0.5,
    rect,
    video,
  }: {
    context: CanvasRenderingContext2D;
    fit?: 'contain' | 'cover';
    offsetX?: number;
    offsetY?: number;
    rect: DOMRect;
    video: HTMLVideoElement;
  }) => {
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    const targetWidth = Math.max(1, rect.width);
    const targetHeight = Math.max(1, rect.height);

    if (!sourceWidth || !sourceHeight || !targetWidth || !targetHeight) return;

    const sourceAspect = sourceWidth / sourceHeight;
    const targetAspect = targetWidth / targetHeight;

    if (fit === 'contain') {
      let drawWidth = targetWidth;
      let drawHeight = drawWidth / sourceAspect;

      if (drawHeight > targetHeight) {
        drawHeight = targetHeight;
        drawWidth = drawHeight * sourceAspect;
      }

      const drawX = rect.x + (targetWidth - drawWidth) / 2;
      const drawY = rect.y + (targetHeight - drawHeight) / 2;
      context.drawImage(video, drawX, drawY, drawWidth, drawHeight);
      return;
    }

    let sx = 0;
    let sy = 0;
    let sw = sourceWidth;
    let sh = sourceHeight;

    if (sourceAspect > targetAspect) {
      sw = sourceHeight * targetAspect;
      sx = (sourceWidth - sw) * offsetX;
    } else {
      sh = sourceWidth / targetAspect;
      sy = (sourceHeight - sh) * offsetY;
    }

    sx = Math.max(0, Math.min(sx, sourceWidth - sw));
    sy = Math.max(0, Math.min(sy, sourceHeight - sh));

    context.drawImage(video, sx, sy, sw, sh, rect.x, rect.y, targetWidth, targetHeight);
  };

  const isPresentationCircleVideo = (video: HTMLVideoElement) =>
    Boolean(
      video.closest('.conference-stage-panel--focus') &&
      stage.dataset.layout === 'presentation',
    );

  const isSelfPreviewVideo = (video: HTMLVideoElement) =>
    Boolean(video.closest('.conference-self-preview'));

  const serializeComputedStyle = (style: CSSStyleDeclaration) => {
    const declarations: string[] = [];

    for (let index = 0; index < style.length; index += 1) {
      const propertyName = style.item(index);
      const propertyValue = style.getPropertyValue(propertyName);
      if (!propertyName || !propertyValue) continue;
      const priority = style.getPropertyPriority(propertyName);
      declarations.push(`${propertyName}:${propertyValue}${priority ? ' !important' : ''};`);
    }

    return declarations.join('');
  };

  const clonePresentationNode = (
    sourceNode: Node,
    snapshotDocument: Document,
    sourceWindow: Window,
  ): Node | null => {
    const xhtmlNamespace = 'http://www.w3.org/1999/xhtml';
    const svgNamespace = 'http://www.w3.org/2000/svg';

    if (sourceNode.nodeType === Node.TEXT_NODE) {
      return snapshotDocument.createTextNode(sourceNode.textContent || '');
    }

    if (!(sourceNode instanceof sourceWindow.Element)) {
      return null;
    }

    if (sourceNode instanceof sourceWindow.HTMLCanvasElement) {
      const image = snapshotDocument.createElementNS(xhtmlNamespace, 'img');
      image.setAttribute('src', sourceNode.toDataURL('image/png'));
      image.setAttribute('style', serializeComputedStyle(sourceWindow.getComputedStyle(sourceNode)));
      return image;
    }

    if (sourceNode instanceof sourceWindow.HTMLVideoElement) {
      if (sourceNode.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = Math.max(1, sourceNode.videoWidth || Math.round(sourceNode.clientWidth) || 1);
      frameCanvas.height = Math.max(1, sourceNode.videoHeight || Math.round(sourceNode.clientHeight) || 1);
      const frameContext = frameCanvas.getContext('2d');
      if (!frameContext) return null;
      frameContext.drawImage(sourceNode, 0, 0, frameCanvas.width, frameCanvas.height);
      const image = snapshotDocument.createElementNS(xhtmlNamespace, 'img');
      image.setAttribute('src', frameCanvas.toDataURL('image/png'));
      image.setAttribute('style', serializeComputedStyle(sourceWindow.getComputedStyle(sourceNode)));
      return image;
    }

    const namespace = sourceNode.namespaceURI === svgNamespace ? svgNamespace : xhtmlNamespace;
    const tagName = namespace === svgNamespace ? sourceNode.tagName : sourceNode.tagName.toLowerCase();
    const clone = snapshotDocument.createElementNS(namespace, tagName);

    Array.from(sourceNode.attributes).forEach((attribute) => {
      if (attribute.name === 'style') return;
      let value = attribute.value;
      if ((attribute.name === 'src' || attribute.name === 'href') && value && !value.startsWith('data:')) {
        try {
          value = new URL(value, sourceWindow.location.href).href;
        } catch {
          // keep the original value if URL resolution fails
        }
      }
      clone.setAttribute(attribute.name, value);
    });

    const computedStyle = sourceWindow.getComputedStyle(sourceNode);
    const inlineStyle = serializeComputedStyle(computedStyle);
    if (inlineStyle) {
      clone.setAttribute('style', inlineStyle);
    }

    if (sourceNode instanceof sourceWindow.HTMLImageElement && sourceNode.currentSrc) {
      clone.setAttribute('src', sourceNode.currentSrc);
    }

    if (sourceNode instanceof sourceWindow.HTMLInputElement) {
      clone.setAttribute('value', sourceNode.value);
    }

    if (sourceNode instanceof sourceWindow.HTMLTextAreaElement) {
      clone.textContent = sourceNode.value;
    }

    sourceNode.childNodes.forEach((childNode) => {
      const childClone = clonePresentationNode(childNode, snapshotDocument, sourceWindow);
      if (childClone) {
        clone.appendChild(childClone);
      }
    });

    return clone;
  };

  const buildPresentationSnapshotSvg = () => {
    if (stage.dataset.layout !== 'presentation') return null;
    if (presentationFrame.hidden || !presentation.getHref()) return null;

    const frameWindow = presentationFrame.contentWindow;
    const frameDocument = frameWindow?.document;
    if (!frameWindow || !frameDocument) return null;

    const revealRoot =
      frameDocument.querySelector('.reveal-viewport') || frameDocument.querySelector('.reveal');
    if (!(revealRoot instanceof frameWindow.HTMLElement)) return null;

    const width = Math.max(
      2,
      Math.round(revealRoot.clientWidth || frameDocument.documentElement.clientWidth || presentationFrame.clientWidth),
    );
    const height = Math.max(
      2,
      Math.round(revealRoot.clientHeight || frameDocument.documentElement.clientHeight || presentationFrame.clientHeight),
    );

    const snapshotDocument = document.implementation.createHTMLDocument('presentation-snapshot');
    const wrapper = snapshotDocument.createElementNS('http://www.w3.org/1999/xhtml', 'div');
    wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    wrapper.setAttribute(
      'style',
      `${serializeComputedStyle(frameWindow.getComputedStyle(revealRoot))};position:relative;overflow:hidden;width:${width}px;height:${height}px;background:#000;`,
    );

    const revealClone = clonePresentationNode(revealRoot, snapshotDocument, frameWindow);
    if (revealClone) {
      wrapper.appendChild(revealClone);
    }

    const xhtml = new XMLSerializer().serializeToString(wrapper);
    const svgMarkup =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<foreignObject width="100%" height="100%">${xhtml}</foreignObject>` +
      '</svg>';

    return {
      svgMarkup,
      width,
      height,
    };
  };

  const refreshRecordingPresentationSnapshot = async (force = false) => {
    if (recordingPresentationSnapshotTask) return recordingPresentationSnapshotTask;
    if (!force && Date.now() - recordingPresentationLastSnapshotAt < 400) return;

    recordingPresentationSnapshotTask = (async () => {
      const snapshot = buildPresentationSnapshotSvg();
      if (!snapshot) {
        if (recordingPresentationUrl) {
          URL.revokeObjectURL(recordingPresentationUrl);
          recordingPresentationUrl = '';
        }
        recordingPresentationImage = null;
        recordingPresentationLastSnapshotAt = 0;
        return;
      }

      recordingPresentationLastSnapshotAt = Date.now();

      const url = URL.createObjectURL(
        new Blob([snapshot.svgMarkup], {
          type: 'image/svg+xml;charset=utf-8',
        }),
      );

      try {
        const image = new Image();
        image.decoding = 'async';

        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('Could not load the presentation snapshot.'));
          image.src = url;
        });

        if (recordingPresentationUrl) {
          URL.revokeObjectURL(recordingPresentationUrl);
        }

        recordingPresentationUrl = url;
        recordingPresentationImage = image;
      } catch {
        URL.revokeObjectURL(url);
      }
    })().finally(() => {
      recordingPresentationSnapshotTask = null;
    });

    return recordingPresentationSnapshotTask;
  };

  const createCompatibleMediaRecorder = (
    stream: MediaStream,
  ): {
    recorder: MediaRecorder;
    mimeType: string;
  } => {
    const candidates = [
      'video/mp4;codecs=avc1.640028,mp4a.40.2',
      'video/mp4;codecs=avc1.64001F,mp4a.40.2',
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=h264,aac',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      '',
    ];

    for (const mimeType of candidates) {
      if (mimeType && !MediaRecorder.isTypeSupported(mimeType)) {
        continue;
      }

      try {
        const recorderOptions: MediaRecorderOptions & {
          audioBitrateMode?: 'constant' | 'variable';
        } = {
          audioBitsPerSecond: 384_000,
          videoBitsPerSecond: 24_000_000,
        };

        recorderOptions.audioBitrateMode = 'constant';

        if (mimeType) {
          recorderOptions.mimeType = mimeType;
        }

        return {
          recorder: new MediaRecorder(stream, recorderOptions),
          mimeType,
        };
      } catch {
        // Try the next candidate.
      }
    }

    throw new Error('This browser could not initialize a supported recorder.');
  };

  const renderRecordingComposite = ({
    canvas,
    context,
    scheduleNext = false,
  }: {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
    scheduleNext?: boolean;
  }) => {
    const viewportRect = getRecordingViewportRect();
    const width = Math.max(2, Math.round(viewportRect.width));
    const height = Math.max(2, Math.round(viewportRect.height));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    context.clearRect(0, 0, width, height);
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);

    if (
      recordingDisplayVideo &&
      recordingDisplayVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      recordingDisplayVideo.videoWidth > 2 &&
      recordingDisplayVideo.videoHeight > 2
    ) {
      const { sx, sy, sw, sh } = getRecordingViewportSourceRect(recordingDisplayVideo);
      context.drawImage(
        recordingDisplayVideo,
        sx,
        sy,
        Math.min(sw, recordingDisplayVideo.videoWidth - sx),
        Math.min(sh, recordingDisplayVideo.videoHeight - sy),
        0,
        0,
        width,
        height,
      );
      if (scheduleNext) {
        recordingAnimationId = window.requestAnimationFrame(drawRecordingFrame);
      }
      return;
    }

    if (stage.dataset.layout === 'presentation' && !presentationFrame.hidden) {
      if (
        !recordingPresentationSnapshotTask &&
        Date.now() - recordingPresentationLastSnapshotAt > 500
      ) {
        void refreshRecordingPresentationSnapshot(false);
      }

      const presentationRect = presentationFrame.getBoundingClientRect();
      if (
        recordingPresentationImage &&
        presentationRect.width > 2 &&
        presentationRect.height > 2
      ) {
        const localRect = new DOMRect(
          presentationRect.left - viewportRect.left,
          presentationRect.top - viewportRect.top,
          presentationRect.width,
          presentationRect.height,
        );

        context.drawImage(
          recordingPresentationImage,
          localRect.x,
          localRect.y,
          localRect.width,
          localRect.height,
        );
      }
    }

    getVisibleVideoElements().forEach((video) => {
      const rect = video.getBoundingClientRect();
      const localRect = new DOMRect(
        rect.left - viewportRect.left,
        rect.top - viewportRect.top,
        rect.width,
        rect.height,
      );

      context.save();

      if (isPresentationCircleVideo(video)) {
        const radius = Math.min(localRect.width, localRect.height) / 2;
        context.beginPath();
        context.arc(
          localRect.x + localRect.width / 2,
          localRect.y + localRect.height / 2,
          radius,
          0,
          Math.PI * 2,
        );
        context.clip();
      }

      drawVideoIntoRect({
        context,
        fit:
          video.closest('.conference-media-frame--screen') ||
          video.closest('.conference-stage-panel--screen')
            ? 'contain'
            : 'cover',
        offsetY: isPresentationCircleVideo(video) || isSelfPreviewVideo(video) ? 0.42 : 0.5,
        rect: localRect,
        video,
      });

      context.restore();
    });

    if (scheduleNext) {
      recordingAnimationId = window.requestAnimationFrame(drawRecordingFrame);
    }
  };

  const drawRecordingFrame = () => {
    if (!recordingCanvas || !recordingCanvasContext) return;
    renderRecordingComposite({
      canvas: recordingCanvas,
      context: recordingCanvasContext,
      scheduleNext: true,
    });
  };

  const captureStageScreenshot = async () => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('Could not initialize the screenshot canvas.');
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    if (stage.dataset.layout === 'presentation' && !presentationFrame.hidden) {
      await refreshRecordingPresentationSnapshot(true).catch(() => undefined);
    }

    renderRecordingComposite({
      canvas,
      context,
      scheduleNext: false,
    });

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), 'image/png');
    });

    if (!blob) {
      throw new Error('Could not export the screenshot.');
    }

    downloadStageImage(blob);
  };

  const buildRecordingAudioTrack = async () => {
    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextCtor) return null;

    const audioContext = new AudioContextCtor({ sampleRate: 48_000 });
    recordingAudioContext = audioContext;
    await audioContext.resume().catch(() => undefined);

    const destination = audioContext.createMediaStreamDestination();
    const seenTrackIds = new Set<string>();
    let hasAudio = false;
    const hasDisplayCaptureAudio = Boolean(
      recordingDisplayStream?.getAudioTracks().some((track) => track.readyState === 'live'),
    );

    const connectTrack = (track: MediaStreamTrack) => {
      if (track.kind !== 'audio' || track.readyState !== 'live') return;

      const clone = track.clone();
      clone.enabled = true;
      recordingMicTrackClones.push(clone);

      const source = audioContext.createMediaStreamSource(new MediaStream([clone]));
      const gain = audioContext.createGain();
      gain.gain.value = 1;
      source.connect(gain);
      gain.connect(destination);

      recordingMediaElementSources.push(source, gain);
      hasAudio = true;
    };

    if (hasDisplayCaptureAudio && recordingDisplayStream) {
      recordingDisplayStream.getAudioTracks().forEach((track) => {
        const trackKey = `display:${track.id}`;
        if (seenTrackIds.has(trackKey)) return;
        seenTrackIds.add(trackKey);
        connectTrack(track);
      });
    } else {
      Array.from(mounts.participantAudioMounts.values()).forEach((mount) => {
        const mediaStreamTrack = (
          mount.track as { mediaStreamTrack?: MediaStreamTrack | null } | undefined
        )?.mediaStreamTrack;
        if (!mediaStreamTrack) return;
        const trackKey = `remote:${mediaStreamTrack.id}`;
        if (seenTrackIds.has(trackKey)) return;
        seenTrackIds.add(trackKey);
        connectTrack(mediaStreamTrack);
      });

      Array.from(mounts.screenAudioMounts.values()).forEach((mount) => {
        const mediaStreamTrack = (
          mount.track as { mediaStreamTrack?: MediaStreamTrack | null } | undefined
        )?.mediaStreamTrack;
        if (!mediaStreamTrack) return;
        const trackKey = `screen:${mediaStreamTrack.id}`;
        if (seenTrackIds.has(trackKey)) return;
        seenTrackIds.add(trackKey);
        connectTrack(mediaStreamTrack);
      });
    }

    if (room.state !== ConnectionState.Connected) {
      const synthOutputTrack = fmSynth.getOutputTrack();
      if (synthOutputTrack?.readyState === 'live') {
        const trackKey = `offline:synth:${synthOutputTrack.id}`;
        if (!seenTrackIds.has(trackKey)) {
          seenTrackIds.add(trackKey);
          connectTrack(synthOutputTrack);
        }
      }

      const ballOutputTrack = gravityBallRenderer?.getOutputTrack() || null;
      if (ballOutputTrack?.readyState === 'live') {
        const trackKey = `offline:ball:${ballOutputTrack.id}`;
        if (!seenTrackIds.has(trackKey)) {
          seenTrackIds.add(trackKey);
          connectTrack(ballOutputTrack);
        }
      }
    }

    Array.from(room.localParticipant.audioTrackPublications.values()).forEach((publication) => {
      const mediaStreamTrack = (
        publication.track as { mediaStreamTrack?: MediaStreamTrack } | undefined
      )?.mediaStreamTrack;

      if (!mediaStreamTrack || mediaStreamTrack.readyState !== 'live') return;
      if (
        publication.source === Track.Source.Microphone &&
        !room.localParticipant.isMicrophoneEnabled
      ) {
        return;
      }
      if (
        publication.source === Track.Source.ScreenShareAudio &&
        !room.localParticipant.isScreenShareEnabled
      ) {
        return;
      }

      const trackKey = `${room.localParticipant.identity}:${publication.source}:${mediaStreamTrack.id}`;
      if (seenTrackIds.has(trackKey)) return;
      seenTrackIds.add(trackKey);
      connectTrack(mediaStreamTrack);
    });

    return hasAudio ? destination.stream.getAudioTracks()[0] || null : null;
  };

  const startRecording = async () => {
    if (!(recordButton instanceof HTMLButtonElement)) return;
    if (!canRecordCurrentStage()) return;
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('MediaRecorder is not available in this browser.');
    }
    setRecordingGuideSuppressed(true);
    try {
      recordingCanvas = document.createElement('canvas');
      recordingCanvasContext = recordingCanvas.getContext('2d', { alpha: false });
      if (!recordingCanvasContext) {
        throw new Error('Could not initialize the recording canvas.');
      }
      recordingCanvasContext.imageSmoothingEnabled = true;
      recordingCanvasContext.imageSmoothingQuality = 'high';

      let usingDisplayCapture = false;
      try {
        setStatus('Selecciona esta pestaña y activa compartir audio para grabar el stage.');
        usingDisplayCapture = await startRecordingDisplayCapture();
      } catch (error) {
        console.warn('Recording display capture failed, falling back to DOM compositor.', error);
      }

      if (!usingDisplayCapture) {
        await refreshRecordingPresentationSnapshot(true).catch(() => undefined);
      }
      drawRecordingFrame();

      const canvasStream = recordingCanvas.captureStream(30);
      canvasStream.getVideoTracks().forEach((track) => {
        try {
          track.contentHint = 'detail';
        } catch {
          // ignore unsupported hint
        }
      });
      const mixedAudioTrack = await buildRecordingAudioTrack();
      const stream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...(mixedAudioTrack ? [mixedAudioTrack] : []),
      ]);

      const { recorder, mimeType } = createCompatibleMediaRecorder(stream);
      recordingStream = stream;
      recordingChunks = [];
      mediaRecorder = recorder;

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunks.push(event.data);
        }
      });

      recorder.addEventListener('stop', () => {
        const nextChunks = [...recordingChunks];
        cleanupRecording();
        if (nextChunks.length === 0) return;
        downloadRecording(new Blob(nextChunks, { type: mimeType || 'video/webm' }));
        setStatus('Grabacion guardada.');
      });

      recorder.start(250);
      recordingDataRequestId = window.setInterval(() => {
        if (mediaRecorder?.state === 'recording') {
          mediaRecorder.requestData();
        }
      }, 1000);
      setRecordState(true);
      setStatus(
        usingDisplayCapture
          ? mimeType.includes('mp4')
            ? 'Grabacion MP4 iniciada con captura de la pestaña.'
            : 'Grabacion iniciada con captura de la pestaña en WebM.'
          : mimeType.includes('mp4')
            ? 'Grabacion MP4 iniciada.'
            : 'Grabacion iniciada en WebM. MP4 no esta disponible en este navegador.',
      );
    } catch (error) {
      setRecordingGuideSuppressed(false);
      throw error;
    }
  };

  const chooseFocusParticipantIdentity = () =>
    chooseRoomFocusParticipantIdentity({
      activeSpeakers: room.activeSpeakers as Participant[],
      focusChangedAtMs,
      focusedParticipantIdentity,
      now: performance.now(),
      participants: allParticipants(),
      readRole: (participant) => readParticipantRole(room, participant, localRole),
    });

  const refreshFocusIdentity = () => {
    const nextIdentity = chooseFocusParticipantIdentity();
    if (nextIdentity !== focusedParticipantIdentity) {
      focusedParticipantIdentity = nextIdentity;
      focusChangedAtMs = performance.now();
    }
  };

  const hasActiveScreenShare = () => hasParticipantScreenshare(allParticipants());

  const getPresentationCircleIdentity = () =>
    resolvePresentationCircleIdentity({
      chooseFallbackIdentity: chooseFocusParticipantIdentity,
      focusedParticipantIdentity,
      leaderIdentity: getResolvedSessionLeaderIdentity(),
      participants: allParticipants(),
    });

  const syncScreenshareLayout = () => {
    const hasScreenshare = hasActiveScreenShare();
    const currentLayout = normalizeLayoutMode(layoutInput.value);

    if (hasScreenshare) {
      if (!screenshareWasActive && currentLayout !== 'screenshare') {
        layoutBeforeAutoScreenshare = currentLayout;
        layoutInput.value = setLayout(stage, 'screenshare');
        autoSwitchedToScreenshare = true;
        writeQueryState();
        syncLayoutChoiceButtons();
      }
      screenshareWasActive = true;
      return;
    }

    if (autoSwitchedToScreenshare && currentLayout === 'screenshare') {
      layoutInput.value = setLayout(stage, layoutBeforeAutoScreenshare);
      writeQueryState();
    }

    autoSwitchedToScreenshare = false;
    screenshareWasActive = false;
    syncLayoutChoiceButtons();
  };

  const canChangeLayoutLocally = () => true;

  const resolveParticipantTargetSlot = (participant: Participant): HTMLElement | null =>
    resolveRoomParticipantTargetSlot({
      canLeadSession: canLeadSession(),
      focusedParticipantIdentity,
      gridSlot,
      isLocalParticipant: isLocalParticipant(room, participant),
      layout: getCurrentLayout(),
      localRole,
      participant,
      presentationCircleIdentity: getPresentationCircleIdentity(),
      showPresentationCircle,
      studentsSlot,
      teacherSlot,
    });

  const clearIdentityPreviewSlot = () => {
    if (identityPreviewSlot instanceof HTMLElement) {
      identityPreviewSlot.innerHTML = '';
    }
  };

  const isDisconnectedPreviewProcessingActive = () =>
    Boolean(
      room.state === ConnectionState.Disconnected &&
        disconnectedCameraPreviewEnabled &&
        localPreviewStreamMount?.processed,
    );

  const buildDisconnectedPreviewStream = async (stream: MediaStream) => {
    const sourceTrack = stream.getVideoTracks()[0];
    const shouldProcessVideo = shouldProcessLocalCameraVideo({
      backgroundEffectMode,
      gravityBallEnabled,
      handTrackEnabled,
      previewInvert,
      videoMix: getEffectiveVideoMix(),
    });

    if (!sourceTrack || !shouldProcessVideo) {
      return {
        cleanup: undefined,
        processed: false,
        sourceStream: stream,
        stream,
      };
    }

    const sourceVideo = document.createElement('video');
    sourceVideo.autoplay = true;
    sourceVideo.muted = true;
    sourceVideo.playsInline = true;
    sourceVideo.srcObject = stream;
    await sourceVideo.play().catch(() => undefined);

    const processor = new BackgroundBlurVideoProcessor();
    await processor.init({
      element: sourceVideo,
      kind: Track.Kind.Video,
      track: sourceTrack,
    });

    const processedTrack = processor.processedTrack;
    if (!processedTrack) {
      await processor.destroy().catch(() => undefined);
      sourceVideo.pause();
      sourceVideo.srcObject = null;
      return {
        cleanup: undefined,
        processed: false,
        sourceStream: stream,
        stream,
      };
    }

    disconnectedPreviewProcessor = processor;
    disconnectedPreviewSourceVideo = sourceVideo;

    return {
      cleanup: async () => {
        await processor.destroy().catch(() => undefined);
        sourceVideo.pause();
        sourceVideo.srcObject = null;
        if (disconnectedPreviewProcessor === processor) {
          disconnectedPreviewProcessor = null;
        }
        if (disconnectedPreviewSourceVideo === sourceVideo) {
          disconnectedPreviewSourceVideo = null;
        }
      },
      processed: true,
      sourceStream: stream,
      stream: new MediaStream([processedTrack]),
    };
  };

  const removeLocalPreviewStream = () => {
    if (!localPreviewStreamMount) return;
    const mount = localPreviewStreamMount;
    localPreviewStreamMount = null;
    void Promise.resolve(mount.cleanup?.()).catch(() => undefined);
    const seenTrackIds = new Set<string>();
    [mount.stream, mount.sourceStream].forEach((stream) => {
      stream?.getTracks().forEach((track) => {
        if (seenTrackIds.has(track.id)) return;
        seenTrackIds.add(track.id);
        track.stop();
      });
    });
    mount.element.srcObject = null;
    mount.wrapper.remove();
  };

  const clearDisconnectedStagePreview = () => {
    if (!disconnectedStagePreviewMount) return;
    disconnectedStagePreviewMount.element.srcObject = null;
    disconnectedStagePreviewMount.wrapper.remove();
    disconnectedStagePreviewMount = null;
  };

  const forceDisconnectedPreviewLayout = () => {
    if (room.state !== ConnectionState.Disconnected) return;
    const nextLayout = setLayout(stage, 'teacher');
    layoutInput.value = nextLayout;
    syncLayoutChoiceButtons();
    writeQueryState();
  };

  const syncDisconnectedStagePreview = () => {
    // Don't evict the compositor preview from the stage slot
    if (compositorInStage) return;

    if (
      room.state !== ConnectionState.Disconnected ||
      !disconnectedCameraPreviewEnabled ||
      !localPreviewStreamMount ||
      !['teacher', 'presentation'].includes(getCurrentLayout())
    ) {
      clearDisconnectedStagePreview();
      return;
    }

    const stream = localPreviewStreamMount.stream;
    const existingTrack = disconnectedStagePreviewMount?.stream.getVideoTracks()[0];
    const nextTrack = stream.getVideoTracks()[0];
    const nextTrackId = normalizeText(nextTrack?.id);
    const hasBackdrop = Boolean(disconnectedStagePreviewMount?.wrapper.querySelector('.conference-media-backdrop'));
    const needsBackdrop = previewBlur && !localPreviewStreamMount?.processed;

    if (
      disconnectedStagePreviewMount &&
      disconnectedStagePreviewMount.wrapper.parentElement === teacherSlot &&
      existingTrack?.readyState === 'live' &&
      normalizeText(existingTrack?.id) === nextTrackId &&
      hasBackdrop === needsBackdrop
    ) {
      return;
    }

    clearDisconnectedStagePreview();

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
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'conference-media-frame conference-media-frame--local-camera';
    if (previewBlur && !localPreviewStreamMount?.processed) {
      appendBlurBackdrop({ stream, wrapper });
    }

    const element = document.createElement('video');
    element.autoplay = true;
    element.muted = true;
    element.playsInline = true;
    element.srcObject = stream;
    wrapper.appendChild(element);
    media.appendChild(wrapper);
    placeholder.hidden = true;
    hand.hidden = !localHandRaised;
    node.dataset.handRaised = localHandRaised ? 'true' : 'false';
    node.dataset.role = localRole;
    node.dataset.showCircle = showPresentationCircle ? 'true' : 'false';
    node.style.setProperty('--conference-participant-preview-zoom', previewZoom.toFixed(2));
    name.textContent = normalizeText(nameInput.value) || normalizeText(identityInput.value) || 'You';

    teacherSlot.innerHTML = '';
    teacherSlot.appendChild(node);
    void element.play().catch(() => undefined);

    disconnectedStagePreviewMount = {
      deviceId: normalizeText(localPreviewStreamMount.deviceId),
      element,
      stream,
      wrapper: node,
    };
  };

  const mountLocalPreviewStream = async (stream: MediaStream) => {
    if (!(identityPreviewSlot instanceof HTMLElement)) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    removeMount(localPreviewMount ?? undefined);
    localPreviewMount = null;
    removeLocalPreviewStream();
    clearIdentityPreviewSlot();

    const previewMount = await buildDisconnectedPreviewStream(stream);

    const wrapper = document.createElement('div');
    wrapper.className = 'conference-media-frame conference-media-frame--local-preview';

    if (previewBlur && !previewMount.processed) {
      appendBlurBackdrop({
        stream: previewMount.stream,
        wrapper,
      });
    }

    const element = document.createElement('video');
    element.autoplay = true;
    element.muted = true;
    element.playsInline = true;
    element.srcObject = previewMount.stream;
    wrapper.appendChild(element);
    identityPreviewSlot.appendChild(wrapper);
    void element.play().catch(() => undefined);

    const settings = stream.getVideoTracks()[0]?.getSettings?.();
    const deviceId = normalizeText(settings?.deviceId) || preferredVideoInputId;

    localPreviewStreamMount = {
      cleanup: previewMount.cleanup,
      deviceId,
      element,
      processed: previewMount.processed,
      sourceStream: previewMount.sourceStream,
      stream: previewMount.stream,
      wrapper,
    };
    syncDisconnectedStagePreview();
  };

  const enableDisconnectedCameraPreview = async () => {
    if (room.state !== ConnectionState.Disconnected) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera preview is not available in this browser.');
    }

    const requestedDeviceId = normalizeText(preferredVideoInputId);
    const currentDeviceId = normalizeText(localPreviewStreamMount?.deviceId);
    const currentTrack = localPreviewStreamMount?.stream.getVideoTracks()[0];
    if (
      disconnectedCameraPreviewEnabled &&
      localPreviewStreamMount &&
      currentTrack?.readyState === 'live' &&
      (!requestedDeviceId || requestedDeviceId === currentDeviceId)
    ) {
      return;
    }

    const exactConstraints =
      requestedDeviceId
        ? ({ video: { deviceId: { exact: requestedDeviceId } }, audio: false } satisfies MediaStreamConstraints)
        : ({ video: true, audio: false } satisfies MediaStreamConstraints);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(exactConstraints);
    } catch (error) {
      if (!requestedDeviceId) throw error;
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    disconnectedCameraPreviewEnabled = true;
    forceDisconnectedPreviewLayout();
    await mountLocalPreviewStream(stream);
    await refreshDeviceOptions(true);
  };

  const disableDisconnectedCameraPreview = () => {
    disconnectedCameraPreviewEnabled = false;
    clearDisconnectedStagePreview();
    removeLocalPreviewStream();
    if (room.state === ConnectionState.Disconnected) {
      clearIdentityPreviewSlot();
    }
  };

  const syncDisconnectedPreviewProcessing = async () => {
    if (room.state !== ConnectionState.Disconnected || !disconnectedCameraPreviewEnabled) return;
    const shouldProcessVideo = shouldProcessLocalCameraVideo({
      backgroundEffectMode,
      gravityBallEnabled,
      handTrackEnabled,
      previewInvert,
      videoMix: getEffectiveVideoMix(),
    });
    const isProcessed = Boolean(localPreviewStreamMount?.processed);

    if (shouldProcessVideo !== isProcessed) {
      const currentStatus = statusNode.textContent || '';
      disableDisconnectedCameraPreview();
      await enableDisconnectedCameraPreview();
      if (currentStatus) {
        setStatus(currentStatus);
      }
    } else {
      syncIdentityPreview();
      syncDisconnectedStagePreview();
    }

    syncLocalVideoDisplayFlip();
    applyGravityBallStageVisibilityState();
    clearHandOverlays();
  };

  const syncIdentityPreview = () => {
    if (!(identityPreviewSlot instanceof HTMLElement)) {
      removeMount(localPreviewMount ?? undefined);
      localPreviewMount = null;
      removeLocalPreviewStream();
      return;
    }

    if (room.state === ConnectionState.Disconnected) {
      removeMount(localPreviewMount ?? undefined);
      localPreviewMount = null;
      syncDisconnectedStagePreview();
      if (!disconnectedCameraPreviewEnabled) {
        removeLocalPreviewStream();
        clearIdentityPreviewSlot();
      }
      return;
    }

    removeLocalPreviewStream();

    const publication = Array.from(room.localParticipant.videoTrackPublications.values()).find(
      (entry) => entry.track && entry.source !== Track.Source.ScreenShare,
    );

    if (!publication?.track) {
      removeMount(localPreviewMount ?? undefined);
      localPreviewMount = null;
      clearIdentityPreviewSlot();
      return;
    }

    const trackSid = getTrackSid(publication);
    const shouldRenderBackdrop = Boolean(
      previewBlur &&
        !isBackgroundBlurProcessorActive(isLocalCameraTrackLike(publication.track) ? publication.track : null),
    );
    if (
      localPreviewMount &&
      localPreviewMount.trackSid === trackSid &&
      localPreviewMount.track === publication.track &&
      shouldRenderBackdrop === Boolean(localPreviewMount.wrapper.querySelector('.conference-media-backdrop'))
    ) {
      return;
    }

    removeMount(localPreviewMount ?? undefined);
    clearIdentityPreviewSlot();

    const wrapper = document.createElement('div');
    wrapper.className = 'conference-media-frame conference-media-frame--local-preview';

    if (shouldRenderBackdrop) {
      appendBlurBackdrop({
        track: (
          publication.track as { mediaStreamTrack?: MediaStreamTrack | null } | undefined
        )?.mediaStreamTrack,
        wrapper,
      });
    }

    const element = createMediaElement(publication.track, true);
    wrapper.appendChild(element);
    identityPreviewSlot.appendChild(wrapper);
    publication.track.attach(element);

    localPreviewMount = {
      element,
      track: publication.track,
      trackSid,
      wrapper,
    };
  };

  const postToPresentation = (payload: Record<string, unknown>) => {
    if (!presentationFrame.contentWindow || presentationFrame.hidden) return;
    presentationFrame.contentWindow.postMessage(payload, window.location.origin);
  };

  const syncPresentationSessionControl = () => {
    postToPresentation({
      type: 'musiki:reveal-session-control',
      state: {
        localIdentity:
          room.state === ConnectionState.Connected
            ? normalizeText(room.localParticipant.identity)
            : normalizeText(identityInput.value),
        localRole,
        sessionLeaderIdentity,
      },
    });
  };

  const requestPresentationState = () => {
    postToPresentation({ type: 'musiki:reveal-request-state' });
  };

  const clearPresentationStateRecoveryRequests = () => {
    presentationStateRecoveryRequestTimeoutIds.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    presentationStateRecoveryRequestTimeoutIds = [];
  };

  const requestRemotePresentationState = async () => {
    if (destroyed || room.state !== ConnectionState.Connected || canLeadSession()) return;
    if (!presentation.getHref()) return;
    await publishMessage({ type: 'presentation-state-request' });
  };

  const queuePresentationStateRecoveryRequests = () => {
    clearPresentationStateRecoveryRequests();
    if (destroyed || room.state !== ConnectionState.Connected || canLeadSession()) return;
    if (!presentation.getHref()) return;

    [0, 650, 1900].forEach((delayMs) => {
      const timeoutId = window.setTimeout(() => {
        if (destroyed || room.state !== ConnectionState.Connected || canLeadSession()) return;
        if (!presentation.getHref()) return;
        void requestRemotePresentationState().catch(() => undefined);
      }, delayMs);
      presentationStateRecoveryRequestTimeoutIds.push(timeoutId);
    });
  };

  const resetPresentationZoom = () => {
    postToPresentation({ type: 'musiki:reveal-reset-zoom' });
  };

  const applyRemoteSlideState = (slideState: SlideState) => {
    pendingRemoteSlideState = slideState;
    postToPresentation({
      type: 'musiki:reveal-goto',
      state: slideState,
    });
  };

  const publishSlideState = async (slideState: SlideState, force = false) => {
    if (!canLeadSession()) return;
    const slideKey = `${slideState.indexh}:${slideState.indexv}:${slideState.indexf}:${slideState.zoom.toFixed(3)}`;
    if (!force && slideKey === lastPublishedSlideKey) return;
    lastPublishedSlideKey = slideKey;
    await publishMessage({
      type: 'slide-state',
      ...slideState,
    });
  };

  const applyRemotePresentationMediaState = (mediaState: PresentationEmbeddedMediaState) => {
    pendingRemotePresentationMediaState = mediaState;
    postToPresentation({
      type: 'musiki:reveal-embedded-media-sync',
      state: mediaState,
    });
  };

  const publishPresentationMediaState = async (
    mediaState: PresentationEmbeddedMediaState,
    force = false,
  ) => {
    if (!canLeadSession()) return;
    const presentationMediaKey = [
      mediaState.embedId,
      mediaState.mediaId,
      mediaState.playbackState,
      mediaState.currentTime.toFixed(2),
    ].join(':');
    if (!force && presentationMediaKey === lastPublishedPresentationMediaKey) return;
    lastPublishedPresentationMediaKey = presentationMediaKey;
    currentPresentationMediaState = mediaState;
    await publishMessage({
      type: 'presentation-media',
      ...mediaState,
    });
  };

  const publishPresentationSyncSnapshot = async ({
    includePresentation = true,
  }: {
    includePresentation?: boolean;
  } = {}) => {
    if (!canLeadSession()) return;

    if (includePresentation) {
      await publishMessage({
        type: 'presentation',
        href: presentation.getHref(),
      });
    }

    if (currentSlideState) {
      await publishSlideState(currentSlideState, true);
    } else if (presentation.getHref()) {
      requestPresentationState();
    }

    if (currentPresentationMediaState) {
      await publishPresentationMediaState(currentPresentationMediaState, true);
    }
  };

  const handlePresentationMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    if (event.source !== presentationFrame.contentWindow) return;

    const payload = event.data;
    if (!payload || typeof payload !== 'object') return;

    const type = normalizeText((payload as { type?: string }).type);
    if (type === 'musiki:reveal-toggle-sidebar-left') {
      toggleInstrumentsOpen();
      return;
    }

    if (type === 'musiki:reveal-toggle-sidebar-right') {
      toggleSidebarCollapsed();
      return;
    }

    if (type === 'musiki:room-command') {
      executeRoomShortcutCommand(normalizeText((payload as { command?: string }).command));
      return;
    }

    if (type === 'musiki:reveal-embedded-media') {
      const mediaState = normalizePresentationMediaState(
        (payload as { state?: PresentationEmbeddedMediaState }).state,
      );
      if (!mediaState) return;
      const shouldForcePublish = (payload as { force?: boolean }).force === true;
      currentPresentationMediaState = mediaState;
      if (localRole === 'teacher') {
        void publishPresentationMediaState(mediaState, shouldForcePublish);
      }
      return;
    }

    if (type === 'musiki:reveal-embedded-media-warning') {
      const message = normalizeText((payload as { message?: string }).message);
      if (message) {
        setStatus(message);
      }
      return;
    }

    if (type === 'musiki:reveal-ready') {
      if (pendingRemoteSlideState) {
        applyRemoteSlideState(pendingRemoteSlideState);
      }
      const nextPresentationMediaState = pendingRemotePresentationMediaState ?? currentPresentationMediaState;
      if (nextPresentationMediaState) {
        applyRemotePresentationMediaState(nextPresentationMediaState);
      }
      if (canLeadSession()) {
        requestPresentationState();
      } else {
        queuePresentationStateRecoveryRequests();
      }
      return;
    }

    if (type !== 'musiki:reveal-slide-state') return;
    const slideState = normalizeSlideState((payload as { state?: SlideState }).state);
    if (!slideState) return;
    currentSlideState = slideState;
    window.dispatchEvent(new CustomEvent('musiki:clase-slide-changed', { detail: { indexh: slideState.indexh } }));
    if (canLeadSession()) {
      void publishSlideState(slideState);
    }
  };

  const syncLiveActivityTransport = () => {
    unsubscribeLiveActivity?.();
    unsubscribeLiveActivity = null;

    const effectiveCourseId = getEffectiveCourseId();

    if (!effectiveCourseId) {
      activeLiveSnapshot = null;
      postToPresentation({ type: 'musiki:live-snapshot', snapshot: null });
      renderLiveActivity();
      return;
    }

    unsubscribeLiveActivity = subscribeToLive({
      courseId: effectiveCourseId,
      onEvent: (eventName: string, payload: LiveSnapshot | null) => {
        if (eventName === 'live.ended') {
          const endedSessionId = normalizeText((payload as LiveSnapshot | null)?.sessionId);
          if (!endedSessionId || endedSessionId === normalizeText(activeLiveSnapshot?.sessionId)) {
            activeLiveSnapshot = null;
          }
          postToPresentation({ type: 'musiki:live-snapshot', snapshot: null });
          renderLiveActivity();
          return;
        }

        activeLiveSnapshot = payload && typeof payload === 'object' ? (payload as LiveSnapshot) : null;
        postToPresentation({ type: 'musiki:live-snapshot', snapshot: activeLiveSnapshot });
        renderLiveActivity();
      },
    });
  };

  const readMessage = (payload: Uint8Array): ConferenceMessage | null => parseConferenceMessage(payload);

  const writeQueryState = () => {
    const effectiveCourseId = getEffectiveCourseId();
    const selectedPresentationHref = normalizeText(presentationSelect.value) || presentation.getHref();
    const nextUrl = buildRoomQueryUrl({
      courseId: effectiveCourseId,
      currentSearch: window.location.search,
      identity: identityInput.value.trim(),
      inviteCode,
      isExternalInviteMode,
      name: nameInput.value.trim(),
      pathname: window.location.pathname,
      presentationHref: normalizeText(selectedPresentationHref),
      room: roomInput.value.trim(),
    });
    window.history.replaceState({}, '', nextUrl);
  };

  const publishMessage = async (message: ConferenceMessage) => {
    if (room.state !== ConnectionState.Connected || !room.localParticipant) return;

    await room.localParticipant.publishData(textEncoder.encode(JSON.stringify(message)), {
      reliable: true,
      topic: MESSAGE_TOPIC,
    });
  };

  const chatController = createRoomChatController({
    chatDownloadButton,
    chatFocusButton: chatFocusButton instanceof HTMLButtonElement ? chatFocusButton : null,
    chatInput,
    chatList,
    chatSection,
    chatSendButton,
    chatUnreadDot: chatUnreadDot instanceof HTMLElement ? chatUnreadDot : null,
    ensureSidebarOpen: () => {
      if (!sidebarCollapsed) return;
      sidebarCollapsed = false;
      applySidebarCollapsedState();
    },
    formatError: safeErrorMessage,
    getIdentity: () => identityInput.value.trim(),
    getName: () => nameInput.value.trim(),
    getRole: () => localRole,
    getRoomName: () => roomInput.value,
    isConnected: () => room.state === ConnectionState.Connected,
    publishMessage: async (message) => {
      await publishMessage(message);
    },
    reportStatus: (message) => {
      setStatus(message);
    },
  });

  const focusChatComposer = () => {
    chatController.focusComposer();
  };

  const resetChatUnread = () => {
    chatController.resetUnread();
  };

  const appendChatMessage = (message: Extract<ConferenceMessage, { type: 'chat' }>, isSent = false) => {
    chatController.appendMessage(message, isSent);
  };

  const downloadChatTranscript = () => {
    chatController.downloadTranscript();
  };

  const sendChatMessage = async () => {
    await chatController.sendMessage();
  };

  chatController.bind();

  const publishTeacherState = async () => {
    if (!canLeadSession()) return;

    await publishMessage({
      type: 'session-leader',
      identity: getResolvedSessionLeaderIdentity(),
    });

    await publishMessage({
      type: 'session-control',
      allowInstruments: sessionAllowsInstruments,
    });

    await publishMessage({
      type: 'layout',
      layout: getCurrentLayout(),
    });

    await publishMessage({
      type: 'presentation',
      href: presentation.getHref(),
    });

    await publishMessage({
      type: 'graph',
      open: graphVisible,
    });

    if (externalMediaSession) {
      await broadcastExternalMediaState('open', true);
    }

    if (currentSlideState) {
      await publishSlideState(currentSlideState, true);
    } else if (presentation.getHref()) {
      requestPresentationState();
    }

    if (currentPresentationMediaState) {
      await publishPresentationMediaState(currentPresentationMediaState, true);
    }
  };

  const syncPresentationSelection = (href: string | null) => {
    if (href && Array.from(presentationSelect.options).some((option) => option.value === href)) {
      presentationSelect.value = href;
      return;
    }
    presentationSelect.value = '';
  };

  const refreshDeviceOptions = async (requestPermissions = false) => {
    await deviceController.refreshOptions(requestPermissions);
  };

  const schedulePresentationLoad = ({
    broadcast = false,
    href,
    successMessage,
  }: {
    broadcast?: boolean;
    href: string | null;
    successMessage: string;
  }) => {
    if (pendingPresentationTask) {
      window.clearTimeout(pendingPresentationTask);
      pendingPresentationTask = 0;
    }

    const nextHref = normalizeText(href) || null;
    const currentHref = normalizeText(presentation.getHref()) || null;
    const isSamePresentation = nextHref === currentHref;
    if (nextHref && !isSamePresentation) {
      setStatus('Cargando escena Reveal...');
    }

    pendingPresentationTask = window.setTimeout(() => {
      pendingPresentationTask = 0;

      try {
        if (isSamePresentation) {
          syncPresentationSelection(currentHref);
        } else if (nextHref) {
          const committedHref = presentation.setHref(nextHref);
          syncPresentationSelection(committedHref);
          currentSlideState = null;
          pendingRemoteSlideState = null;
          lastPublishedSlideKey = '';
          currentPresentationMediaState = null;
          pendingRemotePresentationMediaState = null;
          lastPublishedPresentationMediaKey = '';
          window.dispatchEvent(new CustomEvent('musiki:clase-presentation-changed', {
            detail: { lessonId: resolvePresentationPageSlug(committedHref) || null },
          }));
        } else {
          presentation.clear();
          syncPresentationSelection(null);
          currentSlideState = null;
          pendingRemoteSlideState = null;
          lastPublishedSlideKey = '';
          currentPresentationMediaState = null;
          pendingRemotePresentationMediaState = null;
          lastPublishedPresentationMediaKey = '';
          window.dispatchEvent(new CustomEvent('musiki:clase-presentation-changed', { detail: { lessonId: null } }));
        }

        writeQueryState();
        syncLiveActivityTransport();
        void syncLocalParticipantMetadata().catch(() => undefined);
        renderLiveActivity();
        setStatus(successMessage);

        if (broadcast && room.state === ConnectionState.Connected && localRole === 'teacher') {
          if (isSamePresentation) {
            void publishPresentationSyncSnapshot().catch(() => undefined);
          } else {
            void publishMessage({
              type: 'presentation',
              href: nextHref,
            });
          }
        }
      } catch (error) {
        setStatus(safeErrorMessage(error));
      }
    }, nextHref ? 48 : 0);
  };

  const appendReactionBurst = (reaction: ReactionKind, name: string) => {
    if (!(reactionsLayer instanceof HTMLElement)) return;

    const burstId = crypto.randomUUID();
    const burst = document.createElement('div');
    burst.className = 'conference-reaction-burst';
    burst.style.left = `calc(50% + ${Math.round((Math.random() - 0.5) * 220)}px)`;
    burst.style.top = `calc(58% + ${Math.round((Math.random() - 0.5) * 56)}px)`;

    const emoji = document.createElement('span');
    emoji.textContent = REACTION_EMOJIS[reaction];
    burst.appendChild(emoji);

    const firstName = getFirstName(name);
    if (firstName) {
      const label = document.createElement('span');
      label.className = 'conference-reaction-burst-name';
      label.textContent = firstName;
      burst.appendChild(label);
    }

    reactionsLayer.appendChild(burst);
    const timeoutId = window.setTimeout(() => {
      burst.remove();
      reactionBursts.delete(burstId);
    }, 1550);
    reactionBursts.set(burstId, timeoutId);
  };

  const publishReaction = async (reaction: ReactionKind) => {
    if (room.state !== ConnectionState.Connected || !room.localParticipant) return;

    const message: Extract<ConferenceMessage, { type: 'reaction' }> = {
      type: 'reaction',
      id: crypto.randomUUID(),
      identity: normalizeText(room.localParticipant.identity),
      name: normalizeText(nameInput.value) || normalizeText(identityInput.value) || 'Participant',
      reaction,
      role: localRole,
      sentAt: new Date().toISOString(),
    };

    appendReactionBurst(message.reaction, message.name);
    await publishMessage(message);
  };

  const setControlState = () => {
    const connected = room.state === ConnectionState.Connected;
    const connecting =
      room.state === ConnectionState.Connecting ||
      room.state === ConnectionState.Reconnecting ||
      room.state === ConnectionState.SignalReconnecting;
    const inviteBlocked = isInvalidInviteMode;
    const livekitReady = true;
    const sessionLeader = canLeadSession();

    stateNode.textContent = connectionStateLabel(room.state);
    const participantCount = room.remoteParticipants.size + (connected ? 1 : 0);
    countNode.textContent = countNode.dataset.compact === 'true'
      ? String(participantCount)
      : `${participantCount} participantes`;

    if (connectButton instanceof HTMLButtonElement) {
      connectButton.disabled = inviteBlocked || !livekitReady || connected || connecting;
    }
    if (disconnectButton instanceof HTMLButtonElement) {
      disconnectButton.disabled = !connected && !connecting;
    }
    if (connectToggleButton instanceof HTMLButtonElement) {
      connectToggleButton.disabled = inviteBlocked || !livekitReady || connecting;
      connectToggleButton.dataset.connected = connected ? 'true' : 'false';
      connectToggleButton.dataset.connecting = connecting ? 'true' : 'false';
      connectToggleButton.setAttribute(
        'aria-label',
        connected ? 'Desconectar de la sala' : connecting ? 'Conectando...' : 'Conectar a la sala',
      );
      connectToggleButton.title = connected
        ? 'Desconectar'
        : connecting
          ? 'Conectando...'
          : 'Conectar';
    }
    cameraButton.disabled = connecting;
    microphoneButton.disabled = connecting;
    shareScreenButton.disabled = !connected;
    if (recordButton instanceof HTMLButtonElement) {
      recordButton.disabled = !canRecordCurrentStage();
    }
    layoutInput.disabled = localRole === 'teacher'
      ? connected ? !sessionLeader : false
      : !canChangeLayoutLocally();
    presentationSelect.disabled = connected
      ? (localRole === 'teacher' ? !sessionLeader : true)
      : false;
    if (presentationButton instanceof HTMLButtonElement) {
      presentationButton.disabled = connected
        ? (localRole === 'teacher' ? !sessionLeader : true)
        : false;
    }
    if (externalInviteCreateButton instanceof HTMLButtonElement) {
      externalInviteCreateButton.disabled =
        localRole !== 'teacher' || connecting;
    }
    if (externalInviteCopyButton instanceof HTMLButtonElement) {
      externalInviteCopyButton.disabled =
        localRole !== 'teacher' || !currentExternalInviteUrl || connecting;
    }
    if (externalInviteRevokeButton instanceof HTMLButtonElement) {
      externalInviteRevokeButton.disabled =
        localRole !== 'teacher' || !currentExternalInviteCode || connecting;
    }
    if (studentInviteCreateButton instanceof HTMLButtonElement) {
      studentInviteCreateButton.disabled =
        localRole !== 'teacher' || connecting;
    }
    if (studentInviteCopyButton instanceof HTMLButtonElement) {
      studentInviteCopyButton.disabled =
        localRole !== 'teacher' || !currentStudentInviteUrl || connecting;
    }
    if (studentInviteRevokeButton instanceof HTMLButtonElement) {
      studentInviteRevokeButton.disabled =
        localRole !== 'teacher' || !currentStudentInviteCode || connecting;
    }
    const hasAudioChoices = deviceController.hasChoices('audio');
    audioInputSelects.forEach((select) => {
      select.disabled = !hasAudioChoices;
    });
    const hasVideoChoices = deviceController.hasChoices('video');
    videoInputSelects.forEach((select) => {
      select.disabled = !hasVideoChoices;
    });
    if (presentationClearButton instanceof HTMLButtonElement) {
      presentationClearButton.disabled =
        (connected && localRole !== 'teacher') ||
        (!presentation.getHref() && !normalizeText(presentationSelect.value));
    }
    chatController.syncControlState();
    if (raiseHandButton instanceof HTMLButtonElement) {
      raiseHandButton.disabled = !connected;
    }
    syncLocalVideoDisplayFlip();
    applyGravityBallStageVisibilityState();
    if (instrumentsToggleButton instanceof HTMLButtonElement) {
      instrumentsToggleButton.dataset.active = instrumentsOpen ? 'true' : 'false';
      instrumentsToggleButton.setAttribute('aria-pressed', instrumentsOpen ? 'true' : 'false');
    }
    roomInput.disabled = connecting || isExternalInviteMode;
    roomInput.readOnly = isExternalInviteMode || localRole !== 'teacher';
    identityInput.disabled = connected || connecting;
    nameInput.disabled = connected || connecting;

    const cameraEnabled = connected && room.localParticipant.isCameraEnabled;
    const previewEnabled = !connected && disconnectedCameraPreviewEnabled;
    const microphoneEnabled = connected && room.localParticipant.isMicrophoneEnabled;
    const micPreviewEnabled = !connected && Boolean(disconnectedLiveStream?.getAudioTracks()[0]);
    const shareEnabled = connected && room.localParticipant.isScreenShareEnabled;

    cameraButton.dataset.enabled = cameraEnabled || previewEnabled ? 'true' : 'false';
    cameraButton.dataset.open = deviceController.getActivePanel() === 'video' ? 'true' : 'false';
    cameraButton.setAttribute(
      'aria-label',
      cameraEnabled || previewEnabled ? 'Apagar camara' : 'Encender camara',
    );
    cameraButton.title = cameraEnabled || previewEnabled
      ? connected
        ? 'Apagar camara. Shift + click para elegir dispositivo.'
        : 'Cerrar preview de camara. Shift + click para elegir dispositivo.'
      : connected
        ? 'Encender camara. Shift + click para elegir dispositivo.'
        : 'Abrir preview de camara. Shift + click para elegir dispositivo.';

    microphoneButton.dataset.enabled = (microphoneEnabled || micPreviewEnabled) ? 'true' : 'false';
    microphoneButton.dataset.open = deviceController.getActivePanel() === 'audio' ? 'true' : 'false';
    microphoneButton.setAttribute(
      'aria-label',
      microphoneEnabled ? 'Silenciar microfono' : 'Activar microfono',
    );
    microphoneButton.title = microphoneEnabled
      ? 'Silenciar microfono. Shift + click para elegir dispositivo.'
      : 'Activar microfono. Shift + click para elegir dispositivo.';

    shareScreenButton.dataset.enabled = shareEnabled ? 'true' : 'false';
    shareScreenButton.setAttribute(
      'aria-label',
      shareEnabled ? 'Detener pantalla compartida' : 'Compartir pantalla',
    );
    shareScreenButton.title = shareEnabled ? 'Detener pantalla' : 'Compartir pantalla';
    syncExternalMediaShell();
    syncLayoutChoiceButtons();
    applySessionLeaderState();
    applySessionControlState();
    renderLiveActivity();
    renderSessionTimer();
    setRecordState(Boolean(mediaRecorder && mediaRecorder.state !== 'inactive'));
    syncMicMeter();
    syncRaiseHandUi();
    syncFullscreenButton();
  };

  const ensureParticipantCard = (participant: Participant) => {
    return ensureRoomParticipantCard({
      mounts,
      participant,
      participantCards,
      participantTemplate,
      previewZoom,
      readHandRaised: (entry) => readParticipantHandRaised(entry),
      readRole: (entry) => readParticipantRole(room, entry, localRole),
      resolveTargetSlot: (entry) => resolveParticipantTargetSlot(entry),
      room,
      screenCards,
      showPresentationCircle,
    });
  };

  const removeParticipant = (identity: string) => {
    removeParticipantCards({
      identity,
      mounts,
      participantCards,
      screenCards,
    });
  };

  const allParticipants = () => listRoomParticipants(room);

  const syncParticipant = (participant: Participant) => {
    const card = ensureParticipantCard(participant);
    if (!card) return;
    const isSpeaking = room.activeSpeakers.some((s) => s.identity === participant.identity);
    card.card.dataset.speaking = isSpeaking ? 'true' : 'false';
    syncParticipantVideo(room, participant, card, mounts, {
      blurLocalVideo: previewBlur,
      isTrackBackgroundBlurred: (track) =>
        isBackgroundBlurProcessorActive(isLocalCameraTrackLike(track) ? track : null),
      renderBackdrop: ({ track, wrapper }) => {
        appendBlurBackdrop({ track, wrapper });
      },
    });
    syncParticipantAudio(room, participant, card, mounts, {
      onAudioMount: (key, track) => {
        void connectIncomingAudioTrack(key, track);
        return () => {
          disconnectIncomingAudioSource(key);
        };
      },
    });
    syncScreenVideo(participant, screenSlot, screenTemplate, screenCards, mounts);
    syncScreenAudio(room, participant, screenCards, mounts, {
      onAudioMount: (key, track) => {
        void connectIncomingAudioTrack(key, track);
        return () => {
          disconnectIncomingAudioSource(key);
        };
      },
    });
  };

  const renderParticipantList = () => {
    renderParticipantRoster({
      participantList,
      participants: allParticipants(),
      readRole: (participant) => readParticipantRole(room, participant, localRole),
      room,
    });
  };

  const syncAllParticipants = () => {
    applySessionLeaderState();
    refreshFocusIdentity();
    syncScreenshareLayout();
    const activeParticipants = new Set(allParticipants().map((participant) => participant.identity));

    participantCards.forEach((_, identity) => {
      if (!activeParticipants.has(identity)) {
        removeParticipant(identity);
      }
    });

    const orderedParticipants = getDisplayOrderedParticipants();
    const identitiesBySlot = new Map<HTMLElement, string[]>();

    orderedParticipants.forEach((participant) => {
      syncParticipant(participant);
      const card = participantCards.get(participant.identity)?.card;
      const slot = card?.parentElement;
      if (!(slot instanceof HTMLElement)) return;

      const currentOrder = identitiesBySlot.get(slot) ?? [];
      currentOrder.push(participant.identity);
      identitiesBySlot.set(slot, currentOrder);
    });

    identitiesBySlot.forEach((identities, slot) => {
      reorderParticipantCardsInSlot(slot, identities);
    });
    syncIdentityPreview();
    syncDisconnectedStagePreview();
    renderParticipantList();
    queuePreferredRemoteVideoDimensionsSync();
    setControlState();
  };

  const syncRecentSpeakers = () => {
    const activeParticipantMap = new Map(
      allParticipants().map((participant) => [participant.identity, participant]),
    );

    for (const speaker of room.activeSpeakers) {
      if (!recentSpeakers.includes(speaker.identity)) {
        recentSpeakers = [speaker.identity, ...recentSpeakers].slice(0, 3);
      }
    }

    recentSpeakers = recentSpeakers.filter((identity) => activeParticipantMap.has(identity)).slice(0, 3);

    const names = recentSpeakers
      .map((identity) => {
        const cardName = normalizeText(participantCards.get(identity)?.name.textContent);
        if (cardName) return cardName;
        const participant = activeParticipantMap.get(identity);
        return participant ? readParticipantName(participant) : '';
      })
      .filter((name): name is string => Boolean(name));

    recentSpeakersEls.forEach((element) => {
      renderRecentSpeakers(element, names);
    });
  };

  const scrollToActiveSpeaker = () => {
    const firstSpeaker = room.activeSpeakers[0];
    if (!firstSpeaker) return;
    const card = participantCards.get(firstSpeaker.identity);
    if (!card) return;
    if (card.card.closest('[data-slot="students"]')) {
      card.card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  const disconnectRoom = () => {
    stopRecording();
    closeDevicePanels();
    localHandRaised = false;
    syncRaiseHandUi();
    room.disconnect();
    participantCards.forEach((_, identity) => removeParticipant(identity));
    removeMount(localPreviewMount ?? undefined);
    localPreviewMount = null;
    if (disconnectedCameraPreviewEnabled) {
      void enableDisconnectedCameraPreview().catch((error) => {
        disableDisconnectedCameraPreview();
        setStatus(safeErrorMessage(error));
      });
    } else {
      clearIdentityPreviewSlot();
    }
    participantList.innerHTML = '';
    renderParticipantList();
    setControlState();
  };

  const connectRoom = async (options: { fromExternalGate?: boolean } = {}) => {
    const roomName = roomInput.value.trim();
    const fallbackIdentity = isExternalInviteMode
      ? sanitizeClientIdentity(externalInviteGuestEmail) ||
        sanitizeClientIdentity(externalInviteGuestName) ||
        createClientGuestIdentity()
      : '';
    const identity = identityInput.value.trim() || fallbackIdentity;
    const displayName = nameInput.value.trim() || externalInviteGuestName || identity;
    localRole = normalizeRole(roleInput.value);

    if (isInvalidInviteMode) {
      openExternalInviteGate();
      setExternalInviteGateMessage(
        inviteError || 'La invitación de esta sala no está disponible.',
        true,
      );
      setStatus(inviteError || 'La invitación de esta sala no está disponible.');
      return;
    }

    if (isExternalInviteMode && !options.fromExternalGate) {
      openExternalInviteGate();
      setExternalInviteGateMessage('Completa tus datos para entrar a la sala.', false);
      setStatus('Completa el acceso externo antes de conectar.');
      return;
    }

    if (!roomName || (!identity && !isExternalInviteMode)) {
      setStatus('Room and identity are required before connecting.');
      return;
    }

    if (isExternalInviteMode) {
      identityInput.value = identity;
      nameInput.value = displayName;
    }

    stopTestMode();
    const shouldRestoreDisconnectedPreview = disconnectedCameraPreviewEnabled;
    const hadDisconnectedPreview = Boolean(localPreviewStreamMount?.stream.getVideoTracks()[0]);
    stopDisconnectedLivePreview();
    clearDisconnectedStagePreview();
    removeLocalPreviewStream();
    clearIdentityPreviewSlot();
    if (hadDisconnectedPreview) {
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }

    if (connectButton instanceof HTMLButtonElement) {
      connectButton.disabled = true;
    }
    if (connectToggleButton instanceof HTMLButtonElement) {
      connectToggleButton.disabled = true;
    }
    setStatus('Solicitando token y conectando con la sala...');

    try {
      const tokenQuery = new URLSearchParams();
      tokenQuery.set('room', roomName);
      tokenQuery.set('identity', identity);
      tokenQuery.set('name', displayName);
      if (inviteCode) {
        tokenQuery.set('invite', inviteCode);
      }
      if (isExternalInviteMode) {
        tokenQuery.set('externalName', externalInviteGuestName);
        tokenQuery.set('externalEmail', externalInviteGuestEmail);
        tokenQuery.set('externalPassword', externalInviteGuestPassword);
      } else {
        const pageSlug = getCurrentPresentationPageSlug();
        const effectiveCourseId = getEffectiveCourseId();
        if (effectiveCourseId) {
          tokenQuery.set('course', effectiveCourseId);
        }
        if (pageSlug) {
          tokenQuery.set('pageSlug', pageSlug);
        }
      }

      let tokenPayload: any = null;
      let tokenResponse: Response | null = null;
      let tokenErrorMessage = '';
      for (const endpoint of ['/api/token', '/api/create-live-kit-token']) {
        const tokenUrl = new URL(endpoint, window.location.origin);
        tokenUrl.search = tokenQuery.toString();

        tokenResponse = await fetch(tokenUrl, {
          headers: {
            Accept: 'application/json',
          },
        });

        tokenPayload = await tokenResponse.json().catch(() => null);
        if (tokenResponse.ok && tokenPayload?.token) {
          tokenErrorMessage = '';
          break;
        }

        tokenErrorMessage =
          normalizeText(tokenPayload?.error) ||
          (tokenResponse.status === 404
            ? `Token endpoint not found (${endpoint}).`
            : 'Could not create a LiveKit access token.');

        if (tokenResponse.status !== 404) {
          break;
        }
      }

      if (!tokenResponse?.ok || !tokenPayload?.token) {
        throw new Error(tokenErrorMessage || 'Could not create a LiveKit access token.');
      }

      livekitUrl = normalizeText(tokenPayload.livekitUrl) || livekitUrl;
      if (!livekitUrl) {
        throw new Error('LIVEKIT_URL is not configured on this deployment.');
      }

      identityInput.value = normalizeText(tokenPayload.identity) || identity;
      nameInput.value = normalizeText(tokenPayload.name) || displayName;
      localRole = normalizeRole(tokenPayload.role);
      syncRoleUi();
      persistSetupState();
      if (isExternalInviteMode) {
        closeExternalInviteGate();
      }

      await room.connect(livekitUrl, tokenPayload.token);
      await room.startAudio().catch(() => undefined);
      await ensureIncomingAudioContext().catch(() => undefined);

      try {
        await room.localParticipant.enableCameraAndMicrophone();
      } catch (error) {
        setStatus(
          `Connected, but camera or microphone permissions were not granted: ${safeErrorMessage(error)}`,
        );
      }

      await syncLocalBackgroundBlurProcessor().catch(() => undefined);

      if (preferredAudioInputId) {
        await room.switchActiveDevice('audioinput', preferredAudioInputId).catch(() => undefined);
      }
      if (preferredVideoInputId) {
        await room.switchActiveDevice('videoinput', preferredVideoInputId).catch(() => undefined);
      }
      await refreshDeviceOptions(true);
      applySessionLeaderState();
      if (shouldRunHandTracking()) {
        void startHandTracking();
      }

      writeQueryState();
      syncAllParticipants();
      setStatus(`Conectado a ${roomName}.`);
      await publishTeacherState();
      requestPresentationState();
    } catch (error) {
      if (isExternalInviteMode) {
        openExternalInviteGate();
        setExternalInviteGateMessage(safeErrorMessage(error), true);
      }
      if (shouldRestoreDisconnectedPreview && room.state === ConnectionState.Disconnected) {
        void enableDisconnectedCameraPreview().catch(() => {
          disableDisconnectedCameraPreview();
        });
      }
      setStatus(safeErrorMessage(error));
      if (connectButton instanceof HTMLButtonElement) {
        connectButton.disabled = false;
      }
      if (connectToggleButton instanceof HTMLButtonElement) {
        connectToggleButton.disabled = false;
      }
    } finally {
      setControlState();
    }
  };

  room
    .on(RoomEvent.ConnectionStateChanged, (state) => {
      stateNode.textContent = connectionStateLabel(state);
      root.dataset.state = state === ConnectionState.Connected ? 'connected' : 'disconnected';
      setControlState();
    })
    .on(RoomEvent.Connected, () => {
      if (!connectedAtMs) {
        connectedAtMs = Date.now();
      }
      // If compositor was running in offline preview, route it as the camera track
      if (compositorOutputStream) {
        clearCompositorFromStage();
        void publishCompositorStream(compositorOutputStream).catch(() => undefined);
      }
      void syncLocalParticipantMetadata().catch(() => undefined);
      void syncLocalBackgroundBlurProcessor().catch(() => undefined);
      void syncPublishedBallTrack().catch(() => undefined);
      if (shouldRunHandTracking()) {
        void startHandTracking();
      }
      syncAllParticipants();
      setStatus(`Conectado a ${roomInput.value.trim()}.`);
      void refreshDeviceOptions(true);
      requestPresentationState();
      renderSessionTimer();
      syncBreakRoomsShell();
      // Re-broadcast break rooms info to participants who joined after creation
      if (localRole === 'teacher' && breakRoomsActive.length > 0 && canLeadSession()) {
        void publishMessage({
          type: 'break-rooms',
          rooms: breakRoomsActive,
          assignments: breakRoomAssignments,
          mode: breakRoomsMode,
        }).catch(() => undefined);
      }
      // Late-join: student connects to main room while break rooms are already active
      // (teacher may be in a break room so can't re-broadcast — fetch state from server)
      if (localRole === 'student' && breakRoomsActive.length === 0 && !isInBreakRoom()) {
        const currentRoom = roomInput instanceof HTMLInputElement ? normalizeText(roomInput.value) : '';
        const cid = getEffectiveCourseId();
        if (currentRoom && cid) {
          void (async () => {
            try {
              const res = await fetch(
                `/api/live/break-rooms/state?room=${encodeURIComponent(currentRoom)}&courseId=${encodeURIComponent(cid)}`,
              );
              const payload = await res.json().catch(() => null);
              const state = payload?.state;
              if (!state || !Array.isArray(state.rooms) || state.rooms.length === 0) return;
              // Apply the fetched state as if we'd received a break-rooms message
              breakRoomsActive = state.rooms;
              breakRoomsMode = state.mode ?? '';
              breakRoomAssignments = state.assignments ?? {};
              syncBreakRoomsShell();
              renderBreakRoomsPopup();
              const myAssignment = breakRoomAssignments[room.localParticipant.identity];
              if (myAssignment) {
                startBBtnBlink(false);
                window.setTimeout(() => { void joinBreakRoom(myAssignment, false); }, 2000);
              } else if (breakRoomsMode === 'custom') {
                startBBtnBlink(true);
                if (breakRoomsPopup instanceof HTMLElement) {
                  renderBreakRoomsPopup();
                  breakRoomsPopup.hidden = false;
                }
              }
            } catch {
              // best-effort
            }
          })();
        }
      }
    })
    .on(RoomEvent.Disconnected, () => {
      if (destroyed) return;
      reverseMicKeyActive = false;
      reverseMicRestoreState = null;
      connectedAtMs = 0;
      localHandRaised = false;
      syncRaiseHandUi();
      stopRecording();
      cleanupIncomingAudioContext();
      void unpublishSynthTrack().catch(() => undefined);
      void unpublishBallTrack().catch(() => undefined);
      participantCards.forEach((_, identity) => removeParticipant(identity));
      renderParticipantList();
      setStatus('Desconectado.');
      if (disconnectedCameraPreviewEnabled) {
        void enableDisconnectedCameraPreview().catch((error) => {
          disableDisconnectedCameraPreview();
          setStatus(safeErrorMessage(error));
        });
      } else {
        clearIdentityPreviewSlot();
      }
      void refreshDeviceOptions(false);
      setControlState();
    })
    .on(RoomEvent.ActiveSpeakersChanged, () => {
      syncAllParticipants();
      syncRecentSpeakers();
      scrollToActiveSpeaker();
    })
    .on(RoomEvent.ParticipantConnected, () => {
      syncAllParticipants();
      if (localRole === 'teacher') {
        window.setTimeout(() => {
          void publishTeacherState();
        }, 500);
      }
    })
    .on(RoomEvent.ParticipantDisconnected, (participant) => {
      removeParticipant(participant.identity);
      syncAllParticipants();
      if (localRole === 'teacher') {
        window.setTimeout(() => {
          void publishTeacherState();
        }, 250);
      }
    })
    .on(RoomEvent.TrackSubscribed, (_, __, participant) => {
      syncAllParticipants();
    })
    .on(RoomEvent.TrackUnsubscribed, (_, __, participant) => {
      syncAllParticipants();
    })
    .on(RoomEvent.LocalTrackPublished, () => {
      void syncLocalBackgroundBlurProcessor().catch(() => undefined);
      syncAllParticipants();
      void refreshDeviceOptions(true);
    })
    .on(RoomEvent.LocalTrackUnpublished, () => {
      syncAllParticipants();
      void refreshDeviceOptions(true);
    })
    .on(RoomEvent.ActiveDeviceChanged, (kind, deviceId) => {
      if (kind === 'audioinput') {
        deviceController.syncGroupValue('audio', deviceId);
        preferredAudioInputId = normalizeText(deviceId);
      }

      if (kind === 'videoinput') {
        deviceController.syncGroupValue('video', deviceId);
        preferredVideoInputId = normalizeText(deviceId);
        releaseRawTrackingSource();
        if (shouldRunHandTracking()) {
          void ensureRawTrackingVideo().catch(() => undefined);
        }
      }

      persistSetupState();
      setControlState();
    })
    .on(RoomEvent.ParticipantMetadataChanged, (_, participant) => {
      if (!participant) return;
      syncParticipant(participant);
      renderParticipantList();
    })
    .on(RoomEvent.ParticipantNameChanged, (_, participant) => {
      syncParticipant(participant);
      renderParticipantList();
    })
    .on(RoomEvent.TrackMuted, (_, participant) => {
      syncAllParticipants();
    })
    .on(RoomEvent.TrackUnmuted, (_, participant) => {
      syncAllParticipants();
    })
    .on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
      if (kind !== DataPacket_Kind.RELIABLE || topic !== MESSAGE_TOPIC || !participant) return;
      if (isLocalParticipant(room, participant)) return;

      const message = readMessage(payload);
      if (!message) return;

      if (message.type === 'chat') {
        appendChatMessage({
          ...message,
          identity: participant.identity,
          name: readParticipantName(participant),
          role: readParticipantRole(room, participant, localRole),
        });
        return;
      }

      if (message.type === 'reaction') {
        appendReactionBurst(message.reaction, readParticipantName(participant));
        return;
      }

      if (message.type === 'session-leader') {
        if (readParticipantRole(room, participant, localRole) !== 'teacher') return;
        manualSessionLeaderIdentity = normalizeText(message.identity);
        applySessionLeaderState();
        syncAllParticipants();
        if (canLeadSession()) {
          void publishTeacherState().catch(() => undefined);
        }
        return;
      }

      if (message.type === 'break-rooms') {
        breakRoomsActive = message.rooms ?? [];
        breakRoomsMode = message.mode ?? '';
        breakRoomAssignments = message.assignments ?? {};
        syncBreakRoomsShell();
        renderBreakRoomsPopup();

        if (localRole === 'student') {
          const myAssignment = breakRoomAssignments[room.localParticipant.identity];

          if (myAssignment) {
            // Random / grupos: blink 2 s then auto-join assigned room
            startBBtnBlink(false);
            window.setTimeout(() => {
              void joinBreakRoom(myAssignment, false);
            }, 2000);
          } else if (breakRoomsMode === 'custom') {
            // Custom: keep blinking, open popup so student can choose
            startBBtnBlink(true);
            if (breakRoomsPopup instanceof HTMLElement) {
              renderBreakRoomsPopup();
              breakRoomsPopup.hidden = false;
            }
          }
        }
        return;
      }

      if (message.type === 'break-rooms-end') {
        const target = normalizeText(message.mainRoom);
        const secs = Math.max(5, Math.min(120, Number(message.countdown) || 60));
        breakRoomsActive = [];
        breakRoomsMode = '';
        breakRoomAssignments = {};
        stopBreakRoomPoll();
        syncBreakRoomsShell();
        startBreakRoomsCountdown(secs, target || mainRoomName);
        return;
      }

      if (message.type === 'break-rooms-kill') {
        const target = normalizeText(message.mainRoom) || mainRoomName;
        breakRoomsActive = [];
        breakRoomsMode = '';
        breakRoomAssignments = {};
        stopBreakRoomPoll();
        syncBreakRoomsShell();
        // Stop any running countdown overlay
        if (_brCountdownTimer) {
          clearInterval(_brCountdownTimer);
          _brCountdownTimer = null;
        }
        if (brCountdownEl instanceof HTMLElement) brCountdownEl.hidden = true;
        // Return immediately to main room
        void joinBreakRoom(target, true);
        return;
      }

      if (message.type === 'presentation-state-request') {
        if (canLeadSession()) {
          void publishPresentationSyncSnapshot().catch(() => undefined);
        }
        return;
      }

      if (readParticipantRole(room, participant, localRole) !== 'teacher') return;
      if (!isSessionLeader(participant)) return;

      if (message.type === 'graph') {
        setGraphVisible(message.open, 'remote');
        return;
      }

      if (message.type === 'external-media') {
        if (message.action === 'close') {
          void applyExternalMediaSession(null, 'remote');
          return;
        }

        void applyExternalMediaSession(
          {
            currentTime: message.currentTime,
            mediaId: message.mediaId,
            playbackState: message.playbackState,
            provider: message.provider,
            sourceUrl: message.sourceUrl,
            title: message.title,
          },
          'remote',
        );
        return;
      }

      if (message.type === 'session-control') {
        sessionAllowsInstruments = message.allowInstruments !== false;
        if (!sessionAllowsInstruments) {
          forceSessionInstrumentShutdown();
        }
        applySessionControlState();
        return;
      }

      if (message.type === 'mute-all') {
        void muteStudentsLocally().catch((error) => {
          setStatus(safeErrorMessage(error));
        });
        return;
      }

      if (message.type === 'layout') {
        const nextLayout = setLayout(stage, message.layout);
        layoutInput.value = nextLayout;
        if (nextLayout !== 'screenshare') {
          layoutBeforeAutoScreenshare = nextLayout;
          autoSwitchedToScreenshare = false;
        }
        screenshareWasActive = hasActiveScreenShare();
        syncAllParticipants();
        return;
      }

      if (message.type === 'presentation') {
        schedulePresentationLoad({
          href: message.href,
          successMessage: message.href ? 'Escena actualizada por teacher.' : 'Escena limpia por teacher.',
        });
        return;
      }

      if (message.type === 'session-setup') {
        return;
      }

      if (message.type === 'slide-state') {
        clearPresentationStateRecoveryRequests();
        currentSlideState = {
          indexf: message.indexf,
          indexh: message.indexh,
          indexv: message.indexv,
          zoom: message.zoom,
        };
        window.dispatchEvent(new CustomEvent('musiki:clase-slide-changed', { detail: { indexh: message.indexh } }));
        applyRemoteSlideState(currentSlideState);
        return;
      }

      if (message.type === 'presentation-media') {
        clearPresentationStateRecoveryRequests();
        currentPresentationMediaState = message;
        applyRemotePresentationMediaState(message);
        return;
      }

      if (message.type === 'circle-move') {
        let target: HTMLElement | null = null;
        if (message.identity === 'focus-slot') {
          target = teacherPanel instanceof HTMLElement ? teacherPanel : null;
        } else if (message.identity === room.localParticipant.identity) {
          target = identityPreviewSlot instanceof HTMLElement ? identityPreviewSlot : null;
        }
        if (target) {
          const absX = message.x * window.innerWidth;
          const absY = message.y * window.innerHeight;
          target.style.transform = `translate(${absX}px, ${absY}px)`;
        }
        return;
      }

    });

  // Drag logic for Camera Circle (Teacher Panel and Self Preview)
  const setupDraggable = (el: HTMLElement, isSelf: boolean) => {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let currentY = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      isDragging = true;
      const transform = window.getComputedStyle(el).transform;
      if (transform !== 'none') {
        const matrix = new DOMMatrix(transform);
        currentX = matrix.m41;
        currentY = matrix.m42;
      }
      startX = e.clientX - currentX;
      startY = e.clientY - currentY;
      el.style.cursor = 'grabbing';
      el.setPointerCapture(e.pointerId);
      document.body.style.userSelect = 'none';
      (document.body.style as any).webkitUserSelect = 'none';
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      if (e.cancelable) e.preventDefault();
      currentX = e.clientX - startX;
      currentY = e.clientY - startY;
      const rect = el.getBoundingClientRect();
      const nextX = Math.max(-rect.left, Math.min(currentX, window.innerWidth - rect.right + currentX));
      const nextY = Math.max(-rect.top, Math.min(currentY, window.innerHeight - rect.bottom + currentY));
      currentX = nextX;
      currentY = nextY;
      el.style.transform = `translate(${currentX}px, ${currentY}px)`;
      if (canLeadSession()) {
        const pctX = currentX / window.innerWidth;
        const pctY = currentY / window.innerHeight;
        void publishMessage({
          type: 'circle-move',
          x: pctX,
          y: pctY,
          identity: isSelf ? room.localParticipant.identity : 'focus-slot',
        });
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!isDragging) return;
      isDragging = false;
      el.style.cursor = 'grab';
      el.releasePointerCapture(e.pointerId);
      document.body.style.userSelect = '';
      (document.body.style as any).webkitUserSelect = '';
    };

    el.style.cursor = 'grab';
    el.style.touchAction = 'none';
    el.style.pointerEvents = 'auto';
    el.addEventListener('pointerdown', onPointerDown, { passive: false });
    el.addEventListener('pointermove', onPointerMove, { passive: false });
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
  };

  if (identityPreviewSlot instanceof HTMLElement) {
    setupDraggable(identityPreviewSlot, true);
  }
  if (teacherPanel instanceof HTMLElement) {
    setupDraggable(teacherPanel, false);
  }

  if (connectButton instanceof HTMLButtonElement) {
    connectButton.addEventListener('click', () => {
      void connectRoom();
    });
  }

  if (disconnectButton instanceof HTMLButtonElement) {
    disconnectButton.addEventListener('click', () => {
      disconnectRoom();
    });
  }

  if (connectToggleButton instanceof HTMLButtonElement) {
    connectToggleButton.addEventListener('click', () => {
      if (
        room.state === ConnectionState.Connected ||
        room.state === ConnectionState.Connecting ||
        room.state === ConnectionState.Reconnecting ||
        room.state === ConnectionState.SignalReconnecting
      ) {
        disconnectRoom();
        return;
      }

      void connectRoom();
    });
  }

  // ── Disconnected live preview (camera button while disconnected) ─────────
  const stopDisconnectedLivePreview = () => {
    micMeterController.stop();
    if (disconnectedLiveStream) {
      disconnectedLiveStream.getTracks().forEach((t) => t.stop());
      disconnectedLiveStream = null;
    }
    if (disconnectedMicStream) {
      disconnectedMicStream.getTracks().forEach((t) => t.stop());
      disconnectedMicStream = null;
    }
    if (teacherSlot instanceof HTMLElement && teacherSlot.querySelector('[data-disconnected-live]')) {
      teacherSlot.innerHTML = '';
    }
    disableDisconnectedCameraPreview();
  };

  const startDisconnectedLivePreview = async () => {
    disconnectedLiveStream = null;
    micMeterController.stop();
    await enableDisconnectedCameraPreview();
    // Request mic separately for offline VU meter (camera preview uses audio: false)
    if (!disconnectedMicStream && navigator.mediaDevices?.getUserMedia) {
      try {
        disconnectedMicStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        syncMicMeter();
      } catch {
        // mic not available — meter stays hidden
      }
    }
  };

  // ── TEST button: record a mic+cam clip, play it back on toggle off ──────
  const testToggleButton = root.querySelector('[data-action="test-toggle"]');
  const testTimerEl = root.querySelector('[data-test-timer]');
  const testVumeterEl = root.querySelector('[data-test-vumeter]');
  const testVumeterController = createRoomMicMeterController({
    micMeter: testVumeterEl instanceof HTMLElement ? testVumeterEl : null,
  });
  let testStream: MediaStream | null = null;
  let testRecorder: MediaRecorder | null = null;
  let testChunks: Blob[] = [];
  let testTimerIntervalId = 0;
  let testPlaybackUrl = '';

  const startTestTimer = () => {
    let seconds = 0;
    if (testTimerEl instanceof HTMLElement) {
      testTimerEl.hidden = false;
      testTimerEl.textContent = '0s';
    }
    testTimerIntervalId = window.setInterval(() => {
      seconds += 1;
      if (testTimerEl instanceof HTMLElement) {
        testTimerEl.textContent = `${seconds}s`;
      }
    }, 1000);
  };

  const stopTestTimer = () => {
    if (testTimerIntervalId) {
      window.clearInterval(testTimerIntervalId);
      testTimerIntervalId = 0;
    }
    if (testTimerEl instanceof HTMLElement) {
      testTimerEl.hidden = true;
    }
  };

  const stopTestMode = () => {
    stopTestTimer();
    testVumeterController.stop();
    micMeterController.stop();
    if (testRecorder && testRecorder.state !== 'inactive') {
      testRecorder.stop();
    }
    if (testStream) {
      testStream.getTracks().forEach((t) => t.stop());
      testStream = null;
    }
    if (testToggleButton instanceof HTMLButtonElement) {
      testToggleButton.dataset.active = 'false';
    }
  };

  if (testToggleButton instanceof HTMLButtonElement) {
    testToggleButton.addEventListener('click', () => {
      if (room.state !== ConnectionState.Disconnected) return;
      const isActive = testToggleButton.dataset.active === 'true';

      if (isActive) {
        // Toggle OFF: stop recording, play back clip
        stopTestTimer();
        if (testRecorder && testRecorder.state !== 'inactive') {
          testRecorder.onstop = () => {
            const blob = new Blob(testChunks, { type: testRecorder?.mimeType || 'video/webm' });
            testChunks = [];
            if (testPlaybackUrl) {
              URL.revokeObjectURL(testPlaybackUrl);
            }
            testPlaybackUrl = URL.createObjectURL(blob);

            // Stop live stream
            if (testStream) {
              testStream.getTracks().forEach((t) => t.stop());
              testStream = null;
            }

            // Show playback in teacher slot
            if (teacherSlot instanceof HTMLElement) {
              teacherSlot.innerHTML = '';
              const playbackWrapper = document.createElement('div');
              playbackWrapper.className = 'conference-media-frame conference-media-frame--test-playback';
              playbackWrapper.dataset.testPlayback = 'true';
              const playbackVideo = document.createElement('video');
              playbackVideo.src = testPlaybackUrl;
              playbackVideo.autoplay = true;
              playbackVideo.playsInline = true;
              playbackVideo.style.cssText = 'width:100%;height:100%;object-fit:cover;';
              playbackVideo.addEventListener('ended', () => {
                playbackWrapper.remove();
                URL.revokeObjectURL(testPlaybackUrl);
                testPlaybackUrl = '';
              });
              playbackWrapper.appendChild(playbackVideo);
              teacherSlot.appendChild(playbackWrapper);
              void playbackVideo.play().catch(() => undefined);
            }
          };
          testRecorder.stop();
        } else {
          if (testStream) {
            testStream.getTracks().forEach((t) => t.stop());
            testStream = null;
          }
          if (teacherSlot instanceof HTMLElement) teacherSlot.innerHTML = '';
        }
        testToggleButton.dataset.active = 'false';
      } else {
        // Toggle ON: stop live preview if active, switch to F layout, start cam+mic, record
        stopDisconnectedLivePreview();
        testToggleButton.dataset.active = 'true';
        setControlState();
        testChunks = [];

        // Switch to teacher (F) layout
        const nextLayout = setLayout(stage, 'teacher');
        layoutInput.value = nextLayout;
        syncLayoutChoiceButtons();
        writeQueryState();

        void (async () => {
          try {
            testStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          } catch (error) {
            testToggleButton.dataset.active = 'false';
            setStatus(`Test: ${safeErrorMessage(error)}`);
            return;
          }

          // Show live video in teacher slot
          if (teacherSlot instanceof HTMLElement) {
            teacherSlot.innerHTML = '';
            const liveWrapper = document.createElement('div');
            liveWrapper.className = 'conference-media-frame conference-media-frame--test-live';
            const liveVideo = document.createElement('video');
            liveVideo.autoplay = true;
            liveVideo.muted = true;
            liveVideo.playsInline = true;
            liveVideo.srcObject = testStream;
            liveVideo.style.cssText = 'width:100%;height:100%;object-fit:cover;';
            liveWrapper.appendChild(liveVideo);
            teacherSlot.appendChild(liveWrapper);
            void liveVideo.play().catch(() => undefined);
          }

          // Start recording
          const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(
            (m) => MediaRecorder.isTypeSupported(m),
          ) || '';
          testRecorder = new MediaRecorder(testStream, mimeType ? { mimeType } : undefined);
          testRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) testChunks.push(e.data);
          };
          testRecorder.start(1000);
          startTestTimer();
          // Start VU meters from test stream audio
          const testAudioTrack = testStream?.getAudioTracks()[0] ?? null;
          if (testAudioTrack) {
            syncMicMeter(); // main meter (below mic button)
            void testVumeterController.start(testAudioTrack).catch(() => testVumeterController.stop()); // overlay bar
          }
        })();
      }
    });
  }

  const submitExternalInviteJoin = () => {
    if (!isExternalInviteMode || isInvalidInviteMode) {
      leaveExternalInviteFlow();
      return;
    }

    const guestName = externalInviteNameInput instanceof HTMLInputElement
      ? normalizeText(externalInviteNameInput.value)
      : '';
    const guestEmail = externalInviteEmailInput instanceof HTMLInputElement
      ? normalizeText(externalInviteEmailInput.value).toLowerCase()
      : '';
    const guestPassword = externalInvitePasswordInput instanceof HTMLInputElement
      ? externalInvitePasswordInput.value
      : '';

    if (!guestName) {
      setExternalInviteGateMessage('Ingresa tu nombre para entrar a la sala.', true);
      if (externalInviteNameInput instanceof HTMLInputElement) {
        externalInviteNameInput.focus();
      }
      return;
    }

    if (!guestEmail || !EMAIL_REGEX.test(guestEmail)) {
      setExternalInviteGateMessage('Ingresa un mail válido para el acceso externo.', true);
      if (externalInviteEmailInput instanceof HTMLInputElement) {
        externalInviteEmailInput.focus();
      }
      return;
    }

    if (!normalizeText(guestPassword)) {
      setExternalInviteGateMessage('Ingresa el password definido para invitados externos.', true);
      if (externalInvitePasswordInput instanceof HTMLInputElement) {
        externalInvitePasswordInput.focus();
      }
      return;
    }

    externalInviteGuestName = guestName;
    externalInviteGuestEmail = guestEmail;
    externalInviteGuestPassword = guestPassword;
    nameInput.value = guestName;
    identityInput.value =
      sanitizeClientIdentity(guestEmail) ||
      sanitizeClientIdentity(guestName) ||
      createClientGuestIdentity();
    setExternalInviteGateMessage('Conectando...', false);
    void connectRoom({ fromExternalGate: true });
  };

  if (externalInviteCreateButton instanceof HTMLButtonElement) {
    externalInviteCreateButton.addEventListener('click', () => {
      void createInviteLink('external');
    });
  }

  if (externalInviteCopyButton instanceof HTMLButtonElement) {
    externalInviteCopyButton.addEventListener('click', () => {
      void copyInviteLinkByType('external').catch((error) => {
        setExternalInviteStatusMessage(safeErrorMessage(error), true);
      });
    });
  }

  if (externalInviteRevokeButton instanceof HTMLButtonElement) {
    externalInviteRevokeButton.addEventListener('click', () => {
      void revokeInviteLink('external');
    });
  }

  if (studentInviteCreateButton instanceof HTMLButtonElement) {
    studentInviteCreateButton.addEventListener('click', () => {
      void createInviteLink('student');
    });
  }

  if (studentInviteCopyButton instanceof HTMLButtonElement) {
    studentInviteCopyButton.addEventListener('click', () => {
      void copyInviteLinkByType('student').catch((error) => {
        setStudentInviteStatusMessage(safeErrorMessage(error), true);
      });
    });
  }

  if (studentInviteRevokeButton instanceof HTMLButtonElement) {
    studentInviteRevokeButton.addEventListener('click', () => {
      void revokeInviteLink('student');
    });
  }

  if (externalInviteJoinButton instanceof HTMLButtonElement) {
    externalInviteJoinButton.addEventListener('click', submitExternalInviteJoin);
  }

  [externalInviteNameInput, externalInviteEmailInput, externalInvitePasswordInput].forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submitExternalInviteJoin();
    });
  });

  if (externalInviteCloseButton instanceof HTMLButtonElement) {
    externalInviteCloseButton.addEventListener('click', () => {
      leaveExternalInviteFlow();
    });
  }

  if (liveActivityButton instanceof HTMLButtonElement) {
    liveActivityButton.addEventListener('click', () => {
      const href = normalizeText(liveActivityButton.dataset.liveHref);
      if (href) {
        window.location.href = href;
      }
    });
  }

  cameraButton.addEventListener('click', async (event) => {
    if (event instanceof MouseEvent && event.shiftKey) {
      event.preventDefault();
      openDevicePanel('video');
      setControlState();
      return;
    }

    if (room.state !== ConnectionState.Connected) {
      try {
        if (disconnectedCameraPreviewEnabled) {
          stopDisconnectedLivePreview();
          setStatus('Preview de camara desactivado.');
        } else {
          // Stop TEST recording if active
          if (testToggleButton instanceof HTMLButtonElement && testToggleButton.dataset.active === 'true') {
            stopTestMode();
          }
          await startDisconnectedLivePreview();
          setStatus('Preview listo.');
        }
        setControlState();
      } catch (error) {
        stopDisconnectedLivePreview();
        setStatus(safeErrorMessage(error));
        setControlState();
      }
      return;
    }

    try {
      await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled);
      await syncLocalBackgroundBlurProcessor().catch(() => undefined);
      syncAllParticipants();
      setControlState();
    } catch (error) {
      setStatus(safeErrorMessage(error));
    }
  });

  microphoneButton.addEventListener('click', async (event) => {
    if (event instanceof MouseEvent && event.shiftKey) {
      event.preventDefault();
      openDevicePanel('audio');
      setControlState();
      return;
    }

    if (room.state !== ConnectionState.Connected) return;

    try {
      await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);
      syncAllParticipants();
      setControlState();
    } catch (error) {
      setStatus(safeErrorMessage(error));
    }
  });

  shareScreenButton.addEventListener('click', async () => {
    if (room.state !== ConnectionState.Connected) return;

    try {
      if (room.localParticipant.isScreenShareEnabled) {
        await room.localParticipant.setScreenShareEnabled(false);
      } else {
        await room.localParticipant.setScreenShareEnabled(true, {
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          resolution: {
            width: 1920,
            height: 1080,
            frameRate: 30,
            aspectRatio: 16 / 9,
          },
          contentHint: 'detail',
          selfBrowserSurface: 'include',
          surfaceSwitching: 'include',
          systemAudio: 'include',
          suppressLocalAudioPlayback: false,
        });
      }
      syncAllParticipants();
      setControlState();
    } catch (error) {
      setStatus(safeErrorMessage(error));
    }
  });

  if (recordButton instanceof HTMLButtonElement) {
    recordButton.addEventListener('click', async () => {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        stopRecording();
        return;
      }

      try {
        await startRecording();
      } catch (error) {
        cleanupRecording();
        setStatus(safeErrorMessage(error));
      }
    });
  }

  if (fullscreenButton instanceof HTMLButtonElement) {
    fullscreenButton.addEventListener('click', () => {
      void toggleFullscreen().catch((error) => {
        applyImmersiveFullscreenState(false);
        syncFullscreenButton();
        setStatus(safeErrorMessage(error));
      });
    });
  }

  if (shortcutsHelpButton instanceof HTMLButtonElement) {
    shortcutsHelpButton.addEventListener('click', () => {
      setShortcutsModalOpen(true);
    });
  }

  if (shortcutsCloseButton instanceof HTMLButtonElement) {
    shortcutsCloseButton.addEventListener('click', () => {
      setShortcutsModalOpen(false);
    });
  }

  if (shortcutsModal instanceof HTMLElement) {
    shortcutsModal.addEventListener('click', (event) => {
      if (event.target === shortcutsModal) {
        setShortcutsModalOpen(false);
      }
    });
  }

  if (sidebarToggleButton instanceof HTMLButtonElement) {
    sidebarToggleButton.addEventListener('click', () => {
      toggleSidebarCollapsed();
      if (!sidebarCollapsed) resetChatUnread();
    });
  }

  if (instrumentsToggleButton instanceof HTMLButtonElement) {
    instrumentsToggleButton.addEventListener('click', () => {
      toggleInstrumentsOpen();
    });
  }

  deviceController.bind();

  if (previewZoomInput instanceof HTMLInputElement) {
    previewZoomInput.addEventListener('input', () => {
      previewZoom = normalizePreviewZoom(previewZoomInput.value, previewZoom);
      presentationCircleZoom = previewZoom;
      applyPreviewZoomState();
      persistSetupState();
      if (room.state === ConnectionState.Connected) {
        void syncLocalParticipantMetadata().catch(() => undefined);
      }
    });
  }

  if (showCircleInput instanceof HTMLInputElement) {
    showCircleInput.addEventListener('change', () => {
      showPresentationCircle = showCircleInput.checked;
      applyShowCircleState();
      persistSetupState();
      syncAllParticipants(); // recompute self-in-sidebar when circle toggles
      if (room.state === ConnectionState.Connected) {
        void syncLocalParticipantMetadata().catch(() => undefined);
      }
    });
  }

  if (backgroundBlurToggleButton instanceof HTMLButtonElement) {
    backgroundBlurToggleButton.addEventListener('click', () => {
      backgroundEffectMode = backgroundEffectMode === 'blur' ? 'none' : 'blur';
      applyBackgroundEffectState();
      persistSetupState();
      closeBackgroundReplacePopup();
      void refreshBackgroundVideoProcessing().catch((error) => {
        setStatus(safeErrorMessage(error));
      });
    });
  }

  if (backgroundReplaceToggleButton instanceof HTMLButtonElement) {
    backgroundReplaceToggleButton.addEventListener('click', () => {
      if (backgroundReplacePopupOpen) {
        closeBackgroundReplacePopup();
      } else {
        openBackgroundReplacePopup();
      }
    });
  }

  if (backgroundReplaceCloseButton instanceof HTMLButtonElement) {
    backgroundReplaceCloseButton.addEventListener('click', () => {
      closeBackgroundReplacePopup();
    });
  }

  if (backgroundEffectClearButton instanceof HTMLButtonElement) {
    backgroundEffectClearButton.addEventListener('click', () => {
      backgroundEffectMode = 'none';
      applyBackgroundEffectState();
      persistSetupState();
      setBackgroundImageStatus('Background effect disabled.');
      closeBackgroundReplacePopup();
      void refreshBackgroundVideoProcessing().catch((error) => {
        setStatus(safeErrorMessage(error));
      });
    });
  }

  if (backgroundImagePickButton instanceof HTMLButtonElement && backgroundImageFileInput instanceof HTMLInputElement) {
    backgroundImagePickButton.addEventListener('click', () => {
      backgroundImageFileInput.click();
    });
  }

  if (backgroundImageFileInput instanceof HTMLInputElement) {
    backgroundImageFileInput.addEventListener('change', () => {
      const [file] = Array.from(backgroundImageFileInput.files || []);
      if (!file) return;
      void applyBackgroundImageFile(file).catch((error) => {
        setBackgroundImageStatus(safeErrorMessage(error), true);
      });
      backgroundImageFileInput.value = '';
    });
  }

  if (backgroundImageClearButton instanceof HTMLButtonElement) {
    backgroundImageClearButton.addEventListener('click', () => {
      void clearBackgroundImageSelection().catch((error) => {
        setBackgroundImageStatus(safeErrorMessage(error), true);
      });
    });
  }

  if (backgroundImageSearchButton instanceof HTMLButtonElement) {
    backgroundImageSearchButton.addEventListener('click', () => {
      void runBackgroundImageSearch(
        backgroundImageSearchInput instanceof HTMLInputElement ? backgroundImageSearchInput.value : '',
      );
    });
  }

  if (backgroundImageSearchInput instanceof HTMLInputElement) {
    backgroundImageSearchInput.addEventListener('keydown', (event) => {
      if (!(event instanceof KeyboardEvent) || event.key !== 'Enter') return;
      event.preventDefault();
      void runBackgroundImageSearch(backgroundImageSearchInput.value);
    });
  }

  if (backgroundColorApplyButton instanceof HTMLButtonElement && backgroundColorInput instanceof HTMLInputElement) {
    backgroundColorApplyButton.addEventListener('click', () => {
      backgroundColor = normalizeBackgroundColor(backgroundColorInput.value, backgroundColor);
      backgroundEffectMode = 'color';
      applyBackgroundEffectState();
      persistSetupState();
      setBackgroundImageStatus('Solid color background applied.');
      closeBackgroundReplacePopup();
      void refreshBackgroundVideoProcessing().catch((error) => {
        setStatus(safeErrorMessage(error));
      });
    });

    backgroundColorInput.addEventListener('input', () => {
      backgroundColor = normalizeBackgroundColor(backgroundColorInput.value, backgroundColor);
      if (backgroundEffectMode !== 'color') return;
      applyBackgroundEffectState();
      persistSetupState();
      void refreshBackgroundVideoProcessing().catch(() => undefined);
    });
  }

  if (backgroundImageDropzone instanceof HTMLElement) {
    ['dragenter', 'dragover'].forEach((eventName) => {
      backgroundImageDropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        backgroundImageDropzone.dataset.dragActive = 'true';
      });
    });
    ['dragleave', 'dragend'].forEach((eventName) => {
      backgroundImageDropzone.addEventListener(eventName, () => {
        backgroundImageDropzone.dataset.dragActive = 'false';
      });
    });
    backgroundImageDropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      backgroundImageDropzone.dataset.dragActive = 'false';
      const [file] = Array.from(event.dataTransfer?.files || []);
      if (!file) return;
      void applyBackgroundImageFile(file).catch((error) => {
        setBackgroundImageStatus(safeErrorMessage(error), true);
      });
    });
  }

  if (previewInvertInput instanceof HTMLInputElement) {
    previewInvertInput.addEventListener('change', () => {
      previewInvert = previewInvertInput.checked;
      applyPreviewInvertState();
      persistSetupState();
      void refreshBackgroundVideoProcessing().catch((error) => {
        setStatus(safeErrorMessage(error));
      });
    });
  }

  if (recordingPresetSelect instanceof HTMLSelectElement) {
    recordingPresetSelect.addEventListener('change', () => {
      recordingPreset = normalizeRecordingPreset(recordingPresetSelect.value, recordingPreset);
      applyRecordingPresetState();
      persistSetupState();
    });
  }

  if (handTrackInput instanceof HTMLInputElement) {
    handTrackInput.addEventListener('change', () => {
      if (!canUseInstruments()) {
        handTrackInput.checked = false;
        applyHandTrackState();
        return;
      }
      handTrackEnabled = handTrackInput.checked;
      applyHandTrackState();
      persistSetupState();

      if (room.state === ConnectionState.Connected) {
        void syncLocalBackgroundBlurProcessor().catch(() => undefined);
      } else if (room.state === ConnectionState.Disconnected) {
        void syncDisconnectedPreviewProcessing().catch((error) => {
          setStatus(safeErrorMessage(error));
        });
      }

      if (shouldRunHandTracking()) {
        void startHandTracking();
        return;
      }

      stopHandTracking();
    });
  }

  if (handTrackToggleButton instanceof HTMLButtonElement) {
    handTrackToggleButton.addEventListener('click', () => {
      toggleCheckboxInput(handTrackInput);
    });
  }

  if (gravityBallInput instanceof HTMLInputElement) {
    gravityBallInput.addEventListener('change', () => {
      if (!canUseInstruments()) {
        gravityBallInput.checked = false;
        applyGravityBallState();
        return;
      }
      gravityBallEnabled = gravityBallInput.checked;
      applyGravityBallState();
      persistSetupState();

      if (room.state === ConnectionState.Connected) {
        void syncPublishedBallTrack();
        void syncLocalBackgroundBlurProcessor().catch(() => undefined);
      } else if (room.state === ConnectionState.Disconnected) {
        void syncDisconnectedPreviewProcessing().catch((error) => {
          setStatus(safeErrorMessage(error));
        });
      }

      if (shouldRunHandTracking()) {
        void startHandTracking();
        return;
      }

      stopHandTracking();
    });
  }

  if (gravityBallToggleButton instanceof HTMLButtonElement) {
    gravityBallToggleButton.addEventListener('click', () => {
      toggleCheckboxInput(gravityBallInput);
    });
  }

  if (gravityBallMirrorInput instanceof HTMLInputElement) {
    gravityBallMirrorInput.addEventListener('change', () => {
      gravityBallMirror = gravityBallMirrorInput.checked;
      gravityBallRenderer?.setEnvMirrorEnabled(gravityBallMirror);
      persistSetupState();
    });
  }

  if (gravityBallGravityInput instanceof HTMLInputElement) {
    const syncGravityBallGravity = () => {
      gravityBallGravity = normalizeGravityBallGravity(gravityBallGravityInput.value, gravityBallGravity);
      applyGravityBallState();
      persistSetupState();
    };
    gravityBallGravityInput.addEventListener('input', syncGravityBallGravity);
    gravityBallGravityInput.addEventListener('change', syncGravityBallGravity);
  }

  if (handRampInput instanceof HTMLInputElement) {
    const syncHandRamp = () => {
      handRampMs = clampNumber(handRampInput.value, 10, 4000, handRampMs, 0);
      applyHandRampState();
      persistSetupState();
    };
    handRampInput.addEventListener('input', syncHandRamp);
    handRampInput.addEventListener('change', syncHandRamp);
  }

  if (synthMappingResetButton instanceof HTMLButtonElement) {
    synthMappingResetButton.addEventListener('click', () => {
      if (!canUseInstruments()) return;
      synthControlRanges = createDefaultHandControlRanges();
      persistSetupState();
      setStatus('Hand mapping reset.');
    });
  }

  synthMapButtons.forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    button.addEventListener('click', () => {
      if (!canUseInstruments()) return;
      const rawDescriptor = normalizeText(button.dataset.synthMapCapture);
      const [key, edge] = rawDescriptor.split(':') as [HandControlKey | '', 'min' | 'max' | ''];
      if (!key || (edge !== 'min' && edge !== 'max')) return;
      if (!currentHandControlValues) {
        setStatus('Activa Hand track y posiciona la mano antes de mapear.');
        return;
      }

      const nextValue = clamp01(currentHandControlValues[key]);
      synthControlRanges = {
        ...synthControlRanges,
        [key]: {
          ...synthControlRanges[key],
          [edge]: nextValue,
        },
      };
      persistSetupState();
      setStatus(`${key} ${edge === 'min' ? 'min' : 'max'} = ${nextValue.toFixed(2)}`);
    });
  });

  const bindMixerRange = (
    input: Element | null,
    reader: () => void,
  ) => {
    if (!(input instanceof HTMLInputElement)) return;
    input.addEventListener('input', reader);
    input.addEventListener('change', reader);
  };

  const bindRangeKnob = (
    knob: Element | null,
    input: Element | null,
    resetValue = 0,
  ) => {
    if (!(knob instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;

    const setFromClientDelta = (deltaY: number) => {
      const minimum = Number(input.min || '0');
      const maximum = Number(input.max || '1');
      const safeMin = Number.isFinite(minimum) ? minimum : 0;
      const safeMax = Number.isFinite(maximum) ? maximum : 1;
      const span = Math.max(0.0001, safeMax - safeMin);
      const current = Math.min(safeMax, Math.max(safeMin, Number(input.value) || 0));
      const next = Math.min(safeMax, Math.max(safeMin, current - (deltaY / 180) * span));
      input.value = next.toFixed(2);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    let pointerId = -1;
    let lastY = 0;

    knob.addEventListener('pointerdown', (event) => {
      pointerId = event.pointerId;
      lastY = event.clientY;
      knob.setPointerCapture(pointerId);
      event.preventDefault();
    });

    knob.addEventListener('pointermove', (event) => {
      if (pointerId !== event.pointerId) return;
      const deltaY = event.clientY - lastY;
      lastY = event.clientY;
      setFromClientDelta(deltaY);
    });

    const releasePointer = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      try {
        knob.releasePointerCapture(pointerId);
      } catch {
        // ignore
      }
      pointerId = -1;
    };

    knob.addEventListener('pointerup', releasePointer);
    knob.addEventListener('pointercancel', releasePointer);
    knob.addEventListener('wheel', (event) => {
      event.preventDefault();
      setFromClientDelta(event.deltaY);
    }, { passive: false });
    knob.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
        event.preventDefault();
        setFromClientDelta(-8);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
        event.preventDefault();
        setFromClientDelta(8);
      } else if (event.key === 'Home' || event.key === '0') {
        event.preventDefault();
        input.value = String(resetValue);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  };

  bindMixerRange(mixerSynthGainInput, () => {
    if (!(mixerSynthGainInput instanceof HTMLInputElement)) return;
    mixerSynthGain = normalizeMasterGain(mixerSynthGainInput.value, mixerSynthGain);
    applyMixerState();
    persistSetupState();
  });

  bindMixerRange(mixerSynthPanInput, () => {
    if (!(mixerSynthPanInput instanceof HTMLInputElement)) return;
    mixerSynthPan = Math.min(1, Math.max(-1, Number(mixerSynthPanInput.value) || 0));
    applyMixerState();
    persistSetupState();
  });

  bindMixerRange(mixerSynthReverbSendInput, () => {
    if (!(mixerSynthReverbSendInput instanceof HTMLInputElement)) return;
    mixerSynthReverbSend = clampNumber(mixerSynthReverbSendInput.value, 0, 1, mixerSynthReverbSend, 2);
    applyMixerState();
    persistSetupState();
  });

  bindMixerRange(mixerSynthDelaySendInput, () => {
    if (!(mixerSynthDelaySendInput instanceof HTMLInputElement)) return;
    mixerSynthDelaySend = clampNumber(mixerSynthDelaySendInput.value, 0, 1, mixerSynthDelaySend, 2);
    applyMixerState();
    persistSetupState();
  });

  bindMixerRange(mixerBallGainInput, () => {
    if (!(mixerBallGainInput instanceof HTMLInputElement)) return;
    mixerBallGain = normalizeMasterGain(mixerBallGainInput.value, mixerBallGain);
    applyMixerState();
    persistSetupState();
  });

  bindMixerRange(mixerBallPanInput, () => {
    if (!(mixerBallPanInput instanceof HTMLInputElement)) return;
    mixerBallPan = Math.min(1, Math.max(-1, Number(mixerBallPanInput.value) || 0));
    applyMixerState();
    persistSetupState();
  });

  bindMixerRange(mixerBallReverbSendInput, () => {
    if (!(mixerBallReverbSendInput instanceof HTMLInputElement)) return;
    mixerBallReverbSend = clampNumber(mixerBallReverbSendInput.value, 0, 1, mixerBallReverbSend, 2);
    applyMixerState();
    persistSetupState();
  });

  bindMixerRange(mixerBallDelaySendInput, () => {
    if (!(mixerBallDelaySendInput instanceof HTMLInputElement)) return;
    mixerBallDelaySend = clampNumber(mixerBallDelaySendInput.value, 0, 1, mixerBallDelaySend, 2);
    applyMixerState();
    persistSetupState();
  });

  bindMixerRange(mixerIncomingGainInput, () => {
    if (!(mixerIncomingGainInput instanceof HTMLInputElement)) return;
    mixerIncomingGain = normalizeMasterGain(mixerIncomingGainInput.value, mixerIncomingGain);
    applyMixerState();
    persistSetupState();
  });

  bindMixerRange(mixerIncomingPanInput, () => {
    if (!(mixerIncomingPanInput instanceof HTMLInputElement)) return;
    mixerIncomingPan = Math.min(1, Math.max(-1, Number(mixerIncomingPanInput.value) || 0));
    applyMixerState();
    persistSetupState();
  });

  bindMixerRange(mixerIncomingReverbSendInput, () => {
    if (!(mixerIncomingReverbSendInput instanceof HTMLInputElement)) return;
    mixerIncomingReverbSend = clampNumber(
      mixerIncomingReverbSendInput.value,
      0,
      1,
      mixerIncomingReverbSend,
      2,
    );
    applyMixerState();
    persistSetupState();
  });

  bindMixerRange(mixerIncomingDelaySendInput, () => {
    if (!(mixerIncomingDelaySendInput instanceof HTMLInputElement)) return;
    mixerIncomingDelaySend = clampNumber(
      mixerIncomingDelaySendInput.value,
      0,
      1,
      mixerIncomingDelaySend,
      2,
    );
    applyMixerState();
    persistSetupState();
  });

  bindMixerRange(mixerMasterGainInput, () => {
    if (!(mixerMasterGainInput instanceof HTMLInputElement)) return;
    mixerMasterGain = normalizeMasterGain(mixerMasterGainInput.value, mixerMasterGain);
    applyMixerState();
    persistSetupState();
  });

  bindMixerRange(mixerMasterPanInput, () => {
    if (!(mixerMasterPanInput instanceof HTMLInputElement)) return;
    mixerMasterPan = Math.min(1, Math.max(-1, Number(mixerMasterPanInput.value) || 0));
    applyMixerState();
    persistSetupState();
  });

  if (mixerSynthMuteButton instanceof HTMLButtonElement) {
    mixerSynthMuteButton.addEventListener('click', () => {
      mixerSynthMuted = !mixerSynthMuted;
      applyMixerState();
      persistSetupState();
    });
  }

  if (mixerBallMuteButton instanceof HTMLButtonElement) {
    mixerBallMuteButton.addEventListener('click', () => {
      mixerBallMuted = !mixerBallMuted;
      applyMixerState();
      persistSetupState();
    });
  }

  if (mixerIncomingMuteButton instanceof HTMLButtonElement) {
    mixerIncomingMuteButton.addEventListener('click', () => {
      mixerIncomingMuted = !mixerIncomingMuted;
      applyMixerState();
      persistSetupState();
    });
  }

  if (mixerMasterMuteButton instanceof HTMLButtonElement) {
    mixerMasterMuteButton.addEventListener('click', () => {
      mixerMasterMuted = !mixerMasterMuted;
      applyMixerState();
      persistSetupState();
    });
  }

  const handleVideoMixerInput = async () => {
    applyVideoMixerState();
    persistSetupState();

    if (room.state === ConnectionState.Connected) {
      await syncLocalBackgroundBlurProcessor().catch(() => undefined);
      return;
    }

    if (room.state === ConnectionState.Disconnected) {
      await syncDisconnectedPreviewProcessing().catch(() => undefined);
    }
  };

  if (videoBypassToggleButton instanceof HTMLButtonElement) {
    videoBypassToggleButton.addEventListener('click', () => {
      videoMixBypassed = !videoMixBypassed;
      void handleVideoMixerInput();
    });
  }

  const resetMixerScope = (scope: string) => {
    if (scope === 'synth') {
      mixerSynthPan = 0;
      mixerSynthGain = 0;
      mixerSynthReverbSend = 0;
      mixerSynthDelaySend = 0;
      mixerSynthMuted = false;
      applyMixerState();
      persistSetupState();
      setStatus('CH1 reset.');
      return;
    }

    if (scope === 'ball') {
      mixerBallPan = 0;
      mixerBallGain = 0;
      mixerBallReverbSend = 0;
      mixerBallDelaySend = 0;
      mixerBallMuted = false;
      applyMixerState();
      persistSetupState();
      setStatus('CH2 reset.');
      return;
    }

    if (scope === 'incoming') {
      mixerIncomingPan = 0;
      mixerIncomingGain = 0;
      mixerIncomingReverbSend = 0;
      mixerIncomingDelaySend = 0;
      mixerIncomingMuted = true;
      applyMixerState();
      persistSetupState();
      setStatus('CH3 reset.');
      return;
    }

    if (scope === 'master') {
      mixerMasterPan = 0;
      mixerMasterGain = 0;
      mixerMasterMuted = false;
      applyMixerState();
      persistSetupState();
      setStatus('Master reset.');
      return;
    }

    if (scope === 'video') {
      videoMix = createNeutralVideoMix();
      void handleVideoMixerInput();
      setStatus('Video reset.');
    }
  };

  const resetMixerControl = (descriptor: string) => {
    const [group, key] = normalizeText(descriptor).split(':');
    if (group !== 'video') return;

    if (key === 'luma') {
      videoMix.luma = 0;
    } else if (key === 'tint') {
      videoMix.tint = 0;
    } else if (key === 'saturation') {
      videoMix.saturation = 0;
    } else if (key === 'contrast') {
      videoMix.contrast = 0;
    } else if (key === 'brightness') {
      videoMix.brightness = 0;
    } else {
      return;
    }

    void handleVideoMixerInput();
  };

  bindMixerRange(mixerVideoLumaInput, () => {
    if (!(mixerVideoLumaInput instanceof HTMLInputElement)) return;
    videoMix.luma = normalizeVideoMixValue(mixerVideoLumaInput.value, videoMix.luma);
    void handleVideoMixerInput();
  });

  bindMixerRange(mixerVideoTintInput, () => {
    if (!(mixerVideoTintInput instanceof HTMLInputElement)) return;
    videoMix.tint = normalizeVideoMixValue(mixerVideoTintInput.value, videoMix.tint);
    void handleVideoMixerInput();
  });

  bindMixerRange(mixerVideoSaturationInput, () => {
    if (!(mixerVideoSaturationInput instanceof HTMLInputElement)) return;
    videoMix.saturation = normalizeVideoMixValue(mixerVideoSaturationInput.value, videoMix.saturation);
    void handleVideoMixerInput();
  });

  bindMixerRange(mixerVideoContrastInput, () => {
    if (!(mixerVideoContrastInput instanceof HTMLInputElement)) return;
    videoMix.contrast = normalizeVideoMixValue(mixerVideoContrastInput.value, videoMix.contrast);
    void handleVideoMixerInput();
  });

  bindMixerRange(mixerVideoBrightnessInput, () => {
    if (!(mixerVideoBrightnessInput instanceof HTMLInputElement)) return;
    videoMix.brightness = normalizeVideoMixValue(mixerVideoBrightnessInput.value, videoMix.brightness);
    void handleVideoMixerInput();
  });

  bindRangeKnob(mixerSynthPanKnob, mixerSynthPanInput, 0);
  bindRangeKnob(mixerBallPanKnob, mixerBallPanInput, 0);
  bindRangeKnob(mixerIncomingPanKnob, mixerIncomingPanInput, 0);
  bindRangeKnob(mixerMasterPanKnob, mixerMasterPanInput, 0);
  bindRangeKnob(mixerSynthReverbSendKnob, mixerSynthReverbSendInput, 0);
  bindRangeKnob(mixerSynthDelaySendKnob, mixerSynthDelaySendInput, 0);
  bindRangeKnob(mixerBallReverbSendKnob, mixerBallReverbSendInput, 0);
  bindRangeKnob(mixerBallDelaySendKnob, mixerBallDelaySendInput, 0);
  bindRangeKnob(mixerIncomingReverbSendKnob, mixerIncomingReverbSendInput, 0);
  bindRangeKnob(mixerIncomingDelaySendKnob, mixerIncomingDelaySendInput, 0);
  bindRangeKnob(mixerVideoLumaKnob, mixerVideoLumaInput, 0);
  bindRangeKnob(mixerVideoTintKnob, mixerVideoTintInput, 0);
  bindRangeKnob(mixerVideoSaturationKnob, mixerVideoSaturationInput, 0);
  bindRangeKnob(mixerVideoContrastKnob, mixerVideoContrastInput, 0);
  bindRangeKnob(mixerVideoBrightnessKnob, mixerVideoBrightnessInput, 0);

  mixerResetButtonNodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.addEventListener('click', () => {
      resetMixerScope(normalizeText(node.dataset.mixerResetButton));
    });
  });

  mixerResetScopeNodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.addEventListener('dblclick', () => {
      resetMixerScope(normalizeText(node.dataset.mixerResetScope));
    });
  });

  mixerResetControlNodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.addEventListener('dblclick', () => {
      resetMixerControl(normalizeText(node.dataset.mixerResetControl));
    });
  });

  bindMixerRange(synthReverbTimeInput, () => {
    if (!(synthReverbTimeInput instanceof HTMLInputElement)) return;
    synthReverbTime = clampNumber(synthReverbTimeInput.value, 0.4, 8, synthReverbTime, 2);
    applySynthFxState();
    persistSetupState();
  });

  bindMixerRange(synthReverbMixInput, () => {
    if (!(synthReverbMixInput instanceof HTMLInputElement)) return;
    synthReverbMix = clampNumber(synthReverbMixInput.value, 0, 1, synthReverbMix, 2);
    applySynthFxState();
    persistSetupState();
  });

  bindMixerRange(synthDelayTimeInput, () => {
    if (!(synthDelayTimeInput instanceof HTMLInputElement)) return;
    synthDelayTime = clampNumber(synthDelayTimeInput.value, 0.05, 1.2, synthDelayTime, 2);
    applySynthFxState();
    persistSetupState();
  });

  bindMixerRange(synthDelayFeedbackInput, () => {
    if (!(synthDelayFeedbackInput instanceof HTMLInputElement)) return;
    synthDelayFeedback = clampNumber(synthDelayFeedbackInput.value, 0, 0.95, synthDelayFeedback, 2);
    applySynthFxState();
    persistSetupState();
  });

  bindMixerRange(synthDelayMixInput, () => {
    if (!(synthDelayMixInput instanceof HTMLInputElement)) return;
    synthDelayMix = clampNumber(synthDelayMixInput.value, 0, 1, synthDelayMix, 2);
    applySynthFxState();
    persistSetupState();
  });

  bindMixerRange(synthDelayToneInput, () => {
    if (!(synthDelayToneInput instanceof HTMLInputElement)) return;
    synthDelayTone = clampNumber(synthDelayToneInput.value, 400, 8000, synthDelayTone, 0);
    applySynthFxState();
    persistSetupState();
  });

  if (synthCompToggle instanceof HTMLButtonElement) {
    synthCompToggle.addEventListener('click', () => {
      synthCompressorEnabled = !synthCompressorEnabled;
      applySynthFxState();
      persistSetupState();
    });
  }

  bindMixerRange(synthCompThresholdInput, () => {
    if (!(synthCompThresholdInput instanceof HTMLInputElement)) return;
    synthCompressorThreshold = clampNumber(synthCompThresholdInput.value, -48, 0, synthCompressorThreshold, 1);
    applySynthFxState();
    persistSetupState();
  });

  bindMixerRange(synthCompRatioInput, () => {
    if (!(synthCompRatioInput instanceof HTMLInputElement)) return;
    synthCompressorRatio = clampNumber(synthCompRatioInput.value, 1, 20, synthCompressorRatio, 2);
    applySynthFxState();
    persistSetupState();
  });

  bindMixerRange(synthCompAttackInput, () => {
    if (!(synthCompAttackInput instanceof HTMLInputElement)) return;
    synthCompressorAttack = clampNumber(synthCompAttackInput.value, 0.001, 0.2, synthCompressorAttack, 3);
    applySynthFxState();
    persistSetupState();
  });

  bindMixerRange(synthCompReleaseInput, () => {
    if (!(synthCompReleaseInput instanceof HTMLInputElement)) return;
    synthCompressorRelease = clampNumber(synthCompReleaseInput.value, 0.02, 1, synthCompressorRelease, 3);
    applySynthFxState();
    persistSetupState();
  });

  bindMixerRange(synthCompKneeInput, () => {
    if (!(synthCompKneeInput instanceof HTMLInputElement)) return;
    synthCompressorKnee = clampNumber(synthCompKneeInput.value, 0, 40, synthCompressorKnee, 1);
    applySynthFxState();
    persistSetupState();
  });

  if (synthLimiterToggle instanceof HTMLButtonElement) {
    synthLimiterToggle.addEventListener('click', () => {
      synthLimiterEnabled = !synthLimiterEnabled;
      applySynthFxState();
      persistSetupState();
    });
  }

  bindMixerRange(synthLimiterThresholdInput, () => {
    if (!(synthLimiterThresholdInput instanceof HTMLInputElement)) return;
    synthLimiterThreshold = clampNumber(synthLimiterThresholdInput.value, -12, 0, synthLimiterThreshold, 1);
    applySynthFxState();
    persistSetupState();
  });

  bindMixerRange(synthLimiterReleaseInput, () => {
    if (!(synthLimiterReleaseInput instanceof HTMLInputElement)) return;
    synthLimiterRelease = clampNumber(synthLimiterReleaseInput.value, 0.01, 0.5, synthLimiterRelease, 3);
    applySynthFxState();
    persistSetupState();
  });

  if (sessionLeaderSelect instanceof HTMLSelectElement) {
    sessionLeaderSelect.addEventListener('change', () => {
      if (localRole !== 'teacher' || !canLeadSession()) {
        applySessionLeaderState();
        return;
      }

      manualSessionLeaderIdentity = normalizeText(sessionLeaderSelect.value);
      applySessionLeaderState();
      syncAllParticipants();
      void publishSessionLeaderIdentity(manualSessionLeaderIdentity).catch((error) => {
        setStatus(safeErrorMessage(error));
      });
    });
  }

  if (sessionAllowInstrumentsInput instanceof HTMLInputElement) {
    sessionAllowInstrumentsInput.addEventListener('change', () => {
      if (
        localRole !== 'teacher' ||
        (room.state === ConnectionState.Connected && !canLeadSession())
      ) {
        applySessionControlState();
        return;
      }

      sessionAllowsInstruments = sessionAllowInstrumentsInput.checked;
      applySessionControlState();
      if (!sessionAllowsInstruments) {
        setStatus('Instrumentos desactivados para estudiantes.');
      }
      if (room.state === ConnectionState.Connected) {
        void publishSessionControlState().catch((error) => {
          setStatus(safeErrorMessage(error));
        });
      }
    });
  }

  if (sessionMuteAllButton instanceof HTMLButtonElement) {
    sessionMuteAllButton.addEventListener('click', () => {
      if (!canLeadSession()) {
        applySessionControlState();
        return;
      }

      void publishMessage({ type: 'mute-all' }).catch((error) => {
        setStatus(safeErrorMessage(error));
      });
    });
  }

  // ── Break rooms event wiring ──────────────────────────────────────
  // B button toggles the unified break rooms popup.
  root.querySelector('[data-action="break-rooms-toggle"]')?.addEventListener('click', () => {
    if (!(breakRoomsPopup instanceof HTMLElement)) return;
    const willOpen = breakRoomsPopup.hidden;
    if (willOpen) renderBreakRoomsPopup();
    breakRoomsPopup.hidden = !willOpen;
  });

  // Close popup when clicking outside
  document.addEventListener('click', (e) => {
    if (!(breakRoomsPopup instanceof HTMLElement) || breakRoomsPopup.hidden) return;
    if (!(breakRoomsShell instanceof HTMLElement)) return;
    if (!breakRoomsShell.contains(e.target as Node)) {
      breakRoomsPopup.hidden = true;
    }
  });

  externalMediaBtn?.addEventListener('click', () => {
    if (!(externalMediaPopup instanceof HTMLElement)) return;
    const willOpen = externalMediaPopup.hidden;
    externalMediaPopup.hidden = !willOpen;
    if (!willOpen) return;
    if (externalMediaStatus instanceof HTMLElement && !externalMediaStatus.textContent?.trim()) {
      externalMediaStatus.textContent = getExternalMediaDefaultStatus();
      externalMediaStatus.dataset.error = 'false';
    }
    if (externalMediaInput instanceof HTMLInputElement) {
      renderExternalMediaSearchResults();
      window.setTimeout(() => {
        externalMediaInput.focus();
        externalMediaInput.select();
      }, 0);
    }
  });

  document.addEventListener('click', (e) => {
    if (!(externalMediaPopup instanceof HTMLElement) || externalMediaPopup.hidden) return;
    if (!(externalMediaControlsShell instanceof HTMLElement)) return;
    if (!externalMediaControlsShell.contains(e.target as Node)) {
      closeExternalMediaPopup();
    }
  });

  document.addEventListener('click', (event) => {
    if (!(backgroundReplacePopup instanceof HTMLElement) || backgroundReplacePopup.hidden) return;
    const target = event.target as Node | null;
    if (!target) return;
    const keepOpen =
      backgroundReplacePopup.contains(target) ||
      (backgroundReplaceToggleButton instanceof HTMLElement && backgroundReplaceToggleButton.contains(target));
    if (!keepOpen) {
      closeBackgroundReplacePopup();
    }
  });

  // 3.1 Random
  root.querySelector('[data-action="break-rooms-random"]')?.addEventListener('click', () => {
    void handleBreakRoomsRandom();
  });

  // 3.2 Grupos
  root.querySelector('[data-action="break-rooms-grupos"]')?.addEventListener('click', () => {
    void handleBreakRoomsGrupos();
  });

  // 3.3 Custom create
  root.querySelector('[data-action="break-rooms-custom"]')?.addEventListener('click', () => {
    void handleBreakRoomsCustom();
  });

  // 3.3 Add field
  root.querySelector('[data-action="break-rooms-add-custom"]')?.addEventListener('click', () => {
    addCustomGroupInput();
  });

  // C — end break rooms with countdown
  root.querySelector('[data-action="break-rooms-end"]')?.addEventListener('click', () => {
    void handleBreakRoomsEnd();
  });

  // T — terminate break rooms immediately
  root.querySelector('[data-action="break-rooms-kill"]')?.addEventListener('click', () => {
    void handleBreakRoomsKill();
  });

  externalMediaOpenButton?.addEventListener('click', () => {
    void openExternalMediaFromInput();
  });

  if (externalMediaInput instanceof HTMLInputElement) {
    externalMediaInput.addEventListener('input', () => {
      queueExternalMediaSearch();
    });
    externalMediaInput.addEventListener('keydown', (event) => {
      if (!(event instanceof KeyboardEvent) || event.key !== 'Enter') return;
      event.preventDefault();
      void openExternalMediaFromInput();
    });
  }

  externalMediaPlayToggleButtons.forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    button.addEventListener('click', () => {
      toggleExternalMediaPlayback();
    });
  });

  externalMediaCloseButtons.forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    button.addEventListener('click', () => {
      void applyExternalMediaSession(null, 'local');
    });
  });

  layoutChoiceButtons.forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    button.addEventListener('click', () => {
      const requestedLayout = normalizeLayoutMode(button.dataset.layoutChoice || '');
      if (requestedLayout === 'presentation' && getCurrentLayout() === 'presentation') {
        resetPresentationZoom();
        return;
      }
      if (layoutInput.disabled) return;
      layoutInput.value = requestedLayout;
      layoutInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  layoutInput.addEventListener('change', () => {
    const nextLayout = setLayout(stage, layoutInput.value);
    layoutInput.value = nextLayout;
    if (nextLayout !== 'screenshare') {
      layoutBeforeAutoScreenshare = nextLayout;
      autoSwitchedToScreenshare = false;
    }
    screenshareWasActive = hasActiveScreenShare();
    writeQueryState();
    syncAllParticipants();

    if (canLeadSession()) {
      void publishMessage({
        type: 'layout',
        layout: nextLayout,
      });
    }
  });

  if (presentationButton instanceof HTMLButtonElement) {
    presentationButton.addEventListener('click', () => {
      const selectedHref = normalizeText(presentationSelect.value) || null;
      schedulePresentationLoad({
        broadcast: canLeadSession(),
        href: selectedHref,
        successMessage: selectedHref ? 'Escena Reveal cargada.' : 'Escena limpia.',
      });
    });
  }

  presentationSelect.addEventListener('change', () => {
    const selectedHref = normalizeText(presentationSelect.value) || null;
    schedulePresentationLoad({
      broadcast: canLeadSession(),
      href: selectedHref,
      successMessage: selectedHref ? 'Escena Reveal cargada.' : 'Escena limpia.',
    });
    setControlState();
  });

  if (presentationClearButton instanceof HTMLButtonElement) {
    presentationClearButton.addEventListener('click', () => {
      presentationSelect.value = '';
      schedulePresentationLoad({
        broadcast: canLeadSession(),
        href: null,
        successMessage: 'Escena limpia.',
      });
    });
  }

  if (raiseHandButton instanceof HTMLButtonElement) {
    raiseHandButton.addEventListener('click', () => {
      void toggleRaisedHand();
    });
  }

  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-reaction]')) {
    btn.addEventListener('click', () => {
      const reaction = btn.dataset.reaction as ReactionKind;
      if (reaction in REACTION_EMOJIS) {
        void publishReaction(reaction).catch((error) => {
          setStatus(safeErrorMessage(error));
        });
      }
    });
  }

  // ── NOTAS ────────────────────────────────────────────────────────────────
  const notesController = createRoomNotesController({
    getCourseId: () => normalizeText(root.dataset.courseId) || null,
    getRoomName: () =>
      roomInput instanceof HTMLInputElement ? normalizeText(roomInput.value) || null : null,
    notesBodyInput: root.querySelector<HTMLTextAreaElement>('[data-notes-body]'),
    notesDownloadBtn: root.querySelector<HTMLButtonElement>('[data-notes-download]'),
    notesForm: root.querySelector<HTMLFormElement>('[data-notes-form]'),
    notesListEl: root.querySelector<HTMLElement>('[data-notes-list]'),
    notesNewBtn: root.querySelector<HTMLButtonElement>('[data-notes-new]'),
    notesPreviewBtn: root.querySelector<HTMLButtonElement>('[data-notes-preview-btn]'),
    notesPreviewEl: root.querySelector<HTMLElement>('[data-notes-preview]'),
    notesSaveBtn: root.querySelector<HTMLButtonElement>('[data-notes-save]'),
    notesSection: root.querySelector('[data-notes-section]'),
    notesTitleInput: root.querySelector<HTMLInputElement>('[data-notes-title]'),
    reportStatus: (message) => {
      setStatus(message);
    },
  });

  notesController.bind();
  // ── END NOTAS ─────────────────────────────────────────────────────────────

  // ── CLASE ─────────────────────────────────────────────────────────────────
  const claseController = createClaseController({
    contentEl: root.querySelector<HTMLElement>('[data-clase-content]'),
    placeholderEl: root.querySelector<HTMLElement>('[data-clase-placeholder]'),
    sectionEl: root.querySelector<HTMLElement>('[data-clase-section]'),
  });
  claseController.bind();
  // ── END CLASE ─────────────────────────────────────────────────────────────

  const beginReverseMicState = async () => {
    if (room.state !== ConnectionState.Connected || reverseMicKeyActive) return;
    const currentState = room.localParticipant.isMicrophoneEnabled;
    reverseMicKeyActive = true;
    reverseMicRestoreState = currentState;
    try {
      await room.localParticipant.setMicrophoneEnabled(!currentState);
      syncAllParticipants();
      setControlState();
    } catch (error) {
      reverseMicKeyActive = false;
      reverseMicRestoreState = null;
      setStatus(safeErrorMessage(error));
    }
  };

  const endReverseMicState = async () => {
    if (!reverseMicKeyActive) return;
    const restoreState = reverseMicRestoreState;
    reverseMicKeyActive = false;
    reverseMicRestoreState = null;
    if (restoreState === null || room.state !== ConnectionState.Connected) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(restoreState);
      syncAllParticipants();
      setControlState();
    } catch (error) {
      setStatus(safeErrorMessage(error));
    }
  };

  const executeRoomShortcutCommand = (command: string) => {
    const normalizedCommand = normalizeText(command);
    if (!normalizedCommand) return;

    if (normalizedCommand.startsWith('reaction:')) {
      const reaction = normalizeText(normalizedCommand.slice('reaction:'.length)) as ReactionKind;
      if (reaction in REACTION_EMOJIS) {
        void publishReaction(reaction).catch((error) => {
          setStatus(safeErrorMessage(error));
        });
      }
      return;
    }

    if (normalizedCommand === 'toggle-sidebar-left') {
      toggleInstrumentsOpen();
      return;
    }

    if (normalizedCommand === 'toggle-sidebar-right') {
      toggleSidebarCollapsed();
      return;
    }

    if (normalizedCommand === 'layout-full') {
      const button = layoutChoiceButtons.find(
        (node) => normalizeLayoutMode(node.dataset.layoutChoice || '') === 'teacher',
      );
      (button instanceof HTMLButtonElement ? button : null)?.click();
      return;
    }

    if (normalizedCommand === 'layout-share') {
      const button = layoutChoiceButtons.find(
        (node) => normalizeLayoutMode(node.dataset.layoutChoice || '') === 'screenshare',
      );
      (button instanceof HTMLButtonElement ? button : null)?.click();
      return;
    }

    if (normalizedCommand === 'layout-presentation') {
      const button = layoutChoiceButtons.find(
        (node) => normalizeLayoutMode(node.dataset.layoutChoice || '') === 'presentation',
      );
      (button instanceof HTMLButtonElement ? button : null)?.click();
      return;
    }

    if (normalizedCommand === 'layout-grid') {
      const button = layoutChoiceButtons.find(
        (node) => normalizeLayoutMode(node.dataset.layoutChoice || '') === 'grid',
      );
      (button instanceof HTMLButtonElement ? button : null)?.click();
      return;
    }

    if (normalizedCommand === 'toggle-circle') {
      toggleCheckboxInput(showCircleInput);
      return;
    }

    if (normalizedCommand === 'toggle-invert-video') {
      toggleCheckboxInput(previewInvertInput);
      return;
    }

    if (normalizedCommand === 'open-delegate-session') {
      openSessionSetup();
      if (sessionLeaderSelect instanceof HTMLSelectElement) {
        sessionLeaderSelect.focus();
        (sessionLeaderSelect as HTMLSelectElement & { showPicker?: () => void }).showPicker?.();
        sessionLeaderSelect.click();
      }
      return;
    }

    if (normalizedCommand === 'share-screen') {
      if (shareScreenButton instanceof HTMLButtonElement) {
        shareScreenButton.click();
      }
      return;
    }

    if (normalizedCommand === 'focus-chat') {
      focusChatComposer();
      return;
    }

    if (normalizedCommand === 'toggle-record') {
      if (recordButton instanceof HTMLButtonElement) {
        recordButton.click();
      }
      return;
    }

    if (normalizedCommand === 'toggle-camera') {
      if (cameraButton instanceof HTMLButtonElement) {
        cameraButton.click();
      }
      return;
    }

    if (normalizedCommand === 'cycle-camera') {
      cycleVideoInput();
      return;
    }

    if (normalizedCommand === 'toggle-connect') {
      if (connectToggleButton instanceof HTMLButtonElement) {
        connectToggleButton.click();
      }
      return;
    }

    if (normalizedCommand === 'mute-all') {
      if (sessionMuteAllButton instanceof HTMLButtonElement && !sessionMuteAllButton.disabled) {
        sessionMuteAllButton.click();
      }
      return;
    }

    if (normalizedCommand === 'toggle-hand') {
      if (raiseHandButton instanceof HTMLButtonElement && !raiseHandButton.disabled) {
        raiseHandButton.click();
      }
      return;
    }

    if (normalizedCommand === 'toggle-fullscreen') {
      void toggleFullscreen().catch((error) => {
        applyImmersiveFullscreenState(false);
        syncFullscreenButton();
        setStatus(safeErrorMessage(error));
      });
      return;
    }

    if (normalizedCommand === 'copy-invite-link') {
      void copyInviteLink().catch((error) => {
        setStatus(safeErrorMessage(error));
      });
      return;
    }

    if (normalizedCommand === 'stage-screenshot') {
      void captureStageScreenshot().catch((error) => {
        setStatus(safeErrorMessage(error));
      });
      return;
    }

    if (normalizedCommand === 'open-search') {
      openGlobalSearch();
      return;
    }

    if (normalizedCommand === 'toggle-graph') {
      triggerGraphToggle();
      return;
    }

    if (normalizedCommand === 'hold-mic-start') {
      void beginReverseMicState();
      return;
    }

    if (normalizedCommand === 'hold-mic-end') {
      void endReverseMicState();
      return;
    }
  };

  searchWindow.handleSearchNavigation = async ({ href }) => {
    const nextHref = normalizeRoomSearchHref(href);
    if (!nextHref) return false;

    schedulePresentationLoad({
      broadcast: room.state === ConnectionState.Connected && canLeadSession(),
      href: nextHref,
      successMessage: 'Escena cargada desde busqueda.',
    });

    return true;
  };

  const handleRoomShortcutKeydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat) return;
    const ignoreShortcutTarget = shouldIgnoreRoomShortcut(event.target);

    if (shortcutsModal instanceof HTMLElement && !shortcutsModal.hidden && event.key === 'Escape') {
      event.preventDefault();
      setShortcutsModalOpen(false);
      return;
    }

    const isRightSidebarShortcut =
      (event.metaKey || event.ctrlKey) &&
      event.shiftKey &&
      !event.altKey &&
      (event.code === 'Backslash' || event.key === '?' || event.key === '/');

    if (isRightSidebarShortcut) {
      event.preventDefault();
      executeRoomShortcutCommand('toggle-sidebar-right');
      return;
    }

    const isLeftSidebarShortcut =
      (event.metaKey || event.ctrlKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.code === 'Backslash';

    if (isLeftSidebarShortcut) {
      event.preventDefault();
      executeRoomShortcutCommand('toggle-sidebar-left');
      return;
    }

    if (ignoreShortcutTarget) return;

    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'j') {
      event.preventDefault();
      executeRoomShortcutCommand('toggle-connect');
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey) {
      const key = String(event.key || '').toLowerCase();
      if (key === 'f') {
        event.preventDefault();
        executeRoomShortcutCommand('toggle-fullscreen');
        return;
      }
      if (key === 'i') {
        event.preventDefault();
        executeRoomShortcutCommand('copy-invite-link');
        return;
      }
      if (key === 'v') {
        event.preventDefault();
        executeRoomShortcutCommand('toggle-camera');
        return;
      }
      if (key === 'n') {
        event.preventDefault();
        executeRoomShortcutCommand('cycle-camera');
        return;
      }
    }

    if ((event.metaKey || event.ctrlKey) && event.altKey && !event.shiftKey) {
      const key = String(event.key || '').toLowerCase();
      if (key === 'g') {
        event.preventDefault();
        postToPresentation({ type: 'musiki:reveal-toggle-jump-to-slide' });
        return;
      }
      const altCommandMap: Record<string, string> = {
        '1': 'layout-full',
        '2': 'layout-share',
        '3': 'layout-presentation',
        '4': 'layout-grid',
        '5': 'toggle-circle',
        '6': 'toggle-invert-video',
        '7': 'open-delegate-session',
        c: 'focus-chat',
        m: 'mute-all',
        n: 'cycle-camera',
        r: 'toggle-record',
        s: 'share-screen',
        t: 'stage-screenshot',
        v: 'toggle-camera',
        y: 'toggle-hand',
      };
      const command = altCommandMap[key];
      if (command) {
        event.preventDefault();
        executeRoomShortcutCommand(command);
        return;
      }
    }

    if (event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      const reaction = REACTION_SHORTCUTS_BY_CODE[event.code];
      if (reaction) {
        event.preventDefault();
        executeRoomShortcutCommand(`reaction:${reaction}`);
        return;
      }
    }

    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.shiftKey && event.key === '?') {
      event.preventDefault();
      executeRoomShortcutCommand('open-search');
      return;
    }

    const plainKey = String(event.key || '').toLowerCase();

    if (plainKey === 'h') {
      event.preventDefault();
      executeRoomShortcutCommand('toggle-hand');
      return;
    }

    if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault();
      executeRoomShortcutCommand('hold-mic-start');
      return;
    }

    if (event.key.toLowerCase() === 'm') {
      event.preventDefault();
      executeRoomShortcutCommand('toggle-hand');
    }
  };

  const handleRoomShortcutKeyup = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key !== ' ' && event.code !== 'Space') return;
    if (shouldIgnoreRoomShortcut(event.target)) return;
    event.preventDefault();
    executeRoomShortcutCommand('hold-mic-end');
  };

  const handleRoomWindowBlur = () => {
    void endReverseMicState();
  };

  const handleGraphStateChange = (event: Event) => {
    const detail = (event as CustomEvent<{ open?: boolean; source?: string }>).detail;
    graphVisible = Boolean(detail?.open);
    if (detail?.source === 'remote') return;
    if (!canLeadSession()) return;
    void publishMessage({
      type: 'graph',
      open: graphVisible,
    }).catch((error) => {
      setStatus(safeErrorMessage(error));
    });
  };

  document.addEventListener('keydown', handleRoomShortcutKeydown);
  document.addEventListener('keyup', handleRoomShortcutKeyup);
  window.addEventListener('graph:statechange', handleGraphStateChange as EventListener);

  if (streamingProfileSelect instanceof HTMLSelectElement) {
    streamingProfileSelect.addEventListener('change', async () => {
      persistSetupState();
      if (room.localParticipant.isCameraEnabled) {
        const profile = getStreamingProfile(localRole, streamingProfileSelect.value as StreamingProfileKey);
        const publication = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (publication?.videoTrack) {
          await publication.videoTrack.setVideoEncoding({ maxBitrate: profile.maxBitrate });
          await publication.videoTrack.setVideoDimensions({ width: profile.width, height: profile.height });
        }
      }
      queuePreferredRemoteVideoDimensionsSync();
    });
  }

  if (optimizeSpeakerInput instanceof HTMLInputElement) {
    optimizeSpeakerInput.addEventListener('change', () => {
      persistSetupState();
      queuePreferredRemoteVideoDimensionsSync();
    });
  }

  if (limitGridQualityInput instanceof HTMLInputElement) {
    limitGridQualityInput.addEventListener('change', () => {
      persistSetupState();
      queuePreferredRemoteVideoDimensionsSync();
    });
  }

  [roomInput, identityInput, nameInput].forEach((input) => {
    input.addEventListener('change', () => {
      writeQueryState();
      persistSetupState();
    });
    input.addEventListener('input', persistSetupState);
  });

  roomInput.addEventListener('input', () => {
    if (currentExternalInviteUrl || currentStudentInviteUrl) {
      syncInviteLinkOutput('external', '', '');
      syncInviteLinkOutput('student', '', '');
      if (localRole === 'teacher') {
        setExternalInviteStatusMessage('La sala cambió. Revisa o regenera el invite externo.', false);
        setStudentInviteStatusMessage('La sala cambió. Revisa o regenera el invite de estudiantes.', false);
      }
    }
    if (inviteReloadTimeoutId) {
      window.clearTimeout(inviteReloadTimeoutId);
      inviteReloadTimeoutId = 0;
    }
    if (localRole === 'teacher') {
      inviteReloadTimeoutId = window.setTimeout(() => {
        void loadInviteLink('external');
        void loadInviteLink('student');
      }, 280);
    }
  });

  roomInput.addEventListener('change', () => {
    notesController.syncScope();
  });

  const handlePresentationLoad = () => {
    postToPresentation({ type: 'musiki:live-snapshot', snapshot: activeLiveSnapshot });
    syncPresentationSessionControl();
    if (pendingRemoteSlideState) {
      applyRemoteSlideState(pendingRemoteSlideState);
    }
    const nextPresentationMediaState = pendingRemotePresentationMediaState ?? currentPresentationMediaState;
    if (nextPresentationMediaState) {
      applyRemotePresentationMediaState(nextPresentationMediaState);
    }
    if (canLeadSession()) {
      requestPresentationState();
    } else {
      queuePresentationStateRecoveryRequests();
    }
  };

  presentationFrame.addEventListener('load', handlePresentationLoad);

  window.addEventListener('message', handlePresentationMessage);
  document.addEventListener('fullscreenchange', syncFullscreenButton);
  document.addEventListener('webkitfullscreenchange', syncFullscreenButton as EventListener);
  window.addEventListener('blur', handleRoomWindowBlur);

  syncRoleUi();
  applySessionLeaderState();
  applySessionControlState();
  applyInstrumentsOpenState();
  applySidebarCollapsedState();
  applyPreviewZoomState();
  applyBackgroundEffectState();
  applyPreviewInvertState();
  applyRecordingPresetState();
  applyShowCircleState();
  applyHandTrackState();
  applyGravityBallState();
  applyHandRampState();
  applyMixerState();
  applyVideoMixerState();
  applySynthFxState();
  startMixerMeters();
  clearHandTrackingOutput();
  setLayout(stage, layoutInput.value);
  renderParticipantList();
  chatController.syncControlState();
  syncPresentationSelection(normalizeText(presentationSelect.value) || null);
  void refreshDeviceOptions(false);
  syncLiveActivityTransport();

  syncInviteLinkOutput('external', '', '');
  syncInviteLinkOutput('student', '', '');
  if (isExternalInviteMode) {
    if (externalInviteNameInput instanceof HTMLInputElement && !externalInviteNameInput.value.trim()) {
      externalInviteNameInput.value = normalizeText(nameInput.value);
    }
    openExternalInviteGate();
    setExternalInviteGateMessage(
      inviteError || 'Completa tus datos para entrar como invitado externo.',
      isInvalidInviteMode,
    );
  }
  if (localRole === 'teacher') {
    setExternalInviteStatusMessage('Genera un link con password para invitados externos.');
    setStudentInviteStatusMessage('Genera un link directo para estudiantes.');
    void loadInviteLink('external');
    void loadInviteLink('student');
  }

  if (shouldRunHandTracking()) {
    void startHandTracking();
  }

  if (presentationSelect.value) {
    schedulePresentationLoad({
      href: normalizeText(presentationSelect.value) || null,
      successMessage: 'Escena Reveal lista.',
    });
  }

  setStatus(
    isExternalInviteMode
      ? 'Acceso externo listo para conectar.'
      : presentationSelect.value
      ? 'Escena Reveal preparada.'
      : 'Configura la sala y conecta.',
  );

  setControlState();

  const handleDeviceChange = () => {
    void refreshDeviceOptions(false);
  };

  const handleLiveActivityTick = () => {
    renderLiveActivity();
    renderSessionTimer();
  };

  const handleVpsStatsTick = async () => {
    const cpuEl = root.querySelector('[data-stat-cpu]') as HTMLElement | null;
    const bwEl = root.querySelector('[data-stat-bw]') as HTMLElement | null;
    if (!cpuEl && !bwEl) return;
    try {
      const response = await fetch('/api/internal/vps-stats');
      if (!response.ok) return;
      const stats = await response.json();
      if (cpuEl) {
        const percent = Number.parseInt(stats.cpu.percent, 10);
        cpuEl.textContent = `${stats.cpu.percent}%`;
        cpuEl.dataset.risk = percent > 85 ? 'crit' : percent > 60 ? 'high' : percent > 30 ? 'warn' : 'ok';
        cpuEl.dataset.statTooltip = `VPS CPU\t${stats.cpu.percent}%\nLoad avg\t${stats.cpu.load}\nCores\t${stats.cpu.cores}`;
      }
      if (bwEl) {
        const mbps = Number.parseFloat(stats.bandwidth.mbps);
        bwEl.textContent = `${stats.bandwidth.mbps}M/s`;
        bwEl.dataset.risk = mbps > 300 ? 'crit' : mbps > 150 ? 'high' : mbps > 50 ? 'warn' : 'ok';
        bwEl.dataset.statTooltip = `VPS Out\t${stats.bandwidth.mbps} Mbps\nTotal TX\t${stats.bandwidth.totalTxGb} GB`;
      }
    } catch {
      // ignore fetch errors
    }
  };

  const handleViewportResize = () => {
    updateRecordingGuideLayout();
    queuePreferredRemoteVideoDimensionsSync();
  };

  navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange);
  liveActivityTickId = window.setInterval(handleLiveActivityTick, 1000);
  if (localRole === 'teacher') {
    vpsStatsTickId = window.setInterval(handleVpsStatsTick, 5000);
    void handleVpsStatsTick();
  }
  window.addEventListener('resize', handleViewportResize);

  const teardown = () => {
    if (destroyed) return;
    destroyed = true;
    if (inviteReloadTimeoutId) {
      window.clearTimeout(inviteReloadTimeoutId);
      inviteReloadTimeoutId = 0;
    }
    if (pendingPresentationTask) {
      window.clearTimeout(pendingPresentationTask);
      pendingPresentationTask = 0;
    }
    clearPresentationStateRecoveryRequests();
    navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange);
    window.removeEventListener('resize', handleViewportResize);
    presentationFrame.removeEventListener('load', handlePresentationLoad);
    window.removeEventListener('message', handlePresentationMessage);
    document.removeEventListener('keydown', handleRoomShortcutKeydown);
    document.removeEventListener('keyup', handleRoomShortcutKeyup);
    window.removeEventListener('graph:statechange', handleGraphStateChange as EventListener);
    document.removeEventListener('fullscreenchange', syncFullscreenButton);
    document.removeEventListener('webkitfullscreenchange', syncFullscreenButton as EventListener);
    window.removeEventListener('blur', handleRoomWindowBlur);
    searchWindow.handleSearchNavigation = previousSearchNavigationHandler;
    unsubscribeLiveActivity?.();
    unsubscribeLiveActivity = null;
    reactionBursts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    reactionBursts.clear();
    if (reactionsLayer instanceof HTMLElement) {
      reactionsLayer.replaceChildren();
    }
    if (liveActivityTickId) {
      window.clearInterval(liveActivityTickId);
      liveActivityTickId = 0;
    }
    if (vpsStatsTickId) {
      window.clearInterval(vpsStatsTickId);
      vpsStatsTickId = 0;
    }
    if (externalMediaStatusClearTimer) {
      window.clearTimeout(externalMediaStatusClearTimer);
      externalMediaStatusClearTimer = null;
    }
    clearExternalMediaPlayer();
    stopMixerMeters();
    stopHandTracking();
    handTrackingLandmarker?.close?.();
    handTrackingLandmarker = null;
    localCameraGravityBallStreamState.enabled = false;
    localCameraGravityBallStreamState.canvas = null;
    gravityBallRenderer?.destroy();
    void fmSynth.destroy();
    micMeterController.teardown();
    applyImmersiveFullscreenState(false);
    stopRecording();
    stopTestMode();
    stopDisconnectedLivePreview();
    disableDisconnectedCameraPreview();
    clearDisconnectedStagePreview();
    disconnectRoom();
    root.dataset.mounted = 'false';
  };

  window.addEventListener('pagehide', teardown, { once: true });

  return teardown;
};
