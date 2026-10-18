// The reports dashboard's arithmetic: periods (a day, a week, a month), quiz attempts and
// evaluation sessions brought into one shape ("assessments"), and the per-sloka rows of the
// folder view. Pure; shared by the browser and the server, and tested in Node.

import { QUIZ_CATEGORIES, itemOverall, attemptOverall, gradeWithSlips, anySlips, isPartial, correctness, recordTolerance, normalizeWeights, CATEGORY_WEIGHTS } from './quizscore.js';

export const PERIODS = ['day', 'week', 'month', 'all'];
const CAT_IDS = QUIZ_CATEGORIES.map((c) => c.id);
const DAY_MS = 86400000;

// "2026-10-08" for a Date, in local time.
export function isoDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const parseDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(); };

// The span a period covers around `dateStr` (local time): { from, to } with `to` exclusive
// (null for everything), and a label. Weeks run Monday to Sunday.
export function periodRange(period, dateStr) {
  const d = parseDate(dateStr);
  const fmt = (x, opts) => x.toLocaleDateString(undefined, opts);
  if (period === 'day') {
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return { from, to: new Date(from.getTime() + DAY_MS), label: fmt(from, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) };
  }
  if (period === 'week') {
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
    const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7);
    const last = new Date(to.getTime() - DAY_MS);
    const sameMonth = from.getMonth() === last.getMonth();
    const label = sameMonth
      ? `${from.getDate()}–${last.getDate()} ${fmt(last, { month: 'short', year: 'numeric' })}`
      : `${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(last, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    return { from, to, label: `Week of ${label}` };
  }
  if (period === 'month') {
    const from = new Date(d.getFullYear(), d.getMonth(), 1);
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return { from, to, label: fmt(from, { month: 'long', year: 'numeric' }) };
  }
  return { from: null, to: null, label: 'All time' };
}

// The same period, `delta` periods later (or earlier), as a date string.
export function shiftPeriod(period, dateStr, delta) {
  const d = parseDate(dateStr);
  if (period === 'day') return isoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta));
  if (period === 'week') return isoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * delta));
  if (period === 'month') return isoDate(new Date(d.getFullYear(), d.getMonth() + delta, 1));
  return dateStr;
}

export function inRange(at, range) {
  if (!range || !range.from) return true;
  const t = new Date(at).getTime();
  return t >= range.from.getTime() && t < range.to.getTime();
}

const itemWithOverall = (it, categories, weights = CATEGORY_WEIGHTS) => {
  const overall = it && !it.missing ? itemOverall(it, categories, weights) : null; // its self-corrections taken off
  const g = gradeWithSlips(overall, it && it.slips); // a slip (a restart, a stall…): Needs practice, whatever the score
  return { ...it, overall, grade: g ? g.id : null };
};
const weightsOf = (rec) => (rec && rec.weights ? normalizeWeights(rec.weights) : CATEGORY_WEIGHTS);
const foldersOf = (items) => [...new Set((items || []).map((it) => it.folder || ''))];

// A quiz's attempts as assessments: scored on the quiz's current categories and each
// attempt's own tolerance (null when it was judged with tolerances off: no correctness),
// the way the quiz view shows them.
export function assessmentsFromQuiz(quiz) {
  const attempts = Array.isArray(quiz.attempts) ? quiz.attempts : [];
  const categories = quiz.categories || [];
  return attempts.map((a, i) => {
    const tolerance = recordTolerance(a);
    const weights = weightsOf(a);
    const items = (a.items || []).map((it) => itemWithOverall(it, categories, weights));
    const overall = items.length ? attemptOverall(items, categories, weights) : a.overall == null ? null : a.overall;
    const corr = items.length ? correctness(items, categories, tolerance) : null;
    const g = gradeWithSlips(overall, anySlips(items) ? [{ kind: 'restart' }] : null);
    return {
      key: `quiz:${quiz.id}:${i + 1}`, kind: 'quiz', quizId: quiz.id, attempt: i + 1, at: a.at,
      name: quiz.name, categories, tolerance, weights, learner: a.learner || null,
      items, overall, grade: g ? g.id : null, correct: corr ? corr.pct : a.score == null ? null : a.score,
      counted: corr ? corr.counted : a.counted, recited: a.recited ?? items.filter((it) => it.matched).length,
      audio: !!a.audio, folders: foldersOf(items), takeDuration: a.takeDuration || null,
    };
  });
}

// An evaluation (or Teach) session as an assessment: every category counts, and the
// session's overall is the mean over the slokas actually recited (in Self Evaluation one
// often ticks several slokas and recites one; a quiz, by contrast, expects them all).
export function assessmentFromSession(s) {
  const weights = weightsOf(s);
  const items = (s.items || []).map((it) => itemWithOverall(it, CAT_IDS, weights));
  const recited = items.filter((it) => it.matched);
  const overall = recited.length ? attemptOverall(recited, CAT_IDS, weights) : items.length ? 0 : s.overall == null ? null : s.overall;
  const g = gradeWithSlips(overall, anySlips(recited) || items.some((it) => it.partial || isPartial(it.slips)) ? [{ kind: 'restart' }] : null); // a slip, or a sloka under half recited: Needs practice
  return {
    key: `session:${s.id}`, kind: s.kind === 'teach' ? 'teach' : 'evaluation', sessionId: s.id, at: s.at,
    name: s.kind === 'teach' ? 'Teach' : 'Self Evaluation', categories: CAT_IDS, tolerance: recordTolerance(s), weights, learner: s.learner || null,
    items, overall, grade: g ? g.id : null, correct: null,
    counted: items.filter((it) => !it.missing).length, recited: items.filter((it) => it.matched).length,
    audio: !!s.audio, folders: foldersOf(items), takeDuration: s.takeDuration || null,
  };
}

export const KIND_LABEL = { quiz: 'Quiz', evaluation: 'Self Evaluation', teach: 'Teach' };

// Newest first.
export const byDateDesc = (a, b) => String(b.at).localeCompare(String(a.at));

const inFolder = (f, folder) => !folder || f === folder || String(f || '').startsWith(`${folder}/`);

// One line per sloka per assessment: the folder view. `folder` keeps a folder and its
// subfolders; '' or null keeps everything.
export function slokaRows(assessments, { folder = null } = {}) {
  const rows = [];
  for (const a of assessments) {
    for (const it of a.items || []) {
      if (!inFolder(it.folder || '', folder)) continue;
      rows.push({
        key: `${a.key}:${it.id}`, assessment: a.key, at: a.at, kind: a.kind, name: a.name,
        slokaId: it.id, sloka: it.name, folder: it.folder || '', matched: !!it.matched, missing: !!it.missing,
        phoneme: it.phoneme ?? null, vowel: it.vowel ?? null, syllable: it.syllable ?? null, emphasis: it.emphasis ?? null, pitch: it.pitch ?? null, phrasing: it.phrasing ?? null, timing: it.timing ?? null,
        content: it.content ?? null, pronunciation: it.pronunciation ?? null, dynamics: it.dynamics ?? null,
        overall: it.overall ?? null, grade: it.grade || null, slips: Array.isArray(it.slips) ? it.slips : [],
      });
    }
  }
  return rows.sort(byDateDesc);
}

// What a set of assessments adds up to: how many, the mean overall, the best.
export function summarize(assessments) {
  const scored = assessments.filter((a) => a.overall != null);
  const mean = scored.length ? Math.round(scored.reduce((s, a) => s + a.overall, 0) / scored.length) : null;
  const best = scored.length ? Math.max(...scored.map((a) => a.overall)) : null;
  const slokas = new Set();
  for (const a of assessments) for (const it of a.items || []) if (!it.missing) slokas.add(it.id);
  return { count: assessments.length, quizzes: assessments.filter((a) => a.kind === 'quiz').length, evaluations: assessments.filter((a) => a.kind !== 'quiz').length, mean, best, slokas: slokas.size };
}

// ---------- progress: persistence and improvement, from the history alone ----------
// What the history says about the assessment `current` (by key; the learner's latest when
// not given) for one learner: "moments" worth saying under the grade — a first Excellent,
// a new best, a climb, persistence, a streak, a welcome back — ranked, the one or two most
// notable first; a plateau note instead, as help rather than praise. The learner is the
// profile id on each assessment; with none chosen, the assessments with no learner (one
// device). Nothing is stored: all of it is recomputed from the files.
const GRADE_RANK = { practice: 0, fair: 1, good: 2, excellent: 3 };
const GRADE_WORD = { practice: 'Needs practice', fair: 'Fair', good: 'Good', excellent: 'Excellent' };
const dayOf = (at) => isoDate(new Date(at));
const daysBetween = (a, b) => Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / DAY_MS);
const mondayOf = (dateStr) => { const d = parseDate(dateStr); const dow = (d.getDay() + 6) % 7; return isoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow)); };
const sameLearner = (a, profileId) => (profileId ? !!(a.learner && a.learner.profileId === profileId) : !(a.learner && a.learner.profileId));

// Consecutive days with a take, ending on `endDay`.
export function dayStreak(days, endDay) {
  const set = new Set(days);
  let n = 0;
  let d = endDay;
  while (set.has(d)) { n++; d = shiftPeriod('day', d, -1); }
  return n;
}
// Consecutive weeks with at least `minDays` practice days, ending with the week of `endDay`.
export function weekStreak(days, endDay, minDays = 3) {
  const perWeek = new Map();
  for (const d of new Set(days)) { const w = mondayOf(d); perWeek.set(w, (perWeek.get(w) || 0) + 1); }
  let n = 0;
  let w = mondayOf(endDay);
  while ((perWeek.get(w) || 0) >= minDays) { n++; w = shiftPeriod('week', w, -1); }
  return n;
}

export function progress(assessments, { profileId = null, current = null } = {}) {
  const mine = (assessments || []).filter((a) => a && a.at && sameLearner(a, profileId)).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const empty = { current: null, moments: [], all: [], plateau: null, streak: { days: 0, weeks: 0 }, slokas: {}, quizzes: {} };
  if (!mine.length) return empty;
  const cur = current ? mine.find((a) => a.key === current) : mine[mine.length - 1];
  if (!cur) return empty;
  const today = dayOf(cur.at);
  const at = mine.indexOf(cur);
  const before = mine.slice(0, at);
  const upTo = mine.slice(0, at + 1);
  // the takes of each sloka before this one, oldest first
  const histBefore = new Map();
  for (const a of before) for (const it of a.items || []) {
    if (!it || it.missing || it.overall == null) continue;
    if (!histBefore.has(it.id)) histBefore.set(it.id, []);
    histBefore.get(it.id).push({ at: a.at, day: dayOf(a.at), overall: it.overall, grade: it.grade || null, key: a.key });
  }
  const moments = [];
  const say = (kind, rank, emoji, text, extra = {}) => moments.push({ kind, rank, emoji, text, ...extra });
  const slokas = {};
  let plateau = null;
  for (const it of cur.items || []) {
    if (!it || it.missing || it.overall == null) continue;
    const earlier = histBefore.get(it.id) || [];
    const all = [...earlier, { at: cur.at, day: today, overall: it.overall, grade: it.grade || null }];
    const bestBefore = earlier.length ? Math.max(...earlier.map((t) => t.overall)) : null;
    slokas[it.id] = { name: it.name, takes: all.length, best: bestBefore, bestEver: Math.max(it.overall, bestBefore == null ? -1 : bestBefore), first: earlier.length ? earlier[0] : null, last: earlier.length ? earlier[earlier.length - 1] : null };
    const name = it.name || it.id;
    if (it.grade === 'excellent' && !earlier.some((t) => t.grade === 'excellent')) say('firstExcellent', 1, '🎉', `First Excellent on ${name}!`, { slokaId: it.id });
    if (bestBefore != null && it.overall > bestBefore) say('newBest', 2, '⬆️', `Your best on ${name} so far: ${it.overall}`, { slokaId: it.id });
    if (all.length >= 4) {
      const last3 = all.slice(-3);
      const prev3 = all.slice(-6, -3);
      const up = Math.max(...last3.map((t) => t.overall)) - Math.max(...prev3.map((t) => t.overall));
      if (up >= 5) {
        const since = daysBetween(prev3[prev3.length - 1].day, today);
        say('climbing', 3, '📈', `Up ${up} points on ${name}${since >= 28 ? ' since last month' : since >= 7 ? ' since last week' : ''}`, { slokaId: it.id });
      } else if (all.length >= 5 && GRADE_RANK[it.grade] != null && GRADE_RANK[it.grade] <= 1) {
        plateau = plateau || { kind: 'plateau', rank: 9, emoji: '🧭', text: `${name} is not moving yet: slow it down in Teach mode, pāda by pāda`, slokaId: it.id };
      }
    }
    if (all.length >= 5 && earlier[0].grade && it.grade && GRADE_RANK[it.grade] > GRADE_RANK[earlier[0].grade]) say('longClimb', 4, '🧗', `${all.length} takes on ${name}: from ${GRADE_WORD[earlier[0].grade]} to ${GRADE_WORD[it.grade]}`, { slokaId: it.id });
    const todays = all.filter((t) => t.day === today);
    if (todays.length >= 3 && it.overall >= Math.max(...todays.map((t) => t.overall))) say('persistence', 5, '💪', `You kept at it: ${todays.length} takes of ${name} today, and the last was your best`, { slokaId: it.id });
    if (earlier.length && daysBetween(earlier[earlier.length - 1].day, today) >= 14) say('welcomeBack', 7, '👋', `Welcome back to ${name}`, { slokaId: it.id });
  }
  // the quiz as a whole
  const quizzes = {};
  if (cur.kind === 'quiz' && cur.quizId && cur.overall != null) {
    const earlier = before.filter((a) => a.kind === 'quiz' && a.quizId === cur.quizId && a.overall != null);
    const bestBefore = earlier.length ? Math.max(...earlier.map((a) => a.overall)) : null;
    quizzes[cur.quizId] = { attempts: earlier.length + 1, best: bestBefore, excellent: earlier.filter((a) => a.grade === 'excellent').length + (cur.grade === 'excellent' ? 1 : 0) };
    if (cur.grade === 'excellent' && !earlier.some((a) => a.grade === 'excellent')) say('firstExcellent', 1, '🎉', 'First Excellent on this quiz!', { quizId: cur.quizId });
    if (bestBefore != null && cur.overall > bestBefore) say('newBest', 2, '⬆️', `Your best on this quiz so far: ${cur.overall}`, { quizId: cur.quizId });
    const todays = [...earlier, cur].filter((a) => dayOf(a.at) === today);
    if (todays.length >= 3 && cur.overall >= Math.max(...todays.map((a) => a.overall))) say('persistence', 5, '💪', `You kept at it: ${todays.length} attempts today, and the last was your best`, { quizId: cur.quizId });
  }
  // streaks: calendar days, in local time; a gap is simply not mentioned
  const days = upTo.map((a) => dayOf(a.at));
  const streak = { days: dayStreak(days, today), weeks: weekStreak(days, today) };
  if (streak.days >= 3) {
    const t = streak.days === 7 ? 'A whole week, every day' : streak.days === 14 ? 'Two weeks running, every day' : streak.days === 30 ? 'Thirty days in a row: a habit' : `${streak.days} days in a row`;
    say('dayStreak', 6, '🔥', t);
  }
  if (streak.weeks >= 2) say('weekStreak', 6, '🗓️', `${streak.weeks} weeks of steady practice`);
  moments.sort((a, b) => a.rank - b.rank);
  // one or two moments, the most notable first; a plateau shows alone, as help rather than praise
  const shown = plateau && !moments.some((m) => m.rank <= 4) ? [plateau] : moments.slice(0, 2);
  return { current: cur.key, moments: shown, all: moments, plateau, streak, slokas, quizzes };
}
