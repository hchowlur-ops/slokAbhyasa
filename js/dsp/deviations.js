// Deviation detection on top of an alignment. Everything is expressed on the
// sloka timeline (frame indices into the sloka feature record) with the
// matching heard-time range attached, so the UI can audition both sides.

import { msToFrames, HOP_SEC } from './features.js';
import { findRuns, movingMedianNaN, medianOf, madOf, clamp } from './util.js';

const f = msToFrames;
const tStart = (i) => i * HOP_SEC;
const tEnd = (i) => (i + 1) * HOP_SEC;

// The least content distance (in pooled-std units) that can count as "sounds different".
// Measured on real recordings: the same performance in two trims, the same sloka located in
// a longer take, and the same recording resampled to a child-like or deeper voice all stay
// below 1.0; a skipped phrase scores about 1.5, a different sloka 1.3 and up throughout.
export const CONTENT_FLOOR = 1.1;

// A pitch difference of more than half an octave is almost always the pitch tracker landing
// on the other octave of the same note (a child's or a deep voice does that often), or a
// learner who sings in another register; it is not a note sung that far off. When the key is
// being ignored, pitch is compared within the octave: the difference is folded to within
// 600 cents (the convention of the pitch-imitation literature and of karaoke scorers).
export function foldOctave(d, ignoreKey) {
  if (!ignoreKey || Number.isNaN(d)) return d;
  return d - 12 * Math.round(d / 12);
}

// The pitch-deviation thresholds for a tolerance (adults 0.5 semitones; children more).
export function pitchBands(tolSt = 0.5) {
  const k = tolSt / 0.5;
  return { run: 0.4 * k, strong: 0.6 * k, inTune: tolSt, creditFree: 0.25 * k, creditSpan: 1 * k };
}
// Sustained pitch differences count only from this length: pitch error falls with note
// length, and an older voice's tremor (2–5 Hz) averages out at this scale.
export const PITCH_MIN_MS = 250;
export const PITCH_SMOOTH_FRAMES = 13; // ~260 ms moving median

// ---------- note / onset segmentation ----------

export function segmentNotes(F, from, to) {
  const onsets = new Set();
  for (let i = from; i <= to; i++) if (F.active[i] && (i === from || !F.active[i - 1])) onsets.add(i);

  const notes = [];
  let i = from;
  while (i <= to) {
    if (Number.isNaN(F.st[i])) { i++; continue; }
    let j = i;
    while (j + 1 <= to && !Number.isNaN(F.st[j + 1])) j++;
    let noteStart = i;
    let vals = [];
    let devCount = 0;
    for (let k = i; k <= j; k++) {
      if (vals.length >= 3) {
        const med = medianOf(vals.slice(-10));
        if (Math.abs(F.st[k] - med) > 0.8) {
          devCount++;
          if (devCount >= 3) {
            notes.push({ start: noteStart, end: k - 3, st: medianOf(vals.slice(0, vals.length - 2)) });
            noteStart = k - 2;
            vals = [F.st[k - 2], F.st[k - 1], F.st[k]];
            devCount = 0;
            continue;
          }
        } else devCount = 0;
      }
      vals.push(F.st[k]);
    }
    notes.push({ start: noteStart, end: j, st: medianOf(vals) });
    i = j + 1;
  }
  const minLen = f(80);
  const merged = [];
  for (const nt of notes) {
    const prev = merged[merged.length - 1];
    if (nt.end - nt.start + 1 < minLen && prev && prev.end === nt.start - 1) prev.end = nt.end;
    else merged.push({ ...nt });
  }
  for (const nt of merged) onsets.add(nt.start);
  return { notes: merged, onsets: Int32Array.from([...onsets].sort((a, b) => a - b)) };
}

// ---------- masks ----------

function jumpMask(st, w = 2) {
  const n = st.length;
  const m = new Uint8Array(n);
  for (let k = 0; k + 1 < n; k++) {
    if (Number.isNaN(st[k]) || Number.isNaN(st[k + 1])) continue;
    if (Math.abs(st[k + 1] - st[k]) > 2) for (let i = Math.max(0, k - w + 1); i <= Math.min(n - 1, k + w); i++) m[i] = 1;
  }
  return m;
}

function edgeMask(active, w) {
  const n = active.length;
  const m = new Uint8Array(n);
  for (let k = 0; k + 1 < n; k++) {
    if (active[k] !== active[k + 1]) for (let i = Math.max(0, k - w + 1); i <= Math.min(n - 1, k + w); i++) m[i] = 1;
  }
  return m;
}

function countActive(active, a, b) {
  let c = 0;
  for (let i = a; i <= b; i++) if (active[i]) c++;
  return c;
}

// ---------- main ----------

export function detectDeviations(ctx) {
  const { B, H, jOf, iOf, matched, tempoRatio, pathDist, offset, opts } = ctx;
  const preset = (opts && opts.preset) || {};
  const bands = pitchBands(preset.pitchTolSt || 0.5);
  const speedBand = preset.speedBand || [0.75, 1.33];
  const contentFloor = preset.contentFloor || CONTENT_FLOOR;
  const n = B.n;
  const m = H.n;
  const devs = [];

  const heardRangeOf = (i0, i1) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = i0; i <= i1; i++) {
      const j = jOf[i];
      if (j >= 0) { if (j < lo) lo = j; if (j > hi) hi = j; }
    }
    return lo === Infinity ? null : [tStart(lo), tEnd(hi)];
  };
  const nearestHeard = (i) => {
    for (let d = 0; d < n; d++) {
      if (i - d >= 0 && jOf[i - d] >= 0) return jOf[i - d];
      if (i + d < n && jOf[i + d] >= 0) return jOf[i + d];
    }
    return 0;
  };
  const push = (d) => {
    d.tBase = d.tBase || [tStart(d.bStart), tEnd(d.bEnd)];
    d.types = d.types || [d.type];
    devs.push(d);
  };

  const { notes, onsets } = segmentNotes(B, B.trimStart, B.trimEnd);

  // ---- pitch ----
  const bSm = movingMedianNaN(B.st, PITCH_SMOOTH_FRAMES);
  const hSm = movingMedianNaN(H.st, PITCH_SMOOTH_FRAMES);
  const bJump = jumpMask(B.st);
  const hJump = jumpMask(H.st);
  const noteHead = new Uint8Array(n);
  const headLen = f(80);
  for (const nt of notes) for (let i = nt.start; i < Math.min(n, nt.start + headLen); i++) noteHead[i] = 1;
  const delta = new Float32Array(n).fill(NaN);
  let usable = 0;
  let sumAbs = 0;
  let inTune = 0;
  let credit = 0;
  for (let i = matched.iStart; i <= matched.iEnd; i++) {
    const j = jOf[i];
    if (j < 0) continue;
    if (Number.isNaN(bSm[i]) || Number.isNaN(hSm[j])) continue;
    if (B.conf[i] < 0.8 || H.conf[j] < 0.8) continue;
    if (bJump[i] || hJump[j] || noteHead[i]) continue;
    const d = foldOctave(hSm[j] - bSm[i] - offset, opts.ignoreKey);
    delta[i] = d;
    const a = Math.abs(d);
    usable++;
    sumAbs += a;
    if (a <= bands.inTune) inTune++;
    credit += clamp(1 - Math.max(0, a - bands.creditFree) / bands.creditSpan, 0, 1);
  }
  const pitchStats = {
    usable,
    meanAbs: usable ? sumAbs / usable : NaN,
    inTuneFrac: usable ? inTune / usable : NaN,
    creditMean: usable ? credit / usable : NaN,
  };
  for (const run of findRuns(n, (i) => !Number.isNaN(delta[i]) && Math.abs(delta[i]) > bands.run, { minLen: f(PITCH_MIN_MS), maxGap: 2 })) {
    let c6 = 0;
    let c4 = 0;
    let sum = 0;
    let cnt = 0;
    for (let i = run.start; i <= run.end; i++) {
      const d = delta[i];
      if (Number.isNaN(d)) continue;
      cnt++;
      sum += d;
      if (Math.abs(d) > bands.strong) c6++;
      if (Math.abs(d) > bands.run) c4++;
    }
    const len = run.end - run.start + 1;
    if (c6 < f(PITCH_MIN_MS) || c4 / len < 0.7) continue;
    const mean = sum / cnt;
    const abs = Math.abs(mean);
    push({
      type: 'pitch',
      bStart: run.start,
      bEnd: run.end,
      tHeard: heardRangeOf(run.start, run.end),
      severity: abs < 1 ? 1 : abs < 2 ? 2 : 3,
      value: mean,
      label: `${abs.toFixed(1)} semitone${abs >= 1.05 ? 's' : ''} ${mean > 0 ? 'sharp' : 'flat'}`,
      detail: `Your pitch was ${mean > 0 ? 'higher' : 'lower'} than the sloka here by about ${Math.round(abs * 100)} cents.`,
    });
  }

  // ---- timing: inter-onset intervals ----
  const r = tempoRatio;
  const on = Array.from(onsets).filter((i) => i >= matched.iStart && i <= matched.iEnd && jOf[i] >= 0);
  const minIOI = f(100);
  for (let k = 0; k + 1 < on.length; k++) {
    const b0 = on[k];
    const b1 = on[k + 1];
    if (b1 - b0 < minIOI) continue;
    const m0 = jOf[b0];
    const m1 = jOf[b1];
    const ioiB = b1 - b0;
    const ioiH = Math.max(0, m1 - m0);
    const ratio = ioiH / ioiB / r;
    const dSec = (ioiH - r * ioiB) * HOP_SEC;
    let kind = null;
    if (ratio > speedBand[1] && dSec > 0.08) kind = 'slow';
    else if (ratio < speedBand[0] && dSec < -0.08) kind = 'fast';
    if (!kind) continue;
    const a = Math.abs(Math.log(Math.max(ratio, 1e-3)));
    let silentFrames = 0;
    for (let j = m0; j < m1; j++) if (!H.active[j]) silentFrames++;
    const pauseSec = silentFrames * HOP_SEC;
    let label;
    let detail;
    if (kind === 'slow' && pauseSec >= 0.3) { label = `Paused for ${pauseSec.toFixed(1)} s`; detail = 'You stopped here while the sloka continues.'; }
    else if (ratio > 2.5) { label = 'Added something or lingered'; detail = `This part took ${ratio.toFixed(1)}× as long as in the sloka.`; }
    else if (kind === 'slow') { label = `Slowed down (${ratio.toFixed(1)}× longer)`; detail = 'You lingered here longer than the sloka does.'; }
    else if (ratio < 0.4) { label = 'Skipped or rushed through'; detail = `This part took only ${Math.round(ratio * 100)}% of the sloka's time.`; }
    else { label = `Rushed (${(1 / ratio).toFixed(1)}× faster)`; detail = 'You moved through this part faster than the sloka does.'; }
    // Merely slower or faster is a matter of pace, which only counts when speed is judged;
    // a pause, a skip and an addition are not.
    const paceOnly = (kind === 'slow' && pauseSec < 0.3 && ratio <= 2.5) || (kind === 'fast' && ratio >= 0.4);
    if (paceOnly && !opts.judgeSpeed) continue;
    push({
      type: 'timing',
      bStart: b0,
      bEnd: b1 - 1,
      tHeard: [tStart(m0), tEnd(Math.max(m0, m1 - 1))],
      severity: a < 0.5 ? 1 : a < 0.9 ? 2 : 3,
      value: ratio,
      label,
      detail,
    });
  }
  // pauses in the heard recording where the sloka keeps going
  for (const run of findRuns(m, (j) => j >= matched.jStart && j <= matched.jEnd && !H.active[j] && iOf[j] >= 0 && B.active[iOf[j]], { minLen: f(300), maxGap: 1 })) {
    const i0 = iOf[run.start];
    const i1 = iOf[run.end];
    const dur = (run.end - run.start + 1) * HOP_SEC;
    push({
      type: 'timing',
      bStart: Math.min(i0, i1),
      bEnd: Math.max(i0, i1),
      tHeard: [tStart(run.start), tEnd(run.end)],
      severity: dur > 1 ? 2 : 1,
      value: null,
      label: `Pause not in the sloka (${dur.toFixed(1)} s)`,
      detail: 'You stopped here while the sloka continues.',
    });
  }

  // ---- missing ----
  const minMiss = f(200);
  const pushMissing = (s, e, label, detail, tHeard, edge) => push({
    ...(edge ? { edge } : {}),
    type: 'missing',
    bStart: s,
    bEnd: e,
    tHeard,
    severity: e - s + 1 > f(1000) ? 3 : 2,
    value: null,
    label,
    detail,
  });
  for (const run of findRuns(n, (i) => i >= matched.iStart && i <= matched.iEnd && B.active[i] && jOf[i] >= 0 && !H.active[jOf[i]], { minLen: minMiss, maxGap: 2 })) {
    const j = nearestHeard(run.start);
    pushMissing(run.start, run.end, 'Not heard', 'The sloka has sound here that was not found in your recording.', [tStart(j), tStart(j) + 0.3]);
  }
  {
    let s = matched.iStart;
    while (s <= matched.iEnd) {
      if (jOf[s] < 0) { s++; continue; }
      let e = s;
      while (e + 1 <= matched.iEnd && jOf[e + 1] >= 0 && jOf[e + 1] - jOf[s] <= 2) e++;
      if (e - s + 1 >= minMiss && countActive(B.active, s, e) >= 0.7 * (e - s + 1)) {
        const j = jOf[s];
        pushMissing(s, e, 'Skipped', 'This stretch of the sloka was collapsed into a moment of your recording.', [tStart(j), tStart(j) + 0.3]);
      }
      s = e + 1;
    }
  }
  if (matched.iStart > B.trimStart && countActive(B.active, B.trimStart, matched.iStart - 1) >= minMiss) {
    pushMissing(B.trimStart, matched.iStart - 1, 'Beginning not heard', 'Your recording seems to start after the sloka does.', [tStart(matched.jStart), tStart(matched.jStart) + 0.3], 'start');
  }
  if (matched.iEnd < B.trimEnd && countActive(B.active, matched.iEnd + 1, B.trimEnd) >= minMiss) {
    pushMissing(matched.iEnd + 1, B.trimEnd, 'Ending not heard', 'Your recording seems to stop before the sloka ends.', [Math.max(0, tStart(matched.jEnd) - 0.3), tEnd(matched.jEnd)], 'end');
  }

  // ---- extra ----
  const pushExtra = (j0, j1, i0, i1, label, detail, edge) => push({
    ...(edge ? { edge } : {}),
    type: 'extra',
    bStart: Math.min(i0, i1),
    bEnd: Math.max(i0, i1),
    tHeard: [tStart(j0), tEnd(j1)],
    severity: j1 - j0 + 1 > f(1000) ? 2 : 1,
    value: null,
    label,
    detail,
  });
  for (const run of findRuns(m, (j) => j >= matched.jStart && j <= matched.jEnd && H.active[j] && iOf[j] >= 0 && !B.active[iOf[j]], { minLen: minMiss, maxGap: 2 })) {
    pushExtra(run.start, run.end, iOf[run.start], iOf[run.end], 'Extra sound', 'You added something here that the sloka does not have.');
  }
  if (matched.jStart > H.trimStart && countActive(H.active, H.trimStart, matched.jStart - 1) >= minMiss) {
    pushExtra(H.trimStart, matched.jStart - 1, matched.iStart, matched.iStart, 'Extra sound before the start', 'Your recording has sound before the part that matches the sloka.', 'start');
  }
  if (matched.jEnd < H.trimEnd && countActive(H.active, matched.jEnd + 1, H.trimEnd) >= minMiss) {
    pushExtra(matched.jEnd + 1, H.trimEnd, matched.iEnd, matched.iEnd, 'Extra sound after the end', 'Your recording continues after the sloka has ended.', 'end');
  }

  // ---- content ----
  const dm = movingMedianNaN(pathDist, 5);
  const edgeB = edgeMask(B.active, f(40));
  const edgeH = edgeMask(H.active, f(40));
  const eligible = new Uint8Array(n);
  const vals = [];
  for (let i = matched.iStart; i <= matched.iEnd; i++) {
    const j = jOf[i];
    if (j < 0 || !B.active[i] || !H.active[j] || edgeB[i] || edgeH[j] || Number.isNaN(dm[i])) continue;
    eligible[i] = 1;
    vals.push(dm[i]);
  }
  const med = vals.length ? medianOf(vals) : NaN;
  const mad = vals.length ? madOf(vals, med) : NaN;
  const thr = vals.length ? Math.max(med + 2.0 * mad, contentFloor) : Infinity;
  for (const run of findRuns(n, (i) => eligible[i] && dm[i] > thr, { minLen: f(160), maxGap: 2 })) {
    let sum = 0;
    let cnt = 0;
    for (let i = run.start; i <= run.end; i++) if (eligible[i]) { sum += dm[i]; cnt++; }
    const excess = (sum / cnt - thr) / thr;
    push({
      type: 'content',
      bStart: run.start,
      bEnd: run.end,
      tHeard: heardRangeOf(run.start, run.end),
      severity: excess < 0.3 ? 1 : excess < 0.8 ? 2 : 3,
      value: sum / cnt,
      label: 'Sounds different',
      detail: 'The sounds here do not match the sloka well. Check the words or notes at this spot.',
    });
  }

  // ---- dynamics (optional) ----
  if (opts.flagDynamics) {
    const dl = new Float32Array(n).fill(NaN);
    for (let i = matched.iStart; i <= matched.iEnd; i++) {
      const j = jOf[i];
      if (j >= 0 && B.active[i] && H.active[j]) dl[i] = H.loud[j] - B.loud[i];
    }
    for (const run of findRuns(n, (i) => !Number.isNaN(dl[i]) && Math.abs(dl[i]) > 10, { minLen: f(400), maxGap: 3 })) {
      let sum = 0;
      let cnt = 0;
      for (let i = run.start; i <= run.end; i++) if (!Number.isNaN(dl[i])) { sum += dl[i]; cnt++; }
      const mean = sum / cnt;
      push({
        type: 'dynamics',
        bStart: run.start,
        bEnd: run.end,
        tHeard: heardRangeOf(run.start, run.end),
        severity: 1,
        value: mean,
        label: `${mean > 0 ? 'Louder' : 'Softer'} than the sloka (${Math.abs(mean).toFixed(0)} dB)`,
        detail: 'Relative loudness differs from the sloka here.',
      });
    }
  }

  // ---- post-processing ----
  const merged = mergeSameType(devs, f(100));
  const combined = mergePitchIntoContent(merged);
  for (const d of combined) {
    if (d.tBase[1] - d.tBase[0] > 1 && d.type !== 'dynamics') d.severity = Math.min(3, d.severity + 1);
  }
  combined.sort((a, b) => a.tBase[0] - b.tBase[0] || b.severity - a.severity);
  let final = combined;
  if (final.length > 60) {
    final = [...combined].sort((a, b) => b.severity - a.severity || a.tBase[0] - b.tBase[0]).slice(0, 60);
    final.sort((a, b) => a.tBase[0] - b.tBase[0]);
  }
  final.forEach((d, idx) => { d.id = idx; });

  const coverTiming = new Uint8Array(n);
  const coverContent = new Uint8Array(n);
  const coverDynamics = new Uint8Array(n);
  for (const d of final) {
    const timingLike = d.types.some((t) => t === 'timing' || t === 'missing' || t === 'extra');
    const contentLike = d.types.some((t) => t === 'content' || t === 'missing');
    const dynamicsLike = d.types.includes('dynamics');
    for (let i = d.bStart; i <= d.bEnd; i++) {
      if (timingLike) coverTiming[i] = 1;
      if (contentLike) coverContent[i] = 1;
      if (dynamicsLike) coverDynamics[i] = 1;
    }
  }

  return { deviations: final, pitchStats, coverTiming, coverContent, coverDynamics, contentFloor: med, notesCount: notes.length };
}

function mergeSameType(devs, gap) {
  const byType = new Map();
  for (const d of devs) {
    if (!byType.has(d.type)) byType.set(d.type, []);
    byType.get(d.type).push(d);
  }
  const out = [];
  for (const list of byType.values()) {
    list.sort((a, b) => a.bStart - b.bStart);
    let cur = null;
    for (const d of list) {
      if (cur && d.bStart <= cur.bEnd + gap) {
        cur.bEnd = Math.max(cur.bEnd, d.bEnd);
        cur.tBase = [cur.tBase[0], Math.max(cur.tBase[1], d.tBase[1])];
        if (cur.tHeard && d.tHeard) cur.tHeard = [Math.min(cur.tHeard[0], d.tHeard[0]), Math.max(cur.tHeard[1], d.tHeard[1])];
        if (d.severity > cur.severity) { cur.severity = d.severity; cur.label = d.label; cur.detail = d.detail; cur.value = d.value; }
      } else {
        cur = { ...d };
        out.push(cur);
      }
    }
  }
  return out;
}

function mergePitchIntoContent(devs) {
  const content = devs.filter((d) => d.type === 'content');
  const pitch = devs.filter((d) => d.type === 'pitch');
  const absorbed = new Set();
  for (const c of content) {
    for (const p of pitch) {
      if (absorbed.has(p)) continue;
      const overlap = Math.min(c.bEnd, p.bEnd) - Math.max(c.bStart, p.bStart) + 1;
      const shorter = Math.min(c.bEnd - c.bStart + 1, p.bEnd - p.bStart + 1);
      if (overlap > 0 && overlap >= 0.5 * shorter) {
        absorbed.add(p);
        c.types = [...c.types, 'pitch'];
        c.label = `${c.label} · ${p.label}`;
        c.detail = `${c.detail} Pitch also differs here (${p.label}).`;
        c.severity = Math.max(c.severity, p.severity);
        c.bStart = Math.min(c.bStart, p.bStart);
        c.bEnd = Math.max(c.bEnd, p.bEnd);
        c.tBase = [Math.min(c.tBase[0], p.tBase[0]), Math.max(c.tBase[1], p.tBase[1])];
      }
    }
  }
  return devs.filter((d) => !absorbed.has(d));
}
