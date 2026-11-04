// Trim silence from the start and end of every sloka WAV in the library (./library, or
// wherever local.json / SLOKABHYASA_DATA puts it; see datadir.js).
//
//   node tools/trim-library.mjs            trim in place, update index.json, drop stale analysis caches
//   node tools/trim-library.mjs --dry-run  only report what would change
//   node tools/trim-library.mjs CH01-01    one sloka, by name (or part of it) or id
//
// The untouched original of each changed file is copied to library/backup (first time only).
// It refuses to run (except --dry-run) while the server is up (PORT, default 8787): the
// server has the index and the details in hand, and a trim beside it would race it.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trimSilence } from '../js/dsp/trim.js';
import { decodeWav, encodeWavBytes } from '../js/wav.js';
import { normalizeStore, shiftStore } from '../js/transcripts.js';
import { resolveDataDir } from '../datadir.js';
import { readLibraryIndex, writeLibraryIndex, readJsonFile, writeFileAtomic, writeJsonAtomic, copyFileAtomic, assertServerStopped } from '../datafile.js';
import { parsePort } from '../edge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(resolveDataDir(ROOT), 'library');
const INDEX = path.join(LIB, 'index.json');
const dry = process.argv.includes('--dry-run');
const want = process.argv.slice(2).find((a) => !a.startsWith('--'));

if (!fs.existsSync(INDEX)) { console.log(`No ${INDEX} found, nothing to do.`); process.exit(0); }
if (!dry) await assertServerStopped(parsePort(process.env.PORT).port);
const list = (await readLibraryIndex(INDEX)).records;

const records = want ? list.filter((r) => r.id === want || r.name.toLowerCase().includes(want.toLowerCase())) : list;
if (want && !records.length) { console.error(`No sloka matches "${want}".`); process.exit(1); }
let changed = 0;
for (const rec of records) {
  const p = path.join(LIB, rec.file);
  let bytes;
  try { bytes = await fsp.readFile(p); } catch { console.log(`${rec.name}: file missing (${rec.file}), skipped`); continue; }
  const { samples, sampleRate } = decodeWav(bytes);
  const t = trimSilence(samples, sampleRate);
  const before = (samples.length / sampleRate).toFixed(2);
  if (!t.changed) { console.log(`${rec.name}: already tight (${before} s)`); continue; }
  const after = (t.samples.length / sampleRate).toFixed(2);
  console.log(`${rec.name}: removed ${t.removedStart.toFixed(2)} s at the start and ${t.removedEnd.toFixed(2)} s at the end (${before} s → ${after} s)${dry ? ' [dry run]' : ''}`);
  if (dry) continue;
  const backupDir = path.join(LIB, 'backup');
  await fsp.mkdir(backupDir, { recursive: true });
  const backup = path.join(backupDir, rec.file);
  await fsp.mkdir(path.dirname(backup), { recursive: true });
  try { await fsp.access(backup); } catch { await copyFileAtomic(p, backup); }
  await writeFileAtomic(p, encodeWavBytes(t.samples, sampleRate));
  await fsp.rm(p.replace(/\.wav$/i, '') + '.features.json', { force: true });
  // shift the stored transcripts' timestamps (every language) by the amount cut from the start
  const tp = p.replace(/\.wav$/i, '') + '.transcript.json';
  try {
    const { value } = await readJsonFile(tp, { expect: 'object' });
    const store = value ? normalizeStore(value) : null;
    if (store) await writeJsonAtomic(tp, shiftStore(store, t.removedStart, t.samples.length / sampleRate), { compact: true });
  } catch { /* no transcript */ }
  rec.duration = t.samples.length / sampleRate;
  rec.sampleRate = sampleRate;
  changed++;
}
if (!dry) {
  await writeLibraryIndex(INDEX, list);
  console.log(`Done. ${changed} of ${list.length} sloka${list.length === 1 ? '' : 's'} trimmed.`);
}
