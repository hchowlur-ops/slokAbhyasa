// Compare a heard recording with a sloka: normalise, align (two passes),
// detect deviations, score, and package everything the UI needs.

import { alignLarge, pathMaps } from './dtw.js';
import { N_MFCC, HOP_SEC, isValidFeatures, WARP_ALPHAS, WARP_UNITY } from './features.js';
import { detectDeviations, foldOctave } from './deviations.js';
import { medianOf, slopeOf, clamp } from './util.js';
import { locate, sliceFeatures, rethreshold } from './locate.js';

export const RESULT_VERSION = 1;

export const MODES = {
  // blends
  chant: { pitch: 0.2, timing: 0.35, content: 0.45 },
  singing: { pitch: 0.4, timing: 0.3, content: 0.3 },
  instrument: { pitch: 0.45, timing: 0.4, content: 0.15 },
  // single-aspect evaluation ("Evaluate on" in the UI); the overall score is that aspect alone
  content: { pitch: 0, timing: 0, content: 1 },
  timing: { pitch: 0, timing: 1, content: 0 },
  pitch: { pitch: 1, timing: 0, content: 0 },
};

// judgeSpeed: whether the speed of recitation counts. Off, a sloka may be recited at any
// pace, uniform or not; pauses, skipped and added material still count. On, stretches
// rushed or dragged against the learner's own overall tempo count in the timing score, and
// the overall tempo itself is penalised. (penalizeTempo is the old name of the option.)
export const DEFAULT_OPTIONS = { ignoreKey: true, judgeSpeed: false, flagDynamics: false, mode: 'chant' };

// Length ratio beyond which the shorter recording is searched for inside the longer one.
export const LOCATE_RATIO = 1.5;
// locate()'s contrast at or above which the two recordings do not share their material.
// Measured on real chanting: same verse 0.44–0.78, different verse 0.91–1.05.
export const MISMATCH_CONTRAST = 0.87;
const LOCATE_PAD = Math.round(0.3 / HOP_SEC);
const ACTIVITY_TOLERANCE_DB = 6;
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// compare(), preceded by a search when one recording is much longer than the other: one
// verse against a recording of eight, or a long take against a single-verse sloka.
// All times in the result stay absolute (seconds into the full sloka / full take).
// Adds: match { contrast, ok, located: 'heard' | 'base' | null }, baseOffset, baseFullDuration.
export function compareAuto(B, H, options = {}) {
  if (!isValidFeatures(B) || !isValidFeatures(H)) return compare(B, H, options); // throws the right message
  // One yardstick for "sound" in both recordings: the stricter of the two thresholds, each
  // relative to its recording's own peak. Two recordings made in different rooms judge
  // silence very differently, and the pauses of a quiet one must not come out as extra sound.
  const relB = B.thrDb - B.peakDb;
  const relH = H.thrDb - H.peakDb;
  const relBoth = Number.isFinite(relB) && Number.isFinite(relH) ? Math.max(relB, relH) : NaN;
  const harmonise = (X, Y) => {
    if (!Number.isFinite(relBoth) || Math.abs(relB - relH) <= ACTIVITY_TOLERANCE_DB) return [X, Y];
    return [rethreshold(X, relBoth), rethreshold(Y, relBoth)];
  };
  // A different voice (a child after an adult, say) has its vowels' formants elsewhere: read
  // the take at the frequency warp that fits the sloka best, before anything is located,
  // aligned or judged.
  H = normalizeVoice(B, H);
  const spanB = Math.max(1, B.trimEnd - B.trimStart + 1);
  const spanH = Math.max(1, H.trimEnd - H.trimStart + 1);
  const ratio = spanH / spanB;
  let res = null;
  let located = null;
  let contrast = null;
  if (options.locate !== false && (ratio >= LOCATE_RATIO || ratio <= 1 / LOCATE_RATIO)) {
    // The search runs on each recording as it judged itself; the yardstick is applied to the
    // window it finds, against the window's own peak. The whole recording's peak may belong
    // to another, louder sloka, and judged against that one the quieter syllables of this
    // one would come out as "not heard" (or the whole of it, before it was even found).
    const heardIsLong = ratio > 1;
    const L = heardIsLong ? H : B;
    const loc = locate(heardIsLong ? B : H, L);
    if (loc) {
      const i0 = Math.max(0, loc.start - LOCATE_PAD);
      const i1 = Math.min(L.n - 1, loc.end + LOCATE_PAD);
      const Lc = sliceFeatures(L, i0, i1, [loc.start, loc.end]);
      const [Bw, Hw] = heardIsLong ? harmonise(B, Lc) : harmonise(Lc, H);
      res = compare(Bw, Hw, options);
      if (heardIsLong) shiftHeard(res, i0, H); else shiftBase(res, i0, B);
      // Neighbouring material at the edges of the window is not the performer's mistake.
      const drop = heardIsLong ? 'extra' : 'missing';
      res.deviations = res.deviations.filter((d) => !(d.edge && d.type === drop && d.types.length === 1));
      contrast = loc.contrast;
      located = heardIsLong ? 'heard' : 'base';
    }
  }
  if (!res) {
    const [Bh, Hh] = harmonise(B, H);
    res = compare(Bh, Hh, options);
    const loc = spanB <= spanH ? locate(Bh, Hh) : locate(Hh, Bh);
    contrast = loc ? loc.contrast : null;
  }
  if (res.baseOffset === undefined) { res.baseOffset = 0; res.baseFullDuration = B.duration; }
  const ok = contrast === null || contrast < MISMATCH_CONTRAST;
  res.match = { contrast, ok, located };
  const notes = [];
  if (!ok) notes.push('This does not sound like the same material as the sloka, so the scores below mean little.');
  if (located === 'heard') notes.push(`Your recording is longer than this sloka. Its best-matching part (${mmss(res.matched.heard[0])}–${mmss(res.matched.heard[1])}) was compared.`);
  if (located === 'base') notes.push(`This sloka is longer than your recording. You were compared with its best-matching part (${mmss(res.matched.base[0])}–${mmss(res.matched.base[1])}).`);
  res.notes = [...notes, ...res.notes];
  return res;
}

function shiftHeard(res, i0, H) {
  const off = i0 * HOP_SEC;
  res.matched.heard = res.matched.heard.map((t) => t + off);
  for (const d of res.deviations) if (d.tHeard) d.tHeard = [d.tHeard[0] + off, d.tHeard[1] + off];
  const c = res.chart;
  c.jOf = Int32Array.from(c.jOf, (j) => (j >= 0 ? j + i0 : -1));
  const iOf = new Int32Array(H.n).fill(-1);
  iOf.set(c.iOf.subarray(0, Math.min(c.iOf.length, H.n - i0)), i0);
  c.iOf = iOf;
  res.heardDuration = H.duration;
}

function shiftBase(res, i0, B) {
  const off = i0 * HOP_SEC;
  res.matched.base = res.matched.base.map((t) => t + off);
  for (const d of res.deviations) d.tBase = [d.tBase[0] + off, d.tBase[1] + off];
  const c = res.chart;
  for (let i = 0; i < c.times.length; i++) c.times[i] += off;
  c.iOf = Int32Array.from(c.iOf, (i) => (i >= 0 ? i + i0 : -1)); // absolute sloka frames
  res.baseOffset = off; // res.baseDuration stays the window's length: the span the chart shows
  res.baseFullDuration = B.duration;
}

export function compare(B, H, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (options.judgeSpeed === undefined && options.penalizeTempo !== undefined) opts.judgeSpeed = !!options.penalizeTempo;
  if (!isValidFeatures(B)) throw new Error('The sloka analysis is missing or outdated. Re-save the sloka.');
  if (!isValidFeatures(H)) throw new Error('The recording could not be analysed.');
  if (H.activeFrac < 0.05 || H.peakDb < -40) throw new Error('No audio was detected in your recording. Check the microphone and try again.');
  if (B.activeFrac < 0.05 || B.peakDb < -40) throw new Error('The sloka seems to be silent.');
  H = normalizeVoice(B, H); // no-op when compareAuto already did it, or the take has no warps

  const bs = B.trimStart;
  const be = B.trimEnd;
  const hs = H.trimStart;
  const he = H.trimEnd;
  const N = be - bs + 1;
  const M = he - hs + 1;

  const { Bm, Hm } = normalizeMfcc(B, H); // mean-removed and scaled by the pooled std
  const mfccDist = (i, j) => {
    let s = 0;
    const bi = i * N_MFCC;
    const hj = j * N_MFCC;
    for (let c = 0; c < N_MFCC; c++) {
      const t = Bm[bi + c] - Hm[hj + c];
      s += t * t;
    }
    return Math.min(3, Math.sqrt(s / N_MFCC));
  };
  const makeCost = (wP, offset) => (ii, jj) => {
    const i = ii + bs;
    const j = jj + hs;
    const ba = B.active[i];
    const ha = H.active[j];
    if (!ba && !ha) return 0.1;
    if (ba !== ha) return 1.0;
    let c = mfccDist(i, j);
    if (wP > 0) {
      const bv = !Number.isNaN(B.st[i]);
      const hv = !Number.isNaN(H.st[j]);
      if (bv && hv) c += (wP * Math.min(Math.abs(H.st[j] - B.st[i] - offset), 6)) / 6;
      else if (bv !== hv) c += wP * 0.5;
    }
    c += (0.3 * Math.min(Math.abs(B.loud[i] - H.loud[j]), 12)) / 12;
    return c;
  };

  // Pass 1 (on every other frame, no pitch term): key-invariant alignment used only
  // to estimate the global key offset.
  const D1 = 2;
  const N1 = Math.ceil(N / D1);
  const M1 = Math.ceil(M / D1);
  const cost1 = makeCost(0, 0);
  const align1 = alignLarge(N1, M1, (ii, jj) => cost1(Math.min(N - 1, ii * D1), Math.min(M - 1, jj * D1)));
  const maps1 = pathMaps(align1.pathI, align1.pathJ, N1, M1);
  const key = estimateKeyOffset(B, H, maps1.jOf, bs, hs, N1, D1);
  // Pass 2: full resolution with the pitch term. The alignment itself is always
  // key-compensated ("which part corresponds to which" should not depend on key);
  // whether the offset is forgiven in the report depends on the option.
  const alignOffset = Math.abs(key.offset) > 0.5 ? key.offset : 0;
  const offsetApplied = opts.ignoreKey ? alignOffset : 0;
  const align = alignLarge(N, M, makeCost(0.6, alignOffset));
  const maps = pathMaps(align.pathI, align.pathJ, N, M);

  const jOf = new Int32Array(B.n).fill(-1);
  const iOf = new Int32Array(H.n).fill(-1);
  for (let i = 0; i < N; i++) if (maps.jOf[i] >= 0) jOf[i + bs] = maps.jOf[i] + hs;
  for (let j = 0; j < M; j++) if (maps.iOf[j] >= 0) iOf[j + hs] = maps.iOf[j] + bs;
  const matched = { iStart: align.iStart + bs, iEnd: align.iEnd + bs, jStart: align.jStart + hs, jEnd: align.jEnd + hs };

  const xs = [];
  const ys = [];
  for (let i = matched.iStart; i <= matched.iEnd; i++) if (jOf[i] >= 0) { xs.push(i); ys.push(jOf[i]); }
  const tempoRatio = clamp(slopeOf(xs, ys), 0.25, 4);

  const pathDist = new Float32Array(B.n).fill(NaN);
  for (let i = 0; i < B.n; i++) if (jOf[i] >= 0) pathDist[i] = mfccDist(i, jOf[i]);

  const ctx = { B, H, jOf, iOf, matched, tempoRatio, pathDist, offset: offsetApplied, opts };
  const dev = detectDeviations(ctx);
  const scores = computeScores(ctx, dev);
  const notes = buildNotes(ctx, dev, key, offsetApplied);

  return {
    version: RESULT_VERSION,
    mode: opts.mode,
    options: opts,
    hopSec: HOP_SEC,
    baseDuration: B.duration,
    heardDuration: H.duration,
    keyOffset: key.offset,
    keyOffsetPairs: key.n,
    offsetApplied,
    voiceWarp: H.voiceWarp ?? 1,
    tempoRatio,
    alignmentCost: align.meanCost,
    contentFloor: dev.contentFloor,
    matched: {
      base: [matched.iStart * HOP_SEC, (matched.iEnd + 1) * HOP_SEC],
      heard: [matched.jStart * HOP_SEC, (matched.jEnd + 1) * HOP_SEC],
    },
    scores,
    notes,
    deviations: dev.deviations.map(({ bStart, bEnd, ...rest }) => rest),
    chart: buildChart(ctx),
  };
}

// ---------- helpers ----------

// Vocal-tract-length normalisation. Among the warps the take was analysed at, the one whose
// spectral frames lie closest to the sloka's wins: for a sample of active frames of each
// recording, the mean distance to the nearest frame of the other (no alignment needed, so
// this works whatever the lengths and before locate()). The unwarped reading keeps its place
// unless another is clearly better, so a same-voice take is never warped on a whim.
const WARP_MIN_GAIN = 0.04;
const WARP_SAMPLE = 300;

export function chooseVoiceWarp(B, H) {
  if (!H.mfccWarps || !H.mfccWarpMeans) return WARP_UNITY;
  const nA = Math.round(H.mfccWarps.length / (H.n * N_MFCC));
  const pick = (F) => {
    const idx = [];
    for (let k = F.trimStart; k <= F.trimEnd; k++) if (F.active[k]) idx.push(k);
    const step = Math.max(1, Math.ceil(idx.length / WARP_SAMPLE));
    return idx.filter((_, i) => i % step === 0);
  };
  const bi = pick(B);
  const hi = pick(H);
  if (bi.length < 10 || hi.length < 10) return WARP_UNITY;
  const costs = new Float64Array(nA);
  for (let a = 0; a < nA; a++) {
    const Hv = { n: H.n, active: H.active, mfcc: H.mfccWarps.subarray(a * H.n * N_MFCC, (a + 1) * H.n * N_MFCC), mfccMean: H.mfccWarpMeans.subarray(a * N_MFCC, (a + 1) * N_MFCC) };
    const { Bm, Hm } = normalizeMfcc(B, Hv);
    const d2 = (i, j) => { let s = 0; for (let c = 0; c < N_MFCC; c++) { const t = Bm[i * N_MFCC + c] - Hm[j * N_MFCC + c]; s += t * t; } return s; };
    let sum = 0;
    for (const j of hi) { let best = Infinity; for (const i of bi) { const v = d2(i, j); if (v < best) best = v; } sum += Math.sqrt(best / N_MFCC); }
    for (const i of bi) { let best = Infinity; for (const j of hi) { const v = d2(i, j); if (v < best) best = v; } sum += Math.sqrt(best / N_MFCC); }
    costs[a] = sum / (hi.length + bi.length);
  }
  let best = WARP_UNITY;
  for (let a = 0; a < nA; a++) if (costs[a] < costs[best]) best = a;
  return costs[best] < costs[WARP_UNITY] * (1 - WARP_MIN_GAIN) ? best : WARP_UNITY;
}

// The take read at warp k: its MFCCs and their mean (over the current activity mask).
export function withVoiceWarp(H, k) {
  if (k === WARP_UNITY || !H.mfccWarps) return { ...H, voiceWarp: 1 };
  const mfcc = H.mfccWarps.slice(k * H.n * N_MFCC, (k + 1) * H.n * N_MFCC);
  const mfccMean = new Float32Array(N_MFCC);
  let nAct = 0;
  for (let i = 0; i < H.n; i++) {
    if (!H.active[i]) continue;
    nAct++;
    for (let c = 0; c < N_MFCC; c++) mfccMean[c] += mfcc[i * N_MFCC + c];
  }
  if (nAct) for (let c = 0; c < N_MFCC; c++) mfccMean[c] /= nAct;
  return { ...H, mfcc, mfccMean, voiceWarp: WARP_ALPHAS[k] };
}

function normalizeVoice(B, H) {
  if (H.voiceWarp !== undefined || !H.mfccWarps) return H;
  return withVoiceWarp(H, chooseVoiceWarp(B, H));
}

function normalizeMfcc(B, H) {
  const Bm = new Float32Array(B.mfcc.length);
  const Hm = new Float32Array(H.mfcc.length);
  for (let i = 0; i < B.n; i++) for (let c = 0; c < N_MFCC; c++) Bm[i * N_MFCC + c] = B.mfcc[i * N_MFCC + c] - B.mfccMean[c];
  for (let j = 0; j < H.n; j++) for (let c = 0; c < N_MFCC; c++) Hm[j * N_MFCC + c] = H.mfcc[j * N_MFCC + c] - H.mfccMean[c];
  const sum = new Float64Array(N_MFCC);
  const sq = new Float64Array(N_MFCC);
  let cnt = 0;
  const acc = (F, Fm) => {
    for (let i = 0; i < F.n; i++) {
      if (!F.active[i]) continue;
      cnt++;
      for (let c = 0; c < N_MFCC; c++) { const v = Fm[i * N_MFCC + c]; sum[c] += v; sq[c] += v * v; }
    }
  };
  acc(B, Bm);
  acc(H, Hm);
  const sigma = new Float32Array(N_MFCC);
  for (let c = 0; c < N_MFCC; c++) {
    const mean = cnt ? sum[c] / cnt : 0;
    const varc = cnt ? Math.max(0, sq[c] / cnt - mean * mean) : 1;
    sigma[c] = Math.max(1e-3, Math.sqrt(varc));
  }
  for (let i = 0; i < B.n; i++) for (let c = 0; c < N_MFCC; c++) Bm[i * N_MFCC + c] /= sigma[c];
  for (let j = 0; j < H.n; j++) for (let c = 0; c < N_MFCC; c++) Hm[j * N_MFCC + c] /= sigma[c];
  return { Bm, Hm, sigma };
}

function estimateKeyOffset(B, H, jOfRel, bs, hs, N, decim = 1) {
  const diffs = [];
  for (let ii = 0; ii < N; ii++) {
    const jj = jOfRel[ii];
    if (jj < 0) continue;
    const i = Math.min(B.n - 1, ii * decim + bs);
    const j = Math.min(H.n - 1, jj * decim + hs);
    if (Number.isNaN(B.st[i]) || Number.isNaN(H.st[j])) continue;
    if (B.conf[i] < 0.8 || H.conf[j] < 0.8) continue;
    diffs.push(H.st[j] - B.st[i]);
  }
  if (diffs.length < 10) return { offset: 0, n: diffs.length };
  const lo = -36;
  const bins = new Int32Array(721);
  for (const d of diffs) {
    const b = Math.round((clamp(d, lo, 36) - lo) * 10);
    bins[b]++;
  }
  let modeBin = 0;
  for (let b = 1; b < bins.length; b++) if (bins[b] > bins[modeBin]) modeBin = b;
  const modeCenter = lo + modeBin / 10;
  const near = diffs.filter((d) => Math.abs(d - modeCenter) <= 1);
  let offset = medianOf(near);
  const rounded = Math.round(offset);
  if (Math.abs(offset - rounded) < 0.3) offset = rounded;
  return { offset, n: diffs.length };
}

function computeScores(ctx, dev) {
  const { B, tempoRatio, opts } = ctx;
  let activeBase = 0;
  let covT = 0;
  let covC = 0;
  let covD = 0;
  for (let i = B.trimStart; i <= B.trimEnd; i++) {
    if (!B.active[i]) continue;
    activeBase++;
    if (dev.coverTiming[i]) covT++;
    if (dev.coverContent[i]) covC++;
    if (dev.coverDynamics && dev.coverDynamics[i]) covD++;
  }
  activeBase = Math.max(1, activeBase);
  const ps = dev.pitchStats;
  const pitch = ps.usable >= 10 ? clamp(100 * ps.creditMean, 0, 100) : null;
  const tempoFactor = opts.judgeSpeed ? Math.exp(-Math.pow(Math.log(tempoRatio) / 0.7, 2)) : 1;
  const timing = clamp(100 * (1 - covT / activeBase) * tempoFactor, 0, 100);
  const content = clamp(100 * (1 - covC / activeBase), 0, 100);
  const dynamics = opts.flagDynamics ? clamp(100 * (1 - covD / activeBase), 0, 100) : null; // only measured when asked for

  const w = { ...(MODES[opts.mode] || MODES.chant) };
  if (pitch === null) w.pitch = 0;
  else if (B.voicedFrac < 0.3) w.pitch = Math.min(w.pitch, 0.1);
  let wsum = w.pitch + w.timing + w.content;
  if (wsum <= 0) {
    // evaluating on pitch alone, but no usable pitch: fall back to the chant blend without pitch
    w.pitch = 0; w.timing = MODES.chant.timing; w.content = MODES.chant.content;
    wsum = w.timing + w.content;
  }
  const overall = clamp(((pitch ?? 0) * w.pitch + timing * w.timing + content * w.content) / wsum, 0, 100);

  return {
    overall: Math.round(overall),
    pitch: pitch === null ? null : Math.round(pitch),
    timing: Math.round(timing),
    content: Math.round(content),
    dynamics: dynamics === null ? null : Math.round(dynamics),
    pitchInTunePct: ps.usable ? Math.round(100 * ps.inTuneFrac) : null,
    pitchMeanCents: ps.usable ? Math.round(100 * ps.meanAbs) : null,
    pitchUsableFrames: ps.usable,
    timingCoveredPct: Math.round((100 * covT) / activeBase),
    contentCoveredPct: Math.round((100 * covC) / activeBase),
    dynamicsCoveredPct: dynamics === null ? null : Math.round((100 * covD) / activeBase),
    weights: w,
  };
}

function buildNotes(ctx, dev, key, offsetApplied) {
  const { tempoRatio, opts } = ctx;
  const notes = [];
  if (key.n >= 10 && Math.abs(key.offset) >= 0.3) {
    const abs = Math.abs(key.offset);
    notes.push(`Overall you were ${abs.toFixed(1)} semitone${abs >= 1.05 ? 's' : ''} ${key.offset > 0 ? 'higher' : 'lower'} than the sloka${offsetApplied ? ' (ignored in the comparison)' : ''}.`);
  }
  const pct = Math.round((tempoRatio - 1) * 100);
  if (Math.abs(pct) >= 5) {
    notes.push(`Overall you took ${Math.abs(pct)}% ${pct > 0 ? 'longer' : 'less time'} than the sloka${opts.judgeSpeed ? '' : ' (speed is not judged)'}.`);
  }
  const warp = ctx.H.voiceWarp ?? 1;
  if (Math.abs(Math.log(warp)) > 0.03) {
    // A high voice has its harmonics far apart, which blurs its vowels: when the two voices
    // are far apart, a slightly wrong syllable is harder to tell from the voice itself.
    const blurred = !Number.isNaN(dev.contentFloor) && dev.contentFloor > 0.6;
    notes.push(`Your voice is ${warp > 1 ? 'lighter' : 'deeper'} in character than the sloka's (${Math.round(Math.abs(warp - 1) * 100)}%); the comparison allowed for that${blurred ? ', though small slips in the words are harder to spot across voices this far apart' : ''}.`);
  }
  if (!Number.isNaN(dev.contentFloor) && dev.contentFloor > 1.3) {
    notes.push('Your recording sounds quite different from the sloka overall (voice, microphone or room), so content deviations may be less precise.');
  }
  if (dev.pitchStats.usable < 10) {
    notes.push('Not enough steady pitch was found to judge intonation, so the pitch score is left out.');
  }
  return notes;
}

function buildChart(ctx) {
  const { B, H, jOf, iOf, offset, opts } = ctx;
  const n = B.n;
  const times = new Float32Array(n);
  const hSt = new Float32Array(n).fill(NaN);
  const hLoud = new Float32Array(n).fill(NaN);
  const hActive = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    times[i] = i * HOP_SEC;
    const j = jOf[i];
    if (j < 0) continue;
    // drawn where it is compared: key offset removed, tracker octave slips folded back
    hSt[i] = Number.isNaN(B.st[i]) ? H.st[j] - offset : B.st[i] + foldOctave(H.st[j] - B.st[i] - offset, opts.ignoreKey);
    hLoud[i] = H.loud[j];
    hActive[i] = H.active[j];
  }
  return {
    hopSec: HOP_SEC,
    times,
    bSt: Float32Array.from(B.st),
    hSt,
    bLoud: Float32Array.from(B.loud),
    hLoud,
    bActive: Uint8Array.from(B.active),
    hActive,
    jOf,
    iOf,
  };
}
