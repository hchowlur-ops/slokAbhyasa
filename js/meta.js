// Metadata of a sloka (the per-WAV sidecar record) and of the people who record and recite:
// the vocabularies, what can be derived from a text, what can be measured from a recording,
// and the evaluation presets that follow from a learner's and a reference's voice. Pure
// functions, shared by the browser and the server. The shape follows the research report
// "Baseline recording metadata" (reports/); the presets follow "Voice characteristics by
// age and gender".

import { HOP_SEC, stToHz } from './dsp/features.js';
import { percentile } from './dsp/util.js';

export const SCHEMA_VERSION = '1.0.0';

// Age buckets drawn where the voice changes (boys' octave drop at 12–15, women's 3 st after
// 40) and where the law draws its line (a child is under 18); never a birth date.
export const AGE_GROUPS = [
  { id: 'under8', label: 'Under 8', child: true },
  { id: '8to11', label: '8 to 11', child: true },
  { id: '12to15', label: '12 to 15', child: true },
  { id: '16to17', label: '16 to 17', child: true },
  { id: '18to39', label: '18 to 39', child: false },
  { id: '40to59', label: '40 to 59', child: false },
  { id: '60plus', label: '60 and over', child: false },
  { id: 'unspecified', label: 'Prefer not to say', child: false },
];
// Voice type rather than sex: before 12 the two sexes are acoustically alike, so a young
// child is simply "child"; the type steers the warp range and the pitch expectations.
export const VOICE_TYPES = [
  { id: 'child', label: 'Child' },
  { id: 'female', label: 'Woman or girl' },
  { id: 'male', label: 'Man or boy (voice changed)' },
  { id: 'preferNotToSay', label: 'Prefer not to say' },
];
// How the material is meant to be judged. `pitch` says what pitch means for it: style (shown,
// not scored), melody (scored as in singing) or tone (Vedic svaras; scored as a melody for now).
export const STYLE_MODES = [
  { id: 'plain_sloka', label: 'Sloka or stotra, recited', pitch: 'style', compareMode: 'recitation' },
  { id: 'vedic_accented', label: 'Vedic, with svaras', pitch: 'tone', compareMode: 'chant' },
  { id: 'sung_stotra', label: 'Stotra or bhajan, sung', pitch: 'melody', compareMode: 'singing' },
  { id: 'poem_recital', label: 'Poem', pitch: 'style', compareMode: 'recitation' },
  { id: 'read_prose', label: 'Prose or plain text', pitch: 'style', compareMode: 'recitation' },
  { id: 'song', label: 'Song', pitch: 'melody', compareMode: 'singing' },
  { id: 'classical', label: 'Indian classical', pitch: 'melody', compareMode: 'singing' },
];
export const DEFAULT_STYLE_MODE = 'plain_sloka';

export const isChildGroup = (g) => !!AGE_GROUPS.find((a) => a.id === g && a.child);
export const ageGroupLabel = (g) => (AGE_GROUPS.find((a) => a.id === g) || {}).label || '';
export const voiceTypeLabel = (v) => (VOICE_TYPES.find((t) => t.id === v) || {}).label || '';
export const styleMode = (id) => STYLE_MODES.find((m) => m.id === id) || STYLE_MODES[0];
export const compareModeFor = (styleId) => styleMode(styleId).compareMode;
export const pitchIsStyle = (styleId) => styleMode(styleId).pitch === 'style';

// A short description of a speaker for the UI: "child, 8 to 11", "woman or girl, 40 to 59".
export function speakerLabel(sp) {
  if (!sp) return '';
  const parts = [];
  if (sp.voiceType && sp.voiceType !== 'preferNotToSay') parts.push(voiceTypeLabel(sp.voiceType).toLowerCase());
  if (sp.ageGroup && sp.ageGroup !== 'unspecified') parts.push(ageGroupLabel(sp.ageGroup));
  return parts.join(', ');
}

// ---------- evaluation presets ----------

// What the comparison allows for, given who recites (the learner) and who recorded the
// reference. Adults keep the calibrated defaults; children get wider pitch and speed bands,
// a higher content floor and a larger pronunciation tolerance (speech recognition is 2–5×
// worse on children); the voice-warp search is confined to the range the pairing can need,
// so a warp cannot explain a mispronunciation away. Content floors for children are
// provisional until calibrated on teacher-accepted recordings.
export const ADULT_PRESET = Object.freeze({ pitchTolSt: 0.5, speedBand: [0.75, 1.33], contentFloor: 1.1, pronunciationTolerance: 10, warpRange: [0.74, 1.35] });
const BY_AGE = {
  under8: { pitchTolSt: 1.0, speedBand: [0.67, 1.5], contentFloor: 1.3, pronunciationTolerance: 30 },
  '8to11': { pitchTolSt: 0.75, speedBand: [0.67, 1.5], contentFloor: 1.2, pronunciationTolerance: 20 },
  '12to15': { pitchTolSt: 0.6, speedBand: [0.75, 1.33], contentFloor: 1.1, pronunciationTolerance: 15 },
  '60plus': { pitchTolSt: 0.5, speedBand: [0.67, 1.33], contentFloor: 1.1, pronunciationTolerance: 10 },
};
const youngChild = (sp) => sp && (sp.ageGroup === 'under8' || sp.ageGroup === '8to11' || sp.voiceType === 'child');
const knownType = (sp) => sp && sp.voiceType && sp.voiceType !== 'preferNotToSay' ? sp.voiceType : null;

export function presetsFor(learner, reference) {
  const age = learner && BY_AGE[learner.ageGroup];
  const p = { ...ADULT_PRESET, ...(age || {}) };
  const lt = knownType(learner);
  const rt = knownType(reference);
  if (youngChild(learner) || youngChild(reference) || lt === 'child' || rt === 'child') p.warpRange = [0.67, 1.5];
  else if (lt && rt && lt === rt && !isChildGroup(learner && learner.ageGroup) && !isChildGroup(reference && reference.ageGroup)) p.warpRange = [0.86, 1.16];
  else if (lt && rt) p.warpRange = [0.8, 1.25];
  p.learnerAgeGroup = learner && learner.ageGroup ? learner.ageGroup : 'unspecified';
  return p;
}

// ---------- text ----------

const INDIC_BLOCKS = new Map([[0x0900, 'Deva'], [0x0980, 'Beng'], [0x0a00, 'Guru'], [0x0a80, 'Gujr'], [0x0b00, 'Orya'], [0x0b80, 'Taml'], [0x0c00, 'Telu'], [0x0c80, 'Knda'], [0x0d00, 'Mlym']]);
const SCRIPT_LANGUAGE = { Deva: 'sa', Knda: 'kn', Taml: 'ta', Telu: 'te', Mlym: 'ml', Beng: 'bn', Gujr: 'gu', Guru: 'pa', Orya: 'or', Latn: 'en' };

// ISO 15924 code of the script most of the letters are in.
export function detectScript(text) {
  const counts = new Map();
  for (const ch of String(text || '')) {
    const cp = ch.codePointAt(0);
    const block = INDIC_BLOCKS.get(cp & ~0x7f);
    const key = block || (/\p{Script=Latin}/u.test(ch) ? 'Latn' : null);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = null;
  for (const [k, n] of counts) if (!best || n > counts.get(best)) best = k;
  return best || 'Zyyy';
}

// Vowel-terminated syllables: every vowel ends an akṣara (independent vowel, vowel sign, or
// a consonant carrying its inherent "a"). Latin: vowel groups.
export function countAksharas(text) {
  let n = 0;
  let inherent = false;
  let latinVowel = false;
  for (const ch of String(text || '').normalize('NFC')) {
    const cp = ch.codePointAt(0);
    const base = cp & ~0x7f;
    if (INDIC_BLOCKS.has(base)) {
      latinVowel = false;
      const o = cp - base;
      if ((o >= 0x15 && o <= 0x39) || (o >= 0x58 && o <= 0x5f)) { if (inherent) n++; inherent = true; }
      else if (o >= 0x3e && o <= 0x4c) { n++; inherent = false; }
      else if (o === 0x4d) inherent = false;
      else if (o >= 0x05 && o <= 0x14) { if (inherent) n++; inherent = false; n++; }
      else if (o === 0x50) { if (inherent) n++; inherent = false; n++; }
      continue;
    }
    if (inherent) { n++; inherent = false; }
    const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (/[aeiou]/.test(plain)) { if (!latinVowel) n++; latinVowel = true; } else latinVowel = false;
  }
  if (inherent) n++;
  return n;
}

// Splits a text into pādas on daṇḍas and line breaks. boundaryType: 'sloka' after ॥, 'ardha'
// after ।, 'pada' after a bare line break (or a Latin |, || and sentence stops).
export function splitPadas(body) {
  const text = String(body || '').replace(/\r\n?/g, '\n');
  const padas = [];
  let cur = '';
  let start = 0;
  let i = 0;
  const flush = (end, boundaryType) => {
    const t = cur.trim();
    if (t) padas.push({ index: padas.length + 1, text: t, charStart: start, charEnd: end, boundaryType });
    cur = '';
    start = end;
  };
  const chars = Array.from(text);
  for (const ch of chars) {
    i += ch.length;
    if (ch === '॥') { flush(i, 'sloka'); continue; }
    if (ch === '।') { flush(i, 'ardha'); continue; }
    if (ch === '\n') { if (cur.trim()) flush(i, 'pada'); else start = i; continue; }
    cur += ch;
  }
  if (cur.trim()) flush(i, 'pada');
  // "||" and "|" in Latin texts
  return padas.map((p) => ({ ...p, text: p.text.replace(/\s*\|+\s*$/, '').trim() })).filter((p) => p.text);
}

// Everything the evaluation can learn from the words alone.
export function deriveText(body, { language = null, script = null } = {}) {
  const text = String(body || '').trim();
  if (!text) return null;
  const sc = script || detectScript(text);
  const padas = splitPadas(text);
  const aksharaCount = countAksharas(text);
  const pauses = padas.slice(0, -1).map((p, k) => ({ afterPada: p.index, kind: p.boundaryType, licensed: true, k }));
  return {
    body: text,
    language: language || SCRIPT_LANGUAGE[sc] || 'und',
    script: sc,
    padas,
    aksharaCount,
    pauses: pauses.map(({ k, ...rest }) => rest),
    svara: { prescribed: /[॒॑᳐-᳿]/.test(text) },
  };
}

// ---------- measured voice ----------

const dbfs = (x) => 20 * Math.log10(Math.max(x, 1e-9));

// What a recording says about the voice and the capture, from its samples and features.
export function voiceStats(features, samples, { aksharaCount = null } = {}) {
  const F = features;
  const voiced = [];
  for (let i = 0; i < F.n; i++) if (!Number.isNaN(F.st[i]) && F.conf[i] >= 0.8) voiced.push(F.st[i]);
  voiced.sort((a, b) => a - b);
  const st = (q) => (voiced.length ? percentile(voiced, q) : NaN);
  let first = -1;
  let last = -1;
  let activeFrames = 0;
  let rmsSum = 0;
  for (let i = 0; i < F.n; i++) {
    if (!F.active[i]) continue;
    if (first < 0) first = i;
    last = i;
    activeFrames++;
    rmsSum += Math.pow(10, F.rmsDb[i] / 10);
  }
  let peak = 0;
  let clipped = 0;
  if (samples) {
    for (let i = 0; i < samples.length; i++) {
      const a = Math.abs(samples[i]);
      if (a > peak) peak = a;
      if (a >= 0.985) clipped++;
    }
  }
  const rmsDb = activeFrames ? 10 * Math.log10(rmsSum / activeFrames) : NaN;
  const floorDb = Math.max(F.floorDb, -100); // digital silence has no floor worth reporting
  const activeSec = activeFrames * HOP_SEC;
  const round = (v, d = 1) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
  const med = st(0.5);
  return {
    voice: {
      medianF0Hz: round(Number.isNaN(med) ? NaN : stToHz(med)),
      f0P10Hz: round(Number.isNaN(st(0.1)) ? NaN : stToHz(st(0.1))),
      f0P90Hz: round(Number.isNaN(st(0.9)) ? NaN : stToHz(st(0.9))),
      f0RangeSemitones: round(voiced.length ? st(0.9) - st(0.1) : NaN),
      voicedFraction: round(F.voicedFrac, 2),
      leadSilenceSec: round(first >= 0 ? first * HOP_SEC : 0, 2),
      trailSilenceSec: round(last >= 0 ? (F.n - 1 - last) * HOP_SEC : 0, 2),
      activeSec: round(activeSec, 2),
      tempoSylPerSec: aksharaCount && activeSec > 0 ? round(aksharaCount / activeSec, 2) : null,
    },
    measured: {
      durationSec: round(F.duration, 2),
      sampleCount: samples ? samples.length : null,
      peakDbfs: samples ? round(dbfs(peak)) : null,
      rmsDbfs: round(rmsDb),
      noiseFloorDbfs: round(floorDb),
      snrDb: round(rmsDb - floorDb),
      clippedSampleCount: samples ? clipped : null,
    },
  };
}

// ---------- the record ----------

// A new sidecar record for a baseline, from what the app knows at save time. Fields the
// server fills in (audio hash, software) are left for it.
export function newBaselineMeta({ name, source, speaker = null, style = null, text = null, stats = null, capture = null, edit = null, consent = null } = {}) {
  const mode = (style && style.mode) || DEFAULT_STYLE_MODE;
  return {
    schemaVersion: SCHEMA_VERSION,
    name,
    source,
    role: 'teacher',
    speaker: speaker ? { profileId: speaker.id || speaker.profileId || null, voiceType: speaker.voiceType || 'preferNotToSay', ageGroup: speaker.ageGroup || 'unspecified' } : { profileId: null, voiceType: 'preferNotToSay', ageGroup: 'unspecified' },
    style: { mode, pitchPrescribed: style && typeof style.pitchPrescribed === 'boolean' ? style.pitchPrescribed : !pitchIsStyle(mode), tradition: (style && style.tradition) || null },
    text: text ? deriveText(text.body, { language: text.language, script: text.script }) : null,
    voice: stats ? stats.voice : null,
    measured: stats ? stats.measured : null,
    capture: capture || null,
    edit: edit || { trimStartSec: 0, trimEndSec: 0 },
    consent: consent || { givenBy: 'unspecified', shareScope: 'private' },
  };
}
