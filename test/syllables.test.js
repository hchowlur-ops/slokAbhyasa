import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyllableCounter } from '../js/dsp/syllables.js';
import { tone, noise, concat } from './synth.js';

const SR = 16000;
const room = (ms) => noise(ms, -58, 3);
// a "syllable": a vowel-like burst of 150 ms, followed by a consonant-like dip of 60 ms
const syllable = (f = 220) => concat(tone(f, 150, { attackMs: 20, releaseMs: 20, amp: 0.3 }), noise(60, -58, 3));
const sloka = (n, f = 220) => concat(...Array.from({ length: n }, (_, i) => syllable(f + (i % 3) * 10)));
const feed = (counter, x, chunk = 4096) => { let s = null; for (let i = 0; i < x.length; i += chunk) s = counter.push(x.subarray(i, Math.min(x.length, i + chunk))); return s; };

test('syllable nuclei are counted to within a tenth, and the pause after them is measured', () => {
  const c = new SyllableCounter(SR);
  const x = concat(room(600), sloka(32), room(900));
  const s = feed(c, x);
  assert.ok(Math.abs(s.count - 32) <= 3, `count ${s.count}`);
  assert.ok(s.pauseMs >= 700 && s.pauseMs <= 1100, `pause ${s.pauseMs}`);
  assert.ok(s.elapsedMs > 7000);
});

test('reset starts a new count without forgetting the room; chunk size does not matter', () => {
  const c = new SyllableCounter(SR);
  feed(c, concat(room(500), sloka(8)));
  assert.ok(Math.abs(c.state_().count - 8) <= 1, `first ${c.state_().count}`);
  c.reset();
  assert.equal(c.state_().count, 0);
  const s = feed(c, concat(room(200), sloka(16)), 777);
  assert.ok(Math.abs(s.count - 16) <= 2, `second ${s.count}`);
});

test('a sustained note is one nucleus; silence counts nothing', () => {
  const c = new SyllableCounter(SR);
  const s = feed(c, concat(room(300), tone(220, 1500, { attackMs: 30, releaseMs: 30, amp: 0.3 }), room(500)));
  assert.ok(s.count <= 2, `sustained ${s.count}`);
  const q = new SyllableCounter(SR);
  assert.equal(feed(q, room(3000)).count, 0);
});
