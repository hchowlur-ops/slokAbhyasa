import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseVerseId, verseIdFor, defaultNameFor, defaultFolderFor, verseBody, normalizeVerseText, verseHashInput, compareVerseOrder, mapNameToVerse, combinedEntry, validateDataset, coverage, verseLink, linkHashInput, sanitizeCustom, mergeCustom, verseTranscript, heardTranscript, versePlan } from '../js/verses.js';

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

test('the link a recording keeps to a verse copies the text and hashes the same as the entry', () => {
  const v = mini.verses.find((x) => x.id === '1.21');
  const link = verseLink(v, { dataset: 'gita', datasetVersion: '0.0.1', mappedBy: 'learn', licence: 'MIT' });
  assert.equal(link.id, '1.21');
  assert.deepEqual([link.chapter, link.verse, link.verseEnd, link.kind], [1, 21, null, 'verse']);
  assert.equal(link.speakerLineRecited, true);
  assert.equal(link.text.speaker, 'अर्जुन उवाच');
  assert.deepEqual(link.text.deva, v.deva);
  assert.deepEqual(link.metre, { family: 'anushtubh', name: 'anuṣṭubh' });
  assert.equal(link.mappedBy, 'learn');
  assert.equal(linkHashInput(link), verseHashInput(v));
  const bare = verseLink(v, { dataset: 'gita', speakerLineRecited: false });
  assert.equal(bare.speakerLineRecited, false, 'the line was not recited');
  assert.equal(linkHashInput(bare), verseHashInput(v), 'the copy keeps the line all the same');
  const colophon = verseLink(mini.verses.find((x) => x.id === '12.colophon'), { dataset: 'gita' });
  assert.deepEqual([colophon.kind, colophon.verse, colophon.metre, colophon.speakerLineRecited], ['colophon', null, null, false]);
});

test('customisations are cleaned and laid over the entry', () => {
  assert.equal(sanitizeCustom(null), null);
  assert.equal(sanitizeCustom({ deva: [], notes: '  ', translations: { en: '' }, junk: 1 }), null);
  const c = sanitizeCustom({ deva: [' ये त्वक्षरम् अनिर्देश्यम् ', '', 'सर्वत्रगम् ॥'], translations: { kn: 'ಅರ್ಥ', EN: 'x', en: ' meaning ' }, notes: 'a note', speaker: { who: 'krishna', deva: 'x' }, variants: [{ text: 'v', line: 1 }, { nope: 1 }] });
  assert.deepEqual(c.deva, ['ये त्वक्षरम् अनिर्देश्यम्', 'सर्वत्रगम् ॥']);
  assert.deepEqual(c.translations, { kn: 'ಅರ್ಥ', en: 'meaning' });
  assert.equal(c.notes, 'a note');
  assert.deepEqual(c.speaker, { who: 'krishna', deva: 'x' });
  assert.equal(c.variants.length, 1);
  const v = mini.verses.find((x) => x.id === '12.3');
  const m = mergeCustom(v, c);
  assert.equal(m.customised, true);
  assert.deepEqual(m.deva, c.deva);
  assert.equal(m.translations.kn, 'ಅರ್ಥ');
  assert.equal(m.translations.en, 'meaning', 'a custom translation replaces the dataset\'s');
  assert.equal(m.iast, v.iast, 'untouched fields stay');
  assert.equal(mergeCustom(v, null).customised, false);
});

test('a linked recording\'s transcript is the verse\'s lines with the hearing\'s timings, and the hearing comes back on unlink', () => {
  const v = mini.verses.find((x) => x.id === '1.21');
  const heard = { language: 'sanskrit', tier: 'best', text: 'अर्जुन उवाच हृषीकेशम् तदा वाक्यमिदमाह महीपते सेनयोरुभयोर्मध्ये रथम् स्थापय मेऽच्युत', chunks: [{ text: 'अर्जुन उवाच हृषीकेशम् तदा', start: 1.0, end: 4.0 }, { text: 'वाक्यमिदमाह महीपते सेनयोरुभयोर्मध्ये रथम् स्थापय मेऽच्युत', start: 4.0, end: 11.0 }] };
  const t = verseTranscript(v, { speakerLine: true, previous: heard });
  assert.equal(t.from, 'reference');
  assert.equal(t.verse, '1.21');
  assert.equal(t.tier, 'best');
  assert.deepEqual(t.chunks.map((c) => c.text), ['अर्जुन उवाच', ...v.deva]);
  assert.equal(t.chunks[0].start, 1);
  assert.equal(t.chunks[t.chunks.length - 1].end, 11);
  assert.ok(t.chunks[0].end < t.chunks[1].start + 0.01 && t.chunks[0].end - t.chunks[0].start < t.chunks[1].end - t.chunks[1].start, 'the short speaker line takes a short span');
  assert.equal(t.heard.text, heard.text);
  const back = heardTranscript(t);
  assert.equal(back.text, heard.text);
  assert.equal(back.chunks.length, 2);
  assert.equal(back.from, undefined);
  const bare = verseTranscript(v, { speakerLine: false, previous: null });
  assert.deepEqual(bare.chunks, []);
  assert.equal(bare.text, v.deva.join(' '));
  assert.equal(heardTranscript(bare), null);
  const again = verseTranscript(v, { previous: t });
  assert.equal(again.heard.text, heard.text, 'redoing the words keeps the hearing');
});

test('versePlan: a verse\'s akṣara plan by its metre, without the speaker line when not recited, the custom file\'s when it has one', () => {
  const byId = new Map(mini.verses.map((v) => [v.id, v]));
  const p = versePlan(byId.get('12.3'));
  assert.deepEqual(p.padas, [8, 8, 8, 8]);
  assert.equal(p.total, 32 + p.speakerLine);
  const t = versePlan(byId.get('2.5'));
  assert.deepEqual(t.padas, [11, 11, 11, 11]);
  const withSpeaker = mini.verses.find((v) => v.speaker && v.speaker.deva);
  if (withSpeaker) {
    const a = versePlan(withSpeaker, { speakerLine: true });
    const b = versePlan(withSpeaker, { speakerLine: false });
    assert.ok(a.speakerLine > 0 && b.speakerLine === 0 && a.total === b.total + a.speakerLine);
  }
  const custom = sanitizeCustom({ aksharaPlan: { speakerLine: 0, padas: [8, 8, 10, 10] } });
  assert.deepEqual(custom.aksharaPlan, { speakerLine: 0, padas: [8, 8, 10, 10] });
  const merged = mergeCustom(byId.get('12.3'), custom);
  const cp = versePlan(merged);
  assert.deepEqual(cp.padas, [8, 8, 10, 10]);
  assert.equal(cp.custom, true);
  assert.deepEqual(cp.checkpoints, [8, 16, 26, 36]);
  assert.equal(sanitizeCustom({ aksharaPlan: { padas: [] } }), null, 'an empty plan is no plan');
  assert.equal(sanitizeCustom({ aksharaPlan: { padas: [0, -1, 'x'] } }), null);
});
