// Downloads the Bhagavad Gītā reference dataset and writes it, normalised, to reference/gita/
// (see README.md in this folder). Run again at any time to update; `--ref <sha>` pins a
// commit, `--to <dir>` chooses the folder, `--check` only validates what is there.
//
//   node tools/gita/fetch.mjs            # latest commit of the source → reference/gita/
//   node tools/gita/fetch.mjs --check    # validate reference/gita/verses.json against its manifest
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildDataset, mergeEnglish, DATASET_ID } from './normalize.mjs';
import { GITA_VERSES } from '../../js/chandas.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const args = process.argv.slice(2);
const opt = (name, dflt = null) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const OUT = path.resolve(ROOT, opt('--to', path.join('reference', DATASET_ID)));
const CHECK = args.includes('--check');
const ENGLISH = !args.includes('--no-english');

// The English layer: Annie Besant's 1905 translation (public domain), aligned verse by verse
// in the CANONCITE corpus file (its alignment and metadata CC BY 4.0, pralia-labs).
const EN_REPO = 'pralia-labs/canoncite';
const EN_FILE = 'corpora/bhagavad_gita/corpus_index.jsonl';
const EN_TRANSLATOR = 'Annie Besant (1905)';

// The source: the MIT-licensed static copy of the vedicscriptures dataset (the same JSON the
// data repository holds under GPL-3.0; the Sanskrit text itself is public domain).
const OWNER = 'vedicscriptures';
const REPO = 'vedicscriptures.github.io';
const LICENCE_NAME = 'MIT';
const HOMEPAGE = `https://github.com/${OWNER}/${REPO}`;
const CONCURRENCY = 8;

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
  const file = path.join(OUT, 'verses.json');
  const buf = fs.readFileSync(file);
  const ok = sha256(buf) === manifest.files['verses.json'].sha256;
  const data = JSON.parse(buf.toString('utf8'));
  console.log(`${file}: ${data.verses.length} verses, ${data.colophons.length} colophons, schema ${data.schema}, source ${manifest.source.repo}@${manifest.source.commit.slice(0, 7)} (${manifest.source.fetchedAt})`);
  console.log(`sha256 ${ok ? 'matches' : 'DOES NOT MATCH'} the manifest`);
  const total = Object.values(GITA_VERSES).reduce((a, b) => a + b, 0);
  if (data.verses.length !== total) console.log(`expected ${total} verses`);
  process.exitCode = ok && data.verses.length === total ? 0 : 1;
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
    for (let v = 1; v <= n + 1; v++) wanted.push([ch, v]);
  }
  let done = 0;
  const slokFiles = await mapLimit(wanted, CONCURRENCY, async ([ch, v]) => {
    const src = await getJson(raw(`slok/${ch}/${v}/index.json`)).catch((err) => { if (/HTTP 404/.test(err.message) && v > (GITA_VERSES[ch] || 0)) return null; throw err; });
    done++;
    if (done % 100 === 0) process.stdout.write(`  ${done} of ${wanted.length} verse files\n`);
    // the Sanskrit fields alone: the translations and commentaries are third-party works
    return src ? { _id: src._id, chapter: src.chapter, verse: src.verse, slok: src.slok, transliteration: src.transliteration } : null;
  });
  const overrides = readJson(path.join(here, 'overrides.json'));
  delete overrides._about;
  const source = { repo: `${OWNER}/${REPO}`, commit: ref, homepage: HOMEPAGE, fetchedAt: new Date().toISOString(), files: { chapters: 'chapters/index.json', verses: 'slok/<chapter>/<verse>/index.json' } };
  const data = buildDataset(chapterFiles, slokFiles.filter(Boolean), { overrides, source });
  for (const line of data.report) console.log(`note: ${line}`);
  for (const line of data.stats.countMismatch) console.log(`count: ${line}`);
  console.log(`${data.verses.length} verses, ${data.colophons.length} colophons; ${data.stats.metreMismatch.length} verses whose syllable count does not fit the metre exactly:`);
  for (const line of data.stats.metreMismatch) console.log(`  ${line}`);
  let english = null;
  if (ENGLISH) {
    const info = await getJson(`https://huggingface.co/api/datasets/${EN_REPO}`);
    const sha = info.sha;
    const jsonl = await getText(`https://huggingface.co/datasets/${EN_REPO}/resolve/${sha}/${EN_FILE}`);
    const records = jsonl.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    const n = mergeEnglish(data, records);
    english = { language: 'en', translator: EN_TRANSLATOR, licence: 'public domain', via: `huggingface.co/datasets/${EN_REPO} (${EN_FILE}, commit ${sha}; alignment and metadata CC BY 4.0)`, verses: n };
    data.translations = { en: english };
    console.log(`English (${EN_TRANSLATOR}): ${n} of ${data.verses.length} verses, via ${EN_REPO} @ ${sha.slice(0, 7)}`);
  }
  const { report, stats, ...out } = data;
  fs.mkdirSync(OUT, { recursive: true });
  const versesJson = Buffer.from(JSON.stringify(out, null, 1), 'utf8');
  fs.writeFileSync(path.join(OUT, 'verses.json'), versesJson);
  fs.writeFileSync(path.join(OUT, 'LICENSE'), licence);
  fs.writeFileSync(path.join(OUT, 'ATTRIBUTION.txt'), [
    'Bhagavad Gītā — Sanskrit text (Devanagari and IAST) and chapter names',
    `Source: ${HOMEPAGE} (commit ${ref}), by Vedic Scriptures (Pt. Prashant Tripathi), MIT licence (see LICENSE).`,
    'The Sanskrit verses themselves are an ancient text in the public domain. The source\'s translations and',
    'commentaries, which are third-party copyrighted works, were not taken. Eight typos were corrected and one',
    'editorial note removed by SlokAbhyasa\'s fetch tool (tools/gita/overrides.json).',
    ...(english ? [
      '',
      `English translation: ${EN_TRANSLATOR}, "The Bhagavad-Gîtâ" (public domain), aligned verse by verse in the`,
      `CANONCITE corpus by pralia-labs (${english.via}); the alignment and metadata are CC BY 4.0,`,
      'https://creativecommons.org/licenses/by/4.0/ — attribution to pralia-labs/canoncite is required.',
    ] : []),
    `Fetched ${source.fetchedAt} by tools/gita/fetch.mjs.`,
    '',
  ].join('\n'));
  const manifest = {
    id: DATASET_ID, name: 'Bhagavad Gītā — Sanskrit mūla', schema: out.schema, source, licence: LICENCE_NAME, licenceFile: 'LICENSE',
    attribution: 'Vedic Scriptures (Pt. Prashant Tripathi), github.com/vedicscriptures — MIT; the Sanskrit text is public domain',
    translations: english ? { en: english } : {},
    counts: { chapters: out.chapters.length, verses: out.verses.length, colophons: out.colophons.length },
    checks: { countMismatch: stats.countMismatch, metreMismatch: stats.metreMismatch.length, overridesNotFound: report },
    overrides: Object.keys(overrides),
    files: { 'verses.json': { bytes: versesJson.length, sha256: sha256(versesJson) } },
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
