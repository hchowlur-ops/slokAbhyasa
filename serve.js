// SlokAbhyasa — zero-dependency local server.
// Serves the static app and a small JSON/WAV API that stores baselines as
// ordinary .wav files in <data>/library and its subfolders (plus index.json and cached
// analysis features), and quizzes as JSON files in <data>/quizzes. <data> is the project
// folder unless local.json or SLOKABHYASA_DATA says otherwise (see datadir.js).
//
//   node serve.js            → http://127.0.0.1:8787
//   PORT=9000 node serve.js  → custom port

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trimSilence } from './js/dsp/trim.js';
import { decodeWav, encodeWavBytes } from './js/wav.js';
import { cleanFolder, parseBaselineFilename, nameFromSlug, parseWavHeader, RESERVED_FOLDERS } from './js/libutil.js';
import { normalizeCategories, correctness } from './js/quizscore.js';
import { resolveDataDir } from './datadir.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = resolveDataDir(ROOT);
const LIB = path.join(DATA, 'library');
const INDEX = path.join(LIB, 'index.json');
const QUIZZES = path.join(DATA, 'quizzes');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 8787;
const MAX_UPLOAD = 512 * 1024 * 1024; // 512 MB

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

// ---------- library index ----------

async function ensureLibrary() {
  await fsp.mkdir(LIB, { recursive: true });
  await fsp.mkdir(QUIZZES, { recursive: true });
  try { await fsp.access(INDEX); } catch { await fsp.writeFile(INDEX, '[]\n'); }
  await syncIndex();
}

// ---------- folders ----------
// A sloka's `file` is its path relative to the library, forward slashes, so the folder is
// everything before the file name ('' for the top level). library/backup is reserved.

const folderOf = (file) => { const d = path.posix.dirname(String(file || '').replace(/\\/g, '/')); return d === '.' ? '' : d; };
const skipDir = (name) => name.startsWith('.') || RESERVED_FOLDERS.has(name.toLowerCase());

// Every folder under the library (relative posix paths), top level first.
async function listFolders() {
  const out = [''];
  const walk = async (rel) => {
    let entries = [];
    try { entries = await fsp.readdir(path.join(LIB, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory() || (rel === '' && skipDir(e.name)) || e.name.startsWith('.')) continue;
      const sub = rel ? `${rel}/${e.name}` : e.name;
      if (sub.split('/').length > 3) continue;
      out.push(sub);
      await walk(sub);
    }
  };
  await walk('');
  return out;
}

// Every .wav under the library (relative posix paths), except the backup folder.
async function listWavFiles() {
  const out = [];
  for (const folder of await listFolders()) {
    let entries = [];
    try { entries = await fsp.readdir(path.join(LIB, folder), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && /\.wav$/i.test(e.name) && !e.name.startsWith('.')) out.push(folder ? `${folder}/${e.name}` : e.name);
    }
  }
  return out;
}

async function wavInfo(rel) {
  const fh = await fsp.open(path.join(LIB, rel), 'r');
  try {
    const { size } = await fh.stat();
    const buf = Buffer.alloc(Math.min(size, 8192));
    await fh.read(buf, 0, buf.length, 0);
    return parseWavHeader(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), size);
  } finally {
    await fh.close();
  }
}

// Brings index.json in line with the files on disk, so slokas can be organised into
// folders (or dropped in) with Explorer: entries follow a WAV that moved, WAVs without an
// entry are added, entries whose WAV is gone are removed. Sidecar files travel by name.
async function syncIndex() {
  const files = await listWavFiles();
  const have = new Set(files);
  const byBase = new Map();
  for (const f of files) byBase.set(path.posix.basename(f), f);
  const changes = [];
  await withIndex(async (list) => {
    const used = new Set();
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      const file = String(r.file || '').replace(/\\/g, '/');
      if (have.has(file)) { r.file = file; used.add(file); continue; }
      const moved = byBase.get(path.posix.basename(file));
      if (moved && !used.has(moved)) { changes.push(`"${r.name}" moved to ${folderOf(moved) || 'the top level'}`); r.file = moved; used.add(moved); continue; }
      changes.push(`"${r.name}" removed: ${file} is gone`);
      list.splice(i, 1);
    }
    const ids = new Set(list.map((r) => r.id));
    for (const f of files) {
      if (used.has(f)) continue;
      if (!folderOf(f)) { changes.push(`${f} not added: new slokas belong in a folder, not the top level`); continue; }
      const base = path.posix.basename(f);
      const parsed = parseBaselineFilename(base);
      let info = null;
      try { info = await wavInfo(f); } catch { info = null; }
      if (!info) { changes.push(`${f} skipped: not a readable WAV`); continue; }
      let stat = null;
      try { stat = await fsp.stat(path.join(LIB, f)); } catch { stat = null; }
      const id = parsed && !ids.has(parsed.id) ? parsed.id : newId();
      ids.add(id);
      const rec = {
        id,
        name: nameFromSlug(parsed ? parsed.slug : base.replace(/\.wav$/i, ''), base),
        file: f,
        createdAt: (stat ? stat.mtime : new Date()).toISOString(),
        duration: info.duration,
        sampleRate: info.sampleRate,
        source: 'file',
      };
      list.push(rec);
      used.add(f);
      changes.push(`"${rec.name}" added from ${f}`);
    }
  });
  for (const c of changes) console.log(`library: ${c}`);
  return changes.length;
}

// Moves a sloka's WAV and sidecar files into `folder` (created if needed).
async function moveRecord(r, folder) {
  const oldRec = { ...r };
  const newFile = folder ? `${folder}/${path.posix.basename(r.file)}` : path.posix.basename(r.file);
  if (newFile === r.file) return r;
  const newRec = { ...r, file: newFile };
  await fsp.mkdir(path.join(LIB, folder), { recursive: true });
  for (const fn of [audioPath, featuresPath, transcriptPath, textPath]) {
    if (await fileExists(fn(oldRec))) await fsp.rename(fn(oldRec), fn(newRec));
  }
  r.file = newFile;
  return r;
}

async function readIndex() {
  try {
    const list = JSON.parse(await fsp.readFile(INDEX, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

let indexLock = Promise.resolve();
function withIndex(fn) {
  // Serialise read-modify-write cycles on index.json.
  const run = indexLock.then(async () => {
    const list = await readIndex();
    const before = JSON.stringify(list, null, 2);
    const out = await fn(list);
    const after = JSON.stringify(list, null, 2);
    if (after !== before) await fsp.writeFile(INDEX, after + '\n');
    return out;
  });
  indexLock = run.catch(() => {});
  return run;
}

function slug(name) {
  const s = String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40)
    .replace(/-+$/g, '');
  return s || 'sloka';
}

function newId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

const audioPath = (rec) => path.join(LIB, ...rec.file.split('/'));
const featuresPath = (rec) => path.join(LIB, ...rec.file.replace(/\.wav$/i, '.features.json').split('/'));
const transcriptPath = (rec) => path.join(LIB, ...rec.file.replace(/\.wav$/i, '.transcript.json').split('/'));
const textPath = (rec) => path.join(LIB, ...rec.file.replace(/\.wav$/i, '.txt').split('/'));

// The plain-text twin of a transcript: one line per timed phrase (or the whole text).
function transcriptToText(tr) {
  const lines = Array.isArray(tr.chunks) && tr.chunks.length
    ? tr.chunks.map((c) => String(c.text || '').trim()).filter(Boolean)
    : [String(tr.text || '').trim()];
  return lines.join('\n') + '\n';
}

// Reads the stored transcript. If <name>.txt was edited by hand more recently than the
// JSON, its text wins (timings are kept when the line count still matches the phrases).
async function readTranscript(rec) {
  const jp = transcriptPath(rec);
  const tp = textPath(rec);
  let tr = null;
  let jStat = null;
  let tStat = null;
  try { tr = JSON.parse(await fsp.readFile(jp, 'utf8')); jStat = await fsp.stat(jp); } catch { tr = null; }
  try { tStat = await fsp.stat(tp); } catch { tStat = null; }
  if (tStat && (!tr || tStat.mtimeMs > jStat.mtimeMs + 1500)) {
    const lines = (await fsp.readFile(tp, 'utf8')).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const base = tr || { language: 'unknown', tier: null };
    const chunks = Array.isArray(base.chunks) && base.chunks.length === lines.length ? base.chunks.map((c, i) => ({ ...c, text: lines[i] })) : [];
    tr = { ...base, text: lines.join(' '), chunks, edited: true, editedIn: 'file', createdAt: tStat.mtime.toISOString() };
    await fsp.writeFile(jp, JSON.stringify(tr)); // JSON is now the newer file until the .txt is edited again
  }
  return tr;
}

async function writeTranscript(rec, tr) {
  await fsp.writeFile(textPath(rec), transcriptToText(tr));
  await fsp.writeFile(transcriptPath(rec), JSON.stringify(tr));
}

function publicRecord(rec) {
  const { id, name, file, createdAt, duration, sampleRate, source } = rec;
  return { id, name, file, folder: folderOf(file), createdAt, duration, sampleRate, source };
}

// ---------- quizzes ----------
// One JSON file per quiz in ./quizzes: the picked slokas, the chosen score categories and
// every attempt's per-category scores.

const quizPath = (id) => path.join(QUIZZES, `${id}.json`);
const QUIZ_ID = /^\d{8}-\d{6}-[a-z0-9]{4}$/;

async function readQuiz(id) {
  if (!QUIZ_ID.test(id)) return null;
  try { return JSON.parse(await fsp.readFile(quizPath(id), 'utf8')); } catch { return null; }
}
async function writeQuiz(q) { await fsp.writeFile(quizPath(q.id), JSON.stringify(q, null, 2) + '\n'); }
async function listQuizzes() {
  let names = [];
  try { names = await fsp.readdir(QUIZZES); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const q = await readQuiz(n.slice(0, -5));
    if (q) out.push(quizSummary(q));
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
function quizSummary(q) {
  const attempts = Array.isArray(q.attempts) ? q.attempts : [];
  const last = attempts[attempts.length - 1] || null;
  // correctness on the quiz's current categories and the fixed quiz tolerance, for every attempt
  const scoreOf = (a) => (Array.isArray(a.items) && a.items.length ? correctness(a.items, q.categories).pct : a.score == null ? null : a.score);
  return {
    id: q.id, name: q.name, createdAt: q.createdAt, folders: q.folders, mode: q.mode, maxFiles: q.maxFiles,
    items: q.items, categories: q.categories, attempts: attempts.length,
    last: last ? { at: last.at, score: scoreOf(last), byCategory: last.byCategory } : null,
    best: attempts.reduce((m, a) => { const s = scoreOf(a); return s != null && (m == null || s > m) ? s : m; }, null),
  };
}
const cleanItems = (items) => (Array.isArray(items) ? items : [])
  .filter((it) => it && typeof it.id === 'string')
  .map((it) => ({ id: it.id, name: String(it.name || '').slice(0, 80), folder: typeof it.folder === 'string' ? it.folder : '' }));

async function handleQuizzes(req, res, parts) {
  const id = parts[2];
  const sub = parts[3];
  const json = async (limit = 5e6) => { try { return JSON.parse((await readBody(req, limit)).toString('utf8')); } catch { return null; } };

  if (!id && req.method === 'GET') return sendJson(res, 200, await listQuizzes());
  if (!id && req.method === 'POST') {
    const body = await json();
    if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'Invalid JSON' });
    const name = String(body.name || '').trim().slice(0, 120);
    const items = cleanItems(body.items);
    if (!name) return sendJson(res, 400, { error: 'A quiz needs a name' });
    if (!items.length) return sendJson(res, 400, { error: 'A quiz needs at least one sloka' });
    const q = {
      id: newId(),
      name,
      createdAt: new Date().toISOString(),
      folders: (Array.isArray(body.folders) ? body.folders : []).map((f) => cleanFolder(f)).filter((f) => f !== null),
      mode: body.mode === 'single' ? 'single' : 'multiple',
      maxFiles: Math.max(1, Math.min(200, Number(body.maxFiles) || 10)),
      items,
      categories: normalizeCategories(body.categories),
      attempts: [],
    };
    await writeQuiz(q);
    return sendJson(res, 201, q);
  }
  if (!id) return sendJson(res, 405, { error: 'Method not allowed' });

  const q = await readQuiz(id);
  if (!q) return sendJson(res, 404, { error: 'No such quiz' });

  // POST /api/quizzes/:id/attempts  {at, takeDuration, categories, score, byCategory, items}
  if (sub === 'attempts' && req.method === 'POST') {
    const a = await json();
    if (!a || typeof a !== 'object' || !a.byCategory || typeof a.byCategory !== 'object') return sendJson(res, 400, { error: 'An attempt needs byCategory scores' });
    const attempt = {
      at: typeof a.at === 'string' ? a.at : new Date().toISOString(),
      takeDuration: Number(a.takeDuration) || 0,
      categories: normalizeCategories(a.categories),
      score: a.score == null ? null : Number(a.score),
      byCategory: a.byCategory,
      counted: Number(a.counted) || 0,
      recited: Number(a.recited) || 0,
      items: Array.isArray(a.items) ? a.items : [],
    };
    q.attempts = Array.isArray(q.attempts) ? q.attempts : [];
    q.attempts.push(attempt);
    await writeQuiz(q);
    return sendJson(res, 201, q);
  }
  if (sub) return sendJson(res, 404, { error: 'Not found' });

  if (req.method === 'GET') return sendJson(res, 200, q);
  if (req.method === 'PATCH') {
    const patch = await json(1e6);
    if (!patch || typeof patch !== 'object') return sendJson(res, 400, { error: 'Invalid JSON' });
    if (patch.categories !== undefined) q.categories = normalizeCategories(patch.categories);
    if (typeof patch.name === 'string' && patch.name.trim()) q.name = patch.name.trim().slice(0, 120);
    await writeQuiz(q);
    return sendJson(res, 200, q);
  }
  if (req.method === 'DELETE') {
    await fsp.rm(quizPath(id), { force: true });
    return sendJson(res, 200, { ok: true });
  }
  return sendJson(res, 405, { error: 'Method not allowed' });
}

async function handleFolders(req, res) {
  if (req.method === 'GET') {
    const list = await readIndex();
    const counts = new Map();
    for (const r of list) { const f = folderOf(r.file); counts.set(f, (counts.get(f) || 0) + 1); }
    return sendJson(res, 200, (await listFolders()).map((f) => ({ path: f, count: counts.get(f) || 0 })));
  }
  if (req.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(req, 1e5)).toString('utf8')); } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }
    const folder = cleanFolder(body && body.name);
    if (!folder) return sendJson(res, 400, { error: 'That is not a usable folder name' });
    await fsp.mkdir(path.join(LIB, folder), { recursive: true });
    return sendJson(res, 201, { path: folder });
  }
  return sendJson(res, 405, { error: 'Method not allowed' });
}

// ---------- helpers ----------

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function readBody(req, limit = MAX_UPLOAD) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Upload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function isWav(buf) {
  return buf.length > 44 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE';
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m) return null;
  let start = m[1] === '' ? null : Number(m[1]);
  let end = m[2] === '' ? null : Number(m[2]);
  if (start === null && end === null) return null;
  if (start === null) { start = Math.max(0, size - end); end = size - 1; }
  else if (end === null || end >= size) { end = size - 1; }
  if (start > end || start >= size) return { invalid: true };
  return { start, end };
}

async function fileExists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

// ---------- API ----------

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api','baselines',id?,sub?]
  if (parts[1] === 'quizzes') return handleQuizzes(req, res, parts);
  if (parts[1] === 'folders') return handleFolders(req, res);
  if (parts[1] !== 'baselines') return sendJson(res, 404, { error: 'Not found' });
  const id = parts[2];
  const sub = parts[3];

  // GET /api/baselines  (also picks up files moved or added with Explorer)
  if (!id && req.method === 'GET') {
    await syncIndex();
    const list = await readIndex();
    return sendJson(res, 200, list.map(publicRecord));
  }

  // POST /api/baselines?name=&duration=&sampleRate=&source=   (body: WAV bytes)
  if (!id && req.method === 'POST') {
    const body = await readBody(req);
    if (!isWav(body)) return sendJson(res, 400, { error: 'Body must be a RIFF/WAVE file' });
    const name = (url.searchParams.get('name') || 'Untitled').trim().slice(0, 80) || 'Untitled';
    const folder = cleanFolder(url.searchParams.get('folder') || '');
    if (folder === null) return sendJson(res, 400, { error: 'That is not a usable folder name' });
    if (!folder) return sendJson(res, 400, { error: 'Slokas are saved in folders: choose or create one' });
    const rec = {
      id: newId(),
      name,
      file: '',
      createdAt: new Date().toISOString(),
      duration: Number(url.searchParams.get('duration')) || 0,
      sampleRate: Number(url.searchParams.get('sampleRate')) || 0,
      source: url.searchParams.get('source') === 'file' ? 'file' : 'mic',
    };
    rec.file = `${folder ? folder + '/' : ''}${slug(name)}-${rec.id}.wav`;
    await fsp.mkdir(path.join(LIB, folder), { recursive: true });
    await fsp.writeFile(audioPath(rec), body);
    await withIndex((list) => { list.push(rec); });
    return sendJson(res, 201, publicRecord(rec));
  }

  if (!id) return sendJson(res, 405, { error: 'Method not allowed' });

  const list = await readIndex();
  const rec = list.find((r) => r.id === id);
  if (!rec) return sendJson(res, 404, { error: 'No such sloka' });

  // GET /api/baselines/:id/audio  (supports Range)
  if (sub === 'audio' && (req.method === 'GET' || req.method === 'HEAD')) {
    const p = audioPath(rec);
    let stat;
    try { stat = await fsp.stat(p); } catch { return sendJson(res, 404, { error: 'Audio file missing on disk' }); }
    const headers = {
      'Content-Type': 'audio/wav',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Last-Modified': stat.mtime.toUTCString(),
    };
    const range = parseRange(req.headers.range, stat.size);
    if (range && range.invalid) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    if (range) {
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
        'Content-Length': range.end - range.start + 1,
      });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(p, { start: range.start, end: range.end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(p).pipe(res);
  }

  // GET / PUT /api/baselines/:id/features
  if (sub === 'features') {
    const p = featuresPath(rec);
    if (req.method === 'GET') {
      if (!(await fileExists(p))) return sendJson(res, 404, { error: 'No cached features' });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return fs.createReadStream(p).pipe(res);
    }
    if (req.method === 'PUT') {
      const body = await readBody(req);
      try { JSON.parse(body.toString('utf8')); } catch { return sendJson(res, 400, { error: 'Features must be JSON' }); }
      await fsp.writeFile(p, body);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      await fsp.rm(p, { force: true });
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  // POST /api/baselines/:id/trim  → trims silence at both ends of the stored WAV
  if (sub === 'trim' && req.method === 'POST') {
    let bytes;
    try { bytes = await fsp.readFile(audioPath(rec)); } catch { return sendJson(res, 404, { error: 'Audio file missing on disk' }); }
    const { samples, sampleRate } = decodeWav(bytes);
    const t = trimSilence(samples, sampleRate);
    const duration = t.samples.length / sampleRate;
    if (t.changed) {
      // Keep the untouched original (first version only) in library/backup.
      const backupDir = path.join(LIB, 'backup');
      await fsp.mkdir(backupDir, { recursive: true });
      const backup = path.join(backupDir, rec.file);
      if (!(await fileExists(backup))) await fsp.copyFile(audioPath(rec), backup);
      await fsp.writeFile(audioPath(rec), encodeWavBytes(t.samples, sampleRate));
      await fsp.rm(featuresPath(rec), { force: true });
      // A stored transcript keeps its words; only its timestamps shift.
      try {
        const tr = await readTranscript(rec);
        if (tr && Array.isArray(tr.chunks)) {
          tr.chunks = tr.chunks.map((c) => ({ ...c, start: Math.max(0, (c.start || 0) - t.removedStart), end: c.end == null ? null : Math.max(0, Math.min(duration, c.end - t.removedStart)) }));
          await writeTranscript(rec, tr);
        }
      } catch { /* no transcript */ }
      await withIndex((l) => { const r = l.find((x) => x.id === id); if (r) { r.duration = duration; r.sampleRate = sampleRate; } });
    }
    return sendJson(res, 200, { changed: t.changed, removedStart: t.removedStart, removedEnd: t.removedEnd, duration });
  }

  // GET / PUT / DELETE /api/baselines/:id/transcript
  if (sub === 'transcript') {
    if (req.method === 'GET') {
      const tr = await readTranscript(rec);
      if (!tr) return sendJson(res, 404, { error: 'No transcript yet' });
      return sendJson(res, 200, tr);
    }
    if (req.method === 'PUT') {
      let body;
      try { body = JSON.parse((await readBody(req, 5e6)).toString('utf8')); } catch { return sendJson(res, 400, { error: 'Transcript must be JSON' }); }
      if (!body || typeof body !== 'object' || typeof body.text !== 'string') return sendJson(res, 400, { error: 'Transcript needs a text field' });
      if (!body.text.trim() && !(Array.isArray(body.chunks) && body.chunks.some((c) => c && String(c.text || '').trim()))) return sendJson(res, 400, { error: 'An empty transcript is not stored' });
      await writeTranscript(rec, body);
      return sendJson(res, 200, { ok: true, textFile: path.basename(textPath(rec)) });
    }
    if (req.method === 'DELETE') {
      await fsp.rm(transcriptPath(rec), { force: true });
      await fsp.rm(textPath(rec), { force: true });
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  // POST /api/baselines/:id/move  {folder}
  if (sub === 'move' && req.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(req, 1e5)).toString('utf8')); } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }
    const folder = cleanFolder(body && body.folder);
    if (folder === null) return sendJson(res, 400, { error: 'That is not a usable folder name' });
    if (!folder) return sendJson(res, 400, { error: 'Slokas are kept in folders: choose or create one' });
    const moved = await withIndex(async (l) => { const r = l.find((x) => x.id === id); return r ? moveRecord(r, folder) : null; });
    if (!moved) return sendJson(res, 404, { error: 'No such sloka' });
    return sendJson(res, 200, publicRecord(moved));
  }

  if (sub) return sendJson(res, 404, { error: 'Not found' });

  // GET /api/baselines/:id
  if (req.method === 'GET') return sendJson(res, 200, publicRecord(rec));

  // PATCH /api/baselines/:id  {name}
  if (req.method === 'PATCH') {
    let patch;
    try { patch = JSON.parse((await readBody(req, 1e6)).toString('utf8')); } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }
    const name = String(patch.name || '').trim().slice(0, 80);
    if (!name) return sendJson(res, 400, { error: 'Name is required' });
    const updated = await withIndex(async (l) => {
      const r = l.find((x) => x.id === id);
      if (!r) return null;
      const folder = folderOf(r.file);
      const newFile = `${folder ? folder + '/' : ''}${slug(name)}-${r.id}.wav`;
      if (newFile !== r.file) {
        const oldRec = { ...r };
        const newRec = { ...r, file: newFile };
        if (await fileExists(audioPath(oldRec))) await fsp.rename(audioPath(oldRec), audioPath(newRec));
        if (await fileExists(featuresPath(oldRec))) await fsp.rename(featuresPath(oldRec), featuresPath(newRec));
        if (await fileExists(transcriptPath(oldRec))) await fsp.rename(transcriptPath(oldRec), transcriptPath(newRec));
        if (await fileExists(textPath(oldRec))) await fsp.rename(textPath(oldRec), textPath(newRec));
        r.file = newFile;
      }
      r.name = name;
      return r;
    });
    if (!updated) return sendJson(res, 404, { error: 'No such sloka' });
    return sendJson(res, 200, publicRecord(updated));
  }

  // DELETE /api/baselines/:id
  if (req.method === 'DELETE') {
    await withIndex(async (l) => {
      const idx = l.findIndex((x) => x.id === id);
      if (idx >= 0) {
        const r = l[idx];
        await fsp.rm(audioPath(r), { force: true });
        await fsp.rm(featuresPath(r), { force: true });
        await fsp.rm(transcriptPath(r), { force: true });
        await fsp.rm(textPath(r), { force: true });
        l.splice(idx, 1);
      }
    });
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 405, { error: 'Method not allowed' });
}

// ---------- static ----------

async function handleStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const abs = path.normalize(path.join(ROOT, rel));
  if (!abs.startsWith(ROOT + path.sep) || path.basename(abs).startsWith('.')) return send(res, 403, 'Forbidden');
  let stat;
  try { stat = await fsp.stat(abs); } catch { return send(res, 404, 'Not found'); }
  if (stat.isDirectory()) return send(res, 404, 'Not found');
  const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
  // Cross-origin isolation lets the speech model use multi-threaded WebAssembly.
  // "credentialless" keeps plain cross-origin loads working without CORP headers.
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(abs).pipe(res);
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await handleStatic(req, res, url);
  } catch (err) {
    console.error(`${req.method} ${url.pathname} →`, err);
    if (!res.headersSent) sendJson(res, 500, { error: err.message || 'Server error' });
    else res.end();
  }
});

await ensureLibrary();
server.listen(PORT, HOST, () => {
  console.log(`SlokAbhyasa is running at http://${HOST}:${PORT}`);
  console.log(`Slokas are stored in ${LIB} (and its subfolders); quizzes in ${QUIZZES}`);
});
