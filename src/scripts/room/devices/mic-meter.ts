import { normalizeText } from '../core/normalize';

type CreateRoomMicMeterControllerOptions = {
  micMeter?: HTMLElement | null;
};

export type RoomMicMeterController = {
  start: (track: MediaStreamTrack) => Promise<void>;
  stop: () => void;
  teardown: () => void;
};

export const createRoomMicMeterController = ({
  micMeter,
}: CreateRoomMicMeterControllerOptions): RoomMicMeterController => {
  let micMeterAnimationId = 0;
  let micMeterAudioContext: AudioContext | null = null;
  let micMeterAnalyser: AnalyserNode | null = null;
  let micMeterData: Uint8Array<ArrayBuffer> | null = null;
  let micMeterSource: MediaStreamAudioSourceNode | null = null;
  let micMeterTrackId = '';
  let micMeterGeneration = 0;

  const setMicMeterLevel = (level: number) => {
    if (!(micMeter instanceof HTMLElement)) return;
    const normalizedLevel = Math.max(0, Math.min(1, level));
    micMeter.style.setProperty('--conference-mic-level', normalizedLevel.toFixed(3));
  };

  const closeMicMeterAudioContext = () => {
    if (!micMeterAudioContext) return;
    if (micMeterAudioContext.state !== 'closed') {
      void micMeterAudioContext.close().catch(() => undefined);
    }
    micMeterAudioContext = null;
  };

  const stop = () => {
    micMeterGeneration += 1;

    if (micMeterAnimationId) {
      window.cancelAnimationFrame(micMeterAnimationId);
      micMeterAnimationId = 0;
    }

    if (micMeterSource) {
      try {
        micMeterSource.disconnect();
      } catch {
        // ignore disconnected nodes
      }
      micMeterSource = null;
    }

    if (micMeterAnalyser) {
      try {
        micMeterAnalyser.disconnect();
      } catch {
        // ignore disconnected nodes
      }
      micMeterAnalyser = null;
    }

    micMeterData = null;
    micMeterTrackId = '';
    setMicMeterLevel(0);

    if (micMeter instanceof HTMLElement) {
      micMeter.hidden = true;
    }
  };

  const start = async (track: MediaStreamTrack) => {
    if (!(micMeter instanceof HTMLElement)) return;

    const trackId = normalizeText(track.id);
    if (
      trackId &&
      micMeterTrackId === trackId &&
      micMeterAudioContext &&
      micMeterAnalyser &&
      micMeterData
    ) {
      micMeter.hidden = false;
      return;
    }

    const nextGeneration = micMeterGeneration + 1;
    stop();
    micMeterGeneration = nextGeneration;

    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextCtor) return;

    if (!micMeterAudioContext || micMeterAudioContext.state === 'closed') {
      micMeterAudioContext = new AudioContextCtor();
    }

    const audioContext = micMeterAudioContext;

    if (audioContext.state !== 'running') {
      await audioContext.resume().catch(() => undefined);
    }

    if (
      nextGeneration !== micMeterGeneration ||
      audioContext.state !== 'running' ||
      track.readyState !== 'live'
    ) {
      return;
    }

    let analyser: AnalyserNode;
    let source: MediaStreamAudioSourceNode;

    try {
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;

      source = audioContext.createMediaStreamSource(new MediaStream([track]));
      source.connect(analyser);
    } catch {
      stop();
      return;
    }

    if (nextGeneration !== micMeterGeneration || audioContext.state !== 'running') {
      try {
        source.disconnect();
      } catch {
        // ignore disconnected nodes
      }
      try {
        analyser.disconnect();
      } catch {
        // ignore disconnected nodes
      }
      return;
    }

    micMeterSource = source;
    micMeterAnalyser = analyser;
    micMeterData = new Uint8Array(new ArrayBuffer(analyser.fftSize)) as Uint8Array<ArrayBuffer>;
    micMeterTrackId = trackId;
    micMeter.hidden = false;

    const tick = () => {
      if (!micMeterAnalyser || !micMeterData) return;
      micMeterAnalyser.getByteTimeDomainData(micMeterData);

      let sum = 0;
      for (let index = 0; index < micMeterData.length; index += 1) {
        const normalizedSample = (micMeterData[index] - 128) / 128;
        sum += normalizedSample * normalizedSample;
      }

      const rms = Math.sqrt(sum / micMeterData.length);
      setMicMeterLevel(Math.min(1, rms * 4.5));
      micMeterAnimationId = window.requestAnimationFrame(tick);
    };

    tick();
  };

  return {
    start,
    stop,
    teardown() {
      stop();
      closeMicMeterAudioContext();
    },
  };
};
