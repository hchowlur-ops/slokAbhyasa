#!/usr/bin/env node
// Validates a reference dataset folder before it is adopted (or after an update): the
// manifest, the schema, unique ids, chapter counts, the metre of each verse against the
// Gītā table and against the text itself (every verse whose syllables do not scan is
// listed — a fast way to find typos in a source), the hash in the manifest.
//
//   node tools/reference-check.mjs                 # reference/gita
//   node tools/reference-check.mjs <folder>        # another dataset folder
//   node tools/reference-check.mjs --quiet         # errors and the summary only
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDataset } from '../reference.js';
import { identifyChandas } from '../js/chandas.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const dir = path.resolve(ROOT, args.find((a) => !a.startsWith('--')) || path.join('reference', 'gita'));

const rec = loadDataset(dir);
console.log(`${dir}: ${rec.manifest ? `${rec.manifest.name || rec.id} · version ${rec.manifest.version} · ${rec.manifest.licence ? rec.manifest.licence.id : 'no licence'}` : 'no manifest'}`);
for (const e of rec.errors) console.log(`error: ${e}`);
for (const w of rec.warnings) if (!quiet) console.log(`warning: ${w}`);
if (rec.data) {
  const verses = rec.data.verses.filter((v) => v.kind === 'verse');
  const extras = rec.data.verses.length - verses.length;
  let unmetrical = 0;
  for (const v of verses) {
    const ch = identifyChandas(v.deva.join('\n'), { expected: v.metre ? v.metre.family : null });
    if (!ch.exact) { unmetrical++; if (!quiet) console.log(`metre: ${v.id}: ${ch.syllables} syllables for ${v.metre ? v.metre.family : 'unknown'} (${ch.expectedSyllables})`); }
  }
  const langs = new Set();
  for (const v of rec.data.verses) for (const k of Object.keys(v.translations || {})) langs.add(k);
  console.log(`${rec.data.chapters.length} chapters, ${verses.length} verses, ${extras} extras; translations: ${[...langs].join(', ') || 'none'}; ${unmetrical} verses whose text does not scan as their metre; ${rec.errors.length} errors, ${rec.warnings.length} warnings`);
}
process.exitCode = rec.errors.length ? 1 : 0;
