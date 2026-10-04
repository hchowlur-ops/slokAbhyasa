// Banded dynamic time warping with open (penalised) ends.
//
// alignDTW(N, M, cost, opts) aligns baseline frames 0..N-1 to heard frames 0..M-1.
// The band is centred on the length-ratio diagonal so a globally slower or faster
// performance stays inside it. Unmatched frames at either end of either recording
// cost `endPenalty` each, so leading chatter or stopping early is reported as
// uncovered frames instead of distorting the alignment.

export function alignDTW(N, M, cost, opts = {}) {
  const { bandFrac = 0.25, minBand = 50, stepPenalty = 0.15, endPenalty = 0.6, corridor = null } = opts;
  if (N < 1 || M < 1) throw new Error('Nothing to align');

  const lo = new Int32Array(N);
  const hi = new Int32Array(N);
  if (corridor) {
    for (let i = 0; i < N; i++) {
      lo[i] = Math.max(0, Math.min(M - 1, corridor.lo[i]));
      hi[i] = Math.max(lo[i], Math.min(M - 1, corridor.hi[i]));
    }
  } else {
    const r = Math.max(minBand, Math.ceil(bandFrac * Math.max(N, M)));
    for (let i = 0; i < N; i++) {
      const c = N > 1 ? Math.round((i * (M - 1)) / (N - 1)) : 0;
      lo[i] = Math.max(0, c - r);
      hi[i] = Math.min(M - 1, c + r);
    }
  }
  let width = 1;
  for (let i = 0; i < N; i++) width = Math.max(width, hi[i] - lo[i] + 1);

  const P = new Uint8Array(N * width); // 0 origin, 1 diag, 2 up (i-1,j), 3 left (i,j-1), 4 open start
  let prev = new Float32Array(width).fill(Infinity);
  let cur = new Float32Array(width).fill(Infinity);
  let prevLo = 0;
  let prevHi = -1;
  let bestEnd = Infinity;
  let bestI = -1;
  let bestJ = -1;

  for (let i = 0; i < N; i++) {
    cur.fill(Infinity);
    const l = lo[i];
    const h = hi[i];
    const rowBase = i * width;
    for (let j = l; j <= h; j++) {
      let best;
      let dir;
      if (i === 0 && j === 0) { best = 0; dir = 0; }
      else {
        best = Infinity; dir = 0;
        if (i === 0) { best = endPenalty * j; dir = 4; }
        else if (j === 0) { best = endPenalty * i; dir = 4; }
        if (i > 0) {
          const pj = j - 1;
          if (pj >= prevLo && pj <= prevHi) { const v = prev[pj - prevLo]; if (v < best) { best = v; dir = 1; } }
          if (j >= prevLo && j <= prevHi) { const v = prev[j - prevLo] + stepPenalty; if (v < best) { best = v; dir = 2; } }
        }
        if (j > l) { const v = cur[j - 1 - l] + stepPenalty; if (v < best) { best = v; dir = 3; } }
      }
      if (best === Infinity) continue;
      const D = cost(i, j) + best;
      cur[j - l] = D;
      P[rowBase + (j - l)] = dir;
      if (j === M - 1 || i === N - 1) {
        const total = D + endPenalty * (N - 1 - i + (M - 1 - j));
        if (total < bestEnd) { bestEnd = total; bestI = i; bestJ = j; }
      }
    }
    const t = prev; prev = cur; cur = t;
    prevLo = l; prevHi = h;
  }
  if (bestI < 0) throw new Error('Alignment failed');

  const pi = [];
  const pj = [];
  let i = bestI;
  let j = bestJ;
  for (;;) {
    pi.push(i); pj.push(j);
    const dir = P[i * width + (j - lo[i])];
    if (dir === 0 || dir === 4) break;
    if (dir === 1) { i--; j--; } else if (dir === 2) { i--; } else { j--; }
  }
  pi.reverse(); pj.reverse();
  const pathI = Int32Array.from(pi);
  const pathJ = Int32Array.from(pj);
  let costSum = 0;
  for (let k = 0; k < pathI.length; k++) costSum += cost(pathI[k], pathJ[k]);
  return {
    pathI,
    pathJ,
    iStart: pathI[0],
    iEnd: bestI,
    jStart: pathJ[0],
    jEnd: bestJ,
    totalCost: bestEnd,
    meanCost: costSum / pathI.length,
  };
}

// For every baseline frame the "middle" matched heard frame and vice versa (-1 when unmatched).
export function pathMaps(pathI, pathJ, N, M) {
  const jOf = new Int32Array(N).fill(-1);
  const iOf = new Int32Array(M).fill(-1);
  const L = pathI.length;
  let k = 0;
  while (k < L) {
    const i = pathI[k];
    let k2 = k;
    while (k2 + 1 < L && pathI[k2 + 1] === i) k2++;
    jOf[i] = pathJ[(k + k2) >> 1];
    k = k2 + 1;
  }
  k = 0;
  while (k < L) {
    const j = pathJ[k];
    let k2 = k;
    while (k2 + 1 < L && pathJ[k2 + 1] === j) k2++;
    iOf[j] = pathI[(k + k2) >> 1];
    k = k2 + 1;
  }
  return { jOf, iOf };
}

// Coarse-to-fine wrapper: when the banded matrix is too large, align a decimated
// version first and then refine inside a corridor around the projected coarse path.
export function alignLarge(N, M, cost, opts = {}) {
  const { maxCells = 60e6, decim = 4, margin = 24 } = opts;
  const r = Math.max(opts.minBand ?? 50, Math.ceil((opts.bandFrac ?? 0.25) * Math.max(N, M)));
  const cells = N * Math.min(M, 2 * r + 1);
  if (cells <= maxCells) return alignDTW(N, M, cost, opts);

  const Nc = Math.ceil(N / decim);
  const Mc = Math.ceil(M / decim);
  const coarse = alignDTW(Nc, Mc, (i, j) => cost(Math.min(N - 1, i * decim), Math.min(M - 1, j * decim)), opts);
  const lo = new Int32Array(N).fill(M);
  const hi = new Int32Array(N).fill(-1);
  for (let k = 0; k < coarse.pathI.length; k++) {
    const i0 = coarse.pathI[k] * decim;
    const j0 = coarse.pathJ[k] * decim;
    for (let di = 0; di < decim && i0 + di < N; di++) {
      lo[i0 + di] = Math.min(lo[i0 + di], j0 - margin);
      hi[i0 + di] = Math.max(hi[i0 + di], j0 + decim - 1 + margin);
    }
  }
  // Rows before/after the coarse path's matched region get a corridor near the ends.
  for (let i = 0; i < N; i++) {
    if (hi[i] < 0) {
      const c = Math.round((i * (M - 1)) / Math.max(1, N - 1));
      lo[i] = c - margin * decim;
      hi[i] = c + margin * decim;
    }
  }
  return alignDTW(N, M, cost, { ...opts, corridor: { lo, hi } });
}
