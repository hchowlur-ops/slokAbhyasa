// The ear's decisions, pure (js/dsp/ear.js): the learner's own expected time or none, the
// close rules without the teacher's clock, the counts the 17 October simulations recorded,
// the count ratio learnt from the words, and pāda starts read from a recording's pauses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { earExpectedMs, earPositionOf, earDecision, longPauseMs, calibrateCountRatio, padaStartsFromPauses, STOP_PAUSE_MS, DEFAULT_PADA_PAUSE_MS, RUN_ON_MS } from '../js/dsp/ear.js';

const plan = { total: 32, padas: [8, 8, 8, 8], speakerLine: false, checkpoints: [8, 16, 24, 32] };
const user = { aksPerSec: 2.13, padaPauseMs: 482, slokaPauseMs: 515, countRatio: 1.35 }; // the user's profile on 17 October
const nobody = { aksPerSec: null, padaPauseMs: null, slokaPauseMs: null, countRatio: 1 };

test('the expected time is the learner\'s own, or nothing: never the teacher\'s', () => {
  assert.equal(Math.round(earExpectedMs(plan, user)), Math.round((32 / 2.13) * 1000));
  assert.equal(earExpectedMs(plan, nobody), null);
  assert.equal(earExpectedMs(null, user), null);
  assert.equal(earExpectedMs({ total: 0 }, user), null);
});

test('the position: the count calibrated to the voice, blended with the clock once a speed is known', () => {
  assert.equal(earPositionOf({ count: 27, countRatio: 1.35 }), 20);
  assert.equal(earPositionOf({ count: 27, countRatio: 1 }), 27);
  // 10 s of singing at 2.13 akṣaras/s = 21.3 by the clock; count says 20: the blend sits between
  const p = earPositionOf({ count: 27, countRatio: 1.35, activeMs: 10000, aksPerSec: 2.13, expected: 32 });
  assert.ok(p > 20 && p < 21.3, `blended ${p}`);
  // the clock cannot run past the plan by more than two
  assert.equal(earPositionOf({ count: 60, countRatio: 1, activeMs: 60000, aksPerSec: 5, expected: 32 }), 0.5 * 60 + 0.5 * 34);
});

test('a sloka ends at the plan\'s end and a breath; a little short, a short pause; well short, a long one', () => {
  const base = { expected: 32, sungMs: 9000, ...user };
  assert.equal(earDecision({ ...base, pos: 31.2, pauseMs: 130 }).complete, true);
  assert.equal(earDecision({ ...base, pos: 31.2, pauseMs: 100 }).complete, false);
  assert.equal(earDecision({ ...base, pos: 30.2, pauseMs: 300 }).complete, false); // the sloka pause's 60 %, 500 ms at least, capped at 350: 350 ms needed
  assert.equal(earDecision({ ...base, pos: 30.2, pauseMs: 360 }).complete, true);
  assert.equal(earDecision({ ...base, pos: 20, pauseMs: 1400 }).complete, false);
  assert.equal(longPauseMs(482), 1500);
  const short = earDecision({ ...base, pos: 20, pauseMs: 1500 });
  assert.deepEqual([short.complete, short.by, short.partial, short.dropped], [true, 'pause', false, true]);
  const half = earDecision({ ...base, pos: 12, pauseMs: 1500 });
  assert.deepEqual([half.complete, half.partial], [false, false], 'under half: the long pause alone does not end it');
  const stopped = earDecision({ ...base, pos: 12, pauseMs: STOP_PAUSE_MS });
  assert.deepEqual([stopped.complete, stopped.by, stopped.partial], [true, 'stop', true]);
  assert.equal(earDecision({ ...base, pos: 31, pauseMs: 200, sungMs: 2000 }).complete, false, 'too little sound yet');
  assert.equal(earDecision({ expected: null, pos: 0, pauseMs: 1600, sungMs: 4500 }).by, 'pause', 'no plan: four seconds of sound and a pause');
});

test('a learner the ear does not know: the plan and the pauses decide, nothing from the recording\'s length', () => {
  // the three-sloka take of 16 October: a slow reciter against a brisk recording, breathing
  // 1.5 s at the half-verse with the count at half — the old rule closed here ("over time"
  // at 1.6 × the recording's 7.9 s); the pace-free rule needs three of the default breaths
  const atHalf = earDecision({ pos: 16, expected: 32, pauseMs: 1500, sungMs: 12000, ...nobody });
  assert.equal(atHalf.complete, false);
  assert.equal(longPauseMs(null), 3 * DEFAULT_PADA_PAUSE_MS);
  assert.equal(earDecision({ pos: 16, expected: 32, pauseMs: 1800, sungMs: 12000, ...nobody }).complete, true);
  // with the learner's own time known and well past, the threshold drops to 35 %
  const slow = { aksPerSec: 2.13, padaPauseMs: 482, slokaPauseMs: 515 };
  const expectedMs = earExpectedMs(plan, slow); // 15 s
  assert.equal(earDecision({ pos: 12, expected: 32, pauseMs: 1500, sungMs: 26000, expectedMs, ...slow }).complete, true);
  assert.equal(earDecision({ pos: 12, expected: 32, pauseMs: 1500, sungMs: 20000, expectedMs, ...slow }).complete, false);
});

test('the 17 October counts: the missing pāda is dropped at a long pause, the control closes at its end', () => {
  // missing-pada, no profile: the count read 24 of 32 by 8 s and ran on to 39 (over-count);
  // calibrated (1.6 nuclei per akṣara) the position at the end is 24
  const endOfTake = earDecision({ pos: 24, expected: 32, pauseMs: 1200, sungMs: 11800, ...nobody });
  assert.equal(endOfTake.complete, false, 'a 1.2 s pause is not yet the end');
  const later = earDecision({ pos: 24, expected: 32, pauseMs: 1800, sungMs: 11800, ...nobody });
  assert.deepEqual([later.complete, later.dropped, later.partial], [true, true, false]);
  const control = earDecision({ pos: 31.5, expected: 32, pauseMs: 150, sungMs: 16000, ...nobody });
  assert.deepEqual([control.complete, control.dropped], [true, false]);
});

test('the count ratio learnt from a stretch\'s words', () => {
  assert.equal(calibrateCountRatio({ nuclei: 39, aksharasHeard: 24 }), 1.63);
  assert.equal(calibrateCountRatio({ nuclei: 32, aksharasHeard: 32 }), 1);
  assert.equal(calibrateCountRatio({ nuclei: 7, aksharasHeard: 7 }), null, 'too short to say');
  assert.equal(calibrateCountRatio({ nuclei: 80, aksharasHeard: 20 }), null, 'implausible');
});

test('pāda starts from a recording\'s own pauses', () => {
  // 10 ms frames: CH12-03's shape — sound 0.16–16.18 s, pauses 4.16–4.72, 8.52–8.92, 12.24–12.98 and a few short ones
  const n = 1700;
  const active = new Uint8Array(n).fill(1);
  const off = (a, b) => { for (let k = Math.round(a * 100); k < Math.round(b * 100); k++) active[k] = 0; };
  off(0, 0.16); off(16.18, 17); off(0.84, 1.1); off(2.52, 2.78); off(4.16, 4.72); off(5.42, 5.72); off(8.52, 8.92); off(9.74, 10); off(12.24, 12.98);
  const starts = padaStartsFromPauses(active, 0.01, plan);
  assert.deepEqual(starts.map((s) => [s.pada, Number(s.at.toFixed(2))]), [[1, 0.16], [2, 4.72], [3, 8.92], [4, 12.98]]);
  // a speaker line takes the first pause
  const withLine = padaStartsFromPauses(active, 0.01, { ...plan, speakerLine: true, padas: [8, 8, 8] });
  assert.deepEqual(withLine.map((s) => s.pada), [0, 1, 2, 3]);
  // too few pauses: nothing, so the caller falls back
  const flat = new Uint8Array(1000).fill(1);
  assert.deepEqual(padaStartsFromPauses(flat, 0.01, plan), []);
});

test('earDecision: a learner who goes straight on past the end of the plan closes the sloka there, when the count is calibrated', () => {
  const base = { pos: 44, expected: 44, pauseMs: 0, sungMs: 22000, padaPauseMs: 486, slokaPauseMs: 719 };
  assert.equal(earDecision({ ...base, runOnMs: RUN_ON_MS, ratioKnown: true }).by, 'run-on');
  assert.equal(earDecision({ ...base, runOnMs: RUN_ON_MS - 100, ratioKnown: true }).complete, false, 'not yet half a second on');
  assert.equal(earDecision({ ...base, runOnMs: 2000, ratioKnown: false }).complete, false, 'an uncalibrated count waits for a breath');
  assert.equal(earDecision({ ...base, pos: 43, runOnMs: 2000, ratioKnown: true }).complete, false, 'short of the end: no run-on');
  assert.equal(earDecision({ ...base, pauseMs: 150, runOnMs: 0, ratioKnown: true }).by, 'count', 'a breath closes it as before');
});

test('earDecision: a count a few short with a pause the length of the learner\'s own sloka pause closes the sloka', () => {
  // 21 October, take 06:15: 41.6 of 44 at a 0.95 s breath between the slokas (the learner\'s sloka pause 719 ms)
  const base = { pos: 41.6, expected: 44, sungMs: 21000, padaPauseMs: 486, slokaPauseMs: 719 };
  assert.equal(earDecision({ ...base, pauseMs: 400 }).complete, false, 'a short breath inside the last pāda is not the end');
  assert.equal(earDecision({ ...base, pauseMs: 700 }).by, 'count');
  assert.equal(earDecision({ ...base, pos: 39, pauseMs: 700 }).complete, false, 'under nine tenths of the plan: a long pause is needed');
  assert.equal(earDecision({ pos: 29.5, expected: 32, pauseMs: 850, sungMs: 15000 }).complete, false, 'no sloka pause learnt: nine tenths of the default (900 ms) is needed');
  assert.equal(earDecision({ pos: 29.5, expected: 32, pauseMs: 950, sungMs: 15000 }).by, 'count');
});
