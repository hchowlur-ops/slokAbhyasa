// Trim silence from the start and end of every sloka WAV in the library (./library, or
// wherever local.json / SLOKABHYASA_DATA puts it; see datadir.js).
//
//   node tools/trim-library.mjs            trim in place, update index.json, drop stale analysis caches
//   node tools/trim-library.mjs --dry-run  only report what would change
//
// The untouched original of each changed file is copied to library/backup (first time only).
// Stop the server (or avoid saving slokas) while this runs.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trimSilence } from '../js/dsp/trim.js';
import { decodeWav, encodeWavBytes } from '../js/wav.js';
import { normalizeStore, shiftStore } from '../js/transcripts.js';
import { resolveDataDir } from '../datadir.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(resolveDataDir(ROOT), 'library');
const INDEX = path.join(LIB, 'index.json');
const dry = process.argv.includes('--dry-run');

let list;
try { list = JSON.parse(await fsp.readFile(INDEX, 'utf8')); } catch { console.log(`No ${INDEX} found, nothing to do.`); process.exit(0); }

let changed = 0;
for (const rec of list) {
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
  try { await fsp.access(backup); } catch { await fsp.copyFile(p, backup); }
  await fsp.writeFile(p, encodeWavBytes(t.samples, sampleRate));
  await fsp.rm(p.replace(/\.wav$/i, '') + '.features.json', { force: true });
  // shift the stored transcripts' timestamps (every language) by the amount cut from the start
  const tp = p.replace(/\.wav$/i, '') + '.transcript.json';
  try {
    const store = normalizeStore(JSON.parse(await fsp.readFile(tp, 'utf8')));
    if (store) await fsp.writeFile(tp, JSON.stringify(shiftStore(store, t.removedStart, t.samples.length / sampleRate)));
  } catch { /* no transcript */ }
  rec.duration = t.samples.length / sampleRate;
  rec.sampleRate = sampleRate;
  changed++;
}
if (!dry) {
  await fsp.writeFile(INDEX, JSON.stringify(list, null, 2) + '\n');
  console.log(`Done. ${changed} of ${list.length} sloka${list.length === 1 ? '' : 's'} trimmed.`);
}
