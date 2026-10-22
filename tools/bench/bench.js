// The benchmark page's work: load a clip from a saved take, then time each model on it —
// the app's own speech worker for the Whisper tiers (js/stt.js, the same path the app
// takes), and transformers.js directly for the self-supervised encoders (a forward pass
// over the clip, the cost of the features the acoustic roadmap's POC-A would use). For
// each run: seconds, the page's memory (performance.measureUserAgentSpecificMemory, which
// the server's cross-origin isolation allows), and the longest frame gap meanwhile. The
// results go to window.__bench for the headless runner and to the page.
import { Transcriber } from '/js/stt.js';

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
const out = document.querySelector('#out');
const log = (s) => { out.textContent += `\n${s}`; };
window.__bench = { results: [], errors: [] };

// ---------- the clip ----------
let clip = null; // { samples: Float32Array, sampleRate, seconds }
async function loadClip(sessionId, seconds) {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/audio`);
  if (!res.ok) throw new Error(`no audio for ${sessionId}: ${res.status}`);
  const buf = await res.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  const dec = await ctx.decodeAudioData(buf);
  const n = Math.min(dec.length, Math.round(seconds * dec.sampleRate));
  const samples = dec.getChannelData(0).slice(0, n);
  await ctx.close();
  clip = { samples, sampleRate: dec.sampleRate, seconds: n / dec.sampleRate };
  log(`clip: ${clip.seconds.toFixed(1)} s at ${clip.sampleRate} Hz from ${sessionId}`);
  return clip;
}

// ---------- what is measured around a run ----------
async function memory() {
  try { if (performance.measureUserAgentSpecificMemory) { const m = await performance.measureUserAgentSpecificMemory(); return Math.round(m.bytes / 1048576); } } catch { /* not allowed */ }
  return performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
}
function frameWatch() {
  const w = { max: 0, over100: 0, n: 0, stop: false };
  let last = performance.now();
  const tick = (t) => { const d = t - last; last = t; w.n++; if (d > w.max) w.max = Math.round(d); if (d > 100) w.over100++; if (!w.stop) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return w;
}
async function measured(name, fn) {
  const before = await memory();
  const frames = frameWatch();
  const t0 = performance.now();
  let error = null; let detail = null;
  try { detail = await fn(); } catch (e) { error = String(e && e.message || e); }
  const seconds = Math.round((performance.now() - t0) / 100) / 10;
  frames.stop = true;
  const after = await memory();
  const r = { name, seconds, memoryBeforeMB: before, memoryAfterMB: after, frames: { max: frames.max, over100: frames.over100, n: frames.n }, clipSeconds: clip ? Math.round(clip.seconds * 10) / 10 : null, error, detail };
  window.__bench.results.push(r);
  log(`${name}: ${error ? 'ERROR ' + error : seconds + ' s'} · memory ${before} → ${after} MB · frames max ${frames.max} ms (${frames.over100} over 100 ms)${detail ? ' · ' + JSON.stringify(detail).slice(0, 160) : ''}`);
  return r;
}

// ---------- Whisper, through the app's worker ----------
const stt = new Transcriber();
async function whisper(tier, device = null) {
  const language = 'sanskrit';
  // the model loads first (not timed as a hearing), then the clip is heard twice: cold, warm
  await measured(`whisper ${tier} ${device || 'auto'} · load`, async () => { await stt.warm({ tier, device, language }); return null; });
  for (const pass of ['first', 'second']) {
    await measured(`whisper ${tier} ${device || 'auto'} · ${pass} hearing`, async () => {
      const t = await stt.transcribe({ samples: clip.samples, sampleRate: clip.sampleRate, language, tier, device });
      return { words: (t.text || '').split(/\s+/).filter(Boolean).length, device: t.device, fellBack: !!t.fellBack };
    });
  }
}

// ---------- the self-supervised encoders, through transformers.js ----------
let lib = null;
async function ssl(modelId, device = 'webgpu', dtype = 'fp32') {
  if (!lib) { lib = await import(TRANSFORMERS_URL); lib.env.allowLocalModels = false; }
  let processor = null; let model = null;
  await measured(`${modelId} ${device} ${dtype} · load`, async () => {
    processor = await lib.AutoProcessor.from_pretrained(modelId);
    model = await lib.AutoModel.from_pretrained(modelId, { device, dtype });
    return null;
  });
  // the clip at 16 kHz, as the encoders expect
  const x = clip.sampleRate === 16000 ? clip.samples : resampleTo16k(clip.samples, clip.sampleRate);
  for (const pass of ['first', 'second']) {
    await measured(`${modelId} ${device} ${dtype} · ${pass} forward`, async () => {
      const inputs = await processor(x, { sampling_rate: 16000 });
      const o = await model(inputs);
      const h = o.last_hidden_state;
      return { frames: h.dims[1], width: h.dims[2] };
    });
  }
  try { await model.dispose(); } catch { /* fine */ }
}
function resampleTo16k(samples, sr) {
  const ratio = sr / 16000;
  const n = Math.floor(samples.length / ratio);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = i * ratio; const k = Math.floor(p); const f = p - k; y[i] = samples[k] * (1 - f) + (samples[Math.min(samples.length - 1, k + 1)] || 0) * f; }
  return y;
}

// ---------- entry points for the runner and the buttons ----------
window.__bench.loadClip = loadClip;
window.__bench.whisper = whisper;
window.__bench.ssl = ssl;
window.__bench.memory = memory;
document.querySelector('#run-whisper').addEventListener('click', async () => {
  try { await loadClip(document.querySelector('#session').value.trim(), Number(document.querySelector('#seconds').value) || 20); for (const tier of ['fast', 'better', 'best']) await whisper(tier); } catch (e) { log('ERROR ' + e.message); }
});
document.querySelector('#run-ssl').addEventListener('click', async () => {
  try { await loadClip(document.querySelector('#session').value.trim(), Number(document.querySelector('#seconds').value) || 20); for (const id of ['Xenova/wavlm-base-plus', 'Xenova/wav2vec2-base-960h', 'Xenova/hubert-base-ls960']) await ssl(id, 'webgpu', 'fp32'); } catch (e) { log('ERROR ' + e.message); }
});
window.addEventListener('error', (e) => window.__bench.errors.push(String(e.message)));
