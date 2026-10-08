// Re-runs the comparison of a kept quiz recording against its slokas, outside the browser,
// and prints what the scoring saw: match contrast, the stretches compared, tempo, voice
// warp, key offset, scores and deviations. For looking into a surprising verdict and
// tuning the parameters in js/dsp.
//
//   node tools/analyse-attempt.mjs <quiz id or name fragment> [attempt number, default last]
//   node tools/analyse-attempt.mjs --wav path/to/take.wav <sloka id or name> [...]
//
// Options: --judge-speed, --no-ignore-key, --learner=child:8to11 (voiceType:ageGroup),
//          --no-harmonise (keep each recording's own silence threshold), --no-warps (the
//          take as recorded, no voice warp), --no-locate (never search, compare whole)

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeWav } from '../js/wav.js';
import { resample } from '../js/dsp/resample.js';
import { extractFeatures, SR } from '../js/dsp/features.js';
import { compareAuto, MISMATCH_CONTRAST } from '../js/dsp/compare.js';
import { locate } from '../js/dsp/locate.js';
import { compareModeFor } from '../js/meta.js';
import { resolveDataDir } from '../datadir.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolveDataDir(ROOT);
const LIB = path.join(DATA, 'library');
const QUIZZES = path.join(DATA, 'quizzes');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const positional = args.filter((a) => !a.startsWith('--'));

const index = JSON.parse(await fsp.readFile(path.join(LIB, 'index.json'), 'utf8'));
const findSloka = (key) => index.find((r) => r.id === key) || index.find((r) => r.name.toLowerCase() === key.toLowerCase()) || index.find((r) => r.name.toLowerCase().includes(key.toLowerCase()));
const readMeta = async (r) => { try { return JSON.parse(await fsp.readFile(path.join(LIB, ...r.file.replace(/\.wav$/i, '.json').split('/')), 'utf8')); } catch { return null; } };
const loadWav = async (p) => { const d = decodeWav(new Uint8Array(await fsp.readFile(p))); return { ...d, duration: d.samples.length / d.sampleRate }; };

let takePath;
let slokas;
let label;
if (flag('wav')) {
  takePath = positional[0];
  slokas = positional.slice(1).map(findSloka).filter(Boolean);
  label = path.basename(takePath);
} else {
  const key = positional[0];
  if (!key) { console.error('usage: node tools/analyse-attempt.mjs <quiz id or name> [attempt]'); process.exit(1); }
  const files = (await fsp.readdir(QUIZZES)).filter((f) => f.endsWith('.json'));
  const quizzes = [];
  for (const f of files) quizzes.push(JSON.parse(await fsp.readFile(path.join(QUIZZES, f), 'utf8')));
  const q = quizzes.find((x) => x.id === key) || quizzes.find((x) => x.name.toLowerCase().includes(key.toLowerCase()));
  if (!q) { console.error(`no quiz matches "${key}"; have: ${quizzes.map((x) => x.name).join(', ')}`); process.exit(1); }
  const n = positional[1] ? Number(positional[1]) : q.attempts.length;
  const a = q.attempts[n - 1];
  if (!a) { console.error(`quiz "${q.name}" has ${q.attempts.length} attempt(s)`); process.exit(1); }
  if (!a.audio) { console.error(`attempt ${n} of "${q.name}" has no recording kept (made before recordings were kept)`); process.exit(1); }
  takePath = path.join(QUIZZES, q.id, a.audio);
  slokas = q.items.map((it) => findSloka(it.id)).filter(Boolean);
  label = `${q.name} · attempt ${n}`;
  console.log(`attempt ${n} of "${q.name}" (${a.at}), saved scores: ${JSON.stringify(a.items.map((it) => ({ name: it.name, matched: it.matched, content: it.content, pronunciation: it.pronunciation, diag: it.diag })))}`);
}

const take = await loadWav(takePath);
console.log(`\ntake: ${label} · ${take.duration.toFixed(1)} s @ ${take.sampleRate} Hz`);
const H = extractFeatures(resample(take.samples, take.sampleRate, SR), { warps: !flag('no-warps') });
console.log(`  peak ${H.peakDb.toFixed(1)} dB · threshold ${H.thrDb.toFixed(1)} dB (${(H.thrDb - H.peakDb).toFixed(1)} rel) · active ${(100 * H.activeFrac).toFixed(0)} % · voiced ${(100 * H.voicedFrac).toFixed(0)} %`);

const learner = opt('learner') ? { voiceType: opt('learner').split(':')[0], ageGroup: opt('learner').split(':')[1] || 'unspecified' } : null;
for (const r of slokas) {
  const meta = await readMeta(r);
  const base = await loadWav(path.join(LIB, ...r.file.split('/')));
  const B = extractFeatures(resample(base.samples, base.sampleRate, SR));
  const mode = meta && meta.style && !meta.migrated ? compareModeFor(meta.style.mode) : 'chant';
  const options = {
    ignoreKey: !flag('no-ignore-key'), judgeSpeed: flag('judge-speed'), flagDynamics: true, mode, learner,
    reference: meta && meta.speaker && meta.speaker.voiceType !== 'preferNotToSay' ? meta.speaker : null,
    harmonise: !flag('no-harmonise'), locate: !flag('no-locate'),
  };
  console.log(`\n=== ${r.name} · ${base.duration.toFixed(1)} s · peak ${B.peakDb.toFixed(1)} dB · threshold ${(B.thrDb - B.peakDb).toFixed(1)} rel · active ${(100 * B.activeFrac).toFixed(0)} % · mode ${mode}`);
  const res = compareAuto(B, H, options);
  const m = res.match;
  console.log(`  match: ${m.ok ? 'OK' : 'NOT FOUND'} · contrast ${m.contrast == null ? '–' : m.contrast.toFixed(3)} (gate ${MISMATCH_CONTRAST}) · located ${m.located || 'no (similar lengths)'}`);
  console.log(`  compared: sloka ${res.matched.base.map((t) => t.toFixed(1)).join('–')} s · take ${res.matched.heard.map((t) => t.toFixed(1)).join('–')} s · tempo ×${res.tempoRatio.toFixed(2)} · voice warp ${res.voiceWarp} · key ${res.keyOffset == null ? '–' : res.keyOffset.toFixed(1)} st`);
  console.log(`  scores: ${JSON.stringify(res.scores)}`);
  console.log(`  deviations (${res.deviations.length}): ${res.deviations.slice(0, 12).map((d) => `${d.type}@${d.tBase[0].toFixed(1)}–${d.tBase[1].toFixed(1)}s`).join(', ')}${res.deviations.length > 12 ? ', …' : ''}`);
  for (const n of res.notes) console.log(`  note: ${n}`);
  // the search both ways, for the record
  const fwd = locate(H, B);
  const back = locate(B, H);
  console.log(`  locate take-in-sloka: cost ${fwd ? fwd.cost.toFixed(3) : '–'} contrast ${fwd ? fwd.contrast.toFixed(3) : '–'} · sloka-in-take: cost ${back ? back.cost.toFixed(3) : '–'} contrast ${back ? back.contrast.toFixed(3) : '–'}`);
}
