// Server-side store for sloka metadata and speaker profiles.
//
// Every WAV in the library has a sidecar "<name>.json" beside it: the source of truth for
// who recorded it, what it is (text, style), what was measured, and a hash of the audio it
// describes. The sidecar travels with the WAV by name, so slokas moved or copied with
// Explorer keep their metadata. People's names never enter the library: the sidecar carries
// a profile id and the voice type / age group only; names live in <data>/profiles.json.
// The pure shapes and vocabularies are in js/meta.js (shared with the browser).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { newBaselineMeta, deriveText, SCHEMA_VERSION, AGE_GROUPS, VOICE_TYPES, STYLE_MODES, DEFAULT_STYLE_MODE } from './js/meta.js';
import { parseWavHeader } from './js/libutil.js';
import { FEAT_VERSION } from './js/dsp/features.js';

export const APP_NAME = 'SlokAbhyasa';
export const APP_VERSION = (() => { try { return JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version || '0'; } catch { return '0'; } })();

const AGE_IDS = new Set(AGE_GROUPS.map((a) => a.id));
const VOICE_IDS = new Set(VOICE_TYPES.map((v) => v.id));
const STYLE_IDS = new Set(STYLE_MODES.map((m) => m.id));
const SHARE_SCOPES = new Set(['private', 'family', 'class', 'public']);
const CONSENT_BY = new Set(['unspecified', 'self', 'guardian', 'teacher']);

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pick = (obj, keys, f = num) => {
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = f(obj[k]);
  return out;
};

// ---------- audio identity ----------

// SHA-256 of the PCM data chunk alone, so re-saving with different header chunks (bext,
// LIST) does not change the identity of the recording.
export function pcmSha256(wavBytes) {
  const info = parseWavHeader(wavBytes, wavBytes.length);
  const data = info ? wavBytes.subarray(info.dataOffset, info.dataOffset + info.dataBytes) : wavBytes;
  return createHash('sha256').update(data).digest('hex');
}

export function audioInfo(wavBytes) {
  const info = parseWavHeader(wavBytes, wavBytes.length);
  if (!info) return null;
  return { pcmSha256: pcmSha256(wavBytes), durationSec: Number(info.duration.toFixed(3)), sampleRate: info.sampleRate, channels: info.channels, bitDepth: info.bits, format: 'wav/pcm' };
}

// ---------- BWF bext chunk ----------
// A Broadcast Wave "bext" chunk in the WAV itself, so a file that travels without its
// sidecar still says what it is and when it was made. Version 1 layout (602 bytes + coding
// history); every text field is ASCII, padded with NULs.

const BEXT_SIZE = 602;
const ascii = (s, n) => Buffer.from(String(s || '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '').slice(0, n).padEnd(n, '\0'), 'latin1');

export function makeBext({ description, originator = APP_NAME, originatorRef = '', date = new Date(), sampleRate = 48000 }) {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  const dateStr = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const timeStr = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const history = Buffer.from(`A=PCM,F=${sampleRate},W=16,M=mono,T=${APP_NAME} ${APP_VERSION}\r\n`, 'latin1');
  const body = Buffer.alloc(BEXT_SIZE + history.length + (history.length & 1));
  ascii(description, 256).copy(body, 0);
  ascii(originator, 32).copy(body, 256);
  ascii(originatorRef, 32).copy(body, 288);
  ascii(dateStr, 10).copy(body, 320);
  ascii(timeStr, 8).copy(body, 330);
  body.writeUInt32LE(0, 338); // time reference low
  body.writeUInt32LE(0, 342); // time reference high
  body.writeUInt16LE(1, 346); // version
  // 348..411 UMID (zero), 412..421 loudness fields (zero), 422..601 reserved
  history.copy(body, BEXT_SIZE);
  const chunk = Buffer.alloc(8 + body.length);
  chunk.write('bext', 0, 'latin1');
  chunk.writeUInt32LE(body.length, 4);
  body.copy(chunk, 8);
  return chunk;
}

// Returns the WAV bytes with `bext` placed right after the RIFF header (any existing bext
// removed). Decoders walk chunks by their size fields, so the audio is untouched.
export function withBext(wavBytes, fields) {
  const buf = Buffer.isBuffer(wavBytes) ? wavBytes : Buffer.from(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength);
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') return buf;
  const parts = [];
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const end = Math.min(buf.length, pos + 8 + size + (size & 1));
    if (id !== 'bext') parts.push(buf.subarray(pos, end));
    pos = end;
  }
  const bext = makeBext(fields);
  const total = 4 + bext.length + parts.reduce((s, p) => s + p.length, 0);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(total, 4);
  head.write('WAVE', 8, 'latin1');
  return Buffer.concat([head, bext, ...parts]);
}

// ---------- sidecars ----------

const metaFile = (wavPath) => wavPath.replace(/\.wav$/i, '.json');

export async function readMeta(wavPath) {
  try {
    const m = JSON.parse(await fsp.readFile(metaFile(wavPath), 'utf8'));
    return m && typeof m === 'object' && !Array.isArray(m) ? m : null;
  } catch {
    return null;
  }
}

export async function writeMeta(wavPath, meta) {
  meta.updatedAt = new Date().toISOString();
  await fsp.writeFile(metaFile(wavPath), JSON.stringify(meta, null, 2) + '\n');
  return meta;
}

export async function removeMeta(wavPath) {
  await fsp.rm(metaFile(wavPath), { force: true });
}

export async function moveMeta(oldWavPath, newWavPath) {
  try { await fsp.rename(metaFile(oldWavPath), metaFile(newWavPath)); } catch { /* no sidecar yet */ }
}

const software = () => ({ app: APP_NAME, version: APP_VERSION, featVersion: FEAT_VERSION });

// A sidecar for a library record that has none (a sloka saved before metadata existed, or
// a WAV dropped in with Explorer): nothing is guessed about the speaker.
export function migratedMeta(rec, wavBytes) {
  const meta = newBaselineMeta({ name: rec.name, source: rec.source || 'file' });
  meta.id = rec.id;
  meta.createdAt = rec.createdAt || new Date().toISOString();
  meta.audio = wavBytes ? audioInfo(wavBytes) : null;
  meta.software = software();
  meta.migrated = true;
  return meta;
}

// Makes sure a record has a sidecar; returns it. The audio is read only when a sidecar has
// to be created (for its hash).
export async function ensureMeta(rec, wavPath) {
  const have = await readMeta(wavPath);
  if (have) {
    let changed = false;
    if (have.id !== rec.id) { have.id = rec.id; changed = true; }
    if (!have.schemaVersion) { have.schemaVersion = SCHEMA_VERSION; changed = true; }
    if (changed) await writeMeta(wavPath, have);
    return have;
  }
  let bytes = null;
  try { bytes = await fsp.readFile(wavPath); } catch { bytes = null; }
  return writeMeta(wavPath, migratedMeta(rec, bytes));
}

// Validates the parts of a sidecar a client may set. Server-owned fields (id, audio,
// software, createdAt) are kept from `current`.
function sanitizeChandas(c) {
  const verse = c.verse && typeof c.verse === 'object' && num(c.verse.chapter) && num(c.verse.verse) ? { chapter: c.verse.chapter, verse: c.verse.verse } : null;
  return {
    family: str(c.family, 20) || null, name: str(c.name, 40) || null, perPada: num(c.perPada), padas: 4,
    syllables: num(c.syllables), expectedSyllables: num(c.expectedSyllables), exact: !!c.exact, form: str(c.form, 20) || null,
    weights: str(c.weights, 200) || '', confidence: num(c.confidence), source: str(c.source, 20) || null, language: str(c.language, 20) || null,
    verse, at: str(c.at, 40) || null,
  };
}

export function sanitizeMeta(body, current) {
  const b = body && typeof body === 'object' ? body : {};
  const cur = current || {};
  const sp = b.speaker && typeof b.speaker === 'object' ? b.speaker : cur.speaker || {};
  const st = b.style && typeof b.style === 'object' ? b.style : cur.style || {};
  const mode = STYLE_IDS.has(st.mode) ? st.mode : (cur.style && cur.style.mode) || DEFAULT_STYLE_MODE;
  const tradition = str(st.tradition, 80) || null;
  const base = newBaselineMeta({
    name: str(b.name, 80) || cur.name || 'Untitled',
    source: b.source === 'file' || b.source === 'mic' ? b.source : cur.source || 'file',
    speaker: { profileId: str(sp.profileId, 40) || null, voiceType: VOICE_IDS.has(sp.voiceType) ? sp.voiceType : 'preferNotToSay', ageGroup: AGE_IDS.has(sp.ageGroup) ? sp.ageGroup : 'unspecified' },
    style: { mode, tradition, pitchPrescribed: typeof st.pitchPrescribed === 'boolean' ? st.pitchPrescribed : undefined },
  });
  // text: a body re-derives everything; an explicit null clears it; absent keeps the current
  if (b.text === null) base.text = null;
  else if (b.text && typeof b.text === 'object' && typeof b.text.body === 'string') {
    const t = deriveText(b.text.body.slice(0, 20000), { language: str(b.text.language, 10) || null, script: str(b.text.script, 8) || null });
    if (t) { t.origin = b.text.origin === 'transcript' ? 'transcript' : 'typed'; if (b.text.title) t.title = str(b.text.title, 120); }
    base.text = t;
  } else base.text = cur.text || null;
  // chandas: the metre read from the text or transcript (js/chandas.js); null clears it
  if (b.chandas === null) base.chandas = null;
  else if (b.chandas && typeof b.chandas === 'object') base.chandas = sanitizeChandas(b.chandas);
  else base.chandas = cur.chandas || null;
  base.voice = b.voice && typeof b.voice === 'object' ? pick(b.voice, ['medianF0Hz', 'f0P10Hz', 'f0P90Hz', 'f0RangeSemitones', 'voicedFraction', 'leadSilenceSec', 'trailSilenceSec', 'activeSec', 'tempoSylPerSec']) : cur.voice || null;
  base.measured = b.measured && typeof b.measured === 'object' ? pick(b.measured, ['durationSec', 'sampleCount', 'peakDbfs', 'rmsDbfs', 'noiseFloorDbfs', 'snrDb', 'clippedSampleCount']) : cur.measured || null;
  if (b.capture && typeof b.capture === 'object') {
    const c = b.capture;
    base.capture = {
      device: str(c.device, 120) || null,
      sampleRate: num(c.sampleRate),
      channelCount: num(c.channelCount),
      echoCancellation: typeof c.echoCancellation === 'boolean' ? c.echoCancellation : null,
      noiseSuppression: typeof c.noiseSuppression === 'boolean' ? c.noiseSuppression : null,
      autoGainControl: typeof c.autoGainControl === 'boolean' ? c.autoGainControl : null,
      userAgent: str(c.userAgent, 300) || null,
      environment: str(c.environment, 40) || null,
    };
  } else base.capture = cur.capture || null;
  base.edit = b.edit && typeof b.edit === 'object' ? { trimStartSec: num(b.edit.trimStartSec) || 0, trimEndSec: num(b.edit.trimEndSec) || 0 } : cur.edit || { trimStartSec: 0, trimEndSec: 0 };
  const cs = b.consent && typeof b.consent === 'object' ? b.consent : cur.consent || {};
  base.consent = { givenBy: CONSENT_BY.has(cs.givenBy) ? cs.givenBy : 'unspecified', shareScope: SHARE_SCOPES.has(cs.shareScope) ? cs.shareScope : 'private' };
  base.notes = str(b.notes !== undefined ? b.notes : cur.notes, 2000) || null;
  // server-owned
  base.id = cur.id || null;
  base.createdAt = cur.createdAt || new Date().toISOString();
  base.audio = cur.audio || null;
  base.software = cur.software || software();
  if (cur.migrated && !b.speaker && !b.text) base.migrated = true;
  return base;
}

// The text of the bext description: what a stranger finding the file should know.
export function bextDescription(meta) {
  const parts = [meta.name];
  if (meta.style && meta.style.mode) parts.push(STYLE_MODES.find((m) => m.id === meta.style.mode)?.label || meta.style.mode);
  if (meta.speaker && (meta.speaker.voiceType !== 'preferNotToSay' || meta.speaker.ageGroup !== 'unspecified')) parts.push(`${meta.speaker.voiceType} ${meta.speaker.ageGroup}`);
  if (meta.text && meta.text.language) parts.push(`lang=${meta.text.language}`);
  return `${APP_NAME}: ${parts.filter(Boolean).join(' | ')}`;
}

// ---------- speaker profiles ----------
// <data>/profiles.json: the people who use this installation, each with a voice type and
// an age group, used as the learner (who recites in Self Evaluation and quizzes) and as
// the speaker of a sloka recorded in Learn. Deleting a profile leaves the slokas' sidecars
// with their voice type and age group, only the link to the name goes.

export const PROFILES_VERSION = '1.0.0';

export async function readProfiles(file) {
  try {
    const p = JSON.parse(await fsp.readFile(file, 'utf8'));
    return p && Array.isArray(p.profiles) ? p.profiles.filter((x) => x && typeof x.id === 'string') : [];
  } catch {
    return [];
  }
}

export async function writeProfiles(file, profiles) {
  await fsp.writeFile(file, JSON.stringify({ schemaVersion: PROFILES_VERSION, profiles }, null, 2) + '\n');
}

export function sanitizeProfile(body, current = null) {
  const b = body && typeof body === 'object' ? body : {};
  const name = str(b.name, 60) || (current && current.name) || '';
  if (!name) return { error: 'A profile needs a name' };
  const voiceType = VOICE_IDS.has(b.voiceType) ? b.voiceType : (current && current.voiceType) || 'preferNotToSay';
  const ageGroup = AGE_IDS.has(b.ageGroup) ? b.ageGroup : (current && current.ageGroup) || 'unspecified';
  const roles = Array.isArray(b.roles) ? b.roles.filter((r) => r === 'learner' || r === 'teacher') : (current && current.roles) || ['learner'];
  const now = new Date().toISOString();
  return {
    profile: {
      id: (current && current.id) || `p-${now.replace(/\D/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      voiceType,
      ageGroup,
      roles: roles.length ? roles : ['learner'],
      createdAt: (current && current.createdAt) || now,
      updatedAt: now,
    },
  };
}
