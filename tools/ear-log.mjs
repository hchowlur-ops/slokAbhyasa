#!/usr/bin/env node
// Reads the ear's log of a take of several slokas (sessions/<id>/ear.json, written by the
// app from js/earlog.js) and prints what the ear saw and decided, sloka by sloka: the count
// against the plan every half second, every event (a pause ended, a restart or the next
// sloka's opening checked by sound, the position reaching the plan, the close and the rule
// that closed it, the page turn, the stretch sent on, the words back), then the comparison's
// window for the sloka from the session and its slips — and a summary: when each sloka
// closed, by what rule, how far the count was, how long after the last sound the page
// turned, and the counter's nuclei per akṣara and the akṣaras per second this take against
// the pace the ear had learnt of the learner.
//
//   node tools/ear-log.mjs <session id, or its last letters> [--every 0.5] [--ticks] [--data <dir>]
//   node tools/ear-log.mjs --file <ear.json> [--session <session.json>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rowsOf } from '../js/earlog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r1 = (x) => (x == null ? '—' : (Math.round(x * 10) / 10).toFixed(1));
const r2 = (x) => (x == null ? '—' : (Math.round(x * 100) / 100).toFixed(2));
const pad = (s, n) => String(s).padEnd(n);

// The log and the session, as text. `every`: seconds between the count lines (0 for every tick).
export function formatEarLog(log, session = null, { every = 0.5, ticks = false } = {}) {
  const out = [];
  const rows = rowsOf(log);
  const lead = Number(log.removedStart) || 0; // the trimmed lead: the session's windows are in the take's time, the log in the recording's
  const pace = log.pace || {};
  const items = (log.take && log.take.items) || [];
  out.push(`Take ${session ? session.id : '(no session)'} · ${items.join(', ')} · recording ${r1(rows.length ? rows[rows.length - 1].recSec : null)} s${log.takeDuration ? ` (take ${r1(log.takeDuration)} s after trimming ${r2(lead)} s of lead)` : ''}`);
  out.push(`The ear's pace for this learner: ${pace.countRatio ? `${pace.countRatio} nuclei per akṣara` : 'no count ratio'}, ${pace.aksPerSec ? `${pace.aksPerSec} akṣaras a second` : 'no speed'}, pauses ${pace.padaPauseMs} ms between pādas and ${pace.slokaPauseMs} ms between slokas · head detection ${log.headDetection ? 'on' : 'off'} · words ${log.words ? 'heard' : 'not heard'}${log.dropped ? ` · ${log.dropped} rows dropped (the cap)` : ''}`);
  if (session) out.push(`Session: overall ${session.overall} · ${session.grade}`);
  out.push('');
  // the rows grouped by the sloka in view: a 'target' row opens each stretch
  const groups = [];
  let g = null;
  for (const r of rows) {
    if (r.kind === 'target') { g = { target: r, rows: [], index: r.index, name: r.name }; groups.push(g); continue; }
    if (!g) { g = { target: null, rows: [], index: null, name: null }; groups.push(g); }
    g.rows.push(r);
  }
  const summary = [];
  for (const grp of groups) {
    const t = grp.target;
    const item = session && Array.isArray(session.items) ? session.items.find((it) => it.name === grp.name) : null;
    out.push(`== ${grp.name || '(no sloka)'}${t ? ` · ${t.expected ?? '?'} akṣaras${t.speakerLine ? ` (speaker line ${t.speakerLine})` : ''}, pādas ${t.padas || '?'} · ${t.fingerprints} fingerprints${t.threshold != null ? ` (threshold ${t.threshold})` : ''} · next ${t.next || 'none'}${t.next ? ` (${t.nextFingerprints} fingerprints)` : ''} · teacher ${r1(t.teacherMs / 1000)} s · from ${r2(t.recSec)} s` : ''}`);
    out.push(`  ${pad('rec s', 8)}${pad('wall s', 8)}${pad('nuclei', 8)}${pad('pos', 8)}${pad('active', 8)}${pad('pause', 7)}${pad('thr', 6)}${pad('lvl', 6)}event`);
    let nextLine = -Infinity;
    let lastTick = null;
    let pauseBegan = null;
    for (const r of grp.rows) {
      if (r.kind === 'tick') {
        if (r.pauseMs < 120) pauseBegan = null; else if (pauseBegan == null) pauseBegan = r.recSec - r.pauseMs / 1000;
        lastTick = r;
        if (ticks || every <= 0 || r.recSec >= nextLine) {
          out.push(`  ${pad(r2(r.recSec), 8)}${pad(r2(r.wallMs / 1000), 8)}${pad(r.nuclei, 8)}${pad(r1(r.pos), 8)}${pad(r1(r.activeMs / 1000), 8)}${pad(r.pauseMs >= 1e6 ? '—' : r.pauseMs, 7)}${pad(r.thresholdDb ?? '', 6)}${pad(r.levelDb ?? '', 6)}`);
          nextLine = Math.floor(r.recSec / every) * every + every;
        }
        continue;
      }
      out.push(`  ${pad(r2(r.recSec), 8)}${pad(r2(r.wallMs / 1000), 8)}${pad('', 43)}${describe(r)}`);
      if (r.kind === 'close' || r.kind === 'stop') {
        const turn = grp.rows.find((x) => x.kind === 'turn' && x.recSec >= r.recSec);
        const lastSound = r.kind === 'close' ? (r.by === 'head' ? null : r.recSec - (r.pauseMs || 0) / 1000) : (lastTick && lastTick.pauseMs >= 120 ? lastTick.recSec - lastTick.pauseMs / 1000 : lastTick ? lastTick.recSec : null);
        const sungSec = r.kind === 'close' ? r.sungMs / 1000 : null;
        summary.push({
          name: grp.name, kind: r.kind, by: r.kind === 'close' ? r.by : r.judgement, pos: r.pos, expected: r.expected, nuclei: r.kind === 'close' ? r.nuclei : (lastTick ? lastTick.nuclei : null),
          closedAt: r.recSec, to: r.to, lastSound, shownAfter: turn && lastSound != null ? turn.recSec - lastSound : null, turnWall: turn ? (turn.wallMs - r.wallMs) : null,
          sungSec, nucleiPerAks: r.kind === 'close' && r.expected ? r.nuclei / r.expected : null, aksPerSec: sungSec && r.expected ? r.expected / sungSec : null,
          window: item && item.diag && item.diag.matchedHeard ? item.diag.matchedHeard.map((x) => x + lead) : null, tempo: item && item.diag ? item.diag.tempoRatio : null, contrast: item && item.diag ? item.diag.contrast : null, matched: item ? item.matched : null, slips: item ? item.slips : null,
        });
      }
    }
    if (item) out.push(`  comparison: ${item.matched ? 'matched' : 'not matched'}${item.diag ? ` · window ${item.diag.matchedHeard ? item.diag.matchedHeard.map((x) => r2(x + lead)).join('–') : '?'} s of the recording (by ${item.diag.matchedBy || item.diag.located || '?'}) · tempo ${item.diag.tempoRatio} · contrast ${item.diag.contrast}` : ''}${item.partial ? ' · less than half recited' : ''} · slips ${item.slips && item.slips.length ? item.slips.map((s) => `${s.kind}${s.pada ? ` pāda ${s.pada}` : ''}${s.count != null ? ` ${s.count}/${s.expected}` : ''} at ${s.at}s by ${s.by}`).join('; ') : 'none'}`);
    out.push('');
  }
  if (summary.length) {
    out.push('Summary');
    out.push(`  ${pad('sloka', 10)}${pad('closed at', 11)}${pad('by', 9)}${pad('pos/plan', 10)}${pad('nuclei', 8)}${pad('page after', 12)}${pad('nuclei/akṣ', 12)}${pad('akṣ/s', 8)}${pad('window (rec s)', 16)}${pad('tempo', 7)}result`);
    for (const s of summary) {
      out.push(`  ${pad(s.name, 10)}${pad(r2(s.closedAt), 11)}${pad(s.by, 9)}${pad(`${r1(s.pos)}/${s.expected ?? '?'}`, 10)}${pad(s.nuclei ?? '—', 8)}${pad(s.shownAfter != null ? `${r2(s.shownAfter)} s` : s.kind === 'stop' ? 'stopped' : '—', 12)}${pad(s.nucleiPerAks != null ? `${r2(s.nucleiPerAks)}${pace.countRatio ? ` (${pace.countRatio})` : ''}` : '—', 12)}${pad(s.aksPerSec != null ? `${r2(s.aksPerSec)}${pace.aksPerSec ? ` (${pace.aksPerSec})` : ''}` : '—', 8)}${pad(s.window ? s.window.map(r2).join('–') : '—', 16)}${pad(s.tempo ?? '—', 7)}${s.matched == null ? '' : s.matched ? 'recited' : 'not recited'}${s.slips && s.slips.length ? ` · ${s.slips.map((x) => x.kind).join(', ')}` : ''}`);
    }
    out.push('  (nuclei/akṣ and akṣ/s: this take, with what the ear expected in brackets; "page after": the page turned this long after the last sound before the close)');
  }
  return out.join('\n');
}

function describe(r) {
  switch (r.kind) {
    case 'retarget': return `plan arrived late: ${r.name} ${r.expected} akṣaras, ${r.fingerprints} fingerprints`;
    case 'begin': return `count begins for ${r.name}`;
    case 'resume': return `${r.pauseMs >= 1e6 ? 'first sound' : `sound again after ${r.pauseMs} ms`} at ${r1(r.pos)} (${r.pada === 0 ? 'the speaker line' : r.pada != null ? `pāda ${r.pada}` : 'no plan'}${r.atBoundary ? ', at its end' : ''})${r.restartCheck ? ' → restart check queued' : ''}`;
    case 'restart': return r.pauseMs === 'no-rows' || r.f0 === 'no-rows' ? 'restart check: no frames' : `restart check ${r.pauseMs >= 1e6 ? 'at the first sound' : `after ${r.pauseMs} ms`} at ${r1(r.pos)}: best ${r.best} dist ${r.dist} margin ${r.margin} → ${r.confident ? 'confident' : 'doubtful, nothing done'}`;
    case 'falseStart': return `the sloka from the top (was at ${r1(r.was)}; ${r1(r.since)} since the pause)`;
    case 'padaNext': return `pāda ${r.pada} is simply next (was at ${r1(r.was)}, it starts at ${r.startCount})`;
    case 'padaAgain': return `pāda ${r.pada} again: the count goes back to ${r.startCount} (was at ${r1(r.was)})`;
    case 'head': return typeof r.best === 'string' && (r.best === 'no-rows' || r.best === 'short' || r.best === 'stale') ? `next-sloka check: ${r.best}` : `next-sloka check: best ${r.best} dist ${r.dist} (threshold ${r.threshold}) runner-up ${r.runnerUp} margin ${r.margin} → ${r.confident ? (r.best === 'head' ? 'THE NEXT SLOKA HEARD' : 'confident, own pāda') : 'doubtful'}`;
    case 'headAt': return `the next sloka (${r.next}) heard by its opening here`;
    case 'reached': return `position reached the plan: ${r1(r.pos)} of ${r.expected} (${r.nuclei} nuclei)`;
    case 'stall': return `stall marked in pāda ${r.pada} at ${r1(r.pos)} (pause ${r.pauseMs} ms)`;
    case 'close': return `CLOSED ${r.name} by ${r.by}: ${r1(r.pos)} of ${r.expected} (${r.nuclei} nuclei), pause ${r.pauseMs} ms, sung ${r1(r.sungMs / 1000)} s${r.runOnMs ? `, run-on ${r.runOnMs} ms` : ''}${r.partial ? ' · PARTIAL' : r.dropped ? ' · dropped' : ''} · stretch to ${r2(r.to)} s${r.carried ? ` · ${r.carried} nuclei carried to the next` : ''}`;
    case 'learn': return `learnt: ${r.aksPerSec} akṣaras/s (n ${r.speedN}), ${r.countRatio} nuclei/akṣara (n ${r.countRatioN}), tempo ${r.tempo} (n ${r.tempoN}); sung ${r.sungSec} s, ${r.nuclei} nuclei`;
    case 'turn': return `PAGE TURNED to ${r.name}`;
    case 'done': return 'every sloka heard';
    case 'segment': return `stretch ${r.name} ${r2(r.from)}–${r2(r.to)} s ${r.heard ? 'sent to the speech worker' : 'kept, not heard'}${r.count != null ? ` (count ${r1(r.count)} of ${r.expected}, ${r.nuclei} nuclei)` : ''}${r.note ? ` · ${r.note}` : ''}`;
    case 'words': return `words back for ${r.name}: ${r.aksharas} akṣaras in ${r.tookMs} ms`;
    case 'calibrate': return `count tuned by the words: ${r.countRatio} nuclei per akṣara`;
    case 'relabel': return `the words say ${r.heard}, not ${r.assumed} (${r.simHeard} vs ${r.simAssumed})`;
    case 'manual': return `tapped: from pāda ${r.pada} (count ${r.count})`;
    case 'pageByHand': return `page turned by hand to ${r.index}`;
    case 'stop': return `STOP on ${r.name}: ${r1(r.pos)} of ${r.expected} → ${r.judgement}`;
    default: return `${r.kind} ${JSON.stringify(r)}`;
  }
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] != null ? args[i + 1] : def; };
  const flag = (name) => args.includes(name);
  const every = Number(opt('--every', 0.5));
  const ticks = flag('--ticks');
  let log; let session = null;
  if (opt('--file', null)) {
    log = JSON.parse(fs.readFileSync(opt('--file'), 'utf8'));
    const sp = opt('--session', null);
    if (sp) session = JSON.parse(fs.readFileSync(sp, 'utf8'));
  } else {
    const key = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--every' && args[args.indexOf(a) - 1] !== '--data');
    if (!key) { console.error('usage: node tools/ear-log.mjs <session id or its last letters> [--every 0.5] [--ticks] | --file <ear.json> [--session <session.json>]'); process.exit(2); }
    const dataDir = () => { try { const l = JSON.parse(fs.readFileSync(path.join(ROOT, 'local.json'), 'utf8')); if (l.dataDir) return l.dataDir; if (l.data) return l.data; } catch { /* default */ } return path.join(ROOT, 'data'); };
    const DATA = opt('--data', process.env.SLOKABHYASA_DATA || dataDir());
    const dir = path.join(DATA, 'sessions');
    const id = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).find((f) => f === key || f.endsWith(key));
    if (!id) { console.error(`no session ${key} in ${dir}`); process.exit(2); }
    const earPath = path.join(dir, id, 'ear.json');
    if (!fs.existsSync(earPath)) { console.error(`no ear log for ${id} (${earPath}): the take had one sloka, or was made before the log existed`); process.exit(2); }
    log = JSON.parse(fs.readFileSync(earPath, 'utf8'));
    session = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));
  }
  console.log(formatEarLog(log, session, { every, ticks }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
