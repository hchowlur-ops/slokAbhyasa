// Romanised Indic text back into its script. Whisper, asked for Kannada or Sanskrit, often
// answers a chant in Latin letters ("Arjuna uvāca evam satata yukta…", IAST-like, with
// "sh" and "ksh" for ś and kṣ); learners expect ಅರ್ಜುನ ಉವಾಚ ಏವಂ ಸತತ ಯುಕ್ತ. The three
// scripts share one Unicode layout (the same offsets from the block's base), so one table
// serves Devanagari, Kannada and Telugu. Pure; shared by the app and the server.

export const SCRIPT_BASE = { Deva: 0x0900, Knda: 0x0c80, Telu: 0x0c00 };
export const LANGUAGE_SCRIPT = { sanskrit: 'Deva', hindi: 'Deva', kannada: 'Knda', telugu: 'Telu' };

// offsets from the block base: [independent vowel, vowel sign]
const VOWELS = {
  a: [0x05, null], ā: [0x06, 0x3e], i: [0x07, 0x3f], ī: [0x08, 0x40], u: [0x09, 0x41], ū: [0x0a, 0x42],
  ṛ: [0x0b, 0x43], ṝ: [0x60, 0x44], ḷ: [0x0c, 0x62], e: [0x0f, 0x47], ai: [0x10, 0x48], o: [0x13, 0x4b], au: [0x14, 0x4c],
};
const CONSONANTS = {
  k: 0x15, kh: 0x16, g: 0x17, gh: 0x18, ṅ: 0x19, c: 0x1a, ch: 0x1b, j: 0x1c, jh: 0x1d, ñ: 0x1e,
  ṭ: 0x1f, ṭh: 0x20, ḍ: 0x21, ḍh: 0x22, ṇ: 0x23, t: 0x24, th: 0x25, d: 0x26, dh: 0x27, n: 0x28,
  p: 0x2a, ph: 0x2b, b: 0x2c, bh: 0x2d, m: 0x2e, y: 0x2f, r: 0x30, l: 0x32, ḷḷ: 0x33, v: 0x35, ś: 0x36, ṣ: 0x37, s: 0x38, h: 0x39,
};
const ANUSVARA = 0x02;
const VISARGA = 0x03;
const VIRAMA = 0x4d;
const AVAGRAHA = 0x3d;
const OM = 0x50;
const CANDRABINDU = 0x01;

// Spellings → tokens, longest first. A token is { v: vowelKey } | { c: [consonantKeys] } | { m: 'anusvara' | 'visarga' }.
const SPELLINGS = [
  ['ksh', { c: ['k', 'ṣ'] }], ['kṣ', { c: ['k', 'ṣ'] }], ['chh', { c: ['ch'] }], ['jñ', { c: ['j', 'ñ'] }],
  ['kh', { c: ['kh'] }], ['gh', { c: ['gh'] }], ['ch', { c: ['c'] }], ['jh', { c: ['jh'] }], ['ṭh', { c: ['ṭh'] }], ['ḍh', { c: ['ḍh'] }],
  ['th', { c: ['th'] }], ['dh', { c: ['dh'] }], ['ph', { c: ['ph'] }], ['bh', { c: ['bh'] }], ['sh', { c: ['ś'] }], ['ng', { c: ['ṅ', 'g'] }], ['ny', { c: ['ñ'] }],
  ['ai', { v: 'ai' }], ['au', { v: 'au' }], ['aa', { v: 'ā' }], ['ii', { v: 'ī' }], ['ee', { v: 'ī' }], ['uu', { v: 'ū' }], ['oo', { v: 'ū' }],
  ['ā', { v: 'ā' }], ['ī', { v: 'ī' }], ['ū', { v: 'ū' }], ['ṛ', { v: 'ṛ' }], ['ṝ', { v: 'ṝ' }], ['ē', { v: 'e' }], ['ō', { v: 'o' }],
  ['a', { v: 'a' }], ['i', { v: 'i' }], ['u', { v: 'u' }], ['e', { v: 'e' }], ['o', { v: 'o' }],
  ['ṃ', { m: 'anusvara' }], ['ṁ', { m: 'anusvara' }], ['ḥ', { m: 'visarga' }], ['’', { g: true }], ["'", { g: true }],
  ['k', { c: ['k'] }], ['g', { c: ['g'] }], ['ṅ', { c: ['ṅ'] }], ['c', { c: ['c'] }], ['j', { c: ['j'] }], ['ñ', { c: ['ñ'] }],
  ['ṭ', { c: ['ṭ'] }], ['ḍ', { c: ['ḍ'] }], ['ṇ', { c: ['ṇ'] }], ['t', { c: ['t'] }], ['d', { c: ['d'] }], ['n', { c: ['n'] }],
  ['p', { c: ['p'] }], ['b', { c: ['b'] }], ['m', { c: ['m'] }], ['y', { c: ['y'] }], ['r', { c: ['r'] }], ['l', { c: ['l'] }], ['ḷ', { c: ['ḷḷ'] }],
  ['v', { c: ['v'] }], ['w', { c: ['v'] }], ['ś', { c: ['ś'] }], ['ṣ', { c: ['ṣ'] }], ['s', { c: ['s'] }], ['h', { c: ['h'] }],
  ['x', { c: ['k', 'ṣ'] }], ['z', { c: ['j'] }], ['f', { c: ['ph'] }], ['q', { c: ['k'] }],
].sort((a, b) => b[0].length - a[0].length);

// IAST read as written: the aspirates are the only digraphs ("ch" is छ, "c" is च, "ny" is
// न्य), with a few plain-letter conveniences that never clash with IAST (aa ii uu ee oo, sh).
const SPELLINGS_IAST = [
  ['kh', { c: ['kh'] }], ['gh', { c: ['gh'] }], ['ch', { c: ['ch'] }], ['jh', { c: ['jh'] }], ['ṭh', { c: ['ṭh'] }], ['ḍh', { c: ['ḍh'] }],
  ['th', { c: ['th'] }], ['dh', { c: ['dh'] }], ['ph', { c: ['ph'] }], ['bh', { c: ['bh'] }], ['sh', { c: ['ś'] }],
  ['ai', { v: 'ai' }], ['au', { v: 'au' }], ['aa', { v: 'ā' }], ['ii', { v: 'ī' }], ['ee', { v: 'ī' }], ['uu', { v: 'ū' }], ['oo', { v: 'ū' }],
  ['ā', { v: 'ā' }], ['ī', { v: 'ī' }], ['ū', { v: 'ū' }], ['ṛ', { v: 'ṛ' }], ['ṝ', { v: 'ṝ' }], ['ē', { v: 'e' }], ['ō', { v: 'o' }],
  ['a', { v: 'a' }], ['i', { v: 'i' }], ['u', { v: 'u' }], ['e', { v: 'e' }], ['o', { v: 'o' }],
  ['m\u0310', { m: 'candrabindu' }], ['ṃ', { m: 'anusvara' }], ['ṁ', { m: 'anusvara' }], ['ḥ', { m: 'visarga' }], ['’', { g: true }], ["'", { g: true }],
  ['k', { c: ['k'] }], ['g', { c: ['g'] }], ['ṅ', { c: ['ṅ'] }], ['c', { c: ['c'] }], ['j', { c: ['j'] }], ['ñ', { c: ['ñ'] }],
  ['ṭ', { c: ['ṭ'] }], ['ḍ', { c: ['ḍ'] }], ['ṇ', { c: ['ṇ'] }], ['t', { c: ['t'] }], ['d', { c: ['d'] }], ['n', { c: ['n'] }],
  ['p', { c: ['p'] }], ['b', { c: ['b'] }], ['m', { c: ['m'] }], ['y', { c: ['y'] }], ['r', { c: ['r'] }], ['l', { c: ['l'] }], ['ḷ', { c: ['ḷḷ'] }],
  ['v', { c: ['v'] }], ['w', { c: ['v'] }], ['ś', { c: ['ś'] }], ['ṣ', { c: ['ṣ'] }], ['s', { c: ['s'] }], ['h', { c: ['h'] }],
  ['x', { c: ['k', 'ṣ'] }], ['z', { c: ['j'] }], ['f', { c: ['ph'] }], ['q', { c: ['k'] }],
].sort((a, b) => b[0].length - a[0].length);

const isLatinLetter = (ch) => /\p{Script=Latin}/u.test(ch);

// Writes one romanised word in the script. Vowels after a consonant become signs (an "a"
// is inherent); a word-final consonant carries a virama, as Sanskrit does. Two readings:
// `heuristic` (the default) reads the plain-letter spellings (sh, ksh, ch for च, ny for ञ,
// aa, ee…) that Whisper and most people use, and takes a word-final m or h after a vowel
// as anusvāra or visarga; `exact` reads IAST as written (ṃ and ḥ explicit, "ch" is छ, "ny"
// is न्य), which brings scriptToLatin's output back unchanged.
function wordToScript(word, base, reading = 'heuristic') {
  const chars = Array.from(word.normalize('NFC').toLowerCase());
  const exact = reading === 'exact';
  const table = exact ? SPELLINGS_IAST : SPELLINGS;
  const heuristic = !exact;
  const cp = (off) => String.fromCodePoint(base + off);
  let out = '';
  let cluster = []; // consonants waiting for their vowel
  let lastWasVowel = false;
  const flush = (final) => {
    if (!cluster.length) return;
    out += cluster.map((k) => cp(CONSONANTS[k])).join(cp(VIRAMA));
    if (final) out += cp(VIRAMA);
    cluster = [];
  };
  let i = 0;
  // ॐ, on its own or opening a word (ॐकार, ॐतत्सदिति): the exact reading writes it as one letter
  if (exact && chars[0] === 'o' && chars[1] === 'ṃ' && (chars.length === 2 || !/[aeiouāīūṛṝ]/.test(chars[2]))) { out += cp(OM); i = 2; }
  while (i < chars.length) {
    let hit = null;
    for (const [sp, tok] of table) {
      if (chars.slice(i, i + sp.length).join('') === sp) { hit = [sp, tok]; break; }
    }
    if (!hit) { flush(false); out += chars[i]; lastWasVowel = false; i++; continue; }
    const [sp, tok] = hit;
    i += sp.length;
    const atEnd = i >= chars.length;
    if (tok.v) {
      const [ind, sign] = VOWELS[tok.v];
      if (cluster.length) { flush(false); if (sign !== null) out += cp(sign); } else out += cp(ind);
      lastWasVowel = true;
    } else if (tok.m) {
      flush(false);
      out += cp(tok.m === 'anusvara' ? ANUSVARA : tok.m === 'candrabindu' ? CANDRABINDU : VISARGA);
      lastWasVowel = false;
    } else if (tok.g) {
      flush(false);
      out += cp(AVAGRAHA);
      lastWasVowel = false;
    } else {
      if (heuristic && atEnd && lastWasVowel && !cluster.length && (sp === 'm' || sp === 'h')) {
        out += cp(sp === 'm' ? ANUSVARA : VISARGA);
        lastWasVowel = false;
        continue;
      }
      cluster.push(...tok.c);
      lastWasVowel = false;
    }
  }
  flush(true);
  return out;
}

// Romanised text → the script; anything that is not a Latin word (spaces, punctuation,
// text already in an Indic script) passes through. `reading`: see wordToScript.
export function latinToScript(text, script, { reading = 'heuristic' } = {}) {
  const base = SCRIPT_BASE[script];
  if (!base) return text;
  return String(text || '').replace(/[\p{Script=Latin}̀-ͯ’']+/gu, (w) => wordToScript(w, base, reading));
}

// Devanagari (or Kannada / Telugu) → IAST, letter by letter, exactly as written: no
// folding of sounds, a word-final consonant without its vowel, ṃ and ḥ explicit, ऽ as ’,
// ॐ as oṃ, digits as digits. latinToScript(…, { reading: 'exact' }) brings it back
// unchanged — the way a text is edited by someone without an Indic keyboard.
const IAST_CONS = Object.fromEntries(Object.entries(CONSONANTS).map(([k, off]) => [off, k === 'ḷḷ' ? 'ḷ' : k]));
IAST_CONS[0x29] = 'n'; IAST_CONS[0x31] = 'r'; IAST_CONS[0x34] = 'ḷ';
const IAST_VOWEL = {};
const IAST_SIGN = {};
for (const [k, [ind, sign]] of Object.entries(VOWELS)) { IAST_VOWEL[ind] = k; if (sign !== null) IAST_SIGN[sign] = k; }
IAST_VOWEL[0x0e] = 'e'; IAST_VOWEL[0x12] = 'o'; IAST_SIGN[0x46] = 'e'; IAST_SIGN[0x4a] = 'o'; IAST_VOWEL[0x61] = 'ḹ'; IAST_SIGN[0x63] = 'ḹ'; IAST_SIGN[0x62] = 'ḷ';
export function scriptToLatin(text) {
  const chars = Array.from(String(text || '').normalize('NFC'));
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const cp = chars[i].codePointAt(0);
    const base = Object.values(SCRIPT_BASE).find((b) => (cp & ~0x7f) === b);
    if (base === undefined) { out += chars[i]; continue; }
    const off = cp - base;
    const next = i + 1 < chars.length ? chars[i + 1].codePointAt(0) - base : -1;
    if (IAST_CONS[off]) {
      out += IAST_CONS[off];
      let j = i + 1;
      if (next === 0x3c) j++; // nukta: ignored
      const n2 = j < chars.length ? chars[j].codePointAt(0) - base : -1;
      if (n2 === VIRAMA) { i = j; continue; }
      if (IAST_SIGN[n2] !== undefined) { out += IAST_SIGN[n2]; i = j; continue; }
      out += 'a';
      i = j - 1;
      continue;
    }
    if (IAST_VOWEL[off] !== undefined) { out += IAST_VOWEL[off]; continue; }
    if (off === ANUSVARA) { out += 'ṃ'; continue; }
    if (off === CANDRABINDU) { out += 'm\u0310'; continue; } // m with a combining candrabindu, as IAST writes it
    if (off === VISARGA) { out += 'ḥ'; continue; }
    if (off === AVAGRAHA) { out += '’'; continue; }
    if (off === OM) { out += 'oṃ'; continue; }
    if (off >= 0x66 && off <= 0x6f) { out += String(off - 0x66); continue; }
    out += chars[i]; // daṇḍas and anything else, as they are
  }
  return out;
}

// Whether a text is mostly Latin letters (so a transliteration is called for).
export function mostlyLatin(text) {
  let latin = 0;
  let other = 0;
  for (const ch of String(text || '')) {
    if (!/\p{L}/u.test(ch)) continue;
    if (isLatinLetter(ch)) latin++; else other++;
  }
  return latin > 0 && latin >= 0.6 * (latin + other);
}

// A transcript whose language has a script of its own, answered in Latin letters, rewritten
// in that script (the romanised original kept as `latin`). Anything else is returned as is.
export function transliterateTranscript(t) {
  const script = t && LANGUAGE_SCRIPT[t.language];
  if (!script || !mostlyLatin(t.text)) return t;
  return {
    ...t,
    text: latinToScript(t.text, script),
    chunks: Array.isArray(t.chunks) ? t.chunks.map((c) => ({ ...c, text: latinToScript(c.text, script) })) : t.chunks,
    latin: t.text,
    transliterated: script,
  };
}
