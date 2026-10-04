// Word tokenisation and diffing for transcripts (Latin, Devanagari, Kannada, ...).

// Splits on whitespace, strips punctuation and symbols (including danda । ॥),
// keeps combining marks so Indic syllables stay intact. `word` is for display,
// `norm` for comparison.
export function tokenize(text) {
  const out = [];
  for (const raw of String(text || '').normalize('NFC').split(/\s+/)) {
    const word = raw.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
    if (!word) continue;
    const norm = word.toLowerCase().replace(/[\p{P}\p{S}]+/gu, '');
    if (!norm) continue;
    out.push({ word, norm });
  }
  return out;
}

// Longest-common-subsequence diff of two arrays of strings.
// Returns ops: { op: 'equal' | 'delete' | 'insert', a: index in a or -1, b: index in b or -1 }.
export function diffWords(a, b) {
  const n = a.length;
  const m = b.length;
  const W = m + 1;
  const L = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i * W + j] = a[i] === b[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ op: 'equal', a: i, b: j }); i++; j++; }
    else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) { ops.push({ op: 'delete', a: i, b: -1 }); i++; }
    else { ops.push({ op: 'insert', a: -1, b: j }); j++; }
  }
  while (i < n) ops.push({ op: 'delete', a: i++, b: -1 });
  while (j < m) ops.push({ op: 'insert', a: -1, b: j++ });
  return ops;
}

export function diffSummary(ops, nA, nB) {
  let matched = 0;
  for (const o of ops) if (o.op === 'equal') matched++;
  return { matched, missing: nA - matched, extra: nB - matched, similarity: nA ? matched / nA : 0 };
}
