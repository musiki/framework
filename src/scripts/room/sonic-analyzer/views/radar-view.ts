import type { SAResults } from './text-view';

const KEYS = ['pitch','dBFS','cntrd','sprd','skew','kurt','slope','flux','HNR','ZCR'] as const;
const RANGES: Record<string, [number, number]> = {
  pitch: [40, 2000], dBFS: [-80, 0], cntrd: [0, 10000], sprd: [0, 8000],
  skew: [-5, 5], kurt: [0, 50], slope: [-0.01, 0.01], flux: [0, 1],
  HNR: [-10, 40], ZCR: [0, 0.5],
};

function normValue(key: string, val: number): number {
  const [min, max] = RANGES[key];
  if (key === 'pitch') {
    const v = Math.max(min, Math.min(max, val));
    return (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min));
  }
  return Math.max(0, Math.min(1, (val - min) / (max - min)));
}

export function drawRadar(canvas: HTMLCanvasElement, r: SAResults): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 140;
  const cssH = canvas.clientHeight || 140;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const values: Record<string, number> = {
    pitch: r.pitch, dBFS: r.rmsDb, cntrd: r.centroid, sprd: r.spread,
    skew: r.skewness, kurt: r.kurtosis, slope: r.slope, flux: r.flux,
    HNR: r.hnr, ZCR: r.zcr,
  };

  const norms = KEYS.map(k => normValue(k, values[k]));
  const avgNorm = norms.reduce((a, b) => a + b, 0) / norms.length;

  // HSL hue: 190 (cyan-teal) at low → 30 (amber) at high
  const hue = 190 - avgNorm * 160;
  const colorStroke = `hsl(${hue}, 90%, 65%)`;

  const cx = cssW / 2, cy = cssH / 2;
  const radius = Math.min(cssW, cssH) * 0.32;
  const labelR  = radius + 16;
  const n       = KEYS.length;
  const step    = (Math.PI * 2) / n;
  const start   = -Math.PI / 2;

  ctx.clearRect(0, 0, cssW, cssH);

  // Grid rings
  for (let l = 1; l <= 4; l++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (radius * l) / 4, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Axes + labels
  ctx.font = `${Math.floor(cssW * 0.066)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  KEYS.forEach((key, i) => {
    const a = start + i * step;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(137,180,250,0.55)';
    ctx.fillText(key, cx + Math.cos(a) * labelR, cy + Math.sin(a) * labelR);
  });

  // Build polygon path
  ctx.beginPath();
  KEYS.forEach((key, i) => {
    const a = start + i * step;
    const norm = norms[i];
    const px = cx + Math.cos(a) * norm * radius;
    const py = cy + Math.sin(a) * norm * radius;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  });
  ctx.closePath();

  // Radial HSL gradient fill
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  grad.addColorStop(0,   `hsla(${hue}, 60%, 40%, 0.04)`);
  grad.addColorStop(0.6, `hsla(${hue}, 80%, 55%, 0.14)`);
  grad.addColorStop(1,   `hsla(${hue}, 90%, 65%, 0.30)`);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = colorStroke;
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  // Dots
  KEYS.forEach((key, i) => {
    const a = start + i * step;
    const norm = norms[i];
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * norm * radius, cy + Math.sin(a) * norm * radius, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = colorStroke;
    ctx.fill();
  });
}
