// Client wrapper around the speech-to-text worker.

import { resample } from './dsp/resample.js';

export const STT_LANGUAGES = [
  { code: 'english', lang: 'en', label: 'English' },
  { code: 'sanskrit', lang: 'sa', label: 'Sanskrit · संस्कृतम्' },
  { code: 'kannada', lang: 'kn', label: 'Kannada · ಕನ್ನಡ' },
  { code: 'telugu', lang: 'te', label: 'Telugu · తెలుగు' },
];
export const STT_LANGUAGE_CODES = STT_LANGUAGES.map((l) => l.code);

export const STT_TIERS = [
  { id: 'fast', label: 'Fast', hint: 'whisper-base, about 75 MB download' },
  { id: 'better', label: 'Better', hint: 'whisper-small, about 250 MB download' },
  { id: 'best', label: 'Best', hint: 'whisper-large-v3-turbo, about 750 MB download, needs WebGPU' },
];

export const sttLanguageLabel = (code) => (STT_LANGUAGES.find((l) => l.code === code) || {}).label || code;
export const sttLanguageTag = (code) => (STT_LANGUAGES.find((l) => l.code === code) || {}).lang || '';
export const sttTierLabel = (id) => (STT_TIERS.find((t) => t.id === id) || {}).label || id;

// A stopped transcription rejects with this; callers treat it as "no transcript", not a failure.
export const isStopped = (err) => !!err && err.name === 'AbortError';
const stoppedError = () => new DOMException('Transcription stopped', 'AbortError');

// How long a stop request may go unanswered before the worker is replaced. A worker busy
// with WASM inference cannot read messages until the current job ends, which may be minutes.
const STOP_GRACE_MS = 1500;

// Jobs go to the worker one at a time: inference is serial in there anyway, and keeping the
// queue here means a stopped job can be dropped before it was ever sent. Background jobs
// (transcribing a saved sloka in every language) wait behind everything a person is
// waiting for, and a running one gives way: it is stopped and queued again from the start.
export class Transcriber {
  constructor({ stopGraceMs = STOP_GRACE_MS } = {}) {
    this.worker = null;
    this.queue = [];
    this.running = null;
    this.probes = new Map();
    this.seq = 0;
    this.stopGraceMs = stopGraceMs;
  }

  _ensure() {
    if (this.worker) return;
    this.worker = new Worker(new URL('./stt-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'probe') {
        const p = this.probes.get(m.id);
        if (p) { this.probes.delete(m.id); p.resolve(m.device); }
        return;
      }
      const job = this.running;
      if (!job || job.id !== m.id) return;
      if (m.type === 'progress') { if (!job.done && job.onProgress) job.onProgress(m); return; }
      if (m.type === 'error') this._settle(job, new Error(m.message));
      else if (m.type === 'stopped') this._settle(job, stoppedError());
      else this._settle(job, null, m.result);
    };
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'The speech-to-text worker failed. Check that you are online for the first model download.');
      this._fail(err);
    };
  }

  // Ends the running job and sends the next one. A job that gave way to foreground work
  // settles nothing: its promise belongs to the copy waiting in the queue.
  _settle(job, err, result) {
    clearTimeout(job.killTimer);
    if (!job.done && !job.yielded) { job.done = true; if (err) job.reject(err); else job.resolve(result); }
    if (this.running === job) { this.running = null; this._pump(); }
  }

  _pump() {
    if (this.running || !this.queue.length) return;
    const job = this.queue.shift();
    this.running = job;
    this._ensure();
    const samples = job.background ? job.samples.slice() : job.samples; // a background job keeps a copy in case it has to give way
    job.samples = job.background ? job.samples : null;
    this.worker.postMessage({ id: job.id, type: 'transcribe', samples, language: job.language, tier: job.tier, device: job.device }, [samples.buffer]);
  }

  // The running background job makes room for foreground work: a copy of it goes back to
  // the queue (its promise follows), and the worker is asked to stop, or replaced.
  _yield(job) {
    if (job.done || job.yielded) return;
    job.yielded = true;
    const again = { ...job, id: ++this.seq, yielded: false, killTimer: null };
    job.next = again;
    this.queue.push(again);
    this.worker.postMessage({ id: job.id, type: 'stop' });
    job.killTimer = setTimeout(() => {
      if (this.running !== job) return;
      this.worker.terminate();
      this.worker = null;
      this.running = null;
      this._pump();
    }, this.stopGraceMs);
  }

  // Everything in flight fails with `err` and the worker is thrown away (the next job starts a new one).
  _fail(err) {
    const jobs = this.queue.splice(0);
    if (this.running) jobs.unshift(this.running);
    this.running = null;
    for (const j of jobs) { clearTimeout(j.killTimer); if (!j.done) { j.done = true; j.reject(err); } }
    for (const p of this.probes.values()) p.reject(err);
    this.probes.clear();
    if (this.worker) { this.worker.terminate(); this.worker = null; }
  }

  _stop(job) {
    while (job.next) job = job.next; // a job that gave way lives on as its queued copy
    if (job.done) return;
    const i = this.queue.indexOf(job);
    if (i >= 0) { this.queue.splice(i, 1); job.done = true; job.reject(stoppedError()); return; }
    if (this.running !== job) return;
    // The caller is free at once; the worker is asked to stop and replaced if it cannot answer.
    job.done = true;
    job.reject(stoppedError());
    this.worker.postMessage({ id: job.id, type: 'stop' });
    job.killTimer = setTimeout(() => {
      if (this.running !== job) return;
      this.worker.terminate();
      this.worker = null;
      this.running = null;
      this._pump();
    }, this.stopGraceMs);
  }

  // Resolves with 'webgpu' or 'wasm'.
  probe() {
    this._ensure();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.probes.set(id, { resolve, reject });
      this.worker.postMessage({ id, type: 'probe' });
    });
  }

  // samples at any rate → { text, chunks: [{ text, start, end }], language, tier, model, device, fellBack }
  // `signal` (an AbortSignal) stops the job; the promise then rejects with an AbortError.
  // `device: 'wasm'` keeps the job off the GPU; `fellBack` in the result says the worker
  // moved it there itself because the GPU's answer was nonsense. `background` jobs run
  // only when nobody is waiting (see above).
  transcribe({ samples, sampleRate, language, tier, device = null, onProgress, signal, background = false }) {
    if (signal && signal.aborted) return Promise.reject(stoppedError());
    const x = resample(samples, sampleRate, 16000);
    const copy = x === samples ? Float32Array.from(x) : x;
    return new Promise((resolve, reject) => {
      const job = { id: ++this.seq, samples: copy, language, tier, device, onProgress, resolve, reject, done: false, killTimer: null, background, yielded: false, next: null };
      if (signal) signal.addEventListener('abort', () => this._stop(job), { once: true });
      if (background) this.queue.push(job);
      else {
        const i = this.queue.findIndex((j) => j.background);
        if (i < 0) this.queue.push(job); else this.queue.splice(i, 0, job);
        if (this.running && this.running.background) this._yield(this.running);
      }
      this._pump();
    });
  }

  // How many background jobs are waiting or running.
  get backlog() { return this.queue.filter((j) => j.background).length + (this.running && this.running.background ? 1 : 0); }
}
