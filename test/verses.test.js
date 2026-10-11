import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseVerseId, verseIdFor, defaultNameFor, defaultFolderFor, verseBody, normalizeVerseText, verseHashInput, compareVerseOrder, mapNameToVerse, combinedEntry, validateDataset, coverage } from '../js/verses.js';

const mini = JSON.parse(fs.readFileSync(new URL('./fixtures/reference/gita-mini/verses.json', import.meta.url), 'utf8'));
const miniManifest = JSON.parse(fs.readFileSync(new URL('./fixtures/reference/gita-mini/manifest.json', import.meta.url), 'utf8'));
const broken = JSON.parse(fs.readFileSync(new URL('./fixtures/reference/gita-broken/verses.json', import.meta.url), 'utf8'));

test('ids parse and print', () => {
  assert.deepEqual(parseVerseId('12.3'), { chapter: 12, verse: 3, verseEnd: null, kind: 'verse' });
  assert.deepEqual(parseVerseId('1.21-22'), { chapter: 1, verse: 21, verseEnd: 22, kind: 'combined' });
  assert.deepEqual(parseVerseId('12.colophon'), { chapter: 12, verse: null, verseEnd: null, kind: 'colophon' });
  assert.deepEqual(parseVerseId('dhyana.1'), { chapter: null, verse: 1, verseEnd: null, kind: 'dhyana' });
  assert.equal(parseVerseId('1.22-21'), null);
  assert.equal(parseVerseId('CH12-03'), null);
  assert.equal(parseVerseId(''), null);
  for (const id of ['12.3', '1.21-22', '12.colophon', '12.opening', 'dhyana.1']) assert.equal(verseIdFor(parseVerseId(id)), id);
});

test('default names and folders follow the user\'s CHnn-mm convention', () => {
  assert.equal(defaultNameFor('12.3'), 'CH12-03');
  assert.equal(defaultNameFor('1.21-22'), 'CH01-21-22');
  assert.equal(defaultNameFor('12.opening'), 'CH12-opening');
  assert.equal(defaultNameFor('12.colophon'), 'CH12-colophon');
  assert.equal(defaultNameFor('dhyana.1'), 'DHYANA-01');
  assert.equal(defaultNameFor({ id: '2.47' }), 'CH02-47', 'an entry works too');
  assert.equal(defaultFolderFor('12.3', ['CH-12', 'CH-18']), 'CH-12');
  assert.equal(defaultFolderFor('2.47', ['ch2', 'CH-12']), 'ch2', 'an existing folder naming the chapter is reused');
  assert.equal(defaultFolderFor('2.47', []), 'CH-02');
  assert.equal(defaultFolderFor('dhyana.1', ['dhyana']), 'dhyana');
  assert.equal(defaultFolderFor('dhyana.1', []), 'Dhyana');
});

test('the text a recording is made against, and its hash input, are stable', () => {
  const v = mini.verses.find((x) => x.id === '1.21');
  assert.equal(verseBody(v), 'अर्जुन उवाच\nहृषीकेशं तदा वाक्यमिदमाह महीपते ।\nसेनयोरुभयोर्मध्ये रथं स्थापय मेऽच्युत ॥');
  assert.equal(verseBody(v, { speakerLine: false }).split('\n').length, 2);
  assert.equal(normalizeVerseText('  क  ख \r\n\n ग  '), 'क ख\nग');
  assert.equal(normalizeVerseText('कर्मण्येवाधिकारस्ते'.normalize('NFD')), 'कर्मण्येवाधिकारस्ते');
  assert.equal(verseHashInput(v), verseHashInput({ ...v, deva: v.deva.map((l) => `  ${l}  `) }));
});

test('verses sort by chapter and verse, invocations first, colophons last', () => {
  const ids = ['12.colophon', '12.3', '2.5', '1.21-22', '1.21', 'dhyana.1', '12.opening', 'invocation.1'];
  assert.deepEqual(ids.slice().sort(compareVerseOrder), ['invocation.1', 'dhyana.1', '1.21', '1.21-22', '2.5', '12.opening', '12.3', '12.colophon']);
});

test('a name read back as a verse', () => {
  assert.deepEqual(mapNameToVerse('CH12-03', 'CH-12'), { id: '12.3', by: 'name' });
  assert.deepEqual(mapNameToVerse('ch12-7', ''), { id: '12.7', by: 'name' });
  assert.deepEqual(mapNameToVerse('Gita 18-66', 'CH-18'), { id: '18.66', by: 'name' });
  assert.deepEqual(mapNameToVerse('03', 'CH-12'), { id: '12.3', by: 'folder' });
  assert.deepEqual(mapNameToVerse('sloka 3', 'ch12'), { id: '12.3', by: 'folder' });
  assert.deepEqual(mapNameToVerse('Ch12-Starting', 'CH-12', new Set(['12.opening'])), { id: '12.opening', by: 'word' });
  assert.equal(mapNameToVerse('Ch12-Starting', 'CH-12', new Set(['12.3'])), null, 'the dataset has no opening: no guess');
  assert.deepEqual(mapNameToVerse('ch12-Closing', 'CH-12', new Set(['12.colophon'])), { id: '12.colophon', by: 'word' });
  assert.equal(mapNameToVerse('Gāyatrī', 'Mantras'), null);
  assert.equal(mapNameToVerse('99', 'CH-12'), null, 'past the chapter');
});

test('a combined verse composes from its parts, speaker lines kept', () => {
  const all = new Map(mini.verses.map((v) => [v.id, v]));
  assert.equal(combinedEntry(all, '1.21-22'), all.get('1.21-22'), 'the dataset\'s own entry when it has one');
  const byId = new Map(mini.verses.filter((v) => v.kind !== 'combined').map((v) => [v.id, v]));
  const c = combinedEntry(byId, '1.21-22');
  assert.equal(c.composed, true);
  assert.deepEqual(c.parts, ['1.21', '1.22']);
  assert.equal(c.deva.length, 4);
  assert.equal(c.speaker.deva, 'अर्जुन उवाच');
  assert.equal(c.translations.en.includes('Arjuna'), true);
  assert.equal(combinedEntry(byId, '1.22-23'), null, 'a missing part');
  assert.equal(combinedEntry(byId, '12.3'), null);
});

test('a sound dataset passes; a broken one is told what is wrong', () => {
  const ok = validateDataset(mini, { manifest: miniManifest });
  assert.deepEqual(ok.errors, []);
  assert.ok(ok.warnings.some((w) => /Gītā table/.test(w)), 'a partial dataset is warned about, not refused');
  const bad = validateDataset(broken, { manifest: miniManifest });
  const has = (re) => assert.ok(bad.errors.some((e) => re.test(e)), `expected an error matching ${re}; got ${JSON.stringify(bad.errors)}`);
  has(/12\.3: listed twice/);
  has(/2\.5: the speaker line is inside deva/);
  has(/1\.21-22: its part 1\.22 is missing/);
  has(/12\.colophon: kind verse does not match the id/);
  has(/chapter 12: 2 verses, the chapter says 5/);
  has(/9\.9: chapter 9 is not in chapters/);
  assert.deepEqual(validateDataset(null).errors, ['verses.json is not an object']);
});

test('coverage counts recorded verses per chapter, a combined recording covering its parts', () => {
  const index = [
    { id: 'a', verse: { dataset: 'gita', id: '12.3' } },
    { id: 'b', verse: { dataset: 'gita', id: '12.3' } },
    { id: 'c', verse: { dataset: 'gita', id: '1.21-22' } },
    { id: 'd', verse: { dataset: 'gita', id: '12.colophon' } },
    { id: 'e', verse: { dataset: 'other', id: '2.5' } },
    { id: 'f' },
  ];
  const c = coverage(mini, index);
  assert.equal(c.total, 4);
  assert.equal(c.recorded, 3);
  assert.deepEqual(c.byChapter[12], { total: 1, recorded: 1, extras: 1 });
  assert.deepEqual(c.byChapter[1], { total: 2, recorded: 2, extras: 0 });
  assert.deepEqual(c.byChapter[2], { total: 1, recorded: 0, extras: 0 });
  assert.deepEqual(c.byKind.colophon, { total: 1, recorded: 1 });
});
