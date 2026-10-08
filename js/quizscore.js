// Quiz scoring: how correct a recitation was, per picked sloka and per category, and the
// percentage shown for a chosen set of categories. Pure, shared with the tests.

// What a recitation is judged on. The first three come from the words heard (the take's
// transcript against the sloka's text, at the level of akṣaras and phonemes: see phon.js);
// the rest from the sound, each normalised to the speaker (see compare.js). A reciter's
// voice — its range, timbre, loudness — is never scored.
export const QUIZ_CATEGORIES = [
  { id: 'phoneme', label: 'Phonemes', hint: 'the right sounds: place of articulation (t/ṭ, s/ś/ṣ), voicing (k/g), aspiration (k/kh), nasals and anusvāra, visarga, double consonants', weight: 30, source: 'words' },
  { id: 'vowel', label: 'Vowel length', hint: 'short against long: a/ā, i/ī, u/ū', weight: 25, source: 'words' },
  { id: 'syllable', label: 'Syllables', hint: 'akṣaras missing, added or replaced', weight: 15, source: 'words' },
  { id: 'emphasis', label: 'Emphasis', hint: 'which syllables stand out: loudness, pitch movement and length, relative to your own voice', weight: 10, source: 'sound' },
  { id: 'pitch', label: 'Pitch contour', hint: 'the rise and fall of the chant, not the voice range', weight: 10, source: 'sound' },
  { id: 'phrasing', label: 'Phrasing', hint: 'where the pauses fall', weight: 5, source: 'sound' },
  { id: 'timing', label: 'Timing', hint: 'tempo and rhythm', weight: 5, source: 'sound' },
];
export const DEFAULT_QUIZ_CATEGORIES = ['phoneme', 'vowel', 'syllable'];
const CAT_IDS = QUIZ_CATEGORIES.map((c) => c.id);
// Categories of records from before this scoring (content, pronunciation, dynamics), so
// old attempts still add up.
export const LEGACY_CATEGORIES = [
  { id: 'content', label: 'Content (sound match)', weight: 80 },
  { id: 'pronunciation', label: 'Pronunciation (words heard)', weight: 70 },
  { id: 'dynamics', label: 'Dynamics', weight: 40 },
];
export const categoryLabel = (id) => (QUIZ_CATEGORIES.find((c) => c.id === id) || LEGACY_CATEGORIES.find((c) => c.id === id) || { label: id }).label;

// Tolerance: how much variation (100 minus the score, in percent) is still acceptable in a
// category. Self Evaluation and Teach let the user change these; a quiz always uses the defaults.
export const DEFAULT_TOLERANCE = { phoneme: 15, vowel: 20, syllable: 10, emphasis: 60, pitch: 60, phrasing: 50, timing: 60, content: 10, pronunciation: 10 };

// The weight of each category in the overall score, as recommended for Gītā recitation:
// the sounds and vowel lengths first, the syllables, then the manner. Relative weights,
// configurable (see normalizeWeights); the overall is their weighted mean over the
// categories that could be judged.
export const CATEGORY_WEIGHTS = Object.freeze(Object.fromEntries([...QUIZ_CATEGORIES, ...LEGACY_CATEGORIES].map((c) => [c.id, c.weight])));

// A stored weight choice made sane: known ids only, whole numbers 0–100, never all zero.
export function normalizeWeights(w) {
  const out = {};
  for (const c of QUIZ_CATEGORIES) {
    const v = w && Number.isFinite(Number(w[c.id])) ? Math.round(Number(w[c.id])) : c.weight;
    out[c.id] = Math.max(0, Math.min(100, v));
  }
  if (!Object.values(out).some((v) => v > 0)) for (const c of QUIZ_CATEGORIES) out[c.id] = c.weight;
  for (const c of LEGACY_CATEGORIES) out[c.id] = c.weight;
  return out;
}

// The grade an overall score earns.
export const GRADES = [
  { id: 'excellent', label: 'Excellent', min: 90 },
  { id: 'good', label: 'Good', min: 80 },
  { id: 'fair', label: 'Fair', min: 65 },
  { id: 'practice', label: 'Needs practice', min: 0 },
];
export function gradeOf(score) {
  if (score == null || !Number.isFinite(score)) return null;
  return GRADES.find((g) => score >= g.min) || GRADES[GRADES.length - 1];
}

// Weighted overall of one set of category scores (an item, or a report's scores), over the
// given categories; a category that could not be judged (null) is left out. null when none
// could be judged. A record from before this scoring (content, pronunciation…) adds up on
// its own categories.
const LEGACY_WEIGHTS = { content: 80, pronunciation: 70, timing: 40, pitch: 40, dynamics: 40 };
const isLegacy = (scores) => !!scores && !['phoneme', 'vowel', 'syllable'].some((c) => scores[c] != null) && ['content', 'pronunciation', 'dynamics'].some((c) => scores[c] != null);
export function overallScore(scores, categories = CAT_IDS, weights = CATEGORY_WEIGHTS) {
  let sum = 0;
  let wsum = 0;
  let cats = categories || [];
  let w = weights;
  if (isLegacy(scores)) {
    // the categories it was scored on at the time (a quiz's choice), else all of the old ones
    const chosenThen = cats.some((c) => ['content', 'pronunciation', 'dynamics'].includes(c));
    cats = chosenThen ? cats.filter((c) => c in LEGACY_WEIGHTS) : Object.keys(LEGACY_WEIGHTS);
    w = LEGACY_WEIGHTS;
  }
  for (const c of cats) {
    const v = scores ? scores[c] : null;
    if (v == null) continue;
    const wc = w[c] ?? CATEGORY_WEIGHTS[c] ?? 0;
    sum += wc * v;
    wsum += wc;
  }
  return wsum ? Math.round(sum / wsum) : null;
}

// Overall of an attempt: the mean of its items' overalls (a sloka not recited scores 0;
// one that could not be compared is left out). null when nothing could be judged.
export function attemptOverall(items, categories = CAT_IDS, weights = CATEGORY_WEIGHTS) {
  let sum = 0;
  let n = 0;
  for (const it of items || []) {
    if (!it || it.missing) continue;
    const o = overallScore(it, categories, weights);
    if (o == null) continue;
    sum += o;
    n++;
  }
  return n ? Math.round(sum / n) : null;
}

export function normalizeTolerance(t) {
  const out = {};
  for (const c of Object.keys(DEFAULT_TOLERANCE)) {
    const v = t && Number.isFinite(Number(t[c])) ? Math.round(Number(t[c])) : DEFAULT_TOLERANCE[c];
    out[c] = Math.max(0, Math.min(100, v));
  }
  return out;
}

// A score is acceptable when its variation from perfect is within the tolerance.
// null when the score could not be judged.
export function withinTolerance(score, tol) {
  if (score == null) return null;
  return 100 - score <= tol;
}

// Verdict for one item over some categories: ok when every judgeable one is within tolerance.
// Returns { ok: true | false | null, failed: [...], judged: [...] }; ok is null when nothing
// could be judged (or the item is missing).
export function itemVerdict(item, categories, tolerance = DEFAULT_TOLERANCE) {
  const failed = [];
  const judged = [];
  if (!item || item.missing) return { ok: null, failed, judged };
  for (const c of categories || []) {
    const w = withinTolerance(item[c], tolerance[c]);
    if (w === null) continue;
    judged.push(c);
    if (!w) failed.push(c);
  }
  return { ok: judged.length ? failed.length === 0 : null, failed, judged };
}

// Correctness of an attempt: the share of items whose chosen categories are all within
// tolerance. Also the share within tolerance per category. Items that could not be judged
// are left out of every share.
export function correctness(items, categories, tolerance = DEFAULT_TOLERANCE) {
  let correct = 0;
  let counted = 0;
  const passRate = {};
  for (const c of CAT_IDS) {
    let ok = 0;
    let n = 0;
    for (const it of items || []) {
      const w = it && !it.missing ? withinTolerance(it[c], tolerance[c]) : null;
      if (w === null) continue;
      n++;
      if (w) ok++;
    }
    passRate[c] = n ? { ok, n, pct: Math.round((100 * ok) / n) } : null;
  }
  for (const it of items || []) {
    const v = itemVerdict(it, categories, tolerance);
    if (v.ok === null) continue;
    counted++;
    if (v.ok) correct++;
  }
  return { correct, counted, pct: counted ? Math.round((100 * correct) / counted) : null, passRate };
}

// A picked sloka's correctness in every category (0–100, or null when that category could
// not be judged). A sloka that was not found in the recording scores 0 everywhere: it was
// not recited. One whose comparison failed, or that is gone from the library, is `missing`
// and left out of every average.
//   result        the comparison result for this sloka, or { error }
//   phonology     comparePhonology() of the words heard against the sloka's text, or null
//   sttAvailable  whether speech recognition worked for this attempt at all
export function itemScores(result, { phonology = null, sttAvailable = false } = {}) {
  const none = { matched: false, missing: true, phoneme: null, vowel: null, syllable: null, emphasis: null, pitch: null, phrasing: null, timing: null };
  if (!result || result.error || !result.scores) return none;
  const matched = !!(result.match && result.match.ok);
  const r = (v) => (v == null ? null : Math.round(Math.max(0, Math.min(100, v))));
  if (!matched) {
    const w = sttAvailable ? 0 : null;
    return { matched: false, missing: false, phoneme: w, vowel: w, syllable: w, emphasis: 0, pitch: 0, phrasing: 0, timing: 0 };
  }
  const s = result.scores;
  // recited text (weight 0): pitch is a matter of style, shown but never judged
  const pitchJudged = s.pitch != null && !(s.weights && s.weights.pitch === 0);
  const p = phonology || {};
  return {
    matched: true,
    missing: false,
    phoneme: p.phonemes == null ? null : r(p.phonemes),
    vowel: p.vowels == null ? null : r(p.vowels),
    syllable: p.syllables == null ? null : r(p.syllables),
    emphasis: s.emphasis == null ? null : r(s.emphasis),
    pitch: pitchJudged ? r(s.pitch) : null,
    phrasing: s.phrasing == null ? null : r(s.phrasing),
    timing: r(s.timing),
  };
}

// Mean of one category over the items that could be judged in it.
function categoryMean(items, cat) {
  let sum = 0;
  let n = 0;
  for (const it of items) {
    if (it.missing || it[cat] == null) continue;
    sum += it[cat];
    n++;
  }
  return n ? Math.round(sum / n) : null;
}

// The mean of a set of categories' averages, leaving out categories that could not be judged.
// null when none could. (Informational; correctness() is what a quiz is scored on.)
export function scoreFor(byCategory, categories) {
  const vals = (categories || []).map((c) => (byCategory ? byCategory[c] : null)).filter((v) => v != null);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

// Everything worth saving about one attempt: per-category averages, the percentage for
// the categories chosen at the time, and the weighted overall with its grade.
export function attemptSummary(items, categories = DEFAULT_QUIZ_CATEGORIES, tolerance = DEFAULT_TOLERANCE, weights = CATEGORY_WEIGHTS) {
  const byCategory = {};
  for (const c of CAT_IDS) byCategory[c] = categoryMean(items, c);
  const counted = items.filter((it) => !it.missing).length;
  const recited = items.filter((it) => it.matched).length;
  const corr = correctness(items, categories, tolerance);
  const overall = attemptOverall(items, categories, weights);
  const grade = gradeOf(overall);
  return { byCategory, average: scoreFor(byCategory, categories), score: corr.pct, correct: corr.correct, passRate: corr.passRate, counted, recited, overall, grade: grade ? grade.id : null };
}

// Keeps a stored category choice sane: known ids only, in canonical order, never empty.
export function normalizeCategories(list) {
  const set = new Set(Array.isArray(list) ? list : []);
  const out = CAT_IDS.filter((c) => set.has(c));
  return out.length ? out : [...DEFAULT_QUIZ_CATEGORIES];
}

// Fisher–Yates on a copy.
export function shuffle(list, random = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Picks the slokas for a quiz: `count` at random from `candidates`, spread across the
// folders when several are selected (round-robin over shuffled folders), so a big folder does
// not crowd out a small one.
export function pickBaselines(candidates, count, random = Math.random) {
  const want = Math.max(1, Math.min(count, candidates.length));
  const byFolder = new Map();
  for (const c of shuffle(candidates, random)) {
    const key = c.folder || '';
    if (!byFolder.has(key)) byFolder.set(key, []);
    byFolder.get(key).push(c);
  }
  const queues = shuffle([...byFolder.values()], random);
  const out = [];
  while (out.length < want) {
    let took = false;
    for (const q of queues) {
      if (out.length >= want) break;
      if (q.length) { out.push(q.shift()); took = true; }
    }
    if (!took) break;
  }
  return out;
}
