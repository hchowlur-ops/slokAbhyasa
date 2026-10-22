#!/usr/bin/env node
// The benchmark harness (P0.4 of the acoustic-assessment roadmap): drives tools/bench/bench.html
// in headless Chrome against the live server and writes the results — seconds per model
// on a clip of a saved take, the page's memory before and after, the longest frame gap —
// to dist/bench/<stamp>.json and, with --note <file.md>, as a Markdown table.
//
//   node tools/bench/run.mjs --session 20261018-073650-mt3b [--seconds 20] [--app http://127.0.0.1:8787/]
//        [--whisper fast,better,best] [--device auto|wasm] [--ssl Xenova/wavlm-base-plus,...] [--ssl-device webgpu|wasm]
//        [--ssl-dtype fp32|q8] [--note research_notes/.../benchmark.md] [--profile <chrome user-data-dir>]
//
// The Chrome profile keeps the models cached between runs (the app's own origin: the smoke
// profile used by the probes already holds the Whisper tiers). WebGPU needs the flags below.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] != null ? args[i + 1] : def; };
const SESSION = opt('--session', null);
if (!SESSION) { console.error('--session <id> is needed (a saved take with its audio)'); process.exit(2); }
const SECONDS = Number(opt('--seconds', 20));
const APP = opt('--app', 'http://127.0.0.1:8787/').replace(/\/?$/, '/');
const WHISPER = opt('--whisper', 'fast,better,best').split(',').map((s) => s.trim()).filter(Boolean);
const DEVICE = opt('--device', 'auto');
const SSL = opt('--ssl', '').split(',').map((s) => s.trim()).filter(Boolean);
const SSL_DEVICE = opt('--ssl-device', 'webgpu');
const SSL_DTYPE = opt('--ssl-dtype', 'fp32');
const NOTE = opt('--note', null);
const PROFILE = opt('--profile', path.join(os.tmpdir(), 'slokabhyasa-smoke-profile'));
const CHROME = opt('--chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
const DEBUG = 9431;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const chrome = spawn(CHROME, ['--headless=new', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${PROFILE}`, '--window-size=1200,800', 'about:blank'], { stdio: 'ignore' });
async function targets() { for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://127.0.0.1:${DEBUG}/json`); return await r.json(); } catch { await sleep(200); } } throw new Error('Chrome did not start'); }
const page = (await targets()).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let seq = 0; const waiting = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; } if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)); if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 300)); };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result))); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr, timeoutMs = 1800000) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: timeoutMs }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let results = [];
try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: `${APP}tools/bench/bench.html` });
  for (let i = 0; i < 100 && !(await evaluate(`!!(window.__bench && window.__bench.loadClip)`).catch(() => false)); i++) await sleep(200);
  const gpu = await evaluate(`(async () => { try { const a = await navigator.gpu.requestAdapter(); if (!a) return null; const info = a.info || (a.requestAdapterInfo ? await a.requestAdapterInfo() : {}); return { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, f16: a.features.has('shader-f16') }; } catch (e) { return { error: String(e) }; } })()`);
  log('gpu:', JSON.stringify(gpu));
  await evaluate(`__bench.loadClip(${JSON.stringify(SESSION)}, ${SECONDS})`);
  for (const tier of WHISPER) {
    log(`whisper ${tier} (${DEVICE})…`);
    await evaluate(`__bench.whisper(${JSON.stringify(tier)}, ${DEVICE === 'auto' ? 'null' : JSON.stringify(DEVICE)})`).catch((e) => log('  failed:', e.message));
  }
  for (const id of SSL) {
    log(`${id} (${SSL_DEVICE}, ${SSL_DTYPE})…`);
    await evaluate(`__bench.ssl(${JSON.stringify(id)}, ${JSON.stringify(SSL_DEVICE)}, ${JSON.stringify(SSL_DTYPE)})`).catch((e) => log('  failed:', e.message));
  }
  results = await evaluate(`JSON.stringify(__bench.results)`).then(JSON.parse);
  const pageErrors = await evaluate(`JSON.stringify(__bench.errors)`).then(JSON.parse);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(ROOT, 'dist', 'bench');
  fs.mkdirSync(outDir, { recursive: true });
  const machine = { cpu: os.cpus()[0] && os.cpus()[0].model, threads: os.cpus().length, memoryGB: Math.round(os.totalmem() / 1e9), platform: `${os.platform()} ${os.release()}`, gpu };
  const doc = { at: new Date().toISOString(), session: SESSION, seconds: SECONDS, machine, results, errors: [...errors, ...pageErrors] };
  fs.writeFileSync(path.join(outDir, `${stamp}.json`), JSON.stringify(doc, null, 2));
  const lines = [];
  lines.push(`| run | seconds | memory before → after (MB) | longest frame gap (gaps over 100 ms) | detail |`);
  lines.push(`|---|---|---|---|---|`);
  for (const r of results) lines.push(`| ${r.name} | ${r.error ? 'error: ' + r.error.slice(0, 60) : r.seconds} | ${r.memoryBeforeMB ?? '–'} → ${r.memoryAfterMB ?? '–'} | ${r.frames.max} ms (${r.frames.over100}) | ${r.detail ? JSON.stringify(r.detail).slice(0, 80) : ''} |`);
  const table = lines.join('\n');
  console.log(`\n${machine.cpu} · ${machine.threads} threads · ${machine.memoryGB} GB · GPU ${gpu && gpu.description ? gpu.description : JSON.stringify(gpu)}\nclip ${SECONDS} s of ${SESSION}\n\n${table}\n`);
  if (NOTE) {
    const notePath = path.resolve(ROOT, NOTE);
    const head = fs.existsSync(notePath) ? fs.readFileSync(notePath, 'utf8') : `# Benchmarks on this machine\n\nEvery run of \`tools/bench/run.mjs\`, newest last. The JSON of each is in \`dist/bench/\`.\n`;
    fs.writeFileSync(notePath, `${head.replace(/\s*$/, '\n')}\n## ${doc.at.slice(0, 16).replace('T', ' ')} — clip ${SECONDS} s of ${SESSION}\n\n${machine.cpu} · ${machine.threads} threads · ${machine.memoryGB} GB · GPU ${gpu && gpu.description ? gpu.description : 'unknown'}${gpu && gpu.f16 ? ' · shader-f16' : ''}\n\n${table}\n`);
    log('note appended:', NOTE);
  }
  if (doc.errors.length) log('page errors:', doc.errors.slice(0, 5));
} catch (err) { console.error('FAILED:', err.message); } finally {
  try { spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
  await sleep(800);
  chrome.kill();
  process.exit(0);
}
