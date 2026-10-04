// Adaptive activity threshold shared by feature extraction and silence trimming.
//
// The noise floor is taken from the quietest ~300 ms window of the take, but it is
// only trusted when that window looks like noise or silence: steady in level and
// spectrally flat. A soft sustained note is harmonic (not flat), so a take with no
// silence at all does not get its soft parts mistaken for background noise.

import { createFFT, powerSpectrum } from './fft.js';
import { percentile } from './util.js';

const N = 512;
let fft = null;
let re;
let im;
let pow;
let frame;
let hann;

function ensure() {
  if (fft) return;
  fft = createFFT(N);
  re = new Float32Array(N);
  im = new Float32Array(N);
  pow = new Float32Array(N / 2 + 1);
  frame = new Float32Array(N);
  hann = new Float32Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
}

// Spectral flatness (geometric / arithmetic mean of the power spectrum) between
// 300 Hz and 5 kHz for the 512 samples starting at `start`. Returns 1 for digital silence.
// Starting at 300 Hz keeps mains hum and low rumble from making room noise look tonal;
// measured on real laptop-mic takes, room noise sits around 0.25 and singing below 0.16.
export function spectralFlatness(samples, start, sampleRate) {
  ensure();
  for (let i = 0; i < N; i++) { const k = start + i; frame[i] = (k >= 0 && k < samples.length ? samples[k] : 0) * hann[i]; }
  powerSpectrum(fft, frame, re, im, pow);
  const kLo = Math.max(1, Math.ceil((300 * N) / sampleRate));
  const kHi = Math.min(N / 2, Math.floor((Math.min(5000, 0.45 * sampleRate) * N) / sampleRate));
  let logSum = 0;
  let sum = 0;
  let cnt = 0;
  for (let k = kLo; k <= kHi; k++) { const p = pow[k] + 1e-20; logSum += Math.log(p); sum += p; cnt++; }
  if (!cnt) return 1;
  const mean = sum / cnt;
  if (mean < 1e-14) return 1;
  return Math.exp(logSum / cnt) / mean;
}

// db: frame levels in dB. frameStart(k) gives the sample index where frame k begins.
export function activityThreshold(db, { samples, sampleRate, frameStart, winFrames = 15, aboveFloor = 8, maxBelowPeak = 45, stationaryDb = 6, minFlatness = 0.18 }) {
  const n = db.length;
  const peak = percentile(db, 0.98);
  const w = Math.min(n, Math.max(1, winFrames));
  let sum = 0;
  for (let i = 0; i < w; i++) sum += db[i];
  let best = sum;
  let bestStart = 0;
  for (let i = w; i < n; i++) {
    sum += db[i] - db[i - w];
    if (sum < best) { best = sum; bestStart = i - w + 1; }
  }
  const win = db.subarray(bestStart, bestStart + w);
  const floor = percentile(win, 0.5);
  const range = percentile(win, 0.9) - percentile(win, 0.1);
  let flatness = 1;
  if (samples && frameStart) {
    const vals = [];
    for (let k = bestStart; k < bestStart + w; k += 2) vals.push(spectralFlatness(samples, frameStart(k), sampleRate));
    vals.sort((a, b) => a - b);
    flatness = vals[vals.length >> 1];
  }
  const trusted = range <= stationaryDb && flatness >= minFlatness && floor <= peak - 12;
  const thr = trusted ? Math.max(floor + aboveFloor, peak - maxBelowPeak) : peak - maxBelowPeak;
  return { floor, peak, thr, trusted, flatness, range };
}
