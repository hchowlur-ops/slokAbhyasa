// Pāda-start fingerprints: the first 0.8 s of MFCC frames at each pāda's start (and at the
// sloka's) in the teacher's recording, so that what a learner sings after a pause can be
// placed — "that is pāda 3 again" — which is how a restart is heard. Templates come from
// the recording's features cache (dsp/features.js) and the timings of its transcript (one
// chunk per line of the text); a live stretch is matched by a small DTW over the frames,
// each side with its own cepstral mean taken off so the voices' colour matters less than
// the sounds. A match is trusted only against a threshold calibrated on the teacher's own
// recording (how far its pāda starts lie from one another) and with a margin over the
// runner-up: a doubtful match is no match. Pure; shared with the tests.
import { N_MFCC, HOP_SEC } from './features.js';
import { syllabify } from '../phon.js';

export const TEMPLATE_SEC = 0.8;
export const TEMPLATE_FRAMES = Math.round(TEMPLATE_SEC / HOP_SEC);
export const MIN_TEMPLATE_FRAMES = 15; // 0.3 s: less says too little

// Rows of MFCCs from a features object: `count` frames from `fromFrame`, each minus a mean
// (the recording's own by default: cepstral mean normalisation).
export function mfccRows(F, fromFrame, count, { mean = F.mfccMean || null } = {}) {
  const rows = [];
  const n0 = Math.max(0, fromFrame);
  for (let k = n0; k < Math.min(F.n, n0 + count); k++) {
    const row = new Float32Array(N_MFCC);
    for (let c = 0; c < N_MFCC; c++) row[c] = F.mfcc[k * N_MFCC + c] - (mean ? mean[c] : 0);
    rows.push(row);
  }
  return rows;
}
// A stretch's own mean, for a live stretch that has no recording-wide mean.
export function meanOf(F) {
  const m = new Float32Array(N_MFCC);
  if (!F.n) return m;
  for (let k = 0; k < F.n; k++) for (let c = 0; c < N_MFCC; c++) m[c] += F.mfcc[k * N_MFCC + c];
  for (let c = 0; c < N_MFCC; c++) m[c] /= F.n;
  return m;
}

// Where each pāda starts in a recording (seconds), from the transcript's chunks — one per
// line of the text, the speaker line first when the plan has one — and the akṣara plan: a
// line that holds several pādas is split by the akṣara share. [{ pada, at }], pada 0 the
// speaker line, 1… the pādas; the first entry is the sloka's start.
export function padaStarts(chunks, plan) {
  const cs = (chunks || []).filter((c) => c && typeof c.start === 'number' && typeof c.end === 'number' && c.end > c.start);
  if (!cs.length || !plan || !plan.padas || !plan.padas.length) return [];
  const out = [];
  let lines = cs;
  if (plan.speakerLine && cs.length > 1) { out.push({ pada: 0, at: cs[0].start }); lines = cs.slice(1); }
  const P = plan.padas.length;
  const L = lines.length;
  const per = Math.max(1, Math.round(P / L)); // pādas per line (2 for an anuṣṭubh's half-verses, 1 for a triṣṭubh's pādas)
  let pada = 1;
  for (let i = 0; i < L && pada <= P; i++) {
    const line = lines[i];
    const here = i === L - 1 ? P - pada + 1 : Math.min(per, P - pada + 1); // the last line takes what is left
    const counts = plan.padas.slice(pada - 1, pada - 1 + here);
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    for (const c of counts) { out.push({ pada, at: line.start + ((line.end - line.start) * acc) / total }); acc += c; pada++; }
  }
  return out;
}
// The same when the chunks carry their text but the plan is unknown: one pāda per chunk.
export const lineStarts = (chunks) => (chunks || []).filter((c) => c && typeof c.start === 'number').map((c, i) => ({ pada: i + 1, at: c.start, aksharas: syllabify(c.text || '').length }));

// The templates of a recording: the frames at each start.
export function startTemplates(F, starts, { frames = TEMPLATE_FRAMES } = {}) {
  const out = [];
  for (const s of starts || []) {
    const from = Math.round(s.at / F.hopSec);
    const rows = mfccRows(F, from, frames);
    if (rows.length >= MIN_TEMPLATE_FRAMES) out.push({ pada: s.pada, at: s.at, rows });
  }
  return out;
}

// Distance between two frame lists: a banded DTW on the Euclidean distance of the frames,
// the path's mean cost (so lengths do not matter).
export function dtwDistance(A, B, { band = 0.35 } = {}) {
  const N = A.length;
  const M = B.length;
  if (!N || !M) return Infinity;
  const r = Math.max(2, Math.ceil(band * Math.max(N, M)));
  const INF = Infinity;
  let prev = new Float64Array(M + 1).fill(INF);
  let prevLen = new Int32Array(M + 1);
  prev[0] = 0;
  const d = (a, b) => { let s = 0; for (let c = 0; c < a.length; c++) { const x = a[c] - b[c]; s += x * x; } return Math.sqrt(s); };
  for (let i = 1; i <= N; i++) {
    const cur = new Float64Array(M + 1).fill(INF);
    const curLen = new Int32Array(M + 1);
    const centre = Math.round(((i - 1) * (M - 1)) / Math.max(1, N - 1)) + 1;
    const jLo = Math.max(1, centre - r);
    const jHi = Math.min(M, centre + r);
    for (let j = jLo; j <= jHi; j++) {
      const c = d(A[i - 1], B[j - 1]);
      let best = prev[j - 1]; let len = prevLen[j - 1]; // diagonal
      if (prev[j] < best) { best = prev[j]; len = prevLen[j]; }
      if (cur[j - 1] < best) { best = cur[j - 1]; len = curLen[j - 1]; }
      if (best === INF) continue;
      cur[j] = best + c;
      curLen[j] = len + 1;
    }
    prev = cur; prevLen = curLen;
  }
  return prev[M] === INF ? INF : prev[M] / Math.max(1, prevLen[M]);
}

// How far apart the teacher's own starts lie: the threshold under which a live match is
// believed. Each template's nearest other template, and a few places elsewhere in the
// recording, give the "not this start" distances; the threshold sits well under their
// median. null with fewer than two templates (nothing to tell apart).
export function calibrate(templates, F = null, { frames = TEMPLATE_FRAMES, factor = 0.55 } = {}) {
  if (!templates || templates.length < 2) return { threshold: null, others: [] };
  const others = [];
  for (const t of templates) {
    let min = Infinity;
    for (const o of templates) if (o !== t) min = Math.min(min, dtwDistance(t.rows, o.rows));
    if (F && F.n) {
      for (let at = frames; at + frames <= F.n; at += Math.round(2 / F.hopSec)) {
        if (Math.abs(at * F.hopSec - t.at) < 1.5) continue; // not its own neighbourhood
        min = Math.min(min, dtwDistance(t.rows, mfccRows(F, at, frames)));
      }
    }
    if (Number.isFinite(min)) others.push(min);
  }
  if (!others.length) return { threshold: null, others };
  const sorted = others.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { threshold: median * factor, others };
}

// Where a live stretch of frames (its own mean taken off) stands: the nearest template,
// the runner-up, the margin between them, and whether the match is to be believed.
export function matchStart(rows, templates, { threshold = null, margin = 1.2 } = {}) {
  const scored = (templates || []).map((t) => ({ pada: t.pada, at: t.at, dist: dtwDistance(rows, t.rows) })).sort((a, b) => a.dist - b.dist);
  const best = scored[0] || null;
  const runnerUp = scored[1] || null;
  const m = best && runnerUp && best.dist > 0 ? runnerUp.dist / best.dist : best ? Infinity : 0;
  const confident = !!best && threshold != null && best.dist <= threshold && (!runnerUp || m >= margin);
  return { best, runnerUp, margin: m, confident };
}
