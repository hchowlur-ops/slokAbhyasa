#!/usr/bin/env node
// Replays a kept take of several slokas through the live app in headless Chrome — the
// take's WAV as the microphone, the chosen learner's profile, the slokas ticked as they
// were — and prints the ear's log of the replay (tools/ear-log.mjs) with the comparison's
// verdicts, so a boundary the ear got wrong can be looked at tick by tick without reciting
// again. The replay's session and log are saved under dist/replays/<take>/ and the session
// deleted from the app (KEEP=1 keeps it); the learner's pace is restored afterwards.
//
//   node tools/replay-take.mjs TAKE=n7y9 NAMES=CH11-04,CH11-05,CH11-06 FOLDER=CH-11
//   environment or arguments: TAKE (the session id's last letters) · NAMES · FOLDER (the
//   picker folder(s), comma-separated) · LEARNER (profile id) · STT=on|off (hear the words;
//   off) · MULTI=on|off (the words in a take of several; off) · HEAD=on|off (the next
//   sloka's opening by sound; on) · KEEP=1 · APP (http://127.0.0.1:8787/) · CHROME (path)
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatEarLog } from './ear-log.mjs';

for (const a of process.argv.slice(2)) { const m = a.match(/^([A-Z]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAKE = process.env.TAKE;
const NAMES = (process.env.NAMES || '').split(',').map((s) => s.trim()).filter(Boolean);
const FOLDER = process.env.FOLDER || '';
if (!TAKE || !NAMES.length || !FOLDER) { console.error('usage: node tools/replay-take.mjs TAKE=<id letters> NAMES=<a,b,c> FOLDER=<picker folder>'); process.exit(2); }
const STT = (process.env.STT || 'off') === 'on';
const MULTI = (process.env.MULTI || 'off') === 'on';
const HEAD = (process.env.HEAD || 'on') === 'on';
const KEEP = process.env.KEEP === '1';
const LEARNER = process.env.LEARNER || 'p-20261008195044-8m0l';
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG = 9431;
const APP = process.env.APP || 'http://127.0.0.1:8787/';
const PROFILE = path.join(os.tmpdir(), 'slokabhyasa-replay-profile');
const dataDir = () => { try { const l = JSON.parse(fs.readFileSync(path.join(ROOT, 'local.json'), 'utf8')); return l.dataDir || l.data; } catch { return null; } };
const SESS = path.join(process.env.SLOKABHYASA_DATA || dataDir() || path.join(ROOT, 'data'), 'sessions');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const dir = fs.readdirSync(SESS).filter((f) => !f.endsWith('.json')).find((f) => (f === TAKE || f.endsWith('-' + TAKE)) && fs.existsSync(path.join(SESS, f, 'take.wav')));
if (!dir) throw new Error(`no take ${TAKE} with a recording in ${SESS}`);
const OUT = path.join(ROOT, 'dist', 'replays', dir);
fs.mkdirSync(OUT, { recursive: true });
const wavSeconds = (p) => { const b = fs.readFileSync(p); const sr = b.readUInt32LE(24); const bits = b.readUInt16LE(34); const ch = b.readUInt16LE(22); let o = 12; while (o < b.length - 8) { const id = b.toString('ascii', o, o + 4), n = b.readUInt32LE(o + 4); if (id === 'data') return n / (sr * ch * bits / 8); o += 8 + n + (n & 1); } return 0; };
const WAV = path.join(SESS, dir, 'take.wav');
const SECONDS = wavSeconds(WAV);
const MIC = path.join(OUT, 'mic.wav');
fs.copyFileSync(WAV, MIC);
log('take', dir, SECONDS.toFixed(1), 's ·', NAMES.join(' + '), '· words', STT ? (MULTI ? 'on, in the take too' : 'on, one sloka only') : 'off', '· head detection', HEAD ? 'on' : 'off');
const profilesBefore = await (await fetch(`${APP}api/profiles`)).json();
const learnerBefore = profilesBefore.find((p) => p.id === LEARNER);
const paceBefore = learnerBefore ? JSON.parse(JSON.stringify(learnerBefore.pace || null)) : null;
if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME} (set CHROME)`);
const chrome = spawn(CHROME, ['--headless=new', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${MIC}`, '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${PROFILE}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
async function targets() { for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://127.0.0.1:${DEBUG}/json`); return await r.json(); } catch { await sleep(200); } } throw new Error('Chrome did not start'); }
const page = (await targets()).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let seq = 0; const waiting = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; } if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)); if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 300)); };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result))); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const pg = (code) => evaluate(`(async () => { ${code} })()`);
const until = async (expr, what, timeoutMs = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < timeoutMs) { if (await evaluate(expr)) return true; await sleep(200); } throw new Error(`Timed out waiting for ${what}`); };
const tick = (name) => pg(`const it = [...document.querySelectorAll('#practice-picker .picker-item')].find(i => i.querySelector('.iname').textContent === '${name}'); if (!it) throw new Error('no sloka ${name} in the picker'); it.querySelector('input').click();`);
const sessionsBefore = (await (await fetch(`${APP}api/sessions`)).json()).map((s) => s.id);
let newSessions = [];
try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: APP + '#settings' });
  await until(`document.querySelector('.nav-btn.active') && document.querySelector('#settings-stt-auto')`, 'app');
  await evaluate(`(() => { const s = JSON.parse(localStorage.getItem('tutor-stt') || '{}'); delete s.cpuTiers; s.auto = ${STT}; s.multi = ${MULTI}; s.tier = null; localStorage.setItem('tutor-ear-head', ${HEAD} ? '1' : '0'); localStorage.setItem('tutor-ear-log', '1'); localStorage.setItem('tutor-stt', JSON.stringify(s)); localStorage.removeItem('tutor-eval-selection'); localStorage.removeItem('tutor-text-language'); localStorage.removeItem('tutor-slokas-per-take'); localStorage.setItem('tutor-eval-text', '1'); localStorage.setItem('tutor-learner', ${JSON.stringify(LEARNER)}); })()`);
  await send('Page.reload'); await sleep(1500);
  await pg(`document.querySelector('.nav-btn[data-view="evaluate"]').click();`);
  await until(`document.querySelectorAll('#practice-picker .picker-folder').length > 0`, 'picker');
  await pg(`document.querySelector('#practice-picker [data-act="clear"]').click(); await new Promise(r => setTimeout(r, 300)); for (const name of ${JSON.stringify(FOLDER.split(',').map((x) => x.trim()))}) { const h = [...document.querySelectorAll('#practice-picker .picker-folder-head')].find(h => h.querySelector('.fname').textContent === name); if (h && !h.closest('.picker-folder').classList.contains('open')) h.click(); }`);
  await sleep(300);
  for (const n of NAMES) { await tick(n); await sleep(400); }
  await until(`!document.querySelector('#practice-rec').disabled`, 'the slokas to load', 60000);
  await sleep(STT ? 12000 : 4000); // the slokas' recordings (and the speech model) loading in the background
  log('page before the take:', await evaluate(`document.querySelector('#practice-texts-pos').textContent + ' · ' + document.querySelector('#practice-text-name').textContent`));
  await pg(`document.querySelector('#practice-rec').click();`);
  const clicked = Date.now();
  await until(`document.querySelector('#practice-rec-count').textContent.length > 0`, 'the recording to begin', 120000);
  log('recording began', ((Date.now() - clicked) / 1000).toFixed(1), 's after the click');
  const t0 = Date.now();
  while (Date.now() - t0 < (SECONDS + 0.8) * 1000) await sleep(250);
  await pg(`document.querySelector('#practice-rec').click();`);
  log('stopped; waiting for the comparison');
  await until(`!document.querySelector('#practice-results').hidden && document.querySelectorAll('#take-cards .take-card').length === ${NAMES.length}`, 'the cards', 120000);
  await until(`!document.querySelector('#report-body').hidden`, 'the report body', 90000).catch((e) => log(e.message));
  await sleep(1500);
  newSessions = (await (await fetch(`${APP}api/sessions`)).json()).filter((s) => !sessionsBefore.includes(s.id));
  if (!newSessions.length) throw new Error('no session was saved for the replay');
  const s0 = newSessions[0];
  let ear = null;
  for (let i = 0; i < 40 && !ear; i++) { const r = await fetch(`${APP}api/sessions/${s0.id}/ear`); if (r.ok) ear = await r.json(); else await sleep(500); }
  if (!ear) throw new Error('the replay saved no ear log (is the app current?)');
  await sleep(STT ? 20000 : 2000); // late words, late syncs
  const session = await (await fetch(`${APP}api/sessions/${s0.id}`)).json();
  fs.writeFileSync(path.join(OUT, 'session.json'), JSON.stringify(session, null, 2));
  fs.writeFileSync(path.join(OUT, 'ear.json'), JSON.stringify(ear));
  const text = formatEarLog(ear, session);
  fs.writeFileSync(path.join(OUT, 'ear-log.txt'), text);
  console.log('');
  console.log(text);
  console.log('');
  log('saved to', OUT);
} catch (err) { console.error('FAILED:', err.message); process.exitCode = 1; } finally {
  if (!KEEP) for (const s of newSessions) await fetch(`${APP}api/sessions/${s.id}`, { method: 'DELETE' }).catch(() => {});
  if (learnerBefore) { const r = await fetch(`${APP}api/profiles/${LEARNER}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pace: paceBefore }) }); const p = await r.json(); log('learner pace restored:', JSON.stringify(p.pace)); }
  if (errors.length) console.log('page errors:', errors);
  try { spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
  await sleep(800);
  chrome.kill();
  process.exit(process.exitCode || 0);
}
