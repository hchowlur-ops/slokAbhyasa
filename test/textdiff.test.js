import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, diffWords, diffSummary } from '../js/textdiff.js';

test('tokenize strips punctuation including danda and keeps Indic syllables', () => {
  const t = tokenize('ॐ भूर्भुवः स्वः । तत्सवितुर्वरेण्यं ॥');
  assert.deepEqual(t.map((x) => x.word), ['ॐ', 'भूर्भुवः', 'स्वः', 'तत्सवितुर्वरेण्यं']);
  const k = tokenize('ಓಂ ನಮಃ ಶಿವಾಯ, ಓಂ!');
  assert.deepEqual(k.map((x) => x.norm), ['ಓಂ', 'ನಮಃ', 'ಶಿವಾಯ', 'ಓಂ']);
  const e = tokenize('Hello, World! "quoted" (parens)');
  assert.deepEqual(e.map((x) => x.norm), ['hello', 'world', 'quoted', 'parens']);
  assert.deepEqual(e.map((x) => x.word), ['Hello', 'World', 'quoted', 'parens']);
});

test('diffWords finds missing, extra and equal words', () => {
  const a = tokenize('om bhur bhuvah svah tat savitur varenyam').map((x) => x.norm);
  const b = tokenize('om bhuvah svah tat savitur varenyam bhargo').map((x) => x.norm);
  const ops = diffWords(a, b);
  const del = ops.filter((o) => o.op === 'delete').map((o) => a[o.a]);
  const ins = ops.filter((o) => o.op === 'insert').map((o) => b[o.b]);
  assert.deepEqual(del, ['bhur']);
  assert.deepEqual(ins, ['bhargo']);
  const s = diffSummary(ops, a.length, b.length);
  assert.equal(s.matched, 6);
  assert.equal(s.missing, 1);
  assert.equal(s.extra, 1);
  assert.ok(Math.abs(s.similarity - 6 / 7) < 1e-9);
});

test('diffWords handles empty inputs and a substituted word', () => {
  assert.deepEqual(diffWords([], []), []);
  assert.equal(diffWords(['a', 'b'], []).length, 2);
  const ops = diffWords(['a', 'b', 'c'], ['a', 'x', 'c']);
  assert.deepEqual(ops.map((o) => o.op), ['equal', 'delete', 'insert', 'equal']);
});
