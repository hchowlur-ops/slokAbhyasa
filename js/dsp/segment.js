// Where each sloka of a take of several lies, found after the stop from the whole take: the
// N − 1 cuts are chosen together among the take's pauses so that every sloka's sung time
// agrees with what is expected of it, and a longer breath is preferred as a cut. What is
// expected of a sloka comes from the learner when known — the teacher's sounding time at
// the learner's tempo, or the plan's akṣaras at their speed — and otherwise from the take
// itself: each sloka's share of the take's sound, by its akṣaras. A second opinion beside
// the ear's live stretches, written into the ear's log (js/earlog.js) so the two can be
// compared on every take; no verdict rests on it yet. Pure; Node-testable.
//
// Every sloka is assumed recited, in order, once: a sloka skipped or said twice is not yet
// modelled (its segment would come out as its neighbour's half).
export const MIN_GAP_SEC = 0.25; // the shortest pause that can be a cut
export const GAP_FREE_SEC = 1.0; // a pause this long costs nothing as a cut
export const GAP_COST = 0.15; // the most a short pause costs as a cut (a quarter-second breath)
export const LAST_SHORT_WEIGHT = 1; // the last sloka's shortness counts in full by default: a take stopped inside its last sloka is a hypothesis of its own (fitCuts), not a discount
export const SCALE_MIN = 0.6; // how far the learner's pace this take may differ from the learnt one
export const SCALE_MAX = 1.6;
export const SCALE_STEP = 1.05;
export const SCALE_PRIOR = 0.5; // the cost of a scale s: SCALE_PRIOR · ln(s)², against the lengths' ln(ratio)²
export const PARTIAL_LAST_MIN = 0.15; // the stop inside the last sloka: what remains of the take's sound must be at least this share of the sloka
export const LAST_WHOLE_FROM = 0.6; // the ear's position at the stop, as a share of the last sloka's plan, from which the take is taken to hold the last sloka whole
export const LAST_PARTIAL_TO = 0.5; // and under which it is taken to have stopped inside it; between, both hypotheses compete by cost
export const LENGTH_WEIGHT = 1; // a sloka's length cost, LENGTH_WEIGHT · ln(sung / expected)², against the cut costs: a fifth too long costs about as much as a cut through sound
export const THROUGH_COST = 0.2; // a cut through sound, at a valley of the level, where no breath lies (a learner who goes straight on): the most it costs, halved at a valley as quiet as a pause
export const VALLEY_MIN_RUN_SEC = 3; // sound runs this long or longer offer their valleys as cuts
export const VALLEY_SPACING_SEC = 0.8; // at least this far apart
export const VALLEY_SMOOTH_SEC = 0.15; // the level smoothed over this before its valleys are read
export const QUIET_SHARE = 0.4; // the pause threshold sits this far up from the take's floor towards its peak
export const QUIET_MIN_DB = 6; // and at least this far above the floor
export const SUNG_FILL_SEC = 0.2; // quiet shorter than this counts as sound when a segment's sung time is measured — as the ear's own time sung does, which the learner's speed was learnt on

// A copy of a sound mask with quiet runs shorter than maxFrames filled in.
export function fillShortGaps(mask, maxFrames) {
  const out = Uint8Array.from(mask);
  let start = null;
  for (let k = 0; k <= out.length; k++) {
    const on = k < out.length ? !!out[k] : true;
    if (!on) { if (start === null) start = k; continue; }
    if (start !== null) { if (k - start < maxFrames && start > 0) for (let j = start; j < k; j++) out[j] = 1; start = null; }
  }
  return out;
}

// Where there is sound, frame by frame, for the purpose of finding breaths: a frame is quiet
// when its level is under a threshold set between the take's floor (the quietest twentieth
// of its frames) and its peak (the loudest). The features' own `active` mask is made for
// trimming and keeps everything above the room, which in a take of soft chant with a quiet
// room is everything; breaths need a threshold relative to the chant itself. Returns a
// Uint8Array (1 = sound) and the threshold used.
export function soundMaskOf(F, { share = QUIET_SHARE, minDb = QUIET_MIN_DB } = {}) {
  const db = F && F.rmsDb;
  if (!db || !db.length) return { mask: F && F.active ? F.active : new Uint8Array(0), thresholdDb: null, floorDb: null, peakDb: null };
  const sorted = Float32Array.from(db).sort();
  const at = (p) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))))];
  const floor = at(0.05);
  const peak = at(0.95);
  const thr = Math.max(floor + minDb, floor + share * (peak - floor));
  const mask = new Uint8Array(db.length);
  for (let k = 0; k < db.length; k++) mask[k] = db[k] >= thr ? 1 : 0;
  return { mask, thresholdDb: r3(thr), floorDb: r3(floor), peakDb: r3(peak) };
}

// The pauses of a take: gaps in a sound mask of at least minGapSec between the first and
// the last sound. Seconds: `first` the first sound, `last` the end of the last, `gaps`
// [{ from, to, len }] in order.
export function pausesOf(mask, hopSec, { minGapSec = MIN_GAP_SEC } = {}) {
  const n = mask ? mask.length : 0;
  let first = 0;
  while (first < n && !mask[first]) first++;
  let last = n - 1;
  while (last >= 0 && !mask[last]) last--;
  if (first >= last) return { first: 0, last: 0, gaps: [] };
  const gaps = [];
  let start = null;
  for (let k = first; k <= last; k++) {
    if (!mask[k]) { if (start === null) start = k; continue; }
    if (start !== null) { const len = (k - start) * hopSec; if (len >= minGapSec) gaps.push({ from: start * hopSec, to: k * hopSec, len }); start = null; }
  }
  return { first: first * hopSec, last: (last + 1) * hopSec, gaps };
}

// What each sloka is expected to take, in seconds of the learner's sound, by three methods:
//   teacher  the teacher's sounding time at the learner's tempo (their span per sloka, breaths within included)
//   plan     the plan's akṣaras at the learner's speed (their sound alone)
//   share    the take's sound shared out by the slokas' akṣaras (or the teacher's times) — the take calibrates itself
// Each is null when its inputs are missing. items: [{ name, teacherSec, total }]; pace:
// { tempoRatio, aksPerSec } or null; sungTotal: the take's seconds of sound.
export function expectations(items, pace, sungTotal) {
  const out = { teacher: null, plan: null, share: null };
  const tr = pace && Number(pace.tempoRatio) > 0 ? Number(pace.tempoRatio) : null;
  const sp = pace && Number(pace.aksPerSec) > 0 ? Number(pace.aksPerSec) : null;
  if (tr && items.length && items.every((it) => Number(it.teacherSec) > 0)) out.teacher = items.map((it) => Number(it.teacherSec) * tr);
  if (sp && items.length && items.every((it) => Number(it.total) > 0)) out.plan = items.map((it) => Number(it.total) / sp);
  const weights = items.length && items.every((it) => Number(it.total) > 0) ? items.map((it) => Number(it.total)) : items.length && items.every((it) => Number(it.teacherSec) > 0) ? items.map((it) => Number(it.teacherSec)) : null;
  if (weights && sungTotal > 0) { const W = weights.reduce((a, b) => a + b, 0); out.share = weights.map((w) => (sungTotal * w) / W); }
  return out;
}

// The valleys of the level inside the runs of sound between the boundaries given: where a cut
// may go through sound when no breath lies where the lengths want one. Returns boundaries
// { from, to, len: 0, virtual: true, level } for valleys at least spacingSec apart, in runs of
// at least minRunSec, half a second clear of the run's ends.
export function valleysOf(F, bounds, { minRunSec = VALLEY_MIN_RUN_SEC, spacingSec = VALLEY_SPACING_SEC, smoothSec = VALLEY_SMOOTH_SEC } = {}) {
  const db = F && F.rmsDb;
  if (!db || !db.length || !bounds || bounds.length < 2) return [];
  const hop = F.hopSec;
  const half = Math.max(1, Math.round(smoothSec / hop / 2));
  const sm = new Float32Array(db.length);
  for (let k = 0; k < db.length; k++) { let s = 0; let n = 0; for (let j = Math.max(0, k - half); j <= Math.min(db.length - 1, k + half); j++) { s += db[j]; n++; } sm[k] = s / n; }
  const out = [];
  const spacing = Math.round(spacingSec / hop);
  const clear = Math.round(0.5 / hop);
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = Math.round(bounds[i].to / hop) + clear;
    const b = Math.round(bounds[i + 1].from / hop) - clear;
    if ((b - a) * hop < minRunSec - 1) continue;
    const mins = [];
    for (let k = a + 1; k < b - 1; k++) if (sm[k] <= sm[k - 1] && sm[k] < sm[k + 1]) mins.push(k);
    mins.sort((x, y) => sm[x] - sm[y]);
    const taken = [];
    for (const k of mins) { if (taken.some((t) => Math.abs(t - k) < spacing)) continue; taken.push(k); }
    for (const k of taken.sort((x, y) => x - y)) out.push({ from: k * hop, to: k * hop, len: 0, virtual: true, level: Math.round(sm[k] * 10) / 10 });
  }
  return out;
}

// The cuts for one set of expectations: a dynamic programme over the pauses and, at a cost,
// the valleys of the sound between them. `measure` is
// 'span' (first to last sound of the segment; the teacher method) or 'sung' (its seconds of
// sound). `soundCost(i, fromSec, toSec)`, when given, adds a cost per candidate segment from
// the sound itself (how unlike the teacher's recording it is), weighted by `soundWeight`.
// Returns null when the take has fewer pauses than cuts needed.
export const PIN_REACH_SEC = 1.5; // a cut the student made by turning the page pins the boundary to the nearest pause within this
export function cutsFor(F, items, expected, { measure = 'sung', minGapSec = MIN_GAP_SEC, lastShortWeight = LAST_SHORT_WEIGHT, gapCost = GAP_COST, gapFreeSec = GAP_FREE_SEC, mask = null, soundCost = null, soundWeight = 1, pinned = null } = {}) {
  const N = items.length;
  const hop = F.hopSec;
  const q = soundMaskOf(F);
  const m = mask || q.mask;
  const thr = q.thresholdDb;
  const { first, last, gaps } = pausesOf(m, hop, { minGapSec });
  if (!N || !expected || expected.length !== N || last <= first) return null;
  // the boundaries: the first sound, every pause, the valleys of the sound between (cuts through
  // sound, at a cost), the end of the last sound
  const anchors = [{ from: first, to: first, len: 0 }, ...gaps, { from: last, to: last, len: 0 }];
  const B = [...anchors, ...valleysOf(F, anchors)].sort((x, y) => x.from - y.from);
  if (B.length - 2 < N - 1) return null;
  const G = B.length - 1; // the index of the end boundary
  // the boundaries pinned by the student's page turns: boundary i (after sloka i−1) must be the pause nearest `at`
  const pin = new Int32Array(N + 1).fill(-1);
  for (const p of pinned || []) {
    const i = Number(p.after) + 1;
    if (!(i >= 1 && i <= N - 1) || !Number.isFinite(p.at)) continue;
    let best = -1; let d = PIN_REACH_SEC;
    for (let b = 1; b < G; b++) { const dist = p.at < B[b].from ? B[b].from - p.at : p.at > B[b].to ? p.at - B[b].to : 0; if (dist < d) { d = dist; best = b; } }
    if (best >= 0) pin[i] = best;
  }
  const allowed = (i, b) => pin[i] < 0 || pin[i] === b;
  const sm = fillShortGaps(m, Math.round(SUNG_FILL_SEC / hop)); // the sung time counts the short quiet inside a line as sound
  const pre = new Float64Array(sm.length + 1); // frames of sound before frame k
  for (let k = 0; k < sm.length; k++) pre[k + 1] = pre[k] + (sm[k] ? 1 : 0);
  const frame = (sec) => Math.max(0, Math.min(m.length, Math.round(sec / hop)));
  const sungOf = (a, b) => (pre[frame(B[b].from)] - pre[frame(B[a].to)]) * hop;
  const spanOf = (a, b) => Math.max(0, B[b].from - B[a].to);
  const lengthOf = measure === 'span' ? spanOf : sungOf;
  const cutCost = (b) => (b === G ? 0 : B[b].virtual ? THROUGH_COST * (0.5 + 0.5 * Math.max(0, Math.min(1, ((B[b].level ?? 0) - (thr ?? -40)) / 12))) : gapCost * (1 - Math.min(1, B[b].len / gapFreeSec)));
  const soundMemo = new Map();
  const sound = (i, a, b) => {
    if (!soundCost) return 0;
    const key = i * 1e6 + a * 1e3 + b;
    if (!soundMemo.has(key)) soundMemo.set(key, soundWeight * (soundCost(i, B[a].to, B[b].from) || 0));
    return soundMemo.get(key);
  };
  const cost = (i, a, b) => {
    const L = lengthOf(a, b);
    if (!(L > 0) || !(expected[i] > 0)) return Infinity;
    const r = L / expected[i];
    if (r < 0.3 || r > 3) return Infinity; // never a third or thrice the sloka
    let c = LENGTH_WEIGHT * Math.log(r) ** 2;
    if (i === N - 1 && r < 1) c *= lastShortWeight;
    return c + sound(i, a, b);
  };
  // forward: fwd[i][b] = the least cost of slokas 0..i−1 with sloka i−1 ending at boundary b
  const INF = Infinity;
  const fwd = Array.from({ length: N + 1 }, () => new Float64Array(G + 1).fill(INF));
  const arg = Array.from({ length: N + 1 }, () => new Int32Array(G + 1).fill(-1));
  fwd[0][0] = 0;
  for (let i = 1; i <= N; i++) {
    for (let b = i; b <= G; b++) {
      if ((i === N) !== (b === G)) continue; // only the last sloka ends at the end
      if (!allowed(i, b)) continue;
      let best = INF; let at = -1;
      for (let a = i - 1; a < b; a++) {
        const f = fwd[i - 1][a];
        if (f === INF) continue;
        const c = f + cost(i - 1, a, b) + cutCost(b);
        if (c < best) { best = c; at = a; }
      }
      fwd[i][b] = best; arg[i][b] = at;
    }
  }
  if (fwd[N][G] === INF) return null;
  // backward: bwd[i][a] = the least cost of slokas i..N−1 starting at boundary a
  const bwd = Array.from({ length: N + 1 }, () => new Float64Array(G + 1).fill(INF));
  bwd[N][G] = 0;
  for (let i = N - 1; i >= 0; i--) {
    for (let a = i; a < G; a++) {
      let best = INF;
      for (let b = a + 1; b <= G; b++) {
        if ((i === N - 1) !== (b === G)) continue;
        if (!allowed(i + 1, b)) continue;
        const w = bwd[i + 1][b];
        if (w === INF) continue;
        const c = cost(i, a, b) + cutCost(b) + w;
        if (c < best) best = c;
      }
      bwd[i][a] = best;
    }
  }
  // the chosen boundaries, by backtracking
  const ends = new Array(N + 1).fill(0);
  ends[N] = G;
  for (let i = N; i >= 1; i--) ends[i - 1] = arg[i][ends[i]];
  const segments = items.map((it, i) => {
    const a = ends[i]; const b = ends[i + 1];
    const L = lengthOf(a, b);
    return { index: i, name: it.name, from: r3(B[a].to), to: r3(B[b].from), sungSec: r3(sungOf(a, b)), spanSec: r3(spanOf(a, b)), expectedSec: r3(expected[i]), ratio: r3(L / expected[i]), soundCost: soundCost ? r3(sound(i, a, b)) : null };
  });
  // each inner boundary: the pause chosen, and the best other pause with its extra cost — the margin
  const boundaries = [];
  for (let i = 1; i < N; i++) {
    const chosen = ends[i];
    let runner = null; let runnerCost = INF;
    for (let b = 1; b < G; b++) {
      if (b === chosen) continue;
      const c = fwd[i][b] + bwd[i][b];
      if (c < runnerCost) { runnerCost = c; runner = b; }
    }
    boundaries.push({ after: items[i - 1].name, before: items[i].name, from: r3(B[chosen].from), to: r3(B[chosen].to), len: r3(B[chosen].len), pinned: pin[i] >= 0, virtual: !!B[chosen].virtual, runnerUp: runner == null || runnerCost === INF ? null : { from: r3(B[runner].from), to: r3(B[runner].to), len: r3(B[runner].len), extraCost: r3(runnerCost - fwd[N][G]) } });
  }
  return { measure, cost: r3(fwd[N][G]), pauses: gaps.length, valleys: B.length - anchors.length, first: r3(first), last: r3(last), segments, boundaries };
}

// The cuts with the learner's pace this take fitted: the expectations are scaled by a common
// factor s (SCALE_MIN..SCALE_MAX, a mild cost for straying from the learnt pace), under two
// hypotheses — every sloka whole, or the take stopped inside the last sloka, whose expected
// length is then what remains of the take's sound after the others — and the least total
// cost wins. The two cannot be told apart by lengths alone (less sound than expected is a
// faster learner or a shorter last sloka alike), so `lastPos` — the ear's position at the
// stop as a share of the last sloka's plan, when known — settles it: from LAST_WHOLE_FROM
// only 'whole' is tried, under LAST_PARTIAL_TO only 'partialLast'. Returns cutsFor's result
// with `scale`, `hypothesis` ('whole' | 'partialLast') and `hint`.
export function fitCuts(F, items, expected, { sungTotal = null, scalePrior = SCALE_PRIOR * LENGTH_WEIGHT, lastPos = null, ...opts } = {}) { // opts: cutsFor's, `pinned` among them
  const hint = lastPos == null || !Number.isFinite(Number(lastPos)) ? 'none' : Number(lastPos) >= LAST_WHOLE_FROM ? 'whole' : Number(lastPos) < LAST_PARTIAL_TO ? 'partialLast' : 'open';
  const N = items.length;
  if (!expected || expected.length !== N) return null;
  let total = sungTotal;
  if (total == null) { const { mask } = soundMaskOf(F); const sm = fillShortGaps(mask, Math.round(SUNG_FILL_SEC / F.hopSec)); total = 0; for (let k = 0; k < sm.length; k++) if (sm[k]) total++; total *= F.hopSec; }
  let best = null;
  for (let s = SCALE_MIN; s <= SCALE_MAX + 1e-9; s *= SCALE_STEP) {
    const prior = scalePrior * Math.log(s) ** 2;
    const scaled = expected.map((e) => e * s);
    const whole = hint === 'partialLast' ? null : cutsFor(F, items, scaled, { ...opts, lastShortWeight: 1 });
    if (whole && (!best || whole.cost + prior < best.total)) best = { ...whole, scale: r3(s), hypothesis: 'whole', total: whole.cost + prior };
    if (N > 1 && total > 0 && hint !== 'whole') {
      const rest = total - scaled.slice(0, N - 1).reduce((a, b) => a + b, 0);
      if (rest >= PARTIAL_LAST_MIN * scaled[N - 1] && rest < scaled[N - 1]) {
        const partial = cutsFor(F, items, [...scaled.slice(0, N - 1), rest], { ...opts, lastShortWeight: 1 });
        if (partial && (!best || partial.cost + prior < best.total)) best = { ...partial, scale: r3(s), hypothesis: 'partialLast', total: partial.cost + prior };
      }
    }
  }
  if (best) { best.total = r3(best.total); best.hint = hint; }
  return best;
}

// All three methods on a take's features (dsp/features.js: `rmsDb`, `hopSec`), and the one
// to go by: the plan at the learner's speed when known, else the teacher at their tempo,
// else the take's own shares. `soundCost(i, fromSec, toSec)` is optional (see cutsFor).
// `recited`: how many of the slokas, in order, the take reached (the ear's word at the stop);
// the rest are reported as not recited and not placed.
export function segmentTake(F, allItems, { pace = null, minGapSec = MIN_GAP_SEC, soundCost = null, soundWeight = 1, lastPos = null, pinned = null, recited = null } = {}) {
  if (!F || !F.hopSec || !(F.rmsDb || F.active) || !allItems || !allItems.length) return { error: 'no features or no slokas' };
  const items = Number.isInteger(recited) && recited > 0 && recited < allItems.length ? allItems.slice(0, recited) : allItems;
  const rest = allItems.slice(items.length).map((it, k) => ({ index: items.length + k, name: it.name, from: null, to: null, notRecited: true }));
  const { mask, thresholdDb, floorDb, peakDb } = soundMaskOf(F);
  const { first, last, gaps } = pausesOf(mask, F.hopSec, { minGapSec });
  const sm = fillShortGaps(mask, Math.round(SUNG_FILL_SEC / F.hopSec));
  let sungTotal = 0;
  for (let k = 0; k < sm.length; k++) if (sm[k]) sungTotal++;
  sungTotal *= F.hopSec;
  const exp = expectations(items, pace, sungTotal);
  const opts = { minGapSec, mask, soundCost, soundWeight, lastPos, pinned };
  const results = {};
  if (exp.teacher) results.teacher = fitCuts(F, items, exp.teacher, { ...opts, measure: 'span', sungTotal });
  if (exp.plan) results.plan = fitCuts(F, items, exp.plan, { ...opts, measure: 'sung', sungTotal });
  if (exp.share) results.share = cutsFor(F, items, exp.share, { ...opts, measure: 'sung', lastShortWeight: 1 });
  if (rest.length) for (const r of Object.values(results)) if (r) r.segments.push(...rest);
  const chosen = results.plan ? 'plan' : results.teacher ? 'teacher' : results.share ? 'share' : null;
  return { version: 1, recited: items.length, items: allItems.map((it) => ({ name: it.name, teacherSec: r3(it.teacherSec), total: it.total, speakerLine: it.speakerLine || 0 })), pace: pace ? { tempoRatio: pace.tempoRatio || null, aksPerSec: pace.aksPerSec || null } : null, quiet: { thresholdDb, floorDb, peakDb }, sungTotal: r3(sungTotal), spanTotal: r3(last - first), pauses: gaps.length, sound: !!soundCost, lastPos: r3(lastPos), pinned: (pinned || []).map((p) => ({ after: p.after, at: r3(p.at) })), chosen, results };
}

// The stretch of a take to play for one sloka, from the window it was compared on: the window
// is loose at both ends (half a second of padding, the alignment's slack), so it begins inside
// the previous sloka's tail and may end before this sloka's last sound has died away. The start
// moves to the sloka's first sound after the last breath (a quiet gap of at least gapSec) found
// within headSec of the window's start (two seconds: less than a speaker line, so one is never
// skipped); the end moves to the end of this sloka's last sound — on past the window when the
// sound runs on (at most tailSec), back to where the breath began when the next sloka has
// already started by the window's end, back to the last sound when the window ends in quiet —
// plus a short tail. `F`: the take's features (rmsDb,
// hopSec), its sound mask cached on it. Returns [from, to] in seconds.
export function playRangeOf(F, window, { headSec = 2.0, tailSec = 1.0, nextSec = 0.8, gapSec = 0.12, breathSec = 0.25, lineSec = 0.6, lineSpanSec = 1.5, keepSec = 0.15 } = {}) {
  if (!window || !(window[1] > window[0])) return window || null;
  if (!F || !F.hopSec || !F.rmsDb) return [window[0], window[1]];
  if (!F.playMask) F.playMask = soundMaskOf(F).mask;
  const mask = F.playMask;
  const hop = F.hopSec;
  const n = mask.length;
  const minGap = Math.max(1, Math.round(gapSec / hop));
  const a = Math.max(0, Math.round(window[0] / hop));
  const b = Math.max(a, Math.min(n, Math.round(window[1] / hop)));
  // the start: the end of the first breath (a quiet gap of breathSec or more) beginning within
  // headSec of the window's start that is followed by a line — at least lineSec of sound in the
  // next lineSpanSec (the syllables come as short bursts at this threshold, so a run will not
  // do) — not a stray sound, which is skipped with the quiet after it; none: the window's start
  let start = a;
  const aMax = Math.min(b, Math.round((window[0] + headSec) / hop));
  const minBreath = Math.max(1, Math.round(breathSec / hop));
  const lineFrames = Math.max(1, Math.round(lineSec / hop));
  const spanFrames = Math.max(1, Math.round(lineSpanSec / hop));
  const soundIn = (from, to) => { let c = 0; for (let k = from; k < Math.min(n, to); k++) if (mask[k]) c++; return c; };
  for (let k = a; k < aMax; k++) {
    if (mask[k]) continue;
    let j = k;
    while (j < b && !mask[j]) j++;
    if (j - k >= minBreath && soundIn(j, j + spanFrames) >= lineFrames) { start = j; break; }
    k = j;
  }
  // the end: sound at the window's end is this sloka's last sound running past it, or the next
  // sloka already begun — a breath ending within nextSec before the window's end says the latter,
  // and the sloka ends where that breath began; a window ending in quiet ends at the last sound
  let end = b;
  const runOn = () => { let k = b; while (k < n && mask[k] && (k - b) * hop < tailSec) k++; end = k; };
  if (b < n && mask[b]) {
    let breath = -1; // where the last breath (quiet of gapSec or more) ending within nextSec before the window's end began; a shorter quiet is a closure, skipped
    for (let k = b; k > start && (b - k) * hop <= nextSec; k--) {
      if (mask[k - 1]) continue;
      let j = k;
      while (j > start && !mask[j - 1]) j--;
      if (k - j >= minGap) { breath = j; break; }
      k = j;
    }
    if (breath >= 0) end = breath; else runOn();
  } else { let k = b; while (k > start && !mask[k - 1]) k--; end = k; }
  end = Math.min(n, end + Math.round(keepSec / hop));
  if (end <= start) return [window[0], window[1]];
  return [Math.round(start * hop * 1000) / 1000, Math.round(end * hop * 1000) / 1000];
}

const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
