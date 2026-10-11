// Trim silence (and isolated clicks such as the record button) from the start
// and end of a recording. Works at any sample rate; pure, no DOM.

import { fillGaps, dropShort, percentile } from './util.js';
import { activityThreshold } from './activity.js';

export const TRIM_DEFAULTS = {
  padStartMs: 120,   // keep this much before the first sound
  padEndMs: 220,     // keep this much after the last sound (natural decay)
  fadeMs: 8,         // fade at a cut edge to avoid clicks
  minRunMs: 60,      // sound shorter than this is ignored (mouse clicks)
  gapMs: 120,        // silences shorter than this inside sound are bridged
  blipMs: 150,       // an isolated sound at an edge shorter than this...
  blipGapMs: 300,    // ...followed/preceded by at least this much silence is ignored
  settleMs: 150,     // the first and last stretch of a take, where a microphone is still settling: not the room
  breathMs: 300,     // just before the first sound and after the last: a breath, not the room either
  aboveRoomDb: 8,    // sound must rise this much above the room to count
  roomMinMs: 400,    // how much lead or tail is needed to read the room from it
};

// Frame-level activity: 20 ms window, 10 ms hop, adaptive threshold with hysteresis.
export function findActiveRegion(samples, sampleRate, options = {}) {
  const o = { ...TRIM_DEFAULTS, ...options };
  const len = samples.length;
  const hop = Math.max(1, Math.round(sampleRate * 0.01));
  const win = Math.max(1, Math.round(sampleRate * 0.02));
  const n = Math.max(1, Math.floor((len - win) / hop) + 1);
  const db = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const s0 = k * hop;
    let s = 0;
    let c = 0;
    for (let i = 0; i < win && s0 + i < len; i++) { const v = samples[s0 + i]; s += v * v; c++; }
    db[k] = 20 * Math.log10(Math.sqrt(s / Math.max(1, c)) + 1e-9);
  }
  const { floor, peak, thr: thr0 } = activityThreshold(db, { samples, sampleRate, frameStart: (k) => k * hop, winFrames: 30, aboveFloor: 8, maxBelowPeak: 40 });
  const f = (ms) => Math.max(1, Math.round(ms / 10));
  // The room: the lead and the tail of the take — before the first and after the last loud
  // frame (within 20 dB of the peak), less the settling of the microphone and a breath —
  // say what the room sounds like better than the single quietest 300 ms (a microphone
  // still settling, a momentary dip), which a steady room noise can sit well above and
  // then pass for sound. The threshold stays above the room, and well below the peak.
  let thr = thr0;
  const loud = peak - 20;
  let first = 0;
  while (first < n && db[first] < loud) first++;
  let last = n - 1;
  while (last >= 0 && db[last] < loud) last--;
  const room = [];
  for (let k = f(o.settleMs); k < first - f(o.breathMs); k++) room.push(db[k]);
  for (let k = last + f(o.breathMs) + 1; k < n - f(o.settleMs); k++) room.push(db[k]);
  if (first <= last && room.length >= f(o.roomMinMs)) thr = Math.max(thr0, Math.min(percentile(room, 0.5) + o.aboveRoomDb, peak - 12));
  const mask = new Uint8Array(n);
  let on = 0;
  for (let k = 0; k < n; k++) {
    if (!on && db[k] >= thr) on = 1;
    else if (on && db[k] < thr - 3) on = 0;
    mask[k] = on;
  }
  fillGaps(mask, f(o.gapMs));
  dropShort(mask, f(o.minRunMs));

  const runs = [];
  for (let k = 0; k < n; k++) {
    if (!mask[k]) continue;
    let e = k;
    while (e + 1 < n && mask[e + 1]) e++;
    runs.push({ s: k, e });
    k = e;
  }
  // Ignore isolated short blips at either edge (a click, a cough before starting).
  const blip = f(o.blipMs);
  const blipGap = f(o.blipGapMs);
  while (runs.length > 1 && runs[0].e - runs[0].s + 1 < blip && runs[1].s - runs[0].e > blipGap) runs.shift();
  while (runs.length > 1) {
    const last = runs[runs.length - 1];
    const prev = runs[runs.length - 2];
    if (last.e - last.s + 1 < blip && last.s - prev.e > blipGap) runs.pop();
    else break;
  }
  if (!runs.length || peak < -60) {
    return { active: false, startSec: 0, endSec: len / sampleRate, floorDb: floor, peakDb: peak, thrDb: thr };
  }
  const startSec = (runs[0].s * hop) / sampleRate;
  const endSec = Math.min(len, runs[runs.length - 1].e * hop + win) / sampleRate;
  return { active: true, startSec, endSec, floorDb: floor, peakDb: peak, thrDb: thr };
}

// Returns { samples, sampleRate, changed, removedStart, removedEnd, startSec, endSec }.
// When nothing needs trimming the original samples are returned (changed = false).
export function trimSilence(samples, sampleRate, options = {}) {
  const o = { ...TRIM_DEFAULTS, ...options };
  const len = samples.length;
  const region = findActiveRegion(samples, sampleRate, o);
  const unchanged = { samples, sampleRate, changed: false, removedStart: 0, removedEnd: 0, startSec: 0, endSec: len / sampleRate, region };
  if (!region.active) return unchanged;
  const start = Math.max(0, Math.round(region.startSec * sampleRate - (o.padStartMs / 1000) * sampleRate));
  const end = Math.min(len, Math.round(region.endSec * sampleRate + (o.padEndMs / 1000) * sampleRate));
  // Ignore cuts under 50 ms at both ends, so trimming an already-trimmed file is a no-op.
  const minCut = Math.round(0.05 * sampleRate);
  if (start < minCut && len - end < minCut) return unchanged;
  const out = samples.slice(start, end);
  const fade = Math.min(Math.round((o.fadeMs / 1000) * sampleRate), Math.floor(out.length / 2));
  if (start > 0) for (let i = 0; i < fade; i++) out[i] *= i / fade;
  if (end < len) for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return {
    samples: out,
    sampleRate,
    changed: true,
    removedStart: start / sampleRate,
    removedEnd: (len - end) / sampleRate,
    startSec: start / sampleRate,
    endSec: end / sampleRate,
    region,
  };
}
