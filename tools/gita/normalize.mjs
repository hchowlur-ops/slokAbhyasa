// The Bhagavad Gītā reference dataset, normalised from the vedicscriptures JSON (see
// README.md in this folder) into the shape js/verses.js describes: one entry per verse with
// the Devanagari half-verses as lines, the IAST likewise, the speaker (who, and the
// attribution line when the verse opens with one), the kind (verse / colophon) and the
// metre. Pure; the fetch tool and the tests use it.
import { gitaFamily, GITA_VERSES, identifyChandas } from '../../js/chandas.js';
import { FAMILY_NAMES, compareVerseOrder } from '../../js/verses.js';

export const DATASET_ID = 'gita';
export const SCHEMA_VERSION = '1.0.0';

// "अर्जुन उवाच" → arjuna; "श्रीभगवानुवाच" (sandhi of भगवान् + उवाच) → krishna, in whatever
// spelling or spacing the source has
const SPEAKERS = [
  [/^(श्री\s*)?भगवा(नु|न्\s*उ)वाच$/, 'krishna'],
  [/^अर्जुन\s*उवाच$/, 'arjuna'],
  [/^स(ञ्ज|ंज)य\s*उवाच$/, 'sanjaya'],
  [/^धृतराष्ट्र\s*उवाच$/, 'dhritarashtra'],
];
export function speakerOf(line) {
  const s = String(line || '').normalize('NFC').replace(/[|।॥]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [form, who] of SPEAKERS) if (form.test(s)) return who;
  return null;
}
const isSpeakerLine = (line) => speakerOf(line) !== null; // (in sandhi the "u" of uvāca is a vowel sign: no literal word to look for)

// "||२-४७||" or "||2-47||" at the end of the text: the verse's own marker
const MARKER = /\s*\|\|\s*[०-९0-9]+\s*-\s*[०-९0-9]+\s*\|\|\s*$/;
const MARKER_IAST = /\s*\|\|\s*\d+\s*-\s*\d+\s*\|\|\s*$/;
const MARKER_COLOPHON = /\s*\|\|\s*[०-९0-9]+\s*\|\|\s*$/;
const MARKER_COLOPHON_IAST = /\s*\|\|\s*\d+\s*\|\|\s*$/;

// ASCII daṇḍas to the Devanagari ones, each half-verse keeping its own
const devaDandas = (line) => line.replace(/\s*\|\|\s*$/, ' ॥').replace(/\s*\|\s*$/, ' ।').replace(/\|\|/g, '॥').replace(/\|/g, '।');

// The Devanagari of one verse: { speakerLine, lines }, the marker dropped (the verse's
// closing ॥ kept), NFC, daṇḍas ।॥
export function parseSlok(slok) {
  const text = String(slok || '').normalize('NFC').replace(/\r/g, '').replace(MARKER, ' ॥').replace(MARKER_COLOPHON, ' ॥');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let speakerLine = null;
  if (lines.length && isSpeakerLine(lines[0])) speakerLine = lines.shift().replace(/[|।॥]/g, ' ').replace(/\s+/g, ' ').trim();
  return { speakerLine, lines: lines.map(devaDandas) };
}

// The IAST of one verse: the marker dropped (the closing || kept), "." (daṇḍa) → "|",
// ".a" (avagraha) → ’
export function parseIast(transliteration) {
  const text = String(transliteration || '').normalize('NFC').replace(/\r/g, '').replace(MARKER_IAST, ' ||').replace(MARKER_COLOPHON_IAST, ' ||');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = lines.map((l) => l.replace(/\.a/g, '’a').replace(/\s*\|\|\s*$/, ' ||').replace(/\s*\.\s*$/, ' |').replace(/\s*\|\s*$/, (m) => m));
  let speakerLine = null;
  if (out.length && /uvāca/.test(out[0]) && !/\|\|/.test(out[0]) && out[0].split(' ').length <= 3) speakerLine = out.shift().replace(/\s*\|\s*$/, '');
  return { speakerLine, lines: out };
}

// Typo fixes: { "8.12": [["wrong", "right"], …] }; a fix that finds nothing is reported once.
export function applyOverrides(id, lines, overrides, report) {
  const fixes = overrides && overrides[id];
  if (!fixes) return lines;
  for (const [from] of fixes) if (report && !lines.some((x) => x.includes(from))) report.push(`${id}: override "${from}" not found`);
  return lines.map((line) => {
    let l = line;
    for (const [from, to] of fixes) if (l.includes(from)) l = l.split(from).join(to);
    return l;
  });
}

// One entry from a source slok file: a verse, or the chapter's colophon (numbered past the
// chapter's verse count in the source).
export function verseRecord(src, { overrides = null, report = null, speakerSoFar = null } = {}) {
  const chapter = Number(src.chapter);
  const verse = Number(src.verse);
  const total = GITA_VERSES[chapter] || 0;
  const kind = verse > total ? 'colophon' : 'verse';
  const id = kind === 'colophon' ? `${chapter}.colophon` : `${chapter}.${verse}`;
  const deva = parseSlok(src.slok);
  const iast = parseIast(src.transliteration);
  let lines = deva.lines.map((l) => l.replace(/\s*\(or [^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()); // an editorial variant note inside the text
  lines = applyOverrides(id, lines, overrides, report);
  const who = deva.speakerLine ? speakerOf(deva.speakerLine) : speakerSoFar;
  const family = kind === 'verse' ? gitaFamily(chapter, verse) : null;
  return {
    id, kind, chapter, verse: kind === 'verse' ? verse : null, verseEnd: null,
    speaker: kind === 'verse' ? { who, deva: deva.speakerLine, iast: iast.speakerLine } : null,
    deva: lines, iast: iast.lines,
    metre: family ? { family, name: FAMILY_NAMES[family] } : null,
    translations: {}, variants: [], recitedWith: null,
  };
}

// The whole dataset from the source files: chapters (name, counts) and every entry in
// verse order, with the checks that the fetch log and the manifest report.
export function buildDataset(chapterFiles, slokFiles, { overrides = null, source = null, version = null } = {}) {
  const report = [];
  const chapters = chapterFiles
    .map((c) => ({ chapter: Number(c.chapter_number), verses: Number(c.verses_count), name: { deva: String(c.name || '').normalize('NFC'), iast: c.transliteration || null, en: c.translation || null } }))
    .sort((a, b) => a.chapter - b.chapter);
  const srcs = slokFiles.slice().sort((a, b) => Number(a.chapter) - Number(b.chapter) || Number(a.verse) - Number(b.verse));
  const verses = [];
  let who = null;
  for (const src of srcs) {
    const rec = verseRecord(src, { overrides, report, speakerSoFar: who });
    if (rec.kind === 'verse') who = rec.speaker.who;
    verses.push(rec);
  }
  verses.sort((a, b) => compareVerseOrder(a, b));
  // checks: counts per chapter against the app's table, metre
  const stats = { verses: verses.filter((v) => v.kind === 'verse').length, extras: verses.filter((v) => v.kind !== 'verse').length, metreMismatch: [], countMismatch: [] };
  for (const [ch, n] of Object.entries(GITA_VERSES)) {
    const have = verses.filter((v) => v.kind === 'verse' && v.chapter === Number(ch)).length;
    if (have !== n) stats.countMismatch.push(`chapter ${ch}: ${have} verses, expected ${n}`);
    const c = chapters.find((x) => x.chapter === Number(ch));
    if (c && c.verses !== n) stats.countMismatch.push(`chapter ${ch}: the chapter file says ${c.verses}, expected ${n}`);
  }
  for (const v of verses) {
    if (v.kind !== 'verse') continue;
    const ch = identifyChandas(v.deva.join('\n'), { expected: v.metre.family });
    if (!ch.exact) stats.metreMismatch.push(`${v.id}: ${ch.syllables} syllables for ${v.metre.family} (${ch.expectedSyllables})`);
  }
  return { schemaVersion: SCHEMA_VERSION, dataset: DATASET_ID, version, source, chapters, verses, stats, report };
}

// An English translation aligned per verse (the CANONCITE file carrying Annie Besant's
// 1905 text): { id → text } merged into the verses' `translations.en`.
export function mergeEnglish(data, records) {
  const byId = new Map();
  for (const r of records) if (r && r.id && r.text_en) byId.set(String(r.id), String(r.text_en).trim());
  let n = 0;
  for (const v of data.verses) { const t = byId.get(v.id); if (t) { v.translations = { ...(v.translations || {}), en: t }; n++; } }
  return n;
}
