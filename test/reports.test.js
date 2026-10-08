import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodRange, shiftPeriod, inRange, isoDate, assessmentsFromQuiz, assessmentFromSession, slokaRows, summarize } from '../js/reports.js';

test('periods: a day, a Monday-to-Sunday week, a month, everything', () => {
  const day = periodRange('day', '2026-10-08');
  assert.equal(isoDate(day.from), '2026-10-08');
  assert.equal(isoDate(day.to), '2026-10-09');
  const week = periodRange('week', '2026-10-08'); // a Thursday
  assert.equal(isoDate(week.from), '2026-10-05');
  assert.equal(isoDate(week.to), '2026-10-12');
  assert.ok(/^Week of 5–11 /.test(week.label), week.label);
  const sun = periodRange('week', '2026-10-11');
  assert.equal(isoDate(sun.from), '2026-10-05', 'a Sunday belongs to the week that began the Monday before');
  const month = periodRange('month', '2026-10-08');
  assert.equal(isoDate(month.from), '2026-10-01');
  assert.equal(isoDate(month.to), '2026-11-01');
  assert.equal(periodRange('all', '2026-10-08').from, null);
  assert.equal(shiftPeriod('day', '2026-10-31', 1), '2026-11-01');
  assert.equal(shiftPeriod('week', '2026-10-08', -1), '2026-10-01');
  assert.equal(shiftPeriod('month', '2026-01-31', 1), '2026-02-01');
  assert.equal(inRange('2026-10-08T23:30:00', day), true);
  assert.equal(inRange('2026-10-09T00:10:00', day), false);
  assert.equal(inRange('2026-10-09T00:10:00', periodRange('all')), true);
});

const quiz = {
  id: 'q1', name: 'CH-12 · 2026-10-08 06:58', categories: ['content', 'pronunciation'],
  items: [{ id: 'a', name: 'CH12-01', folder: 'CH-12' }, { id: 'b', name: 'CH12-02', folder: 'CH-12' }],
  attempts: [
    { at: '2026-10-08T06:59:00Z', takeDuration: 20, score: 0, items: [{ id: 'a', name: 'CH12-01', folder: 'CH-12', matched: false, missing: false, content: 0, pronunciation: 0, timing: 0, pitch: 0, dynamics: 0 }, { id: 'b', name: 'CH12-02', folder: 'CH-12', matched: true, missing: false, content: 95, pronunciation: 90, timing: 100, pitch: 80, dynamics: 100 }] },
    { at: '2026-10-09T07:00:00Z', takeDuration: 21, items: [{ id: 'a', name: 'CH12-01', folder: 'CH-12', matched: true, missing: false, content: 98, pronunciation: 92, timing: 100, pitch: 90, dynamics: 100 }, { id: 'b', name: 'CH12-02', folder: 'CH-12', matched: true, missing: true }], audio: 'attempt-2.wav' },
  ],
};
const session = {
  id: 's1', kind: 'evaluation', at: '2026-10-08T08:00:00Z', takeDuration: 18, audio: 'take.wav',
  items: [{ id: 'c', name: 'CH18-66', folder: 'CH-18', matched: true, missing: false, content: 90, pronunciation: null, timing: 85, pitch: 70, dynamics: 95 }],
};

test('quiz attempts and evaluation sessions come out in one shape', () => {
  const qs = assessmentsFromQuiz(quiz);
  assert.equal(qs.length, 2);
  assert.equal(qs[0].kind, 'quiz');
  assert.equal(qs[0].key, 'quiz:q1:1');
  assert.equal(qs[0].name, quiz.name);
  // item overall on the chosen categories: (80·95 + 70·90) / 150 = 92.7 → 93; the unmatched one 0 → mean 46.5 → 47
  assert.equal(qs[0].items[1].overall, 93);
  assert.equal(qs[0].items[0].overall, 0);
  assert.equal(qs[0].overall, 47);
  assert.equal(qs[0].grade, 'practice');
  assert.equal(qs[0].correct, 50);
  assert.equal(qs[0].audio, false);
  assert.deepEqual(qs[0].folders, ['CH-12']);
  assert.equal(qs[1].audio, true);
  assert.equal(qs[1].counted, 1, 'a missing item is left out');
  assert.equal(qs[1].items[1].overall, null);
  const s = assessmentFromSession(session);
  assert.equal(s.kind, 'evaluation');
  assert.equal(s.key, 'session:s1');
  // every category, pronunciation unjudged: (80·90 + 40·85 + 40·70 + 40·95) / 200 = 86
  assert.equal(s.items[0].overall, 86);
  assert.equal(s.overall, 86);
  assert.equal(s.grade, 'good');
  assert.equal(s.correct, null);
  assert.equal(assessmentFromSession({ ...session, kind: 'teach' }).name, 'Teach');
  // a sloka ticked but not recited does not pull an evaluation down (unlike a quiz)
  const two = assessmentFromSession({ ...session, items: [...session.items, { id: 'd', name: 'CH18-67', folder: 'CH-18', matched: false, missing: false, content: 0, pronunciation: 0, timing: 0, pitch: 0, dynamics: 0 }] });
  assert.equal(two.overall, 86);
  assert.equal(two.recited, 1);
  assert.equal(assessmentFromSession({ ...session, items: [{ ...session.items[0], matched: false, content: 0 }] }).overall, 0, 'nothing recited scores 0');
});

test('the folder view: one line per sloka, newest first, a folder and its subfolders', () => {
  const all = [...assessmentsFromQuiz(quiz), assessmentFromSession(session)];
  const rows = slokaRows(all);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].at, '2026-10-09T07:00:00Z');
  assert.equal(rows[0].sloka, 'CH12-01');
  assert.equal(rows[0].overall, Math.round((80 * 98 + 70 * 92) / 150));
  const ch12 = slokaRows(all, { folder: 'CH-12' });
  assert.equal(ch12.length, 4);
  assert.ok(ch12.every((r) => r.folder === 'CH-12'));
  assert.equal(slokaRows(all, { folder: 'CH-18' }).length, 1);
  assert.equal(slokaRows(all, { folder: 'CH' }).length, 0, 'a prefix is not a parent folder');
  assert.equal(slokaRows([{ ...all[2], items: [{ ...all[2].items[0], folder: 'CH-18/extra' }] }], { folder: 'CH-18' }).length, 1, 'subfolders count');
  const sum = summarize(all);
  assert.deepEqual({ count: sum.count, quizzes: sum.quizzes, evaluations: sum.evaluations, slokas: sum.slokas }, { count: 3, quizzes: 2, evaluations: 1, slokas: 3 });
  assert.equal(sum.best, Math.max(all[1].overall, 86));
});
