import type { ExternalMediaPlaybackState, ExternalMediaProvider, PresentationMediaState } from '../session';

export type LiveSnapshot = {
  active?: boolean;
  courseId?: string;
  pageSlug?: string;
  sessionId?: string;
  interactionId?: string;
  endsAt?: string | null;
  prompt?: string;
  type?: string;
};

export type LocalPreviewStreamMount = {
  cleanup?: () => Promise<void> | void;
  deviceId: string;
  element: HTMLVideoElement;
  processed: boolean;
  sourceStream?: MediaStream;
  stream: MediaStream;
  wrapper: HTMLElement;
};

export type ExternalMediaSessionState = {
  capturedAt: number;
  currentTime: number;
  mediaId: string;
  playbackState: ExternalMediaPlaybackState;
  provider: ExternalMediaProvider;
  sourceUrl: string;
  title: string;
};

export type ExternalMediaSearchResult = {
  channelTitle: string;
  mediaId: string;
  publishedAt: string;
  thumbnailUrl: string;
  title: string;
};

export type BackgroundImageSearchResult = {
  imageUrl: string;
  sourceLabel: string;
  sourceUrl: string;
  thumbnailUrl: string;
  title: string;
};

export type PresentationEmbeddedMediaState = PresentationMediaState;

export type YouTubePlayerStateChangeEvent = {
  data: number;
  target: YouTubePlayer;
};

export type YouTubePlayer = {
  destroy: () => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  getVideoData: () => { title?: string; video_id?: string };
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
};

export type YouTubePlayerCtor = new (
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

export type YouTubeWindow = Window & {
  YT?: {
    Player: YouTubePlayerCtor;
    PlayerState?: Record<string, number>;
  };
  __musikiYouTubeApiPromise?: Promise<YouTubePlayerCtor>;
  onYouTubeIframeAPIReady?: () => void;
};

export type WebkitDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

export type WebkitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export type BackgroundEffectMode = 'none' | 'blur' | 'image' | 'color';
export type RecordingPresetKey = 'landscape-1080' | 'instagram-story' | 'tiktok';
export type StreamingProfileKey = 'auto' | 'high' | 'medium' | 'low';

export type HandControlKey =
  | 'carrier'
  | 'modulator'
  | 'gain'
  | 'cutoff'
  | 'resonance'
  | 'waveformMorph'
  | 'distortion';

export type HandControlCurve = 'linear' | 'log' | 'exp';

export type HandControlRange = {
  max: number;
  min: number;
  curve: HandControlCurve;
};

export type PersistedRoomSetup = {
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
  preferredMidiInputId?: string;
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
  circleSize?: number;
  gridSize?: 'normal' | 'compact' | 'avatar' | 'small' | 'usable' | 'comfortable' | 'speaker';
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
  mixerHpGain?: number;
  mixerHpDelaySend?: number;
  mixerHpMuted?: boolean;
  mixerHpPan?: number;
  mixerHpReverbSend?: number;
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
  // Audio processing
  audioEchoCancellation?: boolean;
  audioNoiseSuppression?: boolean;
  audioAutoGainControl?: boolean;
  // FM Synth audio engine
  fmLatencyHint?: 'interactive' | 'balanced' | 'playback';
  fmSampleRate?: 44100 | 48000;
};

export type BandwidthProfile = {
  fps: number;
  height: number;
  maxBitrate: number;
  width: number;
};

export type VideoTrackProcessorLike = {
  destroy: () => Promise<void>;
  init: (opts: {
    element?: HTMLMediaElement;
    kind: any; // Track.Kind.Video
    track: MediaStreamTrack;
  }) => Promise<void>;
  name: string;
  processedTrack?: MediaStreamTrack;
  restart: (opts: {
    element?: HTMLMediaElement;
    kind: any; // Track.Kind.Video
    track: MediaStreamTrack;
  }) => Promise<void>;
};

export type LocalCameraTrackLike = {
  getProcessor?: () => { name?: string } | undefined;
  kind: any; // Track.Kind.Video
  setProcessor?: (
    processor: VideoTrackProcessorLike,
    showProcessedStreamLocally?: boolean,
  ) => Promise<void>;
  stopProcessor?: (keepElement?: boolean) => Promise<void>;
};

export type HandLandmarkPoint = {
  x: number;
  y: number;
  z: number;
};

export type HandOverlayProjection = {
  drawHeight: number;
  drawWidth: number;
  drawX: number;
  drawY: number;
  height: number;
  width: number;
};

export type GravityBallHandPoint = {
  index: number;
  radius: number;
  vx: number;
  vy: number;
  x: number;
  y: number;
};

export type GravityBallGrabAnchor = {
  span: number;
  vx: number;
  vy: number;
  x: number;
  y: number;
};

export type GravityBallHandState = {
  anchor: GravityBallGrabAnchor | null;
  canGrab: boolean;
  points: GravityBallHandPoint[] | null;
};

export type HandSynthTelemetry = {
  carrier: number;
  cutoff: number;
  distortion: number;
  gain: number;
  modulator: number;
  resonance: number;
  waveformMorph: number;
};

export type HandControlValues = Record<HandControlKey, number>;
export type VideoMixKey = 'brightness' | 'contrast' | 'luma' | 'saturation' | 'tint';
export type VideoMixSettings = Record<VideoMixKey, number>;

export type BackgroundRgbaColor = {
  a: number;
  b: number;
  g: number;
  r: number;
};

export type RecordingPresetConfig = {
  height: number;
  key: RecordingPresetKey;
  label: string;
  width: number;
};
