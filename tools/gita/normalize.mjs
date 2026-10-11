// The Bhagavad Gītā reference dataset, normalised from the vedicscriptures JSON (see
// README.md in this folder): one record per verse with the Devanagari half-verses as lines,
// the IAST likewise, the speaker, the kind (verse / colophon) and the metre. Pure; the
// fetch tool and the tests use it.
import { gitaFamily, GITA_VERSES, identifyChandas } from '../../js/chandas.js';

export const DATASET_ID = 'gita';
export const SCHEMA_VERSION = 1;

// "अर्जुन उवाच" → अर्जुन; "श्रीभगवानुवाच" (sandhi of भगवान् + उवाच) → श्रीभगवान्, in whatever
// spelling or spacing the source has
const SPEAKERS = [
  [/^(श्री\s*)?भगवा(नु|न्\s*उ)वाच$/, 'श्रीभगवान्'],
  [/^अर्जुन\s*उवाच$/, 'अर्जुन'],
  [/^स(ञ्ज|ंज)य\s*उवाच$/, 'सञ्जय'],
  [/^धृतराष्ट्र\s*उवाच$/, 'धृतराष्ट्र'],
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

// ASCII daṇḍas to the Devanagari ones, each half-verse keeping its own
const devaDandas = (line) => line.replace(/\s*\|\|\s*$/, ' ॥').replace(/\s*\|\s*$/, ' ।').replace(/\|\|/g, '॥').replace(/\|/g, '।');

// The Devanagari of one verse: [{ speakerLine, lines }], the marker dropped (the verse's
// closing ॥ kept), NFC, daṇḍas ।॥
export function parseSlok(slok) {
  const text = String(slok || '').normalize('NFC').replace(/\r/g, '').replace(MARKER, ' ॥');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let speakerLine = null;
  if (lines.length && isSpeakerLine(lines[0])) speakerLine = lines.shift().replace(/[|।॥]/g, ' ').replace(/\s+/g, ' ').trim();
  return { speakerLine, lines: lines.map(devaDandas) };
}

// The IAST of one verse: the marker dropped (the closing || kept), "." (daṇḍa) → "|",
// ".a" (avagraha) → ’
export function parseIast(transliteration) {
  const text = String(transliteration || '').normalize('NFC').replace(/\r/g, '').replace(MARKER_IAST, ' ||');
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

// An English translation aligned per verse (the CANONCITE file carrying Annie Besant's
// 1905 text): { id → text } merged into the verses as `english`.
export function mergeEnglish(data, records) {
  const byId = new Map();
  for (const r of records) if (r && r.id && r.text_en) byId.set(String(r.id), String(r.text_en).trim());
  let n = 0;
  for (const v of data.verses) { const t = byId.get(v.id); if (t) { v.english = t; n++; } }
  return n;
}

// One verse record from a source slok file.
export function verseRecord(src, { overrides = null, report = null, speakerSoFar = null } = {}) {
  const chapter = Number(src.chapter);
  const verse = Number(src.verse);
  const total = GITA_VERSES[chapter] || 0;
  const kind = verse > total ? 'colophon' : 'verse';
  const id = kind === 'colophon' ? `${chapter}.colophon` : `${chapter}.${verse}`;
  const deva = parseSlok(src.slok);
  const iast = parseIast(src.transliteration);
  let lines = deva.lines.map((l) => l.replace(/\s*\((?:or|var)\b[^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()); // the source's editorial variant notes, "(or …)" / "(var …)"
  lines = applyOverrides(id, lines, overrides, report);
  const speaker = deva.speakerLine ? speakerOf(deva.speakerLine) : speakerSoFar;
  const metre = kind === 'verse' ? gitaFamily(chapter, verse) : null;
  const rec = { id, kind, chapter, verse: kind === 'verse' ? verse : null, speaker: kind === 'verse' ? speaker : null, speakerLine: deva.speakerLine, deva: lines, iast: iast.lines, metre };
  return rec;
}

// The whole dataset from the source files: chapters (name, counts) and verses in order.
export function buildDataset(chapterFiles, slokFiles, { overrides = null, source = null } = {}) {
  const report = [];
  const chapters = chapterFiles
    .map((c) => ({ number: Number(c.chapter_number), name: String(c.name || '').normalize('NFC'), nameIast: c.transliteration || null, nameEnglish: c.translation || null, verses: Number(c.verses_count) }))
    .sort((a, b) => a.number - b.number);
  const byChapter = new Map(chapters.map((c) => [c.number, c]));
  const srcs = slokFiles.slice().sort((a, b) => Number(a.chapter) - Number(b.chapter) || Number(a.verse) - Number(b.verse));
  const verses = [];
  const colophons = [];
  let speaker = null;
  for (const src of srcs) {
    const rec = verseRecord(src, { overrides, report, speakerSoFar: speaker });
    if (rec.kind === 'verse') { speaker = rec.speaker; verses.push(rec); } else colophons.push({ id: rec.id, chapter: rec.chapter, deva: rec.deva, iast: rec.iast });
  }
  // checks: counts per chapter against the app's table, markers, metre
  const stats = { verses: verses.length, colophons: colophons.length, metreMismatch: [], countMismatch: [] };
  for (const [ch, n] of Object.entries(GITA_VERSES)) {
    const have = verses.filter((v) => v.chapter === Number(ch)).length;
    if (have !== n) stats.countMismatch.push(`chapter ${ch}: ${have} verses, expected ${n}`);
    const c = byChapter.get(Number(ch));
    if (c && c.verses !== n) stats.countMismatch.push(`chapter ${ch}: the chapter file says ${c.verses}, expected ${n}`);
  }
  for (const v of verses) {
    const ch = identifyChandas(v.deva.join('\n'), { expected: v.metre });
    if (!ch.exact) stats.metreMismatch.push(`${v.id}: ${ch.syllables} syllables for ${v.metre} (${ch.expectedSyllables})`);
  }
  return {
    dataset: DATASET_ID, schema: SCHEMA_VERSION, source,
    chapters, verses, colophons,
    stats, report,
  };
}
