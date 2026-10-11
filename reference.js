// The reference datasets (Node side: serve.js and the tools). A dataset is a folder with a
// manifest.json and the verses file it names, found under <data>/reference/<id>/ first
// and the app's own reference/<id>/ second (datadir.js resolveReferenceDirs); the first
// manifest of an id wins. Each is checked with js/verses.js on load; one with errors is
// listed with them and not served. A manifest that changes on disk is reloaded.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateDataset, combinedEntry, coverage as coverageOf, verseHashInput } from './js/verses.js';

let searchDirs = [];
const loaded = new Map(); // id → dataset record

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const statMs = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return null; } };

// Reads one dataset folder: { id, dir, manifest, data, byId, hashById, errors, warnings, mtimeMs }.
export function loadDataset(dir) {
  const manifestPath = path.join(dir, 'manifest.json');
  const rec = { id: null, dir, manifest: null, data: null, byId: new Map(), hashById: new Map(), errors: [], warnings: [], mtimeMs: statMs(manifestPath), loadedAt: new Date().toISOString() };
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (err) { rec.errors.push(`manifest.json: ${err.message}`); return rec; }
  rec.manifest = manifest;
  rec.id = typeof manifest.id === 'string' && manifest.id ? manifest.id : null;
  if (!rec.id) rec.errors.push('manifest.json: an id is required');
  const versesFile = manifest.files && manifest.files.verses ? manifest.files.verses : 'verses.json';
  let raw;
  try { raw = fs.readFileSync(path.join(dir, versesFile)); } catch (err) { rec.errors.push(`${versesFile}: ${err.message}`); return rec; }
  if (manifest.sha256 && manifest.sha256[versesFile] && sha256(raw) !== manifest.sha256[versesFile]) rec.warnings.push(`${versesFile} does not match the hash in the manifest (edited by hand?)`);
  let data;
  try { data = JSON.parse(raw.toString('utf8')); } catch (err) { rec.errors.push(`${versesFile}: ${err.message}`); return rec; }
  const { errors, warnings } = validateDataset(data, { manifest });
  rec.errors.push(...errors);
  rec.warnings.push(...warnings);
  if (errors.length) return rec;
  rec.data = data;
  for (const v of data.verses) { rec.byId.set(v.id, v); rec.hashById.set(v.id, sha256(verseHashInput(v))); }
  return rec;
}

// Every dataset folder under the search dirs, the first of each id winning.
export function initReference(dirs) {
  searchDirs = dirs.slice();
  loaded.clear();
  for (const base of searchDirs) {
    let names = [];
    try { names = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { continue; }
    for (const name of names.sort()) {
      const dir = path.join(base, name);
      if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue;
      const rec = loadDataset(dir);
      const id = rec.id || name;
      // the first of an id wins, except that a sound dataset is never shadowed by a broken one
      const have = loaded.get(id);
      if (!have || (have.errors.length && !rec.errors.length)) loaded.set(id, rec);
    }
  }
  return loaded;
}

// The loaded dataset, reloaded when its manifest changed on disk.
export function dataset(id) {
  const rec = loaded.get(id);
  if (!rec) return null;
  const now = statMs(path.join(rec.dir, 'manifest.json'));
  if (now !== rec.mtimeMs) { const fresh = loadDataset(rec.dir); loaded.set(id, fresh); return fresh; }
  return rec;
}

// What there is: one line per dataset, errors included.
export function datasets() {
  return [...loaded.keys()].map((id) => {
    const r = dataset(id);
    const m = r.manifest || {};
    return { id, name: m.name || id, work: m.work || null, version: m.version || null, licence: m.licence || null, attribution: m.attribution || null, counts: m.counts || null, translations: m.translations ? Object.keys(m.translations) : [], dir: r.dir, errors: r.errors, warnings: r.warnings };
  });
}

export const verse = (rec, id) => (rec && rec.data ? rec.byId.get(id) || combinedEntry(rec.byId, id) || null : null);
export const verseHash = (rec, id) => (rec && rec.data ? rec.hashById.get(id) || (verse(rec, id) ? sha256(verseHashInput(verse(rec, id))) : null) : null);

export function chapter(rec, n) {
  if (!rec || !rec.data) return null;
  const c = rec.data.chapters.find((x) => x.chapter === n);
  if (!c) return null;
  return { ...c, entries: rec.data.verses.filter((v) => v.chapter === n) };
}

export const coverage = (rec, index) => (rec && rec.data ? coverageOf(rec.data, index) : null);
