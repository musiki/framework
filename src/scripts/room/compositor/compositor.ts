/**
 * Camera Compositor — Phase 1
 *
 * Captures two video sources (Source A = webcam / cam 1, Source B = OBS / iPad / cam 2),
 * composites them on a canvas with a configurable mask, and exposes the result as a
 * MediaStream (via canvas.captureStream) that can be published as a LiveKit video track
 * or shown in an offline preview element.
 */

export type CompositorMaskMode = 'none' | 'pip';

export type PipPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

export type CompositorConfig = {
  maskMode: CompositorMaskMode;
  /** PiP size as fraction of canvas (0..1). Default 0.28 */
  pipSize?: number;
  /** Which corner for PiP Source A when maskMode === 'pip' */
  pipPosition?: PipPosition;
};

export type CompositorState = 'idle' | 'running';

export type CanvasCompositor = {
  /** Current running state */
  getState: () => CompositorState;
  /** The internal canvas element — use this directly for preview */
  getCanvas: () => HTMLCanvasElement;
  /** Live MediaStream from the canvas — valid once started */
  getOutputStream: () => MediaStream | null;
  /** Start compositing with the given sources */
  start: (
    sourceA: MediaStream,
    sourceB: MediaStream | null,
    config: CompositorConfig,
  ) => Promise<void>;
  /** Update mask config without stopping */
  updateConfig: (config: CompositorConfig) => void;
  /** Stop compositing and release resources */
  stop: () => void;
  /** Full teardown — call when the compositor will never be used again */
  teardown: () => void;
};

const COMPOSITOR_FPS = 30;
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

const PIP_PADDING = 16;

type PipRect = { x: number; y: number; w: number; h: number };

const computePipRect = (
  canvasW: number,
  canvasH: number,
  size: number,
  position: PipPosition,
): PipRect => {
  const w = Math.round(canvasW * size);
  const h = Math.round(w * (canvasH / canvasW));
  const x =
    position === 'bottom-right' || position === 'top-right'
      ? canvasW - w - PIP_PADDING
      : PIP_PADDING;
  const y =
    position === 'bottom-right' || position === 'bottom-left'
      ? canvasH - h - PIP_PADDING
      : PIP_PADDING;
  return { x, y, w, h };
};

const createVideoElement = (stream: MediaStream): HTMLVideoElement => {
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  return video;
};

export const createCanvasCompositor = (): CanvasCompositor => {
  let state: CompositorState = 'idle';
  let animationId = 0;
  let config: CompositorConfig = { maskMode: 'none', pipSize: 0.28, pipPosition: 'bottom-right' };

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  let outputStream: MediaStream | null = null;

  let videoA: HTMLVideoElement | null = null;
  let videoB: HTMLVideoElement | null = null;
  let streamA: MediaStream | null = null;
  let streamB: MediaStream | null = null;

  const stopVideos = () => {
    if (videoA) {
      videoA.srcObject = null;
      videoA = null;
    }
    if (videoB) {
      videoB.srcObject = null;
      videoB = null;
    }
  };

  const tick = () => {
    if (state !== 'running') return;

    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    const hasB = videoB && streamB && streamB.getVideoTracks().length > 0;
    const hasA = videoA && streamA && streamA.getVideoTracks().length > 0;

    if (config.maskMode === 'pip' && hasB) {
      // Source B fills the canvas background
      ctx.drawImage(videoB!, 0, 0, W, H);

      if (hasA) {
        // Source A is PiP in a corner
        const rect = computePipRect(
          W,
          H,
          config.pipSize ?? 0.28,
          config.pipPosition ?? 'bottom-right',
        );
        // Rounded clip for the PiP bubble
        const radius = 8;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(rect.x + radius, rect.y);
        ctx.lineTo(rect.x + rect.w - radius, rect.y);
        ctx.quadraticCurveTo(rect.x + rect.w, rect.y, rect.x + rect.w, rect.y + radius);
        ctx.lineTo(rect.x + rect.w, rect.y + rect.h - radius);
        ctx.quadraticCurveTo(
          rect.x + rect.w,
          rect.y + rect.h,
          rect.x + rect.w - radius,
          rect.y + rect.h,
        );
        ctx.lineTo(rect.x + radius, rect.y + rect.h);
        ctx.quadraticCurveTo(rect.x, rect.y + rect.h, rect.x, rect.y + rect.h - radius);
        ctx.lineTo(rect.x, rect.y + radius);
        ctx.quadraticCurveTo(rect.x, rect.y, rect.x + radius, rect.y);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(videoA!, rect.x, rect.y, rect.w, rect.h);
        ctx.restore();
      }
    } else {
      // maskMode === 'none' — show Source A only (or B as fallback if A absent)
      const primary = hasA ? videoA : hasB ? videoB : null;
      if (primary) {
        ctx.drawImage(primary, 0, 0, W, H);
      } else {
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, W, H);
      }
    }

    animationId = requestAnimationFrame(tick);
  };

  const getState = () => state;

  const getCanvas = () => canvas;

  const getOutputStream = () => outputStream;

  const start = async (
    sourceA: MediaStream,
    sourceB: MediaStream | null,
    nextConfig: CompositorConfig,
  ) => {
    stop();

    config = { pipSize: 0.28, pipPosition: 'bottom-right', ...nextConfig };
    streamA = sourceA;
    streamB = sourceB;

    videoA = createVideoElement(sourceA);
    await videoA.play().catch(() => undefined);

    if (sourceB) {
      videoB = createVideoElement(sourceB);
      await videoB.play().catch(() => undefined);
    }

    // canvas.captureStream gives us a live MediaStream from the canvas
    outputStream = canvas.captureStream(COMPOSITOR_FPS);
    state = 'running';
    tick();
  };

  const updateConfig = (nextConfig: CompositorConfig) => {
    config = { ...config, ...nextConfig };
  };

  const stop = () => {
    state = 'idle';
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = 0;
    }
    stopVideos();
    streamA = null;
    streamB = null;
    // We intentionally keep outputStream alive so callers can inspect it,
    // but stop all its tracks so the LiveKit track becomes ended.
    if (outputStream) {
      outputStream.getTracks().forEach((t) => t.stop());
      outputStream = null;
    }
  };

  const teardown = () => {
    stop();
    // nothing else to release for a plain canvas compositor
  };

  return { getState, getCanvas, getOutputStream, start, updateConfig, stop, teardown };
};
