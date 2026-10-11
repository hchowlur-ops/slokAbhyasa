import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDataset, initReference, dataset, datasets, verse, verseHash, chapter, coverage } from '../reference.js';
import { resolveReferenceDirs } from '../datadir.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'reference');

test('a sound dataset loads with its verses indexed; a broken one is listed with its errors', () => {
  const ok = loadDataset(path.join(FIX, 'gita-mini'));
  assert.equal(ok.id, 'gita');
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.data.verses.length, 6);
  assert.equal(ok.byId.get('12.3').speaker.who, 'krishna');
  assert.match(ok.hashById.get('12.3'), /^[0-9a-f]{64}$/);
  const bad = loadDataset(path.join(FIX, 'gita-broken'));
  assert.equal(bad.data, null);
  assert.ok(bad.errors.length >= 5);
  const none = loadDataset(path.join(FIX, 'nowhere'));
  assert.match(none.errors[0], /manifest\.json/);
});

test('the search dirs: the first manifest of an id wins, and a changed manifest reloads', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slokabhyasa-ref-'));
  const mine = path.join(tmp, 'reference', 'gita');
  fs.cpSync(path.join(FIX, 'gita-mini'), mine, { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(mine, 'manifest.json'), 'utf8'));
  m.name = 'the data folder copy';
  fs.writeFileSync(path.join(mine, 'manifest.json'), JSON.stringify(m));
  const map = initReference([path.join(tmp, 'reference'), FIX]);
  assert.equal(map.get('gita').manifest.name, 'the data folder copy', 'the data folder beats the app folder');
  assert.deepEqual(datasets().map((d) => d.id), ['gita']);
  // a manifest edited on disk is picked up on the next look
  m.name = 'edited';
  const later = new Date(Date.now() + 5000);
  fs.writeFileSync(path.join(mine, 'manifest.json'), JSON.stringify(m));
  fs.utimesSync(path.join(mine, 'manifest.json'), later, later);
  assert.equal(dataset('gita').manifest.name, 'edited');
  assert.equal(dataset('none'), null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('verses, composed combined verses, chapters and coverage', () => {
  initReference([FIX]);
  const ds = dataset('gita');
  assert.equal(verse(ds, '12.3').deva.length, 2);
  assert.equal(verse(ds, '1.21-22').kind, 'combined', 'the fixture has its own combined entry');
  assert.equal(verse(ds, '1.21-22').composed, undefined);
  assert.equal(verse(ds, '12.9'), null);
  assert.equal(verseHash(ds, '12.3'), ds.hashById.get('12.3'));
  const ch = chapter(ds, 12);
  assert.equal(ch.name.deva, 'भक्तियोग');
  assert.deepEqual(ch.entries.map((e) => e.id), ['12.3', '12.colophon']);
  assert.equal(chapter(ds, 7), null);
  const cov = coverage(ds, [{ id: 'a', verse: { dataset: 'gita', id: '2.5' } }]);
  assert.equal(cov.recorded, 1);
  assert.equal(cov.byChapter[2].recorded, 1);
});

test('resolveReferenceDirs: the data folder first, the app folder second, once when they are one', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dirs = resolveReferenceDirs(root);
  assert.ok(dirs.length >= 1 && dirs.length <= 2);
  assert.equal(dirs[dirs.length - 1], path.join(root, 'reference'));
  assert.equal(new Set(dirs.map((d) => path.resolve(d))).size, dirs.length);
});
