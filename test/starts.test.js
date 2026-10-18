import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mfccRows, meanOf, padaStarts, lineStarts, startTemplates, dtwDistance, calibrate, matchStart, TEMPLATE_FRAMES } from '../js/dsp/starts.js';
import { N_MFCC, HOP_SEC } from '../js/dsp/features.js';

// A fake recording: frames of MFCCs where each "pāda" opens with its own signature for
// 0.8 s, then settles to a common hum; a little noise throughout.
function fakeFeatures(seconds, starts, { noise = 0.3, seed = 1 } = {}) {
  const n = Math.round(seconds / HOP_SEC);
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
  const mfcc = new Float32Array(n * N_MFCC);
  for (let k = 0; k < n; k++) {
    const t = k * HOP_SEC;
    const st = starts.find((x) => t >= x.at && t < x.at + 0.8);
    for (let c = 0; c < N_MFCC; c++) {
      const base = Math.sin((c + 1) * 0.7) * 2; // the hum
      const sig = st ? Math.cos((c + 1) * (st.pada + 2) * 1.3) * 6 : 0; // the start's signature
      mfcc[k * N_MFCC + c] = base + sig + rnd() * noise * 2;
    }
  }
  const mean = new Float32Array(N_MFCC);
  for (let k = 0; k < n; k++) for (let c = 0; c < N_MFCC; c++) mean[c] += mfcc[k * N_MFCC + c] / n;
  return { n, hopSec: HOP_SEC, mfcc, mfccMean: mean };
}
const STARTS = [{ pada: 1, at: 0.5 }, { pada: 2, at: 3.5 }, { pada: 3, at: 6.5 }, { pada: 4, at: 9.5 }];

test('pāda starts from a transcript\'s chunks and the plan: half-verses split by the akṣara share, the speaker line first', () => {
  const chunks = [{ text: 'अर्जुन उवाच', start: 0, end: 1.5 }, { text: 'a', start: 2, end: 6 }, { text: 'b', start: 6.5, end: 10.5 }];
  const s = padaStarts(chunks, { speakerLine: 6, padas: [8, 8, 8, 8] });
  assert.deepEqual(s.map((x) => [x.pada, Number(x.at.toFixed(2))]), [[0, 0], [1, 2], [2, 4], [3, 6.5], [4, 8.5]]);
  const t = padaStarts(chunks.slice(1), { speakerLine: 0, padas: [8, 8, 8, 8] });
  assert.deepEqual(t.map((x) => x.pada), [1, 2, 3, 4]);
  const four = padaStarts([{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 6 }, { start: 6, end: 8 }], { speakerLine: 0, padas: [11, 11, 11, 11] });
  assert.deepEqual(four.map((x) => [x.pada, x.at]), [[1, 0], [2, 2], [3, 4], [4, 6]], 'a triṣṭubh written in its pādas');
  const one = padaStarts([{ start: 1, end: 9 }], { speakerLine: 0, padas: [8, 8, 8, 8] });
  assert.deepEqual(one.map((x) => x.at), [1, 3, 5, 7], 'one line holding the whole sloka');
  assert.deepEqual(padaStarts([], { padas: [8] }), []);
  assert.deepEqual(lineStarts([{ text: 'नमः', start: 0.5 }]).map((x) => [x.pada, x.at, x.aksharas]), [[1, 0.5, 2]]);
});

test('templates, distances and a calibrated match: the same start is found, another is not, noise is not', () => {
  const F = fakeFeatures(13, STARTS);
  const templates = startTemplates(F, STARTS);
  assert.equal(templates.length, 4);
  assert.equal(templates[0].rows.length, TEMPLATE_FRAMES);
  assert.equal(dtwDistance(templates[0].rows, templates[0].rows), 0);
  assert.ok(dtwDistance(templates[0].rows, templates[1].rows) > 1, 'different starts lie apart');
  const { threshold } = calibrate(templates, F);
  assert.ok(threshold > 0, `threshold ${threshold}`);
  // a learner's take: three seconds of singing, then pāda 3's start again — the same
  // signature, more noise, the take's own mean taken off (as the teacher's recording's is)
  const take = fakeFeatures(4.0, [{ pada: 3, at: 3.05 }], { noise: 0.9, seed: 7 });
  const rows = mfccRows(take, Math.round(3.05 / HOP_SEC), TEMPLATE_FRAMES, { mean: meanOf(take) });
  const m = matchStart(rows, templates, { threshold });
  assert.equal(m.best.pada, 3);
  assert.ok(m.confident, `confident: dist ${m.best.dist} threshold ${threshold} margin ${m.margin}`);
  // the hum alone (no start at all) matches nothing with confidence
  const hum = fakeFeatures(4.0, [], { noise: 0.9, seed: 3 });
  const h = matchStart(mfccRows(hum, Math.round(3.05 / HOP_SEC), TEMPLATE_FRAMES, { mean: meanOf(hum) }), templates, { threshold });
  assert.equal(h.confident, false);
  // without a threshold nothing is believed
  assert.equal(matchStart(rows, templates).confident, false);
  assert.equal(calibrate(templates.slice(0, 1)).threshold, null, 'one template: nothing to tell apart');
  assert.equal(dtwDistance([], templates[0].rows), Infinity);
});
