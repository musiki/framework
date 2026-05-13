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

const BAR_LEN = 8;
const LUFS_HISTORY_LEN = 40;

export function hzToNote(hz: number): string {
  if (hz <= 0) return '---';
  const midi = Math.round(12 * Math.log2(hz / 440) + 69);
  const octave = Math.floor(midi / 12) - 1;
  return NOTE_NAMES[midi % 12] + octave;
}

function miniBar(value: number, min: number, max: number): string {
  const norm = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const filled = Math.round(norm * BAR_LEN);
  return '█'.repeat(filled) + '░'.repeat(BAR_LEN - filled);
}

function lufsToChar(lufs: number): string {
  if (lufs < -40) return '_';
  if (lufs < -24) return '.';
  if (lufs < -14) return '-';
  return '‾';
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

// Tooltip content for SA descriptors (4-layer structure)
const SA_TIPS: Record<string, { formula: string; body: string; example: string; credit: string }> = {
  pitch: {
    formula: 'f₀ via YIN: d′(τ)=1−2/(W·d(τ))·∑[xⱼ−xⱼ₊τ]²',
    body: 'YIN calcula la diferencia cuadrática entre la señal y su versión retrasada τ, normalizada para evitar falsos mínimos en armónicos.',
    example: 'La4 (440 Hz) → mínimo en τ≈2.27ms. Con ruido, puede reportar el doble (octave error).',
    credit: 'De Cheveigné & Kawahara, 2002, IRCAM/ATR Japan',
  },
  dBFS: {
    formula: 'L = 20·log₁₀(√(1/N·∑x[n]²))',
    body: 'RMS de una ventana de N muestras convertido a dB. Cada 6 dB equivale a duplicar la amplitud.',
    example: '-6 dBFS = mitad de amplitud que 0 dBFS. Conversación normal ≈ 60 dB SPL.',
    credit: 'Escala dB: A.G. Bell 1920s. RMS digital: AES17 1998',
  },
  lufs_m: {
    formula: 'Lₖ = −0.691 + 10·log₁₀(∑ Gᵢ·z̄ᵢ²) · ventana 400ms',
    body: 'ITU-R BS.1770: filtro K-weighting + promedio sobre 400ms (momentáneo). Mide loudness percibido.',
    example: 'Spotify normaliza a −14 LUFS I. Pista "loudness war" ≈ −6 LUFS I.',
    credit: 'Lund & Camerer, 2006, ITU-R / EBU R128',
  },
  lufs_s: {
    formula: 'Lₖ ventana 3s (short-term)',
    body: 'Misma fórmula BS.1770 pero promediando sobre 3 segundos. Más estable que momentáneo.',
    example: 'Útil para monitorear loudness de frases musicales completas.',
    credit: 'ITU-R BS.1770-4',
  },
  lufs_i: {
    formula: 'Lₖ integrado (gating −10 LUFS relativo)',
    body: 'Promedio sobre toda la pieza, ignorando frames muy silenciosos (gating). Es el valor de referencia para normalización de streaming.',
    example: 'Una canción pop bien mastered: ≈ −8 a −10 LUFS I.',
    credit: 'ITU-R BS.1770-4 / EBU R128',
  },
  centroid: {
    formula: 'C = ∑(fₖ·|X[k]|) / ∑|X[k]|',
    body: 'Centro de masa del espectro. Correlaciona con la percepción de "brillo": sube en ataques agudos, baja al decaer los armónicos.',
    example: 'Violín fortissimo agudo: 4-6 kHz. Contrabajo en arco: 300-800 Hz.',
    credit: 'Grey & Gordon, 1978, Stanford CCRMA',
  },
  spread: {
    formula: 'S = √(∑(fₖ−C)²·|X[k]| / ∑|X[k]|)',
    body: 'Desviación estándar del espectro respecto al centroide. Alto = energía distribuida (complejo/ruidoso). Bajo = sonido tonal.',
    example: 'Acorde de piano: spread alto. Flauta en registro medio: spread bajo.',
    credit: 'Peeters et al., 2004, IRCAM',
  },
  skewness: {
    formula: 'Sk = ∑(fₖ−C)³·|X[k]| / (S³·∑|X[k]|)',
    body: 'Tercer momento: asimetría del espectro. Positivo = energía en graves con cola en agudos. Negativo = peso en agudos.',
    example: 'Bajo con distorsión: positivo. Hi-hat: negativo.',
    credit: 'Peeters et al., 2004, IRCAM',
  },
  kurtosis: {
    formula: 'K = ∑(fₖ−C)⁴·|X[k]| / (S⁴·∑|X[k]|)',
    body: 'Cuarto momento: "picudez" del espectro. Alto = picos armónicos nítidos. Bajo = espectro plano.',
    example: 'Flauta con vibrato: kurtosis alta. Ruido blanco: K=3 (normal).',
    credit: 'Peeters et al., 2004, IRCAM',
  },
  slope: {
    formula: 'Sl = ∑(fₖ−f̄)(|X[k]|−|X̄|) / ∑(fₖ−f̄)²',
    body: 'Pendiente de la regresión lineal del espectro. Más negativo = decaimiento rápido con frecuencia = sonido más oscuro.',
    example: 'Voz grave operática: muy negativo. Violín sul ponticello: menos negativo.',
    credit: 'Dubnov 1996; Peeters 2004, IRCAM',
  },
  flux: {
    formula: 'Fₜ = ∑(max(|Xₜ[k]|−|Xₜ₋₁[k]|, 0))²',
    body: 'Cambio positivo del espectro entre frames: detecta ataques y onsets. Pica cuando un instrumento empieza a sonar.',
    example: 'Alto en cada ataque de piano o golpe de percusión. Casi cero en nota sostenida de flauta.',
    credit: 'Scheirer & Slaney, 1997, MIT Media Lab',
  },
  HNR: {
    formula: 'HNR = 10·log₁₀(E_arm / (E_total − E_arm))',
    body: 'Ratio entre energía armónica (periódica) y ruido residual (aperiódico). Alto = sonido periódico, limpio.',
    example: 'Voz cantada "ahhh": 20-30 dB. Voz susurrada: 0-5 dB. Violín en arco: ~25 dB.',
    credit: 'Yumoto, Gould & Baer, 1982, U. of Wisconsin',
  },
  ZCR: {
    formula: 'ZCR = 1/N·∑|sgn(x[n])−sgn(x[n−1])|',
    body: 'Cruces por cero por unidad de tiempo. Tonales = ZCR prop. a frecuencia. Ruidosos/percusivos = ZCR alto e irregular.',
    example: 'Sinusoide 440 Hz: ZCR≈0.02. Ruido blanco: ZCR≈0.5. Fricativas (/s/,/f/): ZCR alto.',
    credit: 'Rabiner & Schafer, 1978, Bell Labs',
  },
  'T1/T2/T3': {
    formula: 'T₁=A₁/∑Aₕ; T₂=(A₂+A₃+A₄)/∑Aₕ; T₃=∑(h≥5)Aₕ/∑Aₕ',
    body: 'Análogo tímbrico del RGB: fundamental (T1), 2°-4° armónicos (T2), resto (T3). T1 alto=hueco/flauta; T3 alto=rico/brillante.',
    example: 'Flauta: T1 alto. Oboe: T2 alto. Violín forte: T3 alto.',
    credit: 'Pollard & Jansson, 1982, KTH Royal Institute of Technology',
  },
};

function tipAttr(key: string): string {
  const t = SA_TIPS[key];
  if (!t) return '';
  const esc = (s: string) => s.replace(/"/g, '&quot;');
  return ` data-sa-tip="${esc(key)}" title="${esc(t.formula)} — ${esc(t.body)}"`;
}

export function renderTextView(el: HTMLElement, r: SAResults, history: number[] = []): void {
  const pitchClass = r.pitch > 50 ? 'ok' : 'dim';
  const dbCls = dbColor(r.rmsDb);
  const mCls = lufsColor(r.lufsM);
  const sCls = lufsColor(r.lufsS);
  const iCls = lufsColor(r.lufsI);

  const envelope = history.slice(-LUFS_HISTORY_LEN).map(v => lufsToChar(v)).join('');
  const padding = ' '.repeat(Math.max(0, LUFS_HISTORY_LEN - envelope.length));

  el.innerHTML = [
    `<span class="sa-key"${tipAttr('pitch')}>pitch    </span><span class="sa-dim">·</span> <span class="sa-${pitchClass}">${pad(fmt(r.pitch, 1), 8)} Hz</span>  <span class="sa-dim">${r.pitchNote}</span>`,
    `<span class="sa-key"${tipAttr('dBFS')}>dBFS     </span><span class="sa-dim">·</span> <span class="sa-${dbCls}">${pad(fmt(r.rmsDb, 1), 8)} dBFS</span>`,
    `<span class="sa-key"${tipAttr('lufs_m')}>lufs_m   </span><span class="sa-dim">·</span> <span class="sa-${mCls}">${pad(fmt(r.lufsM, 1), 8)} LUFS</span>`,
    `<span class="sa-key"${tipAttr('lufs_s')}>lufs_s   </span><span class="sa-dim">·</span> <span class="sa-${sCls}">${pad(fmt(r.lufsS, 1), 8)} LUFS</span>`,
    `<span class="sa-key"${tipAttr('lufs_i')}>lufs_i   </span><span class="sa-dim">·</span> <span class="sa-${iCls}">${pad(fmt(r.lufsI, 1), 8)} LUFS</span>`,
    `<span class="sa-history">${padding}${envelope}</span>`,
    `<span class="sa-dim">─────────────────────────</span>`,
    `<span class="sa-key"${tipAttr('centroid')}>centroid </span><span class="sa-dim">${miniBar(r.centroid, 0, 8000)}</span> <span class="sa-val">${pad(fmt(r.centroid, 0), 5)} Hz</span>`,
    `<span class="sa-key"${tipAttr('spread')}>spread   </span><span class="sa-dim">${miniBar(r.spread, 0, 4000)}</span> <span class="sa-val">${pad(fmt(r.spread, 0), 5)} Hz</span>`,
    `<span class="sa-key"${tipAttr('skewness')}>skewness </span><span class="sa-dim">${miniBar(r.skewness, -3, 3)}</span> <span class="sa-val">${pad(fmt(r.skewness, 3), 7)}</span>`,
    `<span class="sa-key"${tipAttr('kurtosis')}>kurtosis </span><span class="sa-dim">${miniBar(r.kurtosis, 0, 20)}</span> <span class="sa-val">${pad(fmt(r.kurtosis, 3), 7)}</span>`,
    `<span class="sa-key"${tipAttr('slope')}>slope    </span><span class="sa-dim">${miniBar(r.slope + 0.05, 0, 0.1)}</span> <span class="sa-val">${pad(fmt(r.slope, 4), 7)}</span>`,
    `<span class="sa-key"${tipAttr('flux')}>flux     </span><span class="sa-dim">${miniBar(r.flux, 0, 1)}</span> <span class="sa-val">${pad(fmt(r.flux, 3), 7)}</span>`,
    `<span class="sa-key"${tipAttr('HNR')}>HNR      </span><span class="sa-dim">${miniBar(r.hnr, -20, 40)}</span> <span class="sa-val">${pad(fmt(r.hnr, 1), 5)} dB</span>`,
    `<span class="sa-key"${tipAttr('ZCR')}>ZCR      </span><span class="sa-dim">·</span> <span class="sa-val">${pad(fmt(r.zcr, 4), 8)}</span>`,
    `<span class="sa-key"${tipAttr('T1/T2/T3')}>T1/T2/T3 </span><span class="sa-val">${fmt(r.tristimulus[0],2)} / ${fmt(r.tristimulus[1],2)} / ${fmt(r.tristimulus[2],2)}</span>`,
  ].join('\n');
}
