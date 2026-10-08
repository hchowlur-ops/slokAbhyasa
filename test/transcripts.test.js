import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStore, pickTranscript, putInStore, removeFromStore, shiftStore, transcriptToText, applyTextEdit, publicStore, availableLanguages } from '../js/transcripts.js';

const sa = { text: 'कर्मण्येवाधिकारस्ते मा फलेषु', chunks: [{ text: 'कर्मण्येवाधिकारस्ते', start: 0.5, end: 2 }, { text: 'मा फलेषु', start: 2, end: 3.5 }], language: 'sanskrit', tier: 'better' };
const kn = { text: 'ಕರ್ಮಣ್ಯೇವಾಧಿಕಾರಸ್ತೇ', chunks: [], language: 'kannada', tier: 'better' };

test('a transcript file from before is read as one language, and stays the current one', () => {
  const s = normalizeStore(sa);
  assert.equal(s.version, 2);
  assert.equal(s.current, 'sanskrit');
  assert.deepEqual(availableLanguages(s), ['sanskrit']);
  assert.equal(pickTranscript(s).text, sa.text);
  assert.equal(pickTranscript(s, 'kannada'), null);
  assert.equal(normalizeStore({ language: 'sanskrit' }), null, 'no text, no transcript');
  assert.equal(normalizeStore(null), null);
  assert.equal(normalizeStore({ version: 2, current: 'x', languages: {} }), null);
  // a stored transcript without a language lands under "unknown"
  assert.equal(normalizeStore({ text: 'om' }).current, 'unknown');
});

test('languages are added beside each other; only a primary put changes the current one', () => {
  let s = putInStore(null, sa);
  s = putInStore(s, kn, { primary: false });
  assert.deepEqual(availableLanguages(s).sort(), ['kannada', 'sanskrit']);
  assert.equal(s.current, 'sanskrit', 'a background transcript does not take over');
  assert.equal(pickTranscript(s, 'kannada').text, kn.text);
  s = putInStore(s, { ...kn, text: 'ಮಾ ಫಲೇಷು' });
  assert.equal(s.current, 'kannada', 'a primary put makes its language current');
  assert.equal(pickTranscript(s).text, 'ಮಾ ಫಲೇಷು', 'and replaces that language');
  // the first transcript becomes current whatever the flag says
  assert.equal(putInStore(null, kn, { primary: false }).current, 'kannada');
  // a round trip through the stored shape keeps everything
  const again = normalizeStore(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(again, s);
  assert.deepEqual(publicStore(s).available.sort(), ['kannada', 'sanskrit']);
});

test('removing a language keeps the rest, removing the current one picks another', () => {
  let s = putInStore(putInStore(null, sa), kn, { primary: false });
  s = removeFromStore(s, 'sanskrit');
  assert.deepEqual(availableLanguages(s), ['kannada']);
  assert.equal(s.current, 'kannada');
  assert.equal(removeFromStore(s, 'kannada'), null);
  assert.equal(removeFromStore(s, null), null, 'no language: everything goes');
});

test('trimming the start shifts every language, and the text twin follows the current one', () => {
  const s = putInStore(putInStore(null, sa), { ...kn, chunks: [{ text: 'x', start: 1, end: 4 }] }, { primary: false });
  const t = shiftStore(s, 0.4, 3);
  const r = (v) => Math.round(v * 1000) / 1000;
  assert.deepEqual(t.languages.sanskrit.chunks.map((c) => [r(c.start), r(c.end)]), [[0.1, 1.6], [1.6, 3]]);
  assert.deepEqual(t.languages.kannada.chunks.map((c) => [r(c.start), r(c.end)]), [[0.6, 3]]);
  assert.equal(transcriptToText(pickTranscript(t)), 'कर्मण्येवाधिकारस्ते\nमा फलेषु\n');
  assert.equal(transcriptToText(kn), 'ಕರ್ಮಣ್ಯೇವಾಧಿಕಾರಸ್ತೇ\n');
});

test('a hand-edited .txt keeps the timings when the line count matches', () => {
  const e = applyTextEdit(sa, 'कर्मण्येवाधिकारस्ते\nमा फलेषु कदाचन\n', '2026-10-08T00:00:00Z');
  assert.equal(e.edited, true);
  assert.equal(e.editedIn, 'file');
  assert.equal(e.text, 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन');
  assert.deepEqual(e.chunks.map((c) => [c.text, c.start]), [['कर्मण्येवाधिकारस्ते', 0.5], ['मा फलेषु कदाचन', 2]]);
  const f = applyTextEdit(sa, 'one line only', '2026-10-08T00:00:00Z');
  assert.deepEqual(f.chunks, [], 'a different line count drops the timings');
  assert.equal(applyTextEdit(null, 'om', 'now').language, 'unknown');
});
