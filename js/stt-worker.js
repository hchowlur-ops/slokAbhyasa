// Speech-to-text worker. Runs OpenAI Whisper in the browser through transformers.js,
// which is loaded from a CDN on first use; the model weights are downloaded once from
// Hugging Face and cached by the browser. Audio never leaves this machine.

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

export const MODELS = {
  tiny: { id: 'onnx-community/whisper-tiny', label: 'Tiny (test)' },
  fast: { id: 'onnx-community/whisper-base', label: 'Fast (whisper-base)' },
  better: { id: 'onnx-community/whisper-small', label: 'Better (whisper-small)' },
  best: { id: 'onnx-community/whisper-large-v3-turbo', label: 'Best (whisper-large-v3-turbo)', webgpuOnly: true },
};

let lib = null;
let device = null;
const pipes = new Map();

async function loadLib() {
  if (!lib) {
    lib = await import(TRANSFORMERS_URL);
    lib.env.allowLocalModels = false;
    lib.env.useBrowserCache = true;
  }
  return lib;
}

async function detectDevice() {
  if (device) return device;
  try {
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) { device = 'webgpu'; return device; }
    }
  } catch { /* fall through */ }
  device = 'wasm';
  return device;
}

// Pipelines are kept per model and device. A job that starts while its model is still
// loading (because the job that began the download was stopped) joins that load and gets
// its progress, rather than starting a second one.
const loading = new Map(); // "tier:device" → { promise, ids }
function getPipe(tier, dev, id, post) {
  const key = `${tier}:${dev}`;
  if (pipes.has(key)) return Promise.resolve(pipes.get(key));
  let l = loading.get(key);
  if (!l) {
    l = { ids: new Set() };
    l.promise = loadPipe(tier, dev, (o) => { for (const i of l.ids) post({ ...o, id: i }); })
      .then((pipe) => { pipes.set(key, pipe); return pipe; })
      .finally(() => loading.delete(key));
    loading.set(key, l);
  }
  l.ids.add(id);
  return l.promise;
}

async function loadPipe(tier, dev, post) {
  const { pipeline } = await loadLib();
  const m = MODELS[tier];
  if (!m) throw new Error(`Unknown model tier "${tier}"`);
  if (m.webgpuOnly && dev !== 'webgpu') throw new Error('The "Best" model needs WebGPU, which this browser does not offer. Choose "Fast" or "Better".');
  const files = new Map();
  const progress_callback = (p) => {
    if (p.status === 'progress' || p.status === 'download' || p.status === 'done') {
      if (p.file) {
        const prev = files.get(p.file) || { loaded: 0, total: 0 };
        const total = p.total || prev.total;
        files.set(p.file, { loaded: p.status === 'done' ? total : (p.loaded || prev.loaded), total });
      }
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) { loaded += f.loaded; total += f.total; }
      post({ type: 'progress', stage: 'download', progress: total ? loaded / total : 0, loaded, total, file: p.file });
    } else if (p.status === 'ready') {
      post({ type: 'progress', stage: 'ready' });
    }
  };
  // On WebGPU the weights are 4-bit where the model is big, with fp32 arithmetic throughout.
  // Never fp16: some GPUs that advertise shader-f16 (Intel Iris Xe, for one) compute garbage
  // with it, which Whisper turns into empty or nonsense text. q8 is broken on WebGPU too.
  const dtype = dev === 'webgpu'
    ? { encoder_model: tier === 'best' ? 'q4' : 'fp32', decoder_model_merged: 'q4' }
    : 'q8';
  return pipeline('automatic-speech-recognition', m.id, { device: dev, dtype, progress_callback });
}

// Text that cannot be a sloka: nothing, or one or two words over and over to the token
// limit. That is what a GPU miscomputing attention produces (seen on Intel Iris Xe with
// whisper-small under every dtype), and the cue to redo the job on the CPU.
export function looksDegenerate(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  if (!/\p{L}/u.test(words.join(''))) return true; // punctuation only, e.g. "." for a whole sloka
  if (words.length < 12) return false;
  const distinct = new Set(words.map((w) => w.toLowerCase())).size;
  return distinct / words.length < 0.2;
}

function finish(out, samples) {
  const dur = samples.length / 16000;
  const chunks = (out.chunks || []).map((c) => ({
    text: String(c.text || '').trim(),
    start: Math.max(0, Number(c.timestamp?.[0] ?? 0)),
    end: c.timestamp?.[1] == null ? null : Math.min(dur, Number(c.timestamp[1])),
  })).filter((c) => c.text);
  return { text: String(out.text || '').trim(), chunks };
}

function makeStreamer(pipe, onText) {
  try {
    const time_precision = pipe.processor.feature_extractor.config.chunk_length / pipe.model.config.max_source_positions;
    if (lib.WhisperTextStreamer) {
      return new lib.WhisperTextStreamer(pipe.tokenizer, { skip_prompt: true, skip_special_tokens: true, time_precision, callback_function: onText });
    }
    if (lib.TextStreamer) return new lib.TextStreamer(pipe.tokenizer, { skip_prompt: true, skip_special_tokens: true, callback_function: onText });
  } catch { /* streaming is optional */ }
  return null;
}

// The job being worked on. The client sends one at a time; a "stop" for it is answered at
// once, and the job then quietly abandons its work at the next checkpoint (Whisper's
// generate() ignores stopping criteria, so a run that has begun finishes on its own; while
// WASM inference runs this thread cannot read messages at all. The client covers both by
// replacing the worker when a stop goes unanswered.)
let current = null;

// (Guarded so Node's test runner can import looksDegenerate from this file.)
if (typeof self !== 'undefined') self.onmessage = async (e) => {
  const msg = e.data;
  const post = (o) => self.postMessage(o);
  if (msg.type === 'probe') {
    post({ type: 'probe', id: msg.id, device: await detectDevice() });
    return;
  }
  if (msg.type === 'stop') {
    if (current && current.id === msg.id && !current.stopped) {
      current.stopped = true;
      post({ type: 'stopped', id: msg.id });
    }
    return;
  }
  if (msg.type !== 'transcribe') return;
  // `device` forces the CPU ('wasm') for a tier the client has learnt not to trust on the GPU.
  const { id, samples, language, tier, device } = msg;
  const job = { id, stopped: false };
  current = job;
  const run = async (dev) => {
    post({ type: 'progress', id, stage: 'load' });
    const pipe = await getPipe(tier, dev, id, post);
    if (job.stopped) return null;
    let partial = '';
    const streamer = makeStreamer(pipe, (t) => {
      if (job.stopped) return;
      partial += t;
      post({ type: 'progress', id, stage: 'transcribe', partial });
    });
    post({ type: 'progress', id, stage: 'transcribe', partial: '' });
    const opts = { language, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, return_timestamps: true };
    if (streamer) opts.streamer = streamer;
    const out = await pipe(samples, opts);
    return job.stopped ? null : finish(out, samples);
  };
  try {
    let dev = device === 'wasm' ? 'wasm' : await detectDevice();
    let r = await run(dev);
    if (!r) return;
    let fellBack = false;
    // A GPU that computes nonsense gives nothing, or a word or two repeated for the whole
    // length. The first answer after a cold model load is sometimes wrong on its own (seen
    // on Intel Iris Xe: "." for a whole sloka, right the second time), so the GPU gets one
    // more go; only a GPU that is wrong twice sends the job to the CPU, which is slower but
    // right, and the client then remembers the choice for this tier.
    if (dev === 'webgpu' && looksDegenerate(r.text)) {
      post({ type: 'progress', id, stage: 'retry' });
      r = await run(dev);
      if (!r) return;
      if (looksDegenerate(r.text) && !MODELS[tier].webgpuOnly) {
        post({ type: 'progress', id, stage: 'fallback' });
        dev = 'wasm';
        r = await run(dev);
        if (!r) return;
        fellBack = true;
      }
    }
    // Slokas are never silent, so an empty answer means the model failed; report it
    // instead of storing an empty transcript.
    if (!r.text && !r.chunks.length) throw new Error(`No words were recognised with the ${MODELS[tier].label} model. Try another model, or "Fast", which runs without the GPU.`);
    post({ type: 'result', id, result: { ...r, language, tier, model: MODELS[tier].id, device: dev, fellBack } });
  } catch (err) {
    if (!job.stopped) post({ type: 'error', id, message: (err && err.message) || String(err) });
  } finally {
    if (current === job) current = null;
  }
};
