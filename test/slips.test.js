// The slips a learner makes, as the 17 October 2026 simulations exercised them: a pāda said
// twice and a pāda left out, judged from the words as Whisper actually writes them, and
// from the sound of synthetic recordings cut the same way (a verse of eight notes with a
// quarter repeated, left out, or replaced by another's).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparePhonology } from '../js/phon.js';
import { findSelfCorrections, tokenize } from '../js/textdiff.js';
import { droppedByWords, DROPPED_MIN_AKSHARAS, applySlipPenalty, gradeWithSlips, SLIP_PENALTY } from '../js/quizscore.js';
import { extractFeatures, HOP_SEC } from '../js/dsp/features.js';
import { compareAuto } from '../js/dsp/compare.js';
import { concat, chant, VOWEL_A, VOWEL_I, VOWEL_U, VOWEL_E } from './synth.js';

// Gītā 12.3 as the dataset writes it, and as the Best model heard the user's recitations
const REF = 'ये त्वक्षरमनिर्देश्यमव्यक्तं पर्युपासते । सर्वत्रगमचिन्त्यञ्च कूटस्थमचलन्ध्रुवम् ॥';
const REF_PADA = [1, 1, 2, 3, 4]; // the pāda each word of the text begins in
const HEARD = {
  whole: 'येत्वक्षरम निर्देश्यम अव्यक्तं पर्युपासते।सर्वत्रगम चिंत्यम्चा कूटस्थम चलं थुवं॥',
  restart: 'येत्वक्षरम निर्देश्यम अव्यक्तं पर्युपासते।सर्वत्रगम चिंत्यम्चा सर्वत्रगम चिंत्यम्चा कूटस्थम चलं थुवं॥',
  missing: 'येत्वक्षरम निर्देश्यम् सर्वत्रगम चिंत्यम्चा।गूटस्थम चलंधुवं॥',
  stutter: 'येत्वक्षरम निर्देश्यम अव्यक्तं पर्युपासते।ससर्वत्रगमचिंत्यम्चा गूटस्थमचलं द्रुवं॥',
};
const refToks = tokenize(REF);
const heardToks = (s) => tokenize(s);
const counts = (heard) => comparePhonology(REF, heard, { perPada: 8 }).counts;

test('dropped akṣaras from the words alone: a pāda left out is dropped, a whole recitation is not, nor a stutter', () => {
  const missing = counts(HEARD.missing);
  assert.ok(missing.missing >= 6, `a pāda of eight left out: ${missing.missing} akṣaras missing`);
  assert.equal(droppedByWords(missing), true);
  const whole = counts(HEARD.whole);
  assert.ok(whole.missing < DROPPED_MIN_AKSHARAS, `the whole recitation as heard: ${whole.missing} missing`);
  assert.equal(droppedByWords(whole), false);
  assert.equal(droppedByWords(counts(HEARD.stutter)), false);
  assert.equal(droppedByWords(counts(HEARD.restart)), false);
  // the rule itself: four of at least eight, and a tenth of the text
  assert.equal(droppedByWords({ ref: 32, missing: 4 }), true);
  assert.equal(droppedByWords({ ref: 32, missing: 3 }), false);
  assert.equal(droppedByWords({ ref: 60, missing: 5 }), false); // under a tenth of a long text
  assert.equal(droppedByWords({ ref: 6, missing: 4 }), false); // too short a text to judge
  assert.equal(droppedByWords(null), false);
});

test('a pāda said twice, as Whisper writes it, is a restart at that pāda; the whole and the stutter are clean', () => {
  const again = findSelfCorrections(refToks, heardToks(HEARD.restart), { refPada: REF_PADA });
  assert.deepEqual(again.map((c) => [c.kind, c.word, c.pada]), [['restart', 'सर्वत्रगमचिन्त्यञ्च', 3]], JSON.stringify(again));
  assert.deepEqual(findSelfCorrections(refToks, heardToks(HEARD.whole), { refPada: REF_PADA }), []);
  assert.deepEqual(findSelfCorrections(refToks, heardToks(HEARD.missing), { refPada: REF_PADA }), []);
  assert.deepEqual(findSelfCorrections(refToks, heardToks(HEARD.stutter), { refPada: REF_PADA }), [], 'a stuttered syllable is below the word level');
});

test('what a slip costs: a restart takes 15 % and the grade; dropped akṣaras take the grade alone', () => {
  const restart = [{ kind: 'restart', pada: 3, word: 'सर्वत्रगमचिन्त्यञ्च', by: 'words' }];
  assert.equal(applySlipPenalty(92, restart), Math.round(92 * (1 - SLIP_PENALTY)));
  assert.equal(gradeWithSlips(78, restart).id, 'practice');
  const dropped = [{ kind: 'dropped', count: 24, expected: 32, by: 'words' }];
  assert.equal(applySlipPenalty(90, dropped), 90);
  assert.equal(gradeWithSlips(90, dropped).id, 'practice');
  assert.equal(gradeWithSlips(96, []).id, 'excellent');
});

// ---------- the sound of the same slips, on synthetic verses ----------
const NOTE = 300;
const NOTES = [67, 65, 67, 64, 62, 64, 60, 62];
const VOWELS = [VOWEL_U, VOWEL_A, VOWEL_E, VOWEL_I, VOWEL_A, VOWEL_U, VOWEL_I, VOWEL_E];
const OTHER = [72, 60, 71, 62, 69, 64, 67, 65];
const OTHER_VOWELS = [VOWEL_I, VOWEL_U, VOWEL_I, VOWEL_E, VOWEL_A, VOWEL_A, VOWEL_E, VOWEL_U];
const verse = () => chant(NOTES, NOTE, VOWELS); // 8 notes, 300 ms of silence either side
const quarter = (i, notes = NOTES, vowels = VOWELS) => chant(notes.slice(2 * i, 2 * i + 2), NOTE, vowels.slice(2 * i, 2 * i + 2));
const feat = (x) => extractFeatures(x, { warps: true });
const devs = (res, type) => res.deviations.filter((d) => d.type === type || (d.types || []).includes(type));
const span = (d) => d.tBase[1] - d.tBase[0];

test('the sound: a quarter left out is a missing stretch of the sloka where it was', () => {
  const B = feat(verse());
  const H = feat(concat(quarter(0), quarter(2), quarter(3)));
  const res = compareAuto(B, H, { locate: false });
  const missing = devs(res, 'missing');
  assert.ok(missing.length >= 1, 'a missing deviation');
  const big = missing.reduce((a, d) => (span(d) > span(a) ? d : a));
  // the second quarter: notes 3–4, 0.9–1.5 s into the sloka (0.3 s of silence leads)
  assert.ok(big.tBase[0] < 1.2 && big.tBase[1] > 1.2, `the missing stretch lies over the second quarter: ${big.tBase}`);
  assert.ok(span(big) >= 0.35, `and is most of it: ${span(big).toFixed(2)} s`);
  assert.ok(res.scores.overall < 100);
});

test('the sound: a quarter sung again is extra material and a longer take', () => {
  const B = feat(verse());
  const H = feat(concat(quarter(0), quarter(1), quarter(2), quarter(2), quarter(3)));
  const res = compareAuto(B, H, { locate: false });
  assert.ok(res.tempoRatio > 1.15, `the take is longer: tempo ${res.tempoRatio}`);
  assert.ok(devs(res, 'extra').length >= 1 || res.scores.timing < 100, 'extra sound, or timing lowered');
});

test('the sound: a quarter replaced by another verse\'s is content that sounds different', () => {
  const B = feat(verse());
  const H = feat(concat(quarter(0), quarter(1), quarter(2), quarter(3, OTHER, OTHER_VOWELS)));
  const res = compareAuto(B, H, { locate: false });
  // the sloka's last quarter was not matched: on tones it reads as not heard (missing), on
  // a voice as sounding different (content) — the app showed both on the real recording
  const flagged = [...devs(res, 'content'), ...devs(res, 'missing')].filter((d) => d.tBase[1] > 1.9 && span(d) >= 0.3);
  assert.ok(flagged.length >= 1, `the last quarter is flagged: ${JSON.stringify(res.deviations.map((d) => [d.type, d.tBase]))}`);
  assert.ok(devs(res, 'missing').every((d) => d.tBase[0] > 1.5), 'nothing earlier is missing: the first three quarters were sung');
  assert.ok(res.scores.overall < 100);
});
