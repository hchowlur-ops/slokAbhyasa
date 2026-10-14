// Counts the syllables (akṣaras) heard in a recording as it comes in: the nuclei of the
// loudness envelope. Chant is syllabic — every akṣara has its vowel, and the consonants
// between vowels dip the loudness — so the peaks of a smoothed 10 ms envelope, each at
// least a few dB above the valley before it and at least 80 ms after the last, count the
// akṣaras to within about a tenth, which is all the live use needs (dsp/syllables is a
// guide to where a sloka ends in a take of several; the comparison afterwards finds each
// sloka on its own). Also says how long the current pause has lasted. Streaming; pure.
import { percentile } from './util.js';

export class SyllableCounter {
  constructor(sampleRate, { frameMs = 10, minGapMs = 80, prominenceDb = 2.5, aboveFloorDb = 10, floorWindowMs = 3000, minThresholdDb = -52 } = {}) {
    this.sr = sampleRate;
    this.frame = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
    this.frameMs = frameMs;
    this.minGap = Math.max(1, Math.round(minGapMs / frameMs));
    this.prom = prominenceDb;
    this.aboveFloor = aboveFloorDb;
    this.minThr = minThresholdDb;
    this.ring = new Float32Array(Math.max(10, Math.round(floorWindowMs / frameMs)));
    this.ringN = 0;
    this.ringAt = 0;
    this.carry = new Float32Array(this.frame);
    this.carryN = 0;
    this.sm = [0, 0, 0]; // the last three frames, for the smoothing
    this.smN = 0;
    this.thr = minThresholdDb;
    this.reset(true);
  }

  // A new sloka: the count and the pause start again (the room's floor is kept).
  reset(all = false) {
    this.count = 0;
    this.frames = 0;
    this.lastNucleus = -1e9;
    if (all) this.sinceSound = 1e9; // frames since the last frame above the threshold: kept across slokas, so a page turn is no silence
    this.state = 'down';
    this.valley = 0;
    this.peak = -200;
    this.peakAt = 0;
    if (all) { this.ringN = 0; this.ringAt = 0; this.carryN = 0; this.smN = 0; }
  }

  push(samples) {
    let i = 0;
    const n = samples.length;
    while (i < n) {
      const take = Math.min(this.frame - this.carryN, n - i);
      this.carry.set(samples.subarray(i, i + take), this.carryN);
      this.carryN += take;
      i += take;
      if (this.carryN === this.frame) { this._frame(this.carry); this.carryN = 0; }
    }
    return this.state_();
  }

  _frame(x) {
    let s = 0;
    for (let k = 0; k < x.length; k++) s += x[k] * x[k];
    const db = 20 * Math.log10(Math.sqrt(s / x.length) + 1e-9);
    // the room: the quiet tenth of the last few seconds
    this.ring[this.ringAt] = db;
    this.ringAt = (this.ringAt + 1) % this.ring.length;
    if (this.ringN < this.ring.length) this.ringN++;
    if (this.frames % 10 === 0) {
      const floor = percentile(this.ring.subarray(0, this.ringN), 0.1);
      this.thr = Math.max(this.minThr, floor + this.aboveFloor);
    }
    // the envelope, smoothed over three frames
    this.sm[this.smN % 3] = db;
    this.smN++;
    const m = this.smN >= 3 ? (this.sm[0] + this.sm[1] + this.sm[2]) / 3 : db;
    const k = this.frames++;
    if (db >= this.thr - 3) this.sinceSound = 0; else this.sinceSound++;
    if (this.smN === 1) this.valley = m;
    if (this.state === 'down') {
      if (m < this.valley) this.valley = m;
      if (m >= this.valley + this.prom) { this.state = 'up'; this.peak = m; this.peakAt = k; }
    } else {
      if (m > this.peak) { this.peak = m; this.peakAt = k; }
      if (m <= this.peak - this.prom) {
        if (this.peak >= this.thr && this.peakAt - this.lastNucleus >= this.minGap) { this.count++; this.lastNucleus = this.peakAt; }
        this.state = 'down';
        this.valley = m;
      }
    }
  }

  state_() {
    return { count: this.count, pauseMs: Math.min(this.sinceSound, 1e6) * this.frameMs, elapsedMs: this.frames * this.frameMs, thresholdDb: this.thr };
  }
}
