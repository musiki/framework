import type { RecordingPresetKey, RecordingPresetConfig, StreamingProfileKey, BandwidthProfile, HandControlKey } from './types';

export const BANDWIDTH_PROFILES: Record<StreamingProfileKey, BandwidthProfile> = {
  auto:   { fps: 24, height: 720,  maxBitrate: 1_200_000, width: 1280 },
  high:   { fps: 30, height: 1080, maxBitrate: 2_500_000, width: 1920 },
  medium: { fps: 24, height: 480,  maxBitrate: 800_000,   width: 854  },
  low:    { fps: 15, height: 360,  maxBitrate: 300_000,   width: 640  },
};

export const GRAVITY_BALL_LUNAR_MS2 = 1.62;
export const GRAVITY_BALL_EARTH_MS2 = 9.8;
export const GRAVITY_BALL_HEAVY_MS2 = 14.7;
export const GRAVITY_BALL_SIM_EARTH = 0.35;

export const RECORDING_PRESET_CONFIGS: Record<RecordingPresetKey, RecordingPresetConfig> = {
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

export const ROOM_SETUP_STORAGE_KEY = 'musiki:room:setup:v1';
export const BACKGROUND_BLUR_PROCESSOR_NAME = 'musiki-background-blur';
export const DEFAULT_BACKGROUND_COLOR = '#101820';
export const BACKGROUND_BLUR_MODEL_ASSET =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite';
export const HAND_LANDMARKER_MODEL_ASSET =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
export const BACKGROUND_BLUR_WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm';

export const HAND_CONTROL_KEYS: HandControlKey[] = [
  'carrier',
  'modulator',
  'gain',
  'cutoff',
  'resonance',
  'waveformMorph',
  'distortion',
];

export const SYNTH_BASE_MASTER_GAIN = 0.35;
