// Records one session of the demo in headless Chrome (see README.md in this folder).
//   node record.mjs prewarm   make Best-model transcripts for the slokas the demo shows
//   node record.mjs 1         home, library, learn, teach and its report, self evaluation
//   node record.mjs 2         quiz, reports, settings and the outro
// Output: out/<session>/frames/*.jpg and out/<session>/timeline.json
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BEATS } from './script.mjs';
import { resolveDataDir } from '../../datadir.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const session = process.argv[2] || '1';
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG = 9340;
const APP = process.env.APP || 'http://127.0.0.1:8787/';
const PROFILE = process.env.PROFILE || path.join(os.tmpdir(), 'slokabhyasa-demo-profile'); // keeps the speech models cached between runs
const AUDIO = path.join(here, 'audio');
const NARR = path.join(here, 'narration');
const durations = JSON.parse(fs.readFileSync(path.join(NARR, 'durations.json'), 'utf8'));
const OUT = path.join(here, 'out', session);
const FRAMES = path.join(OUT, 'frames');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });
const W = 1440;
const H = 900;
const GITHUB = 'github.com/hchowlur-ops/slokAbhyasa';
const ATTEMPT_SECONDS = 14.7; // attempt-03.wav before its silent tail
const QUIZ_TAKE = process.env.QUIZ_TAKE || 'quiz-take-single.wav';
const QUIZ_TAKE_SECONDS = Number(process.env.QUIZ_TAKE_SECONDS || 16.4);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- library lookup ----------
const lib = await (await fetch(`${APP}api/baselines`)).json();
const byName = (n) => { const r = lib.find((x) => x.name.toLowerCase() === n.toLowerCase()); if (!r) throw new Error(`no sloka named ${n}`); return r; };
const S = { c1: byName('CH12-01'), c2: byName('CH12-02'), c3: byName('CH12-03'), c4: byName('CH12-04'), c5: byName('CH12-05') };
const LIBDIR = path.join(resolveDataDir(path.resolve(here, '..', '..')), 'library');
export const wavOf = (r) => path.join(LIBDIR, ...r.file.split('/'));

// ---------- chrome ----------
const mic = session === '2' ? path.join(AUDIO, QUIZ_TAKE) : path.join(AUDIO, 'attempt-03.wav');
const chrome = spawn(CHROME, [
  '--headless=new', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=d3d11', '--ignore-gpu-blocklist',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${mic}`,
  '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', '--force-device-scale-factor=1',
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${PROFILE}`, `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });

async function targets() {
  for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://127.0.0.1:${DEBUG}/json`); return await r.json(); } catch { await sleep(200); } }
  throw new Error('Chrome did not start');
}
const page = (await targets()).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let seq = 0;
const waiting = new Map();
const pageLogs = [];
const timeline = { session, W, H, frames: [], audio: [], captions: [], cuts: [], end: 0 };
let T0 = null; // wall time (s) when the screencast began
const now = () => Date.now() / 1000 - T0;
let frameNo = 0;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
  if (m.method === 'Page.screencastFrame') {
    const { data, metadata, sessionId } = m.params;
    send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    if (T0 == null) return;
    const file = `f${String(++frameNo).padStart(6, '0')}.jpg`;
    fs.writeFileSync(path.join(FRAMES, file), Buffer.from(data, 'base64'));
    const t = Math.max(0, (metadata && metadata.timestamp ? metadata.timestamp : Date.now() / 1000) - T0);
    timeline.frames.push({ file, t });
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') pageLogs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  if (m.method === 'Runtime.exceptionThrown') pageLogs.push(`exception: ${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description || ''}`.slice(0, 300));
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  waiting.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
// runs page-side helper code: `await __demo.click('#x')` etc.
const pg = (code) => evaluate(`(async () => { ${code} })()`);
const until = async (expr, what, timeoutMs = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { if (await evaluate(expr)) return true; await sleep(150); }
  throw new Error(`Timed out waiting for ${what}`);
};
const visible = (sel) => `(() => { const e = document.querySelector('${sel}'); return !!e && !e.hidden && e.offsetParent !== null; })()`;

async function setFile(selector, file) {
  const r = await send('Runtime.evaluate', { expression: `document.querySelector('${selector}')` });
  await send('DOM.setFileInputFiles', { files: [file], objectId: r.result.objectId });
}

// ---------- page-side helpers: cursor, captions, title cards ----------
const HELPERS = `(() => {
  if (window.__demo) return;
  const style = document.createElement('style');
  style.textContent = \`
    #demo-cursor { position: fixed; left: -100px; top: -100px; z-index: 100000; pointer-events: none; transition: left .45s cubic-bezier(.3,.7,.3,1), top .45s cubic-bezier(.3,.7,.3,1); filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
    #demo-pulse { position: fixed; width: 40px; height: 40px; margin: -20px 0 0 -20px; border: 3px solid #e9a62a; border-radius: 50%; z-index: 99999; pointer-events: none; opacity: 0; }
    #demo-caption { position: fixed; left: 50%; bottom: 30px; transform: translateX(-50%); max-width: 1000px; background: rgba(17,24,39,.86); color: #fff; font: 500 21px/1.4 system-ui, Segoe UI, sans-serif; padding: 13px 22px; border-radius: 14px; z-index: 99998; opacity: 0; transition: opacity .3s; text-align: center; }
    #demo-card { position: fixed; inset: 0; z-index: 99997; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; background: linear-gradient(135deg, #1b2341 0%, #2b3566 55%, #141a33 100%); color: #fff; font-family: system-ui, Segoe UI, sans-serif; opacity: 0; transition: opacity .7s; }
    #demo-card .mark { width: 176px; height: 176px; border-radius: 40px; object-fit: cover; box-shadow: 0 18px 48px rgba(0,0,0,.45); margin-bottom: 10px; }
    #demo-card h1 { font-size: 76px; font-weight: 700; letter-spacing: -0.03em; margin: 0; }
    #demo-card h1 .g { color: #e9a62a; }
    #demo-card p { font-size: 28px; margin: 0; opacity: .9; }
    #demo-card .url { margin-top: 26px; font: 500 26px ui-monospace, Consolas, monospace; background: rgba(233,166,42,.18); border: 1px solid rgba(233,166,42,.45); padding: 12px 24px; border-radius: 12px; }
    body { padding-bottom: 120px; }
  \`;
  document.head.appendChild(style);
  const cursor = document.createElement('div');
  cursor.id = 'demo-cursor';
  cursor.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M3 2 L3 24 L8.6 18.6 L12.6 27.4 L16 25.9 L12.1 17.4 L19.8 17 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const pulse = document.createElement('div'); pulse.id = 'demo-pulse';
  const caption = document.createElement('div'); caption.id = 'demo-caption';
  const card = document.createElement('div'); card.id = 'demo-card';
  document.body.append(cursor, pulse, caption, card);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (sel) => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!el) throw new Error('demo: no element ' + sel); return el; };
  const inView = (r) => r.top >= 70 && r.bottom <= innerHeight - 110;
  async function moveTo(el) {
    let r = el.getBoundingClientRect();
    if (!inView(r)) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); await sleep(550); r = el.getBoundingClientRect(); }
    cursor.style.left = (r.left + r.width / 2 - 3) + 'px';
    cursor.style.top = (r.top + r.height / 2 - 2) + 'px';
    await sleep(520);
    return r;
  }
  async function click(sel) {
    const el = q(sel);
    const r = await moveTo(el);
    pulse.style.left = (r.left + r.width / 2) + 'px'; pulse.style.top = (r.top + r.height / 2) + 'px';
    pulse.animate([{ transform: 'scale(.3)', opacity: .9 }, { transform: 'scale(1.5)', opacity: 0 }], { duration: 480, easing: 'ease-out' });
    await sleep(130);
    el.click();
    await sleep(260);
  }
  async function type(sel, text) {
    const el = q(sel);
    await moveTo(el);
    el.focus();
    el.value = '';
    for (const ch of text) { el.value += ch; el.dispatchEvent(new Event('input', { bubbles: true })); await sleep(40 + Math.random() * 45); }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(250);
  }
  async function scrollTo(sel, block = 'start') { q(sel).scrollIntoView({ block, behavior: 'smooth' }); await sleep(650); }
  function setCaption(text) { if (!text) { caption.style.opacity = '0'; return; } caption.textContent = text; caption.style.opacity = '1'; }
  async function showCard(o) {
    if (!o) { card.style.opacity = '0'; await sleep(750); card.innerHTML = ''; return; }
    card.innerHTML = '<img class="mark" src="assets/logo.png" alt=""><h1><span class="g">SlokA</span>bhyasa</h1><p></p>' + (o.url ? '<div class="url"></div>' : '');
    card.querySelector('p').textContent = o.sub;
    if (o.url) card.querySelector('.url').textContent = o.url;
    card.style.opacity = '1';
    await sleep(750);
  }
  function hideCursor() { cursor.style.left = '-100px'; cursor.style.top = '-100px'; }
  window.__demo = { click, type, scrollTo, setCaption, showCard, moveTo: (sel) => moveTo(q(sel)), hideCursor, q };
})()`;

// ---------- the recording timeline ----------
function say(id) {
  const b = BEATS[id];
  const dur = durations[id];
  if (dur == null) throw new Error(`no narration for ${id}: run tts.mjs`);
  const at = now();
  timeline.audio.push({ src: path.join(NARR, `${id}.mp3`), at, gain: 1 });
  timeline.captions.push({ text: b.caption || b.say, start: at, end: at + dur });
  pg(`__demo.setCaption(${JSON.stringify(b.caption || b.say)})`).catch(() => {});
  log(`say ${id} (${dur.toFixed(1)}s)`);
  return at + dur;
}
function mix(file, { gain = 0.85, dur = null, fade = 0.5 } = {}) {
  const at = now();
  timeline.audio.push({ src: path.join(AUDIO, file), at, gain, dur, fade });
  return at;
}
async function waitUntil(t) { const ms = (t - now()) * 1000; if (ms > 0) await sleep(ms); }
// Removes the wait for `expr` from the video: frames in between are dropped at assembly.
async function cutUntil(expr, what, timeoutMs = 240000) {
  await pg('__demo.setCaption("")');
  await sleep(350);
  const from = now();
  await until(expr, what, timeoutMs);
  await sleep(300);
  const to = now();
  if (to - from > 1.2) { timeline.cuts.push({ from: from + 0.2, to: to - 0.1 }); log(`cut ${(to - from).toFixed(1)}s waiting for ${what}`); }
}
const clickNav = (view) => pg(`await __demo.click('.nav-btn[data-view="${view}"]'); window.scrollTo({ top: 0 }); await new Promise((r) => setTimeout(r, 250));`);

async function openApp(hash) {
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  await send('Page.navigate', { url: `${APP}#${hash}` });
  await until(`document.readyState === 'complete' && !!document.querySelector('#practice-picker')`, 'the app');
  await sleep(400);
  await evaluate(HELPERS);
}

async function prepareStorage() {
  await send('Page.navigate', { url: APP });
  await until(`document.readyState === 'complete'`, 'the page');
  await evaluate(`
    localStorage.setItem('tutor-stt', JSON.stringify({ language: 'sanskrit', tier: 'best', auto: true, cpuTiers: [] }));
    localStorage.setItem('tutor-learn-folder', 'CH-18');
    for (const k of ['tutor-eval-selection', 'tutor-quiz-setup', 'tutor-dev-filter', 'tutor-tolerance', 'tutor-theme', 'tutor-eval-text', 'tutor-quiz-text', 'tutor-hide-transcript', 'tutor-text-language', 'tutor-chandas-hint', 'tutor-sloka-lines', 'tutor-weights']) localStorage.removeItem(k);
    'ok'`);
}

// the open report is in: Evaluating… gone, the body shown
const reportReady = `(() => { const ev = document.querySelector('#evaluating'); const b = document.querySelector('#report-body'); const c = document.querySelector('#practice-results'); return !!ev && ev.hidden && !b.hidden && !c.hidden; })()`;
const panelIdle = (panel) => `(() => { const h = document.querySelector('${panel}'); return !!h && h.querySelector('.progress').hidden && !h.querySelector('[data-role="text"]').hidden; })()`;
// the shared folder picker (Teach, Self Evaluation, the Quiz page): open a folder, tick a sloka
const openFolder = (host, name) => pg(`const h = [...document.querySelectorAll('${host} .picker-folder-head')].find((x) => x.querySelector('.fname').textContent === '${name}'); if (!h) throw new Error('no folder ${name}'); if (!h.closest('.picker-folder').classList.contains('open')) await __demo.click(h);`);
const tick = (host, rec) => pg(`const row = [...document.querySelectorAll('${host} .picker-item')].find((x) => x.querySelector('.iname').textContent === '${rec.name}'); if (!row) throw new Error('no sloka ${rec.name} in ${host}'); await __demo.click(row.querySelector('input'));`);

// ---------- sessions ----------
async function prewarm() {
  // Transcripts for the slokas the demo shows, made with the Best model; stored in the library.
  await openApp('teach');
  await until(`document.querySelectorAll('#practice-picker .picker-item').length > 20`, 'the teach picker');
  // optional argv[3]: which to do, e.g. "c1!,c3" (! = transcribe again even if one exists)
  const want = (process.argv[3] || 'c1,c2,c3,c4,c5').split(',').map((s) => [S[s.replace('!', '')], s.endsWith('!')]);
  await openFolder('#practice-picker', 'CH-12');
  for (const [rec, force] of want) {
    await tick('#practice-picker', rec);
    await until(`!document.querySelector('#practice-rec').disabled`, `${rec.name} to load`, 120000);
    await sleep(500);
    if (force) { await evaluate(`document.querySelector('#practice-transcript [data-act="run"]').click()`); await sleep(500); }
    await until(panelIdle('#practice-transcript'), `${rec.name} transcription`, 300000);
    const text = await evaluate(`document.querySelector('#practice-transcript [data-role="text"]').textContent.slice(0, 90)`);
    log(`${rec.name}: ${text}`);
  }
}

async function session1() {
  await openApp('home');
  await until(visible('.home-logo'), 'the home page');
  await pg(`await __demo.showCard({ sub: 'Learn slokas by ear' })`);
  await startRecording();
  await sleep(900);

  // intro over the title card
  let end = say('intro');
  await waitUntil(end - 1.2);
  await pg('await __demo.showCard(null)');
  await waitUntil(end + 0.3);

  // home
  end = say('home');
  await pg(`await __demo.moveTo('.home-sloka')`);
  await waitUntil(end - 2);
  await pg(`await __demo.moveTo('.nav-btn[data-view="library"]')`);
  await waitUntil(end + 0.2);

  // library
  await clickNav('library');
  await until(`document.querySelectorAll('#library-list li[data-id]').length > 20`, 'the library list');
  end = say('library');
  await pg(`await __demo.moveTo('#library-list li[data-id="${S.c1.id}"] .lib-name')`);
  await waitUntil(end - 12);
  await pg(`await __demo.scrollTo('#library-list li[data-id="${S.c5.id}"]', 'center')`);
  await waitUntil(end - 6);
  await pg(`await __demo.scrollTo('#library-list li:last-child', 'end')`);
  await waitUntil(end - 2);
  await pg(`await __demo.scrollTo('#library-list li[data-id="${S.c3.id}"]', 'center')`);
  await waitUntil(end + 0.2);

  // everything saved about a sloka: a right-click
  end = say('metadata');
  await pg(`const li = __demo.q('#library-list li[data-id="${S.c3.id}"]'); const r = await __demo.moveTo(li.querySelector('.lib-name')); li.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 60, clientY: r.top + r.height / 2 }));`);
  await until(`!document.querySelector('#meta-popup').hidden`, 'the metadata popup', 5000);
  await waitUntil(end - 5);
  await pg(`const b = __demo.q('#meta-popup-body'); const h = [...b.querySelectorAll('h4')].find((x) => /chandas/i.test(x.textContent)); if (h) h.scrollIntoView({ block: 'start', behavior: 'smooth' });`);
  await waitUntil(end + 0.6);
  await pg(`__demo.q('#meta-popup-close').click()`);
  await sleep(300);

  // a stored transcript
  await pg(`await __demo.click('#library-list li[data-id="${S.c2.id}"] [data-act="transcript"]')`);
  await until(panelIdle(`#library-list li[data-id="${S.c2.id}"] .transcript-panel`), 'the library transcript panel', 20000).catch(() => {});
  end = say('transcript');
  await pg(`await __demo.scrollTo('#library-list li[data-id="${S.c2.id}"]', 'center')`);
  await waitUntil(end + 0.6);

  // learn from a file
  await clickNav('learn');
  await sleep(300);
  await pg(`await __demo.click('.tab[data-tab="learn-file"]')`);
  await sleep(300);
  await setFile('#learn-file-input', path.join(AUDIO, 'Gita 18-66 (teacher).wav'));
  await until(visible('#learn-file-loaded'), 'the imported file');
  end = say('learn');
  await pg(`await __demo.moveTo('#learn-file-change')`);
  await sleep(400);
  await pg('__demo.hideCursor()');
  await waitUntil(end + 0.2);
  await cutUntil(panelIdle('#learn-file-transcript'), 'the 18.66 transcript');
  await sleep(1500);
  end = say('learnSave');
  await pg(`await __demo.type('#learn-file-name-input', 'CH18-66 demo')`);
  await pg(`await __demo.click('#learn-file-save')`);
  await until(`!!document.querySelector('.toast')`, 'the save toast', 30000);
  await waitUntil(end + 0.8);

  // teach
  await clickNav('teach');
  await until(`document.querySelectorAll('#practice-picker .picker-item').length > 20`, 'the teach picker');
  await sleep(300);
  await openFolder('#practice-picker', 'CH-12');
  await tick('#practice-picker', S.c3);
  await until(`!document.querySelector('#practice-rec').disabled && ${visible('#practice-base')}`, 'the sloka to load', 120000);
  await until(panelIdle('#practice-transcript'), 'the sloka text', 120000).catch(() => {});
  end = say('teach');
  await pg(`await __demo.scrollTo('#practice-base', 'center')`);
  await waitUntil(end + 0.3);
  end = say('teachPlay');
  await pg(`await __demo.click('#practice-speed-chips .chip[data-speed="0.5"]')`);
  await pg(`await __demo.click('#practice-base-play')`);
  const teachPlayAt = mix('ch12-03-x050.wav', { gain: 0.8, dur: 9.5, fade: 0.6 });
  await pg('__demo.hideCursor()');
  await waitUntil(Math.max(end, teachPlayAt + 9.5));
  await pg(`await __demo.click('#practice-base-play')`);
  await pg(`await __demo.click('#practice-speed-chips .chip[data-speed="1"]')`);
  await sleep(300);
  end = say('teachListen');
  await pg(`await __demo.click('#practice-rec')`);
  const listenAt = mix('attempt-03.wav', { gain: 0.6 });
  await pg('__demo.hideCursor()');
  await waitUntil(Math.max(end + 0.2, listenAt + ATTEMPT_SECONDS + 0.9));
  await pg(`await __demo.click('#practice-rec')`);
  await until(visible('#evaluating'), 'Evaluating…', 10000);
  end = say('evaluating');
  await pg(`await __demo.scrollTo('#practice-results', 'start')`);
  await waitUntil(end + 0.4);
  await cutUntil(reportReady, 'the report', 240000);

  // the report: overall, both together, Analysis
  await pg(`await __demo.scrollTo('#practice-results', 'start')`);
  end = say('results');
  await pg(`await __demo.moveTo('#score-ring')`);
  await waitUntil(end - 7);
  await pg(`await __demo.moveTo('#score-verdict')`);
  await waitUntil(end + 0.3);
  end = say('duet');
  await pg(`await __demo.click('#res-play-both')`);
  const duetAt = mix('duet-03.wav', { gain: 0.7, dur: 9, fade: 0.7 });
  await pg('__demo.hideCursor()');
  await waitUntil(Math.max(end + 0.2, duetAt + 9));
  await pg(`await __demo.click('#res-play-both')`);
  await sleep(300);
  await pg(`await __demo.click('#analysis > summary')`);
  await sleep(400);
  await pg(`await __demo.scrollTo('#transcript', 'start')`);
  end = say('analysis');
  await waitUntil(end - 6);
  await pg(`await __demo.moveTo('#stt-heard')`);
  await waitUntil(end + 0.4);
  end = say('analysisMore');
  await pg(`await __demo.scrollTo('#scores', 'start')`);
  await pg('__demo.hideCursor()');
  await waitUntil(end - 8);
  await pg(`await __demo.scrollTo('#compare-chart', 'center')`);
  await waitUntil(end - 3.5);
  await pg(`await __demo.scrollTo('#dev-list', 'center')`);
  await waitUntil(end + 0.4);

  // several slokas at once
  await clickNav('evaluate');
  await until(`document.querySelectorAll('#practice-picker .picker-item').length > 20`, 'the evaluation picker');
  await sleep(300);
  await pg(`const c = document.querySelector('#practice-picker [data-act="clear"]'); if (c) c.click();`);
  await sleep(300);
  await openFolder('#practice-picker', 'CH-12');
  await pg(`await __demo.scrollTo('#practice-picker', 'start')`);
  end = say('evaluate');
  for (const rec of [S.c1, S.c2, S.c3, S.c4, S.c5]) await tick('#practice-picker', rec);
  await until(`!document.querySelector('#practice-rec').disabled && /of 5/.test(document.querySelector('#practice-texts-pos').textContent)`, 'the slokas to load', 120000);
  await pg(`await __demo.scrollTo('#practice-texts', 'center')`);
  await waitUntil(end - 7);
  await pg(`await __demo.click('#practice-texts-next')`);
  await waitUntil(end - 4);
  await pg(`await __demo.click('#practice-texts-next')`);
  await waitUntil(end + 0.3);
  end = say('evaluateRecord');
  await pg(`await __demo.click('#practice-rec')`);
  const recAt = mix('attempt-03.wav', { gain: 0.6 });
  await pg('__demo.hideCursor()');
  await waitUntil(Math.max(end + 0.2, recAt + ATTEMPT_SECONDS + 0.9));
  await pg(`await __demo.click('#practice-rec')`);
  await until(visible('#evaluating'), 'Evaluating…', 10000);
  await sleep(1500);
  await cutUntil(`${reportReady} && ${visible('#reports')}`, 'the reports', 240000);
  await pg(`await __demo.scrollTo('#practice-results', 'start')`);
  end = say('reports');
  await waitUntil(end - 10);
  await pg(`await __demo.click('#reports-fold > summary')`);
  await pg(`await __demo.moveTo('#report-map')`);
  await waitUntil(end - 5.5);
  await pg(`await __demo.click('#report-next')`);
  await waitUntil(end + 1.0);
}

async function session2() {
  await openApp('quiz');
  await until(`document.querySelectorAll('#quiz-picker .picker-item').length > 5`, 'the quiz page');
  await sleep(300);
  await startRecording();
  await sleep(700);

  let end = say('quiz');
  await openFolder('#quiz-picker', 'CH-12');
  await pg(`await __demo.click('input[name="quiz-mode"][value="single"]')`);
  await tick('#quiz-picker', S.c3);
  await pg(`await __demo.click('#quiz-start')`);
  await until(`document.querySelector('#dialog').open`, 'the name dialog');
  await pg(`await __demo.type('#dialog-input', 'Chapter 12 · sloka 3')`);
  await pg(`await __demo.click('#dialog-ok')`);
  await until(visible('#practice-quiz-box'), 'quiz mode');
  await waitUntil(end + 0.3);

  await pg('__demo.hideCursor()');
  await pg(`await __demo.scrollTo('#practice-quiz-box', 'start')`);
  end = say('quizMode');
  await until(`!document.querySelector('#practice-rec').disabled && ${visible('#practice-texts')}`, 'the quiz to be ready', 120000);
  await waitUntil(end - 4);
  await pg(`await __demo.scrollTo('#practice-texts', 'center')`);
  await waitUntil(end + 0.3);

  await pg(`await __demo.click('#practice-rec')`);
  const recAt = mix(QUIZ_TAKE, { gain: 0.6 });
  await pg('__demo.hideCursor()');
  await sleep(1500);
  end = say('quizRecord');
  await waitUntil(Math.max(end + 0.2, recAt + QUIZ_TAKE_SECONDS + 1.0));
  await pg(`await __demo.click('#practice-rec')`);
  await until(visible('#evaluating'), 'Evaluating…', 10000);
  await sleep(1800);
  await cutUntil(`${visible('#quiz-score')} && /saved/.test(document.querySelector('#quiz-score-status').textContent) && document.querySelector('#evaluating').hidden`, 'the quiz score', 300000);
  await pg(`await __demo.scrollTo('#quiz-score', 'start')`);
  end = say('quizScore');
  await waitUntil(end - 10);
  // the chips choose the categories that count: emphasis added for a moment
  await pg(`const b = [...document.querySelectorAll('#quiz-cats .chip')].find((c) => c.textContent.startsWith('Emphasis')); await __demo.click(b);`);
  await waitUntil(end - 6);
  await pg(`const b = [...document.querySelectorAll('#quiz-cats .chip')].find((c) => c.textContent.startsWith('Emphasis')); await __demo.click(b);`);
  await pg(`await __demo.scrollTo('#quiz-table', 'center')`);
  await pg('__demo.hideCursor()');
  await waitUntil(end + 0.4);

  end = say('quizTrend');
  await pg(`await __demo.click('#quiz-trend-fold > summary')`).catch(() => {});
  await waitUntil(end - 4.5);
  await pg(`await __demo.click('#practice-step1 .step-head')`);
  await pg(`await __demo.click('#quiz-leave')`);
  await until(visible('#quiz-list .quiz-item'), 'the quiz list');
  await pg(`await __demo.scrollTo('#quiz-saved', 'start')`);
  await pg('__demo.hideCursor()');
  await waitUntil(end + 0.5);

  // the Reports page (by date, then by folder), and Settings
  await clickNav('reports');
  await sleep(500);
  end = say('reportsPage');
  await pg('__demo.hideCursor()');
  await waitUntil(end - 3.2);
  await pg(`await __demo.click('#reports-mode .chip[data-mode="folder"]')`);
  await pg('__demo.hideCursor()');
  await waitUntil(end + 0.4);
  await clickNav('settings');
  await sleep(400);
  end = say('settings');
  await pg('__demo.hideCursor()');
  await waitUntil(end - 7);
  await pg(`await __demo.scrollTo('#tol-row', 'center')`);
  await waitUntil(end - 3.5);
  await pg(`await __demo.scrollTo('#settings-whisper', 'center')`);
  await waitUntil(end + 0.4);

  await pg(`await __demo.showCard({ sub: 'Learn slokas by ear', url: '${GITHUB}' })`);
  end = say('outro');
  await waitUntil(end + 1.6);
}

async function startRecording() {
  await send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  T0 = Date.now() / 1000;
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await prepareStorage();
  if (session === 'prewarm') await prewarm();
  else if (session === '1') await session1();
  else if (session === '2') await session2();
  else throw new Error(`unknown session ${session}`);
  if (T0 != null) {
    await sleep(600);
    timeline.end = now();
    await send('Page.stopScreencast');
    fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(timeline, null, 1));
    log(`session ${session}: ${timeline.frames.length} frames, ${timeline.end.toFixed(1)} s wall, ${timeline.cuts.reduce((a, c) => a + (c.to - c.from), 0).toFixed(1)} s cut`);
  }
  console.log('RESULT: ok');
} catch (err) {
  console.log('RESULT: FAILED', err.message);
  process.exitCode = 1;
  try { const shot = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, 'failure.png'), Buffer.from(shot.data, 'base64')); console.log('screenshot: out/' + session + '/failure.png'); } catch { /* page gone */ }
} finally {
  if (pageLogs.length) { console.log('--- page errors ---'); for (const l of pageLogs.slice(-12)) console.log(l); }
  ws.close();
  chrome.kill();
}
