import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanFolder, parseBaselineFilename, nameFromSlug, parseWavHeader } from '../js/libutil.js';
import { encodeWavBytes } from '../js/wav.js';
import { itemScores, attemptSummary, scoreFor, normalizeCategories, pickBaselines, shuffle, DEFAULT_QUIZ_CATEGORIES, DEFAULT_TOLERANCE, normalizeTolerance, withinTolerance, itemVerdict, correctness, overallScore, attemptOverall, gradeOf, CATEGORY_WEIGHTS } from '../js/quizscore.js';

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

const result = (over) => ({ match: { ok: true }, scores: { content: 90, timing: 80, pitch: 70, dynamics: 95 }, ...over });

test('itemScores: recited, not recited, and not comparable', () => {
  const ok = itemScores(result(), { wordSimilarity: 0.756, sttAvailable: true });
  assert.deepEqual(ok, { matched: true, missing: false, content: 90, pronunciation: 76, timing: 80, pitch: 70, dynamics: 95 });
  const noStt = itemScores(result(), { wordSimilarity: null, sttAvailable: false });
  assert.equal(noStt.pronunciation, null);
  const noPitch = itemScores(result({ scores: { content: 90, timing: 80, pitch: null, dynamics: null } }), { sttAvailable: true, wordSimilarity: 1 });
  assert.equal(noPitch.pitch, null);
  assert.equal(noPitch.dynamics, null);
  const notRecited = itemScores(result({ match: { ok: false } }), { sttAvailable: true });
  assert.deepEqual(notRecited, { matched: false, missing: false, content: 0, pronunciation: 0, timing: 0, pitch: 0, dynamics: 0 });
  assert.equal(itemScores(result({ match: { ok: false } }), { sttAvailable: false }).pronunciation, null);
  assert.equal(itemScores({ error: 'boom' }).missing, true);
  assert.equal(itemScores(null).missing, true);
});

test('attemptSummary and scoreFor: category averages, then the chosen categories', () => {
  const items = [
    itemScores(result(), { wordSimilarity: 0.8, sttAvailable: true }), // 90 / 80 / 80 / 70 / 95
    itemScores(result({ match: { ok: false } }), { sttAvailable: true }), // all 0: not recited
    itemScores({ error: 'gone' }), // left out
  ];
  const sum = attemptSummary(items, ['content', 'pronunciation']);
  assert.deepEqual(sum.byCategory, { content: 45, pronunciation: 40, timing: 40, pitch: 35, dynamics: 48 });
  assert.equal(sum.average, 43); // (45 + 40) / 2 rounded
  assert.equal(sum.score, 0); // neither judgeable item is within tolerance: pronunciation 80 is 20 % off, and the other was not recited
  assert.equal(sum.correct, 0);
  assert.equal(attemptSummary(items, ['content']).score, 50, 'on content alone the first item passes (90 is within 10 %)');
  assert.equal(sum.counted, 2);
  assert.equal(sum.recited, 1);
  // weighted overall over the chosen categories: item 1 = (80·90 + 70·80) / 150 = 85.3, item 2 = 0 → mean 43
  assert.equal(sum.overall, 43);
  assert.equal(sum.grade, 'practice');
  assert.equal(scoreFor(sum.byCategory, ['content', 'timing', 'pitch']), 40);
  assert.equal(scoreFor({ content: 50, pronunciation: null }, ['content', 'pronunciation']), 50, 'a category that could not be judged is left out');
  assert.equal(scoreFor({ content: null }, ['content']), null);
  assert.deepEqual(normalizeCategories(['bogus', 'timing', 'content']), ['content', 'timing']);
  assert.deepEqual(normalizeCategories([]), DEFAULT_QUIZ_CATEGORIES);
});

test('overallScore: content weighs 80, pronunciation 70, the rest 40; unjudged categories are left out', () => {
  assert.deepEqual(CATEGORY_WEIGHTS, { content: 80, pronunciation: 70, timing: 40, pitch: 40, dynamics: 40 });
  const all = { content: 90, pronunciation: 80, timing: 80, pitch: 70, dynamics: 95 };
  // (80·90 + 70·80 + 40·80 + 40·70 + 40·95) / 270 = 22600 / 270 = 83.7
  assert.equal(overallScore(all), 84);
  assert.equal(overallScore({ ...all, pronunciation: null, pitch: null }), Math.round((80 * 90 + 40 * 80 + 40 * 95) / 160));
  assert.equal(overallScore(all, ['content', 'pronunciation']), 85);
  assert.equal(overallScore({ content: null, pronunciation: null, timing: null, pitch: null, dynamics: null }), null);
  assert.equal(overallScore(null), null);
  assert.equal(attemptOverall([{ ...all, missing: false }, { missing: true }, { content: 0, pronunciation: 0, timing: 0, pitch: 0, dynamics: 0 }]), 42);
  assert.equal(attemptOverall([{ missing: true }]), null);
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
  assert.deepEqual(DEFAULT_TOLERANCE, { content: 10, pronunciation: 10, timing: 60, pitch: 60, dynamics: 60 });
  assert.deepEqual(normalizeTolerance({ content: '25', timing: 150, pitch: -3, bogus: 1 }), { content: 25, pronunciation: 10, timing: 100, pitch: 0, dynamics: 60 });
  assert.deepEqual(normalizeTolerance(null), DEFAULT_TOLERANCE);
  assert.equal(withinTolerance(90, 10), true);
  assert.equal(withinTolerance(89, 10), false);
  assert.equal(withinTolerance(40, 60), true);
  assert.equal(withinTolerance(null, 10), null);
  const good = itemScores(result({ scores: { content: 92, timing: 45, pitch: 70, dynamics: 95 } }), { wordSimilarity: 0.9, sttAvailable: true });
  assert.deepEqual(itemVerdict(good, ['content', 'pronunciation']), { ok: true, failed: [], judged: ['content', 'pronunciation'] });
  assert.deepEqual(itemVerdict(good, ['content', 'timing', 'pitch']), { ok: true, failed: [], judged: ['content', 'timing', 'pitch'] });
  const slack = itemScores(result({ scores: { content: 92, timing: 39, pitch: null, dynamics: 95 } }), { wordSimilarity: 0.85, sttAvailable: true });
  assert.deepEqual(itemVerdict(slack, ['content', 'pronunciation', 'timing', 'pitch']), { ok: false, failed: ['pronunciation', 'timing'], judged: ['content', 'pronunciation', 'timing'] });
  const noStt = itemScores(result(), { sttAvailable: false });
  assert.deepEqual(itemVerdict(noStt, ['pronunciation']), { ok: null, failed: [], judged: [] }, 'nothing judgeable: no verdict');
  assert.equal(itemVerdict(itemScores({ error: 'gone' }), ['content']).ok, null);
  // a looser tolerance turns a fail into a pass
  assert.equal(itemVerdict(slack, ['pronunciation'], { ...DEFAULT_TOLERANCE, pronunciation: 20 }).ok, true);
});

test('correctness: share of items within tolerance, and per-category pass rates', () => {
  const items = [
    itemScores(result({ scores: { content: 95, timing: 80, pitch: 70, dynamics: 95 } }), { wordSimilarity: 0.95, sttAvailable: true }), // ok
    itemScores(result({ scores: { content: 85, timing: 80, pitch: 70, dynamics: 95 } }), { wordSimilarity: 0.95, sttAvailable: true }), // content out
    itemScores(result({ match: { ok: false } }), { sttAvailable: true }), // not recited: everything 0
    itemScores({ error: 'gone' }), // left out
  ];
  const c = correctness(items, ['content', 'pronunciation']);
  assert.equal(c.counted, 3);
  assert.equal(c.correct, 1);
  assert.equal(c.pct, 33);
  assert.deepEqual(c.passRate.content, { ok: 1, n: 3, pct: 33 });
  assert.deepEqual(c.passRate.pronunciation, { ok: 2, n: 3, pct: 67 });
  assert.deepEqual(c.passRate.timing, { ok: 2, n: 3, pct: 67 });
  assert.equal(correctness([], ['content']).pct, null);
  assert.equal(correctness(items, ['content'], { ...DEFAULT_TOLERANCE, content: 20 }).correct, 2, 'a wider content tolerance accepts the second item');
});
