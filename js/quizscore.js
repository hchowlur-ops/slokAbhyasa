// Quiz scoring: how correct a recitation was, per picked sloka and per category, and the
// percentage shown for a chosen set of categories. Pure, shared with the tests.

export const QUIZ_CATEGORIES = [
  { id: 'content', label: 'Content', hint: 'the sound of each syllable, and nothing skipped' },
  { id: 'pronunciation', label: 'Pronunciation', hint: 'words recognised by speech-to-text that match the sloka text' },
  { id: 'timing', label: 'Timing', hint: 'rhythm and pauses' },
  { id: 'pitch', label: 'Pitch', hint: 'intonation' },
  { id: 'dynamics', label: 'Dynamics', hint: 'loudness' },
];
export const DEFAULT_QUIZ_CATEGORIES = ['content', 'pronunciation'];
const CAT_IDS = QUIZ_CATEGORIES.map((c) => c.id);

// Tolerance: how much variation (100 minus the score, in percent) is still acceptable in a
// category. Self Evaluation and Teach let the user change these; a quiz always uses the defaults.
export const DEFAULT_TOLERANCE = { content: 10, pronunciation: 10, timing: 60, pitch: 60, dynamics: 60 };

export function normalizeTolerance(t) {
  const out = {};
  for (const c of CAT_IDS) {
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
//   result         the comparison result for this sloka, or { error }
//   wordSimilarity 0..1 share of the sloka's words heard, or null when unknown
//   sttAvailable   whether speech recognition worked for this attempt at all
export function itemScores(result, { wordSimilarity = null, sttAvailable = false } = {}) {
  const none = { matched: false, missing: true, content: null, pronunciation: null, timing: null, pitch: null, dynamics: null };
  if (!result || result.error || !result.scores) return none;
  const matched = !!(result.match && result.match.ok);
  const r = (v) => (v == null ? null : Math.round(Math.max(0, Math.min(100, v))));
  if (!matched) {
    return { matched: false, missing: false, content: 0, pronunciation: sttAvailable ? 0 : null, timing: 0, pitch: 0, dynamics: 0 };
  }
  const s = result.scores;
  return {
    matched: true,
    missing: false,
    content: r(s.content),
    pronunciation: wordSimilarity == null ? null : r(100 * wordSimilarity),
    timing: r(s.timing),
    pitch: s.pitch == null ? null : r(s.pitch),
    dynamics: s.dynamics == null ? null : r(s.dynamics),
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

// Everything worth saving about one attempt: per-category averages and the percentage for
// the categories chosen at the time.
export function attemptSummary(items, categories = DEFAULT_QUIZ_CATEGORIES, tolerance = DEFAULT_TOLERANCE) {
  const byCategory = {};
  for (const c of CAT_IDS) byCategory[c] = categoryMean(items, c);
  const counted = items.filter((it) => !it.missing).length;
  const recited = items.filter((it) => it.matched).length;
  const corr = correctness(items, categories, tolerance);
  return { byCategory, average: scoreFor(byCategory, categories), score: corr.pct, correct: corr.correct, passRate: corr.passRate, counted, recited };
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
