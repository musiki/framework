const BARS = ' ▁▂▃▄▅▆▇█';

function magnitudeToBin(db: number, minDb = -80, maxDb = 0): number {
  const normalized = Math.max(0, Math.min(1, (db - minDb) / (maxDb - minDb)));
  return Math.floor(normalized * (BARS.length - 1));
}

export function renderSpectrumView(el: HTMLElement, freqData: Float32Array): void {
  const totalBins = freqData.length;
  const displayBins = 64;
  const step = Math.max(1, Math.floor(totalBins / displayBins));

  let bars = '';
  for (let i = 0; i < displayBins; i++) {
    const db = freqData[Math.min(i * step, totalBins - 1)];
    bars += BARS[magnitudeToBin(db)];
  }

  const nyquist = 24000;
  el.innerHTML =
    `<span class="sa-bars">${bars}</span>\n` +
    `<span class="sa-dim">20Hz${' '.repeat(displayBins - 12)}${Math.round(nyquist / 1000)}kHz</span>`;
}
