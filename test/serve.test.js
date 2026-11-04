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
const wavBytes = () => { const u8 = encodeWavBytes(tone(), 16000); return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength); };

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
  await fsp.writeFile(path.join(dir, 'profiles.json'), '{"schemaVersion": "1.0.0", "profiles": [{"id": "p-1", "name": "An');
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

    await t.test('no temporary file is left anywhere in the data folder', async () => {
      assert.deepEqual(await temporaries(dir), []);
    });
  } finally {
    await srv.stop();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
