#!/usr/bin/env node
// The badges of every learner, rebuilt from the quizzes' attempts (see js/badges.js) and
// written to <data>/badges.json — badges are derived data, so the file can always be made
// again, after a change of the rule or should it be lost. Names are never printed: a badge
// carries the learner's profile id only.
//
//   node tools/badges.mjs                list the badges on file
//   node tools/badges.mjs --recompute    rebuild them from the attempts and write the file
//   node tools/badges.mjs --any-days     (with --recompute) three Excellent attempts on any days
//   node tools/badges.mjs --three-days   (with --recompute) back to three different days
// A recompute refuses to run while the server is up (PORT, default 8787): it has the file in hand.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDataDir } from '../datadir.js';
import { readMeta } from '../meta-store.js';
import { readJsonFile, writeJsonAtomic, readLibraryIndex, assertServerStopped } from '../datafile.js';
import { parsePort } from '../edge.js';
import { computeBadges, badgeLine, DEFAULT_RULE, BADGES_VERSION } from '../js/badges.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolveDataDir(ROOT);
const LIB = path.join(DATA, 'library');
const QUIZZES = path.join(DATA, 'quizzes');
const FILE = path.join(DATA, 'badges.json');
const args = process.argv.slice(2);
const recompute = args.includes('--recompute');

async function readStore() {
  const { value: b } = await readJsonFile(FILE, { expect: 'object' }); // a damaged file is kept as .broken-… and rebuilt by the recompute
  return { rule: { ...DEFAULT_RULE, ...((b && b.rule) || {}) }, badges: b && Array.isArray(b.badges) ? b.badges : [] };
}
if (recompute) await assertServerStopped(parsePort(process.env.PORT).port);
const store = await readStore();
if (args.includes('--any-days')) store.rule.differentDays = false;
if (args.includes('--three-days')) store.rule.differentDays = true;
if (recompute) {
  let names = [];
  try { names = await fsp.readdir(QUIZZES); } catch { names = []; }
  const quizzes = [];
  for (const n of names) { if (n.endsWith('.json')) { try { quizzes.push(JSON.parse(await fsp.readFile(path.join(QUIZZES, n), 'utf8'))); } catch { /* skip */ } } }
  const index = (await readLibraryIndex(path.join(LIB, 'index.json'))).records;
  const verses = new Map();
  for (const r of index) { const meta = await readMeta(path.join(LIB, ...String(r.file).split('/'))); verses.set(r.id, meta && meta.verse && meta.verse.id ? [meta.verse.id] : []); }
  store.badges = computeBadges(quizzes, { rule: store.rule, verseIdsOf: (id) => verses.get(id) || [] });
  await writeJsonAtomic(FILE, { schemaVersion: BADGES_VERSION, rule: store.rule, badges: store.badges });
  console.log(`Recomputed from ${quizzes.length} quiz${quizzes.length === 1 ? '' : 'zes'}: ${store.badges.length} badge${store.badges.length === 1 ? '' : 's'} (${store.rule.differentDays ? 'three different days' : 'any days'}).`);
}
if (!store.badges.length) console.log('No badges yet.');
for (const b of store.badges) console.log(`${b.learner === 'device' ? 'this device' : b.learner}: ${badgeLine(b)}`);
