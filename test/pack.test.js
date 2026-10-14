import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soundRuns, packClips, unpackTime, unpackTranscript } from '../js/dsp/pack.js';
import { tone, noise, concat } from './synth.js';

const SR = 16000;
const room = (ms) => noise(ms, -58, 3);
const sing = (ms) => tone(220, ms, { attackMs: 20, releaseMs: 20, amp: 0.3 });

test('the sounding runs of a clip: breaths kept inside a run, longer silences split it', () => {
  const x = concat(room(1000), sing(3000), room(300), sing(2000), room(1500), sing(1000), room(800));
  const runs = soundRuns(x, SR);
  assert.equal(runs.length, 2, JSON.stringify(runs));
  assert.ok(Math.abs(runs[0].start - 1.0) < 0.1 && Math.abs(runs[0].end - 6.3) < 0.15, JSON.stringify(runs[0]));
  assert.ok(Math.abs(runs[1].start - 7.8) < 0.1 && Math.abs(runs[1].end - 8.8) < 0.15, JSON.stringify(runs[1]));
  assert.deepEqual(soundRuns(room(2000), SR), []);
});

test('two stretches packed: only their sound, short gaps, and every clip time maps back to its stretch', () => {
  const a = concat(room(800), sing(4000), room(2000)); // 6.8 s, 4 s of sound
  const b = concat(room(1500), sing(2000), room(1000), sing(3000), room(500)); // 8 s, 5 s of sound in two runs
  const p = packClips([a, b], SR);
  assert.ok(p.seconds < 4 + 5 + 3 * 0.4 + 6 * 0.15 + 0.2 && p.seconds > 9, `packed ${p.seconds.toFixed(2)} s`);
  assert.equal(p.boundaries.length, 2);
  assert.ok(p.boundaries[0] === 0 && p.boundaries[1] > 4 && p.boundaries[1] < 5.2, JSON.stringify(p.boundaries));
  assert.equal(p.map.length, 3);
  // a moment in the first run maps into a's time, with the edge room taken into account
  const m0 = unpackTime(p.map, 1.0);
  assert.equal(m0.part, 0);
  assert.ok(Math.abs(m0.time - (p.map[0].srcStart + 1.0)) < 0.001);
  // a moment in b's second run maps into b's time near its source
  const r2 = p.map[2];
  const m2 = unpackTime(p.map, r2.clipStart + 0.5);
  assert.equal(m2.part, 1);
  assert.ok(Math.abs(m2.time - (r2.srcStart + 0.5)) < 0.001);
  assert.ok(r2.srcStart > 4.3 && r2.srcStart < 4.6, `second run of b starts at ${r2.srcStart}`);
  // a moment inside a gap belongs to the run before it, at its end
  const g = unpackTime(p.map, p.map[0].clipEnd + 0.1);
  assert.equal(g.part, 0);
  assert.ok(Math.abs(g.time - (p.map[0].srcStart + (p.map[0].clipEnd - p.map[0].clipStart))) < 0.001);
  // a silent stretch is still represented by a second of it
  const q = packClips([room(3000), a], SR);
  assert.equal(q.map[0].part, 0);
  assert.ok(q.map[0].clipEnd - q.map[0].clipStart <= 1.001);
});

test('the clip\'s transcript split into the stretches\' own, times put back', () => {
  const a = concat(room(500), sing(3000), room(500));
  const b = concat(room(500), sing(3000), room(500));
  const p = packClips([a, b], SR);
  const bStart = p.boundaries[1];
  const t = { language: 'sanskrit', text: 'x y z', chunks: [{ text: 'x', start: 0.2, end: 1.6 }, { text: 'y', start: 1.7, end: 3.1 }, { text: 'z', start: bStart + 0.3, end: bStart + 2.5 }] };
  const [ta, tb] = unpackTranscript(t, p.map, 2);
  assert.equal(ta.text, 'x y');
  assert.equal(tb.text, 'z');
  assert.equal(ta.language, 'sanskrit');
  assert.ok(ta.chunks[0].start >= 0.3 && ta.chunks[0].start < 0.7, `x starts at ${ta.chunks[0].start} in a`);
  assert.ok(tb.chunks[0].start >= 0.5 && tb.chunks[0].start < 0.9, `z starts at ${tb.chunks[0].start} in b`);
  assert.ok(tb.chunks[0].end > tb.chunks[0].start);
  const [onlyA, none] = unpackTranscript({ text: 'x', chunks: [{ text: 'x', start: 0.2, end: 1 }] }, p.map, 2);
  assert.equal(onlyA.text, 'x');
  assert.equal(none, null);
  assert.deepEqual(unpackTranscript(null, p.map, 2), [null, null]);
});
