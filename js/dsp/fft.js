// Iterative radix-2 complex FFT (in place) with cached twiddles and bit-reversal.

export function createFFT(n) {
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error('FFT size must be a power of two');
  const levels = Math.round(Math.log2(n));
  const cosT = new Float64Array(n / 2);
  const sinT = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cosT[i] = Math.cos((2 * Math.PI * i) / n);
    sinT[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    let x = i;
    for (let l = 0; l < levels; l++) { r = (r << 1) | (x & 1); x >>>= 1; }
    rev[i] = r >>> 0;
  }

  function transform(re, im, inverse) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const c = cosT[k];
          const s = inverse ? -sinT[k] : sinT[k];
          const tre = re[l] * c + im[l] * s;
          const tim = -re[l] * s + im[l] * c;
          re[l] = re[j] - tre;
          im[l] = im[j] - tim;
          re[j] += tre;
          im[j] += tim;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    }
  }

  return {
    n,
    forward: (re, im) => transform(re, im, false),
    inverse: (re, im) => transform(re, im, true),
  };
}

// Power spectrum |X[k]|^2 for k = 0..n/2 of a real frame (already windowed).
// `re`/`im` are scratch buffers of length n; `out` has length n/2+1.
export function powerSpectrum(fft, frame, re, im, out) {
  const n = fft.n;
  for (let i = 0; i < n; i++) { re[i] = i < frame.length ? frame[i] : 0; im[i] = 0; }
  fft.forward(re, im);
  const half = n >> 1;
  for (let k = 0; k <= half; k++) out[k] = re[k] * re[k] + im[k] * im[k];
  return out;
}
