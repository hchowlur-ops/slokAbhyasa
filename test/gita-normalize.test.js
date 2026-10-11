import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSlok, parseIast, speakerOf, applyOverrides, verseRecord, buildDataset, mergeEnglish } from '../tools/gita/normalize.mjs';

const SRC_2_47 = { _id: 'BG2.47', chapter: 2, verse: 47, slok: 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन |\nमा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि ||२-४७||', transliteration: 'karmaṇyevādhikāraste mā phaleṣu kadācana .\nmā karmaphalaheturbhūrmā te saṅgo.astvakarmaṇi ||2-47||' };
const SRC_1_1 = { _id: 'BG1.1', chapter: 1, verse: 1, slok: 'धृतराष्ट्र उवाच |\nधर्मक्षेत्रे कुरुक्षेत्रे समवेता युयुत्सवः |\nमामकाः पाण्डवाश्चैव किमकुर्वत सञ्जय ||१-१||', transliteration: 'dhṛtarāṣṭra uvāca .\ndharmakṣetre kurukṣetre samavetā yuyutsavaḥ .\nmāmakāḥ pāṇḍavāścaiva kimakurvata sañjaya ||1-1||' };
const SRC_2_1 = { _id: 'BG2.1', chapter: 2, verse: 1, slok: 'सञ्जय उवाच |\nतं तथा कृपयाविष्टमश्रुपूर्णाकुलेक्षणम् |\nविषीदन्तमिदं वाक्यमुवाच मधुसूदनः ||२-१||', transliteration: 'sañjaya uvāca .\ntaṃ tathā kṛpayāviṣṭamaśrupūrṇākulekṣaṇam .\nviṣīdantamidaṃ vākyamuvāca madhusūdanaḥ ||2-1||' };
const SRC_2_2 = { _id: 'BG2.2', chapter: 2, verse: 2, slok: 'श्रीभगवानुवाच |\nकुतस्त्वा कश्मलमिदं विषमे समुपस्थितम् |\nअनार्यजुष्टमस्वर्ग्यमकीर्तिकरमर्जुन ||२-२||', transliteration: 'śrībhagavānuvāca .\nkutastvā kaśmalamidaṃ viṣame samupasthitam .\nanāryajuṣṭamasvargyamakīrtikaramarjuna ||2-2||' };
const SRC_COLOPHON = { _id: 'BG2.73', chapter: 2, verse: 73, slok: 'ॐ तत्सदिति श्रीमद्भगवद्गीतासूपनिषत्सु ब्रह्मविद्यायां योगशास्त्रे श्रीकृष्णार्जुनसंवादे साङ्ख्ययोगो नाम द्वितीयोऽध्यायः ||२||', transliteration: 'oṃ tatsaditi … dvitīyo.adhyāyaḥ ||2||' };

test('a verse: the marker dropped, ASCII daṇḍas made Devanagari, the avagraha kept', () => {
  const d = parseSlok(SRC_2_47.slok);
  assert.equal(d.speakerLine, null);
  assert.deepEqual(d.lines, ['कर्मण्येवाधिकारस्ते मा फलेषु कदाचन ।', 'मा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि ॥']);
  const i = parseIast(SRC_2_47.transliteration);
  assert.deepEqual(i.lines, ['karmaṇyevādhikāraste mā phaleṣu kadācana |', 'mā karmaphalaheturbhūrmā te saṅgo’astvakarmaṇi ||']);
});

test('speaker lines come out of the text and name the speaker, carried to the verses after', () => {
  assert.equal(speakerOf('धृतराष्ट्र उवाच |'), 'धृतराष्ट्र');
  assert.equal(speakerOf('श्रीभगवानुवाच'), 'श्रीभगवान्');
  assert.equal(speakerOf('अर्जुन उवाच'), 'अर्जुन');
  assert.equal(speakerOf('कर्मण्येवाधिकारस्ते'), null);
  const d = parseSlok(SRC_1_1.slok);
  assert.equal(d.speakerLine, 'धृतराष्ट्र उवाच');
  assert.equal(d.lines.length, 2);
  const i = parseIast(SRC_1_1.transliteration);
  assert.equal(i.speakerLine, 'dhṛtarāṣṭra uvāca');
  assert.equal(i.lines.length, 2);
  const data = buildDataset([{ chapter_number: '1', verses_count: '47', name: 'अर्जुनविषादयोग' }, { chapter_number: '2', verses_count: '72', name: 'साङ्ख्ययोग' }], [SRC_2_2, SRC_1_1, SRC_2_1, SRC_2_47, SRC_COLOPHON]);
  assert.deepEqual(data.verses.map((v) => [v.id, v.speaker, v.speakerLine]), [['1.1', 'धृतराष्ट्र', 'धृतराष्ट्र उवाच'], ['2.1', 'सञ्जय', 'सञ्जय उवाच'], ['2.2', 'श्रीभगवान्', 'श्रीभगवानुवाच'], ['2.47', 'श्रीभगवान्', null]]);
  assert.deepEqual(data.colophons.map((c) => [c.id, c.chapter]), [['2.colophon', 2]]);
  assert.equal(data.verses[3].metre, 'anushtubh');
  assert.ok(data.stats.countMismatch.length > 0, 'a partial sample does not have every verse');
  assert.deepEqual(data.chapters.map((c) => [c.number, c.verses]), [[1, 47], [2, 72]]);
});

test('the speaker line in the source\'s own daṇḍa spellings; a mid-verse "uvāca" is not one', () => {
  assert.equal(speakerOf('अर्जुन उवाच ।'), 'अर्जुन');
  assert.equal(speakerOf('श्रीभगवानुवाच ।'), 'श्रीभगवान्');
  assert.equal(speakerOf('श्री भगवान् उवाच'), 'श्रीभगवान्');
  assert.equal(speakerOf('संजय उवाच'), 'सञ्जय');
  assert.equal(speakerOf('उवाच पार्थ पश्यैतान्समवेतान्कुरूनिति ।'), null);
  const d = parseSlok('श्रीभगवानुवाच ।\nकुतस्त्वा |\nअनार्य ||२-२||');
  assert.deepEqual(d, { speakerLine: 'श्रीभगवानुवाच', lines: ['कुतस्त्वा ।', 'अनार्य ॥'] });
});

test('an English translation aligned by verse id is merged as `english`', () => {
  const data = { verses: [{ id: '1.1' }, { id: '2.47' }] };
  const n = mergeEnglish(data, [{ id: '2.47', text_en: ' Thy business is with the action only… ' }, { id: '9.9', text_en: 'x' }, { id: '1.1', text_en: '' }]);
  assert.equal(n, 1);
  assert.equal(data.verses[1].english, 'Thy business is with the action only…');
  assert.equal(data.verses[0].english, undefined);
});

test('typo overrides apply to their verse and a miss is reported', () => {
  const report = [];
  assert.deepEqual(applyOverrides('12.6', ['ये तु सर्वाणि कर्माणि मयि संन्यस्य मत्परः ।'], { '12.6': [['मत्परः', 'मत्पराः']] }, report), ['ये तु सर्वाणि कर्माणि मयि संन्यस्य मत्पराः ।']);
  assert.deepEqual(report, []);
  applyOverrides('12.6', ['already right मत्पराः'], { '12.6': [['मत्परः', 'मत्पराः']] }, report);
  assert.deepEqual(report, ['12.6: override "मत्परः" not found']);
  const rec = verseRecord({ chapter: 1, verse: 19, slok: 'स घोषो धार्तराष्ट्राणां हृदयानि व्यदारयत् |\nनभश्च पृथिवीं चैव तुमुलोऽभ्यनुनादयन् (or लोव्यनु) ||१-१९||', transliteration: 'x .\ny ||1-19||' });
  assert.equal(rec.deva[1], 'नभश्च पृथिवीं चैव तुमुलोऽभ्यनुनादयन् ॥', 'the editorial note is stripped');
  assert.equal(rec.metre, 'anushtubh');
  assert.equal(verseRecord({ chapter: 2, verse: 5, slok: 'a |\nb |\nc |\nd ||२-५||', transliteration: 'a .\nb .\nc .\nd ||2-5||' }).metre, 'trishtubh');
});
