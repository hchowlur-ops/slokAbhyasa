// How the data folder's files are read and written (Node side: serve.js, meta-store.js,
// reference.js and the tools). One place that knows three things: how to save a file so
// it is never half-written, how to read a JSON file so damage is kept instead of being
// overwritten, and how the library index is loaded in both the forms it has had.
//
// A save goes to a temporary name in the same folder, the disk is asked to finish writing
// it, and the temporary is renamed over the file: a save cut short leaves the old file
// whole and a temporary beside it, never half a file (the structural audit of 2 November
// 2026 found seventeen places writing in place). A JSON file that cannot be read is renamed
// `<file>.broken-<stamp>` and reported, never recreated silently: the same audit found every
// reader answering damage with an empty value and four of them then rewriting the file.
//
// Names on disk: a temporary ends with `.tmp-<pid>-<six letters>` and a quarantined file with
// `.broken-<stamp>`, so neither ends in `.wav` or `.json` and no listing picks them up.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';

export const RENAME_TRIES = 5; // with the wait below, a quarter of a second of patience for a rename refused by a scanner's hold
export const RENAME_WAIT_MS = 50; // a virus scanner's hold on a freshly written small file lasts tens of milliseconds; a rule of thumb, not a measurement (design of 3 November 2026): if the console ever shows a refused rename, measure and revisit
export const TEMP_MAX_AGE_MS = 60 * 1000; // a save takes milliseconds; a temporary a minute old belongs to a process that died
export const INDEX_VERSION = '1.0.0'; // library/index.json: the first version it carries; before it, a plain list
export const SESSION_VERSION = '1.0.0'; // sessions/<id>.json: a file without a version is this one
export const QUIZ_VERSION = '1.0.0'; // quizzes/<id>.json: the same

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']); // what Windows answers while another process holds the file
const TEMP_RE = /\.tmp-\d+-[a-z0-9]{6}$/;
const SWEPT_FOLDERS = ['library', 'quizzes', 'sessions', 'speaker-lines', 'reference']; // the data folder's own subfolders; the data folder is the project folder by default, so nothing else is walked

// ---------- names ----------

// 20261103-071530, local time: the stamp on backup and quarantine names, and the first part of a record's id.
export function stamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

export const tempName = (file, { pid = process.pid, rand = crypto.randomBytes(4).readUInt32BE(0).toString(36).padStart(6, '0').slice(-6) } = {}) => `${file}.tmp-${pid}-${rand}`;
export const brokenName = (file, now = new Date()) => `${file}.broken-${stamp(now)}`;
export const isTempName = (name) => TEMP_RE.test(name);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// ---------- writing ----------

async function renameWithRetries(from, to) {
  for (let attempt = 1; ; attempt++) {
    try { await fsp.rename(from, to); return; } catch (err) {
      if (attempt >= RENAME_TRIES || !RETRY_CODES.has(err.code)) throw err;
      await sleep(RENAME_WAIT_MS);
    }
  }
}
function renameWithRetriesSync(from, to) {
  for (let attempt = 1; ; attempt++) {
    try { fs.renameSync(from, to); return; } catch (err) {
      if (attempt >= RENAME_TRIES || !RETRY_CODES.has(err.code)) throw err;
      sleepSync(RENAME_WAIT_MS);
    }
  }
}

// Writes `data` (a string or bytes) so that `file` is either the old content or the new,
// never a mix: a temporary beside it, flushed to disk, then renamed over it. On any failure
// the temporary is removed, the old file untouched, and the error thrown.
export async function writeFileAtomic(file, data) {
  const tmp = tempName(file);
  try {
    const fh = await fsp.open(tmp, 'w');
    try { await fh.writeFile(data); await fh.sync(); } finally { await fh.close(); }
    await renameWithRetries(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}
export function writeFileAtomicSync(file, data) {
  const tmp = tempName(file);
  try {
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    renameWithRetriesSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* the temporary was never made */ }
    throw err;
  }
}

// Pretty JSON with a trailing newline, as every file a person may open is written; compact
// when asked (the ear logs, transcripts and speaker lines stay compact, as before).
const jsonText = (value, compact) => (compact ? JSON.stringify(value) : `${JSON.stringify(value, null, 2)}\n`);
export const writeJsonAtomic = (file, value, { compact = false } = {}) => writeFileAtomic(file, jsonText(value, compact));
export const writeJsonAtomicSync = (file, value, { compact = false } = {}) => writeFileAtomicSync(file, jsonText(value, compact));

// A copy that is whole or absent: copied to a temporary beside `to`, flushed, then renamed.
export async function copyFileAtomic(from, to) {
  const tmp = tempName(to);
  try {
    await fsp.copyFile(from, tmp);
    const fh = await fsp.open(tmp, 'r+');
    try { await fh.sync(); } finally { await fh.close(); }
    await renameWithRetries(tmp, to);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

// ---------- reading ----------

// The parsed value of a JSON text, or undefined when it is not JSON or is not an object or
// a list (a bare number or string is no file of this app's). A byte-order mark, which
// Notepad adds, is not damage.
export function parseJsonValue(text) {
  let value;
  try { value = JSON.parse(String(text).replace(/^﻿/, '')); } catch { return undefined; }
  return value && typeof value === 'object' ? value : undefined;
}

// Moves a file the app could not read out of the way, keeping its bytes for a person, and
// says so on the console. Returns the new path. A name already taken (two quarantines in one
// second) gets a short random tail rather than being overwritten.
async function quarantine(file) {
  let broken = brokenName(file);
  try { await fsp.access(broken); broken = `${broken}-${crypto.randomBytes(2).toString('hex')}`; } catch { /* the usual case: the name is free */ }
  await fsp.rename(file, broken);
  console.warn(`${file} could not be read as JSON: kept as ${path.basename(broken)}`);
  return broken;
}
function quarantineSync(file) {
  let broken = brokenName(file);
  if (fs.existsSync(broken)) broken = `${broken}-${crypto.randomBytes(2).toString('hex')}`;
  fs.renameSync(file, broken);
  console.warn(`${file} could not be read as JSON: kept as ${path.basename(broken)}`);
  return broken;
}

// Reads a JSON file with three outcomes: missing → { value: null, broken: null }; unreadable
// as JSON (or not an object or list) → the file is quarantined and the result is
// { value: null, broken: <its new path> }; any other failure (held open, no permission, a
// folder in the file's place) → thrown, so the caller never mistakes it for an empty file.
export async function readJsonFile(file) {
  let text;
  try { text = await fsp.readFile(file, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return { value: null, broken: null };
    throw err;
  }
  const value = parseJsonValue(text);
  if (value !== undefined) return { value, broken: null };
  return { value: null, broken: await quarantine(file) };
}
export function readJsonFileSync(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return { value: null, broken: null };
    throw err;
  }
  const value = parseJsonValue(text);
  if (value !== undefined) return { value, broken: null };
  return { value: null, broken: quarantineSync(file) };
}

// ---------- the library index ----------

// The records of an index in either form: a plain list (the form before 4 November 2026) or
// { schemaVersion, records }. Entries that are not objects are dropped. Anything else → null.
export function indexFromJson(value) {
  const list = Array.isArray(value) ? value : value && typeof value === 'object' && Array.isArray(value.records) ? value.records : null;
  return list ? list.filter((r) => r && typeof r === 'object' && !Array.isArray(r)) : null;
}

// Returns { records, version, legacy }: `legacy` is true for a plain list, which is version
// 1.0.0 without saying so. A parsable file in neither form is quarantined like damage: the
// server rebuilds the index from the WAV files and their details anyway.
const emptyIndex = (broken) => ({ records: [], version: INDEX_VERSION, legacy: false, broken });
function indexResult(value, broken) {
  if (value === null) return emptyIndex(broken);
  const records = indexFromJson(value);
  if (!records) return null; // parsable, but in neither form
  const legacy = Array.isArray(value);
  return { records, version: legacy ? INDEX_VERSION : typeof value.schemaVersion === 'string' ? value.schemaVersion : INDEX_VERSION, legacy, broken: null };
}
export async function readLibraryIndex(file) {
  const { value, broken } = await readJsonFile(file);
  return indexResult(value, broken) || emptyIndex(await quarantine(file));
}
export function readLibraryIndexSync(file) {
  const { value, broken } = readJsonFileSync(file);
  return indexResult(value, broken) || emptyIndex(quarantineSync(file));
}
export const writeLibraryIndex = (file, records) => writeJsonAtomic(file, { schemaVersion: INDEX_VERSION, records });
export const writeLibraryIndexSync = (file, records) => writeJsonAtomicSync(file, { schemaVersion: INDEX_VERSION, records });

// ---------- start-up ----------

// Removes the temporaries a save that died left behind: the data folder's top level and its
// own subfolders are walked, nothing else, since the data folder is the project folder by
// default. A temporary younger than TEMP_MAX_AGE_MS may belong to a save in progress and is
// left alone. Returns how many were removed, one console line each.
export async function sweepTemp(dataDir, { now = Date.now() } = {}) {
  let removed = 0;
  const sweep = async (dir, recurse) => {
    let entries = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (recurse) await sweep(p, true); continue; }
      if (!e.isFile() || !isTempName(e.name)) continue;
      let st = null;
      try { st = await fsp.stat(p); } catch { continue; }
      if (now - st.mtimeMs < TEMP_MAX_AGE_MS) continue;
      try { await fsp.rm(p); removed++; console.log(`removed a save cut short: ${path.relative(dataDir, p)}`); } catch (err) { console.warn(`could not remove ${p}: ${err.message}`); }
    }
  };
  await sweep(dataDir, false);
  for (const sub of SWEPT_FOLDERS) await sweep(path.join(dataDir, sub), true);
  return removed;
}

// Whether something answers on the server's port: true when a connection is accepted,
// false when it is refused or nothing answers within a second.
export function serverRunning(port, { host = '127.0.0.1', timeoutMs = 1000 } = {}) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    let settled = false;
    const done = (running) => { if (settled) return; settled = true; sock.destroy(); resolve(running); };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.setTimeout(timeoutMs, () => done(false));
  });
}

// For the tools that change the library: the server has its own index and details in hand,
// and a tool writing beside it would race it. Prints the message and exits with code 1.
export async function assertServerStopped(port) {
  if (!(await serverRunning(port))) return;
  console.error(`The server is running on port ${port}: stop it before running this tool, which changes the library.`);
  process.exit(1);
}
