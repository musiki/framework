function saColor(norm: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, norm));
  if (t < 0.5) {
    const v = t * 2;
    return [0, Math.round(v * 211), Math.round(v * 80)];
  }
  const v = (t - 0.5) * 2;
  return [Math.round(v * 200), Math.round(211 + v * 44), Math.round(80 + v * 175)];
}

export function renderHeatmap(canvas: HTMLCanvasElement, data: number[][], flipY = true): void {
  if (!data.length || !data[0].length) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.max(1, canvas.clientWidth);
  const cssH = Math.max(1, canvas.clientHeight);
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d')!;
  const frames = data.length;
  const bins   = data[0].length;

  let min = Infinity, max = -Infinity;
  for (const f of data) for (const v of f) { if (v < min) min = v; if (v > max) max = v; }
  const range = max - min || 1;

  const W = Math.round(cssW * dpr);
  const H = Math.round(cssH * dpr);
  const img = ctx.createImageData(W, H);

  for (let px = 0; px < W; px++) {
    const fi = Math.min(frames - 1, Math.floor((px / W) * frames));
    for (let py = 0; py < H; py++) {
      const bi = flipY
        ? Math.min(bins - 1, Math.floor(((H - 1 - py) / H) * bins))
        : Math.min(bins - 1, Math.floor((py / H) * bins));
      const norm = (data[fi][bi] - min) / range;
      const [r, g, b] = saColor(norm);
      const idx = (py * W + px) * 4;
      img.data[idx] = r; img.data[idx+1] = g; img.data[idx+2] = b; img.data[idx+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function renderPitchContour(canvas: HTMLCanvasElement, pitches: number[]): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.max(1, canvas.clientWidth);
  const cssH = Math.max(1, canvas.clientHeight);
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const logMin = Math.log(40), logMax = Math.log(2000);
  ctx.strokeStyle = '#45D384';
  ctx.lineWidth = 1;
  ctx.beginPath();
  let moved = false;
  pitches.forEach((hz, i) => {
    if (hz < 40) { moved = false; return; }
    const x = (i / pitches.length) * cssW;
    const norm = Math.max(0, Math.min(1, (Math.log(hz) - logMin) / (logMax - logMin)));
    const y = (1 - norm) * cssH;
    if (!moved) { ctx.moveTo(x, y); moved = true; } else ctx.lineTo(x, y);
  });
  ctx.stroke();
}
