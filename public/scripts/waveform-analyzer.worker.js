// public/scripts/waveform-analyzer.worker.js
'use strict';

const FFT_SIZE = 2048;
const HALF_FFT = FFT_SIZE >> 1;

// ─── Iterative Cooley-Tukey FFT (in-place, radix-2) ──────────────────────────
function fft(re, im) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let curRe = 1, curIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const u = i + k, v = i + k + half;
        const vRe = re[v] * curRe - im[v] * curIm;
        const vIm = re[v] * curIm + im[v] * curRe;
        re[v] = re[u] - vRe; im[v] = im[u] - vIm;
        re[u] += vRe; im[u] += vIm;
        const tmp = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe; curRe = tmp;
      }
    }
  }
}

// ─── Hann window ─────────────────────────────────────────────────────────────
const HANN = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) HANN[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (FFT_SIZE - 1)));

// ─── Colormap: dark → blue → cyan → yellow → white ───────────────────────────
function colormap(v) {
  const t = Math.max(0, Math.min(1, v));
  const r = Math.round(Math.min(255, Math.max(0, t < 0.5 ? 0 : (t - 0.5) * 4 * 200 + 55)));
  const g = Math.round(Math.min(255, Math.max(0, t < 0.25 ? 0 : (t - 0.25) * 4 * 200)));
  const b = Math.round(Math.min(255, Math.max(0, t < 0.5 ? t * 2 * 255 : (1 - (t - 0.5) * 2) * 255)));
  return [r, g, b];
}

// ─── Spectrogram → Uint8ClampedArray (RGBA, width × height) ──────────────────
function buildSpectrogram(channelData, width, height) {
  const total   = channelData.length;
  const hopSize = Math.max(1, Math.floor(total / width));
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);

  const frames = [];
  let maxMag = 1e-10;
  for (let col = 0; col < width; col++) {
    const offset = col * hopSize;
    re.fill(0); im.fill(0);
    for (let k = 0; k < FFT_SIZE; k++) {
      const idx = offset + k;
      re[k] = idx < total ? channelData[idx] * HANN[k] : 0;
    }
    fft(re, im);
    const frame = new Float32Array(HALF_FFT);
    for (let k = 0; k < HALF_FFT; k++) {
      frame[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      if (frame[k] > maxMag) maxMag = frame[k];
    }
    frames.push(frame);
  }

  // Top row = high freq, bottom = low freq; quadratic bin mapping for log-like scale
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let col = 0; col < width; col++) {
    const frame = frames[col];
    for (let row = 0; row < height; row++) {
      const frac   = 1 - row / height;
      const binIdx = Math.min(HALF_FFT - 1, Math.floor(frac * frac * HALF_FFT));
      const mag    = frame[binIdx] / maxMag;
      const db     = Math.max(0, 1 + Math.log10(Math.max(1e-6, mag)) / 4);
      const [r, g, b] = colormap(db);
      const px = (row * width + col) * 4;
      pixels[px] = r; pixels[px + 1] = g; pixels[px + 2] = b; pixels[px + 3] = 255;
    }
  }
  return pixels;
}

// ─── Feature curves (128 normalized points each) ─────────────────────────────
function computeFeatures(channelData, sampleRate, nPoints) {
  const total      = channelData.length;
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const freqPerBin = sampleRate / FFT_SIZE;
  const cutoffBin  = Math.min(HALF_FFT - 1, Math.floor(500 / freqPerBin));

  const rawEnergy  = new Float32Array(nPoints);
  const rawBright  = new Float32Array(nPoints);
  const rawMotion  = new Float32Array(nPoints);
  const rawGravity = new Float32Array(nPoints);
  let prevMags = new Float32Array(HALF_FFT);

  for (let i = 0; i < nPoints; i++) {
    const offset  = Math.floor((i / nPoints) * total);
    const frameEnd = Math.min(total, offset + FFT_SIZE);
    re.fill(0); im.fill(0);
    for (let k = 0; k < FFT_SIZE; k++) {
      const idx = offset + k;
      re[k] = idx < total ? channelData[idx] * HANN[k] : 0;
    }
    fft(re, im);

    const mags = new Float32Array(HALF_FFT);
    let totalMag = 0, weightedFreq = 0, lowMag = 0, rms = 0;
    for (let k = 0; k < HALF_FFT; k++) {
      mags[k]       = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      totalMag     += mags[k];
      weightedFreq += mags[k] * k * freqPerBin;
      if (k <= cutoffBin) lowMag += mags[k];
    }

    for (let k = offset; k < frameEnd; k++) rms += channelData[k] * channelData[k];
    rawEnergy[i]  = Math.sqrt(rms / (frameEnd - offset));
    rawBright[i]  = totalMag > 0 ? (weightedFreq / totalMag) / (sampleRate / 2) : 0;

    let flux = 0;
    for (let k = 0; k < HALF_FFT; k++) {
      const diff = mags[k] - prevMags[k];
      if (diff > 0) flux += diff;
    }
    rawMotion[i]  = flux;
    rawGravity[i] = totalMag > 0 ? lowMag / totalMag : 0;
    prevMags = mags;
  }

  const normalize = (arr) => {
    let mn = Infinity, mx = -Infinity;
    for (const v of arr) { if (v < mn) mn = v; if (v > mx) mx = v; }
    const range = mx - mn || 1;
    return Array.from(arr, v => (v - mn) / range);
  };

  const energy     = normalize(rawEnergy);
  const brightness = normalize(rawBright);
  const motion     = normalize(rawMotion);
  const gravity    = Array.from(rawGravity);
  const tension    = energy.map((e, i) =>
    Math.max(0, Math.min(1, 0.4 * motion[i] + 0.4 * brightness[i] + 0.2 * (1 - gravity[i]))));

  return { energy, brightness, motion, gravity, tension };
}

// ─── Segment detection ────────────────────────────────────────────────────────
function detectSegments(features) {
  const { energy, brightness, motion, gravity, tension } = features;
  const n      = energy.length;
  const minLen = Math.max(3, Math.floor(n * 0.05));
  const eMean  = energy.reduce((a, b) => a + b, 0) / n;
  const mMean  = motion.reduce((a, b) => a + b, 0) / n;
  const boundaries = [0];

  for (let i = 2; i < n - 2; i++) {
    const trough = energy[i] < energy[i-1] && energy[i] < energy[i+1] && energy[i] < eMean * 0.7;
    const peak   = motion[i] > mMean * 1.5  && motion[i] > motion[i-1] && motion[i] > motion[i+1];
    if ((trough || peak) && i - boundaries[boundaries.length - 1] >= minLen) {
      boundaries.push(i);
    }
  }
  boundaries.push(n);

  return boundaries.slice(0, -1).map((start, s) => {
    const end  = boundaries[s + 1];
    const sl   = (arr) => arr.slice(start, end);
    const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    return {
      startRatio: start / n,
      endRatio:   end   / n,
      energy:     mean(sl(energy)),
      brightness: mean(sl(brightness)),
      motion:     mean(sl(motion)),
      gravity:    mean(sl(gravity)),
      tension:    mean(sl(tension)),
    };
  });
}

// ─── Entry point ──────────────────────────────────────────────────────────────
self.onmessage = (e) => {
  const { channelData, width, height, sampleRate, duration, requestId } = e.data;
  const pixelData = buildSpectrogram(channelData, width, height);
  const formData  = computeFeatures(channelData, sampleRate, 128);
  formData.segments = detectSegments(formData);
  self.postMessage({ pixelData, width, height, requestId, formData }, [pixelData.buffer]);
};
