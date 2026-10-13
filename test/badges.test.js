import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attemptQualifies, qualifyingByLearner, countingAttempts, quizBadges, coverageBadges, computeBadges, diffBadges, mergeBadges, badgeEmoji, badgeLine, levelOf, learnerKeyOf, DEVICE } from '../js/badges.js';
import { GITA_VERSES } from '../js/chandas.js';

const item = (id, overall, extra = {}) => ({ id, name: id, matched: true, missing: false, phoneme: overall, vowel: overall, syllable: overall, ...extra });
const attempt = (day, overall, { learner = null, items = null, hour = 7 } = {}) => ({
  at: `${day}T${String(hour).padStart(2, '0')}:00:00`, categories: ['phoneme', 'vowel', 'syllable'], learner,
  items: items || [item('a', overall), item('b', overall)],
});
const quiz = (attempts, id = 'q1') => ({ id, name: 'CH-12 · 2026-10-08', items: [{ id: 'a', name: 'CH12-01' }, { id: 'b', name: 'CH12-02' }], categories: ['phoneme', 'vowel', 'syllable'], attempts });
const p1 = { profileId: 'p1', voiceType: 'child', ageGroup: 'child8to11' };

test('an attempt qualifies when every sloka was recited Excellent with no slip', () => {
  assert.equal(attemptQualifies(attempt('2026-10-08', 95)), true);
  assert.equal(attemptQualifies(attempt('2026-10-08', 88)), false, 'Good is not Excellent');
  assert.equal(attemptQualifies(attempt('2026-10-08', 95, { items: [item('a', 95), item('b', 95, { matched: false })] })), false, 'a sloka not recited');
  assert.equal(attemptQualifies(attempt('2026-10-08', 95, { items: [item('a', 95), item('b', 95, { missing: true })] })), false, 'a sloka not compared');
  assert.equal(attemptQualifies(attempt('2026-10-08', 95, { items: [item('a', 95, { slips: [{ kind: 'restart', pada: 2 }] }), item('b', 95)] })), false, 'a slip');
  assert.equal(attemptQualifies({ at: 'x', items: [] }), false);
  assert.equal(learnerKeyOf(attempt('2026-10-08', 95)), DEVICE);
  assert.equal(learnerKeyOf(attempt('2026-10-08', 95, { learner: p1 })), 'p1');
});

test('three Excellent attempts on three days earn the badge; the same day does not, unless the rule says any day', () => {
  const sameDay = quiz([attempt('2026-10-08', 95, { hour: 7 }), attempt('2026-10-08', 96, { hour: 8 }), attempt('2026-10-08', 97, { hour: 9 })]);
  assert.deepEqual(quizBadges(sameDay), [], 'one sitting');
  const any = quizBadges(sameDay, { differentDays: false });
  assert.equal(any.length, 1);
  assert.deepEqual(any[0].evidence, [1, 2, 3]);
  const days = quiz([attempt('2026-10-06', 95), attempt('2026-10-07', 80), attempt('2026-10-07', 96), attempt('2026-10-08', 97, { hour: 7 }), attempt('2026-10-08', 98, { hour: 8 })]);
  const b = quizBadges(days);
  assert.equal(b.length, 1);
  assert.equal(b[0].id, 'quiz:q1:excellent');
  assert.equal(b[0].learner, DEVICE);
  assert.equal(b[0].level, 1);
  assert.deepEqual(b[0].evidence, [1, 3, 4], 'one attempt per day: the Good one and the second of the 8th do not count');
  assert.equal(b[0].earnedAt, '2026-10-08T07:00:00');
  assert.deepEqual(b[0].items, ['a', 'b']);
  assert.equal(qualifyingByLearner(days).get(DEVICE).length, 4);
  assert.equal(countingAttempts(qualifyingByLearner(days).get(DEVICE)).length, 3);
});

test('levels at five and ten; learners apart; chapter and Gītā badges from the verses covered', () => {
  const days = Array.from({ length: 10 }, (_, i) => attempt(`2026-10-${String(i + 1).padStart(2, '0')}`, 95, { learner: p1 }));
  assert.equal(quizBadges(quiz(days.slice(0, 4)))[0].level, 1);
  assert.equal(quizBadges(quiz(days.slice(0, 5)))[0].level, 2);
  const ten = quizBadges(quiz(days))[0];
  assert.equal(ten.level, 3);
  assert.equal(ten.levelAt.length, 3);
  assert.equal(badgeEmoji(ten), '🏅⭐⭐');
  assert.equal(levelOf(2), 0);
  const mixed = quiz([...days.slice(0, 3), attempt('2026-10-04', 95), attempt('2026-10-05', 95), attempt('2026-10-06', 95)]);
  const both = quizBadges(mixed);
  assert.deepEqual(both.map((b) => b.learner).sort(), [DEVICE, 'p1']);
  // chapter 12 by heart: a quiz badge over slokas linked to all its 20 verses
  const ch12 = { id: 'q12', name: 'Chapter 12', items: Array.from({ length: GITA_VERSES[12] }, (_, i) => ({ id: `s${i + 1}`, name: `CH12-${i + 1}` })), categories: ['phoneme'], attempts: days.slice(0, 3).map((a) => ({ ...a, categories: ['phoneme'], items: Array.from({ length: GITA_VERSES[12] }, (_, i) => item(`s${i + 1}`, 95)) })) };
  const verseIdsOf = (id) => (/^s\d+$/.test(id) ? [`12.${id.slice(1)}`] : []);
  const all = computeBadges([ch12, quiz(days.slice(0, 3))], { verseIdsOf });
  assert.ok(all.some((b) => b.kind === 'chapter' && b.chapter === 12 && b.learner === 'p1'), JSON.stringify(all.map((b) => b.id)));
  assert.ok(!all.some((b) => b.kind === 'gita'));
  assert.equal(coverageBadges([], verseIdsOf).length, 0);
  assert.ok(badgeLine(ten).startsWith('🏅⭐⭐ CH-12 · 2026-10-08 — mastered · level 3 on '));
});

test('awards are idempotent: what is new against what was, and the merge keeps the rest', () => {
  const q = quiz([attempt('2026-10-06', 95), attempt('2026-10-07', 96), attempt('2026-10-08', 97)]);
  const first = quizBadges(q);
  assert.equal(diffBadges([], first).length, 1);
  assert.equal(diffBadges([], first)[0].change, 'earned');
  assert.deepEqual(diffBadges(first, first), [], 'the same attempts award nothing twice');
  const other = [{ id: 'quiz:q2:excellent', kind: 'quiz', quizId: 'q2', learner: DEVICE, level: 1, earnedAt: '2026-09-01T07:00:00' }];
  const merged = mergeBadges([...other, ...first], first);
  assert.equal(merged.length, 2, 'the other quiz\'s badge is kept');
  const more = quizBadges(quiz([...q.attempts, attempt('2026-10-09', 95), attempt('2026-10-10', 95)]));
  const raised = diffBadges(first, more);
  assert.equal(raised.length, 1);
  assert.equal(raised[0].change, 'raised');
  assert.equal(raised[0].from, 1);
  const merged2 = mergeBadges(first, more);
  assert.equal(merged2[0].level, 2);
  assert.equal(merged2[0].earnedAt, first[0].earnedAt, 'the day it was first earned stays');
});
