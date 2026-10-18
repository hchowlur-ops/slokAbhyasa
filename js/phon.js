// Sanskrit phonology from written text, and the comparison of two recitations at the
// level of akṣaras (syllables) and phonemes: what the Bhagavad Gītā actually asks of a
// reciter — the right sounds (place of articulation, voicing, aspiration, nasals, visarga,
// double consonants), the right vowel lengths, no syllable missing or added — and not the
// reciter's voice. Works on Devanagari, Kannada and Telugu text (the three share one
// Unicode layout); romanised text is first written in Devanagari by translit.js. Pure.

import { latinToScript, mostlyLatin } from './translit.js';

// consonants, by offset from the script block's base
const CONS = {
  0x15: ['k', 'velar', 0, 0], 0x16: ['kh', 'velar', 0, 1], 0x17: ['g', 'velar', 1, 0], 0x18: ['gh', 'velar', 1, 1], 0x19: ['ṅ', 'velar', 1, 0, 'nasal'],
  0x1a: ['c', 'palatal', 0, 0], 0x1b: ['ch', 'palatal', 0, 1], 0x1c: ['j', 'palatal', 1, 0], 0x1d: ['jh', 'palatal', 1, 1], 0x1e: ['ñ', 'palatal', 1, 0, 'nasal'],
  0x1f: ['ṭ', 'retroflex', 0, 0], 0x20: ['ṭh', 'retroflex', 0, 1], 0x21: ['ḍ', 'retroflex', 1, 0], 0x22: ['ḍh', 'retroflex', 1, 1], 0x23: ['ṇ', 'retroflex', 1, 0, 'nasal'],
  0x24: ['t', 'dental', 0, 0], 0x25: ['th', 'dental', 0, 1], 0x26: ['d', 'dental', 1, 0], 0x27: ['dh', 'dental', 1, 1], 0x28: ['n', 'dental', 1, 0, 'nasal'],
  0x29: ['n', 'dental', 1, 0, 'nasal'], 0x2a: ['p', 'labial', 0, 0], 0x2b: ['ph', 'labial', 0, 1], 0x2c: ['b', 'labial', 1, 0], 0x2d: ['bh', 'labial', 1, 1], 0x2e: ['m', 'labial', 1, 0, 'nasal'],
  0x2f: ['y', 'palatal', 1, 0, 'approximant'], 0x30: ['r', 'retroflex', 1, 0, 'approximant'], 0x31: ['r', 'retroflex', 1, 0, 'approximant'], 0x32: ['l', 'dental', 1, 0, 'approximant'],
  0x33: ['ḷ', 'retroflex', 1, 0, 'approximant'], 0x34: ['ḷ', 'retroflex', 1, 0, 'approximant'], 0x35: ['v', 'labial', 1, 0, 'approximant'],
  0x36: ['ś', 'palatal', 0, 0, 'sibilant'], 0x37: ['ṣ', 'retroflex', 0, 0, 'sibilant'], 0x38: ['s', 'dental', 0, 0, 'sibilant'], 0x39: ['h', 'glottal', 1, 1, 'fricative'],
};
// vowels: independent letters and the signs, by offset → [name, long]
const VOWEL_IND = { 0x05: ['a', 0], 0x06: ['a', 1], 0x07: ['i', 0], 0x08: ['i', 1], 0x09: ['u', 0], 0x0a: ['u', 1], 0x0b: ['ṛ', 0], 0x60: ['ṛ', 1], 0x0c: ['ḷ', 0], 0x61: ['ḷ', 1], 0x0e: ['e', 0], 0x0f: ['e', 1], 0x10: ['ai', 1], 0x12: ['o', 0], 0x13: ['o', 1], 0x14: ['au', 1], 0x0d: ['e', 0], 0x11: ['o', 0] };
const VOWEL_SIGN = { 0x3e: ['a', 1], 0x3f: ['i', 0], 0x40: ['i', 1], 0x41: ['u', 0], 0x42: ['u', 1], 0x43: ['ṛ', 0], 0x44: ['ṛ', 1], 0x46: ['e', 0], 0x47: ['e', 1], 0x48: ['ai', 1], 0x4a: ['o', 0], 0x4b: ['o', 1], 0x4c: ['au', 1], 0x62: ['ḷ', 0], 0x63: ['ḷ', 1], 0x45: ['e', 0], 0x49: ['o', 0] };
const BASES = [0x0900, 0x0c80, 0x0c00, 0x0980, 0x0a80, 0x0a00, 0x0b00, 0x0b80, 0x0d00];
const blockOf = (cp) => { const b = cp & ~0x7f; return BASES.includes(b) ? b : null; };

const cons = (off) => { const c = CONS[off]; return c ? { ph: c[0], place: c[1], voiced: !!c[2], asp: !!c[3], kind: c[4] || 'stop' } : null; };

// Text → akṣaras: [{ onset: [cons], vowel: { v, long } | null, marks: ['ṃ'|'ḥ'], coda: [cons],
// word, text, src, from, to }]. A consonant with a virama joins the next akṣara's onset; at
// a word's end it closes the last akṣara (coda). `src` is the stretch of the word the akṣara
// was read from (chars from..to), so a text can be written out akṣara by akṣara. Latin
// words are read as IAST / ASCII romanisation.
export function syllabify(text) {
  const out = [];
  let src = String(text || '').normalize('NFC');
  if (mostlyLatin(src)) src = latinToScript(src, 'Deva');
  const words = src.split(/[^\p{L}\p{M}]+/u).filter(Boolean);
  words.forEach((word, wi) => {
    let onset = [];
    let onsetFrom = null; // where the consonants waiting for their akṣara begin
    let cur = null;
    const first = out.length;
    const close = () => { if (cur) { out.push(cur); cur = null; } };
    const lastOfWord = () => cur || (out.length > first ? out[out.length - 1] : null);
    const chars = Array.from(word);
    for (let i = 0; i < chars.length; i++) {
      const cp = chars[i].codePointAt(0);
      const base = blockOf(cp);
      if (base === null) { const t = lastOfWord(); if (t) t.to = i + 1; continue; } // a stray Latin letter or mark inside an Indic word
      const off = cp - base;
      if (off === 0x50) { close(); out.push({ onset: [], vowel: { v: 'o', long: true }, marks: ['ṃ'], coda: [], word: wi, text: '', from: onsetFrom ?? i, to: i + 1 }); onset = []; onsetFrom = null; continue; } // ॐ
      if (CONS[off]) {
        const c = cons(off);
        const ci = i;
        if (onsetFrom === null) onsetFrom = i;
        const next = i + 1 < chars.length ? chars[i + 1].codePointAt(0) - base : -1;
        if (next === 0x4d) { close(); onset.push(c); i++; continue; } // virama: the cluster goes on
        if (next === 0x3c) { i++; } // nukta: ignored
        const n2 = i + 1 < chars.length ? chars[i + 1].codePointAt(0) - base : -1;
        close();
        let vowel = { v: 'a', long: false };
        if (VOWEL_SIGN[n2]) { vowel = { v: VOWEL_SIGN[n2][0], long: !!VOWEL_SIGN[n2][1] }; i++; }
        // सङ्ग and संग are one pronunciation: a nasal opening a cluster before a stop of its
        // own place is the anusvāra of the akṣara before (Whisper writes the anusvāra form)
        const prev = out.length > first ? out[out.length - 1] : null;
        let from = onsetFrom;
        if (prev && onset.length && onset[0].kind === 'nasal' && c.kind === 'stop' && onset[0].place === c.place && onset.length === 1) {
          if (!prev.marks.includes('ṃ')) prev.marks.push('ṃ');
          prev.to = ci; // the nasal and its virama belong to the akṣara before
          onset = [];
          from = ci;
        }
        cur = { onset: [...onset, c], vowel, marks: [], coda: [], word: wi, text: '', from, to: i + 1 };
        onset = [];
        onsetFrom = null;
        continue;
      }
      if (VOWEL_IND[off]) { close(); cur = { onset: onset.splice(0), vowel: { v: VOWEL_IND[off][0], long: !!VOWEL_IND[off][1] }, marks: [], coda: [], word: wi, text: '', from: onsetFrom ?? i, to: i + 1 }; onsetFrom = null; continue; }
      if (off === 0x02 || off === 0x01) { if (cur) { cur.marks.push('ṃ'); cur.to = i + 1; } continue; }
      if (off === 0x03) { if (cur) { cur.marks.push('ḥ'); cur.to = i + 1; } continue; }
      // a virama without a consonant before it, an avagraha, digits: kept with the akṣara before
      { const t = lastOfWord(); if (t) t.to = i + 1; }
    }
    close();
    if (onset.length) {
      // consonants left at the word's end (a final virama): the coda of the last akṣara of this word
      const last = out.length > first ? out[out.length - 1] : null;
      if (last) { last.coda.push(...onset); last.to = chars.length; }
      else out.push({ onset, vowel: null, marks: [], coda: [], word: wi, text: '', from: onsetFrom ?? 0, to: chars.length });
    }
    for (let k = first; k < out.length; k++) out[k].src = chars.slice(out[k].from, out[k].to).join('');
  });
  for (const a of out) a.text = aksharaText(a);
  return out;
}

const vowelText = (v) => (v ? (v.long ? { a: 'ā', i: 'ī', u: 'ū', ṛ: 'ṝ', ḷ: 'ḹ', e: 'e', o: 'o', ai: 'ai', au: 'au' }[v.v] : { e: 'ĕ', o: 'ŏ' }[v.v] || v.v) : '');
export const aksharaText = (a) => `${a.onset.map((c) => c.ph).join('')}${vowelText(a.vowel)}${a.marks.join('')}${a.coda.map((c) => c.ph).join('')}`;

// ---------- comparison ----------

// How alike two consonants are, and what separates them. 1: the same; 0.5: one feature
// apart (aspiration, voicing, place within the same kind, nasal/stop at the same place);
// 0: different sounds.
export function consonantMatch(a, b) {
  if (a.ph === b.ph) return { credit: 1, error: null };
  if (a.kind === b.kind && a.place === b.place && a.voiced === b.voiced && a.asp !== b.asp) return { credit: 0.5, error: 'aspiration' };
  if (a.kind === b.kind && a.place === b.place && a.asp === b.asp && a.voiced !== b.voiced) return { credit: 0.5, error: 'voicing' };
  if (a.kind === b.kind && a.voiced === b.voiced && a.asp === b.asp && a.place !== b.place) return { credit: 0.5, error: 'place' };
  if ((a.kind === 'nasal') !== (b.kind === 'nasal') && a.place === b.place) return { credit: 0.5, error: 'nasality' };
  if (a.kind === 'sibilant' && b.kind === 'sibilant') return { credit: 0.5, error: 'place' };
  return { credit: 0, error: 'other' };
}

// Credit for one aligned pair of akṣaras and the errors in it.
export function compareAksharas(r, h) {
  const errors = [];
  let credit = 0;
  let n = 0;
  const alignCons = (A, B) => {
    // consonants in order; a surplus on either side is an error each
    const m = Math.min(A.length, B.length);
    for (let i = 0; i < m; i++) { const c = consonantMatch(A[i], B[i]); credit += c.credit; n++; if (c.error) errors.push({ kind: c.error, ref: A[i].ph, heard: B[i].ph }); }
    for (let i = m; i < A.length; i++) { n++; errors.push({ kind: 'missing', ref: A[i].ph, heard: '' }); }
    for (let i = m; i < B.length; i++) { n++; errors.push({ kind: 'added', ref: '', heard: B[i].ph }); }
  };
  alignCons(r.onset, h.onset);
  alignCons(r.coda, h.coda);
  // double consonants: the same sound twice in a row (ends one akṣara, begins the next, or inside a cluster)
  const gem = (a) => a.onset.length >= 2 && a.onset[0].ph === a.onset[1].ph;
  if (gem(r) !== gem(h)) { errors.push({ kind: 'length', ref: r.onset.map((c) => c.ph).join(''), heard: h.onset.map((c) => c.ph).join('') }); }
  // anusvāra / visarga: counted where either side has one
  for (const m of ['ṃ', 'ḥ']) {
    const a = r.marks.includes(m); const b = h.marks.includes(m);
    if (!a && !b) continue;
    n++;
    if (a === b) credit += 1; else errors.push({ kind: m === 'ḥ' ? 'visarga' : 'nasality', ref: a ? m : '', heard: b ? m : '' });
  }
  // the vowel: its identity counts here, its length under vowel quantity
  let vowelLength = null; // true: the same length; false: a short/long slip; null: no comparison
  if (r.vowel && h.vowel) {
    n++;
    if (r.vowel.v === h.vowel.v) { credit += 1; vowelLength = r.vowel.long === h.vowel.long; if (!vowelLength) errors.push({ kind: 'vowelLength', ref: vowelText(r.vowel), heard: vowelText(h.vowel) }); }
    else errors.push({ kind: 'vowel', ref: vowelText(r.vowel), heard: vowelText(h.vowel) });
  } else if (!!r.vowel !== !!h.vowel) { n++; errors.push({ kind: 'vowel', ref: vowelText(r.vowel), heard: vowelText(h.vowel) }); }
  return { credit: n ? credit / n : 1, n, errors, vowelLength };
}

// Alignment of two akṣara sequences by edit distance, substitutions costing what the pair's
// phoneme credit leaves wanting, so a slightly mispronounced akṣara aligns as itself.
function alignAksharas(R, H) {
  const n = R.length; const m = H.length;
  const D = new Float32Array((n + 1) * (m + 1));
  const W = m + 1;
  for (let i = 1; i <= n; i++) D[i * W] = i;
  for (let j = 1; j <= m; j++) D[j] = j;
  const sub = new Float32Array((n + 1) * (m + 1));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const s = 1 - compareAksharas(R[i - 1], H[j - 1]).credit;
    sub[i * W + j] = s;
    D[i * W + j] = Math.min(D[(i - 1) * W + j] + 1, D[i * W + j - 1] + 1, D[(i - 1) * W + j - 1] + s * 1.6);
  }
  const pairs = [];
  let i = n; let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && Math.abs(D[i * W + j] - (D[(i - 1) * W + j - 1] + sub[i * W + j] * 1.6)) < 1e-6) { pairs.push({ r: i - 1, h: j - 1 }); i--; j--; }
    else if (i > 0 && Math.abs(D[i * W + j] - (D[(i - 1) * W + j] + 1)) < 1e-6) { pairs.push({ r: i - 1, h: -1 }); i--; }
    else { pairs.push({ r: -1, h: j - 1 }); j--; }
  }
  return pairs.reverse();
}

// Whisper writes a recited visarga as the breath it hears: "रताः" comes back as "रताहा",
// "मैत्रः" as "मैत्रह", "रताः" even as "रतहः". So where one side's akṣara carries ḥ and the
// other side has the same akṣara followed by a stray ha / hā (an echo syllable in the same
// word, or standing alone), the echo is read as that akṣara's visarga. The side with the
// ḥ guides the fold, so a genuine final -ha (iha, deha, saha) is never folded away, and a
// visarga that was really dropped ("रता", nothing after it) is still a slip.
//   pairs → the pairs with folded echoes removed; R / H are updated in place;
//   returns how many echoes were folded on each side (they no longer count as akṣaras).
const isEcho = (a) => a.onset.length === 1 && a.onset[0].ph === 'h' && !a.coda.length && (!a.vowel || a.vowel.v === 'a') && !a.marks.includes('ṃ');
const echoBelongs = (X, i, host) => X[i].word === host.word || ((i === 0 || X[i - 1].word !== X[i].word) && (i === X.length - 1 || X[i + 1].word !== X[i].word));
const withVisarga = (a) => { const b = { ...a, marks: a.marks.includes('ḥ') ? a.marks : [...a.marks, 'ḥ'] }; b.text = aksharaText(b); return b; };
function foldVisargaEchoes(R, H, pairs) {
  const out = [];
  const folded = { ref: 0, heard: 0 };
  // The alignment puts the echo either after the akṣara (pair, then the echo inserted) or in
  // its place (the akṣara inserted, then the echo paired with the ḥ-bearing one, since the
  // two share the vowel and the mark). Both shapes fold to one pair.
  const tryFold = (X, Y, xOf, yOf, k) => {
    // X: the side with the ḥ, Y: the side that spelt it out; xOf/yOf read a pair's index on each side
    const a = pairs[k]; const b = pairs[k + 1];
    if (!b) return null;
    let hostPair = null; let host = -1; let echo = -1;
    if (xOf(a) >= 0 && yOf(a) >= 0 && xOf(b) < 0 && yOf(b) === yOf(a) + 1) { hostPair = a; host = yOf(a); echo = yOf(b); }
    else if (xOf(a) < 0 && xOf(b) >= 0 && yOf(b) === yOf(a) + 1) { hostPair = b; host = yOf(a); echo = yOf(b); }
    if (!hostPair) return null;
    const x = X[xOf(hostPair)];
    if (!x.marks.includes('ḥ') || Y[host].marks.includes('ḥ') || !isEcho(Y[echo]) || !echoBelongs(Y, echo, Y[host])) return null;
    Y[host] = withVisarga(Y[host]);
    return { x: xOf(hostPair), y: host };
  };
  for (let k = 0; k < pairs.length; k++) {
    let f = tryFold(R, H, (p) => p.r, (p) => p.h, k);
    if (f) { folded.heard++; out.push({ r: f.x, h: f.y }); k++; continue; }
    f = tryFold(H, R, (p) => p.h, (p) => p.r, k);
    if (f) { folded.ref++; out.push({ r: f.y, h: f.x }); k++; continue; }
    out.push(pairs[k]);
  }
  return { pairs: out, folded };
}

// Visarga sandhi in recitation, as the śikṣā rules have it: before क / ख the visarga is the
// jihvāmūlīya and before प / फ the upadhmānīya — a half-aspirate that a listener (Whisper
// among them) hears as the stop aspirated, with nothing before it ("tapaḥ kuru" as "tapa
// khuru", "gamaḥ pārtha" as "gama phārtha"); before स / श / ष it is that sibilant doubled
// ("rāmaḥ sakhaḥ" as "rāmassakhaḥ"); before क्ष it is sounded in full; and at the end of a
// pāda, where a pause follows, it is sounded in full too. Where the text's akṣara carries ः
// before such a sound and the hearing has the sandhi form instead — the akṣara without
// ḥ, the next one opening with the aspirated stop (or the plain one) or the doubled
// sibilant — the heard akṣaras are read as the text's: nothing was dropped or changed.
// A hearing that keeps the ḥ and aspirates the stop is read the same way. Both akṣaras
// must have been heard, side by side. Returns how many were read this way.
function foldVisargaSandhi(R, H, pairs, isPadaEnd) {
  let folded = 0;
  const byRef = new Map();
  pairs.forEach((p, k) => { if (p.r >= 0) byRef.set(p.r, k); });
  const retext = (a) => { a.text = aksharaText(a); return a; };
  for (let r = 0; r + 1 < R.length; r++) {
    const a = R[r];
    if (!a.marks.includes('ḥ') || isPadaEnd(r)) continue;
    const next = R[r + 1];
    const c0 = next.onset[0];
    if (!c0) continue;
    let kind = null;
    if (c0.kind === 'stop' && !c0.voiced && (c0.place === 'velar' || c0.place === 'labial')) kind = c0.ph === 'k' && next.onset[1] && next.onset[1].ph === 'ṣ' ? null : 'stop'; // क्ष: the visarga stays
    else if (c0.kind === 'sibilant') kind = 'sibilant';
    if (!kind) continue;
    const k = byRef.get(r);
    const k2 = byRef.get(r + 1);
    if (k == null || k2 == null) continue;
    const ha = pairs[k].h;
    const hb = pairs[k2].h;
    if (ha < 0 || hb < 0 || hb !== ha + 1) continue;
    const x = H[ha];
    const y = H[hb];
    const y0 = y.onset[0];
    if (!y0) continue;
    if (x.marks.includes('ḥ')) {
      // the visarga was heard; the stop aspirated after it is the same half-aspirate
      if (kind === 'stop' && y0.kind === 'stop' && !y0.voiced && y0.place === c0.place && y0.asp && !c0.asp) { H[hb] = retext({ ...y, onset: [{ ...c0 }, ...y.onset.slice(1)] }); folded++; }
      continue;
    }
    let onset = null;
    if (kind === 'stop' && y0.kind === 'stop' && !y0.voiced && y0.place === c0.place) onset = [{ ...c0 }, ...y.onset.slice(1)]; // kh for k, ph (f) for p — or the plain stop
    else if (kind === 'sibilant' && y0.kind === 'sibilant') onset = [{ ...c0 }, ...y.onset.slice(y.onset[1] && y.onset[1].kind === 'sibilant' && y.onset[1].ph === y0.ph ? 2 : 1)]; // the sibilant, doubled or not
    if (!onset) continue;
    H[ha] = withVisarga(x);
    H[hb] = retext({ ...y, onset });
    folded++;
  }
  return folded;
}

export const ERROR_LABEL = {
  aspiration: 'aspiration (k/kh, g/gh…)', voicing: 'voicing (k/g, t/d…)', place: 'place of articulation (t/ṭ, s/ś/ṣ…)', nasality: 'nasal (anusvāra, n/ṇ/ṅ)',
  visarga: 'visarga (ḥ)', length: 'double consonant', vowel: 'vowel', vowelLength: 'vowel length (a/ā, i/ī, u/ū)', missing: 'sound missing', added: 'sound added', other: 'other sound',
};

// The recitation (heard) against the text (ref), both as text. Returns the three scores
// (0–100) and what lay behind them:
//   syllables – akṣaras missing, added or unrecognisable, out of the text's
//   phonemes   – consonants, marks and vowel identity in the akṣaras that aligned
//   vowels     – vowel length in the akṣaras whose vowel was the right one
//   padas      – with `perPada` (8 for anuṣṭubh, 11 for the triṣṭubh family), per pāda of
//                the text from `offset` on: its akṣaras and how many were heard, missing,
//                added, replaced
//   plan       – the verse's own units (canon.js / verses.versePlan: the speaker line, the
//                pādas, an attribution inside the verse), which place the pāda ends and the
//                per-pāda counts exactly, hypermetric pādas included; `perPada` and `offset`
//                are the arithmetic used without one
export function comparePhonology(refText, heardText, { perPada = null, offset = 0, plan = null } = {}) {
  const R = syllabify(refText);
  const H = syllabify(heardText);
  if (!R.length) return null;
  const { pairs, folded } = foldVisargaEchoes(R, H, alignAksharas(R, H));
  // where a pāda ends and which pāda an akṣara is in: by the plan when there is one, by the
  // metre from `offset` otherwise, else at the text's line ends
  let unitOfRef = null; // akṣara index → pāda index (0-based), null in the speaker line or an attribution inside
  const unitEnds = new Set();
  let unitCount = 0;
  if (plan && Array.isArray(plan.padas) && plan.padas.length) {
    unitOfRef = [];
    const sp = plan.speakerLine || 0;
    const speakerUnits = new Set(Array.isArray(plan.speakerUnits) ? plan.speakerUnits : []);
    for (let r = 0; r < sp; r++) unitOfRef.push(null);
    if (sp) unitEnds.add(sp - 1);
    let acc = sp;
    plan.padas.forEach((n, u) => { const idx = speakerUnits.has(u) ? null : unitCount++; for (let k = 0; k < n; k++) unitOfRef.push(idx); acc += n; unitEnds.add(acc - 1); });
    for (let r = unitOfRef.length; r < R.length; r++) unitOfRef.push(unitCount ? unitCount - 1 : null); // text beyond the plan: the last pāda
  }
  const lineEnds = new Set();
  if (!perPada && !unitOfRef) { let acc = 0; for (const line of String(refText || '').split(/\r?\n/)) { const n = syllabify(line).length; if (n) { acc += n; lineEnds.add(acc - 1); } } }
  const isPadaEnd = (r) => (unitOfRef ? unitEnds.has(r) : perPada ? r >= offset && (r - offset + 1) % perPada === 0 : lineEnds.has(r));
  const sandhi = foldVisargaSandhi(R, H, pairs, isPadaEnd);
  const refCount = R.length - folded.ref;
  const heardCount = H.length - folded.heard;
  let missing = 0; let added = 0; let unrelated = 0;
  let credit = 0; let n = 0;
  let vowelsCompared = 0; let vowelSlips = 0;
  const errors = {};
  const examples = [];
  const aligned = [];
  // four pādas; a text with syllables beyond the metre's count keeps them in the fourth
  // four pādas, counted from `offset` (the akṣaras of an "arjuna uvāca" opening the text)
  const padas = unitOfRef ? (unitCount ? Array.from({ length: unitCount }, () => ({ ref: 0, heard: 0, missing: 0, added: 0, replaced: 0 })) : null)
    : perPada ? Array.from({ length: Math.max(1, Math.min(4, Math.ceil(Math.max(1, refCount - offset) / perPada))) }, () => ({ ref: 0, heard: 0, missing: 0, added: 0, replaced: 0 })) : null;
  let lastRef = 0; // the pāda an added akṣara belongs to: that of the text's akṣara before it
  const pada = (r) => (!padas ? null : unitOfRef ? (unitOfRef[r] == null ? null : padas[unitOfRef[r]]) : r >= offset ? padas[Math.min(padas.length - 1, Math.floor((r - offset) / perPada))] : null);
  for (const p of pairs) {
    if (p.r >= 0) lastRef = p.r;
    const pd = pada(lastRef);
    if (p.r < 0) { added++; if (pd) { pd.added++; pd.heard++; } aligned.push({ ref: '', heard: H[p.h].text, kind: 'added' }); continue; }
    if (pd) pd.ref++;
    if (p.h < 0) { missing++; if (pd) pd.missing++; aligned.push({ ref: R[p.r].text, heard: '', kind: 'missing' }); continue; }
    if (pd) pd.heard++;
    const c = compareAksharas(R[p.r], H[p.h]);
    // less than half its sounds right: another syllable altogether, not a slip in this one
    if (c.credit < 0.5) { unrelated++; if (pd) pd.replaced++; aligned.push({ ref: R[p.r].text, heard: H[p.h].text, kind: 'replaced' }); continue; }
    credit += c.credit * c.n; n += c.n;
    if (c.vowelLength !== null) { vowelsCompared++; if (!c.vowelLength) vowelSlips++; }
    for (const e of c.errors) {
      errors[e.kind] = (errors[e.kind] || 0) + 1;
      if (examples.length < 12) examples.push({ kind: e.kind, ref: R[p.r].text, heard: H[p.h].text, detail: `${e.ref || '∅'} → ${e.heard || '∅'}`, word: R[p.r].word });
    }
    aligned.push({ ref: R[p.r].text, heard: H[p.h].text, kind: c.credit === 1 && c.vowelLength !== false ? 'ok' : 'slip' });
  }
  const pct = (v) => Math.round(100 * Math.max(0, Math.min(1, v)));
  return {
    syllables: pct(1 - (missing + added + unrelated) / refCount),
    phonemes: n ? pct(credit / n) : null,
    vowels: vowelsCompared ? pct(1 - vowelSlips / vowelsCompared) : null,
    counts: { ref: refCount, heard: heardCount, missing, added, replaced: unrelated, phonemesCompared: n, vowelsCompared, vowelSlips, visargaEchoes: folded.heard + folded.ref, visargaSandhi: sandhi },
    errors,
    examples,
    aligned,
    padas,
  };
}
