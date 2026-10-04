// Find where a short recording occurs inside a much longer one, and cut a feature
// object down to a window. Used when a take and a baseline differ a lot in length:
// one verse against a recording of eight, or a long take against a single-verse baseline.

import { N_MFCC, HOP_SEC } from './features.js';
import { percentile, fillGaps, dropShort } from './util.js';

// A self-consistent feature object for frames i0..i1 (inclusive) of F.
export function sliceFeatures(F, i0, i1) {
  i0 = Math.max(0, Math.min(F.n - 1, Math.floor(i0)));
  i1 = Math.max(i0, Math.min(F.n - 1, Math.floor(i1)));
  const n = i1 - i0 + 1;
  const rmsDb = F.rmsDb.slice(i0, i1 + 1);
  const active = F.active.slice(i0, i1 + 1);
  const st = F.st.slice(i0, i1 + 1);
  const conf = F.conf.slice(i0, i1 + 1);
  const mfcc = F.mfcc.slice(i0 * N_MFCC, (i1 + 1) * N_MFCC);
  const mfccMean = new Float32Array(N_MFCC);
  let nAct = 0;
  let nVoiced = 0;
  let first = -1;
  let last = -1;
  for (let k = 0; k < n; k++) {
    if (!Number.isNaN(st[k])) nVoiced++;
    if (!active[k]) continue;
    if (first < 0) first = k;
    last = k;
    nAct++;
    for (let c = 0; c < N_MFCC; c++) mfccMean[c] += mfcc[k * N_MFCC + c];
  }
  if (nAct) for (let c = 0; c < N_MFCC; c++) mfccMean[c] /= nAct;
  // loudness stays "relative to this recording's peak", where the recording is now the window
  const peak = percentile(Array.from(rmsDb), 0.98);
  const loud = new Float32Array(n);
  for (let k = 0; k < n; k++) loud[k] = rmsDb[k] - peak;
  const pad = Math.max(1, Math.round(0.1 / HOP_SEC));
  return {
    ...F,
    n,
    duration: n * HOP_SEC,
    rmsDb,
    loud,
    active,
    st,
    conf,
    mfcc,
    mfccMean,
    trimStart: first < 0 ? 0 : Math.max(0, first - pad),
    trimEnd: first < 0 ? n - 1 : Math.min(n - 1, last + pad),
    peakDb: peak,
    activeFrac: nAct / n,
    voicedFrac: nVoiced / n,
  };
}

// Re-derive what counts as sound with the threshold `relThr` dB below the recording's peak
// (same hysteresis and clean-up as detectActivity). Two recordings made in different rooms
// get very different automatic thresholds; judging both by one yardstick keeps the pauses
// of a quiet recording from being reported as extra sound.
export function rethreshold(F, relThr) {
  const thr = F.peakDb + relThr;
  const n = F.n;
  const active = new Uint8Array(n);
  let on = 0;
  for (let i = 0; i < n; i++) {
    if (!on && F.rmsDb[i] >= thr) on = 1;
    else if (on && F.rmsDb[i] < thr - 3) on = 0;
    active[i] = on;
  }
  const fr = (ms) => Math.max(1, Math.round(ms / 1000 / HOP_SEC));
  fillGaps(active, fr(120));
  dropShort(active, fr(60));
  const mfccMean = new Float32Array(N_MFCC);
  let nAct = 0;
  let first = -1;
  let last = -1;
  for (let k = 0; k < n; k++) {
    if (!active[k]) continue;
    if (first < 0) first = k;
    last = k;
    nAct++;
    for (let c = 0; c < N_MFCC; c++) mfccMean[c] += F.mfcc[k * N_MFCC + c];
  }
  if (!nAct) return F; // nothing would be left: keep the original
  for (let c = 0; c < N_MFCC; c++) mfccMean[c] /= nAct;
  const pad = fr(100);
  return { ...F, active, thrDb: thr, mfccMean, trimStart: Math.max(0, first - pad), trimEnd: Math.min(n - 1, last + pad), activeFrac: nAct / n };
}

// Block-averaged, mean-removed, variance-normalised MFCCs at `decim` frames per block.
function blocks(F, decim, sigma) {
  const nb = Math.ceil(F.n / decim);
  const v = new Float32Array(nb * N_MFCC);
  const act = new Uint8Array(nb);
  for (let b = 0; b < nb; b++) {
    const k0 = b * decim;
    const k1 = Math.min(F.n, k0 + decim);
    let cnt = 0;
    for (let k = k0; k < k1; k++) {
      if (!F.active[k]) continue;
      cnt++;
      for (let c = 0; c < N_MFCC; c++) v[b * N_MFCC + c] += (F.mfcc[k * N_MFCC + c] - F.mfccMean[c]) / sigma[c];
    }
    if (cnt >= 0.4 * (k1 - k0)) {
      act[b] = 1;
      for (let c = 0; c < N_MFCC; c++) v[b * N_MFCC + c] /= cnt;
    } else {
      for (let c = 0; c < N_MFCC; c++) v[b * N_MFCC + c] = 0;
    }
  }
  return { nb, v, act };
}

function pooledSigma(A, B) {
  const sum = new Float64Array(N_MFCC);
  const sq = new Float64Array(N_MFCC);
  let cnt = 0;
  for (const F of [A, B]) {
    for (let k = 0; k < F.n; k++) {
      if (!F.active[k]) continue;
      cnt++;
      for (let c = 0; c < N_MFCC; c++) { const x = F.mfcc[k * N_MFCC + c] - F.mfccMean[c]; sum[c] += x; sq[c] += x * x; }
    }
  }
  const sigma = new Float32Array(N_MFCC);
  for (let c = 0; c < N_MFCC; c++) {
    const mean = cnt ? sum[c] / cnt : 0;
    sigma[c] = Math.max(1e-3, Math.sqrt(cnt ? Math.max(0, sq[c] / cnt - mean * mean) : 1));
  }
  return sigma;
}

// Subsequence DTW of block sequence S (from block sFirst) against block sequence Lb, with
// a free start and end on the long axis and the slope limited to 0.5–2 (steps (1,1), (1,2),
// (2,1)), so the match can neither collapse nor balloon. `reverse` reads Lb backwards.
function subsequence(Sb, sFirst, Lb, reverse = false) {
  const Ns = Sb.nb - sFirst;
  const M = Lb.nb;
  const lj = (j) => (reverse ? M - 1 - j : j);
  const cost = (i, j) => {
    const a = Sb.act[i + sFirst];
    const b = Lb.act[lj(j)];
    if (!a && !b) return 0.1;
    if (a !== b) return 1.0;
    let s = 0;
    const ai = (i + sFirst) * N_MFCC;
    const bj = lj(j) * N_MFCC;
    for (let c = 0; c < N_MFCC; c++) { const t = Sb.v[ai + c] - Lb.v[bj + c]; s += t * t; }
    return Math.min(3, Math.sqrt(s / N_MFCC));
  };
  // three rolling rows of accumulated cost, path start column and step count
  const mk = () => ({ d: new Float32Array(M).fill(Infinity), st: new Int32Array(M).fill(-1), len: new Int32Array(M) });
  let r2 = mk();
  let r1 = mk();
  let r0 = mk();
  for (let i = 0; i < Ns; i++) {
    const cur = r0;
    cur.d.fill(Infinity);
    for (let j = 0; j < M; j++) {
      const c = cost(i, j);
      if (i === 0) { cur.d[j] = c; cur.st[j] = j; cur.len[j] = 1; continue; }
      let best = Infinity;
      let from = null;
      let fj = -1;
      if (j >= 1 && r1.d[j - 1] < best) { best = r1.d[j - 1]; from = r1; fj = j - 1; }
      if (j >= 2 && r1.d[j - 2] < Infinity) { const v = r1.d[j - 2] + 0.5 * cost(i, j - 1); if (v < best) { best = v; from = r1; fj = j - 2; } }
      if (i >= 2 && j >= 1 && r2.d[j - 1] < Infinity) { const v = r2.d[j - 1] + 0.5 * cost(i - 1, j); if (v < best) { best = v; from = r2; fj = j - 1; } }
      if (from === null) continue;
      cur.d[j] = best + c;
      cur.st[j] = from.st[fj];
      cur.len[j] = from.len[fj] + 1;
    }
    r0 = r2; r2 = r1; r1 = cur;
  }
  const last = r1;
  let bestJ = -1;
  let bestV = Infinity;
  for (let j = 0; j < M; j++) {
    if (last.d[j] === Infinity) continue;
    const v = last.d[j] / last.len[j];
    if (v < bestV) { bestV = v; bestJ = j; }
  }
  if (bestJ < 0) return null;
  return { startJ: last.st[bestJ], endJ: bestJ, cost: bestV };
}

// Locate the (trimmed) short recording S inside the long recording L.
// Returns frame indices into L, the mean cost per step, and `contrast`: that cost divided
// by the best cost against L played backwards. Backwards audio has the same voice, room and
// loudness but none of the content, so the ratio says how much of the match is the material
// itself: about 0.5 for the same words, close to 1 when S is not really in L.
export function locate(S, L, { decim = 5 } = {}) {
  const sigma = pooledSigma(S, L);
  const Sb = blocks({ ...S, n: S.trimEnd + 1 }, decim, sigma);
  const sFirst = Math.floor(S.trimStart / decim);
  const Lb = blocks(L, decim, sigma);
  if (Sb.nb - sFirst < 2 || Lb.nb < 2) return null;
  const fwd = subsequence(Sb, sFirst, Lb, false);
  if (!fwd) return null;
  const rev = subsequence(Sb, sFirst, Lb, true);
  const start = Math.max(0, fwd.startJ * decim);
  const end = Math.min(L.n - 1, (fwd.endJ + 1) * decim - 1);
  return { start, end, cost: fwd.cost, contrast: rev && rev.cost > 0 ? fwd.cost / rev.cost : 1 };
}
