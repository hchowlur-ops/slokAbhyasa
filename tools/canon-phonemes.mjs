#!/usr/bin/env node
// The canonical phonetic representation of every entry of a reference dataset, compiled
// and validated: the akṣaras lossless against the text, the IAST rebuilt against the
// dataset's, the pāda counts against the metre, the cadence against the metre's pattern.
// Writes the compiled JSON (for a phoneme model's targets, an evaluation set's labels, or
// any tool outside the app) and a validation report in Markdown.
//
//   node tools/canon-phonemes.mjs [--dataset reference/gita] [--out dist/canon/gita-phonemes.json]
//                                  [--report <file.md>] [--tradition canonical|south|north|maharashtra] [--quiet]
//
// The dataset folder is never written to; the output goes to dist/ (ignored by git) unless
// --out says otherwise.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonOf, validateCanon, realise, ipaOf, CANON_VERSION, TOKENS } from '../js/canon.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] != null ? args[i + 1] : def; };
const DATASET = path.resolve(ROOT, opt('--dataset', 'reference/gita'));
const OUT = path.resolve(ROOT, opt('--out', 'dist/canon/gita-phonemes.json'));
const REPORT = opt('--report', null);
const TRADITION = opt('--tradition', 'canonical');
const QUIET = args.includes('--quiet');

const data = JSON.parse(fs.readFileSync(path.join(DATASET, 'verses.json'), 'utf8'));
let manifest = null;
try { manifest = JSON.parse(fs.readFileSync(path.join(DATASET, 'manifest.json'), 'utf8')); } catch { manifest = null; }
const dataset = { id: data.dataset || (manifest && manifest.id) || 'gita', version: data.version || (manifest && manifest.version) || null, sourceCommit: manifest && manifest.sourceCommit ? manifest.sourceCommit : null };

const entries = [];
const problems = []; // { id, kind, ...detail }
const irregular = []; // verses the Gītā table scans by hand
const forms = new Map(); // metre form → count
const slotKinds = new Map(); // slot id@context → count
let aksharas = 0; let phonemes = 0;
for (const e of data.verses) {
  const canon = canonOf(e, { speakerLine: true, dataset });
  const v = validateCanon(canon);
  for (const p of v.problems) problems.push({ id: e.id, ...p });
  // the cadence: a verse whose metre is named but whose pattern does not fit it
  if (canon.metre && canon.metre.family && canon.metre.exact && canon.metre.form === 'irregular') problems.push({ id: e.id, kind: 'cadence', form: canon.metre.form, weights: canon.metre.weights, confidence: canon.metre.confidence });
  if (canon.metre && canon.metre.family && !canon.metre.exact && !canon.plan.irregular && !canon.plan.custom) problems.push({ id: e.id, kind: 'syllables', expected: canon.metre.perPada * 4, got: canon.metre.syllables });
  if (canon.plan.irregular) irregular.push({ id: e.id, padas: canon.plan.padas, note: canon.plan.note });
  const formKey = canon.metre && canon.metre.family ? `${canon.metre.name}${canon.metre.form ? ' · ' + canon.metre.form : ''}` : e.kind === 'colophon' ? 'colophon (prose)' : 'no metre';
  forms.set(formKey, (forms.get(formKey) || 0) + 1);
  for (const s of canon.slots) { const k = `${s.id}@${s.context}`; slotKinds.set(k, (slotKinds.get(k) || 0) + 1); }
  aksharas += canon.counts.aksharas; phonemes += canon.counts.phonemes;
  const r = realise(canon, { tradition: TRADITION });
  entries.push({ ...canon, realised: { tradition: TRADITION, tokens: r.tokens, of: r.of, ipa: ipaOf(r.tokens) }, valid: v.ok });
}

const out = {
  schemaVersion: 1, canonVersion: CANON_VERSION, generatedAt: new Date().toISOString(),
  dataset, tokens: TOKENS, tradition: TRADITION,
  counts: { entries: entries.length, aksharas, phonemes, problems: problems.length },
  entries,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));

// ---------- the report ----------
const byKind = new Map();
for (const p of problems) byKind.set(p.kind, (byKind.get(p.kind) || 0) + 1);
const lines = [];
lines.push(`# Canonical representation of ${dataset.id}: validation report`);
lines.push('');
lines.push(`*Generated ${out.generatedAt.slice(0, 16).replace('T', ' ')} by \`tools/canon-phonemes.mjs\` — representation version ${CANON_VERSION}, dataset ${dataset.id} ${dataset.version || ''}${dataset.sourceCommit ? ` (source commit ${dataset.sourceCommit.slice(0, 7)})` : ''}, tradition "${TRADITION}" for the realised tokens. Output: \`${path.relative(ROOT, OUT).replace(/\\/g, '/')}\`.*`);
lines.push('');
lines.push('## Totals');
lines.push('');
lines.push('| entries | akṣaras | phonemes | tokens in the vocabulary | problems |');
lines.push('|---|---|---|---|---|');
lines.push(`| ${entries.length} | ${aksharas} | ${phonemes} | ${TOKENS.length} | ${problems.length} |`);
lines.push('');
lines.push('## Metres and forms');
lines.push('');
lines.push('| metre · form | entries |');
lines.push('|---|---|');
for (const [k, n] of [...forms].sort((a, b) => b[1] - a[1])) lines.push(`| ${k} | ${n} |`);
lines.push('');
lines.push('## Realisation slots');
lines.push('');
lines.push('| slot @ context | occurrences |');
lines.push('|---|---|');
for (const [k, n] of [...slotKinds].sort((a, b) => b[1] - a[1])) lines.push(`| ${k} | ${n} |`);
lines.push('');
lines.push('## Verses that do not scan evenly, by the table');
lines.push('');
if (!irregular.length) lines.push('None.');
else { lines.push('| verse | units | note |'); lines.push('|---|---|---|'); for (const x of irregular) lines.push(`| ${x.id} | ${x.padas.join(' · ')} | ${x.note || ''} |`); }
lines.push('');
lines.push('## Problems');
lines.push('');
lines.push('`iast`: the sounds of the IAST rebuilt from the Devanagari differ from the dataset\'s IAST field — a typo or a variant reading on one side (the representation is built from the Devanagari, which is the corrected field). `words`: the same sounds with the words cut elsewhere (sandhi written across a space): no difference of sound. `count` / `syllables`: a pāda or a verse without the metre\'s count and not in the table. `lost`: a letter of the text that reached no akṣara — a bug.');
lines.push('');
if (!problems.length) lines.push('None.');
else {
  lines.push('| kind | count |');
  lines.push('|---|---|');
  for (const [k, n] of [...byKind].sort((a, b) => b[1] - a[1])) lines.push(`| ${k} | ${n} |`);
  lines.push('');
  const describe = (p) => {
    if (p.kind === 'lost') return `word ${p.word}: expected "${p.expected}", got "${p.got}"`;
    if (p.kind === 'iast') return `rebuilt "${p.rebuilt}" · given "${p.given}"`;
    if (p.kind === 'count') return `pāda ${p.pada}: ${p.got} akṣaras, the metre has ${p.expected}`;
    if (p.kind === 'syllables') return `${p.got} akṣaras, the metre has ${p.expected}`;
    if (p.kind === 'cadence') return `${p.form}: ${p.weights.match(/.{1,8}|.{1,11}/g).join(' ')} (confidence ${p.confidence})`;
    return JSON.stringify(p);
  };
  for (const kind of [...byKind.keys()]) {
    lines.push(`### ${kind}`);
    lines.push('');
    for (const p of problems.filter((x) => x.kind === kind)) lines.push(`- **${p.id}** — ${describe(p)}`);
    lines.push('');
  }
}
const report = lines.join('\n');
if (REPORT) { fs.mkdirSync(path.dirname(path.resolve(ROOT, REPORT)), { recursive: true }); fs.writeFileSync(path.resolve(ROOT, REPORT), report); }
if (!QUIET) {
  console.log(`${entries.length} entries · ${aksharas} akṣaras · ${phonemes} phonemes · ${problems.length} problems → ${path.relative(ROOT, OUT)}${REPORT ? ` · report ${REPORT}` : ''}`);
  for (const [k, n] of byKind) console.log(`  ${k}: ${n}`);
}
process.exit(problems.some((p) => p.kind === 'lost') ? 1 : 0);
