// Canvas drawing: static waveforms, live recording meter, and the comparison chart.

export function cssVar(name, fallback = '#888') {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// null when the canvas has no layout (hidden, or in a folded card): nothing can be drawn,
// and sizing it from its own pixel width would multiply it by the device-pixel ratio on
// every draw until its buffers can no longer be allocated.
export function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  if (!canvas.clientWidth) return null;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight || canvas.height / dpr;
  const W = Math.max(1, Math.round(w * dpr));
  const H = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function peaksOf(canvas, samples, cols) {
  const c = canvas._peaks;
  if (c && c.samples === samples && c.cols === cols) return c.data;
  const data = new Float32Array(cols * 2);
  const per = samples.length / cols;
  for (let x = 0; x < cols; x++) {
    const a = Math.floor(x * per);
    const b = Math.min(samples.length, Math.max(a + 1, Math.floor((x + 1) * per)));
    let mn = 1;
    let mx = -1;
    const step = Math.max(1, Math.floor((b - a) / 400));
    for (let i = a; i < b; i += step) { const v = samples[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    data[x * 2] = mn;
    data[x * 2 + 1] = mx;
  }
  canvas._peaks = { samples, cols, data };
  return data;
}

// Static waveform with a played-portion highlight and a cursor line.
export function drawWaveform(canvas, samples, { progress = 0 } = {}) {
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { ctx, w, h } = fit;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = cssVar('--wave-bg');
  roundRect(ctx, 0, 0, w, h, 10);
  ctx.fill();
  if (!samples || !samples.length) return;
  const cols = Math.max(1, Math.floor(w));
  const peaks = peaksOf(canvas, samples, cols);
  let norm = 0;
  for (let x = 0; x < cols; x++) norm = Math.max(norm, Math.abs(peaks[x * 2]), Math.abs(peaks[x * 2 + 1]));
  const scale = norm > 0.02 ? 0.92 / norm : 1;
  const mid = h / 2;
  const played = cssVar('--wave-played');
  const rest = cssVar('--wave-color');
  const cut = Math.round(progress * cols);
  for (let x = 0; x < cols; x++) {
    const mn = peaks[x * 2] * scale;
    const mx = peaks[x * 2 + 1] * scale;
    const y1 = mid - Math.max(mx * mid, 0.6);
    const y2 = mid - Math.min(mn * mid, -0.6);
    ctx.fillStyle = x < cut ? played : rest;
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
  if (progress > 0 && progress <= 1) {
    ctx.fillStyle = played;
    ctx.fillRect(cut, 0, 2, h);
  }
}

// Scrolling bars of recent chunk peaks, newest on the right.
export function drawLiveWave(canvas, peaks) {
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { ctx, w, h } = fit;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = cssVar('--wave-bg');
  roundRect(ctx, 0, 0, w, h, 10);
  ctx.fill();
  const bw = 3;
  const gap = 2;
  const n = Math.floor(w / (bw + gap));
  const start = Math.max(0, peaks.length - n);
  const mid = h / 2;
  ctx.fillStyle = cssVar('--record');
  for (let k = start; k < peaks.length; k++) {
    const x = w - (peaks.length - k) * (bw + gap);
    const p = Math.min(1, peaks[k] * 1.15);
    const hh = Math.max(2, p * (h - 8));
    ctx.fillRect(x, mid - hh / 2, bw, hh);
  }
  ctx.fillStyle = cssVar('--wave-color');
  ctx.fillRect(0, mid, w, 1);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteName = (st) => NOTE_NAMES[((Math.round(st) % 12) + 12) % 12] + (Math.floor(Math.round(st) / 12) - 1);
const fmtTick = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const TYPE_COLORS = { pitch: '--pitch', timing: '--timing', content: '--content', missing: '--missing', extra: '--missing', dynamics: '--dynamics' };

// Sloka vs. heard: pitch contours (heard warped onto sloka time), loudness,
// shaded deviation bands, and two playheads.
export class ComparisonChart {
  constructor(canvas, { onSelect } = {}) {
    this.canvas = canvas;
    this.result = null;
    this.selected = null;
    this.playhead = null;
    this.onSelect = onSelect;
    this.layout = null;
    this.filter = null; // optional predicate: which deviations to shade and make clickable
    canvas.addEventListener('click', (e) => this._click(e));
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.draw());
      this.ro.observe(canvas);
    }
  }

  setResult(result) {
    this.result = result;
    this.selected = null;
    this.playhead = null;
    this.draw();
  }

  select(id) { this.selected = id; this.draw(); }

  setFilter(fn) { this.filter = typeof fn === 'function' ? fn : null; this.draw(); }

  _shown() {
    const all = this.result ? this.result.deviations : [];
    return this.filter ? all.filter(this.filter) : all;
  }

  setPlayhead(which, t) {
    this.playhead = t == null ? null : { which, t };
    this.draw();
  }

  _heardToBase(t) {
    const c = this.result.chart;
    const j = Math.floor(t / c.hopSec);
    const iOf = c.iOf;
    for (let d = 0; d < 200; d++) {
      if (j - d >= 0 && j - d < iOf.length && iOf[j - d] >= 0) return iOf[j - d] * c.hopSec;
      if (j + d < iOf.length && j + d >= 0 && iOf[j + d] >= 0) return iOf[j + d] * c.hopSec;
    }
    return null;
  }

  _click(e) {
    if (!this.result || !this.layout) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const { padL, plotW, T, off } = this.layout;
    const t = off + ((x - padL) / plotW) * T;
    let best = null;
    for (const d of this._shown()) {
      if (t >= d.tBase[0] && t <= d.tBase[1]) {
        if (!best || d.tBase[1] - d.tBase[0] < best.tBase[1] - best.tBase[0]) best = d;
      }
    }
    this.selected = best ? best.id : null;
    this.draw();
    if (this.onSelect) this.onSelect(best ? best.id : null, t);
  }

  draw() {
    const fit = fitCanvas(this.canvas);
    if (!fit) return;
    const { ctx, w, h } = fit;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = cssVar('--chart-bg');
    roundRect(ctx, 0, 0, w, h, 12);
    ctx.fill();
    const res = this.result;
    if (!res) return;
    const c = res.chart;
    const T = Math.max(0.1, res.baseDuration);
    const padL = 46;
    const padR = 14;
    const padT = 12;
    const axisH = 24;
    const gap = 10;
    const plotW = Math.max(10, w - padL - padR);
    const inner = h - padT - axisH - gap;
    const pitchH = Math.round(inner * 0.62);
    const loudH = inner - pitchH;
    const pitchTop = padT;
    const loudTop = padT + pitchH + gap;
    const off = res.baseOffset || 0; // the chart may show a window of a longer sloka
    this.layout = { padL, plotW, T, off };
    const xOf = (t) => padL + ((t - off) / T) * plotW;
    const text = cssVar('--chart-text');
    const grid = cssVar('--chart-grid');
    const baseCol = cssVar('--base');
    const heardCol = cssVar('--heard');
    const laneBg = cssVar('--chart-lane');

    // lanes
    ctx.fillStyle = laneBg;
    roundRect(ctx, padL, pitchTop, plotW, pitchH, 6); ctx.fill();
    roundRect(ctx, padL, loudTop, plotW, loudH, 6); ctx.fill();

    // deviation bands
    for (const d of this._shown()) {
      const x0 = xOf(d.tBase[0]);
      const x1 = Math.max(x0 + 2, xOf(d.tBase[1]));
      const col = cssVar(TYPE_COLORS[d.type] || '--missing');
      const sel = d.id === this.selected;
      ctx.globalAlpha = sel ? 0.34 : 0.16;
      ctx.fillStyle = col;
      ctx.fillRect(x0, pitchTop, x1 - x0, pitchH);
      ctx.fillRect(x0, loudTop, x1 - x0, loudH);
      ctx.globalAlpha = 1;
      if (sel) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.strokeRect(x0 + 1, pitchTop + 1, x1 - x0 - 2, pitchH + gap + loudH - 2);
      }
    }

    // pitch scale
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i < c.bSt.length; i++) {
      const a = c.bSt[i];
      const b = c.hSt[i];
      if (!Number.isNaN(a)) { if (a < mn) mn = a; if (a > mx) mx = a; }
      if (!Number.isNaN(b)) { if (b < mn) mn = b; if (b > mx) mx = b; }
    }
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    if (mn === Infinity) {
      ctx.fillStyle = text;
      ctx.textAlign = 'center';
      ctx.fillText('No steady pitch found', padL + plotW / 2, pitchTop + pitchH / 2);
    } else {
      if (mx - mn < 8) { const mid = (mx + mn) / 2; mn = mid - 4; mx = mid + 4; }
      mn = Math.floor(mn - 1);
      mx = Math.ceil(mx + 1);
      const span = mx - mn;
      const yOf = (st) => pitchTop + ((mx - st) / span) * pitchH;
      const step = span <= 14 ? 1 : span <= 30 ? 2 : span <= 60 ? 5 : 12;
      ctx.textAlign = 'right';
      for (let s = Math.ceil(mn / step) * step; s <= mx; s += step) {
        const y = yOf(s);
        ctx.strokeStyle = grid;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
        if (step >= 2 || s % 2 === 0) { ctx.fillStyle = text; ctx.fillText(noteName(s), padL - 6, y); }
      }
      // clip contours to the lane
      ctx.save();
      ctx.beginPath(); ctx.rect(padL, pitchTop, plotW, pitchH); ctx.clip();
      this._contour(ctx, c.times, c.bSt, xOf, yOf, baseCol, 2.2);
      this._contour(ctx, c.times, c.hSt, xOf, yOf, heardCol, 2.2);
      ctx.restore();
    }

    // loudness lane: -50..0 dB relative to each recording's peak
    const lMin = -50;
    const yL = (v) => loudTop + ((0 - Math.max(lMin, Math.min(0, v))) / -lMin) * loudH;
    ctx.save();
    ctx.beginPath(); ctx.rect(padL, loudTop, plotW, loudH); ctx.clip();
    ctx.beginPath();
    ctx.moveTo(xOf(off), loudTop + loudH);
    for (let i = 0; i < c.bLoud.length; i++) ctx.lineTo(xOf(c.times[i]), yL(c.bLoud[i]));
    ctx.lineTo(xOf(c.times[c.bLoud.length - 1] || 0), loudTop + loudH);
    ctx.closePath();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = baseCol;
    ctx.fill();
    ctx.globalAlpha = 1;
    this._contour(ctx, c.times, c.hLoud, xOf, yL, heardCol, 1.6);
    ctx.restore();

    // lane labels
    ctx.fillStyle = text;
    ctx.textAlign = 'left';
    ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('PITCH', padL + 6, pitchTop + 9);
    ctx.fillText('LOUDNESS', padL + 6, loudTop + 9);

    // time axis
    const tick = T <= 15 ? 1 : T <= 60 ? 5 : T <= 180 ? 10 : T <= 600 ? 30 : 60;
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let s = Math.ceil(off / tick) * tick; s <= off + T; s += tick) {
      const x = xOf(s);
      ctx.strokeStyle = grid;
      ctx.beginPath(); ctx.moveTo(x, loudTop + loudH); ctx.lineTo(x, loudTop + loudH + 4); ctx.stroke();
      ctx.fillStyle = text;
      ctx.fillText(fmtTick(s), x, loudTop + loudH + 7);
    }

    // playhead
    if (this.playhead) {
      const t = this.playhead.which === 'base' ? this.playhead.t : this._heardToBase(this.playhead.t);
      if (t != null && t >= off - 0.05 && t <= off + T + 0.05) {
        const x = xOf(Math.max(off, Math.min(off + T, t)));
        ctx.strokeStyle = this.playhead.which === 'base' ? baseCol : heardCol;
        ctx.lineWidth = 2;
        ctx.setLineDash(this.playhead.which === 'base' ? [] : [5, 4]);
        ctx.beginPath(); ctx.moveTo(x, pitchTop); ctx.lineTo(x, loudTop + loudH); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  _contour(ctx, times, vals, xOf, yOf, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    let pen = false;
    let prev = NaN;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (Number.isNaN(v) || (!Number.isNaN(prev) && Math.abs(v - prev) > 6)) { pen = false; prev = v; continue; }
      const x = xOf(times[i]);
      const y = yOf(v);
      if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
      prev = v;
    }
    ctx.stroke();
  }
}
