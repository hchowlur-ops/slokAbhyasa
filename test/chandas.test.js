import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syllabify, comparePhonology } from '../js/phon.js';
import { withDandas } from '../js/textdiff.js';
import { gitaVerse, gitaFamily, syllableWeights, identifyChandas, padaBreaks, layoutSloka, linesFor, chandasLabel, chandasForRecord, INDRAVAJRA, UPENDRAVAJRA } from '../js/chandas.js';

// 18.66 (anuṣṭubh) and 2.5 (upajāti), as printed
const V18_66 = 'सर्वधर्मान्परित्यज्य मामेकं शरणं व्रज । अहं त्वा सर्वपापेभ्यो मोक्षयिष्यामि मा शुचः ॥';
const V12_1 = 'एवं सततयुक्ता ये भक्तास्त्वां पर्युपासते । ये चाप्यक्षरमव्यक्तं तेषां के योगवित्तमाः ॥';
const V2_5 = 'गुरूनहत्वा हि महानुभावान् श्रेयो भोक्तुं भैक्ष्यमपीह लोके । हत्वार्थकामांस्तु गुरूनिहैव भुञ्जीय भोगान् रुधिरप्रदिग्धान् ॥';
const V11_15 = 'पश्यामि देवांस्तव देव देहे सर्वांस्तथा भूतविशेषसङ्घान् । ब्रह्माणमीशं कमलासनस्थमृषींश्च सर्वानुरगांश्च दिव्यान् ॥';

test('a sloka name names a Gītā verse, and the table says its family', () => {
  assert.deepEqual(gitaVerse('CH12-04'), { chapter: 12, verse: 4 });
  assert.deepEqual(gitaVerse('ch12-7'), { chapter: 12, verse: 7 });
  assert.deepEqual(gitaVerse('Gita 18-66'), { chapter: 18, verse: 66 });
  assert.equal(gitaVerse('ch12-Closing'), null);
  assert.equal(gitaVerse('CH12-99'), null, 'chapter 12 has 20 verses');
  assert.equal(gitaVerse('2024-10'), null);
  assert.equal(gitaFamily(12, 4), 'anushtubh');
  for (const [c, v] of [[2, 5], [2, 8], [2, 20], [2, 70], [8, 9], [8, 11], [8, 28], [9, 21], [11, 15], [11, 50], [15, 2], [15, 15]]) assert.equal(gitaFamily(c, v), 'trishtubh', `${c}.${v}`);
  for (const [c, v] of [[2, 4], [2, 9], [2, 21], [8, 12], [11, 14], [11, 51], [15, 6], [18, 66]]) assert.equal(gitaFamily(c, v), 'anushtubh', `${c}.${v}`);
});

test('laghu and guru: long vowels, marks, codas and clusters make a syllable heavy', () => {
  const w = (t) => syllableWeights(syllabify(t)).join('');
  assert.equal(w('कमल'), 'LLL');
  assert.equal(w('रामा'), 'GG');
  assert.equal(w('कर्म'), 'GL', 'the cluster rm closes ka');
  assert.equal(w('शरणं'), 'LLG', 'anusvāra');
  assert.equal(w('नमः'), 'LG', 'visarga');
  assert.equal(w('ध्रुवम्'), 'LG', 'a closing consonant');
  assert.equal(w('गुरूनहत्वा'), 'LGLGG');
});

test('identifyChandas: anuṣṭubh by count and cadence, the triṣṭubh family by pattern', () => {
  const a = identifyChandas(V18_66);
  assert.equal(a.family, 'anushtubh');
  assert.equal(a.syllables, 32);
  assert.equal(a.exact, true);
  assert.equal(a.perPada, 8);
  assert.ok(['pathyā', 'vipulā'].includes(a.form), a.form);
  const b = identifyChandas(V12_1);
  assert.deepEqual([b.family, b.syllables, b.form], ['anushtubh', 32, 'pathyā']);
  const u = identifyChandas(V2_5);
  assert.equal(u.family, 'trishtubh');
  assert.equal(u.syllables, 44);
  assert.equal(u.perPada, 11);
  assert.equal(u.name, 'Upajāti', `${u.form} ${u.padaWeights.join(' ')}`);
  assert.match(u.form, /^[IU]{4}$/);
  const d = identifyChandas(V11_15, { expected: 'trishtubh' });
  assert.equal(d.syllables, 44);
  assert.ok(d.confidence >= 0.75, `${d.form} ${d.padaWeights.join(' ')}`);
  // a transcript a syllable short still reads as anuṣṭubh, inexactly
  const short = identifyChandas('सर्वधर्मान्परित्यज्य मामेकं शरणं व्रज अहं त्वा सर्वपापेभ्यो मोक्षयिष्यामि शुचः');
  assert.deepEqual([short.family, short.syllables, short.exact, short.form], ['anushtubh', 31, false, null]);
  // the table decides when the count is ambiguous or off
  assert.equal(identifyChandas('ॐ', { expected: 'trishtubh' }).perPada, 11);
  assert.equal(identifyChandas('').family, null);
  assert.equal(INDRAVAJRA.slice(1), UPENDRAVAJRA.slice(1));
});

test('padaBreaks and layoutSloka: lines at the word boundaries nearest the pāda counts', () => {
  const words = V18_66.replace(/[।॥]/g, '').trim().split(/\s+/);
  assert.deepEqual(padaBreaks(words, 8, 2), [3], 'the half-verse ends after व्रज');
  assert.deepEqual(padaBreaks(words, 8, 4), [0, 3, 6]);
  assert.equal(layoutSloka(V18_66.replace(/[।॥]/g, ' ').replace(/\s+/g, ' ')), 'सर्वधर्मान्परित्यज्य मामेकं शरणं व्रज\nअहं त्वा सर्वपापेभ्यो मोक्षयिष्यामि मा शुचः');
  assert.equal(layoutSloka(V18_66.replace(/[।॥]/g, ' ').replace(/\s+/g, ' '), { lines: 4 }), 'सर्वधर्मान्परित्यज्य\nमामेकं शरणं व्रज\nअहं त्वा सर्वपापेभ्यो\nमोक्षयिष्यामि मा शुचः');
  // a transcript with Whisper's spacing breaks at the nearest boundary, never inside a word
  const w = 'येत्वक्षरम निर्देश्यम अव्यक्तं पर्युपासते सर्वत्रगम चिंत्यम्चा गूटस्थम चलं थुवं';
  assert.equal(layoutSloka(w, { perPada: 8 }), 'येत्वक्षरम निर्देश्यम अव्यक्तं पर्युपासते\nसर्वत्रगम चिंत्यम्चा गूटस्थम चलं थुवं');
  // text already in lines is left alone; one word cannot break; no metre, no break
  assert.equal(layoutSloka('a b\nc d'), 'a b\nc d');
  assert.equal(layoutSloka('सर्वधर्मान्परित्यज्य'), 'सर्वधर्मान्परित्यज्य');
  assert.deepEqual(padaBreaks(['क', 'ख'], null), []);
  const u = layoutSloka(V2_5.replace(/[।॥]/g, ' ').replace(/\s+/g, ' '), { perPada: 11, lines: 4 }).split('\n');
  assert.equal(u.length, 4);
  assert.deepEqual(u.map((l) => syllabify(l).length), [11, 11, 11, 11]);
  // the triṣṭubh family is always in four lines, whatever is preferred; an anuṣṭubh follows the preference
  assert.deepEqual([linesFor(11, 2), linesFor(11, 4), linesFor(8, 2), linesFor(8, 4), linesFor(null, 4)], [4, 4, 2, 4, 4]);
  assert.equal(layoutSloka(V2_5.replace(/[।॥]/g, ' ').replace(/\s+/g, ' '), { perPada: 11, lines: 2 }).split('\n').length, 4);
  assert.equal(layoutSloka(V18_66.replace(/[।॥]/g, ' ').replace(/\s+/g, ' '), { lines: 2 }).split('\n').length, 2);
  // the daṇḍas go by pādas: । after the second, ॥ after the fourth, in two lines or four
  assert.equal(withDandas(layoutSloka(V18_66.replace(/[।॥]/g, ' ').replace(/\s+/g, ' '), { lines: 4 })), 'सर्वधर्मान्परित्यज्य\nमामेकं शरणं व्रज ।\nअहं त्वा सर्वपापेभ्यो\nमोक्षयिष्यामि मा शुचः ॥');
});

test('labels and a record', () => {
  const a = identifyChandas(V12_1);
  assert.equal(chandasLabel(a), 'Anuṣṭubh · 4 pādas of 8 syllables (32) · pathyā');
  assert.match(chandasLabel(identifyChandas(V2_5)), /^Upajāti · 4 pādas of 11 syllables \(44\) · [IU] [IU] [IU] [IU]$/);
  assert.equal(chandasLabel(null), '');
  const rec = chandasForRecord({ name: 'CH12-01', meta: { text: { body: V12_1, origin: 'typed', language: 'sa' } }, store: null });
  assert.deepEqual([rec.family, rec.source, rec.exact, rec.verse], ['anushtubh', 'typed', true, { chapter: 12, verse: 1 }]);
  const fromTranscript = chandasForRecord({ name: 'CH2-05', meta: { text: null }, store: { current: 'kannada', languages: { sanskrit: { text: V2_5 }, kannada: { text: 'x' } } } });
  assert.deepEqual([fromTranscript.family, fromTranscript.source, fromTranscript.language, fromTranscript.name], ['trishtubh', 'transcript', 'sanskrit', 'Upajāti']);
  assert.equal(chandasForRecord({ name: 'x', meta: null, store: null }), null);
  // a Whisper transcript of a triṣṭubh verse that came out short is still read as triṣṭubh when the name says so
  const off = chandasForRecord({ name: 'CH11-15', meta: null, store: { current: 'sanskrit', languages: { sanskrit: { text: V11_15.split(' ').slice(0, 10).join(' ') } } } });
  assert.deepEqual([off.family, off.perPada, off.exact], ['trishtubh', 11, false]);
});

test('comparePhonology counts the syllables heard pāda by pāda', () => {
  const ref = V18_66.replace(/[।॥]/g, ' ');
  const dropped = 'सर्वधर्मान्परित्यज्य मामेकं शरणं व्रज अहं त्वा सर्वपापेभ्यो मोक्षयिष्यामि शुचः'; // मा dropped in pāda 4
  const c = comparePhonology(ref, dropped, { perPada: 8 });
  assert.equal(c.padas.length, 4);
  assert.deepEqual(c.padas.map((p) => p.ref), [8, 8, 8, 8]);
  assert.deepEqual(c.padas.map((p) => p.heard), [8, 8, 8, 7]);
  assert.equal(c.padas[3].missing, 1);
  // an extra syllable in the text beyond 32 stays in the fourth pāda; without a metre, no pādas
  const extra = comparePhonology(ref + ' ॐ', ref + ' ॐ', { perPada: 8 });
  assert.equal(extra.padas.length, 4);
  assert.equal(extra.padas[3].ref, 9);
  assert.equal(comparePhonology(ref, ref).padas, null);
});
