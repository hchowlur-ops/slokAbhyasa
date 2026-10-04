import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trimSilence, findActiveRegion } from '../js/dsp/trim.js';
import { encodeWavBytes, decodeWav } from '../js/wav.js';
import { tone, silence, concat, noise } from './synth.js';

const SR = 16000;
const quiet = (ms) => noise(ms, -65, 3); // room-like noise floor instead of digital silence
const near = (a, b, tol) => Math.abs(a - b) <= tol;

test('trim: removes leading and trailing silence, keeps padding', () => {
  const x = concat(quiet(1500), tone(220, 1000), quiet(2000));
  const t = trimSilence(x, SR);
  assert.ok(t.changed);
  assert.ok(near(t.removedStart, 1.5 - 0.12, 0.06), `removedStart ${t.removedStart}`);
  assert.ok(near(t.removedEnd, 2.0 - 0.22, 0.06), `removedEnd ${t.removedEnd}`);
  assert.ok(near(t.samples.length / SR, 1.0 + 0.12 + 0.22, 0.08), `length ${t.samples.length / SR}`);
});

test('trim: an isolated click before the start is ignored', () => {
  const click = tone(3000, 30, { attackMs: 1, releaseMs: 1, amp: 0.8 });
  const x = concat(quiet(300), click, quiet(1700), tone(220, 1000), quiet(500));
  const t = trimSilence(x, SR);
  assert.ok(t.changed);
  assert.ok(near(t.removedStart, 2.0 - 0.12, 0.06), `removedStart ${t.removedStart}`);
});

test('trim: a short cough well before the start is ignored, breath close to it is kept', () => {
  const cough = tone(400, 120, { amp: 0.4 });
  const x = concat(quiet(500), cough, quiet(1000), tone(220, 1000), quiet(500));
  const t = trimSilence(x, SR);
  assert.ok(near(t.removedStart, 1.62 - 0.12, 0.06), `cough: removedStart ${t.removedStart}`);
  const x2 = concat(quiet(500), cough, quiet(100), tone(220, 1000), quiet(500));
  const t2 = trimSilence(x2, SR);
  assert.ok(near(t2.removedStart, 0.5 - 0.12, 0.06), `breath: removedStart ${t2.removedStart}`);
});

test('trim: silence-only and already-tight input are left unchanged', () => {
  const s = trimSilence(quiet(2000), SR);
  assert.equal(s.changed, false);
  assert.equal(s.samples.length, 2000 * 16);
  const tight = trimSilence(tone(220, 1000), SR);
  assert.equal(tight.changed, false);
  // a soft start must not be mistaken for silence when the take has no real silence
  const soft = concat(tone(220, 600, { amp: 0.03 }), tone(220, 1000, { amp: 0.3 }));
  assert.equal(trimSilence(soft, SR).changed, false, 'soft opening kept');
  const region = findActiveRegion(silence(1000), SR);
  assert.equal(region.active, false);
});

test('trim: works in a noisier room (-45 dBFS floor)', () => {
  const room = (ms) => noise(ms, -45, 5);
  const x = concat(room(1500), tone(220, 1000), room(2000));
  const t = trimSilence(x, SR);
  assert.ok(t.changed);
  assert.ok(near(t.removedStart, 1.5 - 0.12, 0.08), `removedStart ${t.removedStart}`);
  assert.ok(near(t.removedEnd, 2.0 - 0.22, 0.08), `removedEnd ${t.removedEnd}`);
});

test('trim: trimming twice changes nothing the second time', () => {
  const x = concat(quiet(1200), tone(220, 800), quiet(900));
  const once = trimSilence(x, SR);
  assert.ok(once.changed);
  const twice = trimSilence(once.samples, SR);
  assert.equal(twice.changed, false, `second pass removed ${twice.removedStart} / ${twice.removedEnd}`);
});

test('trim: pauses inside the material are not cut', () => {
  const x = concat(quiet(800), tone(220, 500), quiet(900), tone(330, 500), quiet(800));
  const t = trimSilence(x, SR);
  assert.ok(near(t.samples.length / SR, 0.5 + 0.9 + 0.5 + 0.12 + 0.22, 0.08), `length ${t.samples.length / SR}`);
});

test('wav: 16-bit mono round trip and 32-bit float stereo decode', () => {
  const x = tone(440, 200);
  const back = decodeWav(encodeWavBytes(x, 22050));
  assert.equal(back.sampleRate, 22050);
  assert.equal(back.channels, 1);
  assert.equal(back.samples.length, x.length);
  let err = 0;
  for (let i = 0; i < x.length; i++) err = Math.max(err, Math.abs(back.samples[i] - x[i]));
  assert.ok(err <= 0.5 / 32768 + 1e-9, `max error ${err} (should be within half a quantisation step)`);

  // hand-built float32 stereo file: L = 0.5, R = -0.25 → mono mix 0.125
  const frames = 100;
  const buf = new ArrayBuffer(44 + frames * 8);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + frames * 8, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, 2, true); v.setUint32(24, 48000, true);
  v.setUint32(28, 48000 * 8, true); v.setUint16(32, 8, true); v.setUint16(34, 32, true);
  str(36, 'data'); v.setUint32(40, frames * 8, true);
  for (let i = 0; i < frames; i++) { v.setFloat32(44 + i * 8, 0.5, true); v.setFloat32(48 + i * 8, -0.25, true); }
  const st = decodeWav(buf);
  assert.equal(st.channels, 2);
  assert.equal(st.sampleRate, 48000);
  assert.equal(st.samples.length, frames);
  assert.ok(near(st.samples[10], 0.125, 1e-6));
});
