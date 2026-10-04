// Small numeric helpers shared by the DSP modules.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function percentile(arr, p) {
  if (!arr.length) return NaN;
  const s = Float32Array.from(arr).sort();
  const idx = clamp(Math.round(p * (s.length - 1)), 0, s.length - 1);
  return s[idx];
}

export function medianOf(values) {
  const v = Array.from(values).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : 0.5 * (v[mid - 1] + v[mid]);
}

export function meanOf(values) {
  let s = 0;
  let c = 0;
  for (const x of values) if (!Number.isNaN(x)) { s += x; c++; }
  return c ? s / c : NaN;
}

// Median absolute deviation scaled to be comparable with a standard deviation.
export function madOf(values, med = medianOf(values)) {
  const dev = Array.from(values).filter((x) => !Number.isNaN(x)).map((x) => Math.abs(x - med));
  return 1.4826 * medianOf(dev);
}

// Inclusive runs [start, end] of indices where pred(i) holds, tolerating gaps of
// at most maxGap non-matching frames, keeping runs of at least minLen frames.
export function findRuns(n, pred, { minLen = 1, maxGap = 0 } = {}) {
  const out = [];
  let start = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (pred(i)) {
      if (start < 0) start = i;
      last = i;
    } else if (start >= 0 && i - last > maxGap) {
      if (last - start + 1 >= minLen) out.push({ start, end: last });
      start = -1;
    }
  }
  if (start >= 0 && last - start + 1 >= minLen) out.push({ start, end: last });
  return out;
}

// In a 0/1 mask, turn zero-gaps of length <= maxGap that sit between ones into ones.
export function fillGaps(mask, maxGap) {
  const n = mask.length;
  let lastOne = -1;
  for (let i = 0; i < n; i++) {
    if (mask[i]) {
      if (lastOne >= 0 && i - lastOne - 1 > 0 && i - lastOne - 1 <= maxGap) {
        for (let k = lastOne + 1; k < i; k++) mask[k] = 1;
      }
      lastOne = i;
    }
  }
  return mask;
}

// In a 0/1 mask, clear runs of ones shorter than minLen.
export function dropShort(mask, minLen) {
  const n = mask.length;
  let i = 0;
  while (i < n) {
    if (!mask[i]) { i++; continue; }
    let j = i;
    while (j + 1 < n && mask[j + 1]) j++;
    if (j - i + 1 < minLen) for (let k = i; k <= j; k++) mask[k] = 0;
    i = j + 1;
  }
  return mask;
}

// Moving median that ignores NaN neighbours; NaN stays NaN at the centre.
export function movingMedianNaN(arr, win) {
  const n = arr.length;
  const half = win >> 1;
  const out = new Float32Array(n);
  const buf = [];
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(arr[i])) { out[i] = NaN; continue; }
    buf.length = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k++) {
      if (!Number.isNaN(arr[k])) buf.push(arr[k]);
    }
    buf.sort((a, b) => a - b);
    const mid = buf.length >> 1;
    out[i] = buf.length % 2 ? buf[mid] : 0.5 * (buf[mid - 1] + buf[mid]);
  }
  return out;
}

// Least-squares slope of y over x for index pairs where y >= 0.
export function slopeOf(xs, ys) {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let k = 0; k < xs.length; k++) {
    const x = xs[k];
    const y = ys[k];
    n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const den = n * sxx - sx * sx;
  return den > 0 ? (n * sxy - sx * sy) / den : 1;
}

export function bytesToBase64(bytes) {
  let s = '';
  const CH = 8192;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

export function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
