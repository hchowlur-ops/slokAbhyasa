// Per-frame feature extraction at 16 kHz on a 20 ms hop:
//   rmsDb   – frame loudness in dBFS (32 ms window)
//   loud    – rmsDb minus the recording's own peak (normalises mic gain)
//   active  – 0/1 activity mask (adaptive threshold + hysteresis)
//   st      – pitch in fractional MIDI semitones (NaN when unvoiced), YIN + Viterbi
//   conf    – 1 - CMNDF at the chosen period (0 when unvoiced)
//   mfcc    – 12 mel-frequency cepstral coefficients c1..c12 per frame (row-major)
//   mfccWarps – optional (takes only): the MFCCs again for each frequency warp in
//               WARP_ALPHAS, so a comparison can allow for a different voice (see compare.js)

import { createFFT, powerSpectrum } from './fft.js';
import { fillGaps, dropShort, movingMedianNaN, bytesToBase64, base64ToBytes } from './util.js';
import { activityThreshold } from './activity.js';

export const FEAT_VERSION = 5; // 4: MFCCs from a smoothed spectral envelope; 5: harmonic peaks joined, 40 dB clamp
export const SR = 16000;
export const HOP = 320;
export const HOP_SEC = HOP / SR;
export const MFCC_WIN = 512;
export const N_MEL = 26;
export const N_MFCC = 12;
export const F_MIN = 60;
export const F_MAX = 1230;
export const TAU_MIN = Math.floor(SR / F_MAX);
export const TAU_MAX = Math.ceil(SR / F_MIN);
export const YIN_INT = 1024;
export const PITCH_WIN = YIN_INT + TAU_MAX + 1;
export const PRE_EMPH = 0.97;
export const YIN_THRESHOLD = 0.15;
export const VOICED_ON = 0.25;
export const VOICED_OFF = 0.40;
// Vocal-tract-length warps a take is analysed at (1 = as recorded). A child's formants sit
// up to about 1.3× an adult man's; a deep voice against a light one needs the other way.
export const WARP_ALPHAS = [0.74, 0.8, 0.86, 0.93, 1, 1.08, 1.16, 1.25, 1.35];
export const WARP_UNITY = WARP_ALPHAS.indexOf(1);
// Spectral-envelope smoothing: the running maximum of the power spectrum over this many FFT
// bins (31.25 Hz each) either side. The same width for every frame of every recording, so
// two voices get the same treatment; 250 Hz bridges the harmonics of any singing pitch up
// to about 500 Hz while the vowel formants (300 Hz wide and more) keep their shape.
export const ENVELOPE_BINS = 8;

export const msToFrames = (ms) => Math.max(1, Math.round(ms / 1000 / HOP_SEC));
export const hzToSt = (hz) => 69 + 12 * Math.log2(hz / 440);
export const stToHz = (st) => 440 * Math.pow(2, (st - 69) / 12);

// ---------- activity ----------

// rmsDb per frame; `samples`/`frameStart` let the threshold inspect the quietest window.
export function detectActivity(rmsDb, samples = null, frameStart = null) {
  const n = rmsDb.length;
  const { floor, peak, thr } = activityThreshold(rmsDb, { samples, sampleRate: SR, frameStart, winFrames: msToFrames(300), aboveFloor: 8, maxBelowPeak: 45 });
  const active = new Uint8Array(n);
  let on = 0;
  for (let i = 0; i < n; i++) {
    if (!on && rmsDb[i] >= thr) on = 1;
    else if (on && rmsDb[i] < thr - 3) on = 0;
    active[i] = on;
  }
  fillGaps(active, msToFrames(120));
  dropShort(active, msToFrames(60));
  return { active, thr, floor, peak };
}

// ---------- mel filterbank / DCT ----------

const melOf = (hz) => 2595 * Math.log10(1 + hz / 700);
const hzOfMel = (m) => 700 * (Math.pow(10, m / 2595) - 1);

// Frequency warp for vocal-tract-length normalisation: the spectrum is read at alpha times
// the frequency (a shorter vocal tract puts the same vowel's formants higher), piecewise
// linear near Nyquist so nothing is read beyond it.
function warpHz(hz, alpha, nyq) {
  if (alpha === 1) return hz;
  const fb = (0.85 * nyq) / Math.max(alpha, 1);
  if (hz <= fb) return alpha * hz;
  return alpha * fb + ((nyq - alpha * fb) * (hz - fb)) / (nyq - fb);
}

function melFilterbank(nFft, sr, nMel, fLo = 0, fHi = sr / 2, alpha = 1) {
  const nBins = nFft / 2 + 1;
  const mLo = melOf(fLo);
  const mHi = melOf(fHi);
  const pts = new Float64Array(nMel + 2);
  for (let i = 0; i < nMel + 2; i++) pts[i] = (warpHz(hzOfMel(mLo + ((mHi - mLo) * i) / (nMel + 1)), alpha, sr / 2) * nFft) / sr;
  const filters = [];
  for (let m = 0; m < nMel; m++) {
    const lo = pts[m];
    const c = pts[m + 1];
    const hi = pts[m + 2];
    const b0 = Math.max(0, Math.floor(lo));
    const b1 = Math.min(nBins - 1, Math.ceil(hi));
    const w = new Float32Array(b1 - b0 + 1);
    for (let b = b0; b <= b1; b++) {
      let v = 0;
      if (b >= lo && b <= c && c > lo) v = (b - lo) / (c - lo);
      else if (b > c && b <= hi && hi > c) v = (hi - b) / (hi - c);
      w[b - b0] = Math.max(0, v);
    }
    filters.push({ b0, w });
  }
  return filters;
}

function dctTable(nMfcc, nMel) {
  const t = new Float64Array(nMfcc * nMel);
  for (let c = 1; c <= nMfcc; c++) {
    for (let m = 0; m < nMel; m++) t[(c - 1) * nMel + m] = Math.cos((Math.PI * c * (m + 0.5)) / nMel);
  }
  return t;
}

// ---------- YIN ----------

// Returns up to 4 period candidates {tau, val, st} for one frame (YIN_INT integration window).
function yinCandidates(frame, d, cmnd) {
  for (let tau = 1; tau <= TAU_MAX; tau++) {
    let s = 0;
    for (let i = 0; i < YIN_INT; i++) {
      const df = frame[i] - frame[i + tau];
      s += df * df;
    }
    d[tau] = s;
  }
  cmnd[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= TAU_MAX; tau++) {
    run += d[tau];
    cmnd[tau] = run > 0 ? (d[tau] * tau) / run : 1;
  }
  const cands = [];
  for (let t = TAU_MIN; t <= TAU_MAX; t++) {
    const v = cmnd[t];
    if (v < 0.5 && v <= cmnd[t - 1] && (t === TAU_MAX || v < cmnd[t + 1])) {
      let tau = t;
      if (t > 1 && t < TAU_MAX) {
        const a = cmnd[t - 1];
        const c = cmnd[t + 1];
        const den = a - 2 * v + c;
        if (den > 1e-9) tau = t + (0.5 * (a - c)) / den;
      }
      cands.push({ tau, val: v, st: hzToSt(SR / tau), first: false });
    }
  }
  if (!cands.length) return cands;
  // YIN's rule: prefer the first dip below the absolute threshold (avoids sub-octave errors).
  let first = cands.find((c) => c.val < YIN_THRESHOLD);
  if (!first) first = cands.reduce((a, b) => (b.val < a.val ? b : a));
  first.first = true;
  cands.sort((a, b) => a.val - b.val);
  const kept = cands.slice(0, 4);
  if (!kept.includes(first)) kept[kept.length - 1] = first;
  return kept;
}

// Viterbi over consecutive frames: emission = CMNDF (minus a bonus for YIN's first dip),
// transition = 0.03 * min(|Δst|, 12). Fills st/conf with the chosen candidate (voicing decided later).
function trackPitch(candList, st, cmndOut) {
  const n = candList.length;
  let s = 0;
  while (s < n) {
    if (!candList[s] || !candList[s].length) { s++; continue; }
    let e = s;
    while (e + 1 < n && candList[e + 1] && candList[e + 1].length) e++;
    // run [s, e]
    const costs = [];
    const back = [];
    for (let t = s; t <= e; t++) {
      const cands = candList[t];
      const cost = new Float64Array(cands.length);
      const bp = new Int16Array(cands.length);
      for (let c = 0; c < cands.length; c++) {
        const emit = cands[c].val - (cands[c].first ? 0.05 : 0);
        if (t === s) { cost[c] = emit; bp[c] = -1; continue; }
        const prevC = candList[t - 1];
        const prevCost = costs[costs.length - 1];
        let best = Infinity;
        let bi = 0;
        for (let p = 0; p < prevC.length; p++) {
          const v = prevCost[p] + 0.03 * Math.min(Math.abs(cands[c].st - prevC[p].st), 12);
          if (v < best) { best = v; bi = p; }
        }
        cost[c] = emit + best;
        bp[c] = bi;
      }
      costs.push(cost);
      back.push(bp);
    }
    let bi = 0;
    const last = costs[costs.length - 1];
    for (let c = 1; c < last.length; c++) if (last[c] < last[bi]) bi = c;
    for (let t = e; t >= s; t--) {
      const cand = candList[t][bi];
      st[t] = cand.st;
      cmndOut[t] = cand.val;
      bi = back[t - s][bi];
    }
    s = e + 1;
  }
}

// ---------- spectral envelope ----------

// Joins the harmonic peaks of a power spectrum: a peak is a local maximum within
// ENVELOPE_PEAK_DB of the running maximum around it (which keeps the harmonics and drops the
// noise between them); between peaks the log power is interpolated linearly, outside the
// first and last it is held. A light running maximum (ENVELOPE_SMOOTH_BINS) then flattens
// the ripple that remains where a band holds nothing but noise. Writes into `env`.
export const ENVELOPE_PEAK_DB = 10;
export const ENVELOPE_SMOOTH_BINS = 3;
// A frame's mel bands are clamped to this many dB below its loudest band: bands holding
// nothing but room noise then look alike in both recordings.
export const MEL_DYNAMIC_RANGE_DB = 40;
const MEL_DYNAMIC_RANGE_LN = (MEL_DYNAMIC_RANGE_DB / 10) * Math.LN10;
const PEAK_RATIO = Math.pow(10, -ENVELOPE_PEAK_DB / 10);
const envTmp = new Float32Array(4096);
export function spectralEnvelope(pow, env, nBins) {
  const raw = envTmp.subarray(0, nBins);
  let prev = -1;
  let prevLog = 0;
  for (let b = 0; b < nBins; b++) {
    let mx = 0;
    for (let q = Math.max(0, b - ENVELOPE_BINS); q <= Math.min(nBins - 1, b + ENVELOPE_BINS); q++) if (pow[q] > mx) mx = pow[q];
    const isPeak = pow[b] >= mx * PEAK_RATIO && (b === 0 || pow[b] >= pow[b - 1]) && (b === nBins - 1 || pow[b] >= pow[b + 1]);
    if (!isPeak) continue;
    const lg = Math.log(pow[b] + 1e-12);
    if (prev < 0) { for (let q = 0; q < b; q++) raw[q] = pow[b]; } else {
      for (let q = prev + 1; q < b; q++) raw[q] = Math.exp(prevLog + ((lg - prevLog) * (q - prev)) / (b - prev));
    }
    raw[b] = pow[b];
    prev = b;
    prevLog = lg;
  }
  if (prev < 0) raw.set(pow.subarray(0, nBins));
  else for (let q = prev + 1; q < nBins; q++) raw[q] = pow[prev];
  for (let b = 0; b < nBins; b++) {
    let mx = 0;
    for (let q = Math.max(0, b - ENVELOPE_SMOOTH_BINS); q <= Math.min(nBins - 1, b + ENVELOPE_SMOOTH_BINS); q++) if (raw[q] > mx) mx = raw[q];
    env[b] = mx;
  }
}

// ---------- main ----------

// `warps`: also compute the MFCCs at every WARP_ALPHAS warp (for a take that will be compared
// with a sloka sung by a different voice).
export function extractFeatures(x, { onProgress, warps = false } = {}) {
  const len = x.length;
  const n = Math.max(1, Math.ceil(len / HOP));
  const padL = PITCH_WIN >> 1;
  const xp = new Float32Array(len + 2 * padL + HOP);
  xp.set(x, padL);

  // RMS
  const rmsDb = new Float32Array(n);
  const halfM = MFCC_WIN >> 1;
  for (let k = 0; k < n; k++) {
    const s0 = padL + k * HOP - halfM;
    let s = 0;
    for (let i = 0; i < MFCC_WIN; i++) { const v = xp[s0 + i]; s += v * v; }
    rmsDb[k] = 20 * Math.log10(Math.sqrt(s / MFCC_WIN) + 1e-9);
  }
  const act = detectActivity(rmsDb, xp, (k) => padL + k * HOP - halfM);
  const active = act.active;
  const loud = new Float32Array(n);
  for (let k = 0; k < n; k++) loud[k] = rmsDb[k] - act.peak;

  // Pitch (first: the spectral envelope below is smoothed by the pitch)
  const halfP = PITCH_WIN >> 1;
  const d = new Float64Array(TAU_MAX + 1);
  const cmnd = new Float64Array(TAU_MAX + 1);
  const candList = new Array(n);
  for (let k = 0; k < n; k++) {
    if (!active[k]) { candList[k] = null; continue; }
    const s0 = padL + k * HOP - halfP;
    candList[k] = yinCandidates(xp.subarray(s0, s0 + PITCH_WIN), d, cmnd);
    if (onProgress && k % 50 === 0) onProgress(k / n);
  }
  const st = new Float32Array(n).fill(NaN);
  const cm = new Float32Array(n).fill(1);
  trackPitch(candList, st, cm);

  // Voicing with hysteresis, then clean-up
  const voiced = new Uint8Array(n);
  let v = 0;
  for (let k = 0; k < n; k++) {
    const has = candList[k] && candList[k].length && !Number.isNaN(st[k]);
    if (!has) v = 0;
    else if (!v && cm[k] < VOICED_ON) v = 1;
    else if (v && cm[k] > VOICED_OFF) v = 0;
    voiced[k] = v;
  }
  fillGaps(voiced, 1);
  dropShort(voiced, msToFrames(40));
  for (let k = 0; k < n; k++) {
    if (voiced[k] && Number.isNaN(st[k])) {
      // gap filled: interpolate from neighbours
      const a = k > 0 ? st[k - 1] : NaN;
      const b = k + 1 < n ? st[k + 1] : NaN;
      st[k] = Number.isNaN(a) ? b : Number.isNaN(b) ? a : 0.5 * (a + b);
      cm[k] = VOICED_ON;
    }
    if (!voiced[k]) st[k] = NaN;
  }
  const stSmooth = movingMedianNaN(st, 5);
  const conf = new Float32Array(n);
  let nVoiced = 0;
  for (let k = 0; k < n; k++) {
    conf[k] = voiced[k] ? Math.max(0, 1 - cm[k]) : 0;
    if (voiced[k]) nVoiced++;
  }

  // MFCC, from a spectral envelope rather than the raw spectrum: the harmonics (the
  // spectrum's peaks that stand out against the running maximum over ENVELOPE_BINS each
  // way) are joined by straight lines in the log domain. A high voice, whose harmonics are
  // far apart, then gives the same vowel shape as a low one instead of a comb that the mel
  // bands would sample at random; holding the maximum between harmonics instead would leave
  // a staircase whose steps move with the pitch.
  const fft = createFFT(MFCC_WIN);
  const re = new Float32Array(MFCC_WIN);
  const im = new Float32Array(MFCC_WIN);
  const nBins = MFCC_WIN / 2 + 1;
  const pow = new Float32Array(nBins);
  const env = new Float32Array(nBins);
  const frame = new Float32Array(MFCC_WIN);
  const hann = new Float32Array(MFCC_WIN);
  for (let i = 0; i < MFCC_WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (MFCC_WIN - 1));
  const binHz = SR / MFCC_WIN;
  const alphas = warps ? WARP_ALPHAS : [1];
  const banks = alphas.map((a) => melFilterbank(MFCC_WIN, SR, N_MEL, 0, 8000, a));
  const dct = dctTable(N_MFCC, N_MEL);
  const logE = new Float64Array(N_MEL);
  const mfccAll = new Float32Array(alphas.length * n * N_MFCC); // [warp][frame][coeff]
  for (let k = 0; k < n; k++) {
    const s0 = padL + k * HOP - halfM;
    for (let i = 0; i < MFCC_WIN; i++) frame[i] = (xp[s0 + i] - PRE_EMPH * xp[s0 + i - 1]) * hann[i];
    powerSpectrum(fft, frame, re, im, pow);
    spectralEnvelope(pow, env, nBins);
    for (let a = 0; a < alphas.length; a++) {
      const filters = banks[a];
      let top = -Infinity;
      for (let m = 0; m < N_MEL; m++) {
        const f = filters[m];
        let e = 0;
        for (let b = 0; b < f.w.length; b++) e += env[f.b0 + b] * f.w[b];
        logE[m] = Math.log(e + 1e-10);
        if (logE[m] > top) top = logE[m];
      }
      const floorLog = top - MEL_DYNAMIC_RANGE_LN;
      for (let m = 0; m < N_MEL; m++) if (logE[m] < floorLog) logE[m] = floorLog;
      const row = (a * n + k) * N_MFCC;
      for (let c = 0; c < N_MFCC; c++) {
        let v = 0;
        for (let m = 0; m < N_MEL; m++) v += logE[m] * dct[c * N_MEL + m];
        mfccAll[row + c] = v;
      }
    }
  }
  const unity = alphas.indexOf(1);
  const mfcc = mfccAll.slice(unity * n * N_MFCC, (unity + 1) * n * N_MFCC);
  const means = new Float32Array(alphas.length * N_MFCC);
  let nAct = 0;
  for (let k = 0; k < n; k++) {
    if (!active[k]) continue;
    nAct++;
    for (let a = 0; a < alphas.length; a++) for (let c = 0; c < N_MFCC; c++) means[a * N_MFCC + c] += mfccAll[(a * n + k) * N_MFCC + c];
  }
  if (nAct) for (let i = 0; i < means.length; i++) means[i] /= nAct;
  const mfccMean = means.slice(unity * N_MFCC, (unity + 1) * N_MFCC);

  // Trim
  let first = 0;
  while (first < n && !active[first]) first++;
  let lastA = n - 1;
  while (lastA > first && !active[lastA]) lastA--;
  const pad = msToFrames(100);
  const trimStart = first >= n ? 0 : Math.max(0, first - pad);
  const trimEnd = first >= n ? n - 1 : Math.min(n - 1, lastA + pad);

  if (onProgress) onProgress(1);
  return {
    featVersion: FEAT_VERSION,
    sr: SR,
    hop: HOP,
    hopSec: HOP_SEC,
    n,
    duration: len / SR,
    rmsDb,
    loud,
    active,
    st: stSmooth,
    conf,
    mfcc,
    mfccMean,
    ...(warps ? { mfccWarps: mfccAll, mfccWarpMeans: means } : {}),
    trimStart,
    trimEnd,
    peakDb: act.peak,
    floorDb: act.floor,
    thrDb: act.thr,
    activeFrac: nAct / n,
    voicedFrac: nVoiced / n,
  };
}

// ---------- (de)serialisation for the on-disk cache ----------

const TYPED = { rmsDb: Float32Array, loud: Float32Array, active: Uint8Array, st: Float32Array, conf: Float32Array, mfcc: Float32Array, mfccMean: Float32Array, mfccWarps: Float32Array, mfccWarpMeans: Float32Array };

export function serializeFeatures(f) {
  const out = {};
  for (const [k, v] of Object.entries(f)) {
    if (TYPED[k]) out[k] = { $t: TYPED[k].name, $b: bytesToBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    else out[k] = v;
  }
  return out;
}

export function deserializeFeatures(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object' && v.$t && TYPED[k]) {
      const bytes = base64ToBytes(v.$b);
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      out[k] = new TYPED[k](buf);
    } else out[k] = v;
  }
  return out;
}

export function isValidFeatures(f) {
  return !!f && f.featVersion === FEAT_VERSION && f.st instanceof Float32Array && f.mfcc instanceof Float32Array && f.n > 0;
}
