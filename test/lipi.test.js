import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDeva, inScript, segments, wordSegments, weightMark, LAGHU, GURU, anusvaraForm } from '../js/lipi.js';
import { syllabify } from '../js/phon.js';

test('akṣaras remember the characters they were read from', () => {
  const a = syllabify('कर्मण्येवाधिकारस्ते');
  assert.deepEqual(a.map((x) => x.src), ['क', 'र्म', 'ण्ये', 'वा', 'धि', 'का', 'र', 'स्ते']);
  assert.equal(a.map((x) => x.src).join(''), 'कर्मण्येवाधिकारस्ते');
  assert.deepEqual(syllabify('जगत्').map((x) => x.src), ['ज', 'गत्'], 'a final consonant closes the last akṣara');
  assert.deepEqual(syllabify('सङ्गं').map((x) => x.src), ['सङ्', 'गं'], 'a nasal before a stop of its place is the anusvāra of the akṣara before');
  assert.deepEqual(syllabify('तेऽपि').map((x) => x.src), ['तेऽ', 'पि'], 'an avagraha stays with the akṣara before');
  assert.deepEqual(syllabify('ॐ नमः').map((x) => x.src), ['ॐ', 'न', 'मः']);
  assert.deepEqual(syllabify('ಕರ್ಮಣ್ಯೇವಾಧಿಕಾರಸ್ತೇ').map((x) => x.src), ['ಕ', 'ರ್ಮ', 'ಣ್ಯೇ', 'ವಾ', 'ಧಿ', 'ಕಾ', 'ರ', 'ಸ್ತೇ'], 'Kannada reads the same way');
});

test('Sanskrit written in Kannada, Telugu and IAST', () => {
  assert.equal(inScript('कर्मण्येवाधिकारस्ते मा फलेषु कदाचन ।', 'kannada'), 'ಕರ್ಮಣ್ಯೇವಾಧಿಕಾರಸ್ತೇ ಮಾ ಫಲೇಷು ಕದಾಚನ ।');
  assert.equal(inScript('अर्जुन उवाच', 'telugu'), 'అర్జున ఉవాచ');
  assert.equal(inScript('येत्वक्षरम् निर्देश्यम् अव्यक्तं पर्युपासते ।', 'english'), 'yetvakṣaram nirdeśyam avyaktaṃ paryupāsate ।');
  assert.equal(inScript('धर्मक्षेत्रे कुरुक्षेत्रे', 'english'), 'dharmakṣetre kurukṣetre');
  assert.equal(inScript('ॐ नमः शिवाय', 'english'), 'oṃ namaḥ śivāya');
  assert.equal(inScript('ॐ नमः', 'kannada'), 'ಓಂ ನಮಃ');
  assert.equal(inScript('तेऽपि', 'english'), 'te’pi');
  assert.equal(inScript('जगत् १२', 'english'), 'jagat 12');
  assert.equal(inScript('कर्मण्येवाधिकारस्ते', 'sanskrit'), 'कर्मण्येवाधिकारस्ते');
  assert.equal(inScript('ಕರ್ಮಣ್ಯೇವಾಧಿಕಾರಸ್ತೇ', 'telugu'), 'కర్మణ్యేవాధికారస్తే', 'typed in one script, shown in another');
});

test('toDeva: Kannada, Telugu and romanised text come back to Devanagari', () => {
  assert.equal(toDeva('ಕರ್ಮಣ್ಯೇವಾಧಿಕಾರಸ್ತೇ'), 'कर्मण्येवाधिकारस्ते');
  assert.equal(toDeva('అర్జున ఉవాచ'), 'अर्जुन उवाच');
  assert.equal(toDeva('arjuna uvāca'), 'अर्जुन उवाच');
  assert.equal(toDeva('कर्मण्येवाधिकारस्ते'), 'कर्मण्येवाधिकारस्ते');
});

test('laghu and guru above each akṣara in another script; Sanskrit bare unless asked', () => {
  const segs = segments('धर्मक्षेत्रे कुरुक्षेत्रे', 'english');
  assert.deepEqual(segs.filter((s) => s.sep == null).map((s) => `${s.text}${weightMark(s.weight)}`), ['dha—', 'rma—', 'kṣe—', 'tre—', 'ku◡', 'ru—', 'kṣe—', 'tre—']);
  assert.deepEqual(segs.filter((s) => s.sep != null).map((s) => s.sep), [' ']);
  const kn = segments('मा फलेषु', 'kannada');
  assert.deepEqual(kn.map((s) => (s.sep != null ? s.sep : [s.text, s.weight])), [['ಮಾ', 'G'], ' ', ['ಫ', 'L'], ['ಲೇ', 'G'], ['ಷು', 'L']]);
  assert.deepEqual(segments('मा फलेषु', 'sanskrit'), [{ sep: 'मा फलेषु' }]);
  assert.deepEqual(segments('मा फलेषु', 'sanskrit', { marks: true }).map((s) => (s.sep != null ? s.sep : [s.text, s.weight])), [['मा', 'G'], ' ', ['फ', 'L'], ['ले', 'G'], ['षु', 'L']]);
  assert.deepEqual(segments('', 'kannada'), []);
});

test('the words of a transcript, each in the script, the weights read across the words', () => {
  const w = wordSegments(['ये', 'त्वक्षरम्'], 'english');
  assert.deepEqual(w.map((segs) => segs.map((s) => `${s.text}${weightMark(s.weight)}`)), [['ye—'], ['tva—', 'kṣa◡', 'ram—']]);
  assert.deepEqual(wordSegments(['नमः', 'शिवाय'], 'telugu').map((segs) => segs.map((s) => s.text)), [['న', 'మః'], ['శి', 'వా', 'య']]);
  assert.deepEqual(wordSegments(['मा', 'फलेषु'], 'sanskrit').map((segs) => segs.map((s) => [s.text, s.weight])), [[['मा', null]], [['फलेषु', null]]], 'Sanskrit: the word, bare');
  assert.equal(weightMark('L'), LAGHU);
  assert.equal(weightMark('G'), GURU);
  assert.equal(weightMark(null), '');
});

test('the visarga is ḥ in romanised text and the visarga sign in Kannada and Telugu', () => {
  assert.equal(inScript('नमः शिवाय', 'english'), 'namaḥ śivāya');
  assert.equal(inScript('नमः शिवाय', 'kannada'), 'ನಮಃ ಶಿವಾಯ');
  assert.equal(inScript('नमः शिवाय', 'telugu'), 'నమః శివాయ');
  assert.equal(inScript('दुःखम्', 'english'), 'duḥkham');
  assert.equal(inScript('दुःखम्', 'kannada'), 'ದುಃಖಮ್');
  assert.equal(inScript('दुःखम्', 'telugu'), 'దుఃఖమ్');
  assert.deepEqual(segments('नमः', 'telugu').map((x) => x.text), ['న', 'మః'], 'the sign stays with its akṣara');
});

test('the anusvāra is the circle in Kannada and Telugu and ṃ in romanised text, a class nasal before a stop included', () => {
  assert.equal(inScript('संगं', 'kannada'), 'ಸಂಗಂ');
  assert.equal(inScript('संगं', 'telugu'), 'సంగం');
  assert.equal(inScript('संगं', 'english'), 'saṃgaṃ');
  // what a transcription (or a text) writes as a class nasal reads as the anusvāra too
  assert.equal(inScript('सङ्गं', 'kannada'), 'ಸಂಗಂ');
  assert.equal(inScript('सङ्गं', 'telugu'), 'సంగం');
  assert.equal(inScript('सङ्गं', 'english'), 'saṃgaṃ');
  assert.equal(inScript('चिन्त्यं सञ्जय', 'kannada'), 'ಚಿಂತ್ಯಂ ಸಂಜಯ');
  assert.equal(inScript('चिन्त्यं सञ्जय', 'telugu'), 'చింత్యం సంజయ');
  assert.equal(inScript('चिन्त्यं सञ्जय', 'english'), 'ciṃtyaṃ saṃjaya');
  assert.equal(inScript('पाण्डवाः कम्पते', 'kannada'), 'ಪಾಂಡವಾಃ ಕಂಪತೇ');
  assert.equal(inScript('सङ्गं चिन्त्यं', 'sanskrit'), 'सङ्गं चिन्त्यं', 'Sanskrit is shown as written');
  assert.deepEqual(segments('सङ्गं', 'kannada').map((x) => [x.text, x.weight]), [['ಸಂ', 'G'], ['ಗಂ', 'G']]);
  assert.deepEqual(segments('सङ्गं', 'english').map((x) => x.text), ['saṃ', 'gaṃ']);
  assert.equal(anusvaraForm('न्य नम ङ्ग'), 'न्य नम ंग', 'only a nasal before a stop of its place');
});
