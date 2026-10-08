import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latinToScript, mostlyLatin, transliterateTranscript } from '../js/translit.js';

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
