import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanFolder, parseBaselineFilename, nameFromSlug, parseWavHeader } from '../js/libutil.js';
import { encodeWavBytes } from '../js/wav.js';
import { itemScores, attemptSummary, scoreFor, normalizeCategories, pickBaselines, shuffle, DEFAULT_QUIZ_CATEGORIES, DEFAULT_TOLERANCE, normalizeTolerance, recordTolerance, withinTolerance, itemVerdict, correctness, overallScore, attemptOverall, gradeOf, CATEGORY_WEIGHTS, QUIZ_CATEGORIES, normalizeWeights } from '../js/quizscore.js';

test('cleanFolder: usable names pass, traversal and reserved names do not', () => {
  assert.equal(cleanFolder('Chapter 12'), 'Chapter 12');
  assert.equal(cleanFolder(' Gita / Chapter 12 '), 'Gita/Chapter 12');
  assert.equal(cleanFolder('Gita\\Chapter 12'), 'Gita/Chapter 12');
  assert.equal(cleanFolder(''), '');
  assert.equal(cleanFolder('/'), '');
  assert.equal(cleanFolder('a<b>:c?'), 'abc');
  assert.equal(cleanFolder('नमस्ते'), 'नमस्ते');
  assert.equal(cleanFolder('../x'), null);
  assert.equal(cleanFolder('x/../y'), null);
  assert.equal(cleanFolder('.hidden'), null);
  assert.equal(cleanFolder('backup'), null);
  assert.equal(cleanFolder('Backup/old'), null);
  assert.equal(cleanFolder('a/b/c/d'), null);
  assert.equal(cleanFolder('???'), null);
});

test('baseline file names carry their id', () => {
  assert.deepEqual(parseBaselineFilename('ch12-01-20260912-125801-71o3.wav'), { id: '20260912-125801-71o3', slug: 'ch12-01' });
  assert.deepEqual(parseBaselineFilename('20260912-125801-71o3.wav'), { id: '20260912-125801-71o3', slug: '' });
  assert.equal(parseBaselineFilename('random.wav'), null);
  assert.equal(nameFromSlug('gayatri-verse-1'), 'gayatri verse 1');
  assert.equal(nameFromSlug('', 'fallback.wav'), 'fallback.wav');
});

test('parseWavHeader reads format and duration from the first bytes', () => {
  const sr = 16000;
  const bytes = encodeWavBytes(new Float32Array(sr * 3), sr); // 3 s mono 16-bit
  const full = parseWavHeader(bytes);
  assert.equal(full.sampleRate, sr);
  assert.equal(full.channels, 1);
  assert.equal(full.bits, 16);
  assert.ok(Math.abs(full.duration - 3) < 1e-6, `duration ${full.duration}`);
  const head = parseWavHeader(bytes.subarray(0, 64), bytes.length); // header only, as the server reads it
  assert.ok(Math.abs(head.duration - 3) < 1e-6, `duration from header ${head.duration}`);
  assert.equal(parseWavHeader(new Uint8Array(20)), null);
});

const result = (over) => ({ match: { ok: true }, scores: { content: 90, timing: 80, pitch: 70, dynamics: 95, emphasis: 72, phrasing: 88 }, ...over });
const phon = (over) => ({ phonemes: 96, vowels: 90, syllables: 100, ...over });

test('itemScores: recited, not recited, and not comparable', () => {
  const ok = itemScores(result(), { phonology: phon(), sttAvailable: true });
  assert.deepEqual(ok, { matched: true, missing: false, phoneme: 96, vowel: 90, syllable: 100, emphasis: 72, pitch: 70, phrasing: 88, timing: 80 });
  const noStt = itemScores(result(), { phonology: null, sttAvailable: false });
  assert.equal(noStt.phoneme, null);
  assert.equal(noStt.vowel, null);
  assert.equal(noStt.syllable, null);
  assert.equal(noStt.timing, 80, 'the sound is judged without the words');
  const noPitch = itemScores(result({ scores: { content: 90, timing: 80, pitch: null, emphasis: null, phrasing: 50 } }), { sttAvailable: true, phonology: phon() });
  assert.equal(noPitch.pitch, null);
  assert.equal(noPitch.emphasis, null);
  const styleOnly = itemScores(result({ scores: { timing: 80, pitch: 55, weights: { pitch: 0, timing: 0.4, content: 0.6 } } }), { phonology: phon() });
  assert.equal(styleOnly.pitch, null, 'recited text: pitch is shown, not judged');
  const notRecited = itemScores(result({ match: { ok: false } }), { sttAvailable: true });
  assert.deepEqual(notRecited, { matched: false, missing: false, phoneme: 0, vowel: 0, syllable: 0, emphasis: 0, pitch: 0, phrasing: 0, timing: 0 });
  assert.equal(itemScores(result({ match: { ok: false } }), { sttAvailable: false }).phoneme, null);
  assert.equal(itemScores({ error: 'boom' }).missing, true);
  assert.equal(itemScores(null).missing, true);
});

test('attemptSummary and scoreFor: category averages, then the chosen categories', () => {
  const items = [
    itemScores(result(), { phonology: phon(), sttAvailable: true }), // 96 / 90 / 100 / 72 / 70 / 88 / 80
    itemScores(result({ match: { ok: false } }), { sttAvailable: true }), // all 0: not recited
    itemScores({ error: 'gone' }), // left out
  ];
  const sum = attemptSummary(items, ['phoneme', 'vowel', 'syllable']);
  assert.deepEqual(sum.byCategory, { phoneme: 48, vowel: 45, syllable: 50, emphasis: 36, pitch: 35, phrasing: 44, timing: 40 });
  assert.equal(sum.average, 48); // (48 + 45 + 50) / 3 rounded
  assert.equal(sum.score, 50, 'the first item is within every tolerance (phoneme 15, vowel 20, syllable 10); the other was not recited');
  assert.equal(sum.correct, 1);
  assert.equal(attemptSummary(items, ['vowel'], { ...DEFAULT_TOLERANCE, vowel: 5 }).score, 0, 'a tighter vowel tolerance fails it');
  assert.equal(sum.counted, 2);
  assert.equal(sum.recited, 1);
  // weighted overall over the chosen categories: item 1 = (30·96 + 25·90 + 15·100) / 70 = 94.7 → 95, item 2 = 0 → mean 47.5 → 48
  assert.equal(sum.overall, 48);
  assert.equal(sum.grade, 'practice');
  assert.equal(scoreFor(sum.byCategory, ['phoneme', 'timing', 'pitch']), 41);
  assert.equal(scoreFor({ phoneme: 50, vowel: null }, ['phoneme', 'vowel']), 50, 'a category that could not be judged is left out');
  assert.equal(scoreFor({ phoneme: null }, ['phoneme']), null);
  assert.deepEqual(normalizeCategories(['bogus', 'timing', 'phoneme']), ['phoneme', 'timing']);
  assert.deepEqual(normalizeCategories([]), DEFAULT_QUIZ_CATEGORIES);
});

test('overallScore: the recommended weights (30/25/15/10/10/5/5), configurable; unjudged categories left out; old records add up on their own', () => {
  assert.deepEqual(QUIZ_CATEGORIES.map((c) => [c.id, c.weight]), [['phoneme', 30], ['vowel', 25], ['syllable', 15], ['emphasis', 10], ['pitch', 10], ['phrasing', 5], ['timing', 5]]);
  const all = { phoneme: 96, vowel: 90, syllable: 100, emphasis: 72, pitch: 70, phrasing: 88, timing: 80 };
  // (30·96 + 25·90 + 15·100 + 10·72 + 10·70 + 5·88 + 5·80) / 100 = 88.9 → 89
  assert.equal(overallScore(all), 89);
  assert.equal(overallScore({ ...all, vowel: null, pitch: null }), Math.round((30 * 96 + 15 * 100 + 10 * 72 + 5 * 88 + 5 * 80) / 65));
  assert.equal(overallScore(all, ['phoneme', 'vowel', 'syllable']), 95);
  assert.equal(overallScore({ phoneme: null, vowel: null, syllable: null, emphasis: null, pitch: null, phrasing: null, timing: null }), null);
  assert.equal(overallScore(null), null);
  // the weights can be changed
  const mine = normalizeWeights({ phoneme: 50, vowel: 50, syllable: 0, emphasis: 0, pitch: 0, phrasing: 0, timing: 0 });
  assert.equal(overallScore(all, undefined, mine), 93);
  assert.deepEqual(normalizeWeights(null), { ...CATEGORY_WEIGHTS });
  assert.equal(normalizeWeights({ phoneme: 0, vowel: 0, syllable: 0, emphasis: 0, pitch: 0, phrasing: 0, timing: 0 }).phoneme, 30, 'all zero falls back to the defaults');
  assert.equal(attemptOverall([{ ...all, missing: false }, { missing: true }, { phoneme: 0, vowel: 0, syllable: 0, emphasis: 0, pitch: 0, phrasing: 0, timing: 0 }]), 45);
  assert.equal(attemptOverall([{ missing: true }]), null);
  // an attempt from before this scoring (content, pronunciation…) still adds up, on its old weights
  const old = { content: 90, pronunciation: 80, timing: 80, pitch: 70, dynamics: 95 };
  assert.equal(overallScore(old), 84); // (80·90 + 70·80 + 40·80 + 40·70 + 40·95) / 270, as it was scored at the time
});

test('gradeOf: Excellent from 90, Good 80–89, Fair 65–79, Needs practice below', () => {
  assert.equal(gradeOf(100).id, 'excellent');
  assert.equal(gradeOf(90).label, 'Excellent');
  assert.equal(gradeOf(89).label, 'Good');
  assert.equal(gradeOf(80).id, 'good');
  assert.equal(gradeOf(79).id, 'fair');
  assert.equal(gradeOf(65).id, 'fair');
  assert.equal(gradeOf(64).label, 'Needs practice');
  assert.equal(gradeOf(0).id, 'practice');
  assert.equal(gradeOf(null), null);
});

test('pickBaselines: at most N, no repeats, spread across folders', () => {
  const lib = [];
  for (let i = 0; i < 20; i++) lib.push({ id: `a${i}`, folder: 'A' });
  for (let i = 0; i < 3; i++) lib.push({ id: `b${i}`, folder: 'B' });
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const picked = pickBaselines(lib, 10, rnd);
  assert.equal(picked.length, 10);
  assert.equal(new Set(picked.map((p) => p.id)).size, 10);
  assert.equal(picked.filter((p) => p.folder === 'B').length, 3, 'the small folder is fully represented');
  assert.equal(pickBaselines(lib, 1, rnd).length, 1);
  assert.equal(pickBaselines(lib.slice(0, 4), 10, rnd).length, 4, 'never more than there are');
  assert.equal(pickBaselines([], 5, rnd).length, 0);
  assert.deepEqual(shuffle([1, 2, 3], () => 0).length, 3);
});

test('tolerance: defaults, normalising, and per-item verdicts', () => {
  assert.deepEqual(DEFAULT_TOLERANCE, { phoneme: 15, vowel: 20, syllable: 10, emphasis: 60, pitch: 60, phrasing: 50, timing: 60, content: 10, pronunciation: 10 });
  assert.deepEqual(normalizeTolerance({ phoneme: '25', timing: 150, pitch: -3, bogus: 1 }), { ...DEFAULT_TOLERANCE, phoneme: 25, timing: 100, pitch: 0 });
  assert.deepEqual(normalizeTolerance(null), DEFAULT_TOLERANCE);
  assert.equal(withinTolerance(90, 10), true);
  assert.equal(withinTolerance(89, 10), false);
  assert.equal(withinTolerance(40, 60), true);
  assert.equal(withinTolerance(null, 10), null);
  const good = itemScores(result({ scores: { timing: 45, pitch: 70, emphasis: 60, phrasing: 50 } }), { phonology: phon({ phonemes: 90, vowels: 85, syllables: 92 }), sttAvailable: true });
  assert.deepEqual(itemVerdict(good, ['phoneme', 'vowel', 'syllable']), { ok: true, failed: [], judged: ['phoneme', 'vowel', 'syllable'] });
  assert.deepEqual(itemVerdict(good, ['phoneme', 'timing', 'pitch']), { ok: true, failed: [], judged: ['phoneme', 'timing', 'pitch'] });
  const slack = itemScores(result({ scores: { timing: 39, pitch: null, emphasis: 60, phrasing: 50 } }), { phonology: phon({ vowels: 75 }), sttAvailable: true });
  assert.deepEqual(itemVerdict(slack, ['phoneme', 'vowel', 'timing', 'pitch']), { ok: false, failed: ['vowel', 'timing'], judged: ['phoneme', 'vowel', 'timing'] });
  const noStt = itemScores(result(), { sttAvailable: false });
  assert.deepEqual(itemVerdict(noStt, ['phoneme']), { ok: null, failed: [], judged: [] }, 'nothing judgeable: no verdict');
  assert.equal(itemVerdict(itemScores({ error: 'gone' }), ['phoneme']).ok, null);
  // a looser tolerance turns a fail into a pass
  assert.equal(itemVerdict(slack, ['vowel'], { ...DEFAULT_TOLERANCE, vowel: 30 }).ok, true);
});

test('correctness: share of items within tolerance, and per-category pass rates', () => {
  const items = [
    itemScores(result(), { phonology: phon({ phonemes: 95 }), sttAvailable: true }), // ok
    itemScores(result(), { phonology: phon({ phonemes: 80 }), sttAvailable: true }), // phonemes out (15 % tolerance)
    itemScores(result({ match: { ok: false } }), { sttAvailable: true }), // not recited: everything 0
    itemScores({ error: 'gone' }), // left out
  ];
  const c = correctness(items, ['phoneme', 'vowel']);
  assert.equal(c.counted, 3);
  assert.equal(c.correct, 1);
  assert.equal(c.pct, 33);
  assert.deepEqual(c.passRate.phoneme, { ok: 1, n: 3, pct: 33 });
  assert.deepEqual(c.passRate.vowel, { ok: 2, n: 3, pct: 67 });
  assert.deepEqual(c.passRate.timing, { ok: 2, n: 3, pct: 67 });
  assert.equal(correctness([], ['phoneme']).pct, null);
  assert.equal(correctness(items, ['phoneme'], { ...DEFAULT_TOLERANCE, phoneme: 25 }).correct, 2, 'a wider phoneme tolerance accepts the second item');
});

test('tolerances switched off (null): nothing is judged, scores and grades remain', () => {
  const good = itemScores(result({ scores: { timing: 45, pitch: 70, emphasis: 60, phrasing: 50 } }), { phonology: phon({ phonemes: 90, vowels: 85, syllables: 92 }), sttAvailable: true });
  assert.equal(withinTolerance(90, null), null);
  assert.equal(withinTolerance(90, undefined), null);
  assert.deepEqual(itemVerdict(good, ['phoneme', 'vowel'], null), { ok: null, failed: [], judged: [] });
  const items = [good, itemScores(result(), { phonology: phon({ phonemes: 80 }), sttAvailable: true })];
  const c = correctness(items, ['phoneme', 'vowel'], null);
  assert.equal(c.pct, null);
  assert.equal(c.counted, 0);
  assert.equal(c.passRate.phoneme, null);
  const sum = attemptSummary(items, ['phoneme', 'vowel'], null);
  assert.equal(sum.score, null, 'no correctness without a tolerance');
  assert.equal(sum.overall, attemptOverall(items, ['phoneme', 'vowel']), 'the weighted overall is unaffected');
  assert.ok(sum.grade, 'and so is the grade');
  // what a stored attempt or session is judged with
  assert.deepEqual(recordTolerance(null), DEFAULT_TOLERANCE);
  assert.deepEqual(recordTolerance({}), DEFAULT_TOLERANCE, 'before tolerances existed: the defaults');
  assert.deepEqual(recordTolerance({ tolerance: { phoneme: 25 } }), { ...DEFAULT_TOLERANCE, phoneme: 25 });
  assert.equal(recordTolerance({ tolerance: null, noTolerance: true }), null, 'judged with tolerances off');
  assert.equal(recordTolerance({ tolerance: { phoneme: 25 }, noTolerance: true }), null, 'the flag wins');
});
