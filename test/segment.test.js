import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pausesOf, expectations, cutsFor, fitCuts, segmentTake, playRangeOf, MIN_GAP_SEC, adoptCuts } from '../js/dsp/segment.js';

const HOP = 0.02;
// A take: slokas of the given sung seconds, each in four pādas with a breath of `padaGap`
// between them, `slokaGap` between slokas, and a lead and tail of silence. Returns the
// activity mask and the true boundaries (where each sloka's sound begins and ends).
// `slokaGaps` may give the breath before each sloka from the second on (0: no breath — the
// learner goes straight on). The level: chant at −30 dB with a dip every 0.35 s (the syllables),
// silence at −60 dB.
// `speakers` gives, per sloka, the seconds of a speaker line sung before its pādas, with a breath after it.
function take(slokaSecs, { padaGap = 0.4, slokaGap = 0.8, slokaGaps = null, speakers = null, lead = 0.5, tail = 0.5 } = {}) {
  const frames = [];
  const truth = [];
  const push = (on, sec) => { for (let k = 0; k < Math.round(sec / HOP); k++) frames.push(on ? 1 : 0); };
  push(false, lead);
  slokaSecs.forEach((s, i) => {
    if (i) push(false, slokaGaps ? slokaGaps[i - 1] : slokaGap);
    const from = frames.length * HOP;
    if (speakers && speakers[i]) { push(true, speakers[i]); push(false, padaGap); }
    for (let p = 0; p < 4; p++) { if (p) push(false, padaGap); push(true, s / 4); }
    truth.push({ from, to: frames.length * HOP });
  });
  push(false, tail);
  const rmsDb = Float32Array.from(frames, (on, k) => (on ? -30 + 5 * Math.sin((2 * Math.PI * k * HOP) / 0.35) - 5 : -60));
  return { F: { active: Uint8Array.from(frames), rmsDb, hopSec: HOP }, truth };
}
const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

test('pausesOf: the gaps between the first and last sound, a quarter second or longer', () => {
  const { F } = take([4, 4]);
  const p = pausesOf(F.active, HOP);
  assert.equal(p.first, 0.5);
  assert.equal(p.gaps.length, 7, 'three pāda breaths per sloka and one between');
  assert.ok(p.gaps.every((g) => g.len >= MIN_GAP_SEC));
  assert.equal(p.gaps[3].len, 0.8, 'the breath between the slokas');
  assert.deepEqual(pausesOf(new Uint8Array(100), HOP).gaps, []);
});

test('expectations: by the teacher at the tempo, by the plan at the speed, by the shares', () => {
  const items = [{ name: 'A', teacherSec: 10, total: 32 }, { name: 'B', teacherSec: 5, total: 16 }];
  const e = expectations(items, { tempoRatio: 1.5, aksPerSec: 2 }, 30);
  assert.deepEqual(e.teacher, [15, 7.5]);
  assert.deepEqual(e.plan, [16, 8]);
  assert.deepEqual(e.share, [20, 10]);
  const none = expectations(items, null, 30);
  assert.equal(none.teacher, null);
  assert.equal(none.plan, null);
  assert.deepEqual(none.share, [20, 10]);
});

test('cutsFor: three slokas cut at the breaths between them, not at the pāda breaths, by the plan at the speed', () => {
  const { F, truth } = take([12, 9, 12]);
  const items = [{ name: 'A', total: 32 }, { name: 'B', total: 24 }, { name: 'C', total: 32 }];
  const exp = items.map((it) => it.total / 2.8); // a little off the true 2.67 akṣaras a second
  const r = cutsFor(F, items, exp);
  assert.ok(r, 'enough pauses');
  assert.equal(r.segments.length, 3);
  r.segments.forEach((s, i) => { assert.ok(near(s.from, truth[i].from), `sloka ${i} begins at ${s.from}, truth ${truth[i].from}`); assert.ok(near(s.to, truth[i].to), `sloka ${i} ends at ${s.to}, truth ${truth[i].to}`); });
  assert.equal(r.boundaries.length, 2);
  assert.equal(r.boundaries[0].len, 0.8, 'the cut is the breath between the slokas');
  assert.ok(r.boundaries[0].runnerUp.extraCost > 0.05, `the next-best pause costs clearly more: ${r.boundaries[0].runnerUp.extraCost}`);
});

test('fitCuts: the last sloka cut short by the stop still leaves the others whole — the partial-last hypothesis wins', () => {
  const { F, truth } = take([12, 9, 4]); // the third sloka: a third of it
  const items = [{ name: 'A', total: 32 }, { name: 'B', total: 24 }, { name: 'C', total: 32 }];
  const r = fitCuts(F, items, items.map((it) => it.total / 2.67));
  assert.equal(r.hypothesis, 'partialLast');
  assert.ok(near(r.segments[0].to, truth[0].to), `the first sloka ends at ${r.segments[0].to}, truth ${truth[0].to}`);
  assert.ok(near(r.segments[1].to, truth[1].to), `the second sloka ends at ${r.segments[1].to}, truth ${truth[1].to}`);
  assert.ok(Math.abs(r.scale - 1) < 0.2, `the scale stays near the learnt pace: ${r.scale}`);
});

test('fitCuts: a learner a quarter faster than the ear learnt is fitted by the scale, and the cuts hold', () => {
  const { F, truth } = take([12, 9, 12]);
  const items = [{ name: 'A', total: 32 }, { name: 'B', total: 24 }, { name: 'C', total: 32 }];
  const r = fitCuts(F, items, items.map((it) => it.total / 2.1)); // the ear thinks 2.1 akṣaras a second; the take runs at 2.67
  assert.equal(r.hypothesis, 'whole');
  assert.ok(r.scale < 0.9 && r.scale > 0.7, `the scale found the faster pace: ${r.scale}`);
  r.segments.forEach((s, i) => assert.ok(near(s.to, truth[i].to), `sloka ${i} ends at ${s.to}, truth ${truth[i].to}`));
  // without the fit, the plain cuts at the learnt pace would lengthen the first slokas
  const plain = cutsFor(F, items, items.map((it) => it.total / 2.1));
  assert.ok(plain.cost > r.cost, 'the fitted cuts cost less than the unfitted');
});

test('cutsFor: a cut the student made by turning the page pins the boundary, whatever the lengths say', () => {
  const { F, truth } = take([12, 9, 12]);
  const items = [{ name: 'A', total: 32 }, { name: 'B', total: 24 }, { name: 'C', total: 32 }];
  const exp = items.map((it) => it.total / 2.67);
  // the student turned the page a line early into B: the pause at the first pāda breath of B
  const early = truth[1].from + 9 / 4 + 0.2;
  const r = cutsFor(F, items, exp, { pinned: [{ after: 1, at: truth[1].to + 0.3 }, { after: 0, at: early }] });
  assert.ok(r.boundaries[0].pinned && r.boundaries[1].pinned);
  assert.ok(near(r.segments[0].to, truth[1].from + 9 / 4, 0.45), `the first cut follows the student: ${r.segments[0].to}`);
  assert.ok(near(r.segments[1].to, truth[1].to), `the second cut at the true end: ${r.segments[1].to}`);
  // a pin far from any pause is ignored
  const far = cutsFor(F, items, exp, { pinned: [{ after: 0, at: 100 }] });
  assert.ok(!far.boundaries[0].pinned);
});

test('cutsFor: no breath between the first two slokas — the cut goes through the sound near where the lengths put it', () => {
  const { F, truth } = take([12, 9, 12], { slokaGaps: [0, 0.8] });
  const items = [{ name: 'A', total: 32 }, { name: 'B', total: 24 }, { name: 'C', total: 32 }];
  const r = cutsFor(F, items, items.map((it) => it.total / 2.67));
  assert.ok(r.valleys > 0, 'the runs of sound offered their valleys');
  assert.ok(r.boundaries[0].virtual, 'the first cut went through the sound');
  assert.ok(Math.abs(r.segments[0].to - truth[0].to) < 0.7, `the first cut near the truth: ${r.segments[0].to} vs ${truth[0].to}`);
  assert.ok(!r.boundaries[1].virtual && near(r.segments[1].to, truth[1].to), 'the second cut at the breath');
});

test('segmentTake: a take stopped before its last sloka places only the slokas it reached', () => {
  const { F, truth } = take([12, 9]);
  const items = [{ name: 'A', total: 32 }, { name: 'B', total: 24 }, { name: 'C', total: 32 }];
  const r = segmentTake(F, items, { pace: { aksPerSec: 2.67 }, recited: 2, lastPos: 1 });
  assert.equal(r.recited, 2);
  const segs = r.results.plan.segments;
  assert.equal(segs.length, 3);
  assert.ok(near(segs[0].to, truth[0].to) && near(segs[1].to, truth[1].to));
  assert.ok(segs[2].notRecited && segs[2].from == null);
});

test('playRangeOf: a sloka plays from its first sound after the breath to the end of its last, whatever the window', () => {
  const { F, truth } = take([12, 9, 12]);
  // the comparison's window for the second sloka: half a second early (inside the first sloka's tail) and ending in its own trailing quiet
  const win = [truth[1].from - 0.5, truth[1].to + 0.4];
  const r = playRangeOf(F, win);
  assert.ok(near(r[0], truth[1].from, 0.03), `starts at its first sound: ${r[0]} vs ${truth[1].from}`);
  assert.ok(near(r[1], truth[1].to + 0.15, 0.03), `ends after its last sound: ${r[1]} vs ${truth[1].to + 0.15}`);
  // a window that ends inside the sloka's last line: the sound runs on, so the end follows it (at most a second)
  const short = playRangeOf(F, [truth[1].from, truth[1].to - 0.6]);
  assert.ok(near(short[1], truth[1].to + 0.15, 0.03), `runs on to the sound's end: ${short[1]}`);
  // no features: the window as it is
  assert.deepEqual(playRangeOf(null, [1, 2]), [1, 2]);
});

test('segmentTake: with no pace the take shares itself out by the akṣaras; with a pace the plan method is chosen', () => {
  const { F, truth } = take([12, 9, 12]);
  const items = [{ name: 'A', teacherSec: 8, total: 32 }, { name: 'B', teacherSec: 6, total: 24 }, { name: 'C', teacherSec: 8, total: 32 }];
  const none = segmentTake(F, items);
  assert.equal(none.chosen, 'share');
  assert.equal(none.results.plan, undefined);
  none.results.share.segments.forEach((s, i) => assert.ok(near(s.to, truth[i].to), `share: sloka ${i} ends at ${s.to}`));
  const paced = segmentTake(F, items, { pace: { tempoRatio: 1.5, aksPerSec: 2.67 } });
  assert.equal(paced.chosen, 'plan');
  assert.ok(paced.results.teacher && paced.results.plan && paced.results.share);
  paced.results.teacher.segments.forEach((s, i) => assert.ok(near(s.to, truth[i].to), `teacher: sloka ${i} ends at ${s.to}`));
  assert.equal(paced.pauses, 11);
  assert.equal(paced.items[1].total, 24);
  // too few pauses for the cuts: no result for that method
  const flat = { active: Uint8Array.from({ length: 500 }, () => 1), hopSec: HOP };
  assert.equal(segmentTake(flat, items).results.share, null);
});

test('adoptCuts: the second opinion\'s cuts where they and the ear\'s differ by half a second or more, within bounds', () => {
  // the recital of 18.1–18.4 on 1 November 2026: the ear two and four seconds late after the first cut
  const segs = [{ id: 'a', name: 'CH18-01', from: -0.82, to: 17.18 }, { id: 'b', name: 'CH18-02', from: 17.18, to: 37.62 }, { id: 'c', name: 'CH18-03', from: 37.62, to: 53.66 }, { id: 'd', name: 'CH18-04', from: 53.66, to: 68.47 }];
  const bounds = [{ from: 16.8, to: 17.36, pinned: true }, { from: 35.28, to: 35.8 }, { from: 49.78, to: 50.32 }];
  assert.deepEqual(adoptCuts(segs, bounds), [{ i: 1, from: 37.62, to: 35.54 }, { i: 2, from: 53.66, to: 50.05 }]);
  // the student's own cut stands; a cut the words moved on both sides stands; a cut through sound (virtual) is not taken; a cut far off is not trusted either way
  assert.deepEqual(adoptCuts([{ ...segs[1], byHand: 'key' }, segs[2]], [bounds[1]]), []);
  assert.deepEqual(adoptCuts([{ ...segs[1], refined: true }, { ...segs[2], refined: true }], [bounds[1]]), []);
  assert.deepEqual(adoptCuts([segs[1], segs[2]], [{ ...bounds[1], virtual: true }]), []);
  assert.deepEqual(adoptCuts([segs[1], segs[2]], [{ from: 30.5, to: 31 }]), []);
  // agreeing within half a second: nothing moves
  assert.deepEqual(adoptCuts([segs[0], segs[1]], [bounds[0]]), []);
  assert.deepEqual(adoptCuts(null, bounds), []);
});
