#!/usr/bin/env node
// The same measurements as bench.html, in Node on the CPU through onnxruntime-node (route A
// of the native-transcription note: the browser's models and pipeline code, prebuilt
// native runtime, no compiler). Run from tools/bench after `npm install` there:
//
//   node node.mjs --wav <take.wav> [--seconds 20] [--whisper base,small,large-v3-turbo] [--ssl Xenova/wavlm-base-plus,...]
//                 [--dtype fp32|q8|q4] [--threads 12] [--out ../../dist/bench/node-<stamp>.json]
//
// The models download to transformers.js's cache on first use (~150 MB for whisper-base,
// ~500 MB for small, ~1.6 GB for large-v3-turbo at fp32; q8 roughly a quarter of that).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] != null ? args[i + 1] : def; };
const WAV = opt('--wav', null);
if (!WAV) { console.error('--wav <file> is needed'); process.exit(2); }
const SECONDS = Number(opt('--seconds', 20));
const WHISPER = opt('--whisper', 'base,small').split(',').map((s) => s.trim()).filter(Boolean);
const SSL = opt('--ssl', '').split(',').map((s) => s.trim()).filter(Boolean);
const DTYPE = opt('--dtype', 'fp32');
const THREADS = Number(opt('--threads', os.cpus().length));
const OUT = opt('--out', path.join(HERE, '..', '..', 'dist', 'bench', `node-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`));

const { pipeline, AutoProcessor, AutoModel, env } = await import('@huggingface/transformers');
env.backends.onnx.wasm = env.backends.onnx.wasm || {};
if (env.backends.onnx && env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = THREADS;

// ---------- the clip: 16 kHz mono from a PCM WAV ----------
function readWav(file) {
  const b = fs.readFileSync(file);
  const ch = b.readUInt16LE(22); const sr = b.readUInt32LE(24); const bits = b.readUInt16LE(34); const fmt = b.readUInt16LE(20);
  let o = 12; let data = null;
  while (o < b.length - 8) { const id = b.toString('ascii', o, o + 4); const n = b.readUInt32LE(o + 4); if (id === 'data') { data = b.subarray(o + 8, o + 8 + n); break; } o += 8 + n + (n & 1); }
  let x;
  if (fmt === 3 && bits === 32) x = new Float32Array(data.buffer, data.byteOffset, data.length / 4);
  else { const n = data.length / 2; x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = data.readInt16LE(i * 2) / 32768; }
  if (ch > 1) { const m = new Float32Array(Math.floor(x.length / ch)); for (let i = 0; i < m.length; i++) { let s = 0; for (let c = 0; c < ch; c++) s += x[i * ch + c]; m[i] = s / ch; } x = m; }
  return { samples: x, sampleRate: sr };
}
function resampleTo16k(samples, sr) {
  if (sr === 16000) return samples;
  const ratio = sr / 16000; const n = Math.floor(samples.length / ratio); const y = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = i * ratio; const k = Math.floor(p); const f = p - k; y[i] = samples[k] * (1 - f) + (samples[Math.min(samples.length - 1, k + 1)] || 0) * f; }
  return y;
}
const wav = readWav(WAV);
const clip = resampleTo16k(wav.samples, wav.sampleRate).slice(0, Math.round(SECONDS * 16000));
console.log(`clip ${(clip.length / 16000).toFixed(1)} s from ${WAV} · ${THREADS} threads · dtype ${DTYPE}`);

const results = [];
const rss = () => Math.round(process.memoryUsage().rss / 1048576);
async function measured(name, fn) {
  const before = rss(); const t0 = performance.now(); let error = null; let detail = null;
  try { detail = await fn(); } catch (e) { error = String(e && e.message || e); }
  const seconds = Math.round((performance.now() - t0) / 100) / 10;
  const r = { name, seconds, rssBeforeMB: before, rssAfterMB: rss(), error, detail };
  results.push(r);
  console.log(`${name}: ${error ? 'ERROR ' + error : seconds + ' s'} · rss ${before} → ${r.rssAfterMB} MB${detail ? ' · ' + JSON.stringify(detail).slice(0, 120) : ''}`);
}
for (const size of WHISPER) {
  const id = `onnx-community/whisper-${size}`;
  let asr = null;
  await measured(`whisper ${size} ${DTYPE} · load`, async () => { asr = await pipeline('automatic-speech-recognition', id, { dtype: DTYPE, device: 'cpu' }); return null; });
  if (!asr) continue;
  for (const pass of ['first', 'second']) {
    await measured(`whisper ${size} ${DTYPE} · ${pass} hearing`, async () => {
      const o = await asr(clip, { language: 'sanskrit', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, return_timestamps: true });
      return { words: String(o.text || '').split(/\s+/).filter(Boolean).length };
    });
  }
  try { await asr.dispose(); } catch { /* fine */ }
}
for (const id of SSL) {
  let processor = null; let model = null;
  await measured(`${id} ${DTYPE} · load`, async () => { processor = await AutoProcessor.from_pretrained(id); model = await AutoModel.from_pretrained(id, { dtype: DTYPE, device: 'cpu' }); return null; });
  if (!model) continue;
  for (const pass of ['first', 'second']) {
    await measured(`${id} ${DTYPE} · ${pass} forward`, async () => { const inputs = await processor(clip, { sampling_rate: 16000 }); const o = await model(inputs); const h = o.last_hidden_state; return { frames: h.dims[1], width: h.dims[2] }; });
  }
  try { await model.dispose(); } catch { /* fine */ }
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), wav: WAV, seconds: SECONDS, threads: THREADS, dtype: DTYPE, machine: { cpu: os.cpus()[0] && os.cpus()[0].model, threads: os.cpus().length, memoryGB: Math.round(os.totalmem() / 1e9) }, results }, null, 2));
console.log(`\n| run | seconds | rss before → after (MB) | detail |\n|---|---|---|---|\n${results.map((r) => `| ${r.name} | ${r.error ? 'error: ' + r.error.slice(0, 60) : r.seconds} | ${r.rssBeforeMB} → ${r.rssAfterMB} | ${r.detail ? JSON.stringify(r.detail).slice(0, 60) : ''} |`).join('\n')}\n\nwritten ${OUT}`);
