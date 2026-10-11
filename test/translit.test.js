import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { latinToScript, mostlyLatin, transliterateTranscript, scriptToLatin } from '../js/translit.js';

test('romanised Sanskrit becomes Kannada script, as a learner would write it', () => {
  assert.equal(latinToScript('Arjuna uvāca evam satata yukta ye bhaktāstvām paryupāsate', 'Knda'), 'ಅರ್ಜುನ ಉವಾಚ ಏವಂ ಸತತ ಯುಕ್ತ ಯೇ ಭಕ್ತಾಸ್ತ್ವಾಂ ಪರ್ಯುಪಾಸತೇ');
  assert.equal(latinToScript('yeja apyaksharam avyaktam deshām ke yogavittamah', 'Knda'), 'ಯೇಜ ಅಪ್ಯಕ್ಷರಂ ಅವ್ಯಕ್ತಂ ದೇಶಾಂ ಕೇ ಯೋಗವಿತ್ತಮಃ');
  assert.equal(latinToScript('karmaṇyevādhikāraste mā phaleṣu kadācana', 'Knda'), 'ಕರ್ಮಣ್ಯೇವಾಧಿಕಾರಸ್ತೇ ಮಾ ಫಲೇಷು ಕದಾಚನ');
  assert.equal(latinToScript('om namah shivāya', 'Knda'), 'ಓಂ ನಮಃ ಶಿವಾಯ');
  assert.equal(latinToScript('om namah shivaya', 'Knda'), 'ಓಂ ನಮಃ ಶಿವಯ', 'no macron, no long vowel');
  assert.equal(latinToScript('jñānam', 'Knda'), 'ಜ್ಞಾನಂ');
  assert.equal(latinToScript('sangam chintyam', 'Knda'), 'ಸಙ್ಗಂ ಚಿನ್ತ್ಯಂ');
});

test('the same words in Devanagari and Telugu', () => {
  assert.equal(latinToScript('karmaṇyevādhikāraste mā phaleṣu kadācana', 'Deva'), 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन');
  assert.equal(latinToScript('arjuna uvāca', 'Deva'), 'अर्जुन उवाच');
  assert.equal(latinToScript('yogavittamah', 'Deva'), 'योगवित्तमः');
  assert.equal(latinToScript('arjuna uvāca evam', 'Telu'), 'అర్జున ఉవాచ ఏవం');
  assert.equal(latinToScript('jagat', 'Deva'), 'जगत्', 'a final consonant carries a virama');
});

test('punctuation, digits and text already in the script pass through; unknown scripts untouched', () => {
  assert.equal(latinToScript('ಓಂ namah, shivāya 108!', 'Knda'), 'ಓಂ ನಮಃ, ಶಿವಾಯ 108!');
  assert.equal(latinToScript('hello', 'Latn'), 'hello');
  assert.equal(mostlyLatin('Arjuna uvāca evam'), true);
  assert.equal(mostlyLatin('ಅರ್ಜುನ ಉವಾಚ (Arjuna)'), false);
  assert.equal(mostlyLatin('[Music]'), true);
  assert.equal(mostlyLatin(''), false);
});

test('a Kannada transcript answered in Latin letters is rewritten; Devanagari Sanskrit and English are left alone', () => {
  const kn = { language: 'kannada', text: 'Arjuna uvāca evam', chunks: [{ text: 'Arjuna uvāca', start: 0, end: 2 }, { text: 'evam', start: 2, end: 3 }], tier: 'best' };
  const out = transliterateTranscript(kn);
  assert.equal(out.text, 'ಅರ್ಜುನ ಉವಾಚ ಏವಂ');
  assert.deepEqual(out.chunks.map((c) => c.text), ['ಅರ್ಜುನ ಉವಾಚ', 'ಏವಂ']);
  assert.equal(out.latin, 'Arjuna uvāca evam');
  assert.equal(out.transliterated, 'Knda');
  assert.equal(out.chunks[0].start, 0);
  const sa = { language: 'sanskrit', text: 'अर्जुन उवाच', chunks: [] };
  assert.equal(transliterateTranscript(sa), sa);
  const en = { language: 'english', text: 'Arjuna said', chunks: [] };
  assert.equal(transliterateTranscript(en), en);
  assert.equal(transliterateTranscript(null), null);
});

test('scriptToLatin writes Devanagari letter by letter as IAST, and the exact reading brings it back', () => {
  assert.equal(scriptToLatin('सङ्गोऽस्त्वकर्मणि ॥'), 'saṅgo’stvakarmaṇi ॥');
  assert.equal(scriptToLatin('ॐ नमः शिवाय'), 'oṃ namaḥ śivāya');
  assert.equal(scriptToLatin('जगत् १२'), 'jagat 12');
  assert.equal(scriptToLatin('इच्छामि मन्यते'), 'icchāmi manyate');
  assert.equal(scriptToLatin('ಕರ್ಮಣ್ಯೇವಾಧಿಕಾರಸ್ತೇ'), 'karmaṇyevādhikāraste', 'Kannada reads the same way');
  const exact = (t) => latinToScript(t, 'Deva', { reading: 'exact' });
  for (const line of ['सङ्गोऽस्त्वकर्मणि ॥', 'ॐ नमः शिवाय', 'ॐतत्सदिति', 'इच्छामि मन्यते', 'येत्वक्षरम् निर्देश्यम्', 'धनञ्जयः', 'वीर्यवान् ।', 'श्रद्धावाँल्लभते']) assert.equal(exact(scriptToLatin(line)), line);
  assert.equal(exact(scriptToLatin('जगत् १२')), 'जगत् 12', 'digits come back as digits, in ASCII');
  // the plain-letter reading keeps meaning "ch" as च and a final m as anusvāra; the exact one does not
  assert.equal(latinToScript('chintyam', 'Deva'), 'चिन्त्यं');
  assert.equal(exact('cintyam'), 'चिन्त्यम्');
  assert.equal(exact('chintyam'), 'छिन्त्यम्');
  assert.equal(exact('manyate'), 'मन्यते');
  assert.equal(exact('aa ii sh'), 'आ ई श्');
});

test('every line of the Gītā dataset survives the round trip through IAST', () => {
  const d = JSON.parse(fs.readFileSync(new URL('../reference/gita/verses.json', import.meta.url), 'utf8'));
  const bad = [];
  for (const v of d.verses) {
    const lines = [...(v.speaker && v.speaker.deva ? [v.speaker.deva] : []), ...v.deva];
    for (const line of lines) if (latinToScript(scriptToLatin(line), 'Deva', { reading: 'exact' }) !== line) bad.push(`${v.id}: ${line}`);
  }
  assert.deepEqual(bad, []);
});
