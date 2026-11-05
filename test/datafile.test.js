import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  writeFileAtomic, writeFileAtomicSync, writeJsonAtomic, writeJsonAtomicSync, copyFileAtomic, renameFile, quarantineFile,
  readJsonFile, readJsonFileSync, parseJsonValue, indexFromJson, readLibraryIndex, readLibraryIndexSync,
  writeLibraryIndex, writeLibraryIndexSync, sweepTemp, serverRunning, stamp, tempName, brokenName, isTempName,
  majorOf, versionTooNew, higherVersion, FileHeldError, NewerFileError,
  INDEX_VERSION, TEMP_MAX_AGE_MS, FRESH_MS,
} from '../datafile.js';

const scratch = () => fsp.mkdtemp(path.join(os.tmpdir(), 'slokabhyasa-datafile-'));
const names = async (dir) => (await fsp.readdir(dir)).sort();
// A damaged file written a moment ago reads as "still being written"; the cases that expect
// a quarantine age the file first, as a file damaged long ago would be.
const aged = async (file, content) => { await fsp.writeFile(file, content); const old = new Date(Date.now() - 2 * FRESH_MS); await fsp.utimes(file, old, old); };
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
    await aged(f, '{"name": "CH12-03", "spe');
    const [r, lines] = await quiet(() => readJsonFile(f));
    assert.equal(r.value, null);
    assert.ok(/\.broken-\d{8}-\d{6}$/.test(r.broken), r.broken);
    assert.equal(await fsp.readFile(r.broken, 'utf8'), '{"name": "CH12-03", "spe', 'the bytes are kept for a person');
    assert.ok(!fs.existsSync(f), 'nothing is recreated in its place');
    assert.equal(lines.length, 1, 'one console line names the file and where it went');
    assert.ok(lines[0].includes(path.basename(r.broken)));
    // the sync twin, on a file holding a bare number
    const g = path.join(dir, 'number.json');
    await aged(g, '42');
    const [s] = await quiet(() => readJsonFileSync(g));
    assert.equal(s.value, null);
    assert.equal(await fsp.readFile(s.broken, 'utf8'), '42');
    // and on a string, and on null
    await aged(g, '"text"');
    assert.notEqual((await quiet(() => readJsonFile(g)))[0].broken, null);
    await aged(g, 'null');
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
    // a file of the wrong shape (a list where details are expected) is damage too
    const g = path.join(dir, 'ch12-03.json');
    await aged(g, '[]');
    assert.deepEqual(await readJsonFile(g, { expect: 'list' }), { value: [], broken: null });
    const [wrong] = await quiet(() => readJsonFile(g, { expect: 'object' }));
    assert.equal(wrong.value, null);
    assert.equal(await fsp.readFile(wrong.broken, 'utf8'), '[]');
    await aged(g, '{}');
    const [wrongSync] = await quiet(() => readJsonFileSync(g, { expect: 'list' }));
    assert.ok(wrongSync.broken);
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('an unreadable file that changed a moment ago is read again, then refused, never renamed: another program may be writing it', async () => {
  const dir = await scratch();
  try {
    const f = path.join(dir, 'profiles.json');
    await fsp.writeFile(f, '{"schemaVersion": "1.0.0", "profi');
    const t0 = performance.now();
    await assert.rejects(readJsonFile(f), (err) => err.code === 'EFRESH' && /still be being written/.test(err.message));
    assert.ok(performance.now() - t0 >= 150, 'it waited for a second read');
    assert.throws(() => readJsonFileSync(f), (err) => err.code === 'EFRESH');
    assert.deepEqual(await names(dir), ['profiles.json'], 'nothing renamed, nothing made');
    // a 0-byte file the same, while fresh; an old one is damage like any other
    const g = path.join(dir, 'badges.json');
    await fsp.writeFile(g, '');
    await assert.rejects(readJsonFile(g), (err) => err.code === 'EFRESH');
    await aged(g, '');
    const [r] = await quiet(() => readJsonFile(g));
    assert.ok(r.broken, 'an empty file from long ago is quarantined');
    // a file completed between the first and the second read is read
    const h = path.join(dir, 'late.json');
    await fsp.writeFile(h, '{"a":');
    const read = readJsonFile(h);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await fsp.writeFile(h, '{"a": 1}');
    assert.deepEqual(await read, { value: { a: 1 }, broken: null });
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('a file written by a newer app, by its major version, is neither read nor rewritten; a later minor is read', async () => {
  const dir = await scratch();
  try {
    const f = path.join(dir, 'ch12-03.json');
    await fsp.writeFile(f, '{ "schemaVersion": "2.0.0", "name": "x" }');
    await assert.rejects(readJsonFile(f, { expect: 'object', known: '1.1.0' }), (err) => err instanceof NewerFileError && /newer SlokAbhyasa \(2\.0\.0\)/.test(err.message));
    assert.throws(() => readJsonFileSync(f, { expect: 'object', known: '1.1.0' }), NewerFileError);
    assert.deepEqual(await names(dir), ['ch12-03.json'], 'kept as it is');
    await fsp.writeFile(f, '{ "schemaVersion": "1.3.0", "name": "x" }');
    assert.equal((await readJsonFile(f, { expect: 'object', known: '1.1.0' })).value.name, 'x');
    assert.equal((await readJsonFile(f, { expect: 'object' })).value.name, 'x', 'no known version: no check');
    const idx = path.join(dir, 'index.json');
    await fsp.writeFile(idx, '{ "schemaVersion": "2.0.0", "records": [] }');
    await assert.rejects(readLibraryIndex(idx), NewerFileError);
    assert.throws(() => readLibraryIndexSync(idx), NewerFileError);
    assert.ok(fs.existsSync(idx));
    // the helpers
    assert.equal(majorOf('2.0.0'), 2);
    assert.equal(majorOf(undefined), 1, 'no version is the first version');
    assert.equal(majorOf('junk'), 1);
    assert.equal(versionTooNew('2.0.0', '1.0.0'), true);
    assert.equal(versionTooNew('1.9.0', '1.0.0'), false);
    assert.equal(versionTooNew(undefined, '1.0.0'), false);
    assert.equal(higherVersion('1.0.0', '1.2.0'), '1.2.0', 'a later minor of the same major is kept');
    assert.equal(higherVersion('1.1.0', '1.0.0'), '1.1.0');
    assert.equal(higherVersion('1.0.0', undefined), '1.0.0');
    assert.equal(higherVersion('1.0.0', '0.9.0'), '1.0.0', 'another major: the known one');
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('a rename refused by a hold on the target fails after the retries with FileHeldError, the old file whole; quarantineFile is the reader\'s quarantine', async () => {
  const dir = await scratch();
  try {
    const f = path.join(dir, 'take.wav');
    await fsp.writeFile(f, 'old');
    const held = fs.openSync(f, 'r'); // what the server holds while it streams a recording
    try {
      // Windows refuses to replace an open file; elsewhere the rename goes through
      if (process.platform === 'win32') {
        const t0 = performance.now();
        await assert.rejects(writeFileAtomic(f, 'new'), (err) => err instanceof FileHeldError && err.file === f);
        assert.ok(performance.now() - t0 >= 200, 'the five tries were made');
        assert.equal(await fsp.readFile(f, 'utf8'), 'old');
        await noTemporaries(dir);
        await assert.rejects(renameFile(path.join(dir, 'other'), f).catch(async (err) => { if (err.code === 'ENOENT') throw new FileHeldError(f, err); throw err; }), FileHeldError);
      } else {
        await writeFileAtomic(f, 'new');
        assert.equal(await fsp.readFile(f, 'utf8'), 'new');
      }
    } finally { fs.closeSync(held); }
    await writeFileAtomic(f, 'newer');
    assert.equal(await fsp.readFile(f, 'utf8'), 'newer', 'once the hold is gone the save goes through');
    const g = path.join(dir, 'shape.json');
    await fsp.writeFile(g, '{ "profiles": "x" }');
    const [broken] = await quiet(() => quarantineFile(g, { why: 'is not a profiles file' }));
    assert.ok(broken.includes('.broken-') && !fs.existsSync(g));
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
    await aged(f, '{ "items": [] }');
    const [odd] = await quiet(() => readLibraryIndex(f));
    assert.deepEqual(odd.records, []);
    assert.ok(odd.broken && odd.broken.includes('.broken-'), odd.broken);
    assert.equal(await fsp.readFile(odd.broken, 'utf8'), '{ "items": [] }');
    await aged(f, '[1');
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
