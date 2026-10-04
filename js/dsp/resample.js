// Sample-rate conversion for analysis. Downsampling uses a Blackman-windowed
// sinc low-pass evaluated directly at each output position (anti-aliased);
// upsampling (rare) uses linear interpolation.

export function resample(input, srIn, srOut) {
  if (srIn === srOut) return input instanceof Float32Array ? input : Float32Array.from(input);
  const ratio = srIn / srOut;

  if (ratio < 1) {
    const nOut = Math.floor(input.length / ratio);
    const out = new Float32Array(nOut);
    for (let i = 0; i < nOut; i++) {
      const p = i * ratio;
      const k = Math.floor(p);
      const f = p - k;
      const a = input[k];
      const b = k + 1 < input.length ? input[k + 1] : a;
      out[i] = a + (b - a) * f;
    }
    return out;
  }

  // Low-pass kernel: cutoff a little below the new Nyquist, in cycles per input sample.
  const fc = 0.45 / ratio;
  const half = Math.max(24, Math.ceil(16 * ratio));
  const taps = 2 * half + 1;
  const h = new Float64Array(taps);
  let sum = 0;
  for (let k = -half; k <= half; k++) {
    const sinc = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
    const t = (k + half) / (taps - 1);
    const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * t) + 0.08 * Math.cos(4 * Math.PI * t);
    h[k + half] = sinc * w;
    sum += h[k + half];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;

  const nOut = Math.floor(input.length / ratio);
  const out = new Float32Array(nOut);
  const last = input.length - 1;
  for (let i = 0; i < nOut; i++) {
    const c = Math.round(i * ratio);
    const kStart = Math.max(-half, -c);
    const kEnd = Math.min(half, last - c);
    let acc = 0;
    for (let k = kStart; k <= kEnd; k++) acc += input[c + k] * h[k + half];
    out[i] = acc;
  }
  return out;
}

// Mix an array of channel buffers down to one mono Float32Array.
export function mixToMono(channels) {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  const g = 1 / channels.length;
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] * g;
  return out;
}
