import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syllabify, aksharaText, consonantMatch, compareAksharas, comparePhonology } from '../js/phon.js';

const BG_2_47 = 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन । मा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि ॥';

test('syllabify: akṣaras of a Gītā verse, with clusters, vowel signs, anusvāra and visarga', () => {
  const a = syllabify('कर्मण्येवाधिकारस्ते');
  assert.deepEqual(a.map(aksharaText), ['ka', 'rma', 'ṇye', 'vā', 'dhi', 'kā', 'ra', 'ste']);
  assert.deepEqual(syllabify('सर्वधर्मान्परित्यज्य').map(aksharaText), ['sa', 'rva', 'dha', 'rmā', 'npa', 'ri', 'tya', 'jya']);
  assert.deepEqual(syllabify('मामेकं शरणं व्रज').map(aksharaText), ['mā', 'me', 'kaṃ', 'śa', 'ra', 'ṇaṃ', 'vra', 'ja']);
  assert.deepEqual(syllabify('नमः').map(aksharaText), ['na', 'maḥ']);
  assert.deepEqual(syllabify('जगत्').map(aksharaText), ['ja', 'gat'], 'a final virama consonant closes the last akṣara');
  assert.deepEqual(syllabify('ॐ').map(aksharaText), ['oṃ']);
  assert.equal(syllabify(BG_2_47).length, 32, 'anuṣṭubh: 32 akṣaras');
  // Kannada and Telugu share the layout; romanised text is read as IAST
  assert.deepEqual(syllabify('ಕರ್ಮಣ್ಯೇವಾಧಿಕಾರಸ್ತೇ').map(aksharaText), ['ka', 'rma', 'ṇye', 'vā', 'dhi', 'kā', 'ra', 'ste']);
  assert.deepEqual(syllabify('అర్జున ఉవాచ').map(aksharaText), ['a', 'rju', 'na', 'u', 'vā', 'ca']);
  assert.deepEqual(syllabify('karmaṇyevādhikāraste').map(aksharaText), ['ka', 'rma', 'ṇye', 'vā', 'dhi', 'kā', 'ra', 'ste']);
  assert.deepEqual(syllabify('').length, 0);
});

test('consonants: one feature apart earns half credit and names the feature', () => {
  const c = (text) => syllabify(text)[0].onset[0];
  assert.deepEqual(consonantMatch(c('क'), c('ख')), { credit: 0.5, error: 'aspiration' });
  assert.deepEqual(consonantMatch(c('क'), c('ग')), { credit: 0.5, error: 'voicing' });
  assert.deepEqual(consonantMatch(c('त'), c('ट')), { credit: 0.5, error: 'place' });
  assert.deepEqual(consonantMatch(c('स'), c('श')), { credit: 0.5, error: 'place' });
  assert.deepEqual(consonantMatch(c('न'), c('ण')), { credit: 0.5, error: 'place' });
  assert.deepEqual(consonantMatch(c('द'), c('न')), { credit: 0.5, error: 'nasality' });
  assert.deepEqual(consonantMatch(c('क'), c('प')), { credit: 0.5, error: 'place' });
  assert.deepEqual(consonantMatch(c('क'), c('म')), { credit: 0, error: 'other' });
  assert.deepEqual(consonantMatch(c('क'), c('क')), { credit: 1, error: null });
});

test('an akṣara pair: vowel length is a separate matter from the sounds', () => {
  const one = (t) => syllabify(t)[0];
  const same = compareAksharas(one('का'), one('का'));
  assert.equal(same.credit, 1);
  assert.equal(same.vowelLength, true);
  const short = compareAksharas(one('का'), one('क'));
  assert.equal(short.credit, 1, 'the sounds are right');
  assert.equal(short.vowelLength, false, 'the length is not');
  assert.equal(short.errors[0].kind, 'vowelLength');
  const asp = compareAksharas(one('धि'), one('दि'));
  assert.equal(asp.errors[0].kind, 'aspiration');
  assert.ok(asp.credit < 1 && asp.credit > 0.5);
  const vis = compareAksharas(one('मः'), one('म'));
  assert.equal(vis.errors[0].kind, 'visarga');
  const gem = compareAksharas(one('त्त'), one('त'));
  assert.ok(gem.errors.some((e) => e.kind === 'length'));
});

test('comparePhonology: a perfect recitation, then slips of each kind', () => {
  const ref = 'सर्वधर्मान्परित्यज्य मामेकं शरणं व्रज';
  const perfect = comparePhonology(ref, ref);
  assert.deepEqual([perfect.syllables, perfect.phonemes, perfect.vowels], [100, 100, 100]);
  assert.equal(perfect.counts.ref, 16);
  // a short vowel for a long one, twice: the sounds stay right, the vowel length does not
  const shortened = comparePhonology(ref, 'सर्वधर्मान्परित्यज्य ममेकं शरणं व्रज');
  assert.equal(shortened.syllables, 100);
  assert.equal(shortened.phonemes, 100);
  assert.ok(shortened.vowels < 100 && shortened.vowels >= 90, `vowels ${shortened.vowels}`);
  assert.equal(shortened.errors.vowelLength, 1);
  // dental for retroflex, unaspirated for aspirated: phoneme slips, named
  const slips = comparePhonology(ref, 'सर्वदर्मान्परित्यज्य मामेकं शरनं व्रज');
  assert.equal(slips.syllables, 100);
  assert.ok(slips.phonemes < 100 && slips.phonemes > 85, `phonemes ${slips.phonemes}`);
  assert.equal(slips.errors.aspiration, 1);
  assert.equal(slips.errors.place, 1);
  assert.ok(slips.examples.some((e) => e.kind === 'place' && e.ref === 'ṇaṃ' && e.heard === 'naṃ'), JSON.stringify(slips.examples));
  // a word skipped: syllables missing
  const skipped = comparePhonology(ref, 'सर्वधर्मान्परित्यज्य शरणं व्रज');
  assert.equal(skipped.counts.missing, 3);
  assert.ok(skipped.syllables <= 82 && skipped.syllables >= 80, `syllables ${skipped.syllables}`);
  assert.equal(skipped.phonemes, 100, 'what was recited was recited right');
  // a different verse altogether scores low on syllables
  const other = comparePhonology(ref, 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन');
  assert.ok(other.syllables < 70, `syllables ${other.syllables}`);
  assert.ok(other.phonemes < 85, `phonemes ${other.phonemes}`);
  assert.equal(comparePhonology('', 'x'), null);
});

test('comparePhonology reads romanised and Kannada hearings against Devanagari text', () => {
  const ref = 'अर्जुन उवाच एवं सततयुक्ता ये भक्तास्त्वां पर्युपासते';
  const kn = comparePhonology(ref, 'ಅರ್ಜುನ ಉವಾಚ ಏವಂ ಸತತಯುಕ್ತಾ ಯೇ ಭಕ್ತಾಸ್ತ್ವಾಂ ಪರ್ಯುಪಾಸತೇ');
  assert.deepEqual([kn.syllables, kn.phonemes, kn.vowels], [100, 100, 100]);
  const lat = comparePhonology(ref, 'arjuna uvāca evaṃ satatayuktā ye bhaktāstvāṃ paryupāsate');
  assert.deepEqual([lat.syllables, lat.phonemes, lat.vowels], [100, 100, 100]);
  // Whisper's usual romanisation, without macrons: the sounds right, the lengths "wrong"
  const plain = comparePhonology(ref, 'arjuna uvacha evam satatayukta ye bhaktastvam paryupasate');
  assert.equal(plain.phonemes, 100);
  assert.ok(plain.vowels < 80, `vowels ${plain.vowels}`);
});
