import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetsFor, ADULT_PRESET, detectScript, countAksharas, splitPadas, deriveText, voiceStats, newBaselineMeta, compareModeFor, pitchIsStyle, speakerLabel } from '../js/meta.js';
import { extractFeatures } from '../js/dsp/features.js';
import { chant } from './synth.js';

const BG_2_47 = 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन ।\nमा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि ॥';

test('presets: adults keep the calibrated defaults, children get wider bands and a higher floor', () => {
  assert.deepEqual(presetsFor(null, null), { ...ADULT_PRESET, learnerAgeGroup: 'unspecified' });
  const adult = presetsFor({ voiceType: 'female', ageGroup: '18to39' }, { voiceType: 'male', ageGroup: '40to59' });
  assert.equal(adult.pitchTolSt, 0.5);
  assert.deepEqual(adult.speedBand, [0.75, 1.33]);
  assert.equal(adult.pronunciationTolerance, 10);
  assert.deepEqual(adult.warpRange, [0.8, 1.25], 'cross-type adults');
  const same = presetsFor({ voiceType: 'male', ageGroup: '18to39' }, { voiceType: 'male', ageGroup: '40to59' });
  assert.deepEqual(same.warpRange, [0.86, 1.16], 'same-type adults');
  const small = presetsFor({ voiceType: 'child', ageGroup: 'under8' }, { voiceType: 'male', ageGroup: '40to59' });
  assert.equal(small.pitchTolSt, 1.0);
  assert.deepEqual(small.speedBand, [0.67, 1.5]);
  assert.equal(small.contentFloor, 1.3);
  assert.equal(small.pronunciationTolerance, 30);
  assert.deepEqual(small.warpRange, [0.67, 1.5]);
  const older = presetsFor({ voiceType: 'child', ageGroup: '8to11' }, null);
  assert.equal(older.pitchTolSt, 0.75);
  assert.equal(older.pronunciationTolerance, 20);
  const senior = presetsFor({ voiceType: 'female', ageGroup: '60plus' }, { voiceType: 'female', ageGroup: '18to39' });
  assert.deepEqual(senior.speedBand, [0.67, 1.33]);
  assert.equal(senior.pitchTolSt, 0.5);
});

test('style modes: recited text makes pitch a style measure, sung text a melody', () => {
  assert.equal(compareModeFor('plain_sloka'), 'recitation');
  assert.equal(compareModeFor('poem_recital'), 'recitation');
  assert.equal(compareModeFor('vedic_accented'), 'chant');
  assert.equal(compareModeFor('song'), 'singing');
  assert.equal(pitchIsStyle('plain_sloka'), true);
  assert.equal(pitchIsStyle('sung_stotra'), false);
  assert.equal(speakerLabel({ voiceType: 'child', ageGroup: '8to11' }), 'child, 8 to 11');
  assert.equal(speakerLabel({ voiceType: 'preferNotToSay', ageGroup: 'unspecified' }), '');
});

test('text: script, pādas and akṣaras of a Gītā verse are derived, not typed', () => {
  assert.equal(detectScript(BG_2_47), 'Deva');
  assert.equal(detectScript('ಓಂ ನಮಃ ಶಿವಾಯ'), 'Knda');
  assert.equal(detectScript('karmaṇyevādhikāraste'), 'Latn');
  const padas = splitPadas(BG_2_47);
  assert.deepEqual(padas.map((p) => [p.text, p.boundaryType]), [
    ['कर्मण्येवाधिकारस्ते मा फलेषु कदाचन', 'ardha'],
    ['मा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि', 'sloka'],
  ]);
  // anuṣṭubh: 32 akṣaras in the verse (8 per quarter)
  assert.equal(countAksharas(BG_2_47), 32);
  assert.equal(countAksharas('कर्मण्येवाधिकारस्ते'), 8);
  assert.equal(countAksharas('ಓಂ ನಮಃ ಶಿವಾಯ'), 6); // ōṁ na-maḥ śi-vā-ya
  assert.equal(countAksharas('karmaṇyevādhikāraste'), 8);
  const t = deriveText(BG_2_47);
  assert.equal(t.language, 'sa');
  assert.equal(t.aksharaCount, 32);
  assert.equal(t.pauses.length, 1);
  assert.equal(t.svara.prescribed, false);
  assert.equal(deriveText('   '), null);
  const four = splitPadas('a line\nb line\nc line ।\nd line ॥');
  assert.deepEqual(four.map((p) => p.boundaryType), ['pada', 'pada', 'ardha', 'sloka']);
});

test('voice stats: pitch, levels and silences of a synthetic chant', () => {
  const MAN = [48, 50, 52, 53, 55, 57, 59, 60];
  const x = chant(MAN);
  const F = extractFeatures(x);
  const s = voiceStats(F, x, { aksharaCount: 8 });
  assert.ok(s.voice.medianF0Hz > 140 && s.voice.medianF0Hz < 200, `median F0 ${s.voice.medianF0Hz}`);
  assert.ok(s.voice.f0P10Hz < s.voice.medianF0Hz && s.voice.f0P90Hz > s.voice.medianF0Hz);
  assert.ok(s.voice.leadSilenceSec > 0.15 && s.voice.leadSilenceSec < 0.45, `lead ${s.voice.leadSilenceSec}`);
  assert.ok(s.voice.tempoSylPerSec > 2 && s.voice.tempoSylPerSec < 3.5, `tempo ${s.voice.tempoSylPerSec}`);
  assert.ok(s.measured.peakDbfs < 0 && s.measured.peakDbfs > -30);
  assert.equal(s.measured.clippedSampleCount, 0);
  assert.ok(s.measured.snrDb > 20, `snr ${s.measured.snrDb}`);
  assert.equal(s.measured.sampleCount, x.length);
});

test('a new baseline record carries the vocabulary defaults and the derived text', () => {
  const m = newBaselineMeta({ name: 'BG 2.47', source: 'mic', speaker: { id: 'p1', voiceType: 'female', ageGroup: '40to59' }, text: { body: BG_2_47 } });
  assert.equal(m.schemaVersion, '1.0.0');
  assert.equal(m.style.mode, 'plain_sloka');
  assert.equal(m.style.pitchPrescribed, false);
  assert.equal(m.speaker.profileId, 'p1');
  assert.equal(m.text.aksharaCount, 32);
  assert.equal(m.consent.shareScope, 'private');
  const sung = newBaselineMeta({ name: 'x', source: 'file', style: { mode: 'sung_stotra' } });
  assert.equal(sung.style.pitchPrescribed, true);
  assert.equal(sung.speaker.ageGroup, 'unspecified');
  assert.equal(sung.text, null);
});
