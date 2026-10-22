#!/usr/bin/env node
// Scores the evaluation set (research_notes/Acoustic pronunciation assessment/evaluation-set.md):
// for every take in the manifest, the session's saved item for the sloka — its phonology
// (the words' error counts by category and the akṣara-by-akṣara alignment, which session
// items carry) and its slips — against the labels: per category and per voice, the share
// of labelled slips detected and the share of clean takes with a false report. Writes a
// Markdown report and prints it.
//
//   node tools/evaluate-set.mjs [--manifest <path>] [--data <data dir>] [--only <kind>] [--out <report.md>]
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] != null ? args[i + 1] : def; };
const dataDir = () => { try { const l = JSON.parse(fs.readFileSync(path.join(ROOT, 'local.json'), 'utf8')); if (l.dataDir) return l.dataDir; } catch { /* default */ } return path.join(ROOT, 'data'); };
const DATA = opt('--data', process.env.SLOKABHYASA_DATA || dataDir());
const MANIFEST = opt('--manifest', path.join(DATA, 'evaluation-set', 'manifest.json'));
const ONLY = opt('--only', null);
const OUT = opt('--out', path.join(ROOT, 'research_notes', 'Acoustic pronunciation assessment', 'evaluation-set-results.md'));

if (!fs.existsSync(MANIFEST)) { console.error(`no manifest at ${MANIFEST} — see evaluation-set.md for its shape`); process.exit(2); }
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const takes = (manifest.takes || []).filter((t) => !ONLY || t.kind === ONLY);
if (!takes.length) { console.error('no takes in the manifest'); process.exit(2); }
const session = (id) => { const p = path.join(DATA, 'sessions', `${id}.json`); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const commit = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch { return '?'; } })();

// the categories the report names, and the slips
const CATEGORIES = ['aspiration', 'voicing', 'place', 'nasality', 'visarga', 'vowelLength', 'vowel', 'length', 'missing', 'added'];
const SLIPS = ['repeat', 'restart', 'stutter', 'dropped'];
const tally = new Map(); // `${voice}|${category}` → { labelled, detected, clean, falseAlarms }
const cell = (voice, cat) => { const k = `${voice}|${cat}`; if (!tally.has(k)) tally.set(k, { labelled: 0, detected: 0, clean: 0, falseAlarms: 0 }); return tally.get(k); };
const rows = [];
let missingPhonology = 0;
for (const t of takes) {
  const s = session(t.session);
  const it = s && Array.isArray(s.items) ? s.items.find((x) => x.name === t.sloka || x.id === t.sloka) : null;
  if (!it) { rows.push(`| ${t.session} | ${t.sloka} | ${t.kind} | no session or item |`); continue; }
  const ph = it.phonology || null;
  if (!ph) missingPhonology++;
  const errors = ph && ph.errors ? ph.errors : {};
  const aligned = ph && Array.isArray(ph.aligned) ? ph.aligned : null;
  const slips = Array.isArray(it.slips) ? it.slips.map((x) => x.kind) : [];
  const voice = t.voice || 'unknown';
  const labels = Array.isArray(t.labels) ? t.labels : [];
  const found = [];
  if (t.kind === 'clean' || !labels.length) {
    for (const cat of CATEGORIES) { const c = cell(voice, cat); c.clean++; if (errors[cat]) { c.falseAlarms++; found.push(`${cat}×${errors[cat]}`); } }
    for (const sl of SLIPS) { const c = cell(voice, sl); c.clean++; if (slips.includes(sl)) { c.falseAlarms++; found.push(sl); } }
  } else {
    for (const l of labels) {
      const cat = l.category;
      const c = cell(voice, cat);
      c.labelled++;
      let hit = false;
      if (SLIPS.includes(cat)) hit = slips.includes(cat);
      else if (aligned && Number.isInteger(l.akshara)) {
        // at the labelled akṣara, or one either side (the alignment can be off by one)
        for (const k of [l.akshara - 1, l.akshara - 2, l.akshara]) { const a = aligned[k]; if (a && a.kind !== 'ok' && (!a.errors || a.errors.includes(cat) || a.kind === 'replaced' || a.kind === 'missing')) hit = true; }
        if (!hit && errors[cat]) hit = true; // anywhere in the sloka, when the alignment did not keep the place
      } else hit = !!errors[cat];
      if (hit) { c.detected++; found.push(cat); }
    }
  }
  rows.push(`| ${t.session} | ${t.sloka} | ${t.kind} | ${labels.map((l) => `${l.category}@${l.akshara ?? '-'}`).join(' ') || '—'} | ${found.join(' ') || '—'} | ${it.phoneme ?? '–'} / ${it.vowel ?? '–'} / ${it.syllable ?? '–'} |`);
}
const lines = [];
lines.push(`# Evaluation set: results`);
lines.push('');
lines.push(`*${new Date().toISOString().slice(0, 16).replace('T', ' ')} · app ${commit} · ${takes.length} takes from \`${MANIFEST}\`${missingPhonology ? ` · ${missingPhonology} items without a saved phonology (recorded before 21 October, or the words not heard)` : ''}.*`);
lines.push('');
lines.push('## Detection and false alarms by category and voice');
lines.push('');
lines.push('| voice | category | labelled | detected | detection | clean takes | false alarms | false-alarm rate |');
lines.push('|---|---|---|---|---|---|---|---|');
for (const [k, c] of [...tally].sort()) { const [voice, cat] = k.split('|'); lines.push(`| ${voice} | ${cat} | ${c.labelled} | ${c.detected} | ${c.labelled ? Math.round((100 * c.detected) / c.labelled) + ' %' : '–'} | ${c.clean} | ${c.falseAlarms} | ${c.clean ? Math.round((100 * c.falseAlarms) / c.clean) + ' %' : '–'} |`); }
lines.push('');
lines.push('## Every take');
lines.push('');
lines.push('| session | sloka | kind | labels | found | phonemes / vowels / syllables |');
lines.push('|---|---|---|---|---|---|');
lines.push(...rows);
const report = lines.join('\n');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, report);
console.log(report);
console.log(`\nwritten ${OUT}`);
