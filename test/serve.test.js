// The server at the HTTP level: serve.js started as a child process on a temporary data
// folder and a free port (PORT=0), then asked what the edge must refuse and what the stores
// must keep. Nothing outside the temporary folder is touched; the app's own files are only
// read. One start for every case, since the start is the slow part (about a second).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeWavBytes } from '../js/wav.js';
import { isTempName } from '../datafile.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const tone = (sec = 0.5, sr = 16000) => {
  const x = new Float32Array(Math.round(sec * sr));
  for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / sr);
  return x;
};
const asBuffer = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
const wavBytes = () => asBuffer(encodeWavBytes(tone(), 16000));
// a tone with half a second of silence at each end: what Trim has something to remove from
const paddedWav = () => { const t = tone(); const x = new Float32Array(8000 + t.length + 8000); x.set(t, 8000); return asBuffer(encodeWavBytes(x, 16000)); };
// a damaged file written a moment ago counts as "still being written"; a case that expects a quarantine ages it
const aged = async (file, content) => { await fsp.writeFile(file, content); const old = new Date(Date.now() - 120000); await fsp.utimes(file, old, old); };

// Starts serve.js on `dir` expecting it to refuse; resolves with its output once it has exited.
function failedStart(dir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, env: { ...process.env, SLOKABHYASA_DATA: dir, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not exit:\n${out}`)); }, 20000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

// Starts serve.js on `dir`; resolves once it prints the port it chose.
async function startServer(dir) {
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, env: { ...process.env, SLOKABHYASA_DATA: dir, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the server did not start in time:\n${out}`)), 20000);
    const look = (chunk) => {
      out += chunk;
      const m = /running at http:\/\/127\.0\.0\.1:(\d+)\//.exec(out);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    };
    child.stdout.on('data', look);
    child.stderr.on('data', (c) => { out += c; });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`the server exited with ${code}:\n${out}`)); });
  });
  return { port, output: () => out, stop: () => new Promise((resolve) => { child.once('exit', resolve); child.kill(); }) };
}

// A raw request, so the Host, Origin and Sec-Fetch headers are exactly what the case says.
function raw(port, { method = 'GET', path: p = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const json = (r) => JSON.parse(r.text);
const JSON_H = { 'content-type': 'application/json' };
const WAV_H = { 'content-type': 'audio/wav' };

// Every file under `dir` whose name is a temporary's.
async function temporaries(dir) {
  const out = [];
  const walk = async (d) => {
    for (const e of await fsp.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p); else if (isTempName(e.name)) out.push(p);
    }
  };
  await walk(dir);
  return out;
}

test('the server on a temporary data folder: the edge, the files, the versions', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'slokabhyasa-serve-'));
  // before the start: an index in the old form naming one sloka; a second sloka on disk with
  // details but no index entry; a session from before versions; a damaged profiles.json; a
  // temporary left by a save that died two minutes ago
  const wav = wavBytes();
  const recA = { id: '20260101-120000-aaaa', name: 'CH12-03', file: 'ch12/ch12-03-20260101-120000-aaaa.wav', createdAt: '2026-01-01T12:00:00.000Z', duration: 0.5, sampleRate: 16000, source: 'mic' };
  const fileB = 'ch12/ch12-04-20260101-120000-bbbb.wav';
  const detailsB = { schemaVersion: '1.1.0', id: '20260101-120000-bbbb', name: 'CH12-04 (teacher)', source: 'mic', createdAt: '2025-05-05T05:05:05.000Z', speaker: { profileId: null, voiceType: 'female', ageGroup: '40to59' } };
  const oldSession = { id: '20260102-120000-cccc', kind: 'evaluation', at: '2026-01-02T12:00:00.000Z', takeDuration: 10, items: [], overall: null, grade: null };
  const libDir = path.join(dir, 'library');
  await fsp.mkdir(path.join(libDir, 'ch12'), { recursive: true });
  await fsp.mkdir(path.join(dir, 'sessions'), { recursive: true });
  await fsp.writeFile(path.join(libDir, ...recA.file.split('/')), wav);
  await fsp.writeFile(path.join(libDir, 'index.json'), `${JSON.stringify([recA], null, 2)}\n`);
  await fsp.writeFile(path.join(libDir, ...fileB.split('/')), wav);
  await fsp.writeFile(path.join(libDir, ...fileB.replace(/\.wav$/, '.json').split('/')), JSON.stringify(detailsB, null, 2));
  await fsp.writeFile(path.join(dir, 'sessions', `${oldSession.id}.json`), JSON.stringify(oldSession, null, 2));
  await aged(path.join(dir, 'profiles.json'), '{"schemaVersion": "1.0.0", "profiles": [{"id": "p-1", "name": "An');
  const stale = path.join(libDir, 'index.json.tmp-999-aaaaaa');
  await fsp.writeFile(stale, '[');
  const old = new Date(Date.now() - 120000);
  await fsp.utimes(stale, old, old);

  const srv = await startServer(dir);
  const { port } = srv;
  const own = `127.0.0.1:${port}`;
  try {
    await t.test('a nonsense Host is refused with 403 and the server is still there', async () => {
      const r = await raw(port, { headers: { host: '[' } });
      assert.equal(r.status, 403);
      assert.equal(json(r).error, 'This server answers only its own address');
      assert.equal((await raw(port, { path: '/api/folders' })).status, 200);
    });

    await t.test('a foreign Host or Origin is refused; its own pass', async () => {
      assert.equal((await raw(port, { path: '/api/folders', headers: { host: `evil.example:${port}` } })).status, 403);
      assert.equal((await raw(port, { path: '/api/folders', headers: { host: `127.0.0.1:${port + 1}` } })).status, 403, 'the wrong port');
      const foreign = await raw(port, { path: '/api/folders', headers: { origin: 'https://evil.example' } });
      assert.equal(foreign.status, 403);
      assert.equal(json(foreign).error, 'Requests from other pages are not accepted');
      assert.equal((await raw(port, { path: '/api/folders', headers: { origin: 'null' } })).status, 403, 'a page opened from disk');
      assert.equal((await raw(port, { path: '/api/folders', headers: { host: `localhost:${port}`, origin: `http://localhost:${port}` } })).status, 200);
      assert.equal((await raw(port, { path: '/api/folders', headers: { host: own, origin: `http://${own}`, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' } })).status, 200);
    });

    await t.test('a cross-site fetch is refused, a link to the app from another page is not', async () => {
      assert.equal((await raw(port, { path: '/api/folders', headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' } })).status, 403);
      assert.equal((await raw(port, { path: '/api/baselines/x/audio', headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'audio' } })).status, 403, 'an <audio> tag on another page');
      assert.equal((await raw(port, { path: '/', headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } })).status, 200);
    });

    await t.test('a target that is not a plain path is refused with 400', async () => {
      assert.equal((await raw(port, { path: '//evil.example/x' })).status, 400);
      assert.equal((await raw(port, { path: 'http://127.0.0.1/x' })).status, 400);
      assert.equal((await raw(port, { path: '/js/%E0%A4' })).status, 400, 'a bad percent-encoding');
    });

    await t.test('JSON without its label is 415, with it 201', async () => {
      const bare = await raw(port, { method: 'POST', path: '/api/folders', headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: '{"name":"CH-12"}' });
      assert.equal(bare.status, 415);
      assert.equal(json(bare).error, 'The body must be JSON (Content-Type: application/json)');
      assert.equal((await raw(port, { method: 'POST', path: '/api/folders', body: '{"name":"CH-12"}' })).status, 415, 'no label at all');
      const ok = await raw(port, { method: 'POST', path: '/api/folders', headers: { 'content-type': 'application/json; charset=utf-8' }, body: '{"name":"CH-12"}' });
      assert.equal(ok.status, 201);
      assert.ok(fs.existsSync(path.join(libDir, 'CH-12')));
      const junk = await raw(port, { method: 'POST', path: '/api/folders', headers: JSON_H, body: '{"name":' });
      assert.equal(junk.status, 400);
      assert.equal(json(junk).error, 'The body must be JSON');
      assert.equal((await raw(port, { method: 'POST', path: '/api/folders', headers: JSON_H, body: '[1]' })).status, 400, 'a list is not a request');
    });

    await t.test('a body over the limit is 413, answered on a quiet connection, and the server goes on', async () => {
      const big = `{"name":"${'x'.repeat(200000)}"}`;
      const r = await raw(port, { method: 'POST', path: '/api/folders', headers: JSON_H, body: big });
      assert.equal(r.status, 413);
      assert.equal(r.headers.connection, 'close');
      assert.equal(json(r).error, 'The body is too large (limit 100 KB)');
      assert.equal((await raw(port, { path: '/api/folders' })).status, 200);
    });

    await t.test('the static handler serves the app and nothing else', async () => {
      for (const p of ['/.git/HEAD', '/local.json', '/serve.js', '/package.json', '/library/index.json', '/research_notes/', '/test/serve.test.js', '/js/../serve.js', '/reference/gita/verses.json', '/reference/gita/manifest.json', '/reference/gita.custom.json', '/reference/nope/LICENSE', '/js/']) {
        assert.equal((await raw(port, { path: p })).status, 404, p);
      }
      const home = await raw(port, { path: '/' });
      assert.equal(home.status, 200);
      assert.equal(home.headers['content-type'], 'text/html; charset=utf-8');
      assert.equal(home.headers['cross-origin-opener-policy'], 'same-origin');
      assert.equal(home.headers['cross-origin-embedder-policy'], 'credentialless');
      assert.ok(home.text.includes('<title>'));
      assert.equal((await raw(port, { path: '/index.html' })).status, 200);
      assert.equal((await raw(port, { path: '/js/app.js' })).headers['content-type'], 'text/javascript; charset=utf-8');
      assert.equal((await raw(port, { path: '/css/styles.css' })).headers['content-type'], 'text/css; charset=utf-8');
      const head = await raw(port, { method: 'HEAD', path: '/js/app.js' });
      assert.equal(head.status, 200);
      assert.equal(head.text, '');
      assert.ok(Number(head.headers['content-length']) > 1000);
      assert.equal((await raw(port, { method: 'PUT', path: '/' })).status, 405);
    });

    await t.test('a dataset\'s licence and attribution are served as text from its own folder', async () => {
      const lic = await raw(port, { path: '/reference/gita/LICENSE' });
      assert.equal(lic.status, 200);
      assert.equal(lic.headers['content-type'], 'text/plain; charset=utf-8');
      assert.equal(lic.text, await fsp.readFile(path.join(ROOT, 'reference', 'gita', 'LICENSE'), 'utf8'));
      const att = await raw(port, { path: '/reference/gita/ATTRIBUTION.txt' });
      assert.equal(att.status, 200);
      assert.equal(att.headers['content-type'], 'text/plain; charset=utf-8');
    });

    await t.test('the index in its old form is rewritten once in the versioned form, and a sloka found on disk takes its name and date from its details', async () => {
      const onDisk = JSON.parse(await fsp.readFile(path.join(libDir, 'index.json'), 'utf8'));
      assert.deepEqual(Object.keys(onDisk), ['schemaVersion', 'records']);
      assert.equal(onDisk.schemaVersion, '1.0.0');
      assert.ok(srv.output().includes('library: index.json rewritten in its versioned form'), srv.output());
      const list = json(await raw(port, { path: '/api/baselines' }));
      assert.equal(list.length, 2);
      const a = list.find((r) => r.id === recA.id);
      assert.equal(a.name, 'CH12-03');
      assert.equal(a.meta.migrated, true, 'details made for the sloka that had none');
      const b = list.find((r) => r.id === detailsB.id);
      assert.ok(b, 'the id comes from the details, not made up');
      assert.equal(b.name, 'CH12-04 (teacher)');
      assert.equal(b.createdAt, '2025-05-05T05:05:05.000Z');
      assert.equal(b.source, 'mic');
      assert.equal(b.meta.speaker.voiceType, 'female', 'the details were read, not recreated');
      assert.equal(b.meta.recoveredFrom, undefined);
      assert.ok(!fs.existsSync(stale), 'the stale temporary was swept at start-up');
    });

    await t.test('a damaged profiles.json is kept as .broken-…, the list answers empty, and a profile saved after that goes beside it', async () => {
      assert.deepEqual(json(await raw(port, { path: '/api/profiles' })), []);
      const kept = (await fsp.readdir(dir)).filter((n) => n.startsWith('profiles.json.broken-'));
      assert.equal(kept.length, 1);
      const made = await raw(port, { method: 'POST', path: '/api/profiles', headers: JSON_H, body: JSON.stringify({ name: 'Ananya', voiceType: 'child', ageGroup: '8to11' }) });
      assert.equal(made.status, 201);
      assert.equal(json(await raw(port, { path: '/api/profiles' })).length, 1);
      assert.deepEqual((await fsp.readdir(dir)).filter((n) => n.startsWith('profiles.json.broken-')), kept);
      assert.ok((await fsp.readFile(path.join(dir, kept[0]), 'utf8')).endsWith('"An'));
    });

    await t.test('a session made today carries its version; one from before still lists', async () => {
      const made = await raw(port, { method: 'POST', path: '/api/sessions', headers: JSON_H, body: JSON.stringify({ kind: 'evaluation', takeDuration: 12 }) });
      assert.equal(made.status, 201);
      const s = json(made);
      assert.equal(s.schemaVersion, '1.0.0');
      const onDisk = JSON.parse(await fsp.readFile(path.join(dir, 'sessions', `${s.id}.json`), 'utf8'));
      assert.equal(Object.keys(onDisk)[0], 'schemaVersion');
      const list = json(await raw(port, { path: '/api/sessions' }));
      assert.ok(list.some((x) => x.id === oldSession.id), 'the old session, without a version');
      assert.ok(list.some((x) => x.id === s.id));
      // a save of the old one stamps it
      await raw(port, { method: 'PATCH', path: `/api/sessions/${oldSession.id}`, headers: JSON_H, body: JSON.stringify({ overall: 80 }) });
      assert.equal(JSON.parse(await fsp.readFile(path.join(dir, 'sessions', `${oldSession.id}.json`), 'utf8')).schemaVersion, '1.0.0');
      // the ear's log and the take, labelled
      assert.equal((await raw(port, { method: 'PUT', path: `/api/sessions/${s.id}/ear`, headers: JSON_H, body: JSON.stringify({ rows: [] }) })).status, 200);
      assert.equal((await raw(port, { method: 'PUT', path: `/api/sessions/${s.id}/audio`, headers: JSON_H, body: wav })).status, 415, 'a WAV must say it is one');
      assert.equal((await raw(port, { method: 'PUT', path: `/api/sessions/${s.id}/audio`, headers: WAV_H, body: wav })).status, 200);
      const back = await raw(port, { path: `/api/sessions/${s.id}/audio` });
      assert.equal(back.status, 200);
      assert.equal(back.body.length, wav.length);
    });

    await t.test('a sloka uploaded as WAV takes its duration from the file; the wrong label is 415', async () => {
      assert.equal((await raw(port, { method: 'POST', path: '/api/baselines?name=CH12-05&folder=ch12', headers: { 'content-type': 'text/plain' }, body: wav })).status, 415);
      const made = await raw(port, { method: 'POST', path: '/api/baselines?name=CH12-05&folder=ch12&duration=99&sampleRate=1', headers: WAV_H, body: wav });
      assert.equal(made.status, 201, made.text);
      const r = json(made);
      assert.equal(r.duration, 0.5, 'from the header, not the query');
      assert.equal(r.sampleRate, 16000);
      assert.ok(fs.existsSync(path.join(libDir, ...r.file.split('/'))));
      assert.ok(fs.existsSync(path.join(libDir, ...r.file.replace(/\.wav$/, '.json').split('/'))), 'its details');
      const notWav = await raw(port, { method: 'POST', path: '/api/baselines?name=X&folder=ch12', headers: WAV_H, body: Buffer.from('RIFF....WAVEjunk') });
      assert.equal(notWav.status, 400);
      const audio = await raw(port, { path: `/api/baselines/${r.id}/audio` });
      assert.equal(audio.status, 200);
      assert.equal(audio.headers['content-type'], 'audio/wav');
      assert.equal(audio.body.length, (await fsp.stat(path.join(libDir, ...r.file.split('/')))).size);
      const range = await raw(port, { path: `/api/baselines/${r.id}/audio`, headers: { range: 'bytes=0-99' } });
      assert.equal(range.status, 206);
      assert.equal(range.body.length, 100);
      assert.equal((await raw(port, { method: 'PUT', path: `/api/baselines/${r.id}/features`, headers: JSON_H, body: '{"v":1}' })).status, 200);
      assert.equal((await raw(port, { path: `/api/baselines/${r.id}/features` })).text, '{"v":1}');
      assert.equal((await raw(port, { method: 'PUT', path: `/api/baselines/${r.id}/meta`, headers: JSON_H, body: JSON.stringify({ notes: 'kept' }) })).status, 200);
      assert.equal(json(await raw(port, { path: `/api/baselines/${r.id}/meta` })).notes, 'kept');
    });

    await t.test('a quiz made today carries its version and keeps its attempt\'s recording', async () => {
      const made = await raw(port, { method: 'POST', path: '/api/quizzes', headers: JSON_H, body: JSON.stringify({ name: 'Evening', items: [{ id: recA.id, name: recA.name, folder: 'ch12' }] }) });
      assert.equal(made.status, 201, made.text);
      const q = json(made);
      assert.equal(q.schemaVersion, '1.0.0');
      const att = await raw(port, { method: 'POST', path: `/api/quizzes/${q.id}/attempts`, headers: JSON_H, body: JSON.stringify({ byCategory: { melody: 80 }, items: [] }) });
      assert.equal(att.status, 201, att.text);
      assert.equal((await raw(port, { method: 'PUT', path: `/api/quizzes/${q.id}/attempts/1/audio`, headers: WAV_H, body: wav })).status, 200);
      assert.equal((await raw(port, { path: `/api/quizzes/${q.id}/attempts/1/audio` })).body.length, wav.length);
      assert.equal(JSON.parse(await fsp.readFile(path.join(dir, 'quizzes', `${q.id}.json`), 'utf8')).schemaVersion, '1.0.0');
    });

    await t.test('every answer forbids framing by another site', async () => {
      for (const p of ['/', '/api/folders', `/api/baselines/${recA.id}/audio`, '/js/app.js']) {
        const r = await raw(port, { path: p });
        assert.equal(r.status, 200, p);
        assert.equal(r.headers['x-frame-options'], 'DENY', p);
        assert.equal(r.headers['content-security-policy'], "frame-ancestors 'none'", p);
      }
      const refused = await raw(port, { path: '/api/folders', headers: { origin: 'https://evil.example' } });
      assert.equal(refused.status, 403);
      assert.equal(refused.headers['x-frame-options'], 'DENY', 'a refusal too');
    });

    await t.test('a bad percent-encoding in a reference path is 400, not 500', async () => {
      assert.equal((await raw(port, { path: '/api/reference/%E0' })).status, 400);
      assert.equal((await raw(port, { path: '/api/reference/gita/verses/%E0' })).status, 400);
      assert.equal((await raw(port, { method: 'PUT', path: '/api/reference/gita/verses/%E0/custom', headers: JSON_H, body: '{}' })).status, 400);
      assert.equal((await raw(port, { path: '/api/reference/gita/verses/12.3' })).status, 200, 'a sound id still answers');
    });

    await t.test('a page on another local port is not this app', async () => {
      assert.equal((await raw(port, { path: `/api/baselines/${recA.id}/audio`, headers: { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'audio' } })).status, 403);
      assert.equal((await raw(port, { path: '/api/folders', headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' } })).status, 200);
    });

    await t.test('an Explorer copy and delete never leaves two slokas on one WAV', async () => {
      const copyDir = path.join(libDir, 'ch13');
      await fsp.mkdir(copyDir, { recursive: true });
      const base = path.basename(recA.file, '.wav');
      await fsp.copyFile(path.join(libDir, ...recA.file.split('/')), path.join(copyDir, `${base}.wav`));
      await fsp.copyFile(path.join(libDir, ...recA.file.replace(/\.wav$/, '.json').split('/')), path.join(copyDir, `${base}.json`));
      const withCopy = json(await raw(port, { path: '/api/baselines' }));
      const copy = withCopy.find((r) => r.file === `ch13/${base}.wav`);
      assert.ok(copy, 'the copy has a record of its own');
      assert.notEqual(copy.id, recA.id, 'with its own id');
      await fsp.rm(copyDir, { recursive: true, force: true });
      const after = json(await raw(port, { path: '/api/baselines' }));
      const owners = after.filter((r) => r.file === recA.file);
      assert.equal(owners.length, 1, 'one record on the original');
      assert.equal(owners[0].id, recA.id);
      assert.equal(owners[0].name, 'CH12-03');
      assert.ok(!after.some((r) => r.id === copy.id), 'the copy\'s record is gone, not rebound to the original');
      assert.ok(fs.existsSync(path.join(libDir, ...recA.file.split('/'))));
      const details = JSON.parse(await fsp.readFile(path.join(libDir, ...recA.file.replace(/\.wav$/, '.json').split('/')), 'utf8'));
      assert.equal(details.id, recA.id, 'the details still carry the original\'s id');
    });

    await t.test('two saves of one details file, or one quiz, at the same moment keep both', async () => {
      await Promise.all([
        raw(port, { method: 'PATCH', path: `/api/baselines/${recA.id}/meta`, headers: JSON_H, body: JSON.stringify({ notes: 'one' }) }),
        raw(port, { method: 'PATCH', path: `/api/baselines/${recA.id}/meta`, headers: JSON_H, body: JSON.stringify({ capture: { device: 'USB mic' } }) }),
      ]);
      const meta = json(await raw(port, { path: `/api/baselines/${recA.id}/meta` }));
      assert.equal(meta.notes, 'one');
      assert.equal(meta.capture && meta.capture.device, 'USB mic');
      const made = json(await raw(port, { method: 'POST', path: '/api/quizzes', headers: JSON_H, body: JSON.stringify({ name: 'Morning', items: [{ id: recA.id, name: recA.name, folder: 'ch12' }] }) }));
      const attempt = (n) => raw(port, { method: 'POST', path: `/api/quizzes/${made.id}/attempts`, headers: JSON_H, body: JSON.stringify({ byCategory: { melody: n }, items: [] }) });
      await Promise.all([attempt(70), attempt(80)]);
      assert.equal(json(await raw(port, { path: `/api/quizzes/${made.id}` })).attempts.length, 2);
    });

    await t.test('a rename cut short between a sloka\'s files is repaired at the next listing, by the id the details carry', async () => {
      // the WAV renamed and the sidecars not (the old order)
      const oldAbs = path.join(libDir, ...recA.file.split('/'));
      const renamedRel = `ch12/renamed-${recA.id}.wav`;
      await fsp.rename(oldAbs, path.join(libDir, ...renamedRel.split('/')));
      let list = json(await raw(port, { path: '/api/baselines' }));
      let r = list.find((x) => x.id === recA.id);
      assert.ok(r, 'the record follows the WAV under its id');
      assert.equal(r.file, renamedRel);
      assert.equal(r.name, 'CH12-03', 'the name comes from the details, not the file name');
      assert.equal(r.meta.notes, 'one', 'the details are the real ones');
      assert.equal(r.meta.recoveredFrom, undefined);
      assert.ok(fs.existsSync(path.join(libDir, 'ch12', `renamed-${recA.id}.json`)), 'the details sit beside the WAV again');
      assert.ok(!fs.existsSync(path.join(libDir, 'ch12', `${path.basename(recA.file, '.wav')}.json`)));
      // the sidecars renamed and the WAV not (the new order)
      await fsp.rename(path.join(libDir, 'ch12', `renamed-${recA.id}.json`), path.join(libDir, 'ch12', `other-${recA.id}.json`));
      list = json(await raw(port, { path: '/api/baselines' }));
      r = list.find((x) => x.id === recA.id);
      assert.equal(r.file, renamedRel);
      assert.equal(r.meta.notes, 'one');
      assert.ok(fs.existsSync(path.join(libDir, 'ch12', `renamed-${recA.id}.json`)));
      assert.ok(!fs.existsSync(path.join(libDir, 'ch12', `other-${recA.id}.json`)));
      recA.file = renamedRel;
    });

    await t.test('a move into a folder that already holds a file of that name is refused', async () => {
      await fsp.mkdir(path.join(libDir, 'ch14'), { recursive: true });
      await fsp.writeFile(path.join(libDir, 'ch14', path.basename(recA.file)), wav);
      const r = await raw(port, { method: 'POST', path: `/api/baselines/${recA.id}/move`, headers: JSON_H, body: '{"folder":"ch14"}' });
      assert.equal(r.status, 409);
      assert.ok(fs.existsSync(path.join(libDir, ...recA.file.split('/'))), 'nothing moved');
      await fsp.rm(path.join(libDir, 'ch14'), { recursive: true, force: true });
      const ok = await raw(port, { method: 'POST', path: `/api/baselines/${recA.id}/move`, headers: JSON_H, body: '{"folder":"ch14"}' });
      assert.equal(ok.status, 200);
      recA.file = json(ok).file;
      assert.ok(fs.existsSync(path.join(libDir, ...recA.file.replace(/\.wav$/, '.json').split('/'))), 'the details moved with it');
    });

    await t.test('a recording being played cannot be replaced: trim answers 409 and leaves the file whole', async () => {
      const made = json(await raw(port, { method: 'POST', path: '/api/baselines?name=CH12-06&folder=ch12', headers: WAV_H, body: paddedWav() }));
      const abs = path.join(libDir, ...made.file.split('/'));
      const before = await fsp.readFile(abs);
      const held = fs.openSync(abs, 'r'); // what the server holds while it streams the sloka to the player
      try {
        const r = await raw(port, { method: 'POST', path: `/api/baselines/${made.id}/trim` });
        if (process.platform === 'win32') {
          assert.equal(r.status, 409);
          assert.ok(/in use/.test(json(r).error), json(r).error);
          assert.ok(before.equals(await fsp.readFile(abs)), 'the recording is as it was');
        } else assert.equal(r.status, 200);
      } finally { fs.closeSync(held); }
      const again = await raw(port, { method: 'POST', path: `/api/baselines/${made.id}/trim` });
      assert.equal(again.status, 200);
      assert.equal(json(again).changed, process.platform === 'win32', 'once the hold is gone the trim goes through');
      assert.deepEqual(await temporaries(dir), []);
    });

    await t.test('a quiz written by a newer app is skipped with a line and refused on a change, never rewritten', async () => {
      const qid = '20260103-120000-dddd';
      const text = JSON.stringify({ schemaVersion: '2.0.0', id: qid, name: 'Future', items: [], attempts: [], later: true });
      await fsp.writeFile(path.join(dir, 'quizzes', `${qid}.json`), text);
      assert.ok(!json(await raw(port, { path: '/api/quizzes' })).some((q) => q.id === qid));
      const r = await raw(port, { method: 'PATCH', path: `/api/quizzes/${qid}`, headers: JSON_H, body: '{"name":"x"}' });
      assert.equal(r.status, 409);
      assert.ok(/newer SlokAbhyasa \(2\.0\.0\)/.test(json(r).error));
      assert.equal(await fsp.readFile(path.join(dir, 'quizzes', `${qid}.json`), 'utf8'), text, 'untouched');
      assert.ok(srv.output().includes(`${qid}.json skipped`));
    });

    await t.test('a transcript store that parses but holds no transcript is kept, not written over', async () => {
      const base = path.join(libDir, ...recA.file.replace(/\.wav$/, '').split('/'));
      await aged(`${base}.transcript.json`, '{}');
      await fsp.writeFile(`${base}.txt`, 'ये त्वक्षरमनिर्देश्यम्\n');
      const r = await raw(port, { path: `/api/baselines/${recA.id}/transcript` });
      assert.equal(r.status, 200);
      const folder = path.dirname(`${base}.txt`);
      assert.ok((await fsp.readdir(folder)).some((n) => n.includes('.transcript.json.broken-')), 'the empty store is kept beside');
      assert.ok(JSON.parse(await fsp.readFile(`${base}.transcript.json`, 'utf8')).languages, 'the store rebuilt from the text');
    });

    await t.test('a download the browser drops is not logged', async () => {
      await new Promise((resolve, reject) => {
        const sock = net.connect({ host: '127.0.0.1', port }, () => sock.write(`GET /js/app.js HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`));
        sock.once('data', () => { sock.destroy(); resolve(); });
        sock.once('error', reject);
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.ok(!srv.output().includes('sending a file'), srv.output());
    });

    await t.test('no temporary file is left anywhere in the data folder, and the console saw no 500', async () => {
      assert.deepEqual(await temporaries(dir), []);
      const errors = srv.output().split('\n').filter((l) => l.includes(' → '));
      assert.deepEqual(errors, [], 'no request ended in a 500');
    });
  } finally {
    await srv.stop();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('the server refuses to start, with a sentence, on a library it cannot read or one from a newer app', async () => {
  const asFolder = await fsp.mkdtemp(path.join(os.tmpdir(), 'slokabhyasa-nostart-'));
  const newer = await fsp.mkdtemp(path.join(os.tmpdir(), 'slokabhyasa-nostart-'));
  try {
    await fsp.mkdir(path.join(asFolder, 'library', 'index.json'), { recursive: true });
    const a = await failedStart(asFolder);
    assert.equal(a.code, 1);
    assert.ok(a.out.includes('SlokAbhyasa could not read its library:'), a.out);
    assert.ok(!a.out.includes('    at '), 'one sentence, no stack trace');
    await fsp.mkdir(path.join(newer, 'library'), { recursive: true });
    await fsp.writeFile(path.join(newer, 'library', 'index.json'), '{ "schemaVersion": "2.0.0", "records": [] }');
    const b = await failedStart(newer);
    assert.equal(b.code, 1);
    assert.ok(b.out.includes('newer SlokAbhyasa (2.0.0)'), b.out);
    assert.equal(await fsp.readFile(path.join(newer, 'library', 'index.json'), 'utf8'), '{ "schemaVersion": "2.0.0", "records": [] }', 'untouched');
  } finally {
    await fsp.rm(asFolder, { recursive: true, force: true });
    await fsp.rm(newer, { recursive: true, force: true });
  }
});
