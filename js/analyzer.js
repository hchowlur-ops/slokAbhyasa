// Promise wrapper around the analysis worker with request ids and progress.

export class Analyzer {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.seq = 0;
  }

  _ensure() {
    if (this.worker) return;
    this.worker = new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const m = e.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') { if (p.onProgress) p.onProgress(m.value); return; }
      this.pending.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.message));
      else p.resolve(m.features !== undefined ? m.features : m.result);
    };
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'The analysis worker failed.');
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.worker.terminate();
      this.worker = null;
    };
  }

  _send(msg, transfer, onProgress) {
    this._ensure();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ id, ...msg }, transfer || []);
    });
  }

  // samples: Float32Array at any sample rate (a copy is transferred to the worker).
  // { warps: true } for a take: it is also analysed at several voice warps, so the comparison
  // can allow for a voice unlike the sloka's (see compare.js).
  features(samples, sampleRate, onProgress, { warps = false } = {}) {
    const copy = Float32Array.from(samples);
    return this._send({ type: 'features', samples: copy, sampleRate, warps }, [copy.buffer], onProgress);
  }

  compare(base, heard, options, onProgress) {
    return this._send({ type: 'compare', base, heard, options }, [], onProgress);
  }

  // How alike two recordings are (see locate.js): ~0.5 same material, ~1 different material.
  contrast(a, b) {
    return this._send({ type: 'contrast', a, b }, []);
  }

  cancelAll() {
    const err = new Error('Cancelled');
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    if (this.worker) { this.worker.terminate(); this.worker = null; }
  }
}
