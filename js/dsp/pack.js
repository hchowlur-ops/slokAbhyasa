// Packing stretches of a recording into one Whisper window. The encoder prices every
// hearing as 30 seconds whatever is in it, so two short slokas are heard together; and
// since a sloka's stretch carries silence — before it, after it, between its pādas — the
// packed clip keeps only the sound, with a short gap wherever a silence longer than the
// gap was, and a map that puts every timestamp back where it came from. Pure; shared with
// the tests.
import { percentile } from './util.js';

export const PACK_DEFAULTS = { frameMs: 20, gapSec: 0.4, maxSilenceSec: 0.5, aboveFloorDb: 10, minThresholdDb: -50, edgeSec: 0.12 };

// The sounding runs of a clip, in seconds: [{ start, end }], with silences shorter than
// `maxSilenceSec` kept inside a run (a breath between words is sound for this purpose).
export function soundRuns(samples, sr, opts = {}) {
  const o = { ...PACK_DEFAULTS, ...opts };
  const frame = Math.max(1, Math.round((sr * o.frameMs) / 1000));
  const n = Math.floor(samples.length / frame);
  if (!n) return [];
  const db = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = k * frame; i < (k + 1) * frame; i++) s += samples[i] * samples[i];
    db[k] = 20 * Math.log10(Math.sqrt(s / frame) + 1e-9);
  }
  const floor = percentile(db, 0.1);
  const thr = Math.max(o.minThresholdDb, floor + o.aboveFloorDb);
  const runs = [];
  let start = -1;
  let quiet = 0;
  const maxQuiet = Math.round((o.maxSilenceSec * 1000) / o.frameMs);
  for (let k = 0; k < n; k++) {
    if (db[k] >= thr) { if (start < 0) start = k; quiet = 0; }
    else if (start >= 0) { quiet++; if (quiet > maxQuiet) { runs.push({ start: start * frame / sr, end: (k - quiet + 1) * frame / sr }); start = -1; quiet = 0; } }
  }
  if (start >= 0) runs.push({ start: start * frame / sr, end: (n - quiet) * frame / sr });
  return runs;
}

// One clip from several stretches: each stretch's sounding runs, a little room at their
// edges, `gapSec` of silence between runs and between stretches. Returns the clip and a
// map: for each kept run, where it lies in the clip and where it came from (the stretch
// and the time within it), plus `boundaries`, the clip time each stretch begins at.
export function packClips(parts, sr, opts = {}) {
  const o = { ...PACK_DEFAULTS, ...opts };
  const gap = Math.round(o.gapSec * sr);
  const edge = o.edgeSec;
  const pieces = []; // { part, srcStart, srcEnd } in seconds
  parts.forEach((samples, part) => {
    const runs = soundRuns(samples, sr, o);
    const dur = samples.length / sr;
    if (!runs.length) { pieces.push({ part, srcStart: 0, srcEnd: Math.min(dur, 1) }); return; } // nothing heard: a second of it, so the stretch is still represented
    for (const r of runs) pieces.push({ part, srcStart: Math.max(0, r.start - edge), srcEnd: Math.min(dur, r.end + edge) });
  });
  let total = 0;
  for (let i = 0; i < pieces.length; i++) total += Math.round((pieces[i].srcEnd - pieces[i].srcStart) * sr) + (i ? gap : 0);
  const out = new Float32Array(total);
  const map = [];
  const boundaries = [];
  let at = 0;
  let lastPart = -1;
  pieces.forEach((p, i) => {
    if (i) at += gap;
    if (p.part !== lastPart) { boundaries.push(at / sr); lastPart = p.part; }
    const a = Math.round(p.srcStart * sr);
    const b = Math.round(p.srcEnd * sr);
    out.set(parts[p.part].subarray(a, b), at);
    map.push({ part: p.part, clipStart: at / sr, clipEnd: (at + b - a) / sr, srcStart: p.srcStart });
    at += b - a;
  });
  return { samples: out, map, boundaries, seconds: total / sr };
}

// A moment of the clip back in its stretch: { part, time }. A moment in a gap belongs to
// the run before it, at that run's end.
export function unpackTime(map, t) {
  if (!map.length) return { part: 0, time: t };
  let run = map[0];
  for (const m of map) { if (t >= m.clipStart) run = m; else break; }
  const within = Math.max(0, Math.min(run.clipEnd - run.clipStart, t - run.clipStart));
  return { part: run.part, time: run.srcStart + within };
}

// The clip's transcript split into the stretches' own: each timed phrase goes to the
// stretch its midpoint lies in, its times put back into that stretch's time. A stretch
// no phrase fell in gets null.
export function unpackTranscript(t, map, partCount) {
  const out = Array.from({ length: partCount }, () => []);
  for (const c of (t && Array.isArray(t.chunks) ? t.chunks : [])) {
    if (!c || typeof c.text !== 'string') continue;
    const s = typeof c.start === 'number' ? c.start : 0;
    const e = typeof c.end === 'number' ? c.end : s;
    const { part } = unpackTime(map, (s + e) / 2);
    const a = unpackTime(map, s);
    const b = typeof c.end === 'number' ? unpackTime(map, e) : null;
    out[part].push({ ...c, start: Math.round(a.time * 100) / 100, end: b ? Math.max(Math.round(a.time * 100) / 100, Math.round(b.time * 100) / 100) : c.end });
  }
  return out.map((chunks) => (chunks.length ? { ...t, text: chunks.map((c) => c.text.trim()).filter(Boolean).join(' '), chunks } : null));
}
