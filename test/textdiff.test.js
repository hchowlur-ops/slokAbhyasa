import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, diffWords, diffSummary, compareWords, phoneticKey, tokenizeTranscript, windowedTokens, dandaMarks, withDandas } from '../js/textdiff.js';

test('phoneticKey: Devanagari, Kannada and Latin spellings of one sound share a key', () => {
  assert.equal(phoneticKey('नमः'), 'namah');
  assert.equal(phoneticKey('श्री'), 'sri');
  assert.equal(phoneticKey('भगवान्'), 'bhagavan');
  assert.equal(phoneticKey('अव्यक्तं'), 'avyaktam');
  assert.equal(phoneticKey('ॐ'), 'om');
  assert.equal(phoneticKey('ಶಿವಾಯ'), 'sivaya');
  assert.equal(phoneticKey('Śrī'), 'sri');
  assert.equal(phoneticKey('Bhagavān'), 'bhagavan');
  assert.equal(phoneticKey('avyaktaṁ'), 'avyaktam');
  assert.equal(phoneticKey('namaḥ'), 'namah');
  assert.equal(phoneticKey('नमः'), phoneticKey('namaḥ'));
});

test('compareWords: the recogniser writing Sanskrit in Latin one time and Devanagari the next is no mismatch', () => {
  const sloka = tokenize('श्री भगवानु वाच्छ मैया वेश्यमनो ये माम् निथ्ययुक्ता उपासते स्रध्धया परयो पेताहा').map((t) => t.norm);
  const latin = tokenize('Śrī Bhagavānuvāca mayyavishyamanoyemaam nitya yukta upasate śraddhyāparayopeta').map((t) => t.norm);
  const r = compareWords(sloka, latin);
  assert.ok(r.summary.similarity >= 0.75, `similarity ${r.summary.similarity}`);
  assert.ok(r.summary.missing <= 3, `missing ${[...r.delA].map((i) => sloka[i])}`);
});

test('compareWords: spelling and word-break differences of the recogniser are not wrong words', () => {
  const sloka = tokenize('येत्वक्षरम निर्देश्यम अव्यक्तं पर्युपासते सर्वत्रगम चिंत्यम्चा गूटस्थम चलं थुवं').map((t) => t.norm);
  // another run of the recogniser on the same recitation
  const heard = tokenize('येत्वक्षरम निर्देश्यम् अव्यक्तं पर्युपासते सर्वत्रगमचिंत्यम्चा कूटस्थमचलं द्रुवं').map((t) => t.norm);
  const r = compareWords(sloka, heard);
  assert.ok(r.summary.similarity >= 0.9, `similarity ${r.summary.similarity}`);
  assert.equal(r.summary.missing, 0, `missing ${[...r.delA].map((i) => sloka[i])}`);
  // a word really left out is still missing, and an added one extra
  const skipped = compareWords(sloka, heard.filter((w) => w !== 'पर्युपासते'));
  assert.deepEqual([...skipped.delA].map((i) => sloka[i]), ['पर्युपासते']);
  assert.ok(skipped.summary.similarity < 0.9 && skipped.summary.similarity > 0.8, `similarity ${skipped.summary.similarity}`);
  const added = compareWords(sloka, [...heard, 'नमः']);
  assert.equal(added.summary.extra, 1);
  // a different sloka is far off
  const other = tokenize('अर्जुन उवाच एवं सतत युक्ताये भक्तास्त्वां पर्युपासते येचाप्यक्षरम अव्यक्तं').map((t) => t.norm);
  assert.ok(compareWords(sloka, other).summary.similarity < 0.6, `different sloka ${compareWords(sloka, other).summary.similarity}`);
  // Latin and empty inputs
  assert.equal(compareWords(['om', 'namah'], ['om', 'namaha']).summary.missing, 0);
  assert.equal(compareWords([], ['x']).summary.similarity, 0);
  assert.equal(compareWords(['x'], []).summary.missing, 1);
});

test('windowedTokens: words of a long chunk are spread along it, so the part compared keeps its own words', () => {
  // a 44 s take of two slokas, transcribed as one 30 s chunk and one for the rest
  const words = (n, p) => Array.from({ length: n }, (_, i) => `${p}${i + 1}`).join(' ');
  const t = { text: '', chunks: [{ text: words(20, 'a'), start: 0, end: 30 }, { text: words(8, 'b'), start: 30, end: null }] };
  t.text = t.chunks.map((c) => c.text).join(' ');
  assert.equal(tokenizeTranscript(t).length, 28);
  // the whole take: everything counts
  assert.ok(windowedTokens(t, [0, 44], 44).inside.every(Boolean));
  assert.ok(windowedTokens(t, null, 44).inside.every(Boolean));
  // the second sloka, 24–40 s: the last words of the first chunk and all of the second
  const w = windowedTokens(t, [24, 40], 44);
  const kept = w.toks.filter((_, i) => w.inside[i]).map((x) => x.word);
  assert.deepEqual(kept, ['a17', 'a18', 'a19', 'a20', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6']);
  // the first sloka, 0–22 s: the first chunk's early words only
  const v = windowedTokens(t, [0, 22], 44);
  assert.deepEqual(v.toks.filter((_, i) => v.inside[i]).map((x) => x.word), Array.from({ length: 15 }, (_, i) => `a${i + 1}`));
  // no timings at all: everything counts
  const plain = { text: 'x y z', chunks: [] };
  assert.ok(windowedTokens(plain, [1, 2], 10).inside.every(Boolean));
});

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

test('a displayed śloka gets its daṇḍas: ॥ at the end, । after the first of two or the second of four lines', () => {
  const two = 'सर्वधर्मान्परित्यज्य मामेकं शरणं व्रज\nअहं त्वा सर्वपापेभ्यः मोक्षयिष्यामि मा शुचः';
  assert.equal(withDandas(two), 'सर्वधर्मान्परित्यज्य मामेकं शरणं व्रज ।\nअहं त्वा सर्वपापेभ्यः मोक्षयिष्यामि मा शुचः ॥');
  const four = 'ये तु धर्म्यामृतमिदं\nयथोक्तं पर्युपासते\nश्रद्दधाना मत्परमा\nभक्तास्तेऽतीव मे प्रियाः';
  const m4 = dandaMarks(four);
  assert.deepEqual([...m4.marks.entries()], [[3, '॥'], [1, '।']]);
  assert.equal(withDandas(four).split('\n')[1], 'यथोक्तं पर्युपासते ।');
  // daṇḍas already there are not doubled; a single line gets only the final one; romanised text uses bars
  assert.equal(withDandas('मामेकं शरणं व्रज ।\nमा शुचः ॥'), 'मामेकं शरणं व्रज ।\nमा शुचः ॥');
  assert.equal(withDandas('एवं सततयुक्ता ये भक्तास्त्वां पर्युपासते'), 'एवं सततयुक्ता ये भक्तास्त्वां पर्युपासते ॥');
  assert.equal(withDandas('sarvadharmān parityajya\nmām ekaṃ śaraṇaṃ vraja'), 'sarvadharmān parityajya |\nmām ekaṃ śaraṇaṃ vraja ||');
  assert.equal(withDandas('क\nख\nग'), 'क\nख\nग ॥', 'three lines: only the final mark');
  assert.equal(withDandas(''), '');
});
