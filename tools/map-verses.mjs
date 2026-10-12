#!/usr/bin/env node
// Links the recordings of the library to the verses of the reference dataset by their
// names (CH12-03 → 12.3, ch12-7 → 12.7, "Starting" / "Closing" with a folder that names
// the chapter), as the Library's "Link to the Gītā" button does: the sidecar gets the
// link, the verse's text as the recording's reference text (a text typed by hand keeps
// winning) and the chandas; a recording whose Sanskrit transcript does not match the
// verse's words is listed as doubtful and left alone unless asked. The dataset itself is
// never written.
//
//   node tools/map-verses.mjs                 every unlinked recording
//   node tools/map-verses.mjs CH12-03         one, by name (or part of it) or id
//   node tools/map-verses.mjs --dry           report, write nothing
//   node tools/map-verses.mjs --doubtful      link the doubtful ones too
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolveDataDir, resolveReferenceDirs } from '../datadir.js';
import { readMeta, writeMeta, sanitizeMeta } from '../meta-store.js';
import { normalizeStore } from '../js/transcripts.js';
import { chandasForRecord } from '../js/chandas.js';
import { initReference, dataset, verse as referenceVerse } from '../reference.js';
import { verseLink, linkHashInput, verseBody, mapNameToVerse } from '../js/verses.js';
import { compareWords, tokenize } from '../js/textdiff.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolveDataDir(ROOT);
const LIB = path.join(DATA, 'library');
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const takeDoubtful = args.includes('--doubtful');
const want = args.find((a) => !a.startsWith('--'));
const dsId = (args.find((a) => a.startsWith('--dataset=')) || '--dataset=gita').slice('--dataset='.length);

initReference(resolveReferenceDirs(ROOT), { customDir: path.join(DATA, 'reference') });
const ds = dataset(dsId);
if (!ds || ds.errors.length) { console.error(`No usable reference dataset "${dsId}"${ds ? `: ${ds.errors.join('; ')}` : ''}`); process.exit(1); }
const index = JSON.parse(await fsp.readFile(path.join(LIB, 'index.json'), 'utf8'));
const records = want ? index.filter((r) => r.id === want || r.name.toLowerCase().includes(want.toLowerCase())) : index;
if (!records.length) { console.error(`No sloka matches "${want}".`); process.exit(1); }
const folderOf = (file) => { const d = path.posix.dirname(String(file || '').replace(/\\/g, '/')); return d === '.' ? '' : d; };
const words = (t) => tokenize(t).map((w) => w.word);
const ids = new Set(ds.byId.keys());
let linked = 0;
for (const r of records) {
  const wav = path.join(LIB, ...r.file.split('/'));
  const meta = await readMeta(wav);
  if (!meta) { console.log(`${r.name}: no details file yet (open it once in the app)`); continue; }
  if (meta.verse) { console.log(`${r.name}: already linked to ${meta.verse.id}`); continue; }
  const g = mapNameToVerse(r.name, folderOf(r.file), ids);
  const entry = g ? referenceVerse(ds, g.id) : null;
  if (!entry) { console.log(`${r.name}: unmapped (the name does not name a verse of the dataset)`); continue; }
  let store = null;
  try { store = normalizeStore(JSON.parse(await fsp.readFile(wav.replace(/\.wav$/i, '.transcript.json'), 'utf8'))); } catch { store = null; }
  const t = store && store.languages && store.languages.sanskrit;
  let similarity = null;
  if (t && t.text) { const c = compareWords(words(verseBody(entry, { speakerLine: true })), words(t.text)); similarity = c ? c.summary.similarity : null; }
  const doubtful = similarity !== null && similarity < 0.45;
  console.log(`${r.folder ? r.folder + '/' : ''}${r.name} → ${entry.id} (${g.by})${similarity !== null ? ` · words ${Math.round(similarity * 100)}%` : ' · no transcript to check'}${doubtful ? ' · DOUBTFUL' : ''}${dry ? ' [dry]' : ''}`);
  if (dry || (doubtful && !takeDoubtful)) continue;
  const link = verseLink(entry, { dataset: ds.id, datasetVersion: ds.manifest.version || null, mappedBy: 'migration', licence: ds.manifest.licence ? ds.manifest.licence.id : null });
  link.textHash = crypto.createHash('sha256').update(linkHashInput(link)).digest('hex');
  const keepTyped = !!(meta.text && meta.text.body && meta.text.origin === 'typed');
  const next = sanitizeMeta(keepTyped ? { verse: link } : { verse: link, text: { body: verseBody(entry, { speakerLine: true }), language: 'sa', script: 'Deva', origin: 'reference', title: `Gītā ${entry.id}` } }, meta);
  next.name = r.name;
  next.chandas = chandasForRecord({ name: r.name, meta: next, store });
  await writeMeta(wav, next);
  linked++;
}
console.log(dry ? 'Dry run: nothing written.' : `Done. ${linked} linked.`);
