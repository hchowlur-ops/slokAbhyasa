// The Gītā's speaker lines, heard by sound in the learner's own voice. Only four open its
// slokas — "dhṛtarāṣṭra uvāca", "sañjaya uvāca", "arjuna uvāca", "śrībhagavān uvāca" — and
// a learner says each of them the same way take after take. A template of each (its MFCC
// frames, as the pāda-start fingerprints are made) is taken from the learner's earlier takes
// where the words placed the line, kept with the learner, and matched after a take against
// the starts of its runs of sound: a confident match is the start of the sloka with that
// speaker line, and the second opinion pins the cut before it. The teacher's recording is
// not used for this: another voice sits too far for the match to tell (offline-boundaries.md).
// Pure; Node-testable.
import { phoneticKey, uvacaWords } from '../textdiff.js';
import { mfccRows, dtwDistance } from './starts.js';
import { bytesToBase64, base64ToBytes } from './util.js';
import { N_MFCC } from './features.js';
import { soundMaskOf, pausesOf } from './segment.js';

export const SPEAKER_LINES_VERSION = 1;
export const PHRASES = [
  { id: 'dhrtarastra', label: 'dhṛtarāṣṭra uvāca', deva: 'धृतराष्ट्र उवाच' },
  { id: 'sanjaya', label: 'sañjaya uvāca', deva: 'सञ्जय उवाच' },
  { id: 'arjuna', label: 'arjuna uvāca', deva: 'अर्जुन उवाच' },
  { id: 'sribhagavan', label: 'śrībhagavān uvāca', deva: 'श्रीभगवानुवाच' },
].map((p) => ({ ...p, key: phoneticKey(p.deva.replace(/\s+/g, '')) }));
export const MAX_PER_PHRASE = 5; // the newest templates of a phrase kept for a learner
export const TEMPLATE_MIN_SEC = 0.8;
export const TEMPLATE_MAX_SEC = 2.5;
export const MATCH_MARGIN = 1.15; // a match must beat the nearest other phrase by this much
export const MATCH_OFFSETS = [-0.3, 0, 0.3, 0.6]; // seconds around each start of sound tried

function editDistance(a, b) {
  const m = a.length; const n = b.length;
  let prev = new Array(n + 1); let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// Which of the four phrases a run of words opens with: the attribution's words (uvacaWords,
// in any script or spelling) against each phrase's phonetic key, the nearest within a
// quarter of its length. { phrase, words } or null.
export function phraseOfWords(words) {
  const list = (words || []).map((w) => String(w || '')).filter(Boolean);
  const k = uvacaWords(list);
  if (!k) return null;
  const key = phoneticKey(list.slice(0, k).join(''));
  let best = null; let bestD = Infinity;
  for (const p of PHRASES) { const d = editDistance(key, p.key); if (d < bestD) { bestD = d; best = p; } }
  return best && bestD <= Math.max(2, Math.round(best.key.length * 0.25)) ? { phrase: best.id, words: k } : null;
}
export const phraseOfText = (text) => phraseOfWords(String(text || '').trim().split(/\s+/));
export const phraseLabel = (id) => (PHRASES.find((p) => p.id === id) || { label: id }).label;

// Where the attribution lies in a hearing: its words among the first `look` tokens (a window
// may begin with the previous sloka's tail), and the chunk times of those words — { phrase,
// from, to } in the hearing's time, the times null when the chunks carry none; null when
// the hearing has no attribution there.
export function attributionSpan(tokens, chunks, { look = 6 } = {}) {
  const words = (tokens || []).map((t) => t.word);
  for (let s = 0; s < Math.min(look, words.length); s++) {
    const p = phraseOfWords(words.slice(s));
    if (!p) continue;
    const first = tokens[s]; const last = tokens[s + p.words - 1];
    const c0 = chunks && first ? chunks[first.chunk] : null; const c1 = chunks && last ? chunks[last.chunk] : null;
    const from = c0 && typeof c0.start === 'number' ? c0.start : null;
    const to = c1 && typeof c1.end === 'number' ? c1.end : null;
    return { phrase: p.phrase, from, to: to != null && from != null ? Math.max(to, from + TEMPLATE_MIN_SEC) : to };
  }
  return null;
}

// A template of the line from a take's features over [fromSec, toSec]: its MFCC frames with
// the take's mean taken off, between TEMPLATE_MIN_SEC and TEMPLATE_MAX_SEC long.
export function templateFrom(F, fromSec, toSec, { minSec = TEMPLATE_MIN_SEC, maxSec = TEMPLATE_MAX_SEC } = {}) {
  if (!F || !F.mfcc || !F.hopSec || !(fromSec >= 0)) return null;
  const len = Math.max(minSec, Math.min(maxSec, (toSec || 0) - fromSec));
  const rows = mfccRows(F, Math.round(fromSec / F.hopSec), Math.round(len / F.hopSec));
  if (rows.length < Math.round(minSec / F.hopSec)) return null;
  return { rows, frames: rows.length, sec: Math.round(rows.length * F.hopSec * 100) / 100 };
}
// Kept as text: the frames in base64, N_MFCC floats each.
export function packTemplate(t, meta = {}) {
  const flat = new Float32Array(t.rows.length * N_MFCC);
  t.rows.forEach((row, k) => flat.set(row, k * N_MFCC));
  return { frames: t.rows.length, data: bytesToBase64(new Uint8Array(flat.buffer)), ...meta };
}
export function unpackTemplate(o) {
  const bytes = base64ToBytes(o.data);
  const flat = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
  const rows = [];
  for (let k = 0; k < o.frames && (k + 1) * N_MFCC <= flat.length; k++) rows.push(flat.slice(k * N_MFCC, (k + 1) * N_MFCC));
  return rows;
}
// A learner's store: { version, phrases: { <phrase>: [packed templates, newest first] } }.
export const emptyStore = () => ({ version: SPEAKER_LINES_VERSION, phrases: {} });
export function addTemplate(store, phrase, packed, { max = MAX_PER_PHRASE } = {}) {
  if (!store.phrases) store.phrases = {};
  const list = store.phrases[phrase] || [];
  if (packed.at != null && list.some((t) => Math.abs((t.at || 0) - packed.at) < 0.5 && (t.sloka || null) === (packed.sloka || null) && (!t.session || !packed.session || t.session === packed.session || /^take-/.test(t.session) || /^take-/.test(packed.session)))) return false; // this very line, already kept (the background pass and the open report both offer it)
  store.phrases[phrase] = [packed, ...list].slice(0, max);
  return true;
}
export const templateCount = (store) => Object.values((store && store.phrases) || {}).reduce((n, l) => n + l.length, 0);

// The speaker lines heard in a take. The candidates are the starts of sound after a breath
// (the first sound, and the end of every quiet gap of minGapSec or more), each tried a
// little either side (MATCH_OFFSETS); at each, a phrase's distance is the nearest of its
// templates to the frames there (dtwDistance, the pāda-start matcher's). What the same voice
// measures for the same phrase on another day sits well under what it measures elsewhere —
// 17 against 21–25 on the takes of 28 October — but not by a fixed amount, so a line is
// judged against the take itself: a candidate counts when it sits under STANDS_OUT_SHARE of
// the phrase's median distance over the take's stretches, when it stands out from the next
// candidate of that phrase elsewhere by STANDS_OUT_MARGIN, and when no other phrase comes as
// near. `expected` says how many slokas of the take open with each phrase: that many
// candidates at most are taken, the weakest dropped first when it does not stand out.
export const STANDS_OUT_SHARE = 0.8;
export const STANDS_OUT_MARGIN = 1.1;
// `keys` limits the templates to those phrases (every key of the store otherwise); `align`
// 'start' matches a template beginning at a candidate, 'end' one ending there (the candidates
// then being where runs of sound end).
export function findTemplates(F, store, { keys = null, candidates = null, offsets = MATCH_OFFSETS, margin = MATCH_MARGIN, minGapSec = 0.25, expected = null, align = 'start' } = {}) {
  const byPhrase = new Map();
  for (const [phrase, list] of Object.entries((store && store.phrases) || {})) { if (keys && !keys.includes(phrase)) continue; for (const t of list) { const rows = unpackTemplate(t); if (rows.length >= 15) { if (!byPhrase.has(phrase)) byPhrase.set(phrase, []); byPhrase.get(phrase).push(rows); } } }
  const nTemplates = [...byPhrase.values()].reduce((n, l) => n + l.length, 0);
  if (!nTemplates || !F || !F.mfcc || !F.hopSec) return { matches: [], thresholds: {}, templates: nTemplates, candidates: 0 };
  const hop = F.hopSec;
  let starts = candidates;
  if (!starts) {
    const { mask } = soundMaskOf(F);
    const { first, last, gaps } = pausesOf(mask, hop, { minGapSec });
    starts = align === 'end' ? [...gaps.map((g) => g.from), last] : [first, ...gaps.map((g) => g.to)];
  }
  const median = (xs) => { const s = xs.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const distAt = (rowsList, at) => { let best = Infinity; for (const rows of rowsList) { const from = align === 'end' ? Math.round(at / hop) - rows.length : Math.round(at / hop); if (from < 0 || from + rows.length > F.n) continue; const d = dtwDistance(mfccRows(F, from, rows.length), rows); if (d < best) best = d; } return best; };
  // every phrase's distance at every candidate, and over the take's stretches every 2 s
  const positions = [];
  for (const s of starts) for (const off of offsets) if (s + off >= 0) positions.push(Math.round((s + off) * 100) / 100);
  const table = new Map(); // phrase → { at: dist }
  const thresholds = {};
  for (const [phrase, rowsList] of byPhrase) {
    const stretch = [];
    for (let at = 0; at <= F.n * hop; at += 2) { const d = distAt(rowsList, at); if (Number.isFinite(d)) stretch.push(d); }
    const med = median(stretch);
    thresholds[phrase] = med == null ? null : Math.round(med * STANDS_OUT_SHARE * 1000) / 1000;
    table.set(phrase, positions.map((at) => ({ at, dist: distAt(rowsList, at) })).filter((x) => Number.isFinite(x.dist)));
  }
  const matches = [];
  for (const [phrase, cands] of table) {
    const thr = thresholds[phrase];
    if (thr == null) continue;
    // the candidates of this phrase, merged within 1.5 s (the nearest kept), best first
    const sorted = cands.slice().sort((a, b) => a.at - b.at);
    const merged = [];
    for (const c of sorted) { const last = merged[merged.length - 1]; if (last && c.at - last.at < 1.5) { if (c.dist < last.dist) merged[merged.length - 1] = c; } else merged.push({ ...c }); }
    merged.sort((a, b) => a.dist - b.dist);
    let k = expected && Number.isInteger(expected[phrase]) ? expected[phrase] : 1;
    k = Math.min(k, merged.length);
    // the k nearest, as long as the k-th stands out from the (k+1)-th
    while (k > 0) {
      const kth = merged[k - 1];
      const next = merged[k];
      if (kth.dist <= thr && (!next || next.dist >= kth.dist * STANDS_OUT_MARGIN)) break;
      k--;
    }
    for (const c of merged.slice(0, k)) {
      // no other phrase as near at that spot
      let other = Infinity;
      for (const [p2, cands2] of table) { if (p2 === phrase) continue; const o = cands2.find((x) => x.at === c.at); if (o && o.dist < other) other = o.dist; }
      if (Number.isFinite(other) && other < c.dist * margin) continue;
      matches.push({ phrase, at: c.at, dist: Math.round(c.dist * 1000) / 1000, margin: Number.isFinite(other) ? Math.round((other / c.dist) * 100) / 100 : null });
    }
  }
  matches.sort((a, b) => a.at - b.at);
  return { matches, thresholds, templates: nTemplates, candidates: starts.length };
}
// The four speaker lines in a take (findTemplates over the phrases alone).
export function findSpeakerLines(F, store, opts = {}) {
  return findTemplates(F, store, { ...opts, keys: PHRASES.map((p) => p.id) });
}

// ---------- every sloka's beginning and ending, in the learner's voice ----------
// A learner who has practised a sloka on its own has said its first and last seconds in
// their own voice; kept as the sloka's signatures (the store's keys `sloka:<id>:start` and
// `sloka:<id>:end`), they place the sloka in a recital of several from both ends.
export const SIGNATURE_SEC = 2.0;
export const signatureKeys = (id) => ({ start: `sloka:${id}:start`, end: `sloka:${id}:end` });
export function signatureCount(store, id) {
  const k = signatureKeys(id);
  const ph = (store && store.phrases) || {};
  return { start: (ph[k.start] || []).length, end: (ph[k.end] || []).length };
}
// The two passes over a take: first every sloka's beginning, placed in the take's order as a
// marker; then each marker's ending, looked for between its start and the next marker (or
// the take's end), which confirms it. items: [{ id, name }] in the take's order. Returns
// { markers: [{ index, id, name, startAt, startDist, endAt, endDist, confirmed }], starts }.
// `seeds`: beginnings known otherwise — a speaker line heard is the beginning of the sloka
// that opens with it — as [{ index, at }], used for slokas without a kept beginning of their
// own; their endings are still looked for.
export function twoPassMarkers(F, store, items, { minSlokaSec = 3, seeds = null } = {}) {
  const ph = (store && store.phrases) || {};
  const present = (items || []).filter((it) => it && it.id && (ph[signatureKeys(it.id).start] || []).length);
  if ((!present.length && !(seeds && seeds.length)) || !F || !F.hopSec || !F.mfcc) return { markers: [], starts: null };
  const expected = {};
  for (const it of present) expected[signatureKeys(it.id).start] = 1;
  const starts = present.length ? findTemplates(F, store, { keys: Object.keys(expected), expected, align: 'start' }) : { matches: [], templates: 0, thresholds: {}, candidates: 0 };
  const markers = [];
  const used = new Set();
  let lastAt = -Infinity;
  items.forEach((it, i) => {
    const key = signatureKeys(it.id).start;
    const m = starts.matches.find((x) => !used.has(x) && x.phrase === key && x.at > lastAt);
    if (!m) return;
    used.add(m);
    lastAt = m.at;
    markers.push({ index: i, id: it.id, name: it.name, startAt: m.at, startDist: m.dist, endAt: null, endDist: null, confirmed: false });
  });
  for (const sd of seeds || []) {
    if (!items[sd.index] || markers.some((m) => m.index === sd.index)) continue;
    const before = markers.filter((m) => m.index < sd.index).pop();
    const after = markers.find((m) => m.index > sd.index);
    if ((before && sd.at <= before.startAt) || (after && sd.at >= after.startAt)) continue; // out of the take's order
    markers.push({ index: sd.index, id: items[sd.index].id, name: items[sd.index].name, startAt: sd.at, startDist: null, endAt: null, endDist: null, confirmed: false, seeded: 'speakerLine' });
  }
  markers.sort((a, b) => a.index - b.index);
  const hop = F.hopSec;
  const takeEnd = F.n * hop;
  const { mask } = soundMaskOf(F);
  const { last, gaps } = pausesOf(mask, hop, { minGapSec: 0.25 });
  const ends = [...gaps.map((g) => g.from), last];
  markers.forEach((mk, k) => {
    const endKey = signatureKeys(mk.id).end;
    if (!(ph[endKey] || []).length) return;
    const limit = k + 1 < markers.length ? markers[k + 1].startAt : takeEnd;
    const cands = ends.filter((t) => t >= mk.startAt + minSlokaSec && t <= limit + 0.1);
    if (!cands.length) return;
    const r = findTemplates(F, store, { keys: [endKey], candidates: cands, expected: { [endKey]: 1 }, align: 'end', offsets: [-0.3, 0, 0.3] });
    const m = r.matches[0];
    if (m) { mk.endAt = m.at; mk.endDist = m.dist; mk.confirmed = true; }
  });
  return { markers, starts: { templates: starts.templates, thresholds: starts.thresholds, candidates: starts.candidates } };
}

// The slokas of the take that open with a speaker line, in order, each given the earliest
// unclaimed match of its phrase after the previous sloka's: [{ index, name, phrase, at, dist }].
export function assignSpeakerLines(matches, items) {
  const out = [];
  const used = new Set();
  let lastAt = -Infinity;
  (items || []).forEach((it, i) => {
    if (!it || !it.phrase) return;
    const m = (matches || []).find((x) => !used.has(x) && x.phrase === it.phrase && x.at > lastAt);
    if (!m) return;
    used.add(m);
    lastAt = m.at;
    out.push({ index: i, name: it.name, phrase: it.phrase, at: m.at, dist: m.dist });
  });
  return out;
}
