export type SAResults = {
  pitch: number;
  pitchNote: string;
  rmsDb: number;
  lufsM: number;
  lufsS: number;
  lufsI: number;
  zcr: number;
  centroid: number;
  spread: number;
  skewness: number;
  kurtosis: number;
  slope: number;
  flux: number;
  tristimulus: [number, number, number];
  hnr: number;
  mfcc: number[];
};

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export function hzToNote(hz: number): string {
  if (hz <= 0) return '---';
  const midi = Math.round(12 * Math.log2(hz / 440) + 69);
  const octave = Math.floor(midi / 12) - 1;
  return NOTE_NAMES[midi % 12] + octave;
}

function dbColor(db: number): string {
  if (db >= -1) return 'clip';
  if (db >= -6) return 'warn';
  return 'ok';
}

function lufsColor(lufs: number): string {
  if (lufs > -9) return 'clip';
  if (lufs > -14) return 'warn';
  return 'ok';
}

function fmt(value: number, decimals = 1): string {
  return value.toFixed(decimals);
}

function pad(str: string, len: number): string {
  return str.padStart(len);
}

export function renderTextView(el: HTMLElement, r: SAResults): void {
  const pitchClass = r.pitch > 50 ? 'ok' : 'dim';
  const dbCls = dbColor(r.rmsDb);
  const lufsClass = lufsColor(r.lufsM);

  el.innerHTML = [
    `<span class="sa-key">pitch    </span><span class="sa-dim">·</span> <span class="sa-${pitchClass}">${pad(fmt(r.pitch, 1), 8)} Hz</span>  <span class="sa-dim">${r.pitchNote}</span>`,
    `<span class="sa-key">dBFS     </span><span class="sa-dim">·</span> <span class="sa-${dbCls}">${pad(fmt(r.rmsDb, 1), 8)} dBFS</span>`,
    `<span class="sa-key">lufs_m   </span><span class="sa-dim">·</span> <span class="sa-${lufsClass}">${pad(fmt(r.lufsM, 1), 8)} LUFS</span>`,
    `<span class="sa-key">lufs_s   </span><span class="sa-dim">·</span> <span class="sa-dim">${pad(fmt(r.lufsS, 1), 8)} LUFS</span>`,
    `<span class="sa-key">lufs_i   </span><span class="sa-dim">·</span> <span class="sa-dim">${pad(fmt(r.lufsI, 1), 8)} LUFS</span>`,
    `<span class="sa-dim">─────────────────────────</span>`,
    `<span class="sa-key">centroid </span><span class="sa-dim">·</span> <span class="sa-val">${pad(fmt(r.centroid, 0), 8)} Hz</span>`,
    `<span class="sa-key">spread   </span><span class="sa-dim">·</span> <span class="sa-val">${pad(fmt(r.spread, 0), 8)} Hz</span>`,
    `<span class="sa-key">skewness </span><span class="sa-dim">·</span> <span class="sa-val">${pad(fmt(r.skewness, 3), 8)}</span>`,
    `<span class="sa-key">kurtosis </span><span class="sa-dim">·</span> <span class="sa-val">${pad(fmt(r.kurtosis, 3), 8)}</span>`,
    `<span class="sa-key">slope    </span><span class="sa-dim">·</span> <span class="sa-val">${pad(fmt(r.slope, 4), 8)}</span>`,
    `<span class="sa-key">flux     </span><span class="sa-dim">·</span> <span class="sa-val">${pad(fmt(r.flux, 3), 8)}</span>`,
    `<span class="sa-key">HNR      </span><span class="sa-dim">·</span> <span class="sa-val">${pad(fmt(r.hnr, 1), 8)} dB</span>`,
    `<span class="sa-key">ZCR      </span><span class="sa-dim">·</span> <span class="sa-val">${pad(fmt(r.zcr, 4), 8)}</span>`,
    `<span class="sa-key">T1/T2/T3 </span><span class="sa-dim">·</span> <span class="sa-val">${fmt(r.tristimulus[0],2)} / ${fmt(r.tristimulus[1],2)} / ${fmt(r.tristimulus[2],2)}</span>`,
  ].join('\n');
}
