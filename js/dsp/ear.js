// The ear's decisions, pure: when a sloka in a take is complete, cut short, or stalled,
// from the learner's position in the akṣara plan and the pauses they leave — never from
// how long the teacher's recording takes. What the ear knows of the learner comes from
// their profile (learnt over their takes) and from the take itself (see learnerPace in the
// app, and calibrateCountRatio below). Nothing here assumes a pace: with no speed known,
// the plan and the pauses decide; with one, the learner's own expected time joins in.

// Default pauses, used until the learner's own are learnt (their medians, see savePace).
export const DEFAULT_PADA_PAUSE_MS = 600;
export const DEFAULT_SLOKA_PAUSE_MS = 1000;
// A pause this long ends a sloka whatever the count says: the learner has stopped.
export const STOP_PAUSE_MS = 4000;
// The least sound before a sloka can end at all.
export const MIN_SUNG_MS = 3000;

// How long the learner takes for the sloka, in milliseconds, from their own speed
// (akṣaras per second); null when no speed is known — then nothing is expected of the
// clock. Never the teacher's time.
export function earExpectedMs(plan, pace) {
  const total = plan && plan.total;
  const speed = pace && Number(pace.aksPerSec) > 0 ? Number(pace.aksPerSec) : 0;
  return total > 0 && speed > 0 ? (total / speed) * 1000 : null;
}

// Where the learner is in the sloka, in akṣaras: the syllable count calibrated to their
// voice, and — once their speed is known — blended half and half with the time they have
// been singing at that speed, which rides over the counter's slips.
export function earPositionOf({ count, countRatio = 1, activeMs = 0, aksPerSec = null, expected = null }) {
  const byCount = count / (countRatio || 1);
  if (!aksPerSec || !expected) return byCount;
  const byTime = Math.min(expected + 2, (activeMs / 1000) * aksPerSec);
  return 0.5 * byCount + 0.5 * byTime;
}

// The long pause that ends a sloka recited well short of its plan: three of the learner's
// own breaths between pādas, a second and a half at least.
export const longPauseMs = (padaPauseMs) => Math.max(1500, 3 * (Number(padaPauseMs) > 0 ? Number(padaPauseMs) : DEFAULT_PADA_PAUSE_MS));

// Is the sloka complete? { complete, partial, dropped, by }.
//   pos        the learner's position in akṣaras (earPositionOf)
//   expected   the plan's akṣaras (null for a sloka without a plan)
//   pauseMs    the pause running now
//   sungMs     sound heard in this sloka so far
//   expectedMs the learner's own expected time for the sloka (earExpectedMs), or null
//   padaPauseMs, slokaPauseMs  the learner's pauses (defaults until learnt)
// A sloka ends the moment the position reaches the plan's end (the last nucleus registers
// within a tenth of a second of its sound), a touch sooner than any breath; a position a
// little short waits for a short pause; one well short waits for a long one — shorter
// once the learner's own time for the sloka is well past; a pause of STOP_PAUSE_MS ends
// it whatever the position. `partial` says under half was recited (not scored),
// `dropped` that the plan was not reached by three akṣaras or more (unsure until the
// words confirm it).
export function earDecision({ pos, expected, pauseMs, sungMs, expectedMs = null, padaPauseMs = null, slokaPauseMs = null }) {
  const out = { complete: false, partial: false, dropped: false, by: null };
  if (!(sungMs >= MIN_SUNG_MS)) return out;
  const exp = expected > 0 ? expected : null;
  const slokaPause = Math.max(500, Math.round((Number(slokaPauseMs) > 0 ? Number(slokaPauseMs) : DEFAULT_SLOKA_PAUSE_MS) * 0.6));
  const overTime = expectedMs > 0 && sungMs > 1.6 * expectedMs;
  const long = longPauseMs(padaPauseMs);
  if (!exp) {
    if (sungMs >= 4000 && pauseMs >= 1500) { out.complete = true; out.by = 'pause'; }
    return out;
  }
  if (pos >= exp - 1 && pauseMs >= 120) { out.complete = true; out.by = 'count'; }
  else if (pos >= exp - 2 && pauseMs >= Math.min(350, slokaPause)) { out.complete = true; out.by = 'count'; }
  else if (pos >= 1.3 * exp && pauseMs >= 400) { out.complete = true; out.by = 'count'; }
  else if (pos >= exp * (overTime ? 0.35 : 0.5) && pauseMs >= long) { out.complete = true; out.by = 'pause'; }
  else if (pauseMs >= STOP_PAUSE_MS) { out.complete = true; out.by = 'stop'; }
  if (!out.complete) return out;
  out.partial = pos < exp * 0.5;
  out.dropped = !out.partial && pos < exp - 2;
  return out;
}

// The ratio of the counter's nuclei to the akṣaras actually recited, read from a stretch
// whose words are in: the voice's own calibration, learnt within the take. null when the
// stretch is too short to say, or the ratio implausible.
export function calibrateCountRatio({ nuclei, aksharasHeard }) {
  if (!(nuclei >= 8) || !(aksharasHeard >= 8)) return null;
  const r = nuclei / aksharasHeard;
  return r >= 0.6 && r <= 1.8 ? Math.round(r * 100) / 100 : null;
}

// Where each pāda starts in a recording, from its own pauses: the longest `padas − 1`
// pauses (one more for a speaker line) between its first and last sound, in order; each
// pāda begins where its pause ends. `active` is the per-frame activity of the recording's
// features (10 ms frames, hopSec). Returns [{ pada, at }] like starts.padaStarts, or []
// when the recording has too few pauses to tell.
export function padaStartsFromPauses(active, hopSec, plan, { minPauseSec = 0.25 } = {}) {
  if (!active || !active.length || !plan || !plan.padas || !plan.padas.length) return [];
  const n = active.length;
  let first = 0;
  while (first < n && !active[first]) first++;
  let last = n - 1;
  while (last >= 0 && !active[last]) last--;
  if (first >= last) return [];
  const gaps = [];
  let start = null;
  for (let k = first; k <= last + 1; k++) {
    const on = k <= last ? !!active[k] : true;
    if (!on && start === null) start = k;
    if (on && start !== null) { const len = (k - start) * hopSec; if (len >= minPauseSec) gaps.push({ from: start * hopSec, to: k * hopSec, len }); start = null; }
  }
  const needed = plan.padas.length - 1 + (plan.speakerLine ? 1 : 0);
  if (gaps.length < needed) return [];
  const chosen = gaps.sort((a, b) => b.len - a.len).slice(0, needed).sort((a, b) => a.from - b.from);
  const out = [];
  let pada = plan.speakerLine ? 0 : 1;
  out.push({ pada, at: first * hopSec });
  for (const g of chosen) { pada++; out.push({ pada, at: g.to }); }
  return out;
}
