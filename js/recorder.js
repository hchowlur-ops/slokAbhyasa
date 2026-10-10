// Microphone capture as raw Float32 PCM through an AudioWorklet.
// Emits 'level' events ({ rms, peak, clip, elapsed }) for meters.

const PROCESSOR_SRC = [
  'class TutorCapture extends AudioWorkletProcessor {',
  '  constructor() {',
  '    super();',
  '    this.size = 4096;',
  '    this.buf = new Float32Array(this.size);',
  '    this.pos = 0;',
  '    this.port.onmessage = (e) => {',
  "      if (e.data === 'flush') {",
  '        this.port.postMessage({ flush: true, data: this.buf.slice(0, this.pos) });',
  '        this.buf = new Float32Array(this.size);',
  '        this.pos = 0;',
  '      }',
  '    };',
  '  }',
  '  process(inputs) {',
  '    const ch = inputs[0] && inputs[0][0];',
  '    if (ch) {',
  '      for (let i = 0; i < ch.length; i++) {',
  '        this.buf[this.pos++] = ch[i];',
  '        if (this.pos === this.size) {',
  '          this.port.postMessage({ data: this.buf }, [this.buf.buffer]);',
  '          this.buf = new Float32Array(this.size);',
  '          this.pos = 0;',
  '        }',
  '      }',
  '    }',
  '    return true;',
  '  }',
  '}',
  "registerProcessor('tutor-capture', TutorCapture);",
].join('\n');

export class Recorder extends EventTarget {
  constructor(ctx) {
    super();
    this.ctx = ctx;
    this.active = false;
    this.chunks = [];
    this.length = 0;
    this.startTime = 0;
    this._flushResolve = null;
  }

  static async ensureWorklet(ctx) {
    if (ctx.__tutorWorklet) return;
    if (!ctx.audioWorklet) throw new Error('This browser does not support AudioWorklet. Please use a current Chrome, Edge, Firefox or Safari.');
    const url = URL.createObjectURL(new Blob([PROCESSOR_SRC], { type: 'application/javascript' }));
    try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    ctx.__tutorWorklet = true;
  }

  async start() {
    if (this.active) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Microphone access is not available here. Open the app at http://localhost:8787 (not a file:// URL).');
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    await Recorder.ensureWorklet(this.ctx);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        video: false,
      });
    } catch (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        throw new Error('Microphone permission was denied. Allow the microphone for this site and try again.');
      }
      if (err && err.name === 'NotFoundError') throw new Error('No microphone was found.');
      throw err;
    }
    this.stream = stream;
    this.source = this.ctx.createMediaStreamSource(stream);
    this.node = new AudioWorkletNode(this.ctx, 'tutor-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;
    this.node.port.onmessage = (e) => this._onMessage(e.data);
    this.source.connect(this.node);
    this.node.connect(this.sink);
    this.sink.connect(this.ctx.destination);
    this.chunks = [];
    this.length = 0;
    this.startTime = this.ctx.currentTime;
    this.active = true;
  }

  _onMessage(msg) {
    const chunk = msg.data;
    if (msg.flush) {
      if (chunk && chunk.length) { this.chunks.push(chunk); this.length += chunk.length; }
      if (this._flushResolve) { this._flushResolve(); this._flushResolve = null; }
      return;
    }
    if (!this.active || !chunk) return;
    this.chunks.push(chunk);
    this.length += chunk.length;
    let peak = 0;
    let s = 0;
    for (let i = 0; i < chunk.length; i++) {
      const v = chunk[i];
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      s += v * v;
    }
    const rms = Math.sqrt(s / chunk.length);
    this.dispatchEvent(new CustomEvent('level', { detail: { rms, peak, clip: peak >= 0.985, elapsed: this.elapsed } }));
  }

  get elapsed() { return this.active ? this.ctx.currentTime - this.startTime : 0; }

  // The audio captured so far, as one buffer (a copy; the processor's last partial block is
  // not in it), for work that cannot wait for stop.
  snapshot() {
    const samples = new Float32Array(this.length);
    let o = 0;
    for (const c of this.chunks) { samples.set(c, o); o += c.length; }
    return { samples, sampleRate: this.ctx.sampleRate, duration: samples.length / this.ctx.sampleRate };
  }

  async stop() {
    if (!this.active) return null;
    this.active = false;
    // Ask the processor for its partial buffer, but do not wait forever.
    await new Promise((resolve) => {
      this._flushResolve = resolve;
      try { this.node.port.postMessage('flush'); } catch { resolve(); }
      setTimeout(resolve, 250);
    });
    this._flushResolve = null;
    try { this.source.disconnect(); this.node.disconnect(); this.sink.disconnect(); } catch { /* ignore */ }
    this.node.port.onmessage = null;
    // what the microphone track says about itself, kept with a saved sloka as its capture record
    const capture = Recorder.captureInfo(this.stream);
    for (const t of this.stream.getTracks()) t.stop();
    const samples = new Float32Array(this.length);
    let o = 0;
    for (const c of this.chunks) { samples.set(c, o); o += c.length; }
    this.chunks = [];
    this.length = 0;
    return { samples, sampleRate: this.ctx.sampleRate, duration: samples.length / this.ctx.sampleRate, capture };
  }

  static captureInfo(stream) {
    try {
      const track = stream.getAudioTracks()[0];
      if (!track) return null;
      const s = typeof track.getSettings === 'function' ? track.getSettings() : {};
      const bool = (v) => (typeof v === 'boolean' ? v : null);
      return {
        device: track.label || null,
        sampleRate: typeof s.sampleRate === 'number' ? s.sampleRate : null,
        channelCount: typeof s.channelCount === 'number' ? s.channelCount : null,
        echoCancellation: bool(s.echoCancellation),
        noiseSuppression: bool(s.noiseSuppression),
        autoGainControl: bool(s.autoGainControl),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      };
    } catch {
      return null;
    }
  }
}
