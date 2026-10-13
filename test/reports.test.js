import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodRange, shiftPeriod, inRange, isoDate, assessmentsFromQuiz, assessmentFromSession, slokaRows, summarize, progress, dayStreak, weekStreak } from '../js/reports.js';

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
  // an attempt judged with tolerances off keeps its overall and grade but has no correctness
  const off = assessmentsFromQuiz({ ...quiz, attempts: [{ ...quiz.attempts[0], tolerance: null, noTolerance: true }] })[0];
  assert.equal(off.overall, 47);
  assert.equal(off.grade, 'practice');
  assert.equal(off.correct, null);
  assert.equal(off.tolerance, null);
  assert.equal(assessmentFromSession({ ...session, noTolerance: true }).tolerance, null);
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

// A take of one sloka on a day, as an assessment the progress arithmetic reads.
const takeOn = (day, overall, { id = 'a', name = 'CH12-03', key = null, kind = 'evaluation', quizId = null, learner = null, grade = null, hour = 7 } = {}) => {
  const g = grade || (overall >= 90 ? 'excellent' : overall >= 80 ? 'good' : overall >= 65 ? 'fair' : 'practice');
  return { key: key || `${kind}:${day}:${hour}:${id}`, kind, quizId, at: `${day}T${String(hour).padStart(2, '0')}:00:00`, learner, overall, grade: g, items: [{ id, name, matched: true, missing: false, overall, grade: g }] };
};

test('streaks: consecutive days, and weeks of three practice days', () => {
  assert.equal(dayStreak(['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-08'], '2026-10-08'), 3);
  assert.equal(dayStreak(['2026-10-06', '2026-10-08'], '2026-10-08'), 1, 'a gap ends the streak');
  assert.equal(dayStreak([], '2026-10-08'), 0);
  const days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'];
  assert.equal(weekStreak(days, '2026-10-08'), 2, 'two weeks with three days each');
  assert.equal(weekStreak(days.slice(3), '2026-10-08'), 1);
  assert.equal(weekStreak(['2026-10-05', '2026-10-06'], '2026-10-08'), 0, 'two days are not a week of practice');
});

test('progress: a first Excellent, a new best, a climb, persistence, a streak, a welcome back, a plateau', () => {
  const first = progress([takeOn('2026-10-08', 72)]);
  assert.deepEqual(first.moments, [], 'nothing is said about a single take');
  assert.equal(first.slokas.a.takes, 1);
  // a new best, and a first Excellent, with three days running
  const list = [takeOn('2026-10-06', 72), takeOn('2026-10-07', 78), takeOn('2026-10-08', 91)];
  const p = progress(list);
  assert.deepEqual(p.moments.map((m) => m.kind), ['firstExcellent', 'newBest']);
  assert.ok(p.all.some((m) => m.kind === 'dayStreak' && m.text === '3 days in a row'), JSON.stringify(p.all));
  assert.equal(p.slokas.a.best, 78, 'the best before this take, for "not your best"');
  assert.equal(p.streak.days, 3);
  // a climb: the best of the last three takes 5 above the best of the three before
  const climb = [takeOn('2026-09-28', 70), takeOn('2026-09-29', 74), takeOn('2026-09-30', 72), takeOn('2026-10-06', 79), takeOn('2026-10-07', 77), takeOn('2026-10-08', 80)];
  const c = progress(climb);
  assert.ok(c.all.some((m) => m.kind === 'climbing' && m.text === 'Up 6 points on CH12-03 since last week'), JSON.stringify(c.all));
  assert.ok(c.all.some((m) => m.kind === 'longClimb' && m.text.includes('from Fair to Good')), JSON.stringify(c.all));
  // persistence: three takes today, the last the best
  const day = [takeOn('2026-10-08', 70, { hour: 7 }), takeOn('2026-10-08', 74, { hour: 8 }), takeOn('2026-10-08', 76, { hour: 9 })];
  assert.ok(progress(day).all.some((m) => m.kind === 'persistence' && m.text.startsWith('You kept at it: 3 takes')));
  assert.ok(!progress([day[0], day[2], takeOn('2026-10-08', 71, { hour: 10 })]).all.some((m) => m.kind === 'persistence'), 'not when the last take was not the best');
  // a welcome back after two weeks away
  assert.ok(progress([takeOn('2026-09-20', 80), takeOn('2026-10-08', 78)]).moments.some((m) => m.kind === 'welcomeBack'));
  // a plateau shows alone
  const flat = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-06', '2026-10-08'].map((d) => takeOn(d, 60));
  const f = progress(flat);
  assert.equal(f.moments.length, 1);
  assert.equal(f.moments[0].kind, 'plateau');
  // the learner: a profile's takes are its own; none chosen means the takes with no learner
  const mixed = [takeOn('2026-10-07', 70, { learner: { profileId: 'p1' } }), takeOn('2026-10-08', 95, { learner: { profileId: 'p1' } }), takeOn('2026-10-08', 50)];
  assert.ok(progress(mixed, { profileId: 'p1' }).moments.some((m) => m.kind === 'newBest'));
  assert.deepEqual(progress(mixed).moments, [], 'the device alone has one take');
  // `current` names an older take: nothing after it counts
  assert.deepEqual(progress(list, { current: list[1].key }).moments.map((m) => m.kind), ['newBest'], 'an older take as current: only what came before it counts');
  // a quiz: first Excellent and best on the quiz itself
  const q = [takeOn('2026-10-07', 82, { kind: 'quiz', quizId: 'q1', id: 'x' }), takeOn('2026-10-08', 93, { kind: 'quiz', quizId: 'q1', id: 'x' })];
  const pq = progress(q);
  assert.ok(pq.all.some((m) => m.kind === 'firstExcellent' && m.quizId === 'q1'));
  assert.equal(pq.quizzes.q1.excellent, 1);
});

test('a session with a sloka recited under half: the overall over the recited, the grade Needs practice', () => {
  const s = { id: 's9', kind: 'evaluation', at: '2026-10-13T10:00:00', items: [
    { id: 'a', name: 'CH12-03', matched: true, missing: false, phoneme: 96, vowel: 95, syllable: 97, emphasis: 90, pitch: 85, phrasing: 80, timing: 90, slips: [] },
    { id: 'b', name: 'CH12-04', matched: false, missing: false, partial: true, phoneme: 0, vowel: 0, syllable: 0, emphasis: 0, pitch: 0, phrasing: 0, timing: 0, slips: [{ kind: 'partial', count: 15, expected: 32, by: 'ear' }] },
  ] };
  const a = assessmentFromSession(s);
  assert.equal(a.recited, 1);
  assert.ok(a.overall >= 90, `overall ${a.overall}`);
  assert.equal(a.grade, 'practice');
  assert.equal(a.items[1].grade, 'practice');
  assert.equal(a.items[1].overall, 0);
});
