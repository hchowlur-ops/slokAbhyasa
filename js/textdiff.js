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

// A plain-Latin phonetic key of a word, so that the same sound written in Devanagari, in
// Kannada or in Latin with or without diacritics compares equal. The recogniser writes
// Sanskrit sometimes in Devanagari and sometimes in IAST, from one run to the next. The
// Indic scripts share one layout (Devanagari, Kannada, Telugu, Tamil, Malayalam, Bengali,
// Gujarati, Gurmukhi, Oriya: 128 code points each, same positions), so one table serves
// them all: independent vowels at 05–14, consonants at 15–39, vowel signs at 3E–4C, the
// virama at 4D. A consonant carries an inherent "a" unless a vowel sign or virama follows.
const INDIC_VOWELS = ['a', 'a', 'i', 'i', 'u', 'u', 'r', 'l', 'e', 'e', 'e', 'ai', 'o', 'o', 'o', 'au']; // 05..14
const INDIC_CONSONANTS = ['k', 'kh', 'g', 'gh', 'n', 'c', 'ch', 'j', 'jh', 'n', 't', 'th', 'd', 'dh', 'n', 't', 'th', 'd', 'dh', 'n', 'n', 'p', 'ph', 'b', 'bh', 'm', 'y', 'r', 'r', 'l', 'l', 'l', 'v', 's', 's', 's', 'h']; // 15..39
const INDIC_SIGNS = ['a', 'i', 'i', 'u', 'u', 'r', 'r', 'e', 'e', 'e', 'ai', 'o', 'o', 'o', 'au']; // 3E..4C
const INDIC_NUKTA_CONSONANTS = ['k', 'kh', 'g', 'j', 'd', 'dh', 'ph', 'y']; // 58..5F (Devanagari)
const INDIC_BLOCKS = new Set([0x0900, 0x0980, 0x0a00, 0x0a80, 0x0b00, 0x0b80, 0x0c00, 0x0c80, 0x0d00]);

export function phoneticKey(word) {
  let out = '';
  let inherent = false; // a consonant was written and still owes its "a"
  const flush = () => { if (inherent) { out += 'a'; inherent = false; } };
  for (const ch of String(word || '').normalize('NFC')) {
    const cp = ch.codePointAt(0);
    const base = cp & ~0x7f;
    if (!INDIC_BLOCKS.has(base)) {
      flush();
      // Latin: lower case, diacritics off (ā→a, ś→s, ṁ→m), the rest as it is
      out += ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      continue;
    }
    const o = cp - base;
    if (o >= 0x15 && o <= 0x39) { flush(); out += INDIC_CONSONANTS[o - 0x15]; inherent = true; }
    else if (o >= 0x58 && o <= 0x5f) { flush(); out += INDIC_NUKTA_CONSONANTS[o - 0x58]; inherent = true; }
    else if (o >= 0x3e && o <= 0x4c) { out += INDIC_SIGNS[o - 0x3e]; inherent = false; }
    else if (o === 0x4d) inherent = false; // virama: no vowel
    else if (o >= 0x05 && o <= 0x14) { flush(); out += INDIC_VOWELS[o - 0x05]; }
    else if (o === 0x01) { flush(); out += 'n'; } // chandrabindu
    else if (o === 0x02) { flush(); out += 'm'; } // anusvara
    else if (o === 0x03) { flush(); out += 'h'; } // visarga
    else if (o === 0x50) { flush(); out += 'om'; }
    // nukta, avagraha, digits and the rest: nothing
  }
  flush();
  return out;
}

// Character-level comparison of two word lists, blind to how the words happened to be
// split: the texts are aligned character by character with the spaces left out (longest
// common subsequence), and a word counts as heard when at least half of its characters
// were matched. Speech recognition of chant varies from run to run in spelling and in
// where it breaks words (निर्देश्यम / निर्देश्यम्, सर्वत्रगम चिंत्यम्चा / सर्वत्रगमचिंत्यम्चा), which
// whole-word matching would call wrong. The words are compared by their phonetic keys, so
// the script they were written in does not matter either. `similarity` is the share of the
// first list's sound that was heard: the pronunciation score. Returns null when the texts
// are too long to align this way (a two-million-cell table), so the caller can fall back on
// words.
export const CHAR_DIFF_MAX_CELLS = 2_000_000;
export function compareWords(aWords, bWords) {
  const A = [];
  const aOf = [];
  const B = [];
  const bOf = [];
  const aKeys = aWords.map(phoneticKey);
  const bKeys = bWords.map(phoneticKey);
  aKeys.forEach((w, i) => { for (const ch of w) { A.push(ch); aOf.push(i); } });
  bKeys.forEach((w, i) => { for (const ch of w) { B.push(ch); bOf.push(i); } });
  const n = A.length;
  const m = B.length;
  if ((n + 1) * (m + 1) > CHAR_DIFF_MAX_CELLS) return null;
  const W = m + 1;
  const L = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i * W + j] = A[i] === B[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    }
  }
  const hitA = new Uint32Array(aWords.length);
  const hitB = new Uint32Array(bWords.length);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { hitA[aOf[i]]++; hitB[bOf[j]]++; i++; j++; }
    else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) i++;
    else j++;
  }
  const delA = new Set();
  const insB = new Set();
  let heard = 0;
  aKeys.forEach((w, k) => { heard += hitA[k]; if (hitA[k] < 0.5 * w.length) delA.add(k); });
  bKeys.forEach((w, k) => { if (hitB[k] < 0.5 * w.length) insB.add(k); });
  return { delA, insB, summary: { matched: aWords.length - delA.size, missing: delA.size, extra: insB.size, similarity: n ? heard / n : 0 } };
}

// The words of a transcript { text, chunks: [{ text, start, end }] }, each with the index of
// the timed chunk it came from (-1 when the transcript has no chunks).
export function tokenizeTranscript(t) {
  const toks = [];
  (t.chunks || []).forEach((c, ci) => { for (const w of tokenize(c.text)) toks.push({ ...w, chunk: ci }); });
  if (!toks.length && t.text) for (const w of tokenize(t.text)) toks.push({ ...w, chunk: -1 });
  return toks;
}

// Tokens of a transcript, and which of them lie inside the window [win] (seconds) of a
// recording `fullDuration` long. Without timings, or when the window is the whole
// recording, everything counts. A word's moment is interpolated along its chunk: Whisper's
// chunks can be 30 s long (a chunk of a two-sloka take holds one sloka and half the next),
// so the chunk's own extent says little about where one word is.
export function windowedTokens(t, win, fullDuration) {
  const toks = tokenizeTranscript(t);
  const partial = !!win && (win[0] > 0.75 || win[1] < fullDuration - 0.75);
  if (!partial || !t.chunks) return { toks, inside: toks.map(() => true) };
  const counts = new Map();
  for (const tok of toks) counts.set(tok.chunk, (counts.get(tok.chunk) || 0) + 1);
  // a chunk without an end runs to the next chunk, or to the end of the recording
  const endOf = (ci) => {
    const c = t.chunks[ci];
    if (typeof c.end === 'number') return c.end;
    const next = t.chunks.slice(ci + 1).find((x) => typeof x.start === 'number');
    return next ? next.start : fullDuration;
  };
  const seen = new Map();
  const inside = toks.map((tok) => {
    const c = tok.chunk >= 0 ? t.chunks[tok.chunk] : null;
    if (!c || typeof c.start !== 'number') return true;
    const k = seen.get(tok.chunk) || 0;
    seen.set(tok.chunk, k + 1);
    const span = Math.max(0, endOf(tok.chunk) - c.start);
    const at = c.start + (span * (k + 0.5)) / counts.get(tok.chunk);
    return at >= win[0] - 0.5 && at <= win[1] + 0.5;
  });
  return { toks, inside };
}
