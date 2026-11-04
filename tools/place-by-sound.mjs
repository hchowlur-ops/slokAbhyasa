// Placement by sound alone, in order — a measurement over kept recitals, not a part of the app.
//
// For every recital (an evaluation of several slokas with its take kept) since a date, each
// sloka's reference recording is located in the take by sound (js/dsp/locate.js at five
// tempos, the best contrast kept); the surest sloka is fixed first, and the others are then
// searched only in the room their order leaves them, until all are placed. Two references
// are tried for every sloka: its library recording, and the learner's own most recent clean
// solo take of it before the recital. Prints every sloka's placement under each, the cuts
// between slokas (the middle of the gap between two placements), the ear's and the second
// opinion's cuts beside them, and a tally: how often the two references agree within 0.7 s,
// and how the ear and the second opinion fare against the cuts the two references agree on.
// A placement with contrast under 0.85 is sure; at 0.9 or more the reference was not found.
//
//   node tools/place-by-sound.mjs [--since 2026-10-20] [--only <session id or its tail>] [--data <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeWav } from '../js/wav.js';
import { resample } from '../js/dsp/resample.js';
import { extractFeatures, SR, HOP_SEC } from '../js/dsp/features.js';
import { locate, stretchFeatures, sliceFeatures } from '../js/dsp/locate.js';
import { resolveDataDir } from '../datadir.js';
import { readLibraryIndexSync } from '../datafile.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DATA = opt('--data', process.env.SLOKABHYASA_DATA || resolveDataDir(ROOT));
const SINCE = opt('--since', '2026-10-20');
const ONLY = opt('--only', null);
export const TEMPOS = [0.8, 0.9, 1, 1.1, 1.25];
export const SURE = 0.85;
const r2 = (x) => (x == null || !Number.isFinite(x) ? '—' : (Math.round(x * 100) / 100).toFixed(2));
const featuresOf = (p) => { const d = decodeWav(new Uint8Array(fs.readFileSync(p))); return { F: extractFeatures(resample(d.samples, d.sampleRate, SR)), duration: d.samples.length / d.sampleRate }; };

// locate the reference B inside frames lo..hi of the take H, the best of the tempos
export function bestIn(B, H, lo, hi) {
  if (hi - lo < 2) return null;
  const W = lo === 0 && hi === H.n - 1 ? H : sliceFeatures(H, lo, hi);
  let best = null;
  for (const k of TEMPOS) {
    const loc = locate(stretchFeatures(B, k), W);
    if (loc && (!best || loc.contrast < best.contrast)) best = { from: (lo + loc.start) * HOP_SEC, to: (lo + loc.end) * HOP_SEC, f0: lo + loc.start, f1: lo + loc.end, contrast: loc.contrast, k };
  }
  return best;
}

// place the references (in recital order; null where a sloka has none) in the take H: the
// surest first, the rest within the room their order leaves. Returns the placements and the
// order they were fixed in.
export function placeOrdered(H, refs) {
  const n = refs.length;
  const placed = new Array(n).fill(null);
  const region = (i) => {
    let lo = 0; let hi = H.n - 1;
    for (let j = i - 1; j >= 0; j--) if (placed[j]) { lo = placed[j].f1 + 1; break; }
    for (let j = i + 1; j < n; j++) if (placed[j]) { hi = placed[j].f0 - 1; break; }
    return [lo, hi];
  };
  const cand = new Array(n).fill(null);
  const dirty = new Array(n).fill(true);
  const order = [];
  for (let step = 0; step < n; step++) {
    for (let i = 0; i < n; i++) if (!placed[i] && dirty[i] && refs[i]) { const [lo, hi] = region(i); cand[i] = bestIn(refs[i].F, H, lo, hi); dirty[i] = false; }
    let pick = -1;
    for (let i = 0; i < n; i++) if (!placed[i] && cand[i] && (pick < 0 || cand[i].contrast < cand[pick].contrast)) pick = i;
    if (pick < 0) break;
    placed[pick] = cand[pick];
    order.push({ index: pick, contrast: cand[pick].contrast });
    for (let i = 0; i < n; i++) if (!placed[i]) dirty[i] = true;
  }
  return { placed, order };
}

const cutsOf = (placed) => placed.slice(1).map((B, i) => { const A = placed[i]; return A && B ? (A.to + B.from) / 2 : null; });

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const libArr = readLibraryIndexSync(path.join(DATA, 'library', 'index.json')).records;
  const libById = new Map(libArr.map((r) => [r.id, r]));
  const cache = new Map();
  const featCached = (p) => { if (!cache.has(p)) cache.set(p, featuresOf(p)); return cache.get(p); };
  const all = fs.readdirSync(path.join(DATA, 'sessions')).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'sessions', f), 'utf8')); } catch { return null; } }).filter(Boolean).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const recitals = all.filter((s) => s.kind === 'evaluation' && Array.isArray(s.items) && s.items.length > 1 && s.at >= SINCE && (!ONLY || s.id.endsWith(ONLY)));
  const solos = all.filter((s) => (s.kind === 'evaluation' || s.kind === 'teach') && Array.isArray(s.items) && s.items.length === 1 && s.items[0].matched && !s.partial && fs.existsSync(path.join(DATA, 'sessions', s.id, 'take.wav')));
  const soloBefore = (slokaId, at) => { const c = solos.filter((s) => s.items[0].id === slokaId && s.at < at); return c.length ? c[c.length - 1] : null; };
  const tally = { takes: 0, slokas: 0, cuts: 0, sureByLibrary: 0, sureByOwn: 0, sureByEither: 0, ownMissing: 0, takesAllSure: 0, refsAgree: 0, earWithin1: 0, secondWithin1: 0, earOver2: 0, secondOver2: 0 };
  for (const s of recitals) {
    const dir = path.join(DATA, 'sessions', s.id);
    const wav = path.join(dir, 'take.wav');
    if (!fs.existsSync(wav)) continue;
    const earPath = path.join(dir, 'ear.json');
    const ear = fs.existsSync(earPath) ? JSON.parse(fs.readFileSync(earPath, 'utf8')) : null;
    const so = ear && ear.secondOpinion;
    const res = so && so.chosen && so.results ? so.results[so.chosen] : null;
    const H = featuresOf(wav);
    const libRefs = s.items.map((it) => { const rec = libById.get(it.id); const p = rec && rec.file ? path.join(DATA, 'library', rec.file) : null; return p && fs.existsSync(p) ? { name: it.name, ...featCached(p) } : null; });
    const ownRefs = s.items.map((it) => { const solo = soloBefore(it.id, s.at); return solo ? { name: it.name, solo: solo.id, ...featCached(path.join(DATA, 'sessions', solo.id, 'take.wav')) } : null; });
    const L = placeOrdered(H.F, libRefs);
    const O = placeOrdered(H.F, ownRefs);
    tally.takes++;
    let allSure = true;
    console.log(`== ${s.id} · ${s.items.map((it) => it.name).join(', ')} · ${r2(H.duration)} s · verdicts ${s.items.map((it) => (it.matched ? (it.slips || []).map((x) => x.kind).join('/') || 'ok' : 'no')).join(',')}`);
    console.log(`   fixed in the order (library): ${L.order.map((o) => `${s.items[o.index].name} (${r2(o.contrast)})`).join(' → ') || 'none'} · (own solo): ${O.order.map((o) => `${s.items[o.index].name} (${r2(o.contrast)})`).join(' → ') || 'none'}`);
    s.items.forEach((it, i) => {
      tally.slokas++;
      const a = L.placed[i]; const b = O.placed[i];
      const sureA = a && a.contrast < SURE; const sureB = b && b.contrast < SURE;
      if (sureA) tally.sureByLibrary++;
      if (sureB) tally.sureByOwn++;
      if (sureA || sureB) tally.sureByEither++; else allSure = false;
      if (!ownRefs[i]) tally.ownMissing++;
      const earSeg = ear && ear.segments ? ear.segments.find((x) => x.name === it.name) : null;
      const sg = res && res.segments ? (res.segments.find((x) => x.index === i) || res.segments[i]) : null;
      console.log(`   ${it.name.padEnd(8)} library ${a ? `${r2(a.from)}–${r2(a.to)} c${r2(a.contrast)} ×${a.k} (${r2(libRefs[i].duration)} s ref)` : (libRefs[i] ? 'not placed' : 'no recording').padEnd(34)} · own ${b ? `${r2(b.from)}–${r2(b.to)} c${r2(b.contrast)} ×${b.k} (${ownRefs[i].solo.slice(-4)}, ${r2(ownRefs[i].duration)} s)` : (ownRefs[i] ? 'not placed' : 'no solo take')} · ear ${earSeg ? `${r2(earSeg.from)}–${r2(earSeg.to)}` : '—'} · 2nd ${sg ? `${r2(sg.from)}–${r2(sg.to)}` : '—'}`);
    });
    if (allSure) tally.takesAllSure++;
    const cL = cutsOf(L.placed); const cO = cutsOf(O.placed);
    for (let i = 1; i < s.items.length; i++) {
      const earSeg = ear && ear.segments ? ear.segments.find((x) => x.name === s.items[i - 1].name) : null;
      const earCut = earSeg ? earSeg.to : null;
      const bd = res && res.boundaries ? res.boundaries[i - 1] : null;
      const secondCut = bd ? (bd.from + bd.to) / 2 : null;
      const agree = cL[i - 1] != null && cO[i - 1] != null && Math.abs(cL[i - 1] - cO[i - 1]) <= 0.7;
      const truth = agree ? (cL[i - 1] + cO[i - 1]) / 2 : null;
      const dE = truth != null && earCut != null ? earCut - truth : null;
      const dS = truth != null && secondCut != null ? secondCut - truth : null;
      console.log(`   cut ${s.items[i - 1].name}|${s.items[i].name}: library ${r2(cL[i - 1])} · own ${r2(cO[i - 1])}${agree ? ' ✓ agree' : (cO[i - 1] == null ? ' (no own)' : ' ✗ differ')} · ear ${r2(earCut)}${dE != null ? ` (Δ ${r2(dE)})` : ''} · 2nd ${r2(secondCut)}${dS != null ? ` (Δ ${r2(dS)})` : ''}`);
      tally.cuts++;
      if (!agree) continue;
      tally.refsAgree++;
      if (dE != null && Math.abs(dE) <= 1) tally.earWithin1++;
      if (dS != null && Math.abs(dS) <= 1) tally.secondWithin1++;
      if (dE != null && Math.abs(dE) > 2) tally.earOver2++;
      if (dS != null && Math.abs(dS) > 2) tally.secondOver2++;
    }
  }
  console.log('\n' + JSON.stringify(tally));
}
