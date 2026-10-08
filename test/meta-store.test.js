import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encodeWavBytes, decodeWav } from '../js/wav.js';
import { parseWavHeader } from '../js/libutil.js';
import { pcmSha256, audioInfo, withBext, makeBext, sanitizeMeta, ensureMeta, readMeta, moveMeta, sanitizeProfile, bextDescription } from '../meta-store.js';

const tone = (sec = 0.5, sr = 16000) => {
  const x = new Float32Array(Math.round(sec * sr));
  for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / sr);
  return x;
};
const asBuffer = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);

test('bext: a WAV with a bext chunk still decodes to the same samples and the same PCM hash', () => {
  const x = tone();
  const plain = asBuffer(encodeWavBytes(x, 16000));
  const meta = { name: 'Gāyatrī', style: { mode: 'vedic_accented' }, speaker: { voiceType: 'female', ageGroup: '40to59' }, text: { language: 'sa' }, createdAt: '2026-10-07T10:00:00Z', audio: { sampleRate: 16000 } };
  const tagged = withBext(plain, { description: bextDescription(meta), originatorRef: 'id-1', date: meta.createdAt, sampleRate: 16000 });
  assert.ok(tagged.length > plain.length + 600);
  assert.equal(tagged.toString('latin1', 12, 16), 'bext');
  assert.equal(tagged.readUInt32LE(4), tagged.length - 8, 'RIFF size covers the new chunk');
  const h = parseWavHeader(tagged, tagged.length);
  assert.equal(h.sampleRate, 16000);
  assert.ok(Math.abs(h.duration - 0.5) < 1e-6);
  const d = decodeWav(tagged);
  assert.equal(d.sampleRate, 16000);
  assert.equal(d.samples.length, x.length);
  assert.ok(Math.abs(d.samples[1000] - x[1000]) < 1e-3);
  assert.equal(pcmSha256(tagged), pcmSha256(plain), 'the PCM identity ignores header chunks');
  // re-tagging replaces the old chunk instead of stacking another
  const again = withBext(tagged, { description: 'other', sampleRate: 16000 });
  assert.equal(again.length, tagged.length);
  assert.ok(again.toString('latin1').includes('other') && !again.toString('latin1').includes('Gayatri'));
  // the description is ASCII (accents stripped), the date and time are where BWF puts them
  const desc = tagged.toString('latin1', 20, 20 + 256).replace(/\0+$/, '');
  assert.ok(desc.startsWith('SlokAbhyasa: Gayatri | Vedic, with svaras | female 40to59 | lang=sa'), desc);
  assert.equal(tagged.toString('latin1', 20 + 320, 20 + 330), '2026-10-07');
  const info = audioInfo(tagged);
  assert.equal(info.sampleRate, 16000);
  assert.equal(info.bitDepth, 16);
  assert.equal(info.durationSec, 0.5);
  assert.equal(makeBext({ description: 'x' }).readUInt16LE(8 + 346), 1, 'bext version 1');
});

test('sanitizeMeta: validates the vocabularies, derives the text, keeps the server-owned fields', () => {
  const cur = { id: 'abc', createdAt: '2026-01-01T00:00:00Z', audio: { pcmSha256: 'deadbeef' }, software: { app: 'x' }, migrated: true };
  const m = sanitizeMeta({
    name: 'BG 2.47',
    speaker: { profileId: 'p1', voiceType: 'robot', ageGroup: '8to11' },
    style: { mode: 'sung_stotra', tradition: ' Śṛṅgeri ' },
    text: { body: 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन ।\nमा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि ॥' },
    capture: { device: 'USB mic', sampleRate: 48000, echoCancellation: false, bogus: 1 },
    consent: { givenBy: 'guardian', shareScope: 'everyone' },
    id: 'hacked', audio: { pcmSha256: 'nope' },
  }, cur);
  assert.equal(m.id, 'abc');
  assert.equal(m.audio.pcmSha256, 'deadbeef');
  assert.equal(m.createdAt, cur.createdAt);
  assert.equal(m.speaker.voiceType, 'preferNotToSay', 'unknown voice types fall back');
  assert.equal(m.speaker.ageGroup, '8to11');
  assert.equal(m.speaker.profileId, 'p1');
  assert.equal(m.style.mode, 'sung_stotra');
  assert.equal(m.style.pitchPrescribed, true);
  assert.equal(m.style.tradition, 'Śṛṅgeri');
  assert.equal(m.text.aksharaCount, 32);
  assert.equal(m.text.origin, 'typed');
  assert.equal(m.capture.device, 'USB mic');
  assert.equal(m.capture.echoCancellation, false);
  assert.equal(m.capture.bogus, undefined);
  assert.equal(m.consent.givenBy, 'guardian');
  assert.equal(m.consent.shareScope, 'private', 'unknown scopes stay private');
  assert.equal(m.migrated, undefined, 'edited by hand: no longer a migrated stub');
  // a patch that gives only the style keeps the rest
  const p = sanitizeMeta({ style: { mode: 'plain_sloka' } }, m);
  assert.equal(p.speaker.profileId, 'p1');
  assert.equal(p.text.aksharaCount, 32);
  assert.equal(p.style.mode, 'plain_sloka');
  assert.equal(p.style.pitchPrescribed, false);
  assert.equal(p.capture.device, 'USB mic');
  // text: null clears it
  assert.equal(sanitizeMeta({ text: null }, m).text, null);
});

test('sidecars: created for a sloka without one, carrying the audio hash; they move with the WAV', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'slokabhyasa-meta-'));
  try {
    const wav = path.join(dir, 'gayatri-20260101-120000-abcd.wav');
    await fsp.writeFile(wav, asBuffer(encodeWavBytes(tone(), 16000)));
    const rec = { id: '20260101-120000-abcd', name: 'gayatri', source: 'file', createdAt: '2026-01-01T12:00:00Z' };
    const meta = await ensureMeta(rec, wav);
    assert.equal(meta.id, rec.id);
    assert.equal(meta.migrated, true);
    assert.equal(meta.speaker.voiceType, 'preferNotToSay');
    assert.equal(meta.audio.pcmSha256.length, 64);
    assert.equal(meta.audio.durationSec, 0.5);
    assert.equal(meta.text, null);
    const onDisk = await readMeta(wav);
    assert.equal(onDisk.audio.pcmSha256, meta.audio.pcmSha256);
    // second call: the existing sidecar is returned, not rewritten
    const before = (await fsp.stat(wav.replace(/\.wav$/, '.json'))).mtimeMs;
    const again = await ensureMeta(rec, wav);
    assert.equal(again.updatedAt, meta.updatedAt);
    assert.equal((await fsp.stat(wav.replace(/\.wav$/, '.json'))).mtimeMs, before);
    // moved
    const moved = path.join(dir, 'sub', 'gayatri-20260101-120000-abcd.wav');
    await fsp.mkdir(path.dirname(moved));
    await fsp.rename(wav, moved);
    await moveMeta(wav, moved);
    assert.equal((await readMeta(moved)).id, rec.id);
    assert.equal(await readMeta(wav), null);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('profiles: a name is required, vocabularies are checked, ids and dates are kept on edit', () => {
  assert.deepEqual(sanitizeProfile({ voiceType: 'child' }), { error: 'A profile needs a name' });
  const { profile } = sanitizeProfile({ name: ' Ananya ', voiceType: 'child', ageGroup: '8to11', roles: ['learner', 'x'] });
  assert.equal(profile.name, 'Ananya');
  assert.deepEqual(profile.roles, ['learner']);
  assert.ok(/^p-\d{14}-[a-z0-9]{4}$/.test(profile.id), profile.id);
  const edited = sanitizeProfile({ ageGroup: '12to15', roles: [] }, profile).profile;
  assert.equal(edited.id, profile.id);
  assert.equal(edited.createdAt, profile.createdAt);
  assert.equal(edited.name, 'Ananya');
  assert.equal(edited.ageGroup, '12to15');
  assert.deepEqual(edited.roles, ['learner'], 'no roles means a learner');
});
