// The reports dashboard's arithmetic: periods (a day, a week, a month), quiz attempts and
// evaluation sessions brought into one shape ("assessments"), and the per-sloka rows of the
// folder view. Pure; shared by the browser and the server, and tested in Node.

import { QUIZ_CATEGORIES, overallScore, attemptOverall, gradeOf, correctness, normalizeTolerance, DEFAULT_TOLERANCE } from './quizscore.js';

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

const itemWithOverall = (it, categories) => {
  const overall = it && !it.missing ? overallScore(it, categories) : null;
  const g = gradeOf(overall);
  return { ...it, overall, grade: g ? g.id : null };
};
const foldersOf = (items) => [...new Set((items || []).map((it) => it.folder || ''))];

// A quiz's attempts as assessments: scored on the quiz's current categories and each
// attempt's own tolerance, the way the quiz view shows them.
export function assessmentsFromQuiz(quiz) {
  const attempts = Array.isArray(quiz.attempts) ? quiz.attempts : [];
  const categories = quiz.categories || [];
  return attempts.map((a, i) => {
    const tolerance = a.tolerance ? normalizeTolerance(a.tolerance) : DEFAULT_TOLERANCE;
    const items = (a.items || []).map((it) => itemWithOverall(it, categories));
    const overall = items.length ? attemptOverall(items, categories) : a.overall == null ? null : a.overall;
    const corr = items.length ? correctness(items, categories, tolerance) : null;
    const g = gradeOf(overall);
    return {
      key: `quiz:${quiz.id}:${i + 1}`, kind: 'quiz', quizId: quiz.id, attempt: i + 1, at: a.at,
      name: quiz.name, categories, tolerance, learner: a.learner || null,
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
  const items = (s.items || []).map((it) => itemWithOverall(it, CAT_IDS));
  const recited = items.filter((it) => it.matched);
  const overall = recited.length ? attemptOverall(recited, CAT_IDS) : items.length ? 0 : s.overall == null ? null : s.overall;
  const g = gradeOf(overall);
  return {
    key: `session:${s.id}`, kind: s.kind === 'teach' ? 'teach' : 'evaluation', sessionId: s.id, at: s.at,
    name: s.kind === 'teach' ? 'Teach' : 'Self Evaluation', categories: CAT_IDS, tolerance: s.tolerance ? normalizeTolerance(s.tolerance) : DEFAULT_TOLERANCE, learner: s.learner || null,
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
        content: it.content ?? null, pronunciation: it.pronunciation ?? null, timing: it.timing ?? null, pitch: it.pitch ?? null, dynamics: it.dynamics ?? null,
        overall: it.overall ?? null, grade: it.grade || null,
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
