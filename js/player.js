// Playback over an HTMLAudioElement: variable speed with pitch preservation,
// loop, seeking, and range playback (auto-pause at an end time) with a
// requestAnimationFrame 'tick' so the UI can draw a smooth playhead.

export class Player extends EventTarget {
  constructor() {
    super();
    const el = new Audio();
    el.preload = 'auto';
    this.el = el;
    this.duration = 0;
    this._url = null;
    this._rangeEnd = null;
    this._raf = 0;
    this._rate = 1;
    this.preservesPitch = true;
    el.addEventListener('play', () => { this._startTick(); this._emit('play'); });
    el.addEventListener('pause', () => { this._stopTick(); this._emit('tick'); this._emit('pause'); });
    el.addEventListener('ended', () => { this._rangeEnd = null; this._emit('ended'); });
    el.addEventListener('durationchange', () => { if (Number.isFinite(el.duration)) this.duration = el.duration; });
  }

  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail: { time: this.currentTime, ...detail } }));
  }

  // src: Blob or URL string. Resolves with the duration once metadata is known.
  load(src) {
    this.unload();
    const isBlob = typeof src !== 'string';
    const url = isBlob ? URL.createObjectURL(src) : src;
    if (isBlob) this._url = url;
    const el = this.el;
    return new Promise((resolve, reject) => {
      const cleanup = () => { el.removeEventListener('loadedmetadata', ok); el.removeEventListener('error', bad); };
      const ok = () => {
        cleanup();
        this.duration = Number.isFinite(el.duration) ? el.duration : 0;
        el.playbackRate = this._rate;
        this._emit('loaded');
        resolve(this.duration);
      };
      const bad = () => { cleanup(); reject(new Error('This audio could not be loaded or decoded by the browser.')); };
      el.addEventListener('loadedmetadata', ok);
      el.addEventListener('error', bad);
      el.src = url;
      el.load();
    });
  }

  unload() {
    this._rangeEnd = null;
    this._stopTick();
    if (!this.el.paused) this.el.pause();
    if (this.el.getAttribute('src')) { this.el.removeAttribute('src'); this.el.load(); }
    if (this._url) { URL.revokeObjectURL(this._url); this._url = null; }
    this.duration = 0;
  }

  get loaded() { return !!this.el.getAttribute('src'); }
  get currentTime() { return this.el.currentTime || 0; }
  get playing() { return !this.el.paused && !this.el.ended; }
  get rate() { return this._rate; }
  set rate(r) { this._rate = r; this.el.playbackRate = r; }
  set loop(b) { this.el.loop = !!b; }
  get loop() { return this.el.loop; }
  set preservesPitch(b) {
    const el = this.el;
    if ('preservesPitch' in el) el.preservesPitch = !!b;
    if ('webkitPreservesPitch' in el) el.webkitPreservesPitch = !!b;
    if ('mozPreservesPitch' in el) el.mozPreservesPitch = !!b;
  }

  seek(t) {
    const max = this.duration || Number.POSITIVE_INFINITY;
    this.el.currentTime = Math.max(0, Math.min(max, t));
    this._emit('tick');
  }

  async play() {
    this._rangeEnd = null;
    try { await this.el.play(); } catch (err) { this._emit('error', { error: err }); }
  }

  pause() { this.el.pause(); }
  toggle() { return this.playing ? this.pause() : this.play(); }
  stop() { this.pause(); this.seek(0); }

  // Play from start and pause automatically when end is reached.
  async playRange(start, end) {
    const s = Math.max(0, start);
    const e = this.duration ? Math.min(this.duration, end) : end;
    if (e <= s) return;
    this.el.currentTime = s;
    this._rangeEnd = e;
    try { await this.el.play(); } catch (err) { this._emit('error', { error: err }); }
  }

  _startTick() {
    this._stopTick();
    const loop = () => {
      this._emit('tick');
      if (this._rangeEnd != null && this.el.currentTime >= this._rangeEnd - 0.01) {
        const end = this._rangeEnd;
        this._rangeEnd = null;
        this.el.pause();
        this._emit('rangeend', { end });
        return;
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  _stopTick() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }
}
