import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  writeFileAtomic, writeFileAtomicSync, writeJsonAtomic, writeJsonAtomicSync, copyFileAtomic,
  readJsonFile, readJsonFileSync, parseJsonValue, indexFromJson, readLibraryIndex, readLibraryIndexSync,
  writeLibraryIndex, writeLibraryIndexSync, sweepTemp, serverRunning, stamp, tempName, brokenName, isTempName,
  INDEX_VERSION, TEMP_MAX_AGE_MS,
} from '../datafile.js';

const scratch = () => fsp.mkdtemp(path.join(os.tmpdir(), 'slokabhyasa-datafile-'));
const names = async (dir) => (await fsp.readdir(dir)).sort();
const noTemporaries = async (dir) => assert.deepEqual((await names(dir)).filter(isTempName), [], 'no temporary file is left behind');
const quiet = async (fn) => { const warn = console.warn; const log = console.log; const lines = []; console.warn = (s) => lines.push(s); console.log = (s) => lines.push(s); try { return [await fn(), lines]; } finally { console.warn = warn; console.log = log; } };

test('a save leaves the content and no temporary file in the folder', async () => {
  const dir = await scratch();
  try {
    const f = path.join(dir, 'profiles.json');
    await writeFileAtomic(f, 'first\n');
    assert.equal(await fsp.readFile(f, 'utf8'), 'first\n');
    await writeFileAtomic(f, Buffer.from('second\n'));
    assert.equal(await fsp.readFile(f, 'utf8'), 'second\n');
    writeFileAtomicSync(f, 'third\n');
    assert.equal(await fsp.readFile(f, 'utf8'), 'third\n');
    await writeJsonAtomic(f, { a: 1 });
    assert.equal(await fsp.readFile(f, 'utf8'), '{\n  "a": 1\n}\n', 'pretty, with a trailing newline, as a person opens it');
    writeJsonAtomicSync(f, { a: 2 }, { compact: true });
    assert.equal(await fsp.readFile(f, 'utf8'), '{"a":2}', 'compact when asked, as the ear logs and transcripts are');
    await noTemporaries(dir);
    assert.deepEqual(await names(dir), ['profiles.json']);
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('two saves of 1 MB started together leave one whole payload, never a mix, and no temporary', async () => {
  const dir = await scratch();
  try {
    const f = path.join(dir, 'big.json');
    const a = 'a'.repeat(1e6);
    const b = 'b'.repeat(1e6);
    await Promise.all([writeFileAtomic(f, a), writeFileAtomic(f, b)]);
    const got = await fsp.readFile(f, 'utf8');
    assert.ok(got === a || got === b, 'the file is one save or the other, whole');
    await noTemporaries(dir);
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('a save that cannot finish leaves the old file untouched and removes its temporary', async () => {
  const dir = await scratch();
  try {
    const f = path.join(dir, 'kept.json');
    await writeFileAtomic(f, 'old\n');
    // the target is now a folder, so the rename over it is refused
    await fsp.rm(f);
    await fsp.mkdir(f);
    await fsp.writeFile(path.join(f, 'inside'), 'x');
    await assert.rejects(writeFileAtomic(f, 'new\n'));
    assert.ok((await fsp.stat(f)).isDirectory(), 'the folder in the file\'s place is still there');
    await noTemporaries(dir);
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('a damaged JSON file is renamed .broken-… with its bytes intact, and the read says so', async () => {
  const dir = await scratch();
  try {
    const f = path.join(dir, 'ch12-03.json');
    await fsp.writeFile(f, '{"name": "CH12-03", "spe');
    const [r, lines] = await quiet(() => readJsonFile(f));
    assert.equal(r.value, null);
    assert.ok(/\.broken-\d{8}-\d{6}$/.test(r.broken), r.broken);
    assert.equal(await fsp.readFile(r.broken, 'utf8'), '{"name": "CH12-03", "spe', 'the bytes are kept for a person');
    assert.ok(!fs.existsSync(f), 'nothing is recreated in its place');
    assert.equal(lines.length, 1, 'one console line names the file and where it went');
    assert.ok(lines[0].includes(path.basename(r.broken)));
    // the sync twin, on a file holding a bare number
    const g = path.join(dir, 'number.json');
    await fsp.writeFile(g, '42');
    const [s] = await quiet(() => readJsonFileSync(g));
    assert.equal(s.value, null);
    assert.equal(await fsp.readFile(s.broken, 'utf8'), '42');
    // and on a string, and on null
    await fsp.writeFile(g, '"text"');
    assert.notEqual((await quiet(() => readJsonFile(g)))[0].broken, null);
    await fsp.writeFile(g, 'null');
    assert.notEqual((await quiet(() => readJsonFile(g)))[0].broken, null);
    assert.equal((await names(dir)).filter((n) => n.includes('.broken-')).length, 4, 'four quarantines, none overwriting another');
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('a sound JSON file reads as its value; a byte-order mark from Notepad is not damage', async () => {
  const dir = await scratch();
  try {
    const f = path.join(dir, 'profiles.json');
    await fsp.writeFile(f, '\uFEFF{ "schemaVersion": "1.0.0", "profiles": [] }');
    assert.deepEqual(await readJsonFile(f), { value: { schemaVersion: '1.0.0', profiles: [] }, broken: null });
    assert.deepEqual(readJsonFileSync(f), { value: { schemaVersion: '1.0.0', profiles: [] }, broken: null });
    assert.deepEqual(parseJsonValue('[1, 2]'), [1, 2]);
    assert.equal(parseJsonValue('1'), undefined);
    assert.equal(parseJsonValue('{'), undefined);
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('a missing file returns nulls without creating anything', async () => {
  const dir = await scratch();
  try {
    const f = path.join(dir, 'badges.json');
    assert.deepEqual(await readJsonFile(f), { value: null, broken: null });
    assert.deepEqual(readJsonFileSync(f), { value: null, broken: null });
    assert.deepEqual(await names(dir), []);
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('a folder in the file\'s place makes the read throw: not an empty file, not damage', async () => {
  const dir = await scratch();
  try {
    const f = path.join(dir, 'index.json');
    await fsp.mkdir(f);
    await assert.rejects(readJsonFile(f));
    assert.throws(() => readJsonFileSync(f));
    assert.deepEqual(await names(dir), ['index.json'], 'nothing was renamed');
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('a copy is whole or absent, never partial', async () => {
  const dir = await scratch();
  try {
    const from = path.join(dir, 'take.wav');
    const to = path.join(dir, 'backup', 'take.wav');
    await fsp.writeFile(from, Buffer.alloc(300000, 7));
    await fsp.mkdir(path.dirname(to));
    await copyFileAtomic(from, to);
    assert.equal((await fsp.stat(to)).size, 300000);
    await assert.rejects(copyFileAtomic(path.join(dir, 'missing.wav'), path.join(dir, 'backup', 'other.wav')));
    assert.deepEqual(await names(path.join(dir, 'backup')), ['take.wav'], 'a failed copy leaves nothing, not even a temporary');
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('the start-up sweep removes a temporary dated two minutes ago and leaves one dated now', async () => {
  const dir = await scratch();
  try {
    await fsp.mkdir(path.join(dir, 'library', 'ch12'), { recursive: true });
    await fsp.mkdir(path.join(dir, 'elsewhere'), { recursive: true });
    const old = path.join(dir, 'library', 'ch12', 'x.json.tmp-123-abc123');
    const fresh = path.join(dir, 'profiles.json.tmp-1-zzzzzz');
    const notOurs = path.join(dir, 'elsewhere', 'y.json.tmp-9-aaaaaa');
    const plain = path.join(dir, 'library', 'index.json');
    for (const f of [old, fresh, notOurs, plain]) await fsp.writeFile(f, 'x');
    const twoMinutesAgo = new Date(Date.now() - 2 * TEMP_MAX_AGE_MS);
    await fsp.utimes(old, twoMinutesAgo, twoMinutesAgo);
    await fsp.utimes(notOurs, twoMinutesAgo, twoMinutesAgo);
    const [removed, lines] = await quiet(() => sweepTemp(dir));
    assert.equal(removed, 1);
    assert.equal(lines.length, 1);
    assert.ok(!fs.existsSync(old), 'the old temporary under the library is gone');
    assert.ok(fs.existsSync(fresh), 'a temporary a save may still be writing is left');
    assert.ok(fs.existsSync(notOurs), 'a folder that is not the data folder\'s own is not walked');
    assert.ok(fs.existsSync(plain));
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('indexFromJson: a plain list, the object form, junk', () => {
  const recs = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  assert.deepEqual(indexFromJson(recs), recs);
  assert.deepEqual(indexFromJson({ schemaVersion: '1.0.0', records: recs }), recs);
  assert.deepEqual(indexFromJson([{ id: 'a' }, 3, null, 'x', [1]]), [{ id: 'a' }], 'entries that are not records are dropped');
  assert.equal(indexFromJson({ records: 'no' }), null);
  assert.equal(indexFromJson({ schemaVersion: '1.0.0' }), null);
  assert.equal(indexFromJson(null), null);
  assert.equal(indexFromJson(7), null);
});

test('the index loader reads the old plain list as 1.0.0 and the new object form alike; a file in neither form is quarantined', async () => {
  const dir = await scratch();
  try {
    const f = path.join(dir, 'index.json');
    const recs = [{ id: '20260101-120000-abcd', name: 'CH12-03', file: 'ch12/ch12-03-20260101-120000-abcd.wav' }];
    await fsp.writeFile(f, `${JSON.stringify(recs, null, 2)}\n`);
    const legacy = await readLibraryIndex(f);
    assert.deepEqual(legacy, { records: recs, version: INDEX_VERSION, legacy: true, broken: null });
    assert.deepEqual(readLibraryIndexSync(f), legacy);
    await writeLibraryIndex(f, legacy.records);
    const raw = JSON.parse(await fsp.readFile(f, 'utf8'));
    assert.deepEqual(Object.keys(raw), ['schemaVersion', 'records'], 'the version comes first');
    assert.equal(raw.schemaVersion, INDEX_VERSION);
    const fresh = await readLibraryIndex(f);
    assert.deepEqual(fresh, { records: recs, version: INDEX_VERSION, legacy: false, broken: null });
    writeLibraryIndexSync(f, []);
    assert.deepEqual(readLibraryIndexSync(f).records, []);
    // missing: empty, nothing made
    await fsp.rm(f);
    assert.deepEqual(await readLibraryIndex(f), { records: [], version: INDEX_VERSION, legacy: false, broken: null });
    assert.ok(!fs.existsSync(f));
    // parsable but neither form: quarantined, the bytes kept
    await fsp.writeFile(f, '{ "items": [] }');
    const [odd] = await quiet(() => readLibraryIndex(f));
    assert.deepEqual(odd.records, []);
    assert.ok(odd.broken && odd.broken.includes('.broken-'), odd.broken);
    assert.equal(await fsp.readFile(odd.broken, 'utf8'), '{ "items": [] }');
    await fsp.writeFile(f, '[1');
    const [bad] = await quiet(() => readLibraryIndexSync(f));
    assert.ok(bad.broken, 'the sync twin quarantines too');
    assert.ok(!fs.existsSync(f));
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('the forms of a temporary name, a quarantine name and the stamp', () => {
  const at = new Date(2026, 10, 3, 7, 15, 30); // 3 November 2026, 07:15:30 local time
  assert.equal(stamp(at), '20261103-071530');
  assert.equal(brokenName('C:\\data\\profiles.json', at), 'C:\\data\\profiles.json.broken-20261103-071530');
  assert.equal(tempName('/data/index.json', { pid: 4242, rand: 'abc123' }), '/data/index.json.tmp-4242-abc123');
  const t = tempName('x.json');
  assert.ok(/^x\.json\.tmp-\d+-[a-z0-9]{6}$/.test(t), t);
  assert.ok(isTempName(path.basename(t)));
  assert.ok(!isTempName('ch12-03.json'));
  assert.ok(!isTempName('ch12-03.json.broken-20261103-071530'));
  assert.ok(!/\.(wav|json)$/i.test(t), 'no listing of WAVs or JSON files picks a temporary up');
});

test('serverRunning: true while something listens on the port, false once it has closed', async () => {
  const srv = net.createServer();
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  try {
    assert.equal(await serverRunning(port), true);
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
  assert.equal(await serverRunning(port), false);
});
