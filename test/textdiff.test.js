import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, diffWords, diffSummary, compareWords, phoneticKey, tokenizeTranscript, windowedTokens, dandaMarks, withDandas, uvacaWords, isUvacaLine, splitUvaca, neighbourEdges, loopedHearing } from '../js/textdiff.js';
import { findSelfCorrections, tokenMoments, refineBoundary } from '../js/textdiff.js';
import fs from 'node:fs';

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
  const words = (n, p) => Array.from({ length: n }, (_, i) => `${p}${String(i + 1).padStart(2, '0')}`).join(' '); // words of one length: their moments are spread evenly (a longer word takes a larger share)
  const t = { text: '', chunks: [{ text: words(20, 'a'), start: 0, end: 30 }, { text: words(8, 'b'), start: 30, end: null }] };
  t.text = t.chunks.map((c) => c.text).join(' ');
  assert.equal(tokenizeTranscript(t).length, 28);
  // the whole take: everything counts
  assert.ok(windowedTokens(t, [0, 44], 44).inside.every(Boolean));
  assert.ok(windowedTokens(t, null, 44).inside.every(Boolean));
  // the second sloka, 24–40 s: the last words of the first chunk and all of the second
  const w = windowedTokens(t, [24, 40], 44);
  const kept = w.toks.filter((_, i) => w.inside[i]).map((x) => x.word);
  assert.deepEqual(kept, ['a17', 'a18', 'a19', 'a20', 'b01', 'b02', 'b03', 'b04', 'b05', 'b06']);
  // the first sloka, 0–22 s: the first chunk's early words only
  const v = windowedTokens(t, [0, 22], 44);
  assert.deepEqual(v.toks.filter((_, i) => v.inside[i]).map((x) => x.word), Array.from({ length: 15 }, (_, i) => `a${String(i + 1).padStart(2, '0')}`));
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

test('"arjuna uvāca" opening a śloka is recognised in any script and spelling', () => {
  assert.equal(uvacaWords(['अर्जुन', 'उवाच', 'एवं']), 2);
  assert.equal(uvacaWords(['श्री', 'भगवान्', 'उवाच', 'मय्यावेश्य']), 3);
  assert.equal(uvacaWords(['श्रीभगवानुवाच', 'मय्यावेश्य']), 1);
  assert.equal(uvacaWords(['श्री', 'भगवानु', 'वाच्छ', 'मैया']), 3, "Whisper's spelling");
  assert.equal(uvacaWords(['सञ्जय', 'उवाच।', 'तं']), 2);
  assert.equal(uvacaWords(['arjuna', 'uvāca', 'evaṃ']), 2);
  assert.equal(uvacaWords(['ಅರ್ಜುನ', 'ಉವಾಚ', 'ಏವಂ']), 2);
  assert.equal(uvacaWords(['శ్రీభగవానువాచ', 'x']), 1);
  assert.equal(uvacaWords(['सर्वधर्मान्परित्यज्य', 'मामेकं', 'शरणं', 'व्रज']), 0);
  assert.equal(uvacaWords(['अर्जुन', 'उवाच']), 0, 'nothing follows: not an opening');
  assert.equal(uvacaWords(['एवं', 'सततयुक्ता', 'ये', 'भक्तास्त्वां', 'उवाच', 'x']), 0, 'only among the first three words');
  assert.equal(isUvacaLine('अर्जुन उवाच'), true);
  assert.equal(isUvacaLine('श्री भगवानु वाच्छ'), true);
  assert.equal(isUvacaLine('एवं सततयुक्ता ये'), false);
  assert.deepEqual(splitUvaca('अर्जुन उवाच एवं सततयुक्ता'), { prefix: 'अर्जुन उवाच', body: 'एवं सततयुक्ता' });
  assert.deepEqual(splitUvaca('श्रीभगवानुवाच\nमय्यावेश्य मनो ये\nमां नित्ययुक्ता'), { prefix: 'श्रीभगवानुवाच', body: 'मय्यावेश्य मनो ये\nमां नित्ययुक्ता' });
  assert.deepEqual(splitUvaca('एवं सततयुक्ता'), { prefix: '', body: 'एवं सततयुक्ता' });
  // the daṇḍas skip the attribution's line
  assert.equal(withDandas('अर्जुन उवाच\nएवं सततयुक्ता ये भक्तास्त्वां पर्युपासते\nये चाप्यक्षरमव्यक्तं तेषां के योगवित्तमाः'), 'अर्जुन उवाच\nएवं सततयुक्ता ये भक्तास्त्वां पर्युपासते ।\nये चाप्यक्षरमव्यक्तं तेषां के योगवित्तमाः ॥');
  assert.equal(withDandas('अर्जुन उवाच\nक\nख\nग\nघ'), 'अर्जुन उवाच\nक\nख ।\nग\nघ ॥');
});

test('self-corrections: a sloka ending with the word the next sloka begins with is the recital going on, not a repeat', () => {
  const T = (s) => s.split(' ').map((w) => ({ word: w, norm: w }));
  const ref = T('धर्मक्षेत्रे कुरुक्षेत्रे समवेता युयुत्सवः मामकाः पाण्डवाश्चैव किमकुर्वत सञ्जय');
  const heard = T('धर्मक्षेत्रे कुरुक्षेत्रे समवेता युयुत्सवः मामकाः पाण्डवाश्चैव किमकुर्वत सञ्जय सञ्जय उवाच दृष्ट्वा');
  assert.deepEqual(findSelfCorrections(ref, heard).map((c) => c.kind), ['repeat'], 'blind to the next sloka, a repeat');
  assert.deepEqual(findSelfCorrections(ref, heard, { nextOpening: T('सञ्जय उवाच दृष्ट्वा तु पाण्डवानीकं') }), [], 'the next sloka begins with that word');
  assert.deepEqual(findSelfCorrections(ref, heard, { nextOpening: T('अर्जुन उवाच') }).map((c) => c.kind), ['repeat'], 'a next sloka beginning otherwise: still a repeat');
  // the mirror: the next sloka's window begins with the previous sloka's last word
  const ref2 = T('सञ्जय उवाच दृष्ट्वा तु पाण्डवानीकं व्यूढं दुर्योधनस्तदा');
  const heard2 = T('किमकुर्वत सञ्जय सञ्जय उवाच दृष्ट्वा तु पाण्डवानीकं व्यूढं दुर्योधनस्तदा');
  assert.deepEqual(findSelfCorrections(ref2, heard2).map((c) => c.kind), ['repeat'], 'blind to the sloka before, a repeat');
  assert.deepEqual(findSelfCorrections(ref2, heard2, { prevEnding: T('मामकाः पाण्डवाश्चैव किमकुर्वत सञ्जय') }), [], 'the sloka before ends with that word');
});

test('self-corrections from the words: a word said twice, a pāda started again, the sloka started again', () => {
  const T = (s) => s.split(' ').map((w) => ({ word: w, norm: w }));
  const ref = T('ये त्वक्षरमनिर्देश्यमव्यक्तं पर्युपासते सर्वत्रगमचिन्त्यञ्च कूटस्थमचलन्ध्रुवम्');
  const refPada = [1, 1, 2, 3, 4];
  assert.deepEqual(findSelfCorrections(ref, ref), []);
  const twice = findSelfCorrections(ref, T('ये त्वक्षरमनिर्देश्यमव्यक्तं पर्युपासते पर्युपासते सर्वत्रगमचिन्त्यञ्च कूटस्थमचलन्ध्रुवम्'), { refPada });
  assert.deepEqual(twice.map((c) => [c.kind, c.word]), [['repeat', 'पर्युपासते']]);
  // the second half-verse started again: "sarvatra… kūṭa…" then once more from sarvatra
  const again = findSelfCorrections(ref, T('ये त्वक्षरमनिर्देश्यमव्यक्तं पर्युपासते सर्वत्रगमचिन्त्यञ्च कूटस्थम सर्वत्रगमचिन्त्यञ्च कूटस्थमचलन्ध्रुवम्'), { refPada });
  assert.equal(again.length, 1, JSON.stringify(again));
  assert.equal(again[0].kind, 'restart');
  assert.equal(again[0].word, 'सर्वत्रगमचिन्त्यञ्च');
  assert.equal(again[0].pada, 3);
  // the whole sloka started again after three words
  const top = findSelfCorrections(ref, T('ये त्वक्षरमनिर्देश्यमव्यक्तं पर्युपासते ये त्वक्षरमनिर्देश्यमव्यक्तं पर्युपासते सर्वत्रगमचिन्त्यञ्च कूटस्थमचलन्ध्रुवम्'), { refPada });
  assert.deepEqual(top.map((c) => [c.kind, c.word, c.pada]), [['restart', 'ये', 1]]);
  // a stray word is not a restart; a short run matching nothing is not either
  assert.deepEqual(findSelfCorrections(ref, T('ये त्वक्षरमनिर्देश्यमव्यक्तं हरि पर्युपासते सर्वत्रगमचिन्त्यञ्च कूटस्थमचलन्ध्रुवम्')), []);
  // the same in Kannada: the keys read across scripts
  const kn = findSelfCorrections(ref, T('ಯೇ ತ್ವಕ್ಷರಮನಿರ್ದೇಶ್ಯಮವ್ಯಕ್ತಂ ಪರ್ಯುಪಾಸತೇ ಪರ್ಯುಪಾಸತೇ ಸರ್ವತ್ರಗಮಚಿಂತ್ಯಞ್ಚ ಕೂಟಸ್ಥಮಚಲಂಧ್ರುವಮ್'));
  assert.equal(kn.length, 1);
  assert.equal(kn[0].kind, 'repeat');
});

test('self-corrections: a sloka that echoes itself is not a repeat, and a real one in it still is', () => {
  const T = (s) => s.split(' ').map((w) => ({ word: w, norm: w }));
  // 18.2: kāmyānāṁ karmaṇāṁ rhyme, and nyāsaṁ is said again at once inside saṁnyāsaṁ
  const ref = T('श्रीभगवानुवाच काम्यानां कर्मणां न्यासं संन्यासं कवयो विदुः सर्वकर्मफलत्यागं प्राहुस्त्यागं विचक्षणाः');
  assert.deepEqual(findSelfCorrections(ref, ref), [], 'the text against itself');
  assert.deepEqual(findSelfCorrections(ref, T('श्रीभगवानुवाच काम्यानां कर्मानां ञासं सञासं कवयो विदुः सर्वकर्मफलत्यागं प्राहुस्त्यागं विचक्षणाः')), [], "as the recogniser wrote it on 31 October: ñāsaṁ sañāsaṁ, karmānāṁ");
  const refPada = [1, 2, 2, 2, 2, 2, 2, 3, 3, 3];
  const again = findSelfCorrections(ref, T('श्रीभगवानुवाच काम्यानां कर्मणां न्यासं संन्यासं काम्यानां कर्मणां न्यासं संन्यासं कवयो विदुः सर्वकर्मफलत्यागं प्राहुस्त्यागं विचक्षणाः'), { refPada });
  assert.equal(again.length, 1, 'the half-line started again is still heard');
  assert.equal(again[0].kind, 'restart');
  assert.equal(again[0].pada, 2);
  // 4.25: yajñaṁ said twice before yoginaḥ, in a sloka whose second line goes yajñaṁ yajñena
  const ref2 = T('दैवमेवापरे यज्ञं योगिनः पर्युपासते ब्रह्माग्नावपरे यज्ञं यज्ञेनैवोपजुह्वति');
  assert.deepEqual(findSelfCorrections(ref2, ref2), []);
  assert.deepEqual(findSelfCorrections(ref2, T('दैवमेवापरे यज्ञं यज्ञं योगिनः पर्युपासते ब्रह्माग्नावपरे यज्ञं यज्ञेनैवोपजुह्वति')).map((c) => c.kind), ['repeat']);
});

test('self-corrections: no sloka of the Gītā reads as a repeat against its own text', () => {
  const verses = JSON.parse(fs.readFileSync(new URL('../reference/gita/verses.json', import.meta.url), 'utf8'));
  const arr = Array.isArray(verses) ? verses : verses.verses || Object.values(verses);
  const T = (s) => tokenize(String(s).replace(/[।॥\n]+/g, ' '));
  const echoes = [];
  let n = 0;
  for (const v of arr) {
    const lines = Array.isArray(v.deva) ? v.deva : [v.deva];
    const text = [(v.speaker && v.speaker.deva) || '', ...lines].join(' ').trim();
    if (!text) continue;
    n++;
    const toks = T(text);
    const out = findSelfCorrections(toks, toks);
    if (out.length) echoes.push(`${v.id}: ${out.map((o) => `${o.kind} ${o.word}`).join(' · ')}`);
  }
  assert.ok(n > 700, `the dataset is read (${n} slokas)`);
  assert.deepEqual(echoes, []);
});

test('self-corrections survive the words as Whisper writes them: compounds split, nasals changed', () => {
  const T = (s) => s.split(' ').map((w) => ({ word: w, norm: w }));
  const ref = T('ये त्वक्षरमनिर्देश्यमव्यक्तं पर्युपासते सर्वत्रगमचिन्त्यञ्च कूटस्थमचलन्ध्रुवम्');
  const refPada = [1, 1, 2, 3, 4];
  // the 16 October simulation: pāda 3 said twice, heard as "सर्वत्रगम चिंत्यम्चा" each time
  const again = findSelfCorrections(ref, T('येत्वक्षरम निर्देश्यम अव्यक्तं पर्युपासते सर्वत्रगम चिंत्यम्चा सर्वत्रगम चिंत्यम्चा कूटस्थम चलं थुवं'), { refPada });
  assert.deepEqual(again.map((c) => [c.kind, c.word, c.pada]), [['restart', 'सर्वत्रगमचिन्त्यञ्च', 3]], JSON.stringify(again));
  // a word said twice inside the compound's pāda: a repeat, named as heard
  const twice = findSelfCorrections(ref, T('येत्वक्षरम निर्देश्यम अव्यक्तं पर्युपासते सर्वत्रगम सर्वत्रगम चिंत्यम्चा कूटस्थम चलं थुवं'), { refPada });
  assert.deepEqual(twice.map((c) => [c.kind, c.word]), [['repeat', 'सर्वत्रगम']], JSON.stringify(twice));
  // an echo inside one word is the recogniser's, not a repeat ("…somāśarasomayā" for śrutau vistaraśo mayā)
  const refB = T('भवाप्ययौ हि भूतानां श्रुतौ विस्तरशो मया त्वत्तः कमलपत्राक्ष माहात्म्यमपि चाव्ययम्');
  assert.deepEqual(findSelfCorrections(refB, T('भवप्ययोहिभुतनं सुतवित्तरसोमाशरसोमया त्वत्तः कमलपत्राक्ष माहात्म्यमपि चाव्ययम्'), { refPada: [1, 1, 1, 2, 2, 2, 3, 3, 4, 4] }), []);
  // the clean recitation as Whisper writes it: nothing
  assert.deepEqual(findSelfCorrections(ref, T('येत्वक्षरम निर्देश्यम अव्यक्तं पर्युपासते सर्वत्रगम चिंत्यम्चा कूटस्थम चलं थुवं'), { refPada }), []);
  // the sloka started again from the top, split as Whisper splits it
  const top = findSelfCorrections(ref, T('येत्वक्षरम निर्देश्यम अव्यक्तं येत्वक्षरम निर्देश्यम अव्यक्तं पर्युपासते सर्वत्रगम चिंत्यम्चा कूटस्थम चलं थुवं'), { refPada });
  assert.deepEqual(top.map((c) => [c.kind, c.word, c.pada]), [['restart', 'ये', 1]], JSON.stringify(top));
});

test('the words move a boundary between two stretches: a later stretch that begins with the earlier sloka\'s tail', () => {
  // the 16 October three-sloka take: the ear closed 11.1 early, so the second stretch began
  // with 11.1's last pāda ("moho 'yaṃ vigato mama") and then 11.2
  const ref11_1 = tokenize('अर्जुन उवाच मदनुग्रहाय परमं गुह्यमध्यात्मसंज्ञितम् यत्त्वयोक्तं वचस्तेन मोहोऽयं विगतो मम');
  const ref11_2 = tokenize('भवाप्ययौ हि भूतानां श्रुतौ विस्तरशो मया त्वत्तः कमलपत्राक्ष माहात्म्यमपि चाव्ययम्');
  const T = (chunks) => ({ text: chunks.map((c) => c.text).join(' '), chunks });
  const prevT = T([{ text: 'अर्जुन उवाच मदनुग्रहाय परमं गुह्यमध्यात्मसंज्ञितम्', start: 0.5, end: 7 }, { text: 'यत्त्वयोक्तं वचस्तेन', start: 7, end: 11.5 }]);
  const nextT = T([{ text: 'मोहोयं विगतोमं भवप्ययोहिभुतनं', start: 12.0, end: 18.0 }, { text: 'श्रुतविस्तरसोमया त्वत्तः कमलपत्राक्ष माहात्म्यमपि चाव्ययम्', start: 18, end: 25 }]);
  const take = 50;
  const prev = { toks: tokenizeTranscript(prevT), moments: tokenMoments(prevT, take), ref: ref11_1 };
  const next = { toks: tokenizeTranscript(nextT), moments: tokenMoments(nextT, take), ref: ref11_2 };
  const b = refineBoundary(prev, next);
  // the first chunk holds three tokens over 6 s: "moho yaṃ" at 13, "vigato mama" at 15, "bhavāpyayau…" at 17 → the boundary just before 17
  assert.ok(b != null && b > 16 && b < 17.1, `boundary ${b}`);
  // nothing to move when the later stretch begins with its own sloka
  const clean = { toks: tokenizeTranscript(T([{ text: 'भवप्ययोहिभुतनं श्रुतविस्तरसोमया', start: 13, end: 19 }])), moments: tokenMoments(T([{ text: 'भवप्ययोहिभुतनं श्रुतविस्तरसोमया', start: 13, end: 19 }]), take), ref: ref11_2 };
  assert.equal(refineBoundary(prev, clean), null);
  // the earlier stretch that ends with the later sloka's head moves the boundary back to where that head begins
  const late = T([{ text: 'यत्त्वयोक्तं वचस्तेन मोहोयं विगतोमं', start: 7, end: 12 }, { text: 'भवप्ययोहिभुतनं श्रुतविस्तरसोमया', start: 12, end: 16 }]);
  const prevLate = { toks: tokenizeTranscript(late), moments: tokenMoments(late, take), ref: ref11_1 };
  const nextLate = { toks: tokenizeTranscript(T([{ text: 'त्वत्तः कमलपत्राक्ष माहात्म्यमपि चाव्ययम्', start: 16.5, end: 22 }])), moments: tokenMoments(T([{ text: 'त्वत्तः कमलपत्राक्ष माहात्म्यमपि चाव्ययम्', start: 16.5, end: 22 }]), take), ref: ref11_2 };
  const b2 = refineBoundary(prevLate, nextLate);
  assert.ok(b2 != null && b2 > 11.5 && b2 < 13.2, `boundary back to the head of 11.2: ${b2}`);
});

test('neighbour edges: the previous sloka\'s ending at the head of a window, the next one\'s opening at its tail, are theirs', () => {
  const T = (s) => s.split(' ').map((w) => ({ word: w, norm: w }));
  // 18.4's window began inside 18.3 (…tyājyam iti cāpare) on 1 November 2026: its last words were heard as 18.4's first
  const prevEnding = T('कर्म न त्याज्यमिति चापरे').slice(-4);
  const nextOpening = T('श्रीभगवानुवाच काम्यानां कर्मणां न्यासं').slice(0, 8);
  const heard = T('मिति चापरे निश्चयं शृणु मे तत्र त्यागे भरतसत्तम त्यागो हि पुरुषव्याघ्र त्रिविधः सम्प्रकीर्तितः श्रीभगवानुवाच काम्यानां');
  const unmatched = heard.map((_, i) => i < 2 || i >= heard.length - 2);
  assert.deepEqual(neighbourEdges(heard, unmatched, { prevEnding, nextOpening }), { lead: 2, trail: 2 });
  // a word the learner added at the head that is not the neighbour's stays
  const heard2 = T('ओम् निश्चयं शृणु मे तत्र त्यागे');
  assert.deepEqual(neighbourEdges(heard2, heard2.map((_, i) => i === 0), { prevEnding, nextOpening }), { lead: 0, trail: 0 });
  // the neighbour's tail followed by an addition of the learner's: only the tail is theirs
  const heard3 = T('चापरे ओम् निश्चयं शृणु मे तत्र त्यागे');
  assert.deepEqual(neighbourEdges(heard3, heard3.map((_, i) => i < 2), { prevEnding, nextOpening }), { lead: 1, trail: 0 });
  // nothing unmatched at the edges, or no neighbours: nothing to leave out
  assert.deepEqual(neighbourEdges(heard, heard.map(() => false), { prevEnding, nextOpening }), { lead: 0, trail: 0 });
  assert.deepEqual(neighbourEdges(heard, unmatched, {}), { lead: 0, trail: 0 });
});

test('looped hearing: the recogniser\'s loop is not the sloka, a pāda said again is', () => {
  const T = (s) => s.split(' ').map((w) => ({ word: w, norm: w }));
  const ref = T('निश्चयं शृणु मे तत्र त्यागे भरतसत्तम त्यागो हि पुरुषव्याघ्र त्रिविधः सम्प्रकीर्तितः');
  // as the recogniser wrote 18.4 on 1 November 2026: 100 akṣaras for a sloka of 32
  const loop = T('निच्चयम्षुनुमे थत्रा थ्यागे भरतसत्तमा थ्यागो हिपुरुषव्याग्व्णा त्रिविधस्व्णुमे थ्यागो हिपुरुषव्याग्व्णुमे थ्यागो हिपुरुषव्याग्व्णुमे थ्याग्व्णुमे थ्याग्व्णुमे थ्याग्व्णुमे हिपुरुषव्याग्व्णुमे थ्यागो हिपुरुषव्याग्व्णुमे थ्यागो हिपुरुषव्याग्व्णुमे थ्याग्व्णुमे थ्याग्व्णुमे थ्याग्व्णुमे');
  assert.equal(loopedHearing(ref, loop), true);
  assert.equal(loopedHearing(ref, ref), false);
  // a pāda said twice, even thrice: the learner, not the loop (not 1.6 times the sloka)
  assert.equal(loopedHearing(ref, T('निश्चयं शृणु मे तत्र निश्चयं शृणु मे तत्र त्यागे भरतसत्तम त्यागो हि पुरुषव्याघ्र त्रिविधः सम्प्रकीर्तितः')), false);
  assert.equal(loopedHearing(ref, T('निश्चयं शृणु मे तत्र निश्चयं शृणु मे तत्र निश्चयं शृणु मे तत्र त्यागे भरतसत्तम त्यागो हि पुरुषव्याघ्र त्रिविधः सम्प्रकीर्तितः')), false);
  // a long hearing of other material (the neighbours' words) without a loop is not a loop either
  assert.equal(loopedHearing(ref, T('काम्यानां कर्मणां न्यासं संन्यासं कवयो विदुः सर्वकर्मफलत्यागं प्राहुस्त्यागं विचक्षणाः निश्चयं शृणु मे तत्र त्यागे भरतसत्तम त्यागो हि पुरुषव्याघ्र त्रिविधः सम्प्रकीर्तितः त्याज्यं दोषवदित्येके कर्म प्राहुर्मनीषिणः यज्ञदानतपःकर्म न त्याज्यमिति चापरे')), false);
});

test('self-corrections: a short echo across the words with the recogniser\'s drift is not a repeat; a short word said twice is', () => {
  const T = (s) => s.split(' ').map((w) => ({ word: w, norm: w }));
  const ref = T('अर्जुन उवाच संन्यासस्य महाबाहो तत्त्वमिच्छामि वेदितुम् त्यागस्य च हृषीकेश पृथक्केशिनिषूदन');
  // 18.1 as the recogniser heard it on 1 November 2026, the next sloka's speaker line at the tail: a-sany / a-sasy
  const heard = T('अर्चुन उवाच्छ सन्या सस्यमहाबाह तत्व विच्चमिच्चामि वेदितुम् त्यागस्यचहृषीकेषः प्रुतक्चेषिनिशूधना रई भगवानुवाच्च');
  assert.deepEqual(findSelfCorrections(ref, heard, { nextOpening: T('श्रीभगवानुवाच काम्यानां कर्मणां न्यासं') }), []);
  assert.deepEqual(findSelfCorrections(ref, heard), []);
  // a short word said twice at a word's start, to the sound, is still a repeat
  assert.deepEqual(findSelfCorrections(ref, T('अर्जुन उवाच संन्यासस्य महाबाहो तत्त्वमिच्छामि वेदितुम् त्यागस्य त्यागस्य च हृषीकेश पृथक्केशिनिषूदन')).map((c) => c.kind), ['repeat']);
});

test('looped hearing: more akṣaras than the counter heard sung, a run said twice, is the loop; a half-line said again is not', () => {
  const T = (s) => s.split(' ').map((w) => ({ word: w, norm: w }));
  const ref = T('श्रीभगवानुवाच काम्यानां कर्मणां न्यासं संन्यासं कवयो विदुः सर्वकर्मफलत्यागं प्राहुस्त्यागं विचक्षणाः');
  // 18.2's hearing of 1 November 2026: 57 akṣaras where the counter heard 40 sung
  const loop = T('प्राहुर्मनीशिनहा प्राहुस्त्यागाँ विचक्षणाह त्याज्यम् दोषविधिके कर्म प्राहुर्मनीशिनहा प्राहुस्त्यागाँ विचक्षणाह त्याज्यम् दोषविधित्ये के कर्म प्राहुर्मनीशिनहा');
  assert.equal(loopedHearing(ref, loop, { heardAksharas: 57, sungAksharas: 40 }), true);
  assert.equal(loopedHearing(ref, loop, { heardAksharas: 57, sungAksharas: 55 }), false, 'as much sung as heard: the learner said it twice');
  assert.equal(loopedHearing(ref, loop), false, 'without the counter\'s word, under 1.6 times the sloka, no loop is claimed');
  // the learner starting the second line again: as much sung as heard
  const again = T('श्रीभगवानुवाच काम्यानां कर्मणां न्यासं संन्यासं कवयो विदुः सर्वकर्मफलत्यागं सर्वकर्मफलत्यागं प्राहुस्त्यागं विचक्षणाः');
  assert.equal(loopedHearing(ref, again, { heardAksharas: 47, sungAksharas: 46 }), false);
});
