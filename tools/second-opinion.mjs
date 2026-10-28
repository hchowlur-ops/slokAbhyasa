#!/usr/bin/env node
// The second opinion on a kept take of several slokas, offline: the cuts found from the whole
// recording (js/dsp/segment.js — the pauses, the slokas' expected lengths, the dynamic
// programme) against the stretches the ear closed live (the ear's log when the take has one,
// else the comparison's windows saved with the session). Nothing in the session is changed.
//
//   node tools/second-opinion.mjs <session id, or its last letters>     one take, in full
//   node tools/second-opinion.mjs --all [--since 2026-10-20]            every kept take of several slokas with audio: a table
//   options: --data <dir> · --method plan|teacher|share (the one shown in the table; default the chosen)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeWav } from '../js/wav.js';
import { resample } from '../js/dsp/resample.js';
import { extractFeatures, SR } from '../js/dsp/features.js';
import { segmentTake } from '../js/dsp/segment.js';
import { aksharaPlan } from '../js/chandas.js';
import { resolveDataDir } from '../datadir.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def = null) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] != null ? args[i + 1] : def; };
const flag = (name) => args.includes(name);
const DATA = opt('--data', process.env.SLOKABHYASA_DATA || resolveDataDir(ROOT));
const SESS = path.join(DATA, 'sessions');
const LIB = path.join(DATA, 'library');
const index = JSON.parse(fs.readFileSync(path.join(LIB, 'index.json'), 'utf8'));
const profiles = (() => { try { const p = JSON.parse(fs.readFileSync(path.join(DATA, 'profiles.json'), 'utf8')); return Array.isArray(p) ? p : p.profiles || Object.values(p); } catch { return []; } })();
const r2 = (x) => (x == null || !Number.isFinite(x) ? '—' : (Math.round(x * 100) / 100).toFixed(2));
const sgn = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x > 0 ? '+' : ''}${(Math.round(x * 100) / 100).toFixed(2)}`);

function slokaOf(item) {
  const rec = index.find((r) => r.id === item.id) || index.find((r) => r.name === item.name);
  if (!rec) return { name: item.name, teacherSec: null, total: null };
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(path.join(LIB, ...rec.file.replace(/\.wav$/i, '.json').split('/')), 'utf8')); } catch { meta = null; }
  const teacherSec = meta && meta.voice && meta.voice.activeSec > 0 ? meta.voice.activeSec : rec.duration || null;
  let total = meta && meta.text && Number.isInteger(meta.text.aksharaCount) ? meta.text.aksharaCount : null;
  let speakerLine = 0;
  if (meta && meta.text && meta.text.body) { try { const plan = aksharaPlan(meta.text.body); if (!total) total = plan.total || null; speakerLine = plan.speakerLine || 0; } catch { /* no plan */ } }
  return { name: rec.name, teacherSec, total, speakerLine };
}
function featuresOf(wavPath) {
  const d = decodeWav(new Uint8Array(fs.readFileSync(wavPath)));
  return { F: extractFeatures(resample(d.samples, d.sampleRate, SR)), duration: d.samples.length / d.sampleRate };
}
// The ear's own stretches, in the take's time: the ear log's segments when kept, else the
// comparison's windows saved with the session.
function earStretches(session, earLog) {
  if (earLog && Array.isArray(earLog.segments) && earLog.segments.length) return { source: 'the ear\'s log', by: new Map(earLog.segments.filter((s) => !s.skipped || s.to - s.from >= 2).map((s) => [s.name, { from: s.from, to: s.to }])) };
  const by = new Map();
  for (const it of session.items || []) if (it.diag && Array.isArray(it.diag.matchedHeard)) by.set(it.name, { from: it.diag.matchedHeard[0], to: it.diag.matchedHeard[1] });
  return { source: 'the comparison\'s windows', by };
}
function analyse(id) {
  const session = JSON.parse(fs.readFileSync(path.join(SESS, `${id}.json`), 'utf8'));
  const wav = path.join(SESS, id, 'take.wav');
  if (!fs.existsSync(wav)) return { session, error: 'no recording kept' };
  let earLog = null;
  try { earLog = JSON.parse(fs.readFileSync(path.join(SESS, id, 'ear.json'), 'utf8')); } catch { earLog = null; }
  const items = (session.items || []).map(slokaOf);
  const learner = session.learner && session.learner.profileId ? profiles.find((p) => p.id === session.learner.profileId) : null;
  const pace = learner && learner.pace ? { tempoRatio: learner.pace.tempoRatio || null, aksPerSec: learner.pace.aksPerSec || null } : null;
  const { F, duration } = featuresOf(wav);
  // the ear's position at the stop, as a share of the last sloka's plan: from the log's stop row, else the session's last item
  let lastPos = null;
  let recited = null;
  const stopRow = earLog && Array.isArray(earLog.rows) ? earLog.rows.find((r) => r[0] === 'stop') : null;
  if (stopRow) { const idx = items.findIndex((it) => it.name === stopRow[3]); recited = stopRow[6] === 'done' ? items.length : idx >= 0 ? idx + 1 : null; }
  if (stopRow && stopRow[6] === 'done') lastPos = 1;
  else if (stopRow && stopRow[5] > 0 && stopRow[4] != null) lastPos = stopRow[4] / stopRow[5];
  else { const lastItem = (session.items || [])[(session.items || []).length - 1]; if (lastItem) { const sl = (lastItem.slips || []).find((x) => (x.kind === 'partial' || x.kind === 'dropped') && x.expected > 0); lastPos = sl ? sl.count / sl.expected : lastItem.partial ? 0.3 : lastItem.matched ? 1 : null; } }
  const second = segmentTake(F, items, { pace, lastPos, recited });
  const ear = earStretches(session, earLog);
  return { session, items, pace, duration, second, ear, earLog };
}
// For one method: each sloka's second-opinion segment against the ear's stretch, and the boundary differences.
function compareMethod(res, method) {
  const r = res.second.results[method];
  if (!r) return null;
  const rows = r.segments.map((s) => { const e = s.notRecited ? null : res.ear.by.get(s.name) || null; return { ...s, ear: e, dFrom: e ? s.from - e.from : null, dTo: e ? s.to - e.to : null }; });
  // the inner boundaries: the second opinion's cut (the pause) against the ear's close (the stretch's end)
  const inner = r.boundaries.map((b, i) => { const row = rows[i]; const earEnd = row && row.ear ? row.ear.to : null; return { after: row ? row.name : b.after, pause: [b.from, b.to], virtual: !!b.virtual, earEnd, d: earEnd != null ? b.from - earEnd : null, margin: b.runnerUp ? b.runnerUp.extraCost : null }; });
  const ds = inner.map((x) => x.d).filter((x) => x != null).map(Math.abs);
  return { rows, inner, maxAbs: ds.length ? Math.max(...ds) : null, meanAbs: ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : null };
}
function printOne(res) {
  const { session, second, ear } = res;
  console.log(`Take ${session.id} · ${(session.items || []).map((it) => it.name).join(', ')} · ${r2(res.duration)} s · learner pace ${res.pace ? `tempo ${res.pace.tempoRatio ?? '—'}, ${res.pace.aksPerSec ?? '—'} akṣaras/s` : 'unknown'} · ${second.pauses} pauses · sound ${r2(second.sungTotal)} s of ${r2(second.spanTotal)} s · the ear at the stop: ${second.lastPos == null ? 'unknown' : `${Math.round(second.lastPos * 100)} % of the last sloka`} · the ear's stretches from ${ear.source}`);
  console.log(`  slokas: ${second.items.map((it) => `${it.name} (${it.total ?? '?'} akṣaras${it.speakerLine ? `, speaker line ${it.speakerLine}` : ''}, teacher ${r2(it.teacherSec)} s)`).join(' · ')}`);
  for (const method of ['plan', 'teacher', 'share']) {
    const c = compareMethod(res, method);
    if (!c) { console.log(`  ${method}: not available${method === 'share' ? '' : ' (no learnt pace)'}${second.results[method] === null ? ' — too few pauses' : ''}`); continue; }
    const rr = second.results[method];
    console.log(`  ${method}${second.chosen === method ? ' (chosen)' : ''} · cost ${rr.cost}${rr.scale != null ? ` · pace scale ×${rr.scale} · ${rr.hypothesis}${rr.hint && rr.hint !== 'none' ? ` (the stop says ${rr.hint})` : ''}` : ''} · boundaries vs the ear: mean |Δ| ${r2(c.meanAbs)} s, max ${r2(c.maxAbs)} s`);
    for (const row of c.rows) console.log(row.notRecited ? `    ${row.name.padEnd(10)} not recited (the take stopped before it)` : `    ${row.name.padEnd(10)} ${r2(row.from)}–${r2(row.to)} s · sung ${r2(row.sungSec)} s for ${r2(row.expectedSec)} expected (×${r2(row.ratio)})${row.ear ? ` · ear ${r2(row.ear.from)}–${r2(row.ear.to)} s · Δstart ${sgn(row.dFrom)} Δend ${sgn(row.dTo)}` : ' · the ear has no stretch'}`);
    for (const b of c.inner) console.log(`      cut after ${b.after}: ${b.virtual ? 'through the sound at' : 'the pause'} ${r2(b.pause[0])}–${r2(b.pause[1])} s${b.earEnd != null ? ` · the ear closed at ${r2(b.earEnd)} s (Δ ${sgn(b.d)})` : ''} · next-best pause would cost +${r2(b.margin)}`);
  }
  for (const it of session.items || []) if (it.slips && it.slips.length) console.log(`  the session's slips on ${it.name}: ${it.slips.map((s) => `${s.kind}${s.count != null ? ` ${s.count}/${s.expected}` : ''}`).join(', ')}`);
  if (res.earLog && res.earLog.secondOpinion) {
    const app = res.earLog.secondOpinion;
    const same = app.chosen === second.chosen && app.results && app.results[app.chosen] && JSON.stringify(app.results[app.chosen].segments.map((s) => [s.from, s.to])) === JSON.stringify(second.results[second.chosen].segments.map((s) => [s.from, s.to]));
    console.log(`  the app's own second opinion in the ear log: ${app.error ? `error ${app.error}` : `${app.chosen}, ${same ? 'the same cuts' : 'different cuts: ' + JSON.stringify(app.results[app.chosen] && app.results[app.chosen].segments.map((s) => [s.from, s.to]))}`}`);
  }
}
function main() {
  if (flag('--all')) {
    const since = opt('--since', null);
    const ids = fs.readdirSync(SESS).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
    const method = opt('--method', null);
    console.log('take · slokas · s · pauses · method · mean |Δ| s · max |Δ| s at the cuts against the ear · the ear\x27s verdicts · the segments\x27 sung time over expected · the margin of each cut');
    const all = [];
    for (const id of ids) {
      if (since && id < since.replace(/-/g, '')) continue;
      let s; try { s = JSON.parse(fs.readFileSync(path.join(SESS, `${id}.json`), 'utf8')); } catch { continue; }
      if (!Array.isArray(s.items) || s.items.length < 2 || !s.audio) continue;
      let res; try { res = analyse(id); } catch (err) { console.log(`${id} · error: ${err.message}`); continue; }
      if (res.error) { console.log(`${id} · ${res.error}`); continue; }
      const m = method || res.second.chosen;
      const c = m ? compareMethod(res, m) : null;
      const verdicts = (s.items || []).map((it) => (it.partial ? 'partial' : it.slips && it.slips.some((x) => x.kind === 'dropped') ? 'dropped' : it.matched ? 'ok' : 'no')).join(',');
      const ratios = m && res.second.results[m] ? res.second.results[m].segments.map((x) => r2(x.ratio)).join(',') : '—';
      const margins = m && res.second.results[m] ? res.second.results[m].boundaries.map((b) => (b.runnerUp ? r2(b.runnerUp.extraCost) : '—')).join(',') : '—';
      const rr = m ? res.second.results[m] : null;
      console.log(`${id} · ${s.items.length} · ${Math.round(res.duration)} · ${res.second.pauses} · ${m || '—'}${rr && rr.scale != null ? ` ×${rr.scale} ${rr.hypothesis}` : ''} · ${c ? r2(c.meanAbs) : '—'} · ${c ? r2(c.maxAbs) : '—'} · ${verdicts} · ×${ratios} · margins ${margins}`);
      if (c && c.maxAbs != null) all.push(c.maxAbs);
    }
    if (all.length) console.log(`\n${all.length} takes · cuts within 0.5 s of the ear on ${all.filter((x) => x <= 0.5).length}, within 1 s on ${all.filter((x) => x <= 1).length}, over 2 s on ${all.filter((x) => x > 2).length}`);
    return;
  }
  const key = args.find((a) => !a.startsWith('--') && !['--data', '--method', '--since'].includes(args[args.indexOf(a) - 1]));
  if (!key) { console.error('usage: node tools/second-opinion.mjs <session id or its last letters> | --all [--since YYYY-MM-DD]'); process.exit(2); }
  const id = fs.readdirSync(SESS).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).find((f) => f === key || f.endsWith(key));
  if (!id) { console.error(`no session ${key}`); process.exit(2); }
  const res = analyse(id);
  if (res.error) { console.error(res.error); process.exit(2); }
  printOne(res);
}
main();
