#!/usr/bin/env node
// Reads every sloka in the library and writes its chandas (metre) into its details sidecar:
// the family and name, syllables per pāda, how many the text has, the laghu / guru pattern.
// The text is the one typed in the sloka's details, else its Sanskrit transcript, else its
// current transcript; a name that says which Gītā verse it is decides the family.
//
//   node tools/chandas.mjs            every sloka
//   node tools/chandas.mjs CH12-04    one sloka, by name (or part of it) or id
//   node tools/chandas.mjs --dry      show, write nothing

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDataDir } from '../datadir.js';
import { readMeta, writeMeta } from '../meta-store.js';
import { normalizeStore } from '../js/transcripts.js';
import { chandasForRecord, chandasLabel } from '../js/chandas.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolveDataDir(ROOT);
const LIB = path.join(DATA, 'library');
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const want = args.find((a) => !a.startsWith('--'));

const index = JSON.parse(await fsp.readFile(path.join(LIB, 'index.json'), 'utf8'));
const records = want ? index.filter((r) => r.id === want || r.name.toLowerCase().includes(want.toLowerCase())) : index.slice().sort((a, b) => (a.folder || '').localeCompare(b.folder || '') || a.name.localeCompare(b.name));
if (!records.length) { console.error(`No sloka matches "${want}".`); process.exit(1); }
let written = 0;
for (const r of records) {
  const wav = path.join(LIB, ...r.file.split('/'));
  const meta = await readMeta(wav);
  if (!meta) { console.log(`${r.name}: no details file yet (open it once in the app)`); continue; }
  let store = null;
  try { store = normalizeStore(JSON.parse(await fsp.readFile(wav.replace(/\.wav$/i, '.transcript.json'), 'utf8'))); } catch { store = null; }
  const ch = chandasForRecord({ name: r.name, meta, store });
  const line = ch ? `${chandasLabel(ch)} · from the ${ch.source}${ch.verse ? ` · Gītā ${ch.verse.chapter}.${ch.verse.verse}` : ''}${ch.exact ? '' : ' · !'}` : 'no text yet';
  console.log(`${r.folder ? r.folder + '/' : ''}${r.name}: ${line}`);
  if (dry) continue;
  meta.chandas = ch;
  await writeMeta(wav, meta);
  written++;
}
console.log(dry ? 'nothing written (--dry)' : `${written} of ${records.length} details files updated`);
