import { normalizeText } from './normalize';
import {
  BACKGROUND_BLUR_WASM_BASE,
  BANDWIDTH_PROFILES,
  DEFAULT_BACKGROUND_COLOR,
  RECORDING_PRESET_CONFIGS,
} from './constants';
import type {
  BackgroundEffectMode,
  BackgroundRgbaColor,
  RecordingPresetKey,
  RecordingPresetConfig,
  VideoMixSettings,
  VisionTasksModule,
  ThreeModule,
  StreamingProfileKey,
  BandwidthProfile,
} from './types';
import type { ParticipantRole } from '../session';

let visionTasksModulePromise: Promise<VisionTasksModule> | null = null;
let visionTasksFilesetPromise: Promise<unknown> | null = null;
let threeModulePromise: Promise<ThreeModule> | null = null;

export const normalizeRecordingPreset = (
  value: unknown,
  fallback: RecordingPresetKey = 'landscape-1080',
): RecordingPresetKey => {
  const normalized = normalizeText(value) as RecordingPresetKey;
  return normalized in RECORDING_PRESET_CONFIGS ? normalized : fallback;
};

export const normalizeBackgroundEffectMode = (
  value: unknown,
  fallback: BackgroundEffectMode = 'none',
): BackgroundEffectMode => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'blur' || normalized === 'image' || normalized === 'color' || normalized === 'none') {
    return normalized;
  }
  return fallback;
};

export const normalizeBackgroundColor = (value: unknown, fallback = DEFAULT_BACKGROUND_COLOR) => {
  const normalized = normalizeText(value);
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toUpperCase() : fallback.toUpperCase();
};

export const hexToBackgroundRgba = (value: string): BackgroundRgbaColor => {
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

export const canPersistBackgroundImageUrl = (value: string) => Boolean(value) && !value.startsWith('blob:');

export const buildBackgroundImageProxyUrl = (value: string) => {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  return `/api/live/background-image/proxy?url=${encodeURIComponent(normalized)}`;
};

export const getRecordingPresetConfig = (
  value: unknown,
  fallback: RecordingPresetKey = 'landscape-1080',
): RecordingPresetConfig => RECORDING_PRESET_CONFIGS[normalizeRecordingPreset(value, fallback)];

export const getAspectFitRect = (width: number, height: number, targetAspectRatio: number) => {
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

export const loadVisionTasksModule = () => {
  if (!visionTasksModulePromise) {
    visionTasksModulePromise = import('@mediapipe/tasks-vision');
  }
  return visionTasksModulePromise;
};

export const loadVisionTasksFileset = async () => {
  if (!visionTasksFilesetPromise) {
    const vision = await loadVisionTasksModule();
    visionTasksFilesetPromise = vision.FilesetResolver.forVisionTasks(BACKGROUND_BLUR_WASM_BASE);
  }
  return visionTasksFilesetPromise;
};

export const loadThreeModule = () => {
  if (!threeModulePromise) {
    threeModulePromise = import('three');
  }
  return threeModulePromise;
};

export const formatRoleLabel = (role: ParticipantRole) => (role === 'teacher' ? 'Teacher' : 'Student');

export const normalizeUnitValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, Math.round(parsed * 100) / 100));
};

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
export const lerp = (start: number, end: number, amount: number) => start + (end - start) * amount;
export const roundTo = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const normalizeMasterGain = (value: unknown, fallback = 0.35) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, Math.round(parsed * 100) / 100));
};

export const clampNumber = (value: unknown, minimum: number, maximum: number, fallback: number, digits = 3) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const factor = 10 ** digits;
  return Math.round(Math.min(maximum, Math.max(minimum, parsed)) * factor) / factor;
};

export const normalizeVideoMixValue = (value: unknown, fallback = 0) =>
  clampNumber(value, -1, 1, fallback, 2);

export const hasActiveVideoMix = (settings: VideoMixSettings) =>
  Object.values(settings).some((entry) => Math.abs(entry) > 0.01);

export function createNeutralVideoMix(): VideoMixSettings {
  return {
    brightness: 0,
    contrast: 0,
    luma: 0,
    saturation: 0,
    tint: 0,
  };
}

export const createImpulseResponseBuffer = (
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

export const formatDelayTimeLabel = (value: number) =>
  value >= 1 ? `${value.toFixed(2)}s` : `${Math.round(value * 1000)}ms`;

export const formatFrequencyLabel = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}kHz` : `${Math.round(value)}Hz`;

export const getStreamingProfile = (
  role: string,
  profileKey: StreamingProfileKey = 'auto',
): BandwidthProfile => {
  if (profileKey !== 'auto') return BANDWIDTH_PROFILES[profileKey];
  // Default to High for everyone now as requested
  return BANDWIDTH_PROFILES.high;
};
