// Verse ids of a reference dataset and what follows from them: the names and folders a
// recording of a verse gets, the text a recording is made against and the input of its
// hash, a name read back as a verse, the order of verses, a combined verse composed from
// its parts, and the checks a dataset must pass. Pure; shared by the browser, the server,
// the tools and the tests.
//
// Ids: "12.3" (a verse), "1.21-22" (two or three consecutive verses recited as one),
// "12.opening" / "12.colophon" (a chapter's invocation or closing line), "dhyana.1",
// "invocation.1", "other.1" (texts outside the chapters).
import { GITA_VERSES, gitaVerse, gitaFamily, FAMILIES, aksharaPlan as planOfText } from './chandas.js';
import { syllabify } from './phon.js';

export const KINDS = ['verse', 'combined', 'opening', 'colophon', 'dhyana', 'invocation', 'other'];
export const WHO = { krishna: 'श्रीभगवान्', arjuna: 'अर्जुन', sanjaya: 'सञ्जय', dhritarashtra: 'धृतराष्ट्र' };
export const FAMILY_NAMES = { anushtubh: 'anuṣṭubh', trishtubh: 'triṣṭubh' };

export function parseVerseId(id) {
  const s = String(id || '').trim();
  let m = s.match(/^(\d{1,2})\.(\d{1,3})(?:-(\d{1,3}))?$/);
  if (m) {
    const chapter = Number(m[1]);
    const verse = Number(m[2]);
    const verseEnd = m[3] ? Number(m[3]) : null;
    if (verseEnd !== null && verseEnd <= verse) return null;
    return { chapter, verse, verseEnd, kind: verseEnd ? 'combined' : 'verse' };
  }
  m = s.match(/^(\d{1,2})\.(opening|colophon)$/);
  if (m) return { chapter: Number(m[1]), verse: null, verseEnd: null, kind: m[2] };
  m = s.match(/^(dhyana|invocation|other)\.(\d{1,3})$/);
  if (m) return { chapter: null, verse: Number(m[2]), verseEnd: null, kind: m[1] };
  return null;
}

export function verseIdFor({ chapter, verse, verseEnd = null, kind = 'verse' }) {
  if (kind === 'verse' || kind === 'combined') return verseEnd ? `${chapter}.${verse}-${verseEnd}` : `${chapter}.${verse}`;
  if (kind === 'opening' || kind === 'colophon') return `${chapter}.${kind}`;
  return `${kind}.${verse}`;
}

const parsed = (v) => (typeof v === 'string' ? parseVerseId(v) : v && v.kind ? v : v && v.id ? parseVerseId(v.id) : null);
const pad2 = (n) => String(n).padStart(2, '0');

// The name a recording of the verse gets by default, zero-padded so that sorting names
// sorts verses: CH12-03, CH01-21-22, CH12-opening, CH12-colophon, DHYANA-01.
export function defaultNameFor(v) {
  const p = parsed(v);
  if (!p) return '';
  if (p.kind === 'verse') return `CH${pad2(p.chapter)}-${pad2(p.verse)}`;
  if (p.kind === 'combined') return `CH${pad2(p.chapter)}-${pad2(p.verse)}-${pad2(p.verseEnd)}`;
  if (p.kind === 'opening' || p.kind === 'colophon') return `CH${pad2(p.chapter)}-${p.kind}`;
  return `${p.kind.toUpperCase()}-${pad2(p.verse)}`;
}

// The folder: an existing one that names the chapter (CH-12, ch12, CH_12), else CH-12;
// Dhyana / Other for texts outside the chapters.
export function defaultFolderFor(v, folders = []) {
  const p = parsed(v);
  if (!p) return '';
  if (p.chapter == null) {
    const want = p.kind === 'dhyana' ? 'Dhyana' : p.kind === 'invocation' ? 'Invocations' : 'Other';
    return folders.find((f) => f.toLowerCase() === want.toLowerCase()) || want;
  }
  const re = new RegExp(`^ch[-_ ]?0*${p.chapter}$`, 'i');
  return folders.find((f) => re.test(f)) || `CH-${pad2(p.chapter)}`;
}

// The text a recording is made against: the speaker line (when it is recited) on a line of
// its own, then the half-verses.
export function verseBody(entry, { speakerLine = true } = {}) {
  const lines = [];
  if (speakerLine && entry && entry.speaker && entry.speaker.deva) lines.push(entry.speaker.deva);
  lines.push(...((entry && entry.deva) || []));
  return lines.join('\n');
}
// NFC, trimmed, single spaces, one line per half-verse: the same text hashes the same.
export const normalizeVerseText = (s) => String(s || '').normalize('NFC').replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
export const verseHashInput = (entry) => normalizeVerseText(verseBody(entry, { speakerLine: true }));

// Invocations and dhyāna ślokas first, then the chapters in order (opening, verses,
// colophon), then anything else.
export function compareVerseOrder(a, b) {
  const pa = parsed(a);
  const pb = parsed(b);
  const key = (p) => (!p ? [9, 0, 0, 0] : [p.kind === 'invocation' ? 0 : p.kind === 'dhyana' ? 1 : p.chapter != null ? 2 : 3, p.chapter ?? 0, p.kind === 'opening' ? -1 : p.kind === 'colophon' ? 1e6 : p.verse ?? 0, p.verseEnd ?? 0]);
  const ka = key(pa);
  const kb = key(pb);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
}

// A recording's name read as a verse: "CH12-03", "ch12-7", "12.4" (gitaVerse); a name
// with one number ("03", "sloka 3") takes the chapter from a folder that names one
// ("CH-12"); "Starting" / "Closing" words name the chapter's opening or colophon. `ids`,
// when given, is the set of ids the dataset has: a guess it lacks is no guess.
export function mapNameToVerse(name, folder = '', ids = null) {
  const has = (id) => !ids || ids.has(id);
  const guess = (id, by) => (has(id) ? { id, by } : null);
  const g = gitaVerse(name);
  if (g) return guess(`${g.chapter}.${g.verse}`, 'name');
  const fm = String(folder || '').match(/(?<!\d)(\d{1,2})(?!\d)/);
  const chapter = fm && GITA_VERSES[Number(fm[1])] ? Number(fm[1]) : null;
  if (!chapter) return null;
  const n = String(name || '');
  if (/(start|open|invoc|dhyan)/i.test(n)) return guess(`${chapter}.opening`, 'word');
  if (/(clos|colophon|phala|\bend)/i.test(n)) return guess(`${chapter}.colophon`, 'word');
  const m = n.match(/(?<!\d)(\d{1,3})(?!\d)/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= GITA_VERSES[chapter]) return guess(`${chapter}.${Number(m[1])}`, 'folder');
  return null;
}

// "1.21-22" from the dataset's own entry when it has one, else composed from the single
// verses (their speaker lines kept where a later verse opens with one).
export function combinedEntry(byId, id) {
  const p = parseVerseId(id);
  if (!p || p.kind !== 'combined') return null;
  if (byId.has(id)) return byId.get(id);
  const parts = [];
  for (let v = p.verse; v <= p.verseEnd; v++) { const e = byId.get(`${p.chapter}.${v}`); if (!e) return null; parts.push(e); }
  const lines = (key) => parts.flatMap((e, i) => [...(i && e.speaker && e.speaker[key] ? [e.speaker[key]] : []), ...(e[key] || [])]);
  const en = parts.map((e) => e.translations && e.translations.en).filter(Boolean).join(' ');
  return {
    id, kind: 'combined', chapter: p.chapter, verse: p.verse, verseEnd: p.verseEnd,
    speaker: parts[0].speaker, deva: lines('deva'), iast: lines('iast'), metre: parts[0].metre,
    translations: en ? { en } : {}, variants: [], recitedWith: null, composed: true, parts: parts.map((e) => e.id),
  };
}

// A speaker line that slipped into the text, or a stray one, is an error of the dataset.
const SPEAKER_LINE = /^(श्री\s*)?भगवा(नु|न्\s*उ)वाच\s*[।|]?$|^(अर्जुन|स(ञ्ज|ंज)य|धृतराष्ट्र)\s*उवाच\s*[।|]?$/;

// What a dataset must satisfy: { errors, warnings }. Errors keep it from being served.
export function validateDataset(data, { manifest = null } = {}) {
  const errors = [];
  const warnings = [];
  if (!data || typeof data !== 'object') return { errors: ['verses.json is not an object'], warnings };
  if (typeof data.schemaVersion !== 'string' || !/^1\./.test(data.schemaVersion)) errors.push(`schemaVersion ${JSON.stringify(data.schemaVersion)}: expected "1.x.y"`);
  if (typeof data.dataset !== 'string' || !data.dataset) errors.push('dataset: an id is required');
  if (manifest && manifest.id && data.dataset !== manifest.id) errors.push(`dataset "${data.dataset}" differs from the manifest's id "${manifest.id}"`);
  if (!Array.isArray(data.chapters)) errors.push('chapters: an array is required');
  if (!Array.isArray(data.verses)) errors.push('verses: an array is required');
  if (errors.length) return { errors, warnings };
  const chapterNos = new Set();
  for (const c of data.chapters) {
    if (!c || !Number.isInteger(c.chapter) || c.chapter < 1) { errors.push(`chapters: an entry without a chapter number`); continue; }
    if (chapterNos.has(c.chapter)) errors.push(`chapter ${c.chapter} is listed twice`);
    chapterNos.add(c.chapter);
    if (!Number.isInteger(c.verses) || c.verses < 1) errors.push(`chapter ${c.chapter}: a verse count is required`);
    if (!c.name || typeof c.name.deva !== 'string') warnings.push(`chapter ${c.chapter}: no Devanagari name`);
  }
  const ids = new Set();
  const perChapter = new Map();
  const langs = manifest && manifest.translations ? new Set(Object.keys(manifest.translations)) : null;
  const transLangs = new Set();
  for (const e of data.verses) {
    const where = e && e.id ? e.id : '(no id)';
    const p = e && parseVerseId(e.id);
    if (!p) { errors.push(`${where}: not a verse id`); continue; }
    if (ids.has(e.id)) errors.push(`${e.id}: listed twice`);
    ids.add(e.id);
    if (!KINDS.includes(e.kind)) errors.push(`${e.id}: kind ${JSON.stringify(e.kind)}`);
    else if (e.kind !== p.kind) errors.push(`${e.id}: kind ${e.kind} does not match the id`);
    if ((e.chapter ?? null) !== p.chapter || (e.verse ?? null) !== p.verse || (e.verseEnd ?? null) !== p.verseEnd) errors.push(`${e.id}: chapter / verse fields do not match the id`);
    if (p.chapter != null && !chapterNos.has(p.chapter)) errors.push(`${e.id}: chapter ${p.chapter} is not in chapters`);
    if (!Array.isArray(e.deva) || !e.deva.length || !e.deva.every((l) => typeof l === 'string' && l.trim())) errors.push(`${e.id}: deva must be a non-empty list of lines`);
    else {
      if (e.deva.some((l) => l !== l.normalize('NFC'))) warnings.push(`${e.id}: deva is not NFC`);
      if (SPEAKER_LINE.test(e.deva[0].trim())) errors.push(`${e.id}: the speaker line is inside deva`);
      if (Array.isArray(e.iast) && e.iast.length && e.iast.length !== e.deva.length) warnings.push(`${e.id}: iast has ${e.iast.length} lines, deva ${e.deva.length}`);
      if (Array.isArray(e.padas) && e.padas.length !== 4) warnings.push(`${e.id}: padas should be four`);
    }
    if (e.speaker != null) {
      if (typeof e.speaker !== 'object') errors.push(`${e.id}: speaker must be an object`);
      else if (e.speaker.who != null && !WHO[e.speaker.who]) errors.push(`${e.id}: speaker.who ${JSON.stringify(e.speaker.who)}`);
    }
    if (e.metre != null) {
      if (typeof e.metre !== 'object' || !FAMILY_NAMES[e.metre.family]) errors.push(`${e.id}: metre.family must be anushtubh or trishtubh`);
      else if (p.kind === 'verse' && e.metre.family !== gitaFamily(p.chapter, p.verse)) warnings.push(`${e.id}: metre ${e.metre.family} differs from the Gītā table (${gitaFamily(p.chapter, p.verse)})`);
    }
    if (e.translations && typeof e.translations === 'object') for (const k of Object.keys(e.translations)) transLangs.add(k);
    if (p.kind === 'verse') perChapter.set(p.chapter, (perChapter.get(p.chapter) || 0) + 1);
    if (p.kind === 'combined') for (let v = p.verse; v <= p.verseEnd; v++) if (!data.verses.some((x) => x && x.id === `${p.chapter}.${v}`)) errors.push(`${e.id}: its part ${p.chapter}.${v} is missing`);
    if (e.recitedWith != null && !parseVerseId(e.recitedWith)) warnings.push(`${e.id}: recitedWith is not a verse id`);
  }
  for (const c of data.chapters) {
    const have = perChapter.get(c.chapter) || 0;
    if (Number.isInteger(c.verses) && have !== c.verses) errors.push(`chapter ${c.chapter}: ${have} verses, the chapter says ${c.verses}`);
    if (GITA_VERSES[c.chapter] && have !== GITA_VERSES[c.chapter]) warnings.push(`chapter ${c.chapter}: ${have} verses, the Gītā table has ${GITA_VERSES[c.chapter]}`);
  }
  if (langs) for (const k of transLangs) if (!langs.has(k)) warnings.push(`translations in "${k}" are not named in the manifest`);
  return { errors, warnings };
}

// Coverage of a dataset by a library index whose records carry `verse: { dataset, id }`:
// how many verses have a recording, per chapter, and the extras (openings, colophons…).
export function coverage(data, index) {
  const recorded = new Map(); // id → count
  for (const r of index || []) {
    if (!r || !r.verse || r.verse.dataset !== data.dataset || !r.verse.id) continue;
    const p = parseVerseId(r.verse.id);
    if (!p) continue;
    const ids = p.kind === 'combined' ? Array.from({ length: p.verseEnd - p.verse + 1 }, (_, i) => `${p.chapter}.${p.verse + i}`) : [r.verse.id];
    for (const id of ids) recorded.set(id, (recorded.get(id) || 0) + 1);
  }
  const byChapter = {};
  for (const c of data.chapters) byChapter[c.chapter] = { total: 0, recorded: 0, extras: 0 };
  const byKind = {};
  let total = 0;
  let done = 0;
  for (const e of data.verses) {
    const n = recorded.get(e.id) || 0;
    byKind[e.kind] = byKind[e.kind] || { total: 0, recorded: 0 };
    byKind[e.kind].total++;
    if (n) byKind[e.kind].recorded++;
    const ch = e.chapter != null ? byChapter[e.chapter] : null;
    if (e.kind === 'verse') { total++; if (n) done++; if (ch) { ch.total++; if (n) ch.recorded++; } } else if (n && ch) ch.extras++;
  }
  return { dataset: data.dataset, total, recorded: done, byChapter, byKind };
}

// ---------- the link a recording keeps to a verse (meta.verse in its sidecar) ----------
// The ids, a copy of the text the recording was made against (so the recording stays
// complete without the dataset, and a dataset update can be told from it by the hash the
// server adds), the metre, the licence, and how the link was made.
export function verseLink(entry, { dataset, datasetVersion = null, speakerLineRecited = true, mappedBy = 'manual', licence = null, pinned = false } = {}) {
  const p = parseVerseId(entry.id);
  const hasLine = !!(entry.speaker && entry.speaker.deva);
  return {
    dataset, datasetVersion, id: entry.id,
    kind: entry.kind || (p ? p.kind : 'verse'), chapter: entry.chapter ?? (p ? p.chapter : null), verse: entry.verse ?? (p ? p.verse : null), verseEnd: entry.verseEnd ?? (p ? p.verseEnd : null),
    speakerLineRecited: hasLine && speakerLineRecited !== false,
    text: { speaker: hasLine ? entry.speaker.deva : null, deva: (entry.deva || []).slice() },
    textHash: null,
    metre: entry.metre && entry.metre.family ? { family: entry.metre.family, name: entry.metre.name || FAMILY_NAMES[entry.metre.family] || null } : null,
    licence, mappedBy, pinned: !!pinned, at: new Date().toISOString(),
  };
}
// What the link's hash is taken over: the same text as verseHashInput gives for the entry.
export const linkHashInput = (link) => normalizeVerseText([link && link.text && link.text.speaker ? link.text.speaker : '', ...((link && link.text && link.text.deva) || [])].filter(Boolean).join('\n'));

// ---------- customisations, kept in the app's data over a read-only dataset ----------
// A verse's own text corrected, a translation typed in, notes, variant readings: fields
// laid over the dataset's entry when it is served or linked. The dataset's files are never
// written; the customisations live in <data>/reference/<dataset>.custom.json.
export const CUSTOM_FIELDS = ['deva', 'iast', 'speaker', 'translations', 'notes', 'variants', 'aksharaPlan'];
const cleanLines = (v, max = 400) => (Array.isArray(v) ? v.filter((l) => typeof l === 'string' && l.trim()).map((l) => l.normalize('NFC').trim().slice(0, max)).slice(0, 12) : null);
export function sanitizeCustom(fields) {
  if (!fields || typeof fields !== 'object') return null;
  const out = {};
  const deva = cleanLines(fields.deva);
  if (deva && deva.length) out.deva = deva;
  const iast = cleanLines(fields.iast);
  if (iast && iast.length) out.iast = iast;
  if (fields.speaker && typeof fields.speaker === 'object') {
    const sp = {};
    if (typeof fields.speaker.who === 'string' && WHO[fields.speaker.who]) sp.who = fields.speaker.who;
    if (typeof fields.speaker.deva === 'string' && fields.speaker.deva.trim()) sp.deva = fields.speaker.deva.normalize('NFC').trim().slice(0, 120);
    if (typeof fields.speaker.iast === 'string' && fields.speaker.iast.trim()) sp.iast = fields.speaker.iast.trim().slice(0, 120);
    if (Object.keys(sp).length) out.speaker = sp;
  }
  if (fields.translations && typeof fields.translations === 'object') {
    const tr = {};
    for (const [k, v] of Object.entries(fields.translations)) if (/^[a-z]{2,3}$/.test(k) && typeof v === 'string' && v.trim()) tr[k] = v.trim().slice(0, 4000);
    if (Object.keys(tr).length) out.translations = tr;
  }
  if (typeof fields.notes === 'string' && fields.notes.trim()) out.notes = fields.notes.trim().slice(0, 2000);
  if (Array.isArray(fields.variants)) {
    const vs = fields.variants.filter((x) => x && typeof x === 'object' && typeof x.text === 'string' && x.text.trim())
      .map((x) => ({ line: Number.isInteger(x.line) ? x.line : null, text: x.text.trim().slice(0, 400), replaces: typeof x.replaces === 'string' ? x.replaces.slice(0, 400) : null, note: typeof x.note === 'string' ? x.note.slice(0, 400) : null })).slice(0, 20);
    if (vs.length) out.variants = vs;
  }
  // the akṣara plan of a verse that does not scan (4.35 has 36, 1.20 has 48): the speaker
  // line's count and each pāda's, in order
  if (fields.aksharaPlan && typeof fields.aksharaPlan === 'object') {
    const ap = fields.aksharaPlan;
    const padas = Array.isArray(ap.padas) ? ap.padas.filter((n) => Number.isInteger(n) && n >= 1 && n <= 64).slice(0, 16) : [];
    if (padas.length) out.aksharaPlan = { speakerLine: Number.isInteger(ap.speakerLine) && ap.speakerLine >= 0 ? Math.min(32, ap.speakerLine) : 0, padas };
  }
  return Object.keys(out).length ? out : null;
}
export function mergeCustom(entry, custom) {
  if (!custom) return { ...entry, customised: false };
  const out = { ...entry, customised: true, custom };
  if (custom.deva) out.deva = custom.deva;
  if (custom.iast) out.iast = custom.iast;
  if (custom.speaker) out.speaker = { ...(entry.speaker || { who: null, deva: null, iast: null }), ...custom.speaker };
  if (custom.translations) out.translations = { ...(entry.translations || {}), ...custom.translations };
  if (custom.notes) out.notes = custom.notes;
  if (custom.variants) out.variants = [...(entry.variants || []), ...custom.variants];
  if (custom.aksharaPlan) out.aksharaPlan = custom.aksharaPlan;
  return out;
}

// The akṣara plan of a verse (see chandas.aksharaPlan): the custom file's when the verse
// has one (a verse that does not scan), else read from its text by its metre. Without the
// speaker line when the recording did not recite it.
export function versePlan(entry, { speakerLine = true } = {}) {
  if (!entry) return null;
  const custom = entry.aksharaPlan && Array.isArray(entry.aksharaPlan.padas) && entry.aksharaPlan.padas.length ? entry.aksharaPlan : null;
  if (custom) {
    const sp = speakerLine && entry.speaker && entry.speaker.deva ? custom.speakerLine || syllabify(entry.speaker.deva).length : 0;
    const checkpoints = [];
    let acc = sp;
    if (sp) checkpoints.push(acc);
    for (const p of custom.padas) { acc += p; checkpoints.push(acc); }
    return { speakerLine: sp, padas: custom.padas.slice(), total: acc, checkpoints, custom: true };
  }
  const fam = entry.metre && entry.metre.family && FAMILIES[entry.metre.family] ? FAMILIES[entry.metre.family] : null;
  return planOfText(verseBody(entry, { speakerLine }), { perPada: fam ? fam.perPada : null });
}

// ---------- the words of a linked recording: the verse's, with the hearing's timings ----------
// A linked recording's transcript shows and plays the verse's own lines (speaker line and
// half-verses), not what Whisper heard: the timings of the transcript it replaces are spread
// over the lines by their akṣaras, and what was heard is kept under `heard` for an unlink.
export function verseTranscript(entry, { speakerLine = true, previous = null } = {}) {
  const lines = verseBody(entry, { speakerLine }).split('\n').map((l) => l.trim()).filter(Boolean);
  const t = {
    language: 'sanskrit', text: lines.join(' '), chunks: [],
    tier: (previous && previous.tier) || null, model: (previous && previous.model) || null, device: (previous && previous.device) || null,
    edited: true, editedIn: 'reference', from: 'reference', verse: entry.id, createdAt: new Date().toISOString(),
  };
  const prev = previous && Array.isArray(previous.chunks) ? previous.chunks.filter((c) => c && typeof c.start === 'number') : [];
  if (prev.length) {
    const start = prev[0].start;
    const last = prev[prev.length - 1];
    const end = typeof last.end === 'number' && last.end > start ? last.end : last.start + 3;
    const weights = lines.map((l) => Math.max(1, syllabify(l).length));
    const total = weights.reduce((a, b) => a + b, 0);
    let at = start;
    t.chunks = lines.map((l, i) => { const span = ((end - start) * weights[i]) / total; const c = { text: l, start: Number(at.toFixed(2)), end: Number((at + span).toFixed(2)) }; at += span; return c; });
  }
  if (previous && previous.text && previous.from !== 'reference') t.heard = { text: previous.text, chunks: Array.isArray(previous.chunks) ? previous.chunks : [] };
  else if (previous && previous.heard) t.heard = previous.heard;
  return t;
}
// What an unlink brings back: the hearing a verse transcript replaced, or nothing.
export function heardTranscript(t) {
  if (!t || t.from !== 'reference' || !t.heard || !t.heard.text) return null;
  const { heard, verse, from, ...rest } = t;
  return { ...rest, text: heard.text, chunks: heard.chunks || [], edited: false, editedIn: null, createdAt: new Date().toISOString() };
}
