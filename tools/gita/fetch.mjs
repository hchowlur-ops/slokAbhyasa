// Downloads the Bhagavad Gītā reference dataset and writes it, normalised, to reference/gita/
// (see README.md in this folder). Run again at any time to update; `--ref <sha>` pins a
// commit, `--to <dir>` chooses the folder, `--no-english` leaves the English layer out,
// `--check` only validates what is there.
//
//   node tools/gita/fetch.mjs            # latest commit of the source → reference/gita/
//   node tools/gita/fetch.mjs --check    # validate reference/gita/ against its manifest
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildDataset, mergeEnglish, DATASET_ID } from './normalize.mjs';
import { validateDataset } from '../../js/verses.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const args = process.argv.slice(2);
const opt = (name, dflt = null) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const OUT = path.resolve(ROOT, opt('--to', path.join('reference', DATASET_ID)));
const CHECK = args.includes('--check');
const ENGLISH = !args.includes('--no-english');

// The source: the MIT-licensed static copy of the vedicscriptures dataset (the same JSON the
// data repository holds under GPL-3.0; the Sanskrit text itself is public domain).
const OWNER = 'vedicscriptures';
const REPO = 'vedicscriptures.github.io';
const HOMEPAGE = `https://github.com/${OWNER}/${REPO}`;
const CONCURRENCY = 8;

// The English layer: Annie Besant's 1905 translation (public domain), aligned verse by verse
// in the CANONCITE corpus file (its alignment and metadata CC BY 4.0, pralia-labs).
const EN_REPO = 'pralia-labs/canoncite';
const EN_FILE = 'corpora/bhagavad_gita/corpus_index.jsonl';
const EN_TRANSLATOR = 'Annie Besant (1905)';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'SlokAbhyasa-fetch' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}
async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'SlokAbhyasa-fetch' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

function check() {
  const manifest = readJson(path.join(OUT, 'manifest.json'));
  const file = path.join(OUT, manifest.files.verses);
  const buf = fs.readFileSync(file);
  const ok = sha256(buf) === manifest.sha256[manifest.files.verses];
  const data = JSON.parse(buf.toString('utf8'));
  const { errors, warnings } = validateDataset(data, { manifest });
  console.log(`${file}: ${data.verses.filter((v) => v.kind === 'verse').length} verses, ${data.verses.filter((v) => v.kind !== 'verse').length} extras, schema ${data.schemaVersion}, version ${manifest.version}, source ${manifest.source.name} @ ${String(manifest.sourceCommit || '').slice(0, 7)} (${manifest.source.retrieved})`);
  console.log(`sha256 ${ok ? 'matches' : 'DOES NOT MATCH'} the manifest`);
  for (const e of errors) console.log(`error: ${e}`);
  for (const w of warnings) console.log(`warning: ${w}`);
  process.exitCode = ok && !errors.length ? 0 : 1;
}

async function fetchAll() {
  const ref = opt('--ref') || (await getJson(`https://api.github.com/repos/${OWNER}/${REPO}/commits/main`)).sha;
  const raw = (p) => `https://raw.githubusercontent.com/${OWNER}/${REPO}/${ref}/${p}`;
  console.log(`source ${OWNER}/${REPO} @ ${ref}`);
  const licence = await getText(raw('LICENSE'));
  const chapterIndex = await getJson(raw('chapters/index.json'));
  const chapterFiles = Array.isArray(chapterIndex) ? chapterIndex : Object.values(chapterIndex);
  // every verse file, the colophon (verse count + 1) included
  const wanted = [];
  for (const c of chapterFiles) {
    const ch = Number(c.chapter_number);
    const n = Number(c.verses_count);
    for (let v = 1; v <= n + 1; v++) wanted.push([ch, v, n]);
  }
  let done = 0;
  const slokFiles = await mapLimit(wanted, CONCURRENCY, async ([ch, v, n]) => {
    const src = await getJson(raw(`slok/${ch}/${v}/index.json`)).catch((err) => { if (/HTTP 404/.test(err.message) && v > n) return null; throw err; });
    done++;
    if (done % 100 === 0) process.stdout.write(`  ${done} of ${wanted.length} verse files\n`);
    // the Sanskrit fields alone: the translations and commentaries are third-party works
    return src ? { _id: src._id, chapter: src.chapter, verse: src.verse, slok: src.slok, transliteration: src.transliteration } : null;
  });
  const overrides = readJson(path.join(here, 'overrides.json'));
  delete overrides._about;
  const now = new Date();
  const version = `${now.getUTCFullYear()}.${now.getUTCMonth() + 1}.${now.getUTCDate()}`;
  const retrieved = now.toISOString();
  const source = { name: `${OWNER}/${REPO}`, url: HOMEPAGE, retrieved, files: { chapters: 'chapters/index.json', verses: 'slok/<chapter>/<verse>/index.json' } };
  const data = buildDataset(chapterFiles, slokFiles.filter(Boolean), { overrides, source, version });
  for (const line of data.report) console.log(`note: ${line}`);
  for (const line of data.stats.countMismatch) console.log(`count: ${line}`);
  console.log(`${data.stats.verses} verses, ${data.stats.extras} colophons; ${data.stats.metreMismatch.length} verses whose syllable count does not fit the metre exactly:`);
  for (const line of data.stats.metreMismatch) console.log(`  ${line}`);
  let english = null;
  if (ENGLISH) {
    const info = await getJson(`https://huggingface.co/api/datasets/${EN_REPO}`);
    const sha = info.sha;
    const jsonl = await getText(`https://huggingface.co/datasets/${EN_REPO}/resolve/${sha}/${EN_FILE}`);
    const records = jsonl.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    const n = mergeEnglish(data, records);
    english = { name: 'English', translator: EN_TRANSLATOR, licence: 'public domain', source: `huggingface.co/datasets/${EN_REPO} (${EN_FILE}, commit ${sha})`, alignmentLicence: 'CC BY 4.0 (pralia-labs/canoncite)', verses: n };
    console.log(`English (${EN_TRANSLATOR}): ${n} of ${data.stats.verses} verses, via ${EN_REPO} @ ${sha.slice(0, 7)}`);
  }
  const { report, stats, ...out } = data;
  const { errors, warnings } = validateDataset(out);
  for (const e of errors) console.log(`error: ${e}`);
  if (errors.length) throw new Error(`the dataset does not pass its own checks (${errors.length} errors)`);
  fs.mkdirSync(OUT, { recursive: true });
  const versesJson = Buffer.from(JSON.stringify(out, null, 1), 'utf8');
  fs.writeFileSync(path.join(OUT, 'verses.json'), versesJson);
  fs.writeFileSync(path.join(OUT, 'LICENSE'), licence);
  const attribution = `Sanskrit text: Vedic Scriptures (Pt. Prashant Tripathi), ${HOMEPAGE}, MIT licence; the verses themselves are public domain.${english ? ` English: ${EN_TRANSLATOR}, public domain, aligned by pralia-labs/canoncite (CC BY 4.0).` : ''}`;
  fs.writeFileSync(path.join(OUT, 'ATTRIBUTION.txt'), [
    'Bhagavad Gītā — Sanskrit text (Devanagari and IAST) and chapter names',
    `Source: ${HOMEPAGE} (commit ${ref}), by Vedic Scriptures (Pt. Prashant Tripathi), MIT licence (see LICENSE).`,
    'The Sanskrit verses themselves are an ancient text in the public domain. The source\'s translations and',
    'commentaries, which are third-party copyrighted works, were not taken. Eight typos were corrected and the',
    'editorial variant notes removed by SlokAbhyasa\'s fetch tool (tools/gita/overrides.json).',
    ...(english ? [
      '',
      `English translation: ${EN_TRANSLATOR}, "The Bhagavad-Gîtâ" (public domain), aligned verse by verse in the`,
      `CANONCITE corpus by pralia-labs (${english.source}); the alignment and metadata are CC BY 4.0,`,
      'https://creativecommons.org/licenses/by/4.0/ — attribution to pralia-labs/canoncite is required.',
    ] : []),
    `Fetched ${retrieved} by tools/gita/fetch.mjs.`,
    '',
  ].join('\n'));
  const manifest = {
    schemaVersion: out.schemaVersion, id: DATASET_ID, work: 'Bhagavad Gītā', name: 'Bhagavad Gītā — Vedic Scriptures text',
    version, sourceCommit: ref, source: { name: source.name, url: source.url, retrieved },
    licence: { id: 'MIT', name: 'MIT License', url: 'https://opensource.org/license/mit', file: 'LICENSE' },
    attribution, updateUrl: HOMEPAGE,
    files: { verses: 'verses.json' }, sha256: { 'verses.json': sha256(versesJson) },
    translations: english ? { en: english } : {},
    counts: { chapters: out.chapters.length, verses: stats.verses, extras: stats.extras },
    checks: { countMismatch: stats.countMismatch, metreMismatch: stats.metreMismatch.length, overridesNotFound: report, warnings },
    overrides: Object.keys(overrides),
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`written to ${OUT}: verses.json (${(versesJson.length / 1024).toFixed(0)} KB), manifest.json, LICENSE, ATTRIBUTION.txt`);
}

try {
  if (CHECK) check(); else await fetchAll();
} catch (err) {
  console.error(`failed: ${err.message}`);
  process.exitCode = 1;
}
