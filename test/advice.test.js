import test from 'node:test';
import assert from 'node:assert/strict';
import { takeAdvice } from '../js/advice.js';

test('take advice: nothing to say when every sloka is known and scored', () => {
  assert.deepEqual(takeAdvice([{ name: 'CH18-01', firstTime: false, needs: false }, { name: 'CH18-02', firstTime: false, needs: false }]), []);
  assert.deepEqual(takeAdvice([]), []);
  assert.deepEqual(takeAdvice(null), []);
});

test('take advice: a sloka recited for the first time is practised on its own first', () => {
  const out = takeAdvice([{ name: 'CH18-01', firstTime: false, needs: false }, { name: 'CH18-03', firstTime: true, needs: false }, { name: 'CH18-04', firstTime: true, needs: true }]);
  assert.equal(out.length, 1);
  assert.match(out[0], /^CH18-03 and CH18-04: recited for the first time\./);
  assert.match(out[0], /evaluate each alone until it feels comfortable/);
  assert.match(out[0], /CH18-04 is Needs practice in this take\.$/);
});

test('take advice: a sloka that is Needs practice is evaluated alone next', () => {
  const out = takeAdvice([{ name: 'CH18-01', firstTime: false, needs: true }, { name: 'CH18-02', firstTime: false, needs: false }]);
  assert.equal(out.length, 1);
  assert.match(out[0], /^CH18-01: Needs practice\. Evaluate it alone, whole and clean;/);
  assert.match(out[0], /keeps its beginning and ending in your voice/);
});

test('take advice: both lines, the first-timers not repeated in the second, three names listed with commas', () => {
  const out = takeAdvice([
    { name: 'CH18-01', firstTime: false, needs: true },
    { name: 'CH18-02', firstTime: false, needs: true },
    { name: 'CH18-03', firstTime: true, needs: true },
    { name: 'CH18-04', firstTime: false, needs: true },
  ]);
  assert.equal(out.length, 2);
  assert.match(out[0], /^CH18-03: recited for the first time\./);
  assert.match(out[0], /CH18-03 is Needs practice in this take\.$/);
  assert.match(out[1], /^CH18-01, CH18-02 and CH18-04: Needs practice\. Evaluate each alone/);
  assert.doesNotMatch(out[1], /CH18-03/);
});
