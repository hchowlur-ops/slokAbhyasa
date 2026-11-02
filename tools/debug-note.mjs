#!/usr/bin/env node
// A debug note for a take of several slokas, as one HTML file in debug-notes/: the verdicts
// as the session kept them, every sloka's three windows side by side — the ear's stretch,
// the second opinion's segment (dsp/segment.js), and where the sloka's own library recording
// lies in the take by sound (dsp/locate.js at five tempos, the search compareAuto runs for
// one sloka in a long take) — with which window the verdict used, then the ear's log as
// tools/ear-log.mjs reads it, the second opinion in full (speaker lines, signatures, every
// method's cuts and margins), and, when replay logs are given, what the replay tool found.
//
//   node tools/debug-note.mjs <session id, or its last letters> [--out debug-notes] [--replay <log file>]... [--data <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeWav } from '../js/wav.js';
import { resample } from '../js/dsp/resample.js';
import { extractFeatures, SR, HOP_SEC } from '../js/dsp/features.js';
import { locate, stretchFeatures } from '../js/dsp/locate.js';
import { resolveDataDir } from '../datadir.js';
import { formatEarLog } from './ear-log.mjs';
import { markdownTwin } from './note-md.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def = null) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] != null ? args[i + 1] : def; };
const opts = (name) => args.map((a, i) => (a === name ? args[i + 1] : null)).filter(Boolean);
const key = args.find((a, i) => !a.startsWith('--') && !['--out', '--replay', '--data'].includes(args[i - 1]));
if (!key) { console.error('usage: node tools/debug-note.mjs <session id or its last letters> [--out debug-notes] [--replay <log>]... [--data <dir>]'); process.exit(2); }
const DATA = opt('--data', process.env.SLOKABHYASA_DATA || resolveDataDir(ROOT));
const OUT = path.resolve(ROOT, opt('--out', 'debug-notes'));
const SESS = path.join(DATA, 'sessions');
const id = fs.readdirSync(SESS).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).find((f) => f === key || f.endsWith(key));
if (!id) { console.error(`no session ${key} in ${SESS}`); process.exit(2); }
const session = JSON.parse(fs.readFileSync(path.join(SESS, `${id}.json`), 'utf8'));
const earPath = path.join(SESS, id, 'ear.json');
const log = fs.existsSync(earPath) ? JSON.parse(fs.readFileSync(earPath, 'utf8')) : null;
const wav = path.join(SESS, id, 'take.wav');
const lib = JSON.parse(fs.readFileSync(path.join(DATA, 'library/index.json'), 'utf8'));
const libArr = Array.isArray(lib) ? lib : lib.items || Object.values(lib);
const libById = new Map(libArr.map((r) => [r.id, r]));

const r2 = (x) => (x == null || !Number.isFinite(Number(x)) ? '—' : (Math.round(Number(x) * 100) / 100).toFixed(2));
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const featuresOf = (p) => { const d = decodeWav(new Uint8Array(fs.readFileSync(p))); return { F: extractFeatures(resample(d.samples, d.sampleRate, SR)), duration: d.samples.length / d.sampleRate }; };

// ---- where each sloka lies by sound ----
const bySound = new Map();
let takeDuration = session.takeDuration || null;
if (fs.existsSync(wav)) {
  const H = featuresOf(wav);
  takeDuration = H.duration;
  for (const it of session.items || []) {
    const rec = libById.get(it.id);
    if (!rec || !rec.file || !fs.existsSync(path.join(DATA, 'library', rec.file))) continue;
    const B = featuresOf(path.join(DATA, 'library', rec.file));
    let best = null;
    for (const k of [0.8, 0.9, 1, 1.1, 1.25]) { const loc = locate(stretchFeatures(B.F, k), H.F); if (loc && (!best || loc.contrast < best.contrast)) best = { from: loc.start * HOP_SEC, to: loc.end * HOP_SEC, contrast: loc.contrast, k, libSec: B.duration }; }
    if (best) bySound.set(it.id, best);
  }
}

// ---- the pieces ----
const so = log && log.secondOpinion && !log.secondOpinion.error ? log.secondOpinion : null;
const chosen = so && so.chosen && so.results ? so.results[so.chosen] : null;
const earSeg = (name) => ((log && log.segments) || []).find((s) => s.name === name) || null;
const adopted = (name) => ((log && log.adopted) || []).find((a) => a.name === name) || null;
const items = session.items || [];

const verdictRows = items.map((it) => {
  const d = it.diag || {};
  const scores = ['phoneme', 'vowel', 'syllable', 'emphasis', 'phrasing', 'timing'].map((k) => (it[k] == null ? '—' : it[k])).join(' / ');
  return `<tr><td>${esc(it.name)}</td><td>${it.matched ? `recited${d.matchedBy ? ` (by ${esc(d.matchedBy)})` : ''}` : it.missing ? 'not in the take' : '<span class="bad">not recited</span>'}</td><td class="n">${d.matchedHeard ? `${r2(d.matchedHeard[0])}–${r2(d.matchedHeard[1])}` : '—'}</td><td class="n">${r2(d.contrast)}</td><td class="n">${r2(d.tempoRatio)}</td><td>${scores}</td><td>${(it.slips || []).length ? esc((it.slips || []).map((s) => `${s.kind}${s.count != null ? ` ${s.count}/${s.expected}` : ''}${s.word ? ` "${s.word}"` : ''} (${s.by || '?'})`).join(' · ')) : 'none'}</td></tr>`;
});

const windowRows = items.map((it, i) => {
  const e = earSeg(it.name);
  const sg = chosen && chosen.segments ? (chosen.segments.find((x) => x.index === i) || chosen.segments[i]) : null;
  const s = bySound.get(it.id);
  const a = adopted(it.name);
  const used = it.diag && it.diag.matchedHeard ? it.diag.matchedHeard : null;
  const dl = (w, ref) => (w && ref ? `${r2(w[0] - ref[0])} / ${r2(w[1] - ref[1])}` : '—');
  const sw = s ? [s.from, s.to] : null;
  return `<tr><td>${esc(it.name)}</td><td class="n">${e ? `${r2(e.from)}–${r2(e.to)}` : '—'}<br><small>Δ ${dl(e ? [e.from, e.to] : null, sw)}</small></td><td class="n">${sg ? `${r2(sg.from)}–${r2(sg.to)}<br><small>×${r2(sg.ratio)} of expected · Δ ${dl([sg.from, sg.to], sw)}</small>` : '—'}</td><td class="n">${s ? `${r2(s.from)}–${r2(s.to)}<br><small>tempo ×${s.k}, contrast ${r2(s.contrast)}${s.contrast >= 0.9 ? ' (weak)' : ''}</small>` : '—'}</td><td class="n">${used ? `${r2(used[0])}–${r2(used[1])}` : '—'}${a ? `<br><small>${a.kept ? `kept the ${a.kept === 'second' ? '2nd' : 'ear'}${a.by ? ` (${esc(a.by)})` : ''}` : a.offered === false ? 'the 2nd not offered (over 6 s apart)' : a.keptBy ? esc(Object.entries(a.keptBy).map(([n, k]) => `${n}: ${k.window}`).join(', ')) : ''}${a.contrast ? ` · contrast 2nd ${a.contrast.second ?? '—'}${a.contrast.ear != null ? `, ear ${a.contrast.ear}` : ''}` : ''}</small>` : ''}</td></tr>`;
});

function secondOpinionText() {
  if (!log) return 'no ear log';
  if (!so) return log.secondOpinion && log.secondOpinion.error ? `error: ${log.secondOpinion.error}` : 'none';
  const out = [];
  out.push(`${so.pauses} pauses · sound ${r2(so.sungTotal)} s of ${r2(so.spanTotal)} s · pace tempo ${so.pace ? so.pace.tempoRatio : '—'}, ${so.pace ? so.pace.aksPerSec : '—'} akṣaras/s · the ear at the stop: ${so.lastPos == null ? '—' : `${Math.round(so.lastPos * 100)} % of the last sloka`} · chosen ${so.chosen}${so.spread != null ? ` · the methods' cuts within ${so.spread} s of each other` : ''}`);
  out.push(`pinned before the search: ${(so.pinned || []).length ? so.pinned.map((p) => `after sloka ${p.after + 1} at ${r2(p.at)} s${p.by ? ` (${p.by})` : ' (the student)'}`).join(', ') : 'nothing'}`);
  const sl = so.speakerLines;
  if (sl) out.push(`speaker lines in the learner's voice: ${sl.templates} templates, thresholds ${JSON.stringify(sl.thresholds)}, ${sl.candidates} starts tried · heard: ${(sl.matches || []).map((m) => `${m.phrase} at ${r2(m.at)} s (dist ${r2(m.dist)}, margin ${r2(m.margin)})`).join(', ') || 'none'} · taken: ${(sl.assigned || []).map((a) => `${a.name} begins at ${r2(a.at)} s`).join(', ') || 'none'}`);
  const sg = so.signatures;
  if (sg) out.push(`signatures (the slokas' own beginnings and endings): ${(sg.markers || []).map((m) => `${m.name} begins ${r2(m.startAt)} s (${m.seeded ? 'seeded by the speaker line' : `dist ${r2(m.startDist)}`})${m.endAt != null ? `, ends ${r2(m.endAt)} s (dist ${r2(m.endDist)})` : ', end not confirmed'}`).join(' · ') || 'none placed'}${sg.starts ? ` · start thresholds ${JSON.stringify(sg.starts.thresholds)}` : ''}`);
  for (const [m, r] of Object.entries(so.results || {})) {
    out.push('');
    out.push(`${m}${so.chosen === m ? ' (chosen)' : ''} · cost ${r2(r.cost)} · pace scale ×${r2(r.scale)} · ${r.hypothesis || ''}`);
    for (const s of r.segments || []) out.push(`  ${s.name.padEnd(10)} ${r2(s.from)}–${r2(s.to)} s · sung ${r2(s.sungSec)} s for ${r2(s.expectedSec)} expected (×${r2(s.ratio)})`);
    for (const b of r.boundaries || []) out.push(`  cut after ${b.after}: the pause ${r2(b.from)}–${r2(b.to)} s${b.pinned ? ' · pinned' : ''}${b.virtual ? ' · through sound' : ''}${b.runnerUp ? ` · next-best pause ${r2(b.runnerUp.from)}–${r2(b.runnerUp.to)} would cost +${r2(b.runnerUp.extraCost)}` : ''}`);
  }
  return out.join('\n');
}

function replayText(file) {
  const t = fs.readFileSync(file, 'utf8');
  const lines = t.split(/\r?\n/);
  const keep = [];
  let inSummary = false;
  for (const l of lines) {
    if (/^Summary/.test(l)) { inSummary = true; keep.push(l); continue; }
    if (inSummary) { if (/^\s*$/.test(l)) inSummary = false; else keep.push(l); continue; }
    if (/take 2026|Session:|windows:|cuts the second opinion|comparison:|report CH|heard [0-9.]+-[0-9.]+ :|toasts:|grade info|card CH|page errors|view check failed|after a card click/.test(l)) keep.push(l);
  }
  return keep.join('\n');
}

// ---- the page ----
const title = `Take ${id} · ${items.map((it) => it.name).join(', ')}`;
const css = `
:root { --bg:#f6f4ee; --paper:#fffdf8; --fg:#1d1b16; --muted:#5d584d; --rule:#d9d3c4; --accent:#1f6f78; --bad:#b3261e; --code:#f0ede4; }
@media (prefers-color-scheme: dark) { :root { --bg:#16150f; --paper:#1f1d16; --fg:#ebe6d8; --muted:#a8a194; --rule:#3a362c; --accent:#6cc3cc; --bad:#ff8a80; --code:#26241c; } }
body { margin:0; background:var(--bg); color:var(--fg); font: 15px/1.5 "IBM Plex Sans","Segoe UI",system-ui,sans-serif; padding: 24px max(16px, 3vw) 48px; }
main { max-width: 1100px; margin: 0 auto; }
h1 { font: 600 1.7rem/1.2 "Source Serif 4",Georgia,serif; margin: 0 0 6px; } h2 { font: 600 1.25rem/1.2 "Source Serif 4",Georgia,serif; margin: 36px 0 10px; padding-top: 12px; border-top: 1px solid var(--rule); }
p { max-width: 80ch; } .muted { color: var(--muted); } .bad { color: var(--bad); } small { color: var(--muted); }
table { border-collapse: collapse; width: 100%; font-size: 0.9rem; font-variant-numeric: tabular-nums; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--rule); vertical-align: top; } th { color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; } td.n { white-space: nowrap; }
.tbl { overflow-x: auto; }
pre { background: var(--code); border: 1px solid var(--rule); border-radius: 6px; padding: 12px 14px; overflow-x: auto; font: 12.5px/1.45 "IBM Plex Mono",Consolas,monospace; white-space: pre; }
details > summary { cursor: pointer; color: var(--accent); margin: 8px 0; }
`;
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${css}</style>
</head>
<body>
<main>
<p class="muted">SlokAbhyasa debug note · written ${new Date().toISOString().slice(0, 16).replace('T', ' ')} by tools/debug-note.mjs</p>
<h1>${esc(title)}</h1>
<p>Recorded ${esc(session.at || '')} · ${r2(takeDuration)} s · overall ${session.overall ?? '—'} (${esc(session.grade || '—')}) · words ${log && log.words ? 'heard live' : 'not heard live'}${log ? ` · the ear's pace: ${esc(JSON.stringify(log.pace || {}))}` : ''}</p>

<h2>Verdicts as the session kept them</h2>
<div class="tbl"><table>
<tr><th>Sloka</th><th>Verdict</th><th>Window (s)</th><th>Contrast</th><th>Tempo</th><th>Phoneme / vowel / syllable / emphasis / phrasing / timing</th><th>Slips</th></tr>
${verdictRows.join('\n')}
</table></div>
<p class="muted">Contrast: how much better the alignment is than the window's surroundings; under 0.87 the sound alone matches. "by ear", "by second" and "by words" say what overturned a sound mismatch.</p>

<h2>Where each sloka lies: three opinions and the window used</h2>
<div class="tbl"><table>
<tr><th>Sloka</th><th>The ear's stretch</th><th>The second opinion (${esc(so ? so.chosen : '—')})</th><th>By sound: the sloka's own recording located in the take</th><th>Window the verdict used</th></tr>
${windowRows.join('\n')}
</table></div>
<p class="muted">Δ: start / end against the sound. The sound locate searches the whole take for the library recording at five tempos and keeps the best contrast; it is the arbiter the notes of 1 November 2026 used, weak when its contrast reaches 0.9.</p>

<h2>The second opinion in full</h2>
<pre>${esc(secondOpinionText())}</pre>

<h2>The ear's log</h2>
<details><summary>What the ear saw and decided, tick by tick (tools/ear-log.mjs)</summary>
<pre>${esc(log ? formatEarLog(log, session, { every: 0.5 }) : 'no ear log')}</pre>
</details>
${opts('--replay').map((f) => `
<h2>Replay: ${esc(path.basename(f))}</h2>
<p class="muted">The take played back through the app by tools/replay-take.mjs; the ear runs live again, so its cuts differ a little from the session's.</p>
<pre>${esc(replayText(f))}</pre>`).join('\n')}
</main>
</body>
</html>
`;
fs.mkdirSync(OUT, { recursive: true });
const outPath = path.join(OUT, `take-${id}.html`);
fs.writeFileSync(outPath, html);
console.log(outPath);
console.log(markdownTwin(outPath, { force: true }));
