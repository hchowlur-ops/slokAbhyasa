// The script a sloka is shown in. The words are always heard as Sanskrit (Devanagari);
// Kannada, Telugu and romanised (IAST) text are written from that, akṣara by akṣara, and
// in those three each akṣara carries its weight in the metre: laghu ◡ (light) or guru —
// (heavy), the way chandas is taught. Devanagari, Kannada and Telugu share one Unicode
// layout, so a script is a shift of the block; the romanisation comes from the akṣaras
// themselves (phon.js reads them). Pure; shared by the app and the tests.
import { syllabify, aksharaText } from './phon.js';
import { syllableWeights } from './chandas.js';
import { latinToScript, mostlyLatin, SCRIPT_BASE } from './translit.js';

export const SCRIPT_OF = { sanskrit: 'Deva', kannada: 'Knda', telugu: 'Telu', english: 'Latn' };
export const LAGHU = '◡';
export const GURU = '—';
export const weightMark = (w) => (w === 'G' ? GURU : w === 'L' ? LAGHU : '');

const DEVA = SCRIPT_BASE.Deva;
const DANDA = new Set([0x64, 0x65]); // । ॥ live in the Devanagari block and serve every script

// One Indic block to another: the same offsets, but for what only Devanagari has.
function shift(text, fromBase, toBase) {
  if (fromBase === toBase) return String(text || '');
  let out = '';
  for (const ch of String(text || '')) {
    const cp = ch.codePointAt(0);
    if ((cp & ~0x7f) !== fromBase) { out += ch; continue; }
    const off = cp - fromBase;
    if (DANDA.has(off)) { out += ch; continue; }
    if (off === 0x50) { out += String.fromCodePoint(toBase + 0x13, toBase + 0x02); continue; } // ॐ → ओं
    if (off === 0x3c) continue; // nukta: Devanagari only
    if (off === 0x01) { out += String.fromCodePoint(toBase + 0x02); continue; } // candrabindu → anusvāra
    if (off >= 0x58 && off <= 0x5f) { out += ch; continue; } // Devanagari's nukta letters: left as they are
    out += String.fromCodePoint(toBase + off);
  }
  return out;
}

// Any text a sloka may be typed or transcribed in, written in Devanagari: Kannada and
// Telugu by the shift, romanised text by translit.js, Devanagari as it is.
export function toDeva(text) {
  const s = String(text || '').normalize('NFC');
  if (mostlyLatin(s)) return latinToScript(s, 'Deva');
  let out = s;
  for (const b of [SCRIPT_BASE.Knda, SCRIPT_BASE.Telu]) out = shift(out, b, DEVA);
  return out;
}

// In Kannada, Telugu and romanised text the anusvāra stands where Devanagari may write a
// class nasal before a stop of its own place (सङ्ग → ಸಂಗ / saṃga, चिन्त्य → ಚಿಂತ್ಯ / ciṃtya):
// the circle ಂ / ం, or ṃ, the reader expects, whatever a transcription or a text wrote.
// Sanskrit itself is shown as written.
const NASAL_STOP = /ङ्(?=[कखगघ])|ञ्(?=[चछजझ])|ण्(?=[टठडढ])|न्(?=[तथदध])|म्(?=[पफबभ])/g;
export const anusvaraForm = (deva) => String(deva || '').replace(NASAL_STOP, 'ं');

// An akṣara in IAST; an avagraha after it is kept as an apostrophe (ते ऽपि → te’pi).
const aksharaLatin = (a) => aksharaText(a) + (a.src && a.src.includes('ऽ') ? '’' : '');
// Digits and the rest between words, in the script.
const sepIn = (p, script) => (script === 'Latn' ? p.replace(/[०-९]/g, (d) => String(d.codePointAt(0) - 0x966)) : shift(p, DEVA, SCRIPT_BASE[script]));

// A line in the script of a language, as a list of what lies between words ({ sep }) and
// the akṣaras of each word ({ text, weight }), the weight 'L' | 'G' of each when marks are
// wanted (by default in every language but Sanskrit, which is shown bare) and null otherwise.
export function segments(line, language, { marks = !!language && language !== 'sanskrit' } = {}) {
  const script = SCRIPT_OF[language] || 'Deva';
  const deva = script === 'Deva' ? toDeva(line) : anusvaraForm(toDeva(line));
  if (script === 'Deva' && !marks) return deva ? [{ sep: deva }] : [];
  const A = syllabify(deva);
  const W = syllableWeights(A);
  const parts = deva.match(/[\p{L}\p{M}]+|[^\p{L}\p{M}]+/gu) || [];
  const out = [];
  let wi = 0;
  let ai = 0;
  for (const p of parts) {
    if (!/[\p{L}\p{M}]/u.test(p)) { out.push({ sep: sepIn(p, script) }); continue; }
    const mine = [];
    while (ai < A.length && A[ai].word === wi) mine.push(ai++);
    wi++;
    if (!mine.length) { out.push({ text: script === 'Latn' ? p : shift(p, DEVA, SCRIPT_BASE[script]), weight: null }); continue; } // nothing read as an akṣara (a Latin word, say)
    for (const k of mine) {
      const a = A[k];
      const text = script === 'Latn' ? aksharaLatin(a) : script === 'Deva' ? a.src : shift(a.src, DEVA, SCRIPT_BASE[script]);
      out.push({ text, weight: marks ? W[k] : null });
    }
  }
  return out;
}

// The same for a list of words (the tokens of a transcript): one list of akṣaras per word,
// the weights read across the words as in the line they make. A word that does not read
// as akṣaras keeps its place, written plainly.
export function wordSegments(words, language, opts = {}) {
  const segs = segments(words.join(' '), language, opts);
  const out = [];
  let cur = [];
  for (const s of segs) {
    if (s.sep != null) { if (cur.length) { out.push(cur); cur = []; } } else cur.push(s);
  }
  if (cur.length) out.push(cur);
  return out.length === words.length ? out : words.map((w) => [{ text: inScript(w, language), weight: null }]);
}

// Plain text in the script of a language, no marks.
export function inScript(text, language) {
  const script = SCRIPT_OF[language] || 'Deva';
  if (script === 'Deva') return toDeva(text);
  const deva = anusvaraForm(toDeva(text));
  if (script !== 'Latn') return shift(deva, DEVA, SCRIPT_BASE[script]);
  return deva.split('\n').map((line) => segments(line, language, { marks: false }).map((s) => (s.sep != null ? s.sep : s.text)).join('')).join('\n');
}
