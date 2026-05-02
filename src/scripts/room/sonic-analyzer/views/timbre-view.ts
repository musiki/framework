import type { SAResults } from './text-view';

const BAR_CHARS = '░▒▓█';
const BAR_LEN = 8;

function miniBar(value: number, min: number, max: number): string {
  const norm = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const filled = Math.round(norm * BAR_LEN);
  return '█'.repeat(filled) + '░'.repeat(BAR_LEN - filled);
}

function mfccBar(coef: number): string {
  const norm = Math.max(0, Math.min(1, (coef + 100) / 200));
  const idx = Math.floor(norm * (BAR_CHARS.length - 1));
  return BAR_CHARS[idx];
}

export function renderTimbreView(el: HTMLElement, r: SAResults): void {
  const mfccRow = r.mfcc.map(c => mfccBar(c)).join('');
  const mfccVals = r.mfcc.map(c => (c >= 0 ? ' ' : '') + c.toFixed(0)).join('·');

  el.innerHTML = [
    `<span class="sa-key">centroid </span><span class="sa-dim">${miniBar(r.centroid, 0, 8000)}</span>  <span class="sa-val">${r.centroid.toFixed(0).padStart(5)} Hz</span>`,
    `<span class="sa-key">spread   </span><span class="sa-dim">${miniBar(r.spread, 0, 4000)}</span>  <span class="sa-val">${r.spread.toFixed(0).padStart(5)} Hz</span>`,
    `<span class="sa-key">skewness </span><span class="sa-dim">${miniBar(r.skewness, -3, 3)}</span>  <span class="sa-val">${r.skewness.toFixed(3).padStart(7)}</span>`,
    `<span class="sa-key">kurtosis </span><span class="sa-dim">${miniBar(r.kurtosis, 0, 20)}</span>  <span class="sa-val">${r.kurtosis.toFixed(3).padStart(7)}</span>`,
    `<span class="sa-key">slope    </span><span class="sa-dim">${miniBar(r.slope + 0.05, 0, 0.1)}</span>  <span class="sa-val">${r.slope.toFixed(4).padStart(7)}</span>`,
    `<span class="sa-key">flux     </span><span class="sa-dim">${miniBar(r.flux, 0, 1)}</span>  <span class="sa-val">${r.flux.toFixed(3).padStart(7)}</span>`,
    `<span class="sa-key">HNR      </span><span class="sa-dim">${miniBar(r.hnr, -20, 40)}</span>  <span class="sa-val">${r.hnr.toFixed(1).padStart(5)} dB</span>`,
    `<span class="sa-key">T1/2/3   </span><span class="sa-val">${r.tristimulus[0].toFixed(2)} / ${r.tristimulus[1].toFixed(2)} / ${r.tristimulus[2].toFixed(2)}</span>`,
    `<span class="sa-dim">─────────────────────────</span>`,
    `<span class="sa-key">MFCC     </span><span class="sa-dim">${mfccRow}</span>`,
    `<span class="sa-dim">         </span><span class="sa-val" style="font-size:0.6em">${mfccVals}</span>`,
  ].join('\n');
}
