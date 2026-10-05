import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFeatures, HOP_SEC } from '../js/dsp/features.js';
import { compare, compareAuto, MISMATCH_CONTRAST } from '../js/dsp/compare.js';
import { locate, sliceFeatures } from '../js/dsp/locate.js';
import { concat, chant, addNoise, VOWEL_A, VOWEL_I, VOWEL_U, VOWEL_E } from './synth.js';

// Three "verses": different tunes and different syllable orders, 8 notes of 300 ms each,
// with 300 ms of silence on both sides (3 s per verse).
const NOTE = 300;
const verseA = () => chant([60, 62, 64, 65, 67, 69, 71, 72], NOTE, [VOWEL_A, VOWEL_I, VOWEL_U, VOWEL_E]);
const verseB = (vowels = [VOWEL_U, VOWEL_A, VOWEL_E, VOWEL_I, VOWEL_A, VOWEL_U, VOWEL_I, VOWEL_E]) => chant([67, 65, 67, 64, 62, 64, 60, 62], NOTE, vowels);
const verseC = () => chant([64, 64, 60, 67, 65, 62, 69, 65], NOTE, [VOWEL_E, VOWEL_E, VOWEL_I, VOWEL_A, VOWEL_U, VOWEL_U, VOWEL_A, VOWEL_I]);
const verseD = () => chant([72, 60, 71, 62, 69, 64, 67, 65], NOTE, [VOWEL_I, VOWEL_U, VOWEL_I, VOWEL_E, VOWEL_A, VOWEL_A, VOWEL_E, VOWEL_U]);
const feat = (x) => extractFeatures(x);
const VERSE_SEC = 3;
const B_START = VERSE_SEC + 0.3; // verse B's first note inside A+B+C
const B_END = 2 * VERSE_SEC - 0.3;

test('locate: finds a verse inside a recording of three, and knows when it is not there', () => {
  const long = feat(concat(verseA(), verseB(), verseC()));
  const present = locate(feat(addNoise(verseB(), 30)), long);
  assert.ok(present, 'located');
  assert.ok(Math.abs(present.start * HOP_SEC - B_START) < 0.35, `start ${present.start * HOP_SEC}`);
  assert.ok(Math.abs((present.end + 1) * HOP_SEC - B_END) < 0.35, `end ${(present.end + 1) * HOP_SEC}`);
  assert.ok(present.contrast < 0.7, `contrast ${present.contrast}`); // real same-verse pairs: 0.2–0.5
  const absent = locate(feat(verseD()), long);
  assert.ok(absent.contrast > present.contrast + 0.2, `absent ${absent.contrast} vs present ${present.contrast}`);
});

test('sliceFeatures: a window is a consistent feature object', () => {
  const long = feat(concat(verseA(), verseB(), verseC()));
  const i0 = Math.round(VERSE_SEC / HOP_SEC);
  const i1 = Math.round((2 * VERSE_SEC) / HOP_SEC) - 1;
  const w = sliceFeatures(long, i0, i1);
  assert.equal(w.n, i1 - i0 + 1);
  assert.ok(Math.abs(w.duration - VERSE_SEC) < 0.05);
  assert.equal(w.mfcc.length, w.n * 12);
  assert.ok(w.trimStart > 0 && w.trimEnd < w.n - 1, 'the silences around the verse are outside the trim');
  assert.ok(w.activeFrac > 0.6 && w.activeFrac < 1);
  // comparing the window with the verse itself is a clean match
  const res = compare(feat(verseB()), w);
  assert.ok(res.scores.overall >= 95, `overall ${res.scores.overall}`);
});

test('compareAuto: a long take against a one-verse baseline compares only the matching part', () => {
  const B = feat(verseB());
  const H = feat(concat(verseA(), verseB(), verseC()));
  const res = compareAuto(B, H);
  assert.equal(res.match.located, 'heard');
  assert.ok(res.match.ok, `contrast ${res.match.contrast}`);
  assert.ok(res.scores.overall >= 90, `overall ${res.scores.overall}`);
  assert.ok(Math.abs(res.matched.heard[0] - B_START) < 0.4, `matched from ${res.matched.heard[0]}`);
  assert.ok(Math.abs(res.matched.heard[1] - B_END) < 0.4, `matched to ${res.matched.heard[1]}`);
  assert.equal(res.heardDuration, H.duration);
  assert.equal(res.baseOffset, 0);
  assert.ok(!res.deviations.some((d) => d.type === 'extra' && d.edge), 'the neighbouring verses are not reported as extra sound');
  assert.ok(res.notes.some((n) => n.includes('longer than this sloka')));
  // heard-time lookups used by the chart work on absolute take time
  const j = Math.round((B_START + 1) / HOP_SEC);
  assert.ok(res.chart.iOf[j] >= 0, 'a frame inside the window maps to the baseline');
  assert.equal(res.chart.iOf[Math.round(1 / HOP_SEC)], -1, 'a frame in verse A maps to nothing');
});

test('compareAuto: a one-verse take against a long baseline reports absolute baseline times', () => {
  const B = feat(concat(verseA(), verseB(), verseC()));
  // the 4th syllable is sung with the wrong vowel
  const wrong = [VOWEL_U, VOWEL_A, VOWEL_E, VOWEL_A, VOWEL_A, VOWEL_U, VOWEL_I, VOWEL_E];
  const H = feat(verseB(wrong));
  const res = compareAuto(B, H);
  assert.equal(res.match.located, 'base');
  assert.ok(res.match.ok, `contrast ${res.match.contrast}`);
  assert.ok(Math.abs(res.baseOffset - VERSE_SEC) < 0.7, `offset ${res.baseOffset}`);
  assert.ok(res.baseDuration < 4.2, `the chart spans the window, not the whole baseline (${res.baseDuration})`);
  assert.equal(res.baseFullDuration, B.duration);
  const noteStart = B_START + 3 * (NOTE / 1000);
  const content = res.deviations.filter((d) => d.types.includes('content'));
  assert.ok(content.length >= 1, 'the wrong vowel is found');
  assert.ok(content.some((d) => d.tBase[0] < noteStart + NOTE / 1000 && d.tBase[1] > noteStart), `content deviation at ${JSON.stringify(content.map((d) => d.tBase))}, expected around ${noteStart}`);
  assert.ok(!res.deviations.some((d) => d.type === 'missing' && d.edge), 'the neighbouring verses are not reported as missing');
  assert.ok(res.chart.times[0] >= res.baseOffset - 1e-6);
});

test('compareAuto: similar lengths are compared as before, and different material is flagged', () => {
  const same = compareAuto(feat(verseB()), feat(addNoise(verseB(), 30)));
  assert.equal(same.match.located, null);
  assert.ok(same.match.ok);
  assert.ok(same.match.contrast < 0.7, `contrast ${same.match.contrast}`); // real same-verse pairs: 0.2–0.5
  assert.ok(same.scores.overall >= 95);
  const other = compareAuto(feat(verseB()), feat(verseD()));
  assert.ok(other.match.contrast > same.match.contrast + 0.2, `other ${other.match.contrast}`);
  if (!other.match.ok) assert.ok(other.notes[0].includes('does not sound like the same material'));
  assert.ok(MISMATCH_CONTRAST > 0.8 && MISMATCH_CONTRAST < 0.9);
});

test('compareAuto: pauses that one recording marked as sound are not reported as extra sound', () => {
  const half1 = chant([67, 65, 67, 64], NOTE, [VOWEL_U, VOWEL_A, VOWEL_E, VOWEL_I], 300);
  const half2 = chant([62, 64, 60, 62], NOTE, [VOWEL_A, VOWEL_U, VOWEL_I, VOWEL_E], 300);
  const x = addNoise(concat(half1, half2), 40); // 600 ms pause in the middle
  const B = feat(x);
  const H0 = feat(x);
  // what a very quiet room does to the detector: threshold 45 dB under the peak, everything "sound"
  const H = { ...H0, active: new Uint8Array(H0.n).fill(1), thrDb: H0.peakDb - 45, activeFrac: 1, trimStart: 0, trimEnd: H0.n - 1 };
  const naive = compare(B, H);
  assert.ok(naive.deviations.some((d) => d.type === 'extra'), 'without harmonising, the pause shows up as extra sound');
  const res = compareAuto(B, H);
  assert.ok(!res.deviations.some((d) => d.type === 'extra'), JSON.stringify(res.deviations.map((d) => [d.type, d.label, d.tBase])));
  assert.ok(res.scores.overall >= 97, `overall ${res.scores.overall}`);
});
