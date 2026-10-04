// Synthetic signal generators for DSP tests (all at 16 kHz, mono Float32Array).

export const SR = 16000;

export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function silence(ms) {
  return new Float32Array(Math.round((ms / 1000) * SR));
}

export function concat(...parts) {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Harmonic tone with optional vibrato and short attack/release ramps.
export function tone(freq, ms, opts = {}) {
  const { harmonics = [1, 0.5, 0.3, 0.2], vibratoCents = 0, vibratoHz = 6, attackMs = 20, releaseMs = 20, amp = 0.3 } = opts;
  const n = Math.round((ms / 1000) * SR);
  const out = new Float32Array(n);
  let phase = 0;
  const att = Math.round((attackMs / 1000) * SR);
  const rel = Math.round((releaseMs / 1000) * SR);
  const norm = harmonics.reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = vibratoCents ? freq * Math.pow(2, (vibratoCents / 1200) * Math.sin(2 * Math.PI * vibratoHz * t)) : freq;
    phase += (2 * Math.PI * f) / SR;
    let v = 0;
    for (let h = 0; h < harmonics.length; h++) v += harmonics[h] * Math.sin(phase * (h + 1));
    let env = 1;
    if (i < att) env = i / att;
    if (n - 1 - i < rel) env = Math.min(env, (n - 1 - i) / rel);
    out[i] = (amp * env * v) / norm;
  }
  return out;
}

// Sequence of notes (MIDI numbers, or null for a rest) with gaps between them.
export function melody(notes, noteMs, gapMs = 0, opts = {}) {
  const parts = [];
  for (const m of notes) {
    parts.push(m === null ? silence(noteMs) : tone(midiToHz(m), noteMs, opts));
    if (gapMs) parts.push(silence(gapMs));
  }
  return concat(...parts);
}

// Time-stretch segments of a signal by resampling (pitch changes too, which is
// fine for timing tests where we compare against the unstretched original).
// segments: [{ from: sec, to: sec, ratio }] — ratio > 1 makes the segment longer.
export function timeWarp(signal, segments) {
  const parts = [];
  let cursor = 0;
  const sorted = [...segments].sort((a, b) => a.from - b.from);
  for (const seg of sorted) {
    const a = Math.round(seg.from * SR);
    const b = Math.round(seg.to * SR);
    if (a > cursor) parts.push(signal.subarray(cursor, a));
    parts.push(stretch(signal.subarray(a, b), seg.ratio));
    cursor = b;
  }
  if (cursor < signal.length) parts.push(signal.subarray(cursor));
  return concat(...parts);
}

export function stretch(x, ratio) {
  const n = Math.round(x.length * ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i / ratio;
    const k = Math.floor(p);
    const fr = p - k;
    const a = x[Math.min(k, x.length - 1)];
    const b = x[Math.min(k + 1, x.length - 1)];
    out[i] = a + (b - a) * fr;
  }
  return out;
}

export function insertSilence(signal, atMs, ms) {
  const at = Math.round((atMs / 1000) * SR);
  return concat(signal.subarray(0, at), silence(ms), signal.subarray(at));
}

// White noise at a given RMS level (dBFS).
export function noise(ms, dbfs = -40, seed = 1) {
  const n = Math.round((ms / 1000) * SR);
  const out = new Float32Array(n);
  const amp = Math.pow(10, dbfs / 20);
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < n; i++) out[i] = amp * Math.sqrt(3) * (2 * rnd() - 1);
  return out;
}

export function addNoise(signal, snrDb, seed = 7) {
  let p = 0;
  for (let i = 0; i < signal.length; i++) p += signal[i] * signal[i];
  const rms = Math.sqrt(p / signal.length) || 1e-6;
  const nz = noise((signal.length / SR) * 1000, 20 * Math.log10(rms) - snrDb, seed);
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = signal[i] + nz[i];
  return out;
}

// Band-limited pulse train (rich in harmonics) — a crude glottal source.
export function pulseTrain(freq, ms, amp = 0.3) {
  const n = Math.round((ms / 1000) * SR);
  const out = new Float32Array(n);
  const nh = Math.floor(7000 / freq);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += (2 * Math.PI * freq) / SR;
    let v = 0;
    for (let h = 1; h <= nh; h++) v += Math.sin(phase * h) / h;
    out[i] = amp * v * 0.5;
  }
  return out;
}

// Second-order resonators in series — a toy vowel filter. formants: [[hz, bandwidthHz], ...]
export function formantFilter(x, formants) {
  let y = Float32Array.from(x);
  for (const [fc, bw] of formants) {
    const r = Math.exp((-Math.PI * bw) / SR);
    const a1 = -2 * r * Math.cos((2 * Math.PI * fc) / SR);
    const a2 = r * r;
    const g = 1 + a1 + a2; // unity gain at DC-ish; keeps levels sane
    const out = new Float32Array(y.length);
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = g * y[i] - a1 * y1 - a2 * y2;
      out[i] = v;
      y2 = y1;
      y1 = v;
    }
    y = out;
  }
  // normalise to the input RMS
  let pi = 0;
  let po = 0;
  for (let i = 0; i < x.length; i++) { pi += x[i] * x[i]; po += y[i] * y[i]; }
  const gain = Math.sqrt(pi / (po || 1));
  for (let i = 0; i < y.length; i++) y[i] *= gain;
  return y;
}

// A "vowel" note: pulse train at a pitch through a formant filter, with ramps.
export function vowel(freq, ms, formants, amp = 0.3) {
  const raw = pulseTrain(freq, ms, amp);
  const y = formantFilter(raw, formants);
  const att = Math.round(0.02 * SR);
  for (let i = 0; i < att && i < y.length; i++) { y[i] *= i / att; y[y.length - 1 - i] *= i / att; }
  return y;
}

export const VOWEL_A = [[700, 130], [1220, 70], [2600, 160]];
export const VOWEL_I = [[300, 60], [2300, 100], [3000, 150]];
export const VOWEL_U = [[320, 60], [870, 80], [2240, 120]];
export const VOWEL_E = [[530, 70], [1840, 90], [2480, 150]];
export const SYLLABLES = [VOWEL_A, VOWEL_I, VOWEL_U, VOWEL_E, VOWEL_A, VOWEL_I, VOWEL_U, VOWEL_E];

// A chant-like phrase: each note is a different vowel (so timbre carries content).
export function chant(notes, noteMs = 400, vowels = SYLLABLES, leadMs = 300) {
  return concat(silence(leadMs), ...notes.map((m, k) => vowel(midiToHz(m), noteMs, vowels[k % vowels.length])), silence(leadMs));
}
