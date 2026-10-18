// The canonical phonetic representation of a sloka: what a reciter is expected to sound,
// sound by sound, read from the text — the inventory of Sanskrit phonemes with their
// articulatory features (and their IPA and Common Label Set names, for interchange), the
// akṣaras with their weights and their pāda, the slots where recitation traditions differ
// (visarga at a pause, anusvāra's place, ṛ, jñ, a consonant doubled after r) with the
// realisations each permits, and the plan the ear counts against. One structure serves
// five consumers: the ear's akṣara plan, the comparison of the words heard with the text,
// the targets of a phoneme model, the expected sequence for alignment and scoring, and the
// labels of an evaluation set. Pure; built on phon.js (the syllabifier) and chandas.js
// (the metre). Versioned: CANON_VERSION changes when the rules change, and whatever is
// stored or trained records the version it was made with.

import { syllabify, aksharaText } from './phon.js';
import { syllableWeights, identifyChandas, aksharaPlan, FAMILIES } from './chandas.js';
import { splitUvaca } from './textdiff.js';
import { verseBody, versePlan } from './verses.js';

export const CANON_VERSION = 1;

// ---------- the inventory ----------
// ids are the letters phon.js gives (IAST); ळ is 'ḻ' here so that the vowel ḷ and the
// consonant keep apart in a token list. `cls` is the IIT Madras Common Label Set label
// (best effort from the published set; an interchange name, nothing in the app rests on it).
export const VOWELS = {
  a: { ipa: 'ɐ', cls: 'a', long: false }, ā: { ipa: 'aː', cls: 'aa', long: true },
  i: { ipa: 'i', cls: 'i', long: false }, ī: { ipa: 'iː', cls: 'ii', long: true },
  u: { ipa: 'u', cls: 'u', long: false }, ū: { ipa: 'uː', cls: 'uu', long: true },
  ṛ: { ipa: 'r̩', cls: 'rq', long: false }, ṝ: { ipa: 'r̩ː', cls: 'rqq', long: true },
  ḷ: { ipa: 'l̩', cls: 'lq', long: false }, ḹ: { ipa: 'l̩ː', cls: 'lqq', long: true },
  e: { ipa: 'eː', cls: 'ee', long: true }, ai: { ipa: 'ɐi', cls: 'ai', long: true },
  o: { ipa: 'oː', cls: 'oo', long: true }, au: { ipa: 'ɐu', cls: 'au', long: true },
};
const C = (ipa, cls, place, kind, voiced, asp) => ({ ipa, cls, place, kind, voiced, asp });
export const CONSONANTS = {
  k: C('k', 'k', 'velar', 'stop', false, false), kh: C('kʰ', 'kh', 'velar', 'stop', false, true), g: C('ɡ', 'g', 'velar', 'stop', true, false), gh: C('ɡʱ', 'gh', 'velar', 'stop', true, true), ṅ: C('ŋ', 'ng', 'velar', 'nasal', true, false),
  c: C('t͡ɕ', 'c', 'palatal', 'stop', false, false), ch: C('t͡ɕʰ', 'ch', 'palatal', 'stop', false, true), j: C('d͡ʑ', 'j', 'palatal', 'stop', true, false), jh: C('d͡ʑʱ', 'jh', 'palatal', 'stop', true, true), ñ: C('ɲ', 'nj', 'palatal', 'nasal', true, false),
  ṭ: C('ʈ', 'tx', 'retroflex', 'stop', false, false), ṭh: C('ʈʰ', 'txh', 'retroflex', 'stop', false, true), ḍ: C('ɖ', 'dx', 'retroflex', 'stop', true, false), ḍh: C('ɖʱ', 'dxh', 'retroflex', 'stop', true, true), ṇ: C('ɳ', 'nx', 'retroflex', 'nasal', true, false),
  t: C('t̪', 't', 'dental', 'stop', false, false), th: C('t̪ʰ', 'th', 'dental', 'stop', false, true), d: C('d̪', 'd', 'dental', 'stop', true, false), dh: C('d̪ʱ', 'dh', 'dental', 'stop', true, true), n: C('n̪', 'n', 'dental', 'nasal', true, false),
  p: C('p', 'p', 'labial', 'stop', false, false), ph: C('pʰ', 'ph', 'labial', 'stop', false, true), b: C('b', 'b', 'labial', 'stop', true, false), bh: C('bʱ', 'bh', 'labial', 'stop', true, true), m: C('m', 'm', 'labial', 'nasal', true, false),
  y: C('j', 'y', 'palatal', 'approximant', true, false), r: C('ɾ', 'r', 'retroflex', 'approximant', true, false), l: C('l', 'l', 'dental', 'approximant', true, false), ḻ: C('ɭ', 'lx', 'retroflex', 'approximant', true, false), v: C('ʋ', 'w', 'labial', 'approximant', true, false),
  ś: C('ɕ', 'sh', 'palatal', 'sibilant', false, false), ṣ: C('ʂ', 'sx', 'retroflex', 'sibilant', false, false), s: C('s', 's', 'dental', 'sibilant', false, false), h: C('ɦ', 'h', 'glottal', 'sibilant', true, true),
};
export const MARKS = {
  ṃ: { ipa: 'ŋ', cls: 'mq', kind: 'anusvara' }, // the anusvāra proper: before a stop it is the nasal of that place (realised, see the slots)
  ḥ: { ipa: 'h', cls: 'hq', kind: 'visarga' },
};
// the nasal of each place, for an anusvāra realised before a stop
const CLASS_NASAL = { velar: 'ṅ', palatal: 'ñ', retroflex: 'ṇ', dental: 'n', labial: 'm' };
// the echo vowel a visarga carries at a pause: the short of the vowel before it
const ECHO = { a: 'a', ā: 'a', i: 'i', ī: 'i', u: 'u', ū: 'u', ṛ: 'ṛ', ṝ: 'ṛ', ḷ: 'ḷ', ḹ: 'ḷ', e: 'e', ai: 'i', o: 'o', au: 'u' };

// Every token the representation can emit, in a fixed order: the vocabulary of a phoneme
// model (a CTC head's output layer), the blank left to the model.
export const TOKENS = Object.freeze([...Object.keys(VOWELS), ...Object.keys(CONSONANTS), ...Object.keys(MARKS)]);
export const tokenInfo = (id) => VOWELS[id] || CONSONANTS[id] || MARKS[id] || null;
export const ipaOf = (tokens) => tokens.map((t) => (tokenInfo(t) || { ipa: '?' }).ipa).join('');
export const clsOf = (tokens) => tokens.map((t) => (tokenInfo(t) || { cls: '?' }).cls).join(' ');

// The vowel id of an akṣara's nucleus (phon.js keeps {v, long}; Dravidian short e / o,
// which Sanskrit has not, are read as the long ones).
const vowelId = (v) => {
  if (!v) return null;
  if (v.long) return { a: 'ā', i: 'ī', u: 'ū', ṛ: 'ṝ', ḷ: 'ḹ', e: 'e', o: 'o', ai: 'ai', au: 'au' }[v.v] || v.v;
  return { e: 'e', o: 'o' }[v.v] || v.v;
};
const consId = (c) => (c.ph === 'ḷ' ? 'ḻ' : c.ph);

// ---------- the realisation slots ----------
// Where traditions differ. Each rule looks at an akṣara in its context and answers with
// the realisations permitted: `tokens` replace the slot's own phoneme(s); `next` replaces
// the first consonant of the next akṣara's onset when the sandhi reaches into it; an
// `error` realisation is one a learner makes that the detector should be able to name.
// `defaults` by tradition (TRADITIONS) pick one; the teacher's own, once decoded from the
// baseline, overrides them.
export const TRADITIONS = {
  canonical: {}, // the śikṣā reading: ṛ syllabic, jña, the visarga sounded in full before k / p / sibilants, an echo at a pause
  south: { 'vocalic-r': 'ru', 'visarga-before-k': 'jihvamuliya', 'visarga-before-p': 'upadhmaniya', 'visarga-before-sibilant': 'geminate' }, // Karnataka, Andhra, Tamil Nadu
  north: { 'vocalic-r': 'ri', jna: 'gya' },
  maharashtra: { 'vocalic-r': 'ru', jna: 'dnya' },
};
const SLOT_RULES = [
  {
    id: 'visarga',
    match: (a) => a.marks.includes('ḥ'),
    // the context names the sub-slot a tradition's default is keyed by
    context: (a, next, padaFinal) => {
      if (padaFinal || !next || !next.onset.length) return 'pause';
      const c0 = next.onset[0];
      if (c0.ph === 'k' && next.onset[1] && next.onset[1].ph === 'ṣ') return 'before-ksha';
      if (c0.kind === 'stop' && !c0.voiced && c0.place === 'velar') return 'before-k';
      if (c0.kind === 'stop' && !c0.voiced && c0.place === 'labial') return 'before-p';
      if (c0.kind === 'sibilant' && c0.ph !== 'h') return 'before-sibilant';
      return 'other';
    },
    realisations: (a, next, ctx) => {
      const c0 = next && next.onset[0];
      switch (ctx) {
        case 'pause': return [
          { id: 'echo', tokens: ['ḥ', ECHO[vowelId(a.vowel)] || 'a'], note: 'the visarga with its echo vowel (-aḥ as -aha, -iḥ as -ihi)' },
          { id: 'breath', tokens: ['ḥ'], note: 'the breath alone' },
          { id: 'dropped', tokens: [], error: true, note: 'no visarga sounded' },
        ];
        case 'before-k': return [
          { id: 'full', tokens: ['ḥ'], note: 'sounded in full' },
          { id: 'jihvamuliya', tokens: [], next: [c0.asp ? c0.ph : `${c0.ph}h`], note: 'the jihvāmūlīya: heard as the stop aspirated' },
          { id: 'dropped', tokens: [], error: true, note: 'no visarga sounded and the stop plain' },
        ];
        case 'before-p': return [
          { id: 'full', tokens: ['ḥ'], note: 'sounded in full' },
          { id: 'upadhmaniya', tokens: [], next: [c0.asp ? c0.ph : `${c0.ph}h`], note: 'the upadhmānīya: heard as the stop aspirated' },
          { id: 'dropped', tokens: [], error: true, note: 'no visarga sounded and the stop plain' },
        ];
        case 'before-sibilant': return [
          { id: 'full', tokens: ['ḥ'], note: 'sounded in full' },
          { id: 'geminate', tokens: [], next: [c0.ph, c0.ph], note: 'the sibilant doubled' },
          { id: 'dropped', tokens: [], error: true, note: 'no visarga sounded and the sibilant single' },
        ];
        default: return [
          { id: 'full', tokens: ['ḥ'], note: 'sounded in full' },
          { id: 'dropped', tokens: [], error: true, note: 'no visarga sounded' },
        ];
      }
    },
  },
  {
    id: 'anusvara',
    match: (a) => a.marks.includes('ṃ'),
    context: (a, next, padaFinal) => {
      if (padaFinal || !next || !next.onset.length) return 'pause';
      const c0 = next.onset[0];
      if ((c0.kind === 'stop' || c0.kind === 'nasal') && CLASS_NASAL[c0.place]) return 'before-stop';
      if (c0.kind === 'approximant') return 'before-semivowel';
      return 'before-sibilant'; // sibilants and h: the anusvāra proper
    },
    realisations: (a, next, ctx) => {
      const c0 = next && next.onset[0];
      if (a.src === 'ॐ') return [{ id: 'm', tokens: ['m'], note: 'oṃ: a full m, whatever follows' }, { id: 'anusvara', tokens: ['ṃ'], note: 'the nasal held' }, { id: 'dropped', tokens: [], error: true, note: 'no nasal sounded' }];
      switch (ctx) {
        case 'pause': return [
          { id: 'm', tokens: ['m'], note: 'a final m at the pause' },
          { id: 'anusvara', tokens: ['ṃ'], note: 'the nasal held, no closure' },
          { id: 'dropped', tokens: [], error: true, note: 'no nasal sounded' },
        ];
        case 'before-stop': return [
          { id: 'class-nasal', tokens: [CLASS_NASAL[c0.place]], note: `the nasal of the next sound's place (${CLASS_NASAL[c0.place]})` },
          { id: 'anusvara', tokens: ['ṃ'], note: 'the anusvāra proper, no closure' },
          { id: 'dropped', tokens: [], error: true, note: 'no nasal sounded' },
        ];
        case 'before-semivowel': return [
          { id: 'anusvara', tokens: ['ṃ'], note: 'the vowel nasalised into the semivowel' },
          { id: 'm', tokens: ['m'], note: 'a full m' },
          { id: 'dropped', tokens: [], error: true, note: 'no nasal sounded' },
        ];
        default: return [
          { id: 'anusvara', tokens: ['ṃ'], note: 'the anusvāra proper before a sibilant or h' },
          { id: 'm', tokens: ['m'], note: 'a full m' },
          { id: 'dropped', tokens: [], error: true, note: 'no nasal sounded' },
        ];
      }
    },
  },
  {
    id: 'vocalic-r',
    match: (a) => !!a.vowel && a.vowel.v === 'ṛ',
    context: () => 'any',
    realisations: (a) => [
      { id: 'syllabic', tokens: [vowelId(a.vowel)], note: 'the syllabic r' },
      { id: 'ri', tokens: ['r', a.vowel.long ? 'ī' : 'i'], note: 'ri, as in the north' },
      { id: 'ru', tokens: ['r', a.vowel.long ? 'ū' : 'u'], note: 'ru, as in Karnataka and Andhra' },
    ],
  },
  {
    id: 'jna',
    match: (a) => a.onset.length >= 2 && a.onset[0].ph === 'j' && a.onset[1].ph === 'ñ',
    context: () => 'any',
    realisations: () => [
      { id: 'jna', tokens: ['j', 'ñ'], note: 'jña' },
      { id: 'gya', tokens: ['g', 'y'], note: 'gya, as in the north' },
      { id: 'dnya', tokens: ['d', 'n', 'y'], note: 'dnya, as in Maharashtra' },
    ],
  },
  {
    id: 'after-r',
    match: (a) => a.onset.length >= 2 && a.onset[0].ph === 'r' && (a.onset[1].kind === 'stop' || a.onset[1].kind === 'nasal') && a.onset[1].ph !== a.onset[0].ph,
    context: () => 'any',
    realisations: (a) => [
      { id: 'single', tokens: a.onset.map(consId), note: 'the consonant once' },
      { id: 'doubled', tokens: [consId(a.onset[0]), consId(a.onset[1]), ...a.onset.slice(1).map(consId)], note: 'the consonant doubled after r (dharmma), as the śikṣā allows' },
    ],
  },
];

// ---------- building the representation ----------
// A text (speaker line and body, in any of the scripts or IAST) with its akṣara plan: the
// plan says where the pādas begin, by the metre (chandas.aksharaPlan) or by a verse's own
// custom plan; the text's own lines decide nothing more than that.
export function canonOfText(text, { plan = null, perPada = null, metre = null, source = null } = {}) {
  const src = String(text || '');
  const { prefix, body } = splitUvaca(src);
  const pl = plan && Array.isArray(plan.padas) ? plan : aksharaPlan(src, { perPada });
  const akshs = syllabify(src);
  const spCount = pl.speakerLine || 0;
  const weights = syllableWeights(akshs); // the whole sequence: a cluster opening the next akṣara weighs the one before, across a pāda too
  // the unit each akṣara is in: -1 the speaker line, else the pāda index
  const bounds = [];
  let acc = spCount;
  for (const n of pl.padas) { bounds.push([acc, acc + n]); acc += n; }
  const speakerUnits = new Set(Array.isArray(pl.speakerUnits) ? pl.speakerUnits : []); // units that are an attribution inside the verse, not a pāda
  const unitOf = (i) => { if (i < spCount) return -1; for (let p = 0; p < bounds.length; p++) if (i >= bounds[p][0] && i < bounds[p][1]) return speakerUnits.has(p) ? -1 : p; return bounds.length - 1; };
  const aksharas = [];
  const phonemes = [];
  const slots = [];
  // the metre: given, or read from the body (with the family the plan's count names); `false` for none
  // (on the whole text: identifyChandas takes the attribution off itself; a body already split would lose a first word that happens to end in uvāca)
  const ch = metre === false ? null : metre || identifyChandas(src, { expected: perPada ? (perPada === 11 ? 'trishtubh' : perPada === 8 ? 'anushtubh' : null) : null });
  for (let i = 0; i < akshs.length; i++) {
    const a = akshs[i];
    const pada = unitOf(i);
    const next = akshs[i + 1] || null;
    const padaFinal = next == null || unitOf(i + 1) !== pada || bounds.some(([, e]) => e === i + 1); // the last akṣara of its unit (two attributions in a row count apart)
    const from = phonemes.length;
    const push = (id, role) => { phonemes.push({ i: phonemes.length, id, role, akshara: i, word: a.word, pada }); };
    for (const c of a.onset) push(consId(c), 'onset');
    if (a.vowel) push(vowelId(a.vowel), 'nucleus');
    for (const m of a.marks) push(m, 'mark');
    for (const c of a.coda) push(consId(c), 'coda');
    const rec = {
      i, text: a.text, src: a.src, word: a.word, pada, padaFinal, posInPada: pada < 0 ? i : i - bounds[pada][0], weight: weights[i],
      onset: a.onset.map(consId), vowel: a.vowel ? vowelId(a.vowel) : null, marks: a.marks.slice(), coda: a.coda.map(consId),
      phonemes: [from, phonemes.length], slots: [],
    };
    for (const rule of SLOT_RULES) {
      if (!rule.match(a)) continue;
      const ctx = rule.context(a, next, padaFinal);
      const rs = rule.realisations(a, next, ctx);
      const slot = { k: slots.length, id: rule.id, context: ctx, akshara: i, realisations: rs, default: rs[0].id };
      slots.push(slot);
      rec.slots.push(slot.k);
    }
    aksharas.push(rec);
  }
  const words = [];
  for (const a of aksharas) { (words[a.word] = words[a.word] || []).push(a.text); }
  const iast = words.filter(Boolean).map((w) => w.join('')).join(' ');
  const checkpoints = pl.checkpoints || (() => { const c = []; let s = spCount; if (s) c.push(s); for (const n of pl.padas) { s += n; c.push(s); } return c; })();
  return {
    version: CANON_VERSION,
    source,
    text: { given: src, speakerLine: prefix, body, iast },
    metre: ch ? { family: ch.family, name: ch.name, perPada: ch.perPada, syllables: ch.syllables, exact: ch.exact, form: ch.form, confidence: ch.confidence, weights: ch.weights } : null,
    plan: { speakerLine: spCount, padas: pl.padas.slice(), total: spCount + pl.padas.reduce((x, y) => x + y, 0), checkpoints, custom: !!pl.custom, irregular: !!pl.irregular, speakerUnits: [...speakerUnits], note: pl.note || null },
    aksharas, phonemes, slots,
    tokens: phonemes.map((p) => p.id),
    counts: { aksharas: aksharas.length, phonemes: phonemes.length, padas: pl.padas.length - speakerUnits.size, slots: slots.length },
  };
}

// A dataset entry's representation: the verse's own text (speaker line included when it
// is recited) and its plan — the custom file's when the verse does not scan, else by the
// metre the dataset names.
export function canonOf(entry, { speakerLine = true, dataset = null } = {}) {
  if (!entry) return null;
  const text = verseBody(entry, { speakerLine });
  const plan = versePlan(entry, { speakerLine });
  const fam = entry.metre && entry.metre.family && FAMILIES[entry.metre.family] ? FAMILIES[entry.metre.family] : null;
  const source = { dataset: dataset && dataset.id ? dataset.id : 'gita', datasetVersion: dataset && dataset.version ? dataset.version : null, verse: entry.id, kind: entry.kind || 'verse', speakerLine: !!(speakerLine && entry.speaker && entry.speaker.deva) };
  // an entry the dataset gives no metre (a colophon: prose) is given none here either, whatever its count
  const canon = canonOfText(text, { plan, perPada: fam ? fam.perPada : null, metre: fam ? null : false, source });
  canon.text.iastGiven = [entry.speaker && speakerLine ? entry.speaker.iast : null, ...((entry.iast) || [])].filter(Boolean).join(' ');
  return canon;
}

// ---------- the realised sequence ----------
// The tokens a reciter of a tradition is expected to sound: every slot resolved to one
// realisation — the tradition's default, overridden by `choices` (slot id or `id@context`
// → realisation id, as the teacher's own decode will supply). Returns the tokens and, for
// each, the phoneme it stands for (-1 for a sound a realisation adds).
export function realise(canon, { tradition = 'canonical', choices = {} } = {}) {
  const prefs = { ...(TRADITIONS[tradition] || {}), ...choices };
  const chosen = new Map(); // akṣara index → [{ slot, realisation }]
  for (const s of canon.slots) {
    const want = prefs[`${s.id}@${s.context}`] || prefs[`${s.id}-${s.context}`] || prefs[s.id] || s.default;
    const r = s.realisations.find((x) => x.id === want) || s.realisations[0];
    (chosen.get(s.akshara) || chosen.set(s.akshara, []).get(s.akshara)).push({ slot: s, realisation: r });
  }
  const tokens = [];
  const of = [];
  const nextOverride = new Map(); // akṣara index → tokens replacing its onset's first consonant
  for (const a of canon.aksharas) {
    const here = chosen.get(a.i) || [];
    const onsetOverride = nextOverride.get(a.i) || null;
    const slotFor = (id) => here.find((x) => x.slot.id === id);
    // the onset
    const jna = slotFor('jna');
    const afterR = slotFor('after-r');
    let onset = a.onset.slice();
    if (jna) onset = [...jna.realisation.tokens, ...onset.slice(2)];
    else if (afterR) onset = afterR.realisation.tokens.slice();
    if (onsetOverride) onset = [...onsetOverride, ...onset.slice(1)];
    const pFrom = a.phonemes[0];
    onset.forEach((t, k) => { tokens.push(t); of.push(k < a.onset.length ? pFrom + k : -1); });
    // the nucleus
    const vr = slotFor('vocalic-r');
    const nucleusAt = pFrom + a.onset.length;
    if (a.vowel) { const ts = vr ? vr.realisation.tokens : [a.vowel]; ts.forEach((t, k) => { tokens.push(t); of.push(k === 0 ? nucleusAt : -1); }); }
    // the marks
    const markAt = (m) => pFrom + a.onset.length + (a.vowel ? 1 : 0) + a.marks.indexOf(m);
    for (const m of a.marks) {
      const s = slotFor(m === 'ḥ' ? 'visarga' : 'anusvara');
      const ts = s ? s.realisation.tokens : [m];
      ts.forEach((t, k) => { tokens.push(t); of.push(k === 0 ? markAt(m) : -1); });
      if (s && s.realisation.next) nextOverride.set(a.i + 1, s.realisation.next);
    }
    // the coda
    const codaAt = pFrom + a.onset.length + (a.vowel ? 1 : 0) + a.marks.length;
    a.coda.forEach((t, k) => { tokens.push(t); of.push(codaAt + k); });
  }
  return { tokens, of, tradition, choices: { ...prefs } };
}

// ---------- validation ----------
// What can be checked of a representation without a recording: that no letter of the text
// was lost (every akṣara's source joined gives the words back), that the IAST rebuilt from
// the akṣaras is the dataset's (class nasals before a stop read as anusvāra on both sides,
// the avagraha's elided vowel allowed), and that the pādas have the metre's count.
const latinNasalFold = (s) => s
  .replace(/ṅ(?=[kg])/g, 'ṃ').replace(/ñ(?=[cj])/g, 'ṃ').replace(/ṇ(?=[ṭḍ])/g, 'ṃ').replace(/n(?=[td])/g, 'ṃ').replace(/m(?=[pb])/g, 'ṃ');
// the avagraha: ऽ marks an elided a, which the dataset's IAST writes after the apostrophe
// (saṅgo’astvakarmaṇi) and the akṣaras do not carry; ॐ is om
export const normalizeIast = (s) => latinNasalFold(String(s || '').normalize('NFC').toLowerCase()
  .replace(/[|।॥]+/g, ' ').replace(/[’'ʼ]a?/g, '').replace(/ṁ/g, 'ṃ').replace(/(^|\s)oṃ(?=\s|$)/g, '$1om').replace(/[^\p{L}\p{M}\s]/gu, ' ').replace(/\s+/g, ' ').trim());
// the sounds alone: a text with its sandhi written across a space and one written joined are the same recitation
export const soundsOf = (s) => normalizeIast(s).replace(/\s+/g, '');
export function validateCanon(canon, { iast = null } = {}) {
  const problems = [];
  // lossless: the akṣaras' sources give the words back
  const words = String(canon.text.given || '').normalize('NFC').split(/[^\p{L}\p{M}]+/u).filter(Boolean);
  const byWord = [];
  for (const a of canon.aksharas) byWord[a.word] = (byWord[a.word] || '') + (a.src || '');
  words.forEach((w, k) => { if ((byWord[k] || '') !== w) problems.push({ kind: 'lost', word: k, expected: w, got: byWord[k] || '' }); });
  // the IAST rebuilt against the given one
  const given = iast != null ? iast : canon.text.iastGiven;
  if (given) {
    const a = normalizeIast(canon.text.iast);
    const b = normalizeIast(given);
    if (soundsOf(a) !== soundsOf(b)) problems.push({ kind: 'iast', rebuilt: a, given: b }); // the sounds differ: a typo on one side, or a variant reading
    else if (a !== b) problems.push({ kind: 'words', rebuilt: a, given: b }); // the same sounds, the words cut elsewhere (sandhi written across a space)
  }
  // the metre's count per pāda (a custom plan, or a verse the Gītā table knows to be irregular, sets its own)
  const pp = canon.metre && canon.metre.perPada;
  if (pp && !canon.plan.custom && !canon.plan.irregular) canon.plan.padas.forEach((n, p) => { if (n !== pp) problems.push({ kind: 'count', pada: p + 1, expected: pp, got: n }); });
  return { ok: !problems.length, problems };
}
