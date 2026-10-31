import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHRASES, phraseOfWords, phraseOfText, attributionSpan, templateFrom, packTemplate, unpackTemplate, emptyStore, addTemplate, templateCount, findSpeakerLines, assignSpeakerLines, signatureKeys, signatureCount, twoPassMarkers } from '../js/dsp/speakerlines.js';
import { N_MFCC } from '../js/dsp/features.js';

test('phraseOfWords: the four speaker lines in Devanagari, IAST and a recogniser\'s spelling; a sloka without one', () => {
  assert.equal(PHRASES.length, 4);
  assert.deepEqual(phraseOfWords(['धृतराष्ट्र', 'उवाच', 'धर्मक्षेत्रे']), { phrase: 'dhrtarastra', words: 2 });
  assert.deepEqual(phraseOfWords(['सञ्जय', 'उवाच', 'दृष्ट्वा']), { phrase: 'sanjaya', words: 2 });
  assert.deepEqual(phraseOfWords(['arjuna', 'uvāca', 'dṛṣṭvemaṃ']), { phrase: 'arjuna', words: 2 });
  assert.deepEqual(phraseOfWords(['श्रीभगवानुवाच', 'पश्य']), { phrase: 'sribhagavan', words: 1 });
  assert.deepEqual(phraseOfWords(['श्री', 'भगवानु', 'वाच्छ', 'पश्य']), { phrase: 'sribhagavan', words: 3 });
  assert.equal(phraseOfWords(['तमुवाच', 'हृषीकेशः']), null, 'the sloka\'s own first word');
  assert.equal(phraseOfText('धर्मक्षेत्रे कुरुक्षेत्रे समवेता युयुत्सवः'), null);
  assert.equal(phraseOfText('सञ्जय उवाच\nदृष्ट्वा तु पाण्डवानीकं').phrase, 'sanjaya');
});

test('attributionSpan: the line\'s words among the first tokens of a hearing, and their chunk times', () => {
  const chunks = [{ text: 'किमकुर्वत सञ्जय', start: 17.0, end: 19.1 }, { text: 'सञ्जय उवाच', start: 19.2, end: 21.0 }, { text: 'दृष्ट्वा तु', start: 21.2, end: 22.5 }];
  const tokens = [{ word: 'किमकुर्वत', chunk: 0 }, { word: 'सञ्जय', chunk: 0 }, { word: 'सञ्जय', chunk: 1 }, { word: 'उवाच', chunk: 1 }, { word: 'दृष्ट्वा', chunk: 2 }, { word: 'तु', chunk: 2 }];
  // the window began with the previous sloka's tail: the attribution is found two words in
  assert.deepEqual(attributionSpan(tokens, chunks), { phrase: 'sanjaya', from: 19.2, to: 21.0 });
  assert.equal(attributionSpan(tokens.slice(4), chunks), null, 'no attribution');
  assert.deepEqual(attributionSpan(tokens.slice(2), null), { phrase: 'sanjaya', from: null, to: null }, 'no chunk times');
});

// A synthetic take: distinct 12-vectors held 5 frames each; a pattern is a fixed run of 12
// sounds (1.2 s) from a seed, placed where asked (a number: the seed 99), with a second of
// quiet before it; everything else random.
function synth(places, { seconds = 40, hop = 0.02 } = {}) {
  const n = Math.round(seconds / hop);
  const mfcc = new Float32Array(n * N_MFCC);
  const rmsDb = new Float32Array(n).fill(-30);
  for (let k = 0; k < n; k++) if (k < Math.round(2 / hop) || k > n - Math.round(2 / hop)) rmsDb[k] = -60; // two seconds of room at either end
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
  const vec = () => Float32Array.from({ length: N_MFCC }, () => rnd() * 20);
  for (let k = 0; k < n; k += 5) { const v = vec(); for (let j = k; j < Math.min(n, k + 5); j++) mfcc.set(v, j * N_MFCC); }
  const patterns = new Map();
  const patternOf = (sd) => { if (!patterns.has(sd)) { seed = sd; patterns.set(sd, Array.from({ length: 12 }, () => vec())); } return patterns.get(sd); }; // 60 frames = 1.2 s
  for (const place of places) {
    const at = typeof place === 'number' ? place : place.at;
    const phrase = patternOf(typeof place === 'number' ? 99 : place.seed);
    const f0 = Math.round(at / hop);
    for (let k = f0 - 50; k < f0; k++) if (k >= 0) rmsDb[k] = -60; // a second of quiet before
    phrase.forEach((v, i) => { for (let j = 0; j < 5; j++) if (f0 + i * 5 + j < n) mfcc.set(v, (f0 + i * 5 + j) * N_MFCC); });
  }
  return { n, hopSec: hop, mfcc, mfccMean: new Float32Array(N_MFCC), rmsDb };
}

test('templates: taken from a take, packed to text and back, kept per phrase newest first and capped', () => {
  const F = synth([5]);
  const t = templateFrom(F, 5, 6.2);
  assert.equal(t.frames, 60);
  const packed = packTemplate(t, { at: 5, session: 's1' });
  const rows = unpackTemplate(packed);
  assert.equal(rows.length, 60);
  assert.ok(Math.abs(rows[7][3] - t.rows[7][3]) < 1e-6);
  const store = emptyStore();
  assert.ok(addTemplate(store, 'sanjaya', packed));
  assert.equal(addTemplate(store, 'sanjaya', packed), false, 'the same line of the same session is not kept twice');
  for (let i = 0; i < 7; i++) addTemplate(store, 'sanjaya', packTemplate(t, { at: 10 + i, session: 's2' }));
  assert.equal(store.phrases.sanjaya.length, 5);
  assert.equal(templateCount(store), 5);
  assert.equal(store.phrases.sanjaya[0].at, 16, 'newest first');
});

test('findSpeakerLines: a line said twice in a take is found at both starts from a template of the first, and nowhere else', () => {
  const F = synth([5, 24]);
  const store = emptyStore();
  addTemplate(store, 'sanjaya', packTemplate(templateFrom(F, 5, 6.2), { at: 5, session: 's1' }));
  const r = findSpeakerLines(F, store, { expected: { sanjaya: 2 } });
  assert.equal(r.templates, 1);
  assert.ok(r.candidates >= 2, `candidates at the starts of sound: ${r.candidates}`);
  const ats = r.matches.map((m) => m.at);
  assert.ok(ats.some((a) => Math.abs(a - 5) < 0.35), `found at 5 s: ${ats}`);
  assert.ok(ats.some((a) => Math.abs(a - 24) < 0.35), `found at 24 s: ${ats}`);
  assert.equal(r.matches.length, 2, `nothing else: ${JSON.stringify(r.matches)}`);
  assert.deepEqual(findSpeakerLines(F, emptyStore()).matches, []);
  // the take expects one such line: the nearest alone; none expected: nothing is taken
  assert.equal(findSpeakerLines(F, store, { expected: { sanjaya: 1 } }).matches.length, 1);
  assert.deepEqual(findSpeakerLines(F, store, { expected: { sanjaya: 0 } }).matches, []);
});

test('twoPassMarkers: a sloka\'s beginning and ending in the learner\'s voice place it in a recital from both ends', () => {
  // a solo take of A (its start pattern 1, end pattern 2) and of B (3, 4); then a recital A then B
  const soloA = synth([{ at: 3, seed: 1 }, { at: 10, seed: 2 }], { seconds: 16 });
  const soloB = synth([{ at: 3, seed: 3 }, { at: 10, seed: 4 }], { seconds: 16 });
  const store = emptyStore();
  const kA = signatureKeys('A'); const kB = signatureKeys('B');
  addTemplate(store, kA.start, packTemplate(templateFrom(soloA, 3, 4.2), { at: 3, session: 'a' }));
  addTemplate(store, kA.end, packTemplate(templateFrom(soloA, 10, 11.2), { at: 10, session: 'a' }));
  addTemplate(store, kB.start, packTemplate(templateFrom(soloB, 3, 4.2), { at: 3, session: 'b' }));
  addTemplate(store, kB.end, packTemplate(templateFrom(soloB, 10, 11.2), { at: 10, session: 'b' }));
  assert.deepEqual(signatureCount(store, 'A'), { start: 1, end: 1 });
  assert.deepEqual(signatureCount(store, 'C'), { start: 0, end: 0 });
  // each ending runs into the breath that follows it (before B at 20; the room at 38)
  const recital = synth([{ at: 4, seed: 1 }, { at: 17.8, seed: 2 }, { at: 20, seed: 3 }, { at: 36.8, seed: 4 }], { seconds: 40 });
  const r = twoPassMarkers(recital, store, [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }, { id: 'C', name: 'C' }]);
  assert.equal(r.markers.length, 2, JSON.stringify(r.markers));
  const [a, b] = r.markers;
  assert.ok(Math.abs(a.startAt - 4) < 0.35 && Math.abs(b.startAt - 20) < 0.35, `starts at 4 and 20: ${a.startAt}, ${b.startAt}`);
  assert.ok(a.confirmed && Math.abs(a.endAt - 19.0) < 0.35, `A ends where its pattern ends (19.0): ${a.endAt}`);
  assert.ok(b.confirmed && Math.abs(b.endAt - 38.0) < 0.35, `B ends at 38.0: ${b.endAt}`);
  assert.deepEqual(twoPassMarkers(recital, emptyStore(), [{ id: 'A', name: 'A' }]).markers, []);
  // a speaker line heard seeds the beginning of a sloka without a kept beginning; its ending is still confirmed
  const seeded = twoPassMarkers(recital, { version: 1, phrases: { [kB.end]: store.phrases[kB.end] } }, [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }], { seeds: [{ index: 1, at: 20.1 }] });
  assert.equal(seeded.markers.length, 1);
  assert.equal(seeded.markers[0].seeded, 'speakerLine');
  assert.ok(seeded.markers[0].confirmed && Math.abs(seeded.markers[0].endAt - 38.0) < 0.35, `B's ending confirms the seeded start: ${seeded.markers[0].endAt}`);
});

test('assignSpeakerLines: the slokas with a speaker line take the matches of their phrase in order', () => {
  const matches = [{ phrase: 'sanjaya', at: 19.3, dist: 1 }, { phrase: 'dhrtarastra', at: 0.3, dist: 1 }, { phrase: 'sanjaya', at: 60.1, dist: 1.2 }];
  const items = [{ name: '1.1', phrase: 'dhrtarastra' }, { name: '1.2', phrase: 'sanjaya' }, { name: '1.3', phrase: null }, { name: '1.24', phrase: 'sanjaya' }];
  assert.deepEqual(assignSpeakerLines(matches, items).map((a) => [a.index, a.at]), [[0, 0.3], [1, 19.3], [3, 60.1]]);
  // a match before the previous sloka's line is not taken
  assert.deepEqual(assignSpeakerLines([{ phrase: 'sanjaya', at: 2, dist: 1 }, { phrase: 'dhrtarastra', at: 5, dist: 1 }], items).map((a) => a.index), [0]);
});
