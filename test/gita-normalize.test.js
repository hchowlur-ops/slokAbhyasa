import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSlok, parseIast, speakerOf, applyOverrides, verseRecord, buildDataset, mergeEnglish } from '../tools/gita/normalize.mjs';
import { validateDataset } from '../js/verses.js';

const SRC_2_47 = { _id: 'BG2.47', chapter: 2, verse: 47, slok: 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन |\nमा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि ||२-४७||', transliteration: 'karmaṇyevādhikāraste mā phaleṣu kadācana .\nmā karmaphalaheturbhūrmā te saṅgo.astvakarmaṇi ||2-47||' };
const SRC_1_1 = { _id: 'BG1.1', chapter: 1, verse: 1, slok: 'धृतराष्ट्र उवाच |\nधर्मक्षेत्रे कुरुक्षेत्रे समवेता युयुत्सवः |\nमामकाः पाण्डवाश्चैव किमकुर्वत सञ्जय ||१-१||', transliteration: 'dhṛtarāṣṭra uvāca .\ndharmakṣetre kurukṣetre samavetā yuyutsavaḥ .\nmāmakāḥ pāṇḍavāścaiva kimakurvata sañjaya ||1-1||' };
const SRC_2_1 = { _id: 'BG2.1', chapter: 2, verse: 1, slok: 'सञ्जय उवाच |\nतं तथा कृपयाविष्टमश्रुपूर्णाकुलेक्षणम् |\nविषीदन्तमिदं वाक्यमुवाच मधुसूदनः ||२-१||', transliteration: 'sañjaya uvāca .\ntaṃ tathā kṛpayāviṣṭamaśrupūrṇākulekṣaṇam .\nviṣīdantamidaṃ vākyamuvāca madhusūdanaḥ ||2-1||' };
const SRC_2_2 = { _id: 'BG2.2', chapter: 2, verse: 2, slok: 'श्रीभगवानुवाच ।\nकुतस्त्वा कश्मलमिदं विषमे समुपस्थितम् |\nअनार्यजुष्टमस्वर्ग्यमकीर्तिकरमर्जुन ||२-२||', transliteration: 'śrībhagavānuvāca .\nkutastvā kaśmalamidaṃ viṣame samupasthitam .\nanāryajuṣṭamasvargyamakīrtikaramarjuna ||2-2||' };
const SRC_COLOPHON = { _id: 'BG2.73', chapter: 2, verse: 73, slok: 'ॐ तत्सदिति श्रीमद्भगवद्गीतासूपनिषत्सु ब्रह्मविद्यायां योगशास्त्रे श्रीकृष्णार्जुनसंवादे साङ्ख्ययोगो नाम द्वितीयोऽध्यायः ||२||', transliteration: 'oṃ tatsaditi … dvitīyo.adhyāyaḥ ||2||' };

test('a verse: the marker dropped, ASCII daṇḍas made Devanagari, the avagraha kept', () => {
  const d = parseSlok(SRC_2_47.slok);
  assert.equal(d.speakerLine, null);
  assert.deepEqual(d.lines, ['कर्मण्येवाधिकारस्ते मा फलेषु कदाचन ।', 'मा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि ॥']);
  const i = parseIast(SRC_2_47.transliteration);
  assert.deepEqual(i.lines, ['karmaṇyevādhikāraste mā phaleṣu kadācana |', 'mā karmaphalaheturbhūrmā te saṅgo’astvakarmaṇi ||']);
  assert.deepEqual(parseSlok(SRC_COLOPHON.slok).lines, ['ॐ तत्सदिति श्रीमद्भगवद्गीतासूपनिषत्सु ब्रह्मविद्यायां योगशास्त्रे श्रीकृष्णार्जुनसंवादे साङ्ख्ययोगो नाम द्वितीयोऽध्यायः ॥'], 'a colophon marker is a single number');
});

test('speaker lines come out of the text and name the speaker, carried to the verses after', () => {
  assert.equal(speakerOf('धृतराष्ट्र उवाच |'), 'dhritarashtra');
  assert.equal(speakerOf('श्रीभगवानुवाच'), 'krishna');
  assert.equal(speakerOf('अर्जुन उवाच ।'), 'arjuna');
  assert.equal(speakerOf('श्री भगवान् उवाच'), 'krishna');
  assert.equal(speakerOf('संजय उवाच'), 'sanjaya');
  assert.equal(speakerOf('कर्मण्येवाधिकारस्ते'), null);
  assert.equal(speakerOf('उवाच पार्थ पश्यैतान्समवेतान्कुरूनिति ।'), null, 'a mid-verse uvāca is not a speaker line');
  const d = parseSlok(SRC_1_1.slok);
  assert.equal(d.speakerLine, 'धृतराष्ट्र उवाच');
  assert.equal(d.lines.length, 2);
  assert.deepEqual(parseSlok('श्रीभगवानुवाच ।\nकुतस्त्वा |\nअनार्य ||२-२||'), { speakerLine: 'श्रीभगवानुवाच', lines: ['कुतस्त्वा ।', 'अनार्य ॥'] });
  const i = parseIast(SRC_1_1.transliteration);
  assert.equal(i.speakerLine, 'dhṛtarāṣṭra uvāca');
  assert.equal(i.lines.length, 2);
  const data = buildDataset([{ chapter_number: '1', verses_count: '47', name: 'अर्जुनविषादयोग' }, { chapter_number: '2', verses_count: '72', name: 'साङ्ख्ययोग' }], [SRC_2_2, SRC_1_1, SRC_2_1, SRC_2_47, SRC_COLOPHON], { version: '2026.10.11' });
  assert.deepEqual(data.verses.map((v) => [v.id, v.kind, v.speaker && v.speaker.who, v.speaker && v.speaker.deva]), [
    ['1.1', 'verse', 'dhritarashtra', 'धृतराष्ट्र उवाच'], ['2.1', 'verse', 'sanjaya', 'सञ्जय उवाच'], ['2.2', 'verse', 'krishna', 'श्रीभगवानुवाच'], ['2.47', 'verse', 'krishna', null], ['2.colophon', 'colophon', null, null],
  ]);
  assert.equal(data.verses[2].speaker.iast, 'śrībhagavānuvāca');
  assert.deepEqual(data.verses[3].metre, { family: 'anushtubh', name: 'anuṣṭubh' });
  assert.equal(data.verses[4].metre, null);
  assert.equal(data.schemaVersion, '1.0.0');
  assert.ok(data.stats.countMismatch.length > 0, 'a partial sample does not have every verse');
  assert.deepEqual(data.chapters.map((c) => [c.chapter, c.verses, c.name.deva]), [[1, 47, 'अर्जुनविषादयोग'], [2, 72, 'साङ्ख्ययोग']]);
  // the shape is the one the app checks (counts aside, which the sample cannot satisfy)
  const { errors } = validateDataset({ ...data, chapters: [{ chapter: 1, verses: 1, name: { deva: 'x' } }, { chapter: 2, verses: 3, name: { deva: 'y' } }] });
  assert.deepEqual(errors, []);
});

test('an English translation aligned by verse id is merged into translations.en', () => {
  const data = { verses: [{ id: '1.1', translations: {} }, { id: '2.47', translations: {} }] };
  const n = mergeEnglish(data, [{ id: '2.47', text_en: ' Thy business is with the action only… ' }, { id: '9.9', text_en: 'x' }, { id: '1.1', text_en: '' }]);
  assert.equal(n, 1);
  assert.equal(data.verses[1].translations.en, 'Thy business is with the action only…');
  assert.deepEqual(data.verses[0].translations, {});
});

test('typo overrides apply to their verse and a miss is reported', () => {
  const report = [];
  assert.deepEqual(applyOverrides('12.6', ['ये तु सर्वाणि कर्माणि मयि संन्यस्य मत्परः ।'], { '12.6': [['मत्परः', 'मत्पराः']] }, report), ['ये तु सर्वाणि कर्माणि मयि संन्यस्य मत्पराः ।']);
  assert.deepEqual(report, []);
  applyOverrides('12.6', ['already right मत्पराः'], { '12.6': [['मत्परः', 'मत्पराः']] }, report);
  assert.deepEqual(report, ['12.6: override "मत्परः" not found']);
  const rec = verseRecord({ chapter: 1, verse: 19, slok: 'स घोषो धार्तराष्ट्राणां हृदयानि व्यदारयत् |\nनभश्च पृथिवीं चैव तुमुलोऽभ्यनुनादयन् (or लोव्यनु) ||१-१९||', transliteration: 'x .\ny ||1-19||' });
  assert.equal(rec.deva[1], 'नभश्च पृथिवीं चैव तुमुलोऽभ्यनुनादयन् ॥', 'the editorial note is stripped');
  assert.equal(rec.metre.family, 'anushtubh');
  assert.equal(verseRecord({ chapter: 2, verse: 5, slok: 'a |\nb |\nc |\nd ||२-५||', transliteration: 'a .\nb .\nc .\nd ||2-5||' }).metre.family, 'trishtubh');
});
