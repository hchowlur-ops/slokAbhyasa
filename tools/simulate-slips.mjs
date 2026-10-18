#!/usr/bin/env node
// Simulated slips, end to end: cuts flawed versions of a real recitation — a word said
// twice, a pāda started again (a short and a longer stop), a stuttered syllable, a pāda
// left out, a wrong pāda — plays each into the running app as the microphone, once in
// Self Evaluation and once in a one-sloka quiz, and checks what the app made of it
// against what it should have: the slip named, the 15 % deduction, the grade. Writes a
// report (Markdown and HTML) with every case's audio, scores, words heard, deviations,
// screenshots, session and quiz attempt, for a person to verify.
//
//   node tools/simulate-slips.mjs --take <take.wav> --sloka CH12-03 [options]
//
//   --take <wav>       a recitation of the sloka, one voice, pauses between the pādas
//   --sloka <name>     the library name of the sloka it recites (the baseline compared with)
//   --folder <name>    its folder (default: the sloka's folder in the library)
//   --other <wav>      a recording of another sloka in the same voice, for the wrong pāda
//                      (default: the take's own first pāda is put in place of its last)
//   --padas a,b,c      the three pāda boundaries in seconds (default: read from the pauses)
//   --word <sec>       where the first word of pāda 3 ends (default: the first pause in it)
//   --out <dir>        where to write (default: <data>/simulations/<date>)
//   --app <url>        the running app (default http://127.0.0.1:8787/)
//   --cases a,b        only these cases; --modes eval,quiz only these modes
//   --clean            delete the sessions and the quiz attempts afterwards (kept by default)
//
// Needs: the app running with the sloka in its library; Chrome; the speech model already
// downloaded by the app in Chrome's profile "slokabhyasa-sim-profile" (the first run
// downloads it). Exit code 1 when a case that must be caught was not.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = (() => { const o = {}; const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) { if (a[i].startsWith('--')) { const k = a[i].slice(2); const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; o[k] = v; } } return o; })();
if (!args.take || !args.sloka) { console.error('usage: node tools/simulate-slips.mjs --take <take.wav> --sloka <name> [--folder --other --padas --word --out --app --cases --modes --clean]'); process.exit(2); }
const APP = String(args.app || 'http://127.0.0.1:8787/').replace(/\/?$/, '/');
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE = path.join(os.tmpdir(), 'slokabhyasa-sim-profile');
const DEBUG = Number(process.env.SIM_DEBUG_PORT || 9431);
const today = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const api = async (p, init) => { const r = await fetch(APP + p, init); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); };

// ---------- WAV in and out ----------
function readWav(file) { const b = fs.readFileSync(file); let o = 12, sr = 0, ch = 1, bits = 16, data = null; while (o + 8 <= b.length) { const id = b.toString('ascii', o, o + 4); const sz = b.readUInt32LE(o + 4); if (id === 'fmt ') { ch = b.readUInt16LE(o + 10); sr = b.readUInt32LE(o + 12); bits = b.readUInt16LE(o + 22); } if (id === 'data') { data = [o + 8, Math.min(sz, b.length - o - 8)]; break; } o += 8 + sz + (sz & 1); } if (!data || bits !== 16) throw new Error(`${file}: a 16-bit PCM WAV is needed`); const n = Math.floor(data[1] / 2 / ch); const s = new Float32Array(n); for (let i = 0; i < n; i++) s[i] = b.readInt16LE(data[0] + i * 2 * ch) / 32768; return { sr, s }; }
function writeWav(file, s, sr) { const b = Buffer.alloc(44 + s.length * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + s.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(s.length * 2, 40); for (let i = 0; i < s.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s[i] * 32767))), 44 + i * 2); fs.writeFileSync(file, b); }
// 20 ms frames above −42 dBFS: where the sound is, and the pauses in it
function activity(s, sr) { const win = Math.round(sr * 0.02); const on = []; for (let i = 0; i + win <= s.length; i += win) { let e = 0; for (let j = i; j < i + win; j++) e += s[j] * s[j]; on.push(10 * Math.log10(e / win + 1e-12) > -42); } return on; }
function sounding(s, sr) { const on = activity(s, sr); let first = on.indexOf(true), last = on.lastIndexOf(true); return { from: first < 0 ? 0 : first * 0.02, to: last < 0 ? 0 : (last + 1) * 0.02 }; }
function gaps(s, sr, minSec) { const on = activity(s, sr); const out = []; let start = null; const first = on.indexOf(true), last = on.lastIndexOf(true); for (let k = first; k <= last + 1; k++) { const a = k <= last ? on[k] : true; if (!a && start === null) start = k; if (a && start !== null) { const len = (k - start) * 0.02; if (len >= minSec) out.push({ from: start * 0.02, to: k * 0.02, len }); start = null; } } return out; }

// ---------- the recordings ----------
const take = readWav(path.resolve(args.take));
const sr = take.sr;
const sound = sounding(take.s, sr);
let bounds = null; // [[p1 end, p2 start], [p2 end, p3 start], [p3 end, p4 start]]
if (args.padas) { bounds = String(args.padas).split(',').map(Number).map((t) => [t, t]); }
else {
  const g = gaps(take.s, sr, 0.25).sort((a, b) => b.len - a.len).slice(0, 3).sort((a, b) => a.from - b.from);
  if (g.length < 3) { console.error(`only ${g.length} pauses of 0.25 s or more between the pādas were found; give --padas a,b,c`); process.exit(2); }
  bounds = g.map((x) => [x.from, x.to]);
}
const P = [[sound.from, bounds[0][0]], [bounds[0][1], bounds[1][0]], [bounds[1][1], bounds[2][0]], [bounds[2][1], sound.to]];
const inner = gaps(take.s, sr, 0.15).filter((x) => x.from > P[2][0] + 0.4 && x.to < P[2][1] - 0.4);
const wordEnd = args.word ? Number(args.word) : inner.length ? inner[0].from : P[2][0] + 0.55 * (P[2][1] - P[2][0]);
const END = take.s.length / sr;
const piece = (src, from, to) => { const a = Math.round(from * src.sr), b = Math.round(to * src.sr); const out = src.s.slice(a, b); const f = Math.round(src.sr * 0.008); for (let i = 0; i < f && i < out.length; i++) { out[i] *= i / f; out[out.length - 1 - i] *= i / f; } return out; };
const silence = (sec) => new Float32Array(Math.round(sec * sr));
const join = (parts) => { const n = parts.reduce((a, p) => a + p.length, 0); const out = new Float32Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const resampleTo = (x, from, to) => { if (from === to) return x; const n = Math.round(x.length * to / from); const out = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i * from / to; const k = Math.floor(t); const f = t - k; out[i] = (x[k] || 0) * (1 - f) + (x[k + 1] || 0) * f; } return out; };
let otherPada;
let otherAbout;
if (args.other) { const o = readWav(path.resolve(args.other)); const e = sounding(o.s, o.sr).to; otherPada = resampleTo(piece(o, Math.max(0, e - (P[3][1] - P[3][0])), e), o.sr, sr); otherAbout = `the last pāda of ${path.basename(args.other)}`; }
else { otherPada = piece(take, P[0][0], P[0][1]); otherAbout = "the take's own first pāda"; }
const T = (a, b) => piece(take, a, b);
const CASES = {
  happy: { parts: [T(0, END)], about: 'the recitation as it was recorded (control)', expect: 'Excellent or Good, no slip, no deduction.', rule: 'must', check: (r) => !r.slips.length && r.grade !== 'practice' },
  'repeat-word': { parts: [T(0, wordEnd), silence(0.15), T(P[2][0], wordEnd), T(wordEnd, END)], about: `the first word of pāda 3 (${P[2][0].toFixed(1)}–${wordEnd.toFixed(1)} s) said twice`, expect: 'A self-correction (a word said twice): 15 % off, "Needs practice", the word named.', rule: 'limit', check: (r) => r.slips.some((s) => s.kind === 'repeat') },
  'restart-pada': { parts: [T(0, P[2][1]), silence(0.4), T(P[2][0], END)], about: 'pāda 3 recited whole, a 0.4 s stop, then pāda 3 again before pāda 4', expect: 'A restart at pāda 3: 15 % off, "Needs practice", "restarted pāda 3" with its first word.', rule: 'must', check: (r) => r.slips.some((s) => s.kind === 'restart') && r.grade === 'practice' },
  'restart-pada-pause': { parts: [T(0, P[2][1]), silence(0.9), T(P[2][0], END)], about: 'pāda 3 recited whole, a 0.9 s stop, then pāda 3 again before pāda 4', expect: 'As restart-pada; the stop is long enough for the ear to mark it by sound as well.', rule: 'must', check: (r) => r.slips.some((s) => s.kind === 'restart') && r.grade === 'practice' },
  stutter: { parts: [T(0, P[2][0]), T(P[2][0], P[2][0] + 0.3), silence(0.08), T(P[2][0], P[2][0] + 0.3), silence(0.08), T(P[2][0], END)], about: 'the first syllable of pāda 3 twice before the word', expect: 'Hard to call: a repeat if the words show it, else a small timing or syllable loss.', rule: 'limit', check: (r) => r.slips.some((s) => s.kind === 'repeat') },
  'missing-pada': { parts: [T(0, P[1][0]), silence(0.4), T(P[2][0], END)], about: 'pāda 2 left out', expect: 'Akṣaras dropped: the syllable score falls, the words show the missing pāda, "akṣaras dropped", "Needs practice" at the full score.', rule: 'must', check: (r) => r.slips.some((s) => s.kind === 'dropped') && r.grade === 'practice' },
  'wrong-pada': { parts: [T(0, P[3][0]), otherPada, silence(0.2)], about: `pāda 4 replaced by ${otherAbout}`, expect: 'Wrong words, not a slip: phonemes, vowel length and syllables fall for that pāda, no deduction, the grade by the score alone.', rule: 'must', check: (r) => !r.slips.some((s) => s.kind === 'restart' || s.kind === 'repeat' || s.kind === 'falseStart') && r.penalty === '' },
};
const names = (args.cases ? String(args.cases).split(',') : Object.keys(CASES)).filter((n) => CASES[n]);
const MODES = (args.modes ? String(args.modes).split(',') : ['eval', 'quiz']);
const lib = await api('api/baselines');
const base = lib.find((r) => r.name.toUpperCase() === String(args.sloka).toUpperCase());
if (!base) { console.error(`no sloka "${args.sloka}" in the library at ${APP}`); process.exit(2); }
const FOLDER = args.folder || base.folder || '';
const OUT = path.resolve(args.out || path.join(ROOT, '..', 'SlokAbhyasa-data', 'simulations', today));
fs.mkdirSync(path.join(OUT, 'audio'), { recursive: true });
log(`take ${path.basename(args.take)}: sound ${sound.from.toFixed(2)}–${sound.to.toFixed(2)} s · pādas ${P.map((p) => `${p[0].toFixed(2)}–${p[1].toFixed(2)}`).join(', ')} · word of pāda 3 to ${wordEnd.toFixed(2)} s`);
const cases = {};
for (const name of names) {
  const c = CASES[name];
  const s = join(c.parts);
  const file = path.join(OUT, 'audio', `${name}.wav`);
  writeWav(file, s, sr);
  cases[name] = { file, about: c.about, expect: c.expect, rule: c.rule, durationSec: Number((s.length / sr).toFixed(2)), soundEndSec: Number(sounding(s, sr).to.toFixed(2)) };
  log(`${name}: ${cases[name].durationSec} s, sound to ${cases[name].soundEndSec} s · ${c.about}`);
}
fs.writeFileSync(path.join(OUT, 'cases.json'), JSON.stringify({ take: path.resolve(args.take), sloka: base.name, folder: FOLDER, padas: P, wordEnd, cases }, null, 2));

// ---------- the quiz ----------
const QUIZ_NAME = `Simulations ${base.name}`;
let quiz = (await api('api/quizzes')).find((q) => q.name === QUIZ_NAME);
if (!quiz && MODES.includes('quiz')) quiz = await api('api/quizzes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: QUIZ_NAME, folders: [FOLDER], mode: 'single', maxFiles: 1, items: [{ id: base.id, name: base.name, folder: base.folder }], categories: ['phoneme', 'vowel', 'syllable', 'emphasis', 'phrasing', 'timing'] }) });

// ---------- the runs ----------
const results = {};
const made = { sessions: [], attempts: 0 };
for (const name of names) {
  const c = cases[name];
  const out = path.join(OUT, name);
  fs.mkdirSync(out, { recursive: true });
  log(`==== ${name}`);
  const chrome = spawn(CHROME, ['--headless=new', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${c.file}`, '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${PROFILE}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
  async function targets() { for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://127.0.0.1:${DEBUG}/json`); return await r.json(); } catch { await sleep(200); } } throw new Error('Chrome did not start'); }
  const page = (await targets()).find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const waiting = new Map(); const errors = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; } if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 300)); };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result))); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const pg = (code) => evaluate(`(async () => { ${code} })()`);
  const until = async (expr, what, timeoutMs = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < timeoutMs) { if (await evaluate(expr)) return true; await sleep(250); } throw new Error(`Timed out waiting for ${what}`); };
  const shot = async (file) => { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 72 }); fs.writeFileSync(path.join(out, file), Buffer.from(r.data, 'base64')); };
  const tick = (n) => pg(`[...document.querySelectorAll('#practice-picker .picker-item')].find(i => i.querySelector('.iname').textContent === ${JSON.stringify(n)}).querySelector('input').click();`);
  const analysis = () => evaluate(`JSON.stringify({
    name: document.querySelector('#report-name').textContent,
    verdict: document.querySelector('#score-verdict').textContent, weighted: document.querySelector('#score-overall-sub').textContent, penalty: document.querySelector('#score-penalty').textContent,
    slokaWords: document.querySelector('#stt-base').textContent.replace(/[◡—]/g, '').replace(/\\s+/g, ' ').trim(),
    heard: document.querySelector('#stt-heard').textContent.replace(/[◡—]/g, '').replace(/\\s+/g, ' ').trim(),
    summary: document.querySelector('#stt-summary').textContent, corrections: document.querySelector('#stt-corrections').textContent.replace(/\\s+/g, ' ').trim(),
    tiles: [...document.querySelectorAll('#scores .score[data-cat]')].map(el => ({ cat: el.dataset.cat, value: (el.querySelector('.score-val') || {}).textContent, sub: (el.querySelector('.score-sub') || {}).textContent, verdict: (el.querySelector('.score-verdict') || {}).textContent })),
    deviations: [...document.querySelectorAll('#dev-list .dev-item')].map(li => li.textContent.replace(/\\s+/g, ' ').trim().slice(0, 160)),
    notes: [...document.querySelectorAll('#result-notes li')].map(li => li.textContent.slice(0, 200)),
  })`);
  const shotAnalysis = async (prefix) => {
    await pg(`document.querySelector('#analysis').open = true;`);
    await sleep(500);
    await evaluate(`document.querySelector('#analysis').scrollIntoView({ block: 'start' })`);
    await sleep(300);
    await shot(`${prefix}-analysis-1.jpg`);
    await evaluate(`window.scrollBy(0, 880)`); await sleep(300); await shot(`${prefix}-analysis-2.jpg`);
    await evaluate(`window.scrollBy(0, 880)`); await sleep(300); await shot(`${prefix}-analysis-3.jpg`);
  };
  const result = { case: name, about: c.about, expected: c.expect, rule: c.rule, audio: path.relative(OUT, c.file).split(path.sep).join('/'), eval: null, quiz: null, errors: [], earTicks: null };
  const record = async () => {
    await pg(`document.querySelector('#practice-rec').click();`);
    const t0 = Date.now(); const ticks = [];
    while (Date.now() - t0 < (c.soundEndSec + 1.2) * 1000) { await sleep(1500); ticks.push(`${((Date.now() - t0) / 1000).toFixed(0)}s ${await evaluate(`document.querySelector('#practice-rec-count').textContent`)}`); }
    await pg(`document.querySelector('#practice-rec').click();`);
    result.earTicks = ticks;
  };
  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.navigate', { url: APP + '#settings' });
    await until(`document.querySelector('.nav-btn.active') && document.querySelector('#settings-stt-auto')`, 'app');
    await evaluate(`(() => { const s = JSON.parse(localStorage.getItem('tutor-stt') || '{}'); s.auto = true; localStorage.setItem('tutor-stt', JSON.stringify(s)); localStorage.removeItem('tutor-eval-selection'); localStorage.removeItem('tutor-text-language'); localStorage.removeItem('tutor-learner'); localStorage.removeItem('tutor-hide-transcript'); })()`);
    await send('Page.reload'); await sleep(1500);
    if (MODES.includes('eval')) {
      const before = (await api('api/sessions')).map((s) => s.id);
      await pg(`document.querySelector('.nav-btn[data-view="evaluate"]').click();`);
      await until(`document.querySelectorAll('#practice-picker .picker-folder').length > 0`, 'picker');
      await pg(`document.querySelector('#practice-picker [data-act="clear"]').click(); await new Promise(r => setTimeout(r, 300)); const h = [...document.querySelectorAll('#practice-picker .picker-folder-head')].find(h => h.querySelector('.fname').textContent === ${JSON.stringify(FOLDER || 'Top level')}); if (h && !h.closest('.picker-folder').classList.contains('open')) h.click();`);
      await sleep(300);
      await tick(base.name);
      await until(`!document.querySelector('#practice-rec').disabled`, 'loaded', 60000);
      await sleep(10000); // the model warms
      await record();
      await until(`!document.querySelector('#practice-results').hidden && !document.querySelector('#report-body').hidden`, 'the results', 120000);
      await until(`![...document.querySelectorAll('#take-cards .take-card')].some(c => c.classList.contains('busy')) && document.querySelector('#stt-heard').textContent.length > 0`, 'the words', 300000);
      await sleep(2500);
      const board = JSON.parse(await evaluate(`JSON.stringify({ ring: document.querySelector('#take-overall').textContent, grade: document.querySelector('#take-grade').textContent, sub: document.querySelector('#take-sub').textContent, words: document.querySelector('#take-words').textContent, moments: [...document.querySelectorAll('#score-moments li')].map(li => li.textContent), cards: [...document.querySelectorAll('#take-cards .take-card')].map(c => ({ name: c.querySelector('.tc-name').textContent, score: c.querySelector('.tc-score').textContent, grade: c.querySelector('.tc-grade').textContent, note: c.querySelector('.tc-note').textContent })) })`));
      await evaluate(`document.querySelector('#practice-results').scrollIntoView({ block: 'start' })`); await sleep(300); await shot('eval-board.jpg');
      await shotAnalysis('eval');
      const a = JSON.parse(await analysis());
      await sleep(1500);
      const sessions = (await api('api/sessions')).filter((s) => !before.includes(s.id));
      const session = sessions.length ? await api(`api/sessions/${sessions[0].id}`) : null;
      if (session) { fs.writeFileSync(path.join(out, 'eval-session.json'), JSON.stringify(session, null, 2)); made.sessions.push(session.id); }
      result.eval = { board, analysis: a, session };
      log('eval:', board.ring, board.grade, '·', a.penalty || 'no deduction', '· slips:', JSON.stringify(session ? session.items[0].slips : null));
    }
    if (MODES.includes('quiz') && quiz) {
      const attemptsBefore = ((await api(`api/quizzes/${quiz.id}`)).attempts || []).length;
      await pg(`location.hash = '#quiz'; document.querySelector('.nav-btn[data-view="quiz"]').click();`);
      await until(`[...document.querySelectorAll('.quiz-item')].some(li => li.textContent.includes(${JSON.stringify(QUIZ_NAME)}))`, 'quiz listed', 20000);
      await pg(`const li = [...document.querySelectorAll('.quiz-item')].find(li => li.textContent.includes(${JSON.stringify(QUIZ_NAME)})); li.querySelector('[data-act="retake"]').click();`);
      await until(`!document.querySelector('#practice-rec').disabled && document.querySelector('.view.active').id === 'view-evaluate'`, 'quiz ready', 30000);
      await sleep(4000);
      await record();
      await until(`!document.querySelector('#practice-results').hidden`, 'quiz results', 120000);
      await until(`document.querySelector('#quiz-score-status') && /saved/.test(document.querySelector('#quiz-score-status').textContent)`, 'quiz attempt saved', 400000);
      await sleep(2500);
      const card = JSON.parse(await evaluate(`JSON.stringify({ ring: document.querySelector('#quiz-overall').textContent, grade: document.querySelector('#quiz-grade').textContent, words: document.querySelector('#quiz-words').textContent, penalty: document.querySelector('#quiz-penalty').textContent, sub: document.querySelector('#quiz-overall-sub').textContent, verdict: document.querySelector('#quiz-verdict').textContent, status: document.querySelector('#quiz-score-status').textContent, rows: [...document.querySelectorAll('#quiz-table tr')].map(tr => [...tr.children].map(td => td.textContent.trim()).join(' | ')) })`));
      await evaluate(`document.querySelector('#practice-results').scrollIntoView({ block: 'start' })`); await sleep(300); await shot('quiz-card.jpg');
      await shotAnalysis('quiz');
      const a = JSON.parse(await analysis());
      const q = await api(`api/quizzes/${quiz.id}`);
      const attempt = (q.attempts || []).slice(attemptsBefore).pop() || null;
      if (attempt) { fs.writeFileSync(path.join(out, 'quiz-attempt.json'), JSON.stringify(attempt, null, 2)); made.attempts++; }
      result.quiz = { card, analysis: a, attempt };
      log('quiz:', card.ring, card.grade, '·', card.penalty || 'no deduction', '· slips:', JSON.stringify(attempt ? attempt.items[0].slips : null));
    }
  } catch (err) {
    result.errors.push(err.message);
    log('FAILED:', err.message);
    try { await shot('failed.jpg'); } catch { /* ignore */ }
  } finally {
    result.errors.push(...errors);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
    results[name] = result;
    try { spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
    await sleep(1500);
    chrome.kill();
  }
}

// ---------- the verdicts and the report ----------
const gradeOf = (text) => (/practice/i.test(text) ? 'practice' : /excellent/i.test(text) ? 'excellent' : /good/i.test(text) ? 'good' : /fair/i.test(text) ? 'fair' : null);
const outcome = (r, mode) => { const m = r[mode]; if (!m) return null; const items = mode === 'eval' ? (m.session && m.session.items) : (m.attempt && m.attempt.items); return { ring: mode === 'eval' ? m.board.ring : m.card.ring, gradeText: mode === 'eval' ? m.board.grade : m.card.grade, grade: gradeOf(mode === 'eval' ? m.board.grade : m.card.grade), penalty: (mode === 'eval' ? m.analysis.penalty : m.card.penalty) || '', slips: (items && items[0] && items[0].slips) || [], analysis: m.analysis }; };
const slipsText = (slips) => (slips.length ? slips.map((s) => `${s.kind}${s.word ? ` "${s.word}"` : ''}${s.pada ? ` pāda ${s.pada}` : ''}${s.by ? ` · by ${s.by}` : ''}`).join('; ') : 'none');
let failed = 0;
const verdicts = {};
for (const name of names) {
  const r = results[name];
  const c = CASES[name];
  const v = {};
  for (const mode of MODES) { const o = outcome(r, mode); if (!o) { v[mode] = 'not run'; continue; } const ok = c.check(o); v[mode] = ok ? 'as expected' : c.rule === 'limit' ? 'known limit' : 'NOT as expected'; if (!ok && c.rule === 'must') failed++; }
  verdicts[name] = v;
}
const tile = (a, cat) => { const t = (a.tiles || []).find((x) => x.cat === cat); return t ? `${t.value}${t.verdict ? ` (${t.verdict})` : ''}` : '–'; };
let md = `# Simulated slips in ${base.name} — Self Evaluation and a quiz, ${today}

Recordings cut from \`${path.basename(args.take)}\` (${sound.to.toFixed(1)} s of sound): the recitation as recorded, and the
same with a flaw cut into it. Each was played into the app as the microphone, once in
**Self Evaluation** (${base.name} ticked) and once in the **quiz "${QUIZ_NAME}"** (one sloka,
scored on phonemes, vowel length, syllables, emphasis, phrasing, timing), with the words
heard by the app's speech model. The sessions and the quiz attempts were ${args.clean ? 'deleted afterwards' : 'kept in the app: open Reports for the sessions and the quiz\'s Details for the attempts'}.
Each case's folder holds the screenshots, the session, the attempt and \`result.json\`; the
audio is in \`audio/\`. Pādas read from the pauses: ${P.map((p, i) => `pāda ${i + 1} ${p[0].toFixed(1)}–${p[1].toFixed(1)} s`).join(', ')};
the first word of pāda 3 ends at ${wordEnd.toFixed(1)} s. "Known limit" marks a case the app is not expected to catch yet.

| Case | What was done | Self Evaluation | Quiz |
| --- | --- | --- | --- |
`;
for (const name of names) {
  const r = results[name];
  const cell = (mode) => { const o = outcome(r, mode); if (!o) return r.errors[0] || 'not run'; return `**${o.ring} · ${o.gradeText}**${o.penalty ? ` · ${o.penalty}` : ''} · slips: ${slipsText(o.slips)} — **${verdicts[name][mode]}**`; };
  md += `| [${name}](#${name}) | ${r.about} | ${cell('eval')} | ${cell('quiz')} |\n`;
}
md += `\n${failed ? `**${failed} outcome${failed === 1 ? '' : 's'} not as expected.**` : '**Every case that must be caught was caught.**'}\n`;
for (const name of names) {
  const r = results[name];
  md += `\n## ${name}\n\n**What was done:** ${r.about}.\n\n**Expected:** ${r.expected}\n\n**Audio:** \`${r.audio}\`\n`;
  for (const mode of MODES) {
    const o = outcome(r, mode); if (!o) continue; const a = o.analysis;
    md += `\n### ${mode === 'eval' ? 'Self Evaluation' : 'Quiz'} — ${verdicts[name][mode]}\n\n| | |\n| --- | --- |\n| Overall · grade | ${o.ring} · ${o.gradeText} |\n| Self-correction | ${o.penalty || 'none'}${a.corrections ? ` — ${a.corrections}` : ''} |\n| Slips saved | ${slipsText(o.slips)} |\n| Verdict | ${a.verdict || '–'} · ${a.weighted} |\n| phon / vowel / syl | ${tile(a, 'phoneme')} / ${tile(a, 'vowel')} / ${tile(a, 'syllable')} |\n| emph / pitch / phr / tim | ${tile(a, 'emphasis')} / ${tile(a, 'pitch')} / ${tile(a, 'phrasing')} / ${tile(a, 'timing')} |\n| Words heard | ${a.summary} |\n| Heard | ${a.heard} |\n`;
    if (a.deviations.length) md += `\nDeviations (${a.deviations.length}):\n\n${a.deviations.map((d) => `* ${d}`).join('\n')}\n`;
    if (a.notes.length) md += `\nNotes: ${a.notes.map((n) => `_${n}_`).join(' ')}\n`;
    md += `\nScreenshots: \`${name}/${mode}-board.jpg\`, \`${name}/${mode}-analysis-1.jpg\` … \`-3.jpg\`.\n`.replace('quiz-board', 'quiz-card');
  }
  if (r.earTicks) md += `\nThe ear while recording (Self Evaluation): ${r.earTicks.filter((_, i) => i % 2 === 0).join(' · ')}\n`;
  if (r.errors.length) md += `\nErrors: ${r.errors.join(' · ')}\n`;
}
fs.writeFileSync(path.join(OUT, 'report.md'), md);
try { await new Promise((resolve) => { const p = spawn(process.execPath, [path.join(ROOT, 'tools', 'notes-html.mjs'), OUT], { stdio: 'ignore' }); p.on('exit', resolve); p.on('error', resolve); }); } catch { /* the Markdown stands */ }
if (args.clean) {
  for (const id of made.sessions) await fetch(`${APP}api/sessions/${id}`, { method: 'DELETE' }).catch(() => {});
  if (quiz && made.attempts) await fetch(`${APP}api/quizzes/${quiz.id}`, { method: 'DELETE' }).catch(() => {});
}
log(`report: ${path.join(OUT, 'report.html')} · ${failed ? `${failed} NOT as expected` : 'every case that must be caught was caught'}`);
process.exit(failed ? 1 : 0);
