// Badges: a quiz mastered. The same learner completes a quiz with the grade Excellent at
// least three times — every sloka recited, no slip in the attempt — by default on three
// different days, so the badge says the quiz stays Excellent rather than that it was
// Excellent three times in one sitting. A star is added at five such attempts and at ten.
// Chapter and Gītā badges follow from the verses the badged quizzes cover. Badges are
// derived data: this module computes them from the quizzes' attempts and never reads or
// writes a file; the server keeps the result in <data>/badges.json by profile id (names
// stay in profiles.json) and the recompute tool rebuilds it. Pure; shared with the tests.
import { attemptOverall, normalizeWeights, gradeWithSlips, anySlips } from './quizscore.js';
import { GITA_VERSES } from './chandas.js';
import { parseVerseId } from './verses.js';
import { isoDate } from './reports.js';

export const BADGES_VERSION = '1.0.0';
export const LEVELS = [3, 5, 10]; // Excellent attempts for level 1, 2, 3
export const LEVEL_EMOJI = ['🏅', '🏅⭐', '🏅⭐⭐'];
export const CHAPTER_EMOJI = '📖';
export const GITA_EMOJI = '🪔';
export const DEVICE = 'device'; // the learner key when no one was chosen
export const DEFAULT_RULE = Object.freeze({ differentDays: true });

export const learnerKeyOf = (rec) => (rec && rec.learner && typeof rec.learner.profileId === 'string' && rec.learner.profileId ? rec.learner.profileId : DEVICE);
export const quizBadgeId = (quizId) => `quiz:${quizId}:excellent`;
export const levelOf = (count) => LEVELS.filter((n) => count >= n).length; // 0 when not yet earned
export const badgeEmoji = (b) => (!b ? '' : b.kind === 'chapter' ? CHAPTER_EMOJI : b.kind === 'gita' ? GITA_EMOJI : LEVEL_EMOJI[Math.max(0, Math.min(LEVEL_EMOJI.length, b.level || 1) - 1)]);

// Whether an attempt completed the quiz with an Excellent: every sloka compared and
// recited, no slip, and the weighted overall at least 90, on the categories and weights
// it was judged with.
export function attemptQualifies(attempt) {
  if (!attempt || !Array.isArray(attempt.items) || !attempt.items.length) return false;
  if (attempt.items.some((it) => !it || it.missing || !it.matched)) return false;
  if (anySlips(attempt.items)) return false;
  const overall = attemptOverall(attempt.items, attempt.categories, attempt.weights ? normalizeWeights(attempt.weights) : undefined);
  const g = gradeWithSlips(overall, null);
  return !!g && g.id === 'excellent';
}

// The qualifying attempts of a quiz, by learner: { key → [{ n, at, day }] }, oldest first.
export function qualifyingByLearner(quiz) {
  const out = new Map();
  (Array.isArray(quiz.attempts) ? quiz.attempts : []).forEach((a, i) => {
    if (!attemptQualifies(a)) return;
    const key = learnerKeyOf(a);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push({ n: i + 1, at: a.at, day: isoDate(new Date(a.at)) });
  });
  return out;
}

// How many of a learner's qualifying attempts count under the rule: each on its own day,
// or every one. Returns the attempts that count, in order, one per day under the rule.
export function countingAttempts(list, rule = DEFAULT_RULE) {
  if (!rule || !rule.differentDays) return list.slice();
  const seen = new Set();
  const out = [];
  for (const a of list) { if (seen.has(a.day)) continue; seen.add(a.day); out.push(a); }
  return out;
}

// The quiz badges a quiz's attempts earn, every learner: one record per learner who has
// reached level 1, with the level reached and the attempts that earned it.
export function quizBadges(quiz, rule = DEFAULT_RULE) {
  const out = [];
  for (const [key, list] of qualifyingByLearner(quiz)) {
    const counting = countingAttempts(list, rule);
    const level = levelOf(counting.length);
    if (!level) continue;
    const at = (lvl) => counting[LEVELS[lvl - 1] - 1].at;
    out.push({
      id: quizBadgeId(quiz.id), kind: 'quiz', quizId: quiz.id, title: quiz.name, learner: key, level,
      earnedAt: at(1), levelAt: Array.from({ length: level }, (_, k) => at(k + 1)),
      evidence: counting.slice(0, LEVELS[level - 1]).map((a) => a.n),
      items: (quiz.items || []).map((it) => it.id), itemNames: (quiz.items || []).map((it) => it.name),
    });
  }
  return out;
}

// Chapter and Gītā badges from the verses a learner's quiz badges cover: `verseIdsOf(itemId)`
// gives the verse ids a sloka of the library is linked to ([] when none). A chapter is
// "by heart" when every one of its verses is covered; the Gītā when every chapter is.
export function coverageBadges(quizBadgeList, verseIdsOf) {
  const byLearner = new Map();
  for (const b of quizBadgeList) {
    if (b.kind !== 'quiz' || !b.level) continue;
    if (!byLearner.has(b.learner)) byLearner.set(b.learner, { verses: new Set(), at: b.earnedAt });
    const L = byLearner.get(b.learner);
    if (String(b.earnedAt) > String(L.at)) L.at = b.earnedAt;
    for (const itemId of b.items || []) for (const vid of verseIdsOf(itemId) || []) {
      const p = parseVerseId(vid);
      if (!p || !p.chapter || !p.verse) continue;
      for (let v = p.verse; v <= (p.verseEnd || p.verse); v++) L.verses.add(`${p.chapter}.${v}`);
    }
  }
  const out = [];
  for (const [learner, L] of byLearner) {
    const chapters = [];
    for (const [ch, n] of Object.entries(GITA_VERSES)) {
      let all = true;
      for (let v = 1; v <= n; v++) if (!L.verses.has(`${ch}.${v}`)) { all = false; break; }
      if (all) chapters.push(Number(ch));
    }
    for (const ch of chapters) out.push({ id: `chapter:${ch}`, kind: 'chapter', chapter: ch, title: `Chapter ${ch} by heart`, learner, level: 1, earnedAt: L.at });
    if (chapters.length === Object.keys(GITA_VERSES).length) out.push({ id: 'gita', kind: 'gita', title: 'The Gītā by heart', learner, level: 1, earnedAt: L.at });
  }
  return out;
}

// Every badge, from every quiz: the full list a recompute writes.
export function computeBadges(quizzes, { rule = DEFAULT_RULE, verseIdsOf = () => [] } = {}) {
  const quizList = [];
  for (const q of quizzes || []) quizList.push(...quizBadges(q, rule));
  return [...quizList, ...coverageBadges(quizList, verseIdsOf)];
}

// What is new in `next` against `prev`: badges earned now, and levels raised. A badge once
// earned is never taken away by a recompute of one quiz (merge keeps the rest), so the
// award is idempotent: the same attempt awards nothing twice.
export function diffBadges(prev, next) {
  const key = (b) => `${b.learner}|${b.id}`;
  const before = new Map((prev || []).map((b) => [key(b), b]));
  const awards = [];
  for (const b of next || []) {
    const old = before.get(key(b));
    if (!old) awards.push({ ...b, change: 'earned' });
    else if ((b.level || 1) > (old.level || 1)) awards.push({ ...b, change: 'raised', from: old.level || 1 });
  }
  return awards;
}

// `prev` with `next` merged in: a badge is replaced when its level rose, kept otherwise.
export function mergeBadges(prev, next) {
  const key = (b) => `${b.learner}|${b.id}`;
  const out = new Map((prev || []).map((b) => [key(b), b]));
  for (const b of next || []) {
    const old = out.get(key(b));
    if (!old || (b.level || 1) > (old.level || 1)) out.set(key(b), old ? { ...b, earnedAt: old.earnedAt || b.earnedAt } : b);
  }
  return [...out.values()].sort((a, b) => String(a.earnedAt).localeCompare(String(b.earnedAt)));
}

// A badge said in a line: "🏅 CH-12 · 2026-10-08 06:58 — mastered on 8 Oct 2026".
export function badgeLine(b) {
  const when = b.earnedAt ? new Date(b.earnedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const what = b.kind === 'quiz' ? `mastered${b.level > 1 ? ` · level ${b.level}` : ''}` : 'by heart';
  return `${badgeEmoji(b)} ${b.title} — ${what}${when ? ` on ${when}` : ''}`;
}
