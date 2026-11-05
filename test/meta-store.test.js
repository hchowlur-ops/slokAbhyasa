import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encodeWavBytes, decodeWav } from '../js/wav.js';
import { parseWavHeader } from '../js/libutil.js';
import { pcmSha256, audioInfo, withBext, makeBext, sanitizeMeta, ensureMeta, readMeta, moveMeta, sanitizeProfile, bextDescription, sanitizeVerse, readProfiles, readProfilesFile, writeProfiles } from '../meta-store.js';

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

const quiet = async (fn) => { const warn = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = warn; } };
const broken = async (dir) => (await fsp.readdir(dir)).filter((n) => n.includes('.broken-'));
// a damaged file written a moment ago counts as "still being written"; these cases age it, as damage from long ago
const aged = async (file, content) => { await fsp.writeFile(file, content); const old = new Date(Date.now() - 120000); await fsp.utimes(file, old, old); };

test('garbage in a details file is kept as .broken-… and fresh details say where they came from', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'slokabhyasa-meta-'));
  try {
    const wav = path.join(dir, 'ch12-03-20260101-120000-abcd.wav');
    const json = wav.replace(/\.wav$/, '.json');
    await fsp.writeFile(wav, asBuffer(encodeWavBytes(tone(), 16000)));
    await aged(json, '{"schemaVersion": "1.1.0", "name": "CH12-03", "spe');
    const rec = { id: '20260101-120000-abcd', name: 'CH12-03', source: 'mic', createdAt: '2026-01-01T12:00:00Z' };
    const meta = await quiet(() => ensureMeta(rec, wav));
    const kept = await broken(dir);
    assert.equal(kept.length, 1, 'the file is quarantined, not left to be read again');
    assert.equal(await fsp.readFile(path.join(dir, kept[0]), 'utf8'), '{"schemaVersion": "1.1.0", "name": "CH12-03", "spe', 'its bytes are intact');
    assert.equal(meta.migrated, true, 'fresh details, nothing guessed about the speaker');
    assert.equal(meta.recoveredFrom, kept[0]);
    assert.equal(meta.audio.pcmSha256.length, 64, 'with the audio hash');
    assert.equal(meta.id, rec.id);
    const onDisk = await readMeta(wav);
    assert.equal(onDisk.recoveredFrom, kept[0]);
    assert.deepEqual(await broken(dir), kept, 'the second read makes no second quarantine');
    // the provenance stays through an edit of the text, when the migrated mark goes
    const edited = sanitizeMeta({ text: { body: 'ये त्वक्षरमनिर्देश्यमव्यक्तं पर्युपासते ।' } }, onDisk);
    assert.equal(edited.recoveredFrom, kept[0]);
    assert.equal(edited.migrated, undefined);
    assert.equal(sanitizeMeta({ name: 'X' }, { id: 'x' }).recoveredFrom, undefined, 'details that were never recovered carry no such field');
    // a plain read of damage: no details, the file quarantined for whoever reads next, and
    // the details made afresh after that still say where they came from
    const other = path.join(dir, 'ch12-05-20260101-120000-abcg.wav');
    await aged(other.replace(/\.wav$/, '.json'), 'not json');
    assert.equal(await quiet(() => readMeta(other)), null);
    assert.equal((await broken(dir)).length, 2);
    const later = await ensureMeta({ id: '20260101-120000-abcg', name: 'CH12-05', source: 'mic' }, other);
    assert.ok(later.recoveredFrom && later.recoveredFrom.startsWith('ch12-05-20260101-120000-abcg.json.broken-'), later.recoveredFrom);
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('a folder in the details file\'s place makes ensureMeta throw and leaves no new file', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'slokabhyasa-meta-'));
  try {
    const wav = path.join(dir, 'ch12-04-20260101-120000-abce.wav');
    await fsp.writeFile(wav, asBuffer(encodeWavBytes(tone(), 16000)));
    await fsp.mkdir(wav.replace(/\.wav$/, '.json'));
    await assert.rejects(ensureMeta({ id: '20260101-120000-abce', name: 'CH12-04', source: 'mic' }, wav));
    await assert.rejects(readMeta(wav));
    assert.deepEqual((await fsp.readdir(dir)).sort(), ['ch12-04-20260101-120000-abce.json', 'ch12-04-20260101-120000-abce.wav']);
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('a details file in the 1.0.0 shape, before the verse link and the chandas, still loads with those null', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'slokabhyasa-meta-'));
  try {
    const wav = path.join(dir, 'gayatri-20260101-120000-abcf.wav');
    const old = { schemaVersion: '1.0.0', id: '20260101-120000-abcf', name: 'gayatri', source: 'file', createdAt: '2026-01-01T12:00:00Z', speaker: { profileId: 'p1', voiceType: 'female', ageGroup: '40to59' }, style: { mode: 'vedic_accented', tradition: null, pitchPrescribed: true }, text: null, voice: null, measured: null, capture: null, edit: { trimStartSec: 0, trimEndSec: 0 }, consent: { givenBy: 'self', shareScope: 'private' }, notes: null, audio: { pcmSha256: 'abc' }, software: { app: 'SlokAbhyasa', version: '1.5.0' }, updatedAt: '2026-01-01T12:00:00Z' };
    await fsp.writeFile(wav.replace(/\.wav$/, '.json'), JSON.stringify(old, null, 2));
    const meta = await ensureMeta({ id: old.id, name: old.name, source: 'file' }, wav);
    assert.equal(meta.updatedAt, old.updatedAt, 'read as it is, not rewritten');
    const m = sanitizeMeta({}, meta);
    assert.equal(m.verse, null);
    assert.equal(m.chandas, null);
    assert.equal(m.speaker.profileId, 'p1');
    assert.equal(m.style.mode, 'vedic_accented');
    assert.equal(m.audio.pcmSha256, 'abc');
    assert.equal(m.schemaVersion, '1.1.0', 'the shape written back is the current one');
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('a damaged profiles.json is kept as .broken-…, the list is empty, and the next save does not destroy it', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'slokabhyasa-profiles-'));
  try {
    const file = path.join(dir, 'profiles.json');
    await aged(file, '{"schemaVersion": "1.0.0", "profiles": [{"id": "p-1", "name": "An');
    assert.deepEqual(await quiet(() => readProfiles(file)), []);
    const kept = await broken(dir);
    assert.equal(kept.length, 1);
    await writeProfiles(file, [sanitizeProfile({ name: 'Ananya' }).profile]);
    assert.equal((await readProfiles(file)).length, 1);
    assert.deepEqual(await broken(dir), kept);
    assert.ok((await fsp.readFile(path.join(dir, kept[0]), 'utf8')).endsWith('"An'));
    assert.deepEqual(await readProfiles(path.join(dir, 'none.json')), [], 'no file: no profiles, nothing made');
    assert.deepEqual((await fsp.readdir(dir)).filter((n) => n.includes('.tmp-')), [], 'no temporary left by the save');
    // the wrong shape (a list that is not a list) is damage too, kept and not written over
    await aged(file, '{"schemaVersion": "1.0.0", "profiles": "Ananya"}');
    assert.deepEqual(await quiet(() => readProfilesFile(file)), { profiles: [], version: null });
    assert.equal((await broken(dir)).length, 2);
    // a later minor keeps its version through a save; a newer major is refused
    await fsp.writeFile(file, '{"schemaVersion": "1.4.0", "profiles": []}');
    const { version } = await readProfilesFile(file);
    await writeProfiles(file, [], { version });
    assert.equal(JSON.parse(await fsp.readFile(file, 'utf8')).schemaVersion, '1.4.0');
    await fsp.writeFile(file, '{"schemaVersion": "2.0.0", "profiles": []}');
    await assert.rejects(readProfiles(file), /newer SlokAbhyasa \(2\.0\.0\)/);
    assert.ok(fs.existsSync(file), 'not renamed');
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('moveMeta: nothing to move is fine; a rename that fails for any other reason throws instead of orphaning the details', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'slokabhyasa-move-'));
  try {
    const wav = path.join(dir, 'a-20260101-120000-abcd.wav');
    await moveMeta(wav, path.join(dir, 'b.wav')); // no details yet
    await fsp.writeFile(wav.replace(/\.wav$/, '.json'), '{"id": "x"}');
    await assert.rejects(moveMeta(wav, path.join(dir, 'missing-folder', 'b.wav')), (err) => err.code === 'ENOENT');
    assert.ok(fs.existsSync(wav.replace(/\.wav$/, '.json')), 'the details stayed where they were');
    await moveMeta(wav, path.join(dir, 'b.wav'));
    assert.ok(fs.existsSync(path.join(dir, 'b.json')));
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
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

test('the verse link in a sidecar is validated, kept across patches, and cleared with null', () => {
  const link = { dataset: 'gita', datasetVersion: '2026.10.11', id: '12.3', kind: 'verse', chapter: 12, verse: 3, verseEnd: null, speakerLineRecited: true, text: { speaker: null, deva: ['a ।', 'b ॥'] }, textHash: 'abc', metre: { family: 'anushtubh', name: 'anuṣṭubh' }, licence: 'MIT', mappedBy: 'learn', pinned: false, at: '2026-10-12T00:00:00.000Z', junk: 1 };
  const m = sanitizeMeta({ name: 'CH12-03', source: 'mic', verse: link, text: { body: 'a ।\nb ॥', language: 'sa', script: 'Deva', origin: 'reference' } }, { id: 'x', createdAt: '2026-10-12T00:00:00.000Z' });
  assert.equal(m.schemaVersion, '1.1.0');
  assert.equal(m.verse.id, '12.3');
  assert.equal(m.verse.junk, undefined);
  assert.deepEqual(m.verse.text.deva, ['a ।', 'b ॥']);
  assert.equal(m.text.origin, 'reference', 'a text from the dataset keeps its origin');
  const patched = sanitizeMeta({ notes: 'hello' }, m);
  assert.equal(patched.verse.id, '12.3', 'a patch without verse keeps the link');
  assert.equal(patched.text.origin, 'reference');
  const cleared = sanitizeMeta({ verse: null }, m);
  assert.equal(cleared.verse, null);
  assert.equal(sanitizeVerse({ id: '12.3' }), null, 'a link needs its dataset');
  assert.equal(sanitizeVerse({ dataset: 'gita' }), null);
});

test('a profile keeps the learner\'s pace, within bounds, and drops it on null', () => {
  const { profile } = sanitizeProfile({ name: 'Ananya', pace: { tempoRatio: 1.237, padaPauseMs: 640.4, slokaPauseMs: 1500, aksPerSec: 2.456, countRatio: 1.12, n: 3 } });
  assert.deepEqual(profile.pace, { tempoRatio: 1.24, padaPauseMs: 640, slokaPauseMs: 1500, aksPerSec: 2.46, countRatio: 1.12, n: 3 });
  assert.equal(sanitizeProfile({ name: 'X', pace: { aksPerSec: 40, countRatio: 3, n: 1 } }).profile.pace, undefined, 'a speed no reciter has is left out, and nothing else is left');
  const { profile: kept } = sanitizeProfile({ voiceType: 'child' }, profile);
  assert.deepEqual(kept.pace, profile.pace, 'a patch without pace keeps it');
  const { profile: bounded } = sanitizeProfile({ pace: { tempoRatio: 9, padaPauseMs: 300, n: 99 } }, profile);
  assert.deepEqual(bounded.pace, { padaPauseMs: 300, n: 20 }, 'out of bounds: left out; n capped');
  const { profile: none } = sanitizeProfile({ pace: null }, profile);
  assert.equal(none.pace, undefined);
  assert.equal(sanitizeProfile({ name: 'X' }).profile.pace, undefined, 'no pace until the ear has measured one');
});
