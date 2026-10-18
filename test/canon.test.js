// The canonical phonetic representation: the inventory, the akṣaras with their pādas and
// weights, the realisation slots and the tokens a tradition expects, and the checks that
// hold for every verse of the reference dataset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canonOf, canonOfText, realise, validateCanon, normalizeIast, soundsOf, ipaOf, clsOf, TOKENS, VOWELS, CONSONANTS, MARKS, CANON_VERSION, TRADITIONS } from '../js/canon.js';
import { syllabify } from '../js/phon.js';
import { GITA_IRREGULAR } from '../js/chandas.js';
import { versePlan } from '../js/verses.js';

const data = JSON.parse(fs.readFileSync(new URL('../reference/gita/verses.json', import.meta.url), 'utf8'));
const byId = new Map(data.verses.map((e) => [e.id, e]));
const dataset = { id: data.dataset || 'gita', version: data.version };

test('the inventory: every token has features, an IPA form and a Common Label Set name, and the ids are the syllabifier\'s', () => {
  assert.equal(TOKENS.length, 14 + 34 + 2);
  for (const id of TOKENS) { const t = VOWELS[id] || CONSONANTS[id] || MARKS[id]; assert.ok(t && t.ipa && t.cls, id); }
  // the consonants of the alphabet come out as their own ids (ळ as ḻ, apart from the vowel ḷ)
  const c = canonOfText('क ख ग घ ङ च छ ज झ ञ ट ठ ड ढ ण त थ द ध न प फ ब भ म य र ल ळ व श ष स ह');
  assert.deepEqual(c.aksharas.map((a) => a.onset[0]), ['k', 'kh', 'g', 'gh', 'ṅ', 'c', 'ch', 'j', 'jh', 'ñ', 'ṭ', 'ṭh', 'ḍ', 'ḍh', 'ṇ', 't', 'th', 'd', 'dh', 'n', 'p', 'ph', 'b', 'bh', 'm', 'y', 'r', 'l', 'ḻ', 'v', 'ś', 'ṣ', 's', 'h']);
  const v = canonOfText('अ आ इ ई उ ऊ ऋ ॠ ऌ ॡ ए ऐ ओ औ');
  assert.deepEqual(v.aksharas.map((a) => a.vowel), ['a', 'ā', 'i', 'ī', 'u', 'ū', 'ṛ', 'ṝ', 'ḷ', 'ḹ', 'e', 'ai', 'o', 'au']);
  assert.equal(ipaOf(['k', 'ṛ', 'ṣ', 'ṇ', 'a']), 'kr̩ʂɳɐ');
  assert.equal(clsOf(['ṭ', 'ā', 'ṃ']), 'tx aa mq');
  assert.equal(CANON_VERSION, 1);
});

test('a verse: the akṣaras in their pādas with their weights, the phonemes in order, the plan the ear counts against', () => {
  const c = canonOf(byId.get('2.47'), { dataset });
  assert.equal(c.version, 1);
  assert.deepEqual(c.plan, { speakerLine: 0, padas: [8, 8, 8, 8], total: 32, checkpoints: [8, 16, 24, 32], custom: false, irregular: false, speakerUnits: [], note: null });
  assert.equal(c.counts.aksharas, 32);
  assert.equal(c.metre.name, 'Anuṣṭubh');
  assert.equal(c.metre.form, 'pathyā');
  assert.deepEqual(c.aksharas.slice(0, 4).map((a) => [a.text, a.pada, a.posInPada, a.weight]), [['ka', 0, 0, 'G'], ['rma', 0, 1, 'G'], ['ṇye', 0, 2, 'G'], ['vā', 0, 3, 'G']], 'ka and rma heavy before a cluster, ṇye and vā by their long vowels');
  assert.equal(c.aksharas[4].weight, 'L', 'vā-dhi-kā: dhi is light');
  assert.equal(c.aksharas[6].weight, 'G', 'ra before the cluster st is heavy');
  assert.equal(c.aksharas[7].padaFinal, true);
  assert.equal(c.aksharas[8].pada, 1);
  assert.deepEqual(c.tokens.slice(0, 7), ['k', 'a', 'r', 'm', 'a', 'ṇ', 'y']);
  assert.equal(c.phonemes[0].role, 'onset');
  assert.equal(c.phonemes[1].role, 'nucleus');
  assert.equal(c.phonemes[c.phonemes.length - 1].akshara, 31);
  assert.equal(c.source.verse, '2.47');
  assert.equal(c.source.dataset, 'gita');
  assert.equal(validateCanon(c).ok, true);
});

test('a verse with a speaker line: the attribution before the pādas, counted in the plan, outside the metre', () => {
  const c = canonOf(byId.get('12.1'), { dataset });
  assert.equal(c.plan.speakerLine, syllabify(byId.get('12.1').speaker.deva).length);
  assert.equal(c.aksharas[0].pada, -1);
  assert.equal(c.aksharas[c.plan.speakerLine].pada, 0);
  assert.equal(c.metre.syllables, 32);
  const without = canonOf(byId.get('12.1'), { dataset, speakerLine: false });
  assert.equal(without.plan.speakerLine, 0);
  assert.equal(without.aksharas[0].pada, 0);
});

test('the triṣṭubh family: four pādas of eleven, the kinds of each', () => {
  const c = canonOf(byId.get('2.5'), { dataset });
  assert.deepEqual(c.plan.padas, [11, 11, 11, 11]);
  assert.equal(c.metre.name, 'Upajāti');
  assert.equal(validateCanon(c).ok, true);
});

test('the slots: visarga at a pause and before k, anusvāra before a stop, ṛ, jñ, a consonant after r', () => {
  const c = canonOfText('तपः कुरु । रामः सकलं दुःखं जानाति । ज्ञानं धर्मः कृष्णः ॥');
  const kinds = c.slots.map((s) => `${s.id}@${s.context}`);
  assert.ok(kinds.includes('visarga@before-k'), kinds.join(' '));
  assert.ok(kinds.includes('visarga@before-sibilant'));
  assert.ok(kinds.includes('visarga@pause'));
  assert.ok(kinds.includes('anusvara@before-stop'));
  assert.ok(kinds.includes('jna@any'));
  assert.ok(kinds.includes('vocalic-r@any'));
  assert.ok(kinds.includes('after-r@any'));
  const visargaK = c.slots.find((s) => s.id === 'visarga' && s.context === 'before-k');
  assert.deepEqual(visargaK.realisations.map((r) => r.id), ['full', 'jihvamuliya', 'dropped']);
  assert.deepEqual(visargaK.realisations[1].next, ['kh'], 'the jihvāmūlīya is heard as the stop aspirated');
  const pause = c.slots.find((s) => s.id === 'visarga' && s.context === 'pause');
  assert.deepEqual(pause.realisations[0].tokens, ['ḥ', 'a'], 'kṛṣṇaḥ at a pause: the echo vowel a');
  assert.ok(pause.realisations.find((r) => r.id === 'dropped').error);
});

test('realise: a tradition resolves the slots, the choices override it, and every token points at its phoneme', () => {
  const c = canonOfText('कृष्णः ज्ञानं धर्मः');
  const canonical = realise(c);
  assert.deepEqual(canonical.tokens, ['k', 'ṛ', 'ṣ', 'ṇ', 'a', 'ḥ', 'j', 'ñ', 'ā', 'n', 'a', 'n', 'dh', 'a', 'r', 'm', 'a', 'ḥ', 'a'], 'the visarga before j in full, the anusvāra before dh as n, the final visarga with its echo');
  const south = realise(c, { tradition: 'south' });
  assert.deepEqual(south.tokens.slice(0, 3), ['k', 'r', 'u'], 'ṛ as ru');
  assert.equal(south.of[1], 1, 'the r stands for the vowel phoneme');
  assert.equal(south.of[2], -1, 'the u is a sound the realisation adds');
  const north = realise(c, { tradition: 'north' });
  assert.deepEqual(north.tokens.slice(0, 3), ['k', 'r', 'i']);
  assert.ok(north.tokens.join(' ').includes('ḥ g y ā'), `jña as gya: ${north.tokens.join(' ')}`);
  const chosen = realise(c, { tradition: 'north', choices: { jna: 'jna', 'visarga@pause': 'breath' } });
  assert.ok(chosen.tokens.join(' ').includes('ḥ j ñ ā'), 'the choice overrides the tradition');
  assert.equal(chosen.tokens[chosen.tokens.length - 1], 'ḥ', 'the breath alone at the pause');
  // the visarga before k realised as the jihvāmūlīya reaches into the next akṣara
  const s = realise(canonOfText('तपः कुरु'), { tradition: 'south' });
  assert.deepEqual(s.tokens, ['t', 'a', 'p', 'a', 'kh', 'u', 'r', 'u']);
  assert.ok(Object.keys(TRADITIONS).includes('maharashtra'));
});

test('the validation: nothing lost from the text, the IAST rebuilt is the dataset\'s, the pāda counts are the metre\'s', () => {
  const c = canonOf(byId.get('12.3'), { dataset });
  const v = validateCanon(c);
  assert.equal(v.ok, true, JSON.stringify(v.problems));
  // the same sounds cut into words elsewhere is not a difference of sound; a wrong vowel length is
  assert.equal(soundsOf('kaścidena māścarya'), soundsOf('kaścidenam āścarya'));
  assert.notEqual(soundsOf('nirīkṣe'), soundsOf('nirikṣe'));
  assert.equal(normalizeIast('saṅgo’astvakarmaṇi |'), 'saṃgostvakarmaṇi', 'the elided a of the avagraha and the class nasal fold');
  assert.equal(normalizeIast('OM tat'), 'om tat');
  const broken = validateCanon(c, { iast: 'ye tvākṣaram' });
  assert.equal(broken.ok, false);
  assert.equal(broken.problems[0].kind, 'iast');
});

test('the Gītā\'s irregular verses scan by the table, and the plan says so', () => {
  for (const [id, x] of Object.entries(GITA_IRREGULAR)) {
    const e = byId.get(id);
    assert.ok(e, id);
    const p = versePlan(e);
    assert.deepEqual(p.padas, x.padas, id);
    assert.equal(p.irregular, true);
    const c = canonOf(e, { dataset });
    const v = validateCanon(c);
    assert.ok(!v.problems.some((q) => q.kind === 'count' || q.kind === 'lost'), `${id}: ${JSON.stringify(v.problems)}`);
  }
  // 1.28: the attribution inside the verse is no pāda
  const c = canonOf(byId.get('1.28'), { dataset });
  assert.deepEqual(c.plan.speakerUnits, [2]);
  assert.equal(c.counts.padas, 4);
  const inner = c.aksharas.filter((a) => a.pada === -1 && a.i >= c.plan.speakerLine);
  assert.equal(inner.length, 6);
  // 2.10 opens with "tamuvāca", which is no attribution
  const t = canonOf(byId.get('2.10'), { dataset });
  assert.deepEqual(t.plan.padas, [8, 8, 8, 8]);
  assert.equal(t.metre.syllables, 32);
});

test('every entry of the dataset: lossless, its pādas counted, its metre named where the dataset names one', () => {
  let problems = 0;
  for (const e of data.verses) {
    const c = canonOf(e, { dataset });
    const v = validateCanon(c);
    for (const p of v.problems) if (p.kind === 'lost' || p.kind === 'count') { problems++; if (problems < 5) console.log(e.id, JSON.stringify(p)); }
    if (e.metre && e.metre.family) assert.equal(c.metre.family, e.metre.family, e.id); else assert.equal(c.metre, null, e.id);
    assert.equal(c.tokens.length, c.phonemes.length);
    assert.ok(c.tokens.every((t) => TOKENS.includes(t)), e.id);
  }
  assert.equal(problems, 0);
});
