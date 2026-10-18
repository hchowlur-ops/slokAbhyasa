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
// The moment of each token of a transcript (seconds), interpolated along its chunk: Whisper's
// chunks can be long, and a word's place in one is its share of it. null for a token whose
// chunk has no timing.
export function tokenMoments(t, fullDuration, toks = tokenizeTranscript(t)) {
  if (!t || !t.chunks) return toks.map(() => null);
  // a word's share of its chunk is its length in sounds (a long compound takes longer than "ye")
  const weight = (tok) => Math.max(1, phoneticKey(tok.norm || tok.word || '').length);
  const counts = new Map();
  for (const tok of toks) counts.set(tok.chunk, (counts.get(tok.chunk) || 0) + weight(tok));
  // a chunk without an end runs to the next chunk, or to the end of the recording
  const endOf = (ci) => {
    const c = t.chunks[ci];
    if (typeof c.end === 'number') return c.end;
    const next = t.chunks.slice(ci + 1).find((x) => typeof x.start === 'number');
    return next ? next.start : fullDuration;
  };
  const seen = new Map();
  return toks.map((tok) => {
    const c = tok.chunk >= 0 ? t.chunks[tok.chunk] : null;
    if (!c || typeof c.start !== 'number') return null;
    const w = weight(tok);
    const before = seen.get(tok.chunk) || 0;
    seen.set(tok.chunk, before + w);
    const span = Math.max(0, endOf(tok.chunk) - c.start);
    return c.start + (span * (before + w / 2)) / counts.get(tok.chunk);
  });
}
export function windowedTokens(t, win, fullDuration) {
  const toks = tokenizeTranscript(t);
  const partial = !!win && (win[0] > 0.75 || win[1] < fullDuration - 0.75);
  if (!partial || !t.chunks) return { toks, inside: toks.map(() => true) };
  const moments = tokenMoments(t, fullDuration, toks);
  const inside = toks.map((tok, i) => (moments[i] == null ? true : moments[i] >= win[0] - 0.5 && moments[i] <= win[1] + 0.5));
  return { toks, inside };
}

// Where the boundary between two stretches of a take should be, from their words. The ear
// closes a stretch where it hears a sloka end; when it closes early, the later stretch
// begins with the tail of the earlier sloka, and when it closes late, the earlier stretch
// ends with the head of the later one. Either way the boundary belongs where the later
// sloka's words begin. prev / next: { toks (heard tokens, tokenizeTranscript), moments
// (tokenMoments, seconds into the take), ref (the sloka's own tokens) }. The words are
// read as streams of sounds, as findSelfCorrections reads them. Returns the boundary in
// seconds, or null when the words say nothing.
export function refineBoundary(prev, next, { minSounds = 6, maxSounds = 60 } = {}) {
  // streams of sounds, and where each token ends in them: a run of words belongs to a sloka
  // whole, so a match is tried only at word boundaries
  const stream = (toks) => { let s = ''; const ends = []; for (const t of toks || []) { s += phoneticKey(t.norm || t.word || ''); ends.push(s.length); } return { s, ends }; };
  const prevRef = stream(prev.ref).s;
  const nextRef = stream(next.ref).s;
  const slack = (L) => Math.max(1, Math.round(L * 0.2));
  // the later stretch begins with the earlier sloka's tail: its first k words
  const N = stream(next.toks);
  for (let k = N.ends.length - 1; k >= 1; k--) {
    const L = N.ends[k - 1];
    if (L > maxSounds || L > prevRef.length) continue;
    if (L < minSounds) break;
    if (editDistance(N.s.slice(0, L), prevRef.slice(prevRef.length - L)) > slack(L)) continue;
    return next.moments[k] != null ? Math.max(0, next.moments[k] - 0.15) : null;
  }
  // the earlier stretch ends with the later sloka's head: its last words from word i on
  const P = stream(prev.toks);
  for (let i = 1; i < P.ends.length; i++) {
    const L = P.s.length - P.ends[i - 1];
    if (L > maxSounds || L > nextRef.length) continue;
    if (L < minSounds) break;
    if (editDistance(P.s.slice(P.s.length - L), nextRef.slice(0, L)) > slack(L)) continue;
    return prev.moments[i] != null ? Math.max(0, prev.moments[i] - 0.15) : null;
  }
  return null;
}

// Sanskrit ślokas are written in two or four lines, and the display gives them their daṇḍas:
// ॥ after the last line, । after the first of two or the second of four (| and || for
// romanised text). Returns the non-empty lines (their own trailing daṇḍas dropped) and the
// mark each gets, by line index.
// A speaker's attribution opening a śloka — "अर्जुन उवाच", "श्रीभगवानुवाच", "sañjaya
// uvāca" — in any script, Whisper's spellings included ("श्री भगवानु वाच्छ"): it is not part
// of the śloka, so it is not counted in its metre and is written on a line of its own.
const UVACA = /uvac+h?a$/;
const uvacaKey = (words) => phoneticKey(words.join(''));
// How many of the words open with the attribution: the words up to and including the one
// that completes uvāca, among the first three; 0 when there is none (or nothing follows).
// A single word is an attribution only when a name is joined to the uvāca
// ("śrībhagavānuvāca", "arjunauvāca"): "tamuvāca" opening 2.10 is the śloka's own first word.
export function uvacaWords(words) {
  const n = Math.min(3, words.length - 1);
  for (let e = 0; e < n; e++) {
    const key = uvacaKey(words.slice(0, e + 1));
    if (key.length >= (e === 0 ? 10 : 5) && UVACA.test(key)) return e + 1;
  }
  return 0;
}
// Whether a whole line is the attribution.
export function isUvacaLine(line) {
  const words = String(line || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 3) return false;
  const key = uvacaKey(words);
  return key.length >= 5 && UVACA.test(key);
}
// The attribution and the śloka proper, as text; the body keeps its own line breaks.
export function splitUvaca(text) {
  const src = String(text || '');
  const ms = [...src.matchAll(/\S+/g)];
  const k = uvacaWords(ms.map((m) => m[0]));
  if (!k) return { prefix: '', body: src };
  const end = ms[k - 1].index + ms[k - 1][0].length;
  return { prefix: src.slice(0, end).trim(), body: src.slice(end).trim() };
}

export function dandaMarks(text) {
  const src = String(text || '');
  const lines = src.split(/\r?\n/).map((l) => l.trim().replace(/[\s।॥|]+$/u, '')).filter(Boolean);
  const latin = !/[\u0900-\u0DFF]/.test(src);
  const marks = new Map();
  if (!lines.length) return { lines, marks };
  // an attribution on the first line carries no daṇḍa and is not a pāda line
  const skip = lines.length > 1 && isUvacaLine(lines[0]) ? 1 : 0;
  const n = lines.length - skip;
  marks.set(lines.length - 1, latin ? '||' : '॥');
  if (n === 2) marks.set(skip, latin ? '|' : '।');
  else if (n === 4) marks.set(skip + 1, latin ? '|' : '।');
  return { lines, marks };
}

// The text itself with its daṇḍas, line by line.
export function withDandas(text) {
  const { lines, marks } = dandaMarks(text);
  return lines.map((l, i) => (marks.has(i) ? `${l} ${marks.get(i)}` : l)).join('\n');
}

// The learner correcting themself, read from the words as one stream of sounds, blind to
// word breaks: Whisper writes a compound as two or three words ("sarvatragam cintyañca"
// for sarvatragamacintyañca) and alters a nasal or two, so a word-by-word match misses
// what the ear plainly hears. A stretch of the stream said again right after itself (a
// few sounds' slack between, small differences allowed) is a **repeat** of the heard
// words it spans; when it starts where a pāda of the sloka starts and covers most of that
// pāda or more, it is a **restart** of that pāda — of the sloka, when the pāda is the
// first. `refPada[i]` says which pāda the sloka's word i begins in (0 the speaker line),
// when known. Returns [{ kind, word, at (heard index of the second saying), pada?,
// refIndex? }].
const SELF_CORR_MIN_SOUNDS = 5; // about three akṣaras: shorter echoes are the language itself
const SELF_CORR_MAX_SOUNDS = 60;
function editDistance(a, b) {
  const n = a.length;
  const m = b.length;
  let prev = new Int32Array(m + 1);
  let cur = new Int32Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const c = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
    }
    const t = prev; prev = cur; cur = t;
  }
  return prev[m];
}
export function findSelfCorrections(refToks, heardToks, { refPada = null } = {}) {
  const stream = (toks) => { let s = ''; const tokAt = []; const starts = []; for (let i = 0; i < toks.length; i++) { const k = phoneticKey(toks[i].norm || toks[i].word || ''); starts.push(s.length); for (let c = 0; c < k.length; c++) tokAt.push(i); s += k; } return { s, tokAt, starts }; };
  const H = stream(heardToks || []);
  const R = stream(refToks || []);
  const out = [];
  if (H.s.length < 2 * SELF_CORR_MIN_SOUNDS) return out;
  // where each pāda of the sloka starts in its stream, and how long it runs
  const padaStart = new Map();
  if (refPada) for (let i = 0; i < refPada.length && i < R.starts.length; i++) if (refPada[i] != null && !padaStart.has(refPada[i])) padaStart.set(refPada[i], R.starts[i]);
  const padaOrder = [...padaStart.entries()].sort((x, y) => x[1] - y[1]);
  const slack = (L) => Math.max(1, Math.round(L * 0.15));
  let i = 0;
  while (i + 2 * SELF_CORR_MIN_SOUNDS <= H.s.length) {
    let hit = null;
    const maxL = Math.min(SELF_CORR_MAX_SOUNDS, Math.floor((H.s.length - i) / 2));
    for (let L = maxL; L >= SELF_CORR_MIN_SOUNDS && !hit; L--) {
      const a = H.s.substr(i, L);
      for (let gap = 0; gap <= 2 && !hit; gap++) {
        const b = H.s.substr(i + L + gap, L);
        if (b.length < L || a.slice(0, 3) !== b.slice(0, 3)) continue; // a saying again begins as the first did
        if (editDistance(a, b) <= slack(L)) hit = { L, gap };
      }
    }
    if (!hit) { i++; continue; }
    // both sayings inside one heard word ("…somāśarasomayā" for śrutau vistaraśo mayā): the
    // recogniser's echo, not the learner's — a word said twice is written as two words
    if (H.tokAt[i] === H.tokAt[Math.min(H.tokAt.length - 1, i + 2 * hit.L + hit.gap - 1)]) { i += hit.L; continue; }
    const { L, gap } = hit;
    const run = H.s.substr(i, L);
    // the sloka's stretch this is, when it is one: the position in the sloka's stream that reads most like it
    let bestP = -1;
    let bestD = Infinity;
    for (let p = 0; p + Math.min(L, 4) <= R.s.length; p++) { const d = editDistance(run, R.s.substr(p, L)); if (d < bestD) { bestD = d; bestP = p; } }
    const inSloka = bestP >= 0 && bestD <= Math.max(1, Math.round(L * 0.3));
    // a pāda started again: the run begins where a pāda begins and holds most of one (six akṣaras or more — one vowel per akṣara in the key); a shorter echo at a pāda's start is a word said twice
    const aksharas = (run.match(/[aeiou]/g) || []).length;
    let restart = null;
    if (inSloka && aksharas >= 6) for (const [pada, ps] of padaOrder) if (Math.abs(ps - bestP) <= 2) { restart = pada; break; }
    const at = H.tokAt[Math.min(H.tokAt.length - 1, i + L + gap)];
    if (restart != null) {
      const refIndex = R.tokAt[padaStart.get(restart)];
      out.push({ kind: 'restart', word: refToks[refIndex].word, at, refIndex, pada: restart });
    } else {
      const first = H.tokAt[i];
      const last = H.tokAt[i + L - 1];
      out.push({ kind: 'repeat', word: heardToks.slice(first, last + 1).map((t) => t.word).join(' '), at });
    }
    i += 2 * L + gap;
  }
  return out;
}
