// Sanskrit chandas (metre) of a śloka, read from its text: the count of akṣaras and their
// laghu / guru pattern, the family they fit — anuṣṭubh (4 pādas of 8) or the triṣṭubh
// family (4 pādas of 11: indravajrā, upendravajrā, upajāti) — and where the pāda and the
// half-verse breaks fall, so a transcript can be written out in two or four lines. Pure;
// shared by the app, the server and tools/chandas.mjs.

import { syllabify } from './phon.js';

// The Bhagavad Gītā's ślokas that are not in anuṣṭubh (all in the triṣṭubh family), by
// chapter: ranges of verses. Everything else in the Gītā is anuṣṭubh.
export const GITA_TRISHTUBH = { 2: [[5, 8], [20, 20], [22, 22], [29, 29], [70, 70]], 8: [[9, 11], [28, 28]], 9: [[20, 21]], 11: [[15, 50]], 15: [[2, 5], [15, 15]] };
export const GITA_VERSES = { 1: 47, 2: 72, 3: 43, 4: 42, 5: 29, 6: 47, 7: 30, 8: 28, 9: 34, 10: 42, 11: 55, 12: 20, 13: 35, 14: 27, 15: 20, 16: 24, 17: 28, 18: 78 };

export const FAMILIES = {
  anushtubh: { id: 'anushtubh', name: 'Anuṣṭubh', perPada: 8 },
  trishtubh: { id: 'trishtubh', name: 'Triṣṭubh', perPada: 11 },
};
export const INDRAVAJRA = 'GGLGGLLGLGG';
export const UPENDRAVAJRA = 'LGLGGLLGLGG';

// A sloka's name read as a Gītā chapter and verse: "CH12-04", "ch12-7", "12.4", "Gita 18-66".
export function gitaVerse(name) {
  const m = String(name || '').match(/(?<!\d)(\d{1,2})\s*[-_.:/ ]\s*(\d{1,2})(?!\d)/);
  if (!m) return null;
  const chapter = Number(m[1]);
  const verse = Number(m[2]);
  if (!GITA_VERSES[chapter] || verse < 1 || verse > GITA_VERSES[chapter]) return null;
  return { chapter, verse };
}
export function gitaFamily(chapter, verse) {
  const ranges = GITA_TRISHTUBH[chapter] || [];
  return ranges.some(([a, b]) => verse >= a && verse <= b) ? 'trishtubh' : 'anushtubh';
}

// guru (G): a long vowel, an anusvāra or visarga, a closing consonant, or a cluster opening
// the next akṣara (its first consonant closes this one); laghu (L) otherwise. The last
// akṣara of a pāda counts as free in the patterns below.
export function syllableWeights(aksharas) {
  return aksharas.map((a, i) => {
    const next = aksharas[i + 1];
    if (!a.vowel) return 'G';
    if (a.vowel.long || a.marks.length || a.coda.length) return 'G';
    if (next && next.onset.length >= 2) return 'G';
    return 'L';
  });
}

// What a text is in: the family (from `expected` when a table says so, else from the count),
// the name within the triṣṭubh family, the form, and how well the pattern fits.
//   form: anuṣṭubh — 'pathyā', 'vipulā' or 'irregular'; triṣṭubh — the pādas' kinds, I / U
//   (indravajrā / upendravajrā) or ? for one that fits neither, as "IUUI".
export function identifyChandas(text, { expected = null } = {}) {
  const A = syllabify(text);
  const n = A.length;
  const weights = syllableWeights(A).join('');
  let family = expected && FAMILIES[expected] ? expected : null;
  if (!family) {
    if (Math.abs(n - 32) <= 3) family = 'anushtubh';
    else if (Math.abs(n - 44) <= 4) family = 'trishtubh';
  }
  const none = { family: null, name: null, perPada: null, padas: 4, syllables: n, expectedSyllables: null, exact: false, weights, form: null, padaWeights: [], confidence: 0 };
  if (!family || !n) return none;
  const perPada = FAMILIES[family].perPada;
  const expectedSyllables = 4 * perPada;
  const exact = n === expectedSyllables;
  const padaWeights = [0, 1, 2, 3].map((p) => weights.slice(p * perPada, (p + 1) * perPada));
  let name = FAMILIES[family].name;
  let form = null;
  let confidence;
  if (family === 'anushtubh') {
    // the śloka's cadence: 5th light and 6th heavy in every pāda; 7th heavy in pādas 1 and 3
    // (pathyā; a vipulā varies them), light in pādas 2 and 4
    let fit = 0;
    let evenFit = 0;
    padaWeights.forEach((w, p) => {
      if (w.length < 7) return;
      const ok = w[4] === 'L' && w[5] === 'G' && (p % 2 === 0 ? w[6] === 'G' : w[6] === 'L');
      if (ok) fit++;
      if (ok && p % 2 === 1) evenFit++;
    });
    form = exact ? (fit === 4 ? 'pathyā' : evenFit === 2 ? 'vipulā' : 'irregular') : null;
    confidence = exact ? (4 + fit) / 8 : Math.max(0, 1 - Math.abs(n - 32) / 8) / 2;
  } else {
    const ref = INDRAVAJRA.slice(1, 10); // the two differ in their first syllable only
    const kinds = padaWeights.map((w) => {
      if (w.length < 11) return null;
      let match = 0;
      for (let i = 0; i < 9; i++) if (w[i + 1] === ref[i]) match++;
      if (match < 8) return 'other'; // one slip allowed: a transcript's vowel lengths are not exact
      return w[0] === 'G' ? 'indravajrā' : 'upendravajrā';
    });
    const good = kinds.filter((k) => k && k !== 'other');
    if (exact && good.length === 4) name = new Set(good).size === 1 ? (good[0] === 'indravajrā' ? 'Indravajrā' : 'Upendravajrā') : 'Upajāti';
    form = exact ? kinds.map((k) => (k && k !== 'other' ? k[0].toUpperCase() : '?')).join('') : null;
    confidence = exact ? good.length / 4 : Math.max(0, 1 - Math.abs(n - 44) / 8) / 2;
  }
  return { family, name, perPada, padas: 4, syllables: n, expectedSyllables, exact, weights, form, padaWeights, confidence: Math.round(confidence * 100) / 100 };
}

// Where a text breaks into lines by the metre: the index of the last word of each line but
// the last, for `lines` lines (2: the half-verses, 4: the pādas). Breaks fall between words
// only, each at the word boundary nearest the pāda count, so a transcript whose spaces are
// off breaks a syllable or two from the true boundary rather than inside a word; a boundary
// further than a pāda from the count is no break at all.
export function padaBreaks(words, perPada, lines = 2) {
  if (!perPada || words.length < 2) return [];
  const counts = words.map((w) => syllabify(w).length);
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return [];
  const targets = lines === 4 ? [perPada, 2 * perPada, 3 * perPada] : [2 * perPada];
  const cum = [];
  let acc = 0;
  for (const c of counts) { acc += c; cum.push(acc); }
  const breaks = [];
  let from = 0;
  for (const t of targets) {
    if (t >= total) break;
    let best = -1;
    let bestD = Infinity;
    for (let i = from; i < words.length - 1; i++) {
      const d = Math.abs(cum[i] - t);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0 || bestD > perPada) break;
    breaks.push(best);
    from = best + 1;
  }
  return breaks;
}

// How many lines a sloka is written in: the triṣṭubh family always in its four pādas; an
// anuṣṭubh in two (the half-verses) or four, as preferred. The daṇḍas go by pādas either
// way: । after the second pāda, ॥ after the fourth.
export const linesFor = (perPada, preferred = 2) => (perPada === 11 ? 4 : preferred === 4 ? 4 : 2);

// The text written out in its lines (see linesFor), unless it already has lines.
export function layoutSloka(text, { perPada = null, lines = 2 } = {}) {
  const src = String(text || '');
  if (src.split(/\r?\n/).filter((l) => l.trim()).length > 1) return src;
  const words = src.trim().split(/\s+/).filter(Boolean);
  const pp = perPada || identifyChandas(src).perPada;
  const breaks = padaBreaks(words, pp, linesFor(pp, lines));
  if (!breaks.length) return src.trim();
  const out = [];
  let start = 0;
  for (const b of breaks) { out.push(words.slice(start, b + 1).join(' ')); start = b + 1; }
  out.push(words.slice(start).join(' '));
  return out.join('\n');
}

// One line about a chandas, for a hint or a tag.
export function chandasLabel(ch) {
  if (!ch || !ch.family) return ch && ch.syllables ? `${ch.syllables} syllables · metre not recognised` : '';
  let s = `${ch.name} · 4 pādas of ${ch.perPada} syllables (${ch.expectedSyllables})`;
  if (ch.family === 'anushtubh' && ch.form) s += ` · ${ch.form}`;
  if (ch.family === 'trishtubh' && ch.form && ch.name === 'Upajāti') s += ` · ${ch.form.split('').join(' ')}`;
  if (!ch.exact && ch.syllables) s += ` · the text has ${ch.syllables}`;
  return s;
}
export function chandasPattern(ch) {
  if (!ch || !ch.family) return '';
  if (ch.family === 'trishtubh') return `Indravajrā ${INDRAVAJRA.split('').join(' ')} · Upendravajrā ${UPENDRAVAJRA.split('').join(' ')} · Upajāti mixes the two. G heavy, L light.`;
  return 'Each pāda of 8: the 5th syllable light, the 6th heavy; the 7th heavy in pādas 1 and 3 (pathyā), light in 2 and 4.';
}

// The chandas of a library record from the best text it has — the text typed in its
// details, else its Sanskrit transcript, else its current one — with the Gītā table deciding
// the family when the name says which verse it is. null without a text.
export function chandasForRecord({ name, meta, store }) {
  const typed = meta && meta.text && meta.text.body && meta.text.origin !== 'transcript' ? meta.text.body : null;
  const langs = store && store.languages ? store.languages : {};
  const sa = langs.sanskrit && langs.sanskrit.text ? langs.sanskrit : null;
  const cur = store && store.current && langs[store.current] && langs[store.current].text ? langs[store.current] : null;
  const t = typed ? { text: typed, source: 'typed', language: (meta.text.language || 'sa') }
    : sa ? { text: sa.text, source: 'transcript', language: 'sanskrit' }
      : cur ? { text: cur.text, source: 'transcript', language: store.current } : null;
  if (!t || !String(t.text).trim()) return null;
  const verse = gitaVerse(name);
  const expected = verse ? gitaFamily(verse.chapter, verse.verse) : null;
  const ch = identifyChandas(t.text, { expected });
  return {
    family: ch.family, name: ch.name, perPada: ch.perPada, padas: 4, syllables: ch.syllables, expectedSyllables: ch.expectedSyllables,
    exact: ch.exact, form: ch.form, weights: ch.weights, confidence: ch.confidence, source: t.source, language: t.language, verse, at: new Date().toISOString(),
  };
}
