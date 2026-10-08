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

// Spellings → tokens, longest first. A token is { v: vowelKey } | { c: [consonantKeys] } | { m: 'anusvara' | 'visarga' }.
const SPELLINGS = [
  ['ksh', { c: ['k', 'ṣ'] }], ['kṣ', { c: ['k', 'ṣ'] }], ['chh', { c: ['ch'] }], ['jñ', { c: ['j', 'ñ'] }],
  ['kh', { c: ['kh'] }], ['gh', { c: ['gh'] }], ['ch', { c: ['c'] }], ['jh', { c: ['jh'] }], ['ṭh', { c: ['ṭh'] }], ['ḍh', { c: ['ḍh'] }],
  ['th', { c: ['th'] }], ['dh', { c: ['dh'] }], ['ph', { c: ['ph'] }], ['bh', { c: ['bh'] }], ['sh', { c: ['ś'] }], ['ng', { c: ['ṅ', 'g'] }], ['ny', { c: ['ñ'] }],
  ['ai', { v: 'ai' }], ['au', { v: 'au' }], ['aa', { v: 'ā' }], ['ii', { v: 'ī' }], ['ee', { v: 'ī' }], ['uu', { v: 'ū' }], ['oo', { v: 'ū' }],
  ['ā', { v: 'ā' }], ['ī', { v: 'ī' }], ['ū', { v: 'ū' }], ['ṛ', { v: 'ṛ' }], ['ṝ', { v: 'ṝ' }], ['ē', { v: 'e' }], ['ō', { v: 'o' }],
  ['a', { v: 'a' }], ['i', { v: 'i' }], ['u', { v: 'u' }], ['e', { v: 'e' }], ['o', { v: 'o' }],
  ['ṃ', { m: 'anusvara' }], ['ṁ', { m: 'anusvara' }], ['ḥ', { m: 'visarga' }],
  ['k', { c: ['k'] }], ['g', { c: ['g'] }], ['ṅ', { c: ['ṅ'] }], ['c', { c: ['c'] }], ['j', { c: ['j'] }], ['ñ', { c: ['ñ'] }],
  ['ṭ', { c: ['ṭ'] }], ['ḍ', { c: ['ḍ'] }], ['ṇ', { c: ['ṇ'] }], ['t', { c: ['t'] }], ['d', { c: ['d'] }], ['n', { c: ['n'] }],
  ['p', { c: ['p'] }], ['b', { c: ['b'] }], ['m', { c: ['m'] }], ['y', { c: ['y'] }], ['r', { c: ['r'] }], ['l', { c: ['l'] }], ['ḷ', { c: ['ḷḷ'] }],
  ['v', { c: ['v'] }], ['w', { c: ['v'] }], ['ś', { c: ['ś'] }], ['ṣ', { c: ['ṣ'] }], ['s', { c: ['s'] }], ['h', { c: ['h'] }],
  ['x', { c: ['k', 'ṣ'] }], ['z', { c: ['j'] }], ['f', { c: ['ph'] }], ['q', { c: ['k'] }],
].sort((a, b) => b[0].length - a[0].length);

const isLatinLetter = (ch) => /\p{Script=Latin}/u.test(ch);

// Writes one romanised word in the script. Vowels after a consonant become signs (an "a"
// is inherent); a word-final m or h after a vowel is anusvāra or visarga; a word-final
// consonant otherwise carries a virama, as Sanskrit does.
function wordToScript(word, base) {
  const chars = Array.from(word.normalize('NFC').toLowerCase());
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
  while (i < chars.length) {
    let hit = null;
    for (const [sp, tok] of SPELLINGS) {
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
      out += cp(tok.m === 'anusvara' ? ANUSVARA : VISARGA);
      lastWasVowel = false;
    } else {
      if (atEnd && lastWasVowel && !cluster.length && (sp === 'm' || sp === 'h')) {
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
// text already in an Indic script) passes through.
export function latinToScript(text, script) {
  const base = SCRIPT_BASE[script];
  if (!base) return text;
  return String(text || '').replace(/[\p{Script=Latin}̀-ͯ]+/gu, (w) => wordToScript(w, base));
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
