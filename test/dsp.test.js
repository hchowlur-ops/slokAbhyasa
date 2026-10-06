import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFeatures, hzToSt, serializeFeatures, deserializeFeatures, HOP_SEC } from '../js/dsp/features.js';
import { compare, compareAuto } from '../js/dsp/compare.js';
import { foldOctave } from '../js/dsp/deviations.js';
import { alignDTW, pathMaps } from '../js/dsp/dtw.js';
import { resample } from '../js/dsp/resample.js';
import { createFFT } from '../js/dsp/fft.js';
import { medianOf } from '../js/dsp/util.js';
import {
  tone, melody, silence, concat, timeWarp, addNoise, noise, vowel, chant, VOWEL_A, VOWEL_I, VOWEL_U, SYLLABLES, midiToHz, insertSilence,
} from './synth.js';

const SCALE = [60, 62, 64, 65, 67, 69, 71, 72]; // C major, 400 ms notes
const scaleSignal = (notes = SCALE, opts = {}) => concat(silence(300), melody(notes, 400, 0, opts), silence(300));
const feat = (x) => extractFeatures(x);
const devsOfType = (res, type) => res.deviations.filter((d) => d.types.includes(type));
const noteRange = (k) => [0.3 + 0.4 * k, 0.3 + 0.4 * (k + 1)];
const overlaps = (dev, [s, e]) => dev.tBase[0] < e && dev.tBase[1] > s;

test('FFT matches a direct DFT', () => {
  const n = 64;
  const fft = createFFT(n);
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 5 * i) / n) + 0.3 * Math.cos((2 * Math.PI * 12 * i) / n);
  const x = Float32Array.from(re);
  fft.forward(re, im);
  for (const k of [0, 5, 12, 20]) {
    let dr = 0;
    let di = 0;
    for (let i = 0; i < n; i++) { dr += x[i] * Math.cos((2 * Math.PI * k * i) / n); di -= x[i] * Math.sin((2 * Math.PI * k * i) / n); }
    assert.ok(Math.abs(dr - re[k]) < 1e-3 && Math.abs(di - im[k]) < 1e-3, `bin ${k}`);
  }
});

test('resample 48k→16k preserves a 440 Hz tone', () => {
  const n = 48000;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000);
  const y = resample(x, 48000, 16000);
  assert.equal(y.length, 16000);
  let err = 0;
  for (let i = 200; i < 15800; i++) err = Math.max(err, Math.abs(y[i] - 0.5 * Math.sin((2 * Math.PI * 440 * i) / 16000)));
  assert.ok(err < 0.02, `max error ${err}`);
});

test('YIN: accurate pitch on harmonic tones with noise, robust to vibrato', () => {
  for (const hz of [110, 220, 440, 880]) {
    for (const vib of [0, 30]) {
      const x = addNoise(concat(silence(200), tone(hz, 1500, { vibratoCents: vib }), silence(200)), 20);
      const F = feat(x);
      const target = hzToSt(hz);
      const errs = [];
      let octave = 0;
      let voiced = 0;
      for (let i = 0; i < F.n; i++) {
        if (Number.isNaN(F.st[i])) continue;
        voiced++;
        const e = F.st[i] - target;
        errs.push(Math.abs(e));
        if (Math.abs(Math.abs(e) - 12) < 1) octave++;
      }
      assert.ok(voiced > 50, `${hz} Hz: voiced frames ${voiced}`);
      const medErr = medianOf(errs);
      // Without vibrato the estimate must be within 5 cents; with ±30 cent vibrato the
      // smoothed contour may sit up to ~25 cents from the centre frequency.
      assert.ok(medErr < (vib ? 0.25 : 0.05), `${hz} Hz vib ${vib}: median error ${medErr} st`);
      assert.ok(octave / voiced < 0.01, `${hz} Hz: octave errors ${octave}/${voiced}`);
    }
  }
});

test('noise-only frames are unvoiced; silence is inactive', () => {
  const F = feat(concat(silence(300), noise(1000, -20), silence(300)));
  let voiced = 0;
  for (let i = 0; i < F.n; i++) if (!Number.isNaN(F.st[i])) voiced++;
  assert.ok(voiced <= 2, `voiced frames in noise: ${voiced}`);
  assert.ok(F.active.slice(0, 10).every((v) => v === 0), 'leading silence inactive');
  assert.ok(F.activeFrac > 0.5 && F.activeFrac < 0.75, `active fraction ${F.activeFrac}`);
});

test('a take with no silence at all is still almost entirely active', () => {
  // e.g. a recording that was already trimmed: chant only, no lead-in or tail
  const F = feat(chant(SCALE, 400, undefined, 0));
  assert.ok(F.activeFrac > 0.85, `active fraction ${F.activeFrac}`);
  assert.ok(F.voicedFrac > 0.5, `voiced fraction ${F.voicedFrac}`);
  const res = compare(F, feat(chant(SCALE, 400, undefined, 0)));
  assert.ok(res.scores.overall >= 95, `overall ${res.scores.overall}`);
});

test('pauses stay inactive in a noisy room, even for a quiet singer', () => {
  // chant with 600 ms gaps between notes, quiet (-30 dBFS peaks) over -50 dBFS room noise
  const dry = concat(silence(400), melody(SCALE, 400, 600, { amp: 0.03 }), silence(400));
  const x = new Float32Array(dry.length);
  const nz = noise((dry.length / 16000) * 1000, -50, 11);
  for (let i = 0; i < x.length; i++) x[i] = dry[i] + nz[i];
  const F = feat(x);
  assert.ok(F.activeFrac > 0.3 && F.activeFrac < 0.6, `active fraction ${F.activeFrac}`);
  // the middle of the 600 ms gap after note 1 (starts at 0.4 + 0.4 s) must be inactive
  const gapMid = Math.round((0.4 + 0.4 + 0.3) / HOP_SEC);
  assert.equal(F.active[gapMid], 0, 'gap is inactive');
});

test('features survive serialisation', () => {
  const F = feat(scaleSignal());
  const G = deserializeFeatures(JSON.parse(JSON.stringify(serializeFeatures(F))));
  assert.equal(G.n, F.n);
  assert.deepEqual(Array.from(G.st.slice(0, 20)), Array.from(F.st.slice(0, 20)));
  assert.equal(G.mfcc.length, F.mfcc.length);
});

test('DTW: identical sequences align on the diagonal', () => {
  const N = 200;
  const a = Float32Array.from({ length: N }, (_, i) => Math.sin(i / 7));
  const r = alignDTW(N, N, (i, j) => Math.abs(a[i] - a[j]));
  const { jOf } = pathMaps(r.pathI, r.pathJ, N, N);
  let maxDev = 0;
  for (let i = 0; i < N; i++) maxDev = Math.max(maxDev, Math.abs(jOf[i] - i));
  assert.equal(r.iStart, 0);
  assert.equal(r.jStart, 0);
  assert.ok(maxDev <= 1, `max deviation ${maxDev}`);
  assert.ok(r.meanCost < 0.05);
});

test('compare: identical recordings score ~100 with no deviations', () => {
  const B = feat(scaleSignal());
  const res = compare(B, B);
  assert.ok(res.scores.overall >= 95, `overall ${res.scores.overall}`);
  assert.equal(res.deviations.length, 0, JSON.stringify(res.deviations.map((d) => d.label)));
  assert.ok(Math.abs(res.tempoRatio - 1) < 0.03);
  assert.ok(Math.abs(res.keyOffset) < 0.1);
});

test('compare: "evaluate on" modes make the overall score that aspect alone', () => {
  const B = feat(chant(SCALE));
  const H = feat(chant(SCALE.map((m, k) => (k === 3 ? m + 1 : m))));
  const content = compare(B, H, { ignoreKey: false, mode: 'content' });
  assert.equal(content.mode, 'content');
  assert.equal(content.scores.overall, content.scores.content);
  const timing = compare(B, H, { ignoreKey: false, mode: 'timing' });
  assert.equal(timing.scores.overall, timing.scores.timing);
  const pitch = compare(B, H, { ignoreKey: false, mode: 'pitch' });
  assert.equal(pitch.scores.overall, pitch.scores.pitch);
  const blend = compare(B, H, { ignoreKey: false, mode: 'chant' });
  const w = blend.scores.weights;
  assert.ok(Math.abs(w.pitch + w.timing + w.content - 1) < 1e-9);
  assert.ok(blend.scores.overall >= Math.min(blend.scores.pitch, blend.scores.timing, blend.scores.content));
  assert.ok(blend.scores.overall <= Math.max(blend.scores.pitch, blend.scores.timing, blend.scores.content));
  // pitch-only evaluation with no usable pitch (noise) must not produce NaN
  const N = feat(concat(silence(200), noise(3000, -20, 1), silence(200)));
  const P = feat(concat(silence(200), noise(3000, -20, 2), silence(200)));
  let res;
  try { res = compare(N, P, { mode: 'pitch' }); } catch { res = null; }
  if (res) {
    assert.ok(Number.isFinite(res.scores.overall), `overall ${res.scores.overall}`);
    assert.equal(res.scores.pitch, null);
    assert.equal(res.scores.weights.pitch, 0);
  }
});

test('compare: globally slower performance → tempo ratio ≈ 1.3, no timing deviations; the tempo counts only when speed is judged', () => {
  const B = feat(scaleSignal());
  const H = feat(concat(silence(300), melody(SCALE, 520), silence(300)));
  const res = compare(B, H);
  assert.ok(Math.abs(res.tempoRatio - 1.3) < 0.06, `tempo ratio ${res.tempoRatio}`);
  assert.equal(devsOfType(res, 'timing').length, 0, JSON.stringify(devsOfType(res, 'timing')));
  assert.ok(res.scores.timing >= 95);
  assert.ok(res.notes.some((n) => /longer than the sloka \(speed is not judged\)/.test(n)), JSON.stringify(res.notes));
  const judged = compare(B, H, { judgeSpeed: true });
  assert.ok(judged.scores.timing < res.scores.timing, `${judged.scores.timing} vs ${res.scores.timing}`);
  assert.ok(judged.notes.some((n) => /longer than the sloka\.$/.test(n)), JSON.stringify(judged.notes));
  assert.equal(compare(B, H, { penalizeTempo: true }).scores.timing, judged.scores.timing, 'the old option name still works');
});

test('compare: one note held longer counts only when speed is judged', () => {
  const B = feat(scaleSignal());
  const notes = SCALE.map((m, k) => (k === 3 ? [m, 800] : [m, 400]));
  const H = feat(concat(silence(300), ...notes.map(([m, ms]) => tone(midiToHz(m), ms)), silence(300)));
  const free = compare(B, H);
  assert.equal(devsOfType(free, 'timing').length, 0, JSON.stringify(devsOfType(free, 'timing')));
  assert.ok(free.scores.timing >= 95, `timing ${free.scores.timing}`);
  const res = compare(B, H, { judgeSpeed: true });
  const timing = devsOfType(res, 'timing');
  assert.equal(timing.length, 1, JSON.stringify(timing));
  assert.ok(overlaps(timing[0], noteRange(3)), `range ${timing[0].tBase}`);
  assert.ok(timing[0].value > 1.5, `ratio ${timing[0].value}`);
  assert.ok(res.scores.timing < free.scores.timing);
});

test('compare: speeding up and slowing down within a sloka is free by default, a criterion on request', () => {
  const B = feat(chant(MAN));
  // first half rushed (1.4× faster), second half dragged (0.75×): the same syllables, pitches and vowels
  const paced = concat(silence(300), ...MAN.map((m, k) => vowel(midiToHz(m), k < 4 ? 400 / 1.4 : 400 / 0.75, SYLLABLES[k])), silence(300));
  const H = feat(paced);
  const free = compare(B, H);
  assert.equal(devsOfType(free, 'timing').length, 0, JSON.stringify(devsOfType(free, 'timing')));
  assert.ok(free.scores.timing >= 95 && free.scores.overall >= 95, JSON.stringify(free.scores));
  const judged = compare(B, H, { judgeSpeed: true });
  assert.ok(devsOfType(judged, 'timing').length >= 1, 'pace changes are reported when speed is judged');
  assert.ok(judged.scores.timing < free.scores.timing, `${judged.scores.timing} vs ${free.scores.timing}`);
});

test('compare: leading silence / noise in the attempt changes nothing', () => {
  const B = feat(scaleSignal());
  const res0 = compare(B, feat(scaleSignal()));
  const H = feat(concat(silence(1200), scaleSignal()));
  const res = compare(B, H);
  assert.equal(res.deviations.length, res0.deviations.length);
  assert.ok(Math.abs(res.scores.overall - res0.scores.overall) <= 2);
  assert.ok(Math.abs(res.matched.heard[0] - 1.2 - res0.matched.heard[0]) < 0.1, `heard start ${res.matched.heard[0]}`);
});

test('compare: truncated attempt → "ending not heard"', () => {
  const B = feat(scaleSignal());
  const H = feat(scaleSignal(SCALE.slice(0, 5)));
  const res = compare(B, H);
  const miss = devsOfType(res, 'missing');
  assert.ok(miss.length >= 1, JSON.stringify(res.deviations));
  const end = miss.find((d) => /Ending/.test(d.label));
  assert.ok(end, 'ending not heard reported');
  assert.ok(end.tBase[0] > 2.1 && end.tBase[0] < 2.5, `starts at ${end.tBase[0]}`);
  assert.ok(res.scores.content < 80);
});

test('compare: note 4 sung a semitone sharp → one pitch deviation at note 4', () => {
  const B = feat(scaleSignal());
  const H = feat(scaleSignal(SCALE.map((m, k) => (k === 3 ? m + 1 : m))));
  const res = compare(B, H);
  const pitch = devsOfType(res, 'pitch');
  assert.equal(pitch.length, 1, JSON.stringify(res.deviations.map((d) => [d.type, d.label, d.tBase])));
  assert.ok(overlaps(pitch[0], noteRange(3)), `range ${pitch[0].tBase}`);
  assert.ok(pitch[0].value > 0.8 && pitch[0].value < 1.2, `delta ${pitch[0].value}`);
  assert.ok(/sharp/.test(pitch[0].label));
  assert.ok(res.scores.pitch < 95 && res.scores.pitch > 60, `pitch score ${res.scores.pitch}`);
});

test('compare: pitch score decreases monotonically with error size (chant-like syllables)', () => {
  const B = feat(chant(SCALE));
  const scores = [0.5, 1, 2].map((st) => compare(B, feat(chant(SCALE.map((m) => m + st))), { ignoreKey: false }).scores.pitch);
  assert.ok(scores[0] > scores[1] && scores[1] > scores[2], `scores ${scores}`);
  assert.ok(scores[2] < 15, `2 st error should score near zero, got ${scores[2]}`);
});

test('compare: transposed +3 st with ignoreKey → no pitch deviations, offset ≈ 3', () => {
  const B = feat(chant(SCALE));
  const H = feat(chant(SCALE.map((m) => m + 3)));
  const res = compare(B, H, { ignoreKey: true });
  assert.ok(Math.abs(res.keyOffset - 3) < 0.15, `offset ${res.keyOffset}`);
  assert.equal(devsOfType(res, 'pitch').length, 0, JSON.stringify(devsOfType(res, 'pitch')));
  assert.ok(res.scores.pitch >= 90, `pitch score ${res.scores.pitch}`);
  const strict = compare(B, H, { ignoreKey: false });
  assert.ok(devsOfType(strict, 'pitch').length >= 1);
  assert.ok(strict.scores.pitch < 40, `strict pitch score ${strict.scores.pitch}`);
  assert.ok(/3\.0 semitones higher/.test(strict.notes.join(' ')), strict.notes.join(' | '));
});

test('compare: chant-like syllables, identical → no deviations', () => {
  const B = feat(chant(SCALE));
  const res = compare(B, feat(chant(SCALE)));
  assert.equal(res.deviations.length, 0, JSON.stringify(res.deviations.map((d) => d.label)));
  assert.ok(res.scores.overall >= 95);
});

test('compare: vibrato alone is not a deviation', () => {
  const B = feat(scaleSignal());
  const H = feat(scaleSignal(SCALE, { vibratoCents: 40 }));
  const res = compare(B, H);
  assert.equal(devsOfType(res, 'pitch').length, 0, JSON.stringify(devsOfType(res, 'pitch')));
});

test('compare: note 6 removed → a missing/skipped deviation near note 6', () => {
  const B = feat(scaleSignal());
  const H = feat(scaleSignal(SCALE.filter((_, k) => k !== 5)));
  const res = compare(B, H);
  const hits = res.deviations.filter((d) => (d.types.includes('missing') || d.types.includes('timing')) && overlaps(d, noteRange(5)));
  assert.ok(hits.length >= 1, JSON.stringify(res.deviations.map((d) => [d.type, d.label, d.tBase])));
  assert.ok(res.scores.overall < 95);
});

test('compare: a different vowel on one note → content deviation there', () => {
  const mk = (vowels) => concat(silence(300), ...SCALE.map((m, k) => vowel(midiToHz(m), 400, vowels[k])), silence(300));
  const B = feat(mk(SCALE.map(() => VOWEL_A)));
  const H = feat(mk(SCALE.map((_, k) => (k === 2 ? VOWEL_I : VOWEL_A))));
  const res = compare(B, H);
  const content = devsOfType(res, 'content');
  assert.ok(content.length >= 1, JSON.stringify(res.deviations.map((d) => [d.type, d.label, d.tBase])));
  assert.ok(content.some((d) => overlaps(d, noteRange(2))), `ranges ${JSON.stringify(content.map((d) => d.tBase))}`);
  assert.ok(content.every((d) => overlaps(d, noteRange(2))), 'no content deviations elsewhere');
});

test('compare: a pause inserted mid-way is reported as timing', () => {
  const B = feat(scaleSignal());
  const H = feat(insertSilence(scaleSignal(), 300 + 1600, 900));
  const res = compare(B, H);
  const timing = devsOfType(res, 'timing');
  assert.ok(timing.length >= 1, JSON.stringify(res.deviations.map((d) => [d.type, d.label, d.tBase])));
  assert.ok(timing.some((d) => /Pause|Paused/.test(d.label)), JSON.stringify(timing.map((d) => d.label)));
});

test('compare: silent attempt is rejected with a clear message', () => {
  const B = feat(scaleSignal());
  const H = feat(concat(silence(2000), noise(500, -70)));
  assert.throws(() => compare(B, H), /No audio was detected/);
});

// A different voice: the same chant sung higher or lower with the vowel formants moved the
// way a shorter or longer vocal tract moves them (a child's sit up to 1.3× a man's).
const MAN = [48, 50, 52, 53, 55, 57, 59, 60]; // 131–262 Hz
const scaledVowels = (vowels, k) => vowels.map((f) => f.map(([hz, bw]) => [hz * k, bw * k]));
const sungBy = (notes, semitonesUp, formantScale, vowels = SYLLABLES) => chant(notes.map((m) => m + semitonesUp), 400, scaledVowels(vowels, formantScale));

test('compare: another voice (child, woman, deeper man) scores like the same voice', () => {
  const B = feat(chant(MAN));
  for (const [label, up, k] of [['woman', 5, 1.12], ['child', 9, 1.2], ['small child', 12, 1.3], ['deeper man', -5, 0.9]]) {
    const H = extractFeatures(sungBy(MAN, up, k), { warps: true });
    const res = compareAuto(B, H);
    assert.ok(res.match.ok, `${label}: taken for different material (contrast ${res.match.contrast})`);
    assert.equal(res.deviations.length, 0, `${label}: ${JSON.stringify(res.deviations.map((d) => d.label))}`);
    assert.ok(res.scores.overall >= 95 && res.scores.content >= 95 && res.scores.pitch >= 95, `${label}: ${JSON.stringify(res.scores)}`);
    assert.equal(Math.round(res.keyOffset), up, `${label}: key offset ${res.keyOffset}`);
    if (k !== 1) assert.ok((k > 1) === (res.voiceWarp > 1), `${label}: warp ${res.voiceWarp} for formants ×${k}`);
    assert.ok(res.notes.some((n) => /voice is (lighter|deeper)/.test(n)), `${label}: no voice note in ${JSON.stringify(res.notes)}`);
  }
});

// Four voice ranges, each as the sloka's voice and as the learner's: a man (131–262 Hz), a
// generic adult a little higher and lighter, a woman, a child. Every pairing must be judged
// on the words alone.
const VOICES = { man: [0, 1], adult: [4, 1.08], woman: [7, 1.15], child: [12, 1.3] };

test('compare: man, adult, woman and child, in every pairing of sloka voice and learner voice', () => {
  const slokas = Object.fromEntries(Object.entries(VOICES).map(([name, [up, k]]) => [name, feat(sungBy(MAN, up, k))]));
  for (const [sv, [sUp, sK]] of Object.entries(VOICES)) {
    for (const [lv, [lUp, lK]] of Object.entries(VOICES)) {
      if (sv === lv) continue;
      const res = compareAuto(slokas[sv], extractFeatures(sungBy(MAN, lUp, lK), { warps: true }));
      const label = `${lv} after ${sv}`;
      assert.ok(res.match.ok, `${label}: taken for different material (contrast ${res.match.contrast})`);
      assert.equal(res.deviations.length, 0, `${label}: ${JSON.stringify(res.deviations.map((d) => d.label))}`);
      assert.ok(res.scores.overall >= 95 && res.scores.content >= 95 && res.scores.pitch >= 95, `${label}: ${JSON.stringify(res.scores)}`);
      assert.equal(Math.round(res.keyOffset), lUp - sUp, `${label}: key offset ${res.keyOffset}`);
      const ratio = lK / sK;
      if (Math.abs(ratio - 1) > 0.05) assert.ok((ratio > 1) === (res.voiceWarp > 1), `${label}: warp ${res.voiceWarp} for a formant ratio of ${ratio.toFixed(2)}`);
    }
  }
});

test('compare: a wrong syllable is found, and never misplaced, in every pairing of voices', () => {
  // The fourth syllable is "e"; the learner sings "u". (A subtler slip, i for a, is still found
  // in 15 of the 16 pairings; when the voices are far apart the report warns that small slips
  // are harder to spot.)
  const oneWrong = SYLLABLES.map((v, k) => (k === 3 ? VOWEL_U : v));
  for (const [sv, [sUp, sK]] of Object.entries(VOICES)) {
    const B = feat(sungBy(MAN, sUp, sK));
    for (const [lv, [lUp, lK]] of Object.entries(VOICES)) {
      const res = compareAuto(B, extractFeatures(sungBy(MAN, lUp, lK, oneWrong), { warps: true }));
      const content = devsOfType(res, 'content');
      const label = `${lv} after ${sv}`;
      assert.ok(content.every((d) => overlaps(d, noteRange(3))), `${label}: content deviation elsewhere ${JSON.stringify(content.map((d) => d.tBase))}`);
      assert.equal(res.deviations.filter((d) => !d.types.includes('content')).length, 0, `${label}: ${JSON.stringify(res.deviations.map((d) => d.label))}`);
      assert.ok(content.some((d) => overlaps(d, noteRange(3))), `${label}: wrong syllable not found ${JSON.stringify(res.deviations)}`);
    }
  }
});

test('compare: the same wrong syllable is found in a child\'s voice as in the sloka\'s own', () => {
  // the chant's second syllable is "i"; the learner sings "a" there
  const oneWrong = SYLLABLES.map((v, k) => (k === 1 ? VOWEL_A : v));
  const B = feat(chant(MAN));
  for (const [label, up, k] of [['same voice', 0, 1], ['child', 9, 1.2]]) {
    const res = compareAuto(B, extractFeatures(sungBy(MAN, up, k, oneWrong), { warps: true }));
    const content = devsOfType(res, 'content');
    assert.ok(content.some((d) => overlaps(d, noteRange(1))), `${label}: ${JSON.stringify(res.deviations.map((d) => [d.type, d.tBase]))}`);
    assert.ok(content.every((d) => overlaps(d, noteRange(1))), `${label}: content deviation elsewhere ${JSON.stringify(content.map((d) => d.tBase))}`);
    assert.equal(res.deviations.filter((d) => !d.types.includes('content')).length, 0, `${label}: other deviations ${JSON.stringify(res.deviations.map((d) => d.label))}`);
  }
});

test('compare: a take without warps is compared as recorded; one with warps is not warped on a whim', () => {
  const B = feat(chant(MAN));
  assert.equal(compareAuto(B, feat(chant(MAN))).voiceWarp, 1);
  assert.equal(compareAuto(B, extractFeatures(chant(MAN), { warps: true })).voiceWarp, 1);
});

test('foldOctave: an octave slip of the pitch tracker folds back, only when the key is ignored', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
  near(foldOctave(12.3, true), 0.3);
  near(foldOctave(-11.6, true), 0.4);
  near(foldOctave(24.2, true), 0.2);
  near(foldOctave(5, true), 5);
  near(foldOctave(12.3, false), 12.3);
  assert.ok(Number.isNaN(foldOctave(NaN, true)));
});

test('performance: a one-minute take analysed at every voice warp stays quick', () => {
  const x = concat(...Array.from({ length: 8 }, () => chant(MAN)));
  const t0 = performance.now();
  const F = extractFeatures(x, { warps: true });
  const ms = performance.now() - t0;
  assert.ok(F.mfccWarps.length === 9 * F.n * 12);
  assert.ok(ms < 8000, `features took ${ms.toFixed(0)} ms for ${F.duration.toFixed(0)} s`);
});

test('performance: three-minute pair compares quickly', () => {
  const long = concat(...Array.from({ length: 22 }, () => melody(SCALE, 400, 100)));
  const B = feat(long);
  const H = feat(timeWarp(long, [{ from: 30, to: 60, ratio: 1.1 }]));
  const t0 = performance.now();
  const res = compare(B, H);
  const ms = performance.now() - t0;
  assert.ok(res.scores.overall > 0);
  assert.ok(ms < 6000, `compare took ${ms.toFixed(0)} ms`);
});
