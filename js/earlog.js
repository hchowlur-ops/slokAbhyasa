// The ear's log of a take of several slokas: what the ear saw and decided, tick by tick,
// kept to find out why a sloka closed early or late and how long the page took to turn.
// Cheap by design: a row is a small array pushed on an in-memory list — about eleven
// times a second while recording (the recorder's chunk rate) and once more for each event
// — no strings are built and nothing is written until the take is over, when the list is
// serialised once and kept beside the session (sessions/<id>/ear.json). Read it with
// tools/ear-log.mjs. Pure; Node-testable.
export const EAR_LOG_VERSION = 1;

// Every row: [kind, recSec, wallMs, ...fields]. recSec is the recording's own clock (the
// seconds of audio the ear had read when the row was written); wallMs the milliseconds
// since the log began, by the page's clock — the two together say how long after a sound
// the ear acted on it. The fields of each kind are listed in ROW_FIELDS.
export const ROW_FIELDS = {
  target: ['index', 'name', 'expected', 'speakerLine', 'padas', 'fingerprints', 'threshold', 'next', 'nextFingerprints', 'teacherMs'],
  retarget: ['name', 'expected', 'fingerprints'],
  begin: ['name'],
  tick: ['nuclei', 'pauseMs', 'activeMs', 'pos', 'thresholdDb', 'levelDb'],
  resume: ['pauseMs', 'pos', 'pada', 'atBoundary', 'restartCheck'],
  restart: ['pauseMs', 'pos', 'best', 'dist', 'margin', 'confident'],
  falseStart: ['was', 'since'],
  padaNext: ['pada', 'was', 'startCount'],
  padaAgain: ['pada', 'was', 'startCount', 'since'],
  head: ['best', 'dist', 'runnerUp', 'margin', 'threshold', 'confident'],
  headAt: ['next'],
  reached: ['pos', 'expected', 'nuclei'],
  stall: ['pada', 'pos', 'pauseMs'],
  close: ['name', 'by', 'pos', 'expected', 'nuclei', 'pauseMs', 'sungMs', 'runOnMs', 'partial', 'dropped', 'to', 'carried'],
  learn: ['aksPerSec', 'speedN', 'countRatio', 'countRatioN', 'tempo', 'tempoN', 'sungSec', 'nuclei'],
  turn: ['index', 'name'],
  done: [],
  segment: ['name', 'from', 'to', 'heard', 'count', 'expected', 'nuclei', 'note'],
  words: ['name', 'aksharas', 'tookMs'],
  calibrate: ['countRatio', 'nuclei', 'aksharasHeard'],
  relabel: ['assumed', 'heard', 'simAssumed', 'simHeard'],
  manual: ['pada', 'count'],
  pageByHand: ['index'],
  stop: ['name', 'pos', 'expected', 'judgement'],
};

export class EarLog {
  constructor({ cap = 80000, now = null } = {}) {
    this.now = now || (() => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()));
    this.t0 = this.now();
    this.cap = cap;
    this.rows = [];
    this.dropped = 0;
    this.head = {};
  }
  // kind: one of ROW_FIELDS; t: the recording's clock in seconds; fields: numbers or short strings
  push(kind, t, ...fields) {
    if (this.rows.length >= this.cap) { this.dropped++; return; }
    this.rows.push([kind, Math.round(t * 1000) / 1000, Math.round(this.now() - this.t0), ...fields]);
  }
  // The log as kept: the header set by the app, whatever the take adds, the rows.
  finish(extra = {}) {
    return { version: EAR_LOG_VERSION, ...this.head, ...extra, columns: ['kind', 'recSec', 'wallMs'], fields: ROW_FIELDS, dropped: this.dropped, rows: this.rows };
  }
}

// A kept log's rows as objects, for readers: { kind, recSec, wallMs, ...named fields }.
export function rowsOf(log) {
  const fields = (log && log.fields) || ROW_FIELDS;
  return ((log && log.rows) || []).map((r) => {
    const o = { kind: r[0], recSec: r[1], wallMs: r[2] };
    const names = fields[r[0]] || [];
    for (let i = 0; i < Math.max(names.length, r.length - 3); i++) o[names[i] || `f${i}`] = r[i + 3];
    return o;
  });
}
