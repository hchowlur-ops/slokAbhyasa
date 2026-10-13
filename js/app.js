// SlokAbhyasa — main controller. Wires the four views (Player, Learn, Self Evaluation, Library)
// to the audio, analysis and storage modules.

import { Player } from './player.js';
import { Recorder } from './recorder.js';
import { encodeWav } from './wav.js';
import * as api from './api.js';
import { Analyzer } from './analyzer.js';
import { drawWaveform, drawLiveWave, ComparisonChart } from './visualizer.js';
import { serializeFeatures, deserializeFeatures, isValidFeatures, SR as FEAT_SR } from './dsp/features.js';
import { padaStarts, startTemplates, calibrate, matchStart, mfccRows, meanOf, TEMPLATE_SEC, TEMPLATE_FRAMES, MIN_TEMPLATE_FRAMES } from './dsp/starts.js';
import { MISMATCH_CONTRAST, confirmByWords } from './dsp/compare.js';
import { QUIZ_CATEGORIES, LEGACY_CATEGORIES, DEFAULT_QUIZ_CATEGORIES, DEFAULT_TOLERANCE, CATEGORY_WEIGHTS, categoryLabel, normalizeWeights, itemScores, attemptSummary, scoreFor, normalizeCategories, normalizeTolerance, recordTolerance, withinTolerance, itemVerdict, correctness, pickBaselines, overallScore, attemptOverall, itemOverall, applySlipPenalty, selfCorrections, SLIP_PENALTY, isPartial, gradeOf, gradeById, gradeWithSlips, gradeWords, slipsLabel, anySlips, modernCategories } from './quizscore.js';
import { comparePhonology, ERROR_LABEL, syllabify } from './phon.js';
import { SyllableCounter } from './dsp/syllables.js';
import { mixToMono, resample } from './dsp/resample.js';
import { trimSilence } from './dsp/trim.js';
import { Transcriber, STT_LANGUAGES, STT_LANGUAGE_CODES, STT_TIERS, sttLanguageLabel, sttLanguageTag, sttTierLabel, isStopped } from './stt.js';
import { segments as scriptSegments, wordSegments, toDeva, weightMark, inScript } from './lipi.js';
import { scriptToLatin, latinToScript } from './translit.js';
import { mapNameToVerse, parseVerseId, verseBody, versePlan } from './verses.js';
import { badgeEmoji, DEVICE as BADGE_DEVICE } from './badges.js';
import { normalizeStore, putInStore, pickTranscript, availableLanguages } from './transcripts.js';
import { transliterateTranscript } from './translit.js';
import { identifyChandas, layoutSloka, padaBreaks, linesFor, uvacaOffset, chandasLabel, chandasPattern, gitaVerse, gitaFamily, aksharaPlan } from './chandas.js';
import { periodRange, shiftPeriod, inRange, isoDate, slokaRows, summarize, KIND_LABEL, progress } from './reports.js';
import { diffWords, diffSummary, compareWords, tokenizeTranscript, windowedTokens, tokenize, dandaMarks, withDandas, uvacaWords, isUvacaLine, findSelfCorrections } from './textdiff.js';
import { AGE_GROUPS, VOICE_TYPES, STYLE_MODES, DEFAULT_STYLE_MODE, presetsFor, ADULT_PRESET, compareModeFor, speakerLabel, ageGroupLabel, styleMode, voiceStats, deriveText } from './meta.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------- helpers ----------

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; }
}

function toast(msg, kind = 'info', ms = 3500) {
  const host = $('#toast-host');
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = msg;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms);
}

const setHidden = (el, hidden) => { el.hidden = !!hidden; };

let audioCtx = null;
function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

async function decodeBlob(blob) {
  const ab = await blob.arrayBuffer();
  const ctx = getCtx();
  const buffer = await new Promise((resolve, reject) => {
    let settled = false;
    const ok = (b) => { if (!settled) { settled = true; resolve(b); } };
    const bad = (e) => { if (!settled) { settled = true; reject(e || new Error('decode failed')); } };
    try {
      const p = ctx.decodeAudioData(ab.slice(0), ok, bad);
      if (p && typeof p.then === 'function') p.then(ok, bad);
    } catch (e) { bad(e); }
  }).catch(() => { throw new Error('This file could not be decoded. Try a WAV, MP3, M4A or OGG file.'); });
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  return { samples: mixToMono(channels), sampleRate: buffer.sampleRate, duration: buffer.duration };
}

// Trim silence at both ends of a take { samples, sampleRate, duration }. Returns { take, info, changed }.
function trimTake(take, enabled) {
  if (!enabled) return { take, info: 'Not trimmed.', changed: false };
  const t = trimSilence(take.samples, take.sampleRate);
  if (!t.changed) return { take, info: 'Nothing to trim at the ends.', changed: false };
  const out = { ...take, samples: t.samples, duration: t.samples.length / take.sampleRate };
  const fmt = (s) => (s < 0.05 ? 'nothing' : `${s.toFixed(1)} s`);
  return { take: out, info: `Trimmed ${fmt(t.removedStart)} from the start and ${fmt(t.removedEnd)} from the end.`, changed: true, removedStart: t.removedStart, removedEnd: t.removedEnd };
}

// Redraw registry for resize / theme changes
const redraws = new Set();
let redrawTimer = 0;
function redrawAll() {
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(() => { for (const f of redraws) f(); if (chart) chart.draw(); }, 40);
}
window.addEventListener('resize', redrawAll);

// ---------- dialog ----------

// options: [{ value, label }] adds a select; the text field then becomes optional and the
// result is { choice, text } instead of the text alone.
function askDialog({ title, message = '', label = 'Name', value = '', okText = 'Save', input = true, danger = false, options = null, selectLabel = 'Choose', selected = '' }) {
  return new Promise((resolve) => {
    const dlg = $('#dialog');
    $('#dialog-title').textContent = title;
    $('#dialog-msg').textContent = message;
    setHidden($('#dialog-msg'), !message);
    setHidden($('#dialog-field'), !input);
    $('#dialog-label').textContent = label;
    const inp = $('#dialog-input');
    inp.value = value;
    inp.dataset.optional = options ? '1' : '';
    const selField = $('#dialog-select-field');
    const sel = $('#dialog-select');
    setHidden(selField, !options);
    if (options) {
      $('#dialog-select-label').textContent = selectLabel;
      sel.innerHTML = '';
      for (const o of options) { const el = document.createElement('option'); el.value = o.value; el.textContent = o.label; sel.appendChild(el); }
      sel.value = selected;
      if (sel.value !== selected && options.length) sel.value = options[0].value;
    }
    const ok = $('#dialog-ok');
    ok.textContent = okText;
    ok.classList.toggle('btn-danger', danger);
    ok.classList.toggle('btn-primary', !danger);
    const onClose = () => {
      dlg.removeEventListener('close', onClose);
      if (dlg.returnValue !== 'ok') return resolve(null);
      if (options) return resolve({ choice: sel.value, text: input ? inp.value.trim() : '' });
      resolve(input ? inp.value.trim() : true);
    };
    dlg.addEventListener('close', onClose);
    dlg.returnValue = 'cancel';
    dlg.showModal();
    if (options) sel.focus(); else if (input) { inp.focus(); inp.select(); } else ok.focus();
  });
}
$('#dialog-cancel').addEventListener('click', () => $('#dialog').close('cancel'));
$('#dialog-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = $('#dialog-input');
  if (!$('#dialog-field').hidden && !inp.dataset.optional && !inp.value.trim()) { inp.focus(); return; }
  $('#dialog').close('ok');
});

// ---------- theme ----------

const THEME_KEY = 'tutor-theme';
function applyTheme(t) { document.documentElement.dataset.theme = t; }
(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  applyTheme(saved || (mq.matches ? 'dark' : 'light'));
  mq.addEventListener('change', () => {
    let s = null;
    try { s = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
    if (!s) { applyTheme(mq.matches ? 'dark' : 'light'); redrawAll(); }
  });
  $('#theme-toggle').addEventListener('click', () => {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(t);
    try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
    redrawAll();
  });
})();

// ---------- shared UI bindings ----------

function bindSpeed({ slider = null, valueEl = null, chips = null, onChange }) {
  const apply = (r, silent = false) => {
    r = Math.round(r * 20) / 20;
    if (slider) slider.value = String(r);
    if (valueEl) valueEl.textContent = `${r.toFixed(2)}×`;
    if (chips) $$('.chip', chips).forEach((c) => c.classList.toggle('active', Math.abs(Number(c.dataset.speed) - r) < 0.001));
    if (!silent) onChange(r);
  };
  if (slider) slider.addEventListener('input', () => apply(Number(slider.value)));
  if (chips) chips.addEventListener('click', (e) => { const c = e.target.closest('.chip[data-speed]'); if (c) apply(Number(c.dataset.speed)); });
  return apply;
}

function bindPlayButton(btn, player) {
  btn.addEventListener('click', () => { if (!player.loaded) return; getCtx(); player.toggle(); });
  const sync = () => {
    btn.classList.toggle('playing', player.playing);
    btn.setAttribute('aria-label', player.playing ? 'Pause' : 'Play');
  };
  for (const ev of ['play', 'pause', 'ended']) player.addEventListener(ev, sync);
  player.addEventListener('error', () => toast('Playback was blocked. Click play again.', 'error'));
  return sync;
}

function bindWave(canvas, player, getSamples, curEl, durEl) {
  const draw = () => {
    const s = getSamples();
    if (!s) return;
    drawWaveform(canvas, s, { progress: player.duration ? player.currentTime / player.duration : 0 });
  };
  player.addEventListener('tick', () => { draw(); if (curEl) curEl.textContent = fmtTime(player.currentTime); });
  player.addEventListener('loaded', () => { if (durEl) durEl.textContent = fmtTime(player.duration); if (curEl) curEl.textContent = fmtTime(0); draw(); });
  if (canvas.classList.contains('wave-clickable')) {
    canvas.addEventListener('click', (e) => {
      if (!player.duration) return;
      const r = canvas.getBoundingClientRect();
      player.seek(((e.clientX - r.left) / r.width) * player.duration);
    });
  }
  redraws.add(draw);
  return draw;
}

function bindRecorderUI({ button, label, timer, meter, clip, live, idleText, recordingText }) {
  const peaks = [];
  let raf = 0;
  const ui = {
    elapsed: () => 0,
    onLevel(d) {
      peaks.push(d.peak);
      if (peaks.length > 600) peaks.shift();
      meter.style.width = `${Math.min(100, Math.round(d.rms * 320))}%`;
      if (d.clip) { clip.classList.add('on'); clearTimeout(ui._clipT); ui._clipT = setTimeout(() => clip.classList.remove('on'), 600); }
    },
    setRecording(on) {
      button.classList.toggle('recording', on);
      button.setAttribute('aria-label', on ? 'Stop' : 'Start');
      label.textContent = on ? recordingText : idleText;
      cancelAnimationFrame(raf);
      if (on) {
        peaks.length = 0;
        const loop = () => { timer.textContent = fmtTime(ui.elapsed()); drawLiveWave(live, peaks); raf = requestAnimationFrame(loop); };
        raf = requestAnimationFrame(loop);
      } else {
        meter.style.width = '0%';
        clip.classList.remove('on');
      }
    },
    reset() { timer.textContent = fmtTime(0); peaks.length = 0; drawLiveWave(live, peaks); },
  };
  redraws.add(() => drawLiveWave(live, peaks));
  ui.reset();
  return ui;
}

// target: an element id prefix ("x" → #x, #x-fill, #x-label) or { root, fill, label } elements.
// A progress bar. `show(text, onStop)` with a handler puts a Stop button next to the bar
// (for bars that have one in the markup); each show() replaces the previous handler.
function progressUI(target) {
  const root = typeof target === 'string' ? $(`#${target}`) : target.root;
  const fill = typeof target === 'string' ? $(`#${target}-fill`) : target.fill;
  const label = typeof target === 'string' ? $(`#${target}-label`) : target.label;
  const stop = typeof target === 'string' ? $(`#${target}-stop`) : target.stop || null;
  let onStop = null;
  if (stop) stop.addEventListener('click', () => { if (onStop) { stop.disabled = true; onStop(); } });
  const setStop = (fn) => {
    onStop = fn || null;
    if (stop) { setHidden(stop, !onStop); stop.disabled = false; }
  };
  return {
    show(text, stopFn) { setHidden(root, false); fill.style.width = '0%'; if (text) label.textContent = text; setStop(stopFn); },
    set(p, text) { fill.style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`; if (text) label.textContent = text; },
    hide() { setHidden(root, true); setStop(null); },
  };
}

// ---------- routing ----------

const VIEWS = ['home', 'learn', 'teach', 'evaluate', 'quiz', 'reports', 'library', 'settings', 'about'];
function showView(name) {
  if (!VIEWS.includes(name)) name = 'home';
  // Teach, Self Evaluation and a running quiz share one section. Each keeps its own entry
  // in the sidebar and its own title: a quiz that is running is the Quiz page (the list of
  // quizzes is the Quiz page when none is), and opening Self Evaluation leaves the quiz.
  if (name === 'evaluate' && practice.quiz) leaveQuiz(true);
  const running = name === 'quiz' && !!practice.quiz;
  const section = name === 'teach' || running ? 'evaluate' : name;
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${section}`));
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  if (name === 'library') refreshLibrary();
  if (name === 'evaluate' || name === 'teach') { setTeachMode(name === 'teach'); refreshPracticeSelect(); }
  if (name === 'quiz' && !running) refreshQuizView();
  if (running) renderModeChrome();
  if (name === 'reports') refreshReports();
  if (name === 'learn') refreshLearnFolders();
  if (name === 'home') renderHomeBadges();
  redrawAll();
}
$$('.nav-btn').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
window.addEventListener('hashchange', () => showView(location.hash.slice(1) || 'home'));

// ---------- state ----------

const analyzer = new Analyzer();

// ---------- speech to text: settings, shared controls, transcript panel ----------

const stt = new Transcriber();
const STT_KEY = 'tutor-stt';
const sttSettings = (() => {
  // cpuTiers: models this browser's GPU has been seen to get wrong; they run on the CPU.
  // auto: transcribe without being asked (Learn, Self Evaluation, quizzes); on by default,
  // and switched back on once for settings saved before that was the default (autoV).
  const d = { language: 'sanskrit', tier: null, auto: true, autoV: 2, cpuTiers: [] };
  let s = d;
  try { s = { ...d, ...JSON.parse(localStorage.getItem(STT_KEY) || '{}') }; } catch { /* defaults */ }
  // the model: a choice made before the dropdown went stays in force; otherwise chosen for this computer (see sttTier)
  if (s.tier && s.tier !== 'tiny' && !STT_TIERS.some((t) => t.id === s.tier)) s.tier = null;
  s.auto = s.auto !== false; // hear the words after Self Evaluation and quizzes (the Settings switch); on by default
  s.autoV = 2;
  if (!Array.isArray(s.cpuTiers)) s.cpuTiers = [];
  return s;
})();
// Called when the language the text is shown in changes anywhere.
const sttLanguageListeners = new Set();
// The language the text is shown in: Sanskrit as heard, or Kannada, Telugu or romanised
// (IAST) written from it, akṣara by akṣara, with laghu ◡ / guru — above each akṣara.
const TEXT_LANGUAGE_KEY = 'tutor-text-language';
let textLanguage = (() => { try { const v = localStorage.getItem(TEXT_LANGUAGE_KEY) || ''; return STT_LANGUAGE_CODES.includes(v) && v !== 'sanskrit' ? v : ''; } catch { return ''; } })();
const displayLanguage = () => textLanguage || 'sanskrit';
sttSettings.language = displayLanguage(); // the words are heard in the language the text is shown in: no step between
// ◡ laghu and — guru above every akṣara, in every script (off with the switch in Settings)
const MARKS_KEY = 'tutor-marks';
let marksOn = (() => { try { return localStorage.getItem(MARKS_KEY) !== '0'; } catch { return true; } })();
const marksShown = () => marksOn;
{
  const sel = $('#settings-text-language');
  const labels = { english: 'English · romanised (IAST)' };
  for (const l of STT_LANGUAGES) { if (l.code === 'sanskrit') continue; const o = document.createElement('option'); o.value = l.code; o.textContent = labels[l.code] || l.label; sel.appendChild(o); }
  sel.value = textLanguage;
  sel.addEventListener('change', () => {
    textLanguage = STT_LANGUAGE_CODES.includes(sel.value) && sel.value !== 'sanskrit' ? sel.value : '';
    try { if (textLanguage) localStorage.setItem(TEXT_LANGUAGE_KEY, textLanguage); else localStorage.removeItem(TEXT_LANGUAGE_KEY); } catch { /* ignore */ }
    sttSettings.language = displayLanguage();
    for (const fn of sttLanguageListeners) fn(displayLanguage());
  });
}
const escapeHtml = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// What a sloka without words is told (its words are the Gītā's or the typed text, never its recording's transcription)
// What the results say when the words were not heard because the switch is off
const WORDS_OFF_NOTE = 'The words were not heard: "Hear the words" is off in Settings, so phonemes, vowel length and syllables are not judged, and the overall rests on the sound alone (emphasis, pitch contour, phrasing, timing).';
const NO_WORDS_NOTE = 'No words for this sloka yet: link it to the Gītā in the Library (its name as CH12-03 does that by itself), or type its text under Details there. The recording itself is not transcribed.';
// Text in the chosen script: in a language other than Sanskrit every akṣara carries its weight
const segmentsHtml = (segs) => segs.map((sg) => (sg.sep != null ? escapeHtml(sg.sep) : sg.weight ? `<ruby>${escapeHtml(sg.text)}<rt>${weightMark(sg.weight)}</rt></ruby>` : escapeHtml(sg.text))).join('');
const scriptHtml = (text, language = displayLanguage()) => String(text || '').split('\n').map((line) => segmentsHtml(scriptSegments(line, language, { marks: marksOn }))).join('<br>');
// The transcript of a sloka in the language chosen for speech to text (none if it has not
// been transcribed in that language yet).
// … or, failing that, whatever it has: the comparison reads every script alike
const transcriptIn = (store, language = sttSettings.language) => pickTranscript(store, language) || pickTranscript(store);
let sttDevice = null;
// The model: one chosen before the dropdown went, else the Best (whisper-large-v3-turbo) —
// on the same recording it heard 91 where Better heard 68 and Fast 72, and on a graphics
// card that can run it, it is the quickest too. A card that gets it wrong sends it to the
// processor (cpuTiers): slower, but right.
async function sttTier() {
  if (sttSettings.tier) return sttSettings.tier;
  if (!sttDevice) sttDevice = await stt.probe().catch(() => 'wasm');
  return 'best';
}
function saveStt() { try { localStorage.setItem(STT_KEY, JSON.stringify(sttSettings)); } catch { /* ignore */ } }

const sttControlSets = new Set();
const sttAutoBoxes = new Set();
function buildSttControls(host) {
  host.innerHTML = '';
  const mk = (labelText, opts, key) => {
    const label = document.createElement('label');
    label.className = 'field inline';
    const span = document.createElement('span');
    span.textContent = labelText;
    const sel = document.createElement('select');
    for (const o of opts) {
      const op = document.createElement('option');
      op.value = o.value;
      op.textContent = o.label;
      if (o.title) op.title = o.title;
      sel.appendChild(op);
    }
    label.append(span, sel);
    host.appendChild(label);
    sel.addEventListener('change', () => {
      sttSettings[key] = sel.value;
      saveStt();
      syncSttControls();
    });
    return sel;
  };
  const set = {
    tier: mk('Model', STT_TIERS.map((t) => ({ value: t.id, label: t.label, title: t.hint })), 'tier'),
  };
  sttControlSets.add(set);
  syncSttControls();
  return set;
}
async function syncSttControls() {
  const tier = await sttTier();
  for (const s of sttControlSets) {
    if (!s.tier.isConnected) { sttControlSets.delete(s); continue; }
    s.tier.value = tier;
  }
}
function syncSttAuto() {
  for (const cb of sttAutoBoxes) {
    if (!cb.isConnected) { sttAutoBoxes.delete(cb); continue; }
    cb.checked = sttSettings.auto;
  }
}

// Transcribes in the speech worker; the caller carries on meanwhile. `signal` (an
// AbortSignal) stops the job, and the promise then rejects with an error isStopped() accepts.
// The language is the chosen one unless given; `background` jobs give way to everything else.
async function runTranscription(samples, sampleRate, progress, what, signal, { language = sttSettings.language, background = false } = {}) {
  const tier = await sttTier();
  const result = await stt.transcribe({
    samples, sampleRate, language, tier, signal, background,
    device: sttSettings.cpuTiers.includes(tier) ? 'wasm' : null,
    onProgress: (p) => {
      if (!progress) return;
      if (p.stage === 'load') progress.set(0.02, 'Preparing the speech model…');
      else if (p.stage === 'download') progress.set(0.6 * p.progress, `Downloading the speech model (${sttTierLabel(tier)}, ${Math.round((p.total || 0) / 1048576)} MB)… ${Math.round(p.progress * 100)}%`);
      else if (p.stage === 'ready') progress.set(0.62, `Listening to ${what}…`);
      else if (p.stage === 'transcribe') progress.set(0.7, `Transcribing ${what}…${p.partial ? ' ' + p.partial.slice(-70) : ''}`);
      else if (p.stage === 'retry') progress.set(0.65, `The first answer was nonsense; listening to ${what} once more…`);
      else if (p.stage === 'fallback') progress.set(0.65, `The graphics card's answer was nonsense; transcribing ${what} on the processor instead…`);
      else if (p.stage === 'steady') progress.set(0.72, `The words came out in a loop; transcribing ${what} once more, held steady…`);
    },
  });
  if (result.fellBack && !sttSettings.cpuTiers.includes(tier)) {
    sttSettings.cpuTiers.push(tier);
    saveStt();
    toast(`This computer's graphics card gets the ${sttTierLabel(tier)} model wrong, so from now on it runs on the processor: slower, but right.`, 'info', 9000);
  }
  delete result.fellBack; // the stored transcript records the device it was made on; that is enough
  result.createdAt = new Date().toISOString();
  // Kannada, Telugu or Sanskrit answered in Latin letters is written in its own script
  return transliterateTranscript(result);
}

// ---------- background transcription: every saved sloka that has no words yet ----------
// After a sloka is saved (and for the whole library on request) its recording is
// transcribed, in Sanskrit, in the speech worker at background priority: anything a person
// is waiting for goes first, and a running background job gives way. A transcript that is
// there already (least of all one someone corrected) is never replaced.

const bgQueue = []; // { rec, getAudio: async () => ({ samples, sampleRate }), languages }
let bgRun = null; // { ctrl } while the queue is being worked through
const transcriptListeners = new Set(); // fn(id, store): a sloka's stored transcripts changed
const notifyTranscripts = (id, store) => {
  if (store && store.meta) { // the server's details came back with the transcript (its chandas follows the words)
    const r = (libraryCache || []).find((x) => x.id === id);
    if (r) r.meta = store.meta;
    const b = practice.bases.get(id);
    if (b && b.record) b.record.meta = store.meta;
  }
  for (const fn of transcriptListeners) fn(id, store);
};
const langName = (code) => sttLanguageLabel(code).split(' · ')[0];

// What a store lacks: the Sanskrit transcript, when there is none.
function missingLanguages(store) {
  return availableLanguages(store).includes('sanskrit') ? [] : ['sanskrit'];
}

function queueBackgroundTranscription(rec, getAudio, languages) {
  const langs = languages.filter((c) => STT_LANGUAGE_CODES.includes(c));
  if (!langs.length) return;
  const existing = bgQueue.find((q) => q.rec.id === rec.id);
  if (existing) { for (const l of langs) if (!existing.languages.includes(l)) existing.languages.push(l); }
  else bgQueue.push({ rec, getAudio, languages: langs.slice() });
  renderBgStatus();
  if (!bgRun) runBackgroundQueue();
}
const bgRemaining = () => bgQueue.reduce((n, q) => n + q.languages.length, 0);
function renderBgStatus(doing = '') {
  const left = bgRemaining();
  setHidden($('#bg-status'), !bgRun && !left);
  $('#bg-status-text').textContent = doing ? `${doing}${left > 1 ? ` · ${left - 1} more to go` : ''}` : left ? `${left} transcription${left === 1 ? '' : 's'} waiting…` : '';
}
function runBackgroundQueue() {
  const ctrl = new AbortController();
  bgRun = { ctrl };
  let failed = 0;
  (async () => {
    try {
      while (bgQueue.length && !ctrl.signal.aborted) {
        const item = bgQueue[0];
        let audio = null;
        try { audio = await item.getAudio(); } catch (err) { console.warn(`background transcription: cannot read "${item.rec.name}": ${err.message}`); bgQueue.shift(); failed++; continue; }
        while (item.languages.length && !ctrl.signal.aborted) {
          const lang = item.languages[0];
          renderBgStatus(`Transcribing “${item.rec.name}” in ${langName(lang)}…`);
          try {
            // made meanwhile (inline, or corrected by hand)? then it is not redone
            const now = await api.getTranscript(item.rec.id).catch(() => null);
            if (!transcriptIn(now, lang)) {
              const t = await runTranscription(audio.samples, audio.sampleRate, null, item.rec.name, ctrl.signal, { language: lang, background: true });
              const store = await api.putTranscript(item.rec.id, t, { primary: false });
              notifyTranscripts(item.rec.id, store);
            }
            item.languages.shift();
          } catch (err) {
            if (isStopped(err)) break;
            console.warn(`background transcription of "${item.rec.name}" in ${lang} failed: ${err.message}`);
            item.languages.shift();
            failed++;
          }
        }
        if (!ctrl.signal.aborted) bgQueue.shift();
      }
    } finally {
      if (ctrl.signal.aborted) bgQueue.length = 0;
      bgRun = null;
      renderBgStatus();
      if (failed) toast(`${failed} background transcription${failed === 1 ? '' : 's'} failed; see the browser console.`, 'error', 6000);
    }
  })();
}
$('#bg-status-stop').addEventListener('click', () => { if (bgRun) { bgRun.ctrl.abort(); toast('Background transcription stopped.', 'info'); } });

// A saved sloka without words yet is transcribed in the background from the take still in
// memory. `have` lists what is (or is about to be) stored already.
function transcribeSavedInAllLanguages(rec, samples, sampleRate, have = []) {
  const store = { languages: Object.fromEntries(have.map((c) => [c, true])) };
  queueBackgroundTranscription(rec, async () => ({ samples, sampleRate }), missingLanguages(store));
}

// Move chunk timestamps by `delta` seconds (e.g. after trimming the start of the audio).
function shiftTranscript(t, delta, duration) {
  if (!t || !Array.isArray(t.chunks) || !delta) return t;
  return {
    ...t,
    chunks: t.chunks.map((c) => ({
      ...c,
      start: Math.max(0, c.start + delta),
      end: c.end == null ? null : Math.max(0, duration != null ? Math.min(duration, c.end + delta) : c.end + delta),
    })),
  };
}

// Renders a transcript as clickable phrases; `flagged` token indices get `cls`.
// `dandas`: lay the words out in the metre's lines with their daṇḍas; `perPada` gives the
// metre (the sloka's, so a recitation is laid out like the sloka it answers).
function renderTranscriptText(host, t, toks, flagged, cls, play, dimmed = null, dandas = false, perPada = null) {
  host.innerHTML = '';
  host.lang = sttLanguageTag(displayLanguage());
  const written = wordSegments(toks.map((tok) => tok.word), displayLanguage(), { marks: marksOn }); // each word in the chosen script, its akṣaras marked when asked
  if (!toks.length) { host.textContent = t.text || 'Nothing was recognised.'; host.classList.add('muted'); return; }
  host.classList.remove('muted');
  // a śloka's lines end in daṇḍas: after the token that ends each marked line, and a line
  // break between lines. When the tokens do not come from the text line by line (a timed
  // transcript's chunks), only the final ॥ is placed.
  const lineEnd = new Map(); // token index → { mark, last }
  if (dandas) {
    const { lines, marks } = dandaMarks(t.text);
    const counts = lines.map((l) => tokenize(l).length);
    const total = counts.reduce((x, y) => x + y, 0);
    const ppWanted = perPada || t.perPada || identifyChandas(t.text).perPada;
    const padaLines = lines.length - (lines.length > 1 && isUvacaLine(lines[0]) ? 1 : 0);
    // the text's own lines, when they are the lines the setting wants; else laid out by the metre
    if (lines.length > 1 && total === toks.length && padaLines === linesFor(ppWanted, slokaLines)) {
      let acc = 0;
      lines.forEach((l, li) => { acc += counts[li]; lineEnd.set(acc - 1, { mark: marks.get(li) || '', last: li === lines.length - 1 }); });
    } else if (lines.length) {
      // one line: broken at the pāda or half-verse boundaries by the metre, between words
      const words = toks.map((tok) => tok.word);
      const skip = uvacaWords(words); // "arjuna uvāca": a line of its own, no daṇḍa, not a pāda
      const pp = perPada || t.perPada || identifyChandas(t.text).perPada;
      const breaks = padaBreaks(words.slice(skip), pp, linesFor(pp, slokaLines)).map((b) => b + skip); // the triṣṭubh family always in four
      const n = breaks.length + 1;
      if (skip) lineEnd.set(skip - 1, { mark: '', last: false });
      const latin = !/[\u0900-\u0DFF]/.test(t.text);
      const markOf = (li) => (li === n - 1 ? (latin ? '||' : '॥') : (n === 2 && li === 0) || (n === 4 && li === 1) ? (latin ? '|' : '।') : '');
      breaks.forEach((b, li) => lineEnd.set(b, { mark: markOf(li), last: false }));
      lineEnd.set(toks.length - 1, { mark: markOf(n - 1), last: true });
    }
  }
  let ci = null;
  let span = null;
  toks.forEach((tok, i) => {
    if (tok.chunk !== ci || !span) {
      ci = tok.chunk;
      span = document.createElement('span');
      span.className = 'stt-chunk';
      const c = t.chunks && t.chunks[ci];
      if (c && play) {
        span.title = `${fmtTime(c.start)} – ${c.end != null ? fmtTime(c.end) : 'end'} · click to play`;
        span.addEventListener('click', () => play(Math.max(0, c.start - 0.1), (c.end != null ? c.end : c.start + 6) + 0.1));
      }
      host.appendChild(span);
    }
    const w = document.createElement('span');
    w.className = `w${flagged.has(i) ? ` ${cls}` : ''}${dimmed && dimmed.has(i) ? ' w-dim' : ''}`;
    w.innerHTML = segmentsHtml(written[i]);
    span.appendChild(w);
    const le = lineEnd.get(i);
    if (le) {
      if (le.mark) { const d = document.createElement('span'); d.className = 'danda'; d.textContent = le.mark; span.appendChild(d); }
      if (!le.last) { host.appendChild(document.createElement('br')); span = null; return; } // the next word opens a new chunk span
    }
    span.appendChild(document.createTextNode(' '));
  });
}

// A transcript panel: language/model controls, automatic toggle, progress, text,
// optional editing. `setSource(fn)` supplies { samples, sampleRate, what } for "Transcribe".
function createTranscriptPanel(host, { editable = false, play = null, onChange = null, onStale = null, title = 'Transcript', controls = false, emptyText = 'No transcript yet.' } = {}) {
  host.innerHTML = `
    <div class="tp-head">
      <span class="tp-title"></span>
      <div class="stt-controls"></div>
      <label class="toggle small"><input type="checkbox" data-role="auto" /><span>Automatic</span></label>
      <div class="grow"></div>
      <button class="btn btn-sm" type="button" data-act="run">Transcribe</button>
      <button class="btn btn-sm btn-ghost" type="button" data-act="edit" hidden>Edit</button>
      <button class="btn btn-sm btn-primary" type="button" data-act="save" hidden>Save text</button>
      <button class="btn btn-sm btn-ghost" type="button" data-act="cancel" hidden>Cancel</button>
    </div>
    <div class="progress" hidden><div class="progress-bar"><div class="progress-fill"></div></div><span class="muted small">Starting…</span><button class="btn btn-sm btn-ghost progress-stop" type="button" hidden>Stop</button></div>
    <div class="stt-text" data-role="text" hidden></div>
    <textarea class="stt-edit" data-role="edit" rows="4" hidden spellcheck="false"></textarea>
    <div class="muted small" data-role="edit-hint" hidden>The text is shown in romanised Sanskrit (IAST) to edit — type it the same way: ā ī ū ṛ for the long vowels (or aa ii uu), ś ṣ (or sh), ṭ ḍ ṇ, ṃ for the anusvāra, ḥ for the visarga, ’ for the avagraha, "ch" for छ and "c" for च. It is written in Devanagari when you save, and Kannada, Telugu and IAST follow from that. One line per phrase; keep the same number of lines to keep the click-to-play timings.</div>
    <div class="muted small" data-role="status">No transcript yet.</div>
    <div class="muted small locked-note" data-role="locked" hidden></div>`;
  $('.tp-title', host).textContent = title;
  if (controls) buildSttControls($('.stt-controls', host)); else { setHidden($('.stt-controls', host), true); setHidden($('[data-role="auto"]', host).closest('label'), true); } // the Library shows the words without a model or an Automatic switch
  const autoCb = $('[data-role="auto"]', host);
  autoCb.checked = sttSettings.auto;
  autoCb.addEventListener('change', () => { sttSettings.auto = autoCb.checked; saveStt(); syncSttAuto(); });
  sttAutoBoxes.add(autoCb);
  const prog = progressUI({ root: $('.progress', host), fill: $('.progress-fill', host), label: $('.progress > span', host), stop: $('.progress-stop', host) });
  const textEl = $('[data-role="text"]', host);
  const editEl = $('[data-role="edit"]', host);
  const editHint = $('[data-role="edit-hint"]', host);
  const statusEl = $('[data-role="status"]', host);
  const runBtn = $('[data-act="run"]', host);
  const editBtn = $('[data-act="edit"]', host);
  const saveBtn = $('[data-act="save"]', host);
  const cancelBtn = $('[data-act="cancel"]', host);
  const lockedEl = $('[data-role="locked"]', host);
  let canEdit = editable;
  let transcript = null;
  let others = []; // the other languages this recording is transcribed in
  let flagged = new Set();
  let flagClass = 'w-del';
  let source = null;
  let sourceKey = null; // what the source belongs to (a sloka id), handed to onStale
  let inflight = null;
  let stopper = null; // AbortController of the in-flight transcription
  let gen = 0; // bumped by reset(): a transcription that finishes later belongs to something else
  let dimmed = null;

  const render = () => {
    const editing = !editEl.hidden;
    setHidden(textEl, !transcript || editing);
    setHidden(editBtn, !canEdit || !transcript || editing);
    setHidden(saveBtn, !editing);
    setHidden(cancelBtn, !editing);
    setHidden(editHint, !editing);
    setHidden(runBtn, editing || !controls); // … and without a Transcribe button
    runBtn.textContent = transcript ? 'Transcribe again' : 'Transcribe';
    if (!transcript) { statusEl.textContent = emptyText; return; }
    renderTranscriptText(textEl, transcript, tokenizeTranscript(transcript), flagged, flagClass, play, dimmed, true);
    const how = transcript.from === 'reference' ? `the Gītā's words${transcript.verse ? `, verse ${transcript.verse}` : ''}` : transcript.edited ? (transcript.editedIn === 'file' ? 'edited in the text file' : 'corrected by you') : sttTierLabel(transcript.tier);
    const lang = transcript.language && transcript.language !== 'unknown' ? sttLanguageLabel(transcript.language) : 'Text';
    const shown = marksShown() ? ` · shown in ${langName(displayLanguage())}, ◡ laghu — guru` : '';
    statusEl.textContent = `${lang} · ${how}${transcript.createdAt ? ' · ' + fmtDate(transcript.createdAt) : ''}${shown}`;
  };
  // Editing works line by line: each timed phrase is one line, so corrections keep their timings.
  const editText = (t) => (t.chunks && t.chunks.length ? t.chunks.map((c) => c.text).join('\n') : t.text);
  // The editor shows romanised Sanskrit (IAST), letter for letter, since few have an Indic
  // keyboard; what is saved is the Devanagari read back from it.
  const toEditor = (deva) => scriptToLatin(deva);
  const fromEditor = (latin) => latinToScript(latin, 'Deva', { reading: 'exact' });
  const applyEdit = (t, value) => {
    const lines = value.split('\n').map((s) => s.trim()).filter(Boolean);
    const keepTimings = t.chunks && t.chunks.length && lines.length === t.chunks.length;
    return {
      ...t,
      text: lines.join(' '),
      chunks: keepTimings ? t.chunks.map((c, i) => ({ ...c, text: lines[i] })) : [],
      edited: true,
      editedIn: 'app',
      createdAt: new Date().toISOString(),
    };
  };

  const panel = {
    get transcript() { return transcript; },
    get busy() { return !!inflight; },
    wait() { return inflight || Promise.resolve(transcript); },
    // Shows a transcript; with the sloka's store, the other languages it exists in are listed.
    set(t, store = null) {
      transcript = t || null;
      others = store ? availableLanguages(store).filter((c) => !t || c !== t.language) : [];
      flagged = new Set(); dimmed = null; setHidden(editEl, true); render();
    },
    highlight(set, cls = 'w-del', dim = null) { flagged = set || new Set(); flagClass = cls; dimmed = dim; render(); },
    // Updates the list of other languages without touching the text or its highlights.
    setOthers(store) { others = store ? availableLanguages(store).filter((c) => !transcript || c !== transcript.language) : []; render(); },
    // Shows another transcript, dropping a transcription in flight (a late result is ignored).
    swap(t, store = null) {
      if (stopper) stopper.abort();
      gen++; inflight = null; stopper = null; runBtn.disabled = false; prog.hide();
      panel.set(t, store);
    },
    setSource(fn, key = null) { source = fn; sourceKey = key; },
    // Editing on or off (off: the words are the reference dataset's), with the note that says so.
    setEditable(on, note = '') { canEdit = !!on; lockedEl.textContent = on ? '' : note; setHidden(lockedEl, on || !note); if (!on) setHidden(editEl, true); render(); },
    // The panel forgets its content. A transcription still running carries on in the
    // worker; its result goes to onStale (or nowhere). cancel() first to stop it instead.
    reset() {
      gen++;
      inflight = null; stopper = null;
      runBtn.disabled = false;
      transcript = null; others = []; flagged = new Set(); dimmed = null; source = null; sourceKey = null;
      setHidden(editEl, true); prog.hide(); render();
    },
    // Stops the in-flight transcription (the Stop button does the same).
    cancel() { if (stopper) stopper.abort(); },
    // Hands the in-flight transcription over to the caller: the panel stops showing it and
    // will not stop it, and the returned promise resolves with the transcript (or null).
    detach() {
      const run = inflight;
      inflight = null; stopper = null;
      runBtn.disabled = false; prog.hide();
      return run || Promise.resolve(transcript);
    },
    transcribe(what) {
      if (!source) return Promise.resolve(null);
      if (inflight) return inflight;
      const mine = gen;
      const key = sourceKey;
      const ctrl = new AbortController();
      const run = (async () => {
        runBtn.disabled = true;
        prog.show('Starting…', () => ctrl.abort());
        try {
          getCtx();
          const src = await source();
          const t = await runTranscription(src.samples, src.sampleRate, prog, what || src.what || 'the recording', ctrl.signal);
          if (mine !== gen) { if (onStale) await onStale(t, key); return t; } // the panel moved on: never show or save it here
          panel.set(t);
          if (onChange) await onChange(t);
          return t;
        } catch (err) {
          if (isStopped(err)) { if (mine === gen) statusEl.textContent = 'Transcription stopped.'; return null; }
          if (mine === gen) statusEl.textContent = `Transcription failed: ${err.message}`;
          toast(err.message, 'error', 8000);
          return null;
        } finally {
          if (inflight === run) { inflight = null; stopper = null; runBtn.disabled = false; prog.hide(); }
        }
      })();
      inflight = run;
      stopper = ctrl;
      return inflight;
    },
  };
  runBtn.addEventListener('click', () => panel.transcribe());
  sttLanguageListeners.add(() => render()); // the text follows the script it is shown in
  editBtn.addEventListener('click', () => {
    editEl.value = toEditor(editText(transcript));
    editEl.rows = Math.min(12, Math.max(3, editEl.value.split('\n').length + 1));
    setHidden(editEl, false);
    render();
    editEl.focus();
  });
  cancelBtn.addEventListener('click', () => { setHidden(editEl, true); render(); });
  saveBtn.addEventListener('click', async () => {
    const value = fromEditor(editEl.value);
    setHidden(editEl, true);
    if (transcript && value.trim() !== editText(transcript).trim()) {
      transcript = applyEdit(transcript, value);
      flagged = new Set();
      render();
      if (onChange) await onChange(transcript);
    } else render();
  });
  render();
  return panel;
}

// Folder names for people: '' is the top level of the library, which only older files still use.
const folderLabel = (f) => (f ? f : 'Top level');
// Folders worth showing: every real folder, plus the top level only while files are still there.
const visibleFolders = (folders) => folders.filter((f) => f.path !== '' || f.count > 0);
// Folders a sloka can be saved in or moved to: never the top level.
const targetFolders = (folders) => folders.filter((f) => f.path !== '');
function fmtStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
let foldersCache = null;
async function getFolders(force = false) {
  if (!foldersCache || force) {
    try { foldersCache = await api.listFolders(); } catch { foldersCache = [{ path: '', count: 0 }]; }
  }
  return foldersCache;
}
// "Move to" / "save in" chooser: existing folders, or a new one typed in. Returns the folder
// path ('' for top level), or null when cancelled.
async function chooseFolder({ title, current = '', okText = 'Move', message = '' }) {
  const folders = targetFolders(await getFolders(true));
  let r;
  if (folders.length) {
    r = await askDialog({
      title, message, okText, input: true, label: 'Or a new folder', value: '',
      options: folders.map((f) => ({ value: f.path, label: `${f.path} (${f.count})` })),
      selectLabel: 'Folder', selected: current,
    });
  } else {
    const text = await askDialog({ title, message: message || 'There are no folders yet; name the first one.', okText, label: 'New folder', value: '' });
    r = text ? { choice: '', text } : null;
  }
  if (!r) return null;
  if (r.text) {
    try { const made = await api.createFolder(r.text); foldersCache = null; return made.path; } catch (err) { toast(err.message, 'error'); return null; }
  }
  return r.choice || null;
}

let libraryCache = null;
async function getLibrary(force = false) {
  if (!libraryCache || force) {
    try { libraryCache = await api.listBaselines(); foldersCache = null; } catch (err) { toast(`Cannot reach the SlokAbhyasa server (${err.message}). Start it with: node serve.js`, 'error', 6000); libraryCache = []; }
  }
  return libraryCache;
}

// ======================================================================
// PEOPLE — who records a sloka, who recites it
// ======================================================================
// Profiles live in profiles.json at the data root (names never enter the library). The
// learner chosen in the sidebar is who Self Evaluation and quizzes judge: a child's voice
// and pace get the allowances of the research presets (see js/meta.js).

const LEARNER_KEY = 'tutor-learner';
let profilesCache = null;
async function getProfiles(force = false) {
  if (!profilesCache || force) {
    try { profilesCache = await api.listProfiles(); } catch { profilesCache = profilesCache || []; }
  }
  return profilesCache;
}
let learnerId = (() => { try { return localStorage.getItem(LEARNER_KEY) || ''; } catch { return ''; } })();
const profileById = (id) => (profilesCache || []).find((p) => p.id === id) || null;
// The learner as the evaluation sees them, or null: no one chosen, adult defaults.
function learnerSpeaker() {
  const p = profileById(learnerId);
  return p ? { profileId: p.id, voiceType: p.voiceType, ageGroup: p.ageGroup } : null;
}
const learnerName = () => { const p = profileById(learnerId); return p ? p.name : ''; };
// A sloka's speaker when something is known about them, else null.
const speakerOf = (meta) => (meta && meta.speaker && (meta.speaker.voiceType !== 'preferNotToSay' || meta.speaker.ageGroup !== 'unspecified') ? meta.speaker : null);
// "Ananya (child, 8 to 11)"
const profileLabel = (p) => { const d = speakerLabel(p); return d ? `${p.name} (${d})` : p.name; };

function fillSelect(sel, items, value) {
  sel.innerHTML = '';
  for (const it of items) { const o = document.createElement('option'); o.value = it.value; o.textContent = it.label; sel.appendChild(o); }
  sel.value = value;
  if (sel.value !== value && items.length) sel.value = items[0].value;
}
const voiceOptions = () => VOICE_TYPES.map((v) => ({ value: v.id, label: v.label }));
const ageOptions = () => AGE_GROUPS.map((a) => ({ value: a.id, label: a.label }));

// ---------- badges: a quiz mastered (see js/badges.js) ----------
// The badges on file, every learner's; the chosen learner's are shown (the device's when
// no one is chosen). Fetched once, again after an attempt or a change of the rule.
let badgesCache = null; // { rule, badges }
let badgesLoading = null;
function getBadges(force = false) {
  if (badgesCache && !force) return Promise.resolve(badgesCache);
  if (!badgesLoading) badgesLoading = api.listBadges().then((b) => { badgesCache = b; return b; }).catch(() => (badgesCache = badgesCache || { rule: { differentDays: true }, badges: [] })).finally(() => { badgesLoading = null; });
  return badgesLoading;
}
const learnerBadges = () => (badgesCache ? badgesCache.badges.filter((b) => b.learner === (learnerId || BADGE_DEVICE)) : []);
const fmtBadgeDay = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
async function renderHomeBadges() {
  await getBadges();
  const box = $('#home-badges');
  const list = $('#home-badges-list');
  const mine = learnerBadges().slice().sort((a, b) => String(b.earnedAt).localeCompare(String(a.earnedAt)));
  list.innerHTML = '';
  $('#home-badges-lead').textContent = learnerName() ? `${learnerName()}'s badges` : 'Badges';
  for (const b of mine) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="hb-emoji"></span><span class="hb-title"></span><span class="hb-when"></span>';
    li.firstChild.textContent = badgeEmoji(b);
    li.children[1].textContent = b.title;
    li.lastChild.textContent = `${b.kind === 'quiz' ? 'mastered' : 'by heart'} ${fmtBadgeDay(b.earnedAt)}${b.level > 1 ? ` · level ${b.level}` : ''}`;
    li.title = b.kind === 'quiz' ? `Excellent ${b.evidence ? b.evidence.length : 3} times, every sloka recited, no slip${b.itemNames ? ` · ${b.itemNames.length} slokas: ${b.itemNames.slice(0, 6).join(', ')}${b.itemNames.length > 6 ? '…' : ''}` : ''}` : 'Every verse covered by a mastered quiz';
    list.appendChild(li);
  }
  setHidden(box, !mine.length);
}
// A badge earned (or its level raised) by the attempt just saved: a card over the results
// for a moment, calm — the badge, what it is for, and how it was earned.
let badgeCardTimer = null;
function showBadgeCard(awards, quiz) {
  const a = awards.find((x) => x.kind === 'quiz') || awards[0];
  if (!a) return;
  const card = $('#badge-card');
  $('#badge-card-emoji').textContent = awards.map(badgeEmoji).join(' ');
  $('#badge-card-title').textContent = a.kind === 'quiz' ? (a.change === 'raised' ? `Level ${a.level} on ${a.title}!` : `You mastered ${a.title}!`) : `${a.title}!`;
  const days = a.kind === 'quiz' && quiz && Array.isArray(a.evidence) ? a.evidence.map((n) => quiz.attempts && quiz.attempts[n - 1] ? fmtBadgeDay(quiz.attempts[n - 1].at) : null).filter(Boolean) : [];
  const others = awards.filter((x) => x !== a).map((x) => x.title);
  $('#badge-card-sub').textContent = [days.length ? `Excellent on ${days.join(', ')}` : '', others.length ? `And with it: ${others.join(', ')}` : ''].filter(Boolean).join(' · ');
  setHidden(card, false);
  clearTimeout(badgeCardTimer);
  badgeCardTimer = setTimeout(() => setHidden(card, true), 12000);
  getBadges(true).then(() => { renderHomeBadges(); renderQuizList(); });
}
$('#badge-card-close').addEventListener('click', () => { clearTimeout(badgeCardTimer); setHidden($('#badge-card'), true); });
// the rule: three different days, or any
{
  const cb = $('#settings-badge-days');
  getBadges().then((b) => { cb.checked = !!(b.rule && b.rule.differentDays); });
  cb.addEventListener('change', async () => {
    try { badgesCache = await api.patchBadgeRule({ differentDays: cb.checked }); renderHomeBadges(); renderQuizList(); toast(cb.checked ? 'Badges now need three Excellent attempts on three different days.' : 'Badges now need three Excellent attempts on any days.', 'info', 4000); } catch (err) { toast(err.message, 'error'); cb.checked = !cb.checked; }
  });
}

const learnerListeners = new Set(); // re-rendered when the learner or the people change
async function renderLearnerSelect() {
  const profiles = await getProfiles();
  if (learnerId && !profileById(learnerId)) learnerId = '';
  // names alone: the voice and age behind a name are the People dialog's business
  fillSelect($('#learner-select'), [{ value: '', label: profiles.length ? 'Anyone' : 'No one yet' }, ...profiles.map((p) => ({ value: p.id, label: p.name }))], learnerId);
  for (const fn of learnerListeners) fn();
}
$('#learner-select').addEventListener('change', (e) => {
  learnerId = e.target.value;
  try { if (learnerId) localStorage.setItem(LEARNER_KEY, learnerId); else localStorage.removeItem(LEARNER_KEY); } catch { /* ignore */ }
  for (const fn of learnerListeners) fn();
});

// The people dialog: list, add, edit, remove.
let personEditing = null;
function renderPeopleList() {
  const ul = $('#people-list');
  ul.innerHTML = '';
  const profiles = profilesCache || [];
  if (!profiles.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No one yet. Add the people who record and recite here.';
    ul.appendChild(li);
  }
  for (const p of profiles) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="person-name"></span><span class="person-desc"></span><button class="btn btn-sm" type="button" data-act="edit">Edit</button><button class="btn btn-sm btn-ghost" type="button" data-act="remove">Remove</button>';
    $('.person-name', li).textContent = p.name;
    $('.person-desc', li).textContent = speakerLabel(p) || 'voice and age not given';
    $('[data-act="edit"]', li).addEventListener('click', () => startPersonEdit(p));
    $('[data-act="remove"]', li).addEventListener('click', async () => {
      const ok = await askDialog({ title: `Remove ${p.name}?`, message: 'Slokas recorded by this person keep their voice type and age group; only the name goes.', input: false, okText: 'Remove', danger: true });
      if (!ok) return;
      try { await api.deleteProfile(p.id); await getProfiles(true); if (personEditing && personEditing.id === p.id) startPersonEdit(null); renderPeopleList(); renderLearnerSelect(); } catch (err) { toast(err.message, 'error'); }
    });
    ul.appendChild(li);
  }
}
function startPersonEdit(p) {
  personEditing = p;
  $('#people-edit-title').textContent = p ? `Edit ${p.name}` : 'Add a person';
  $('#person-name').value = p ? p.name : '';
  fillSelect($('#person-voice'), voiceOptions(), p ? p.voiceType : 'preferNotToSay');
  fillSelect($('#person-age'), ageOptions(), p ? p.ageGroup : 'unspecified');
  $('#person-save').textContent = p ? 'Save' : 'Add';
  setHidden($('#person-cancel'), !p);
  if (p) $('#person-name').focus();
}
$('#person-cancel').addEventListener('click', () => startPersonEdit(null));
$('#person-save').addEventListener('click', async () => {
  const name = $('#person-name').value.trim();
  if (!name) { $('#person-name').focus(); return; }
  const body = { name, voiceType: $('#person-voice').value, ageGroup: $('#person-age').value };
  try {
    const saved = personEditing ? await api.patchProfile(personEditing.id, body) : await api.createProfile(body);
    await getProfiles(true);
    if (!personEditing && !learnerId) { learnerId = saved.id; try { localStorage.setItem(LEARNER_KEY, learnerId); } catch { /* ignore */ } }
    startPersonEdit(null);
    renderPeopleList();
    renderLearnerSelect();
    toast(`${saved.name} ${personEditing ? 'updated' : 'added'}.`, 'success');
  } catch (err) { toast(err.message, 'error'); }
});
async function openPeople() {
  await getProfiles(true);
  startPersonEdit(null);
  renderPeopleList();
  const dlg = $('#people-dialog');
  if (!dlg.open) dlg.showModal();
  if (!(profilesCache || []).length) $('#person-name').focus();
}
$('#people-manage').addEventListener('click', openPeople);
$('#people-form').addEventListener('submit', (e) => { e.preventDefault(); $('#people-dialog').close(); });
$('#people-dialog').addEventListener('close', () => renderLearnerSelect());

// Metadata fields of a sloka about to be saved (both Learn tabs) or already in the library:
// who recorded it, how it is meant to be judged, its text. Returns { read(), reset(), setText() }.
const LEARN_SPEAKER_KEY = 'tutor-learn-speaker';
const LEARN_STYLE_KEY = 'tutor-learn-style';
function buildMetaFields(host, { compact = false } = {}) {
  host.innerHTML = `
    <label class="field"><span>Recorded by</span><select data-f="speaker"></select></label>
    <label class="field"><span>How it is judged</span><select data-f="style"></select></label>
    <label class="field" title="The lineage whose way of reciting this recording follows — a maṭha, a guru or a school (Śṛṅgeri, Kāñcī, Uḍupi, a teacher's name). Kept with the recording as a note for whoever learns from it; it does not change how anything is scored."><span>Tradition or school <em class="muted">(optional)</em></span><input type="text" data-f="tradition" maxlength="80" placeholder="e.g. Śṛṅgeri, Kāñcī, a guru's name" autocomplete="off" /></label>
    <label class="field wide"><span>Text of the sloka <em class="muted">(optional · the words as they should be recited; used to judge pronunciation)</em></span><textarea data-f="text" rows="${compact ? 3 : 4}" spellcheck="false" placeholder="Type or paste the text, one pāda or line per row…"></textarea></label>
    <span class="derived" data-f="derived"></span>
    <span class="muted small locked-note" data-f="text-locked" hidden></span>`;
  const speakerSel = $('[data-f="speaker"]', host);
  const styleSel = $('[data-f="style"]', host);
  const tradInp = $('[data-f="tradition"]', host);
  const textArea = $('[data-f="text"]', host);
  let textLocked = false;
  const derived = $('[data-f="derived"]', host);
  let remembered = { speaker: '', style: DEFAULT_STYLE_MODE };
  try { remembered = { speaker: localStorage.getItem(LEARN_SPEAKER_KEY) || '', style: localStorage.getItem(LEARN_STYLE_KEY) || DEFAULT_STYLE_MODE }; } catch { /* ignore */ }
  let want = { speaker: remembered.speaker, style: remembered.style };
  const fillSpeakers = () => {
    const profiles = profilesCache || [];
    const items = [{ value: '', label: 'Not recorded' }, ...profiles.map((p) => ({ value: p.id, label: profileLabel(p) })), { value: '__new__', label: 'Someone new…' }];
    fillSelect(speakerSel, items, want.speaker);
    if (speakerSel.value === '__new__') speakerSel.value = '';
  };
  fillSelect(styleSel, STYLE_MODES.map((m) => ({ value: m.id, label: m.label })), want.style);
  fillSpeakers();
  learnerListeners.add(fillSpeakers);
  speakerSel.addEventListener('change', async () => {
    if (speakerSel.value === '__new__') { speakerSel.value = want.speaker; await openPeople(); return; }
    want.speaker = speakerSel.value;
    try { localStorage.setItem(LEARN_SPEAKER_KEY, want.speaker); } catch { /* ignore */ }
  });
  styleSel.addEventListener('change', () => { want.style = styleSel.value; try { localStorage.setItem(LEARN_STYLE_KEY, want.style); } catch { /* ignore */ } });
  const describe = () => {
    const t = deriveText(textArea.value);
    derived.textContent = t ? `${t.aksharaCount} akṣara${t.aksharaCount === 1 ? '' : 's'} · ${t.padas.length} pāda${t.padas.length === 1 ? '' : 's'} · ${t.script === 'Deva' ? 'Devanagari' : t.script === 'Knda' ? 'Kannada' : t.script === 'Latn' ? 'Latin' : t.script}${t.svara.prescribed ? ' · svara marks' : ''}` : '';
  };
  textArea.addEventListener('input', describe);
  return {
    read() {
      const sp = profileById(speakerSel.value);
      return {
        speaker: sp ? { profileId: sp.id, voiceType: sp.voiceType, ageGroup: sp.ageGroup } : null,
        style: { mode: styleSel.value, tradition: tradInp.value.trim() || null },
        text: textLocked ? undefined : textArea.value.trim() ? { body: textArea.value.trim() } : null, // locked: the sidecar's text is left as it is
      };
    },
    // The words are the reference dataset's: the field shows them and is not edited.
    lockText(locked, note = '') {
      textLocked = !!locked;
      textArea.readOnly = textLocked;
      textArea.classList.toggle('locked', textLocked);
      const el = $('[data-f="text-locked"]', host);
      el.textContent = textLocked ? note : '';
      setHidden(el, !textLocked || !note);
    },
    set(meta) {
      want.speaker = (meta && meta.speaker && meta.speaker.profileId) || '';
      want.style = (meta && meta.style && meta.style.mode) || DEFAULT_STYLE_MODE;
      fillSpeakers();
      styleSel.value = want.style;
      tradInp.value = (meta && meta.style && meta.style.tradition) || '';
      textArea.value = (meta && meta.text && meta.text.body) || '';
      describe();
    },
    reset() { tradInp.value = ''; textArea.value = ''; describe(); fillSpeakers(); styleSel.value = want.style; },
    setText(t) { if (!textArea.value.trim() && t) { textArea.value = t; describe(); } },
    dispose() { learnerListeners.delete(fillSpeakers); },
  };
}

// ======================================================================
// LEARN
// ======================================================================

function activateTab(id) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === id));
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === id));
  redrawAll();
}
$$('.tab').forEach((t) => t.addEventListener('click', () => activateTab(t.dataset.tab)));

let learnRecorder = null;
function getLearnRecorder() {
  if (!learnRecorder) {
    learnRecorder = new Recorder(getCtx());
    learnRecorder.addEventListener('level', (e) => learnUI.onLevel(e.detail));
  }
  return learnRecorder;
}
const learnUI = bindRecorderUI({
  button: $('#learn-rec'), label: $('#learn-rec-label'), timer: $('#learn-timer'), meter: $('#learn-meter'), clip: $('#learn-clip'), live: $('#learn-live'),
  idleText: 'Tap to start listening', recordingText: 'Listening… tap to stop',
});
learnUI.elapsed = () => (learnRecorder ? learnRecorder.elapsed : 0);
const learnProgress = progressUI('learn-progress');
const learnPreview = new Player();
let learnTake = null; // { samples, sampleRate, duration, blob }
const drawLearnPreview = bindWave($('#learn-prev-wave'), learnPreview, () => learnTake && learnTake.samples, $('#learn-prev-cur'), $('#learn-prev-dur'));
bindPlayButton($('#learn-prev-play'), learnPreview);
const learnPanel = createTranscriptPanel($('#learn-transcript'), { title: 'Sloka text', editable: false, emptyText: 'Name the sloka as a verse of the Gītā (CH12-03 for 12.3, in a chapter folder) and its words appear here; otherwise type its text under Details below. The recording itself is not transcribed.' });
// The words a Learn recording will have: the Gītā's, when the name (with the folder) names
// a verse of the dataset here. Shown as it is typed; linked by the server when saved.
let learnVerseToken = 0;
async function showLearnVerse(panel, name, folder) {
  const token = ++learnVerseToken;
  const ids = await referenceDatasets().catch(() => []);
  if (token !== learnVerseToken) return;
  const guess = ids.length ? mapNameToVerse(String(name || '').trim(), folder || '') : null;
  if (!guess) { panel.set(null); return; }
  let entry = null;
  try { entry = await api.getVerse(ids[0], guess.id); } catch { entry = null; }
  if (token !== learnVerseToken) return;
  if (!entry) { panel.set(null); return; }
  const lines = verseBody(entry, { speakerLine: true }).split('\n').filter(Boolean);
  panel.set({ text: lines.join(' '), chunks: lines.map((l) => ({ text: l })), language: 'sanskrit', from: 'reference', verse: entry.id, edited: true, editedIn: 'reference' });
}
const learnVerseDebounce = (panel, nameEl) => { let t = null; return () => { clearTimeout(t); t = setTimeout(() => showLearnVerse(panel, nameEl.value, learnFolder()), 250); }; };
const learnMeta = buildMetaFields($('#learn-meta'));

$('#learn-rec').addEventListener('click', async () => {
  const rec = getLearnRecorder();
  if (rec.active) {
    const raw = await rec.stop();
    learnUI.setRecording(false);
    if (!raw || raw.duration < 0.5) { toast('That was too short. Try again.', 'error'); return; }
    const { take, info, removedStart = 0, removedEnd = 0 } = trimTake(raw, $('#learn-trim').checked);
    if (take.duration < 0.5) { toast('Hardly any sound was heard. Try again.', 'error'); return; }
    take.blob = encodeWav(take.samples, take.sampleRate);
    take.edit = { trimStartSec: removedStart, trimEndSec: removedEnd };
    learnTake = take;
    $('#learn-trim-info').textContent = info;
    $('#learn-prev-wave')._peaks = null;
    await learnPreview.load(take.blob);
    $('#learn-name').value = await defaultName();
    setHidden($('#learn-preview'), false);
    drawLearnPreview();
    $('#learn-name').focus();
    learnPanel.reset();
    showLearnVerse(learnPanel, $('#learn-name').value, learnFolder()); // the Gītā's words for this name, not a transcription
  } else {
    try {
      learnPreview.pause();
      setHidden($('#learn-preview'), true);
      learnUI.reset();
      await rec.start();
      learnUI.setRecording(true);
    } catch (err) {
      toast(err.message, 'error', 6000);
    }
  }
});

$('#learn-discard').addEventListener('click', () => {
  learnPreview.unload();
  learnTake = null;
  setHidden($('#learn-preview'), true);
  learnUI.reset();
  learnPanel.cancel();
  learnPanel.reset();
  learnMeta.reset();
});

// Saving never waits for a transcript that is still being written: the sloka is stored now
// and the transcript joins it when the worker is done. `adjust` maps the transcript to the
// saved audio (timings shift when the start was trimmed).
function saveTranscriptLater(late, rec, adjust = (t) => t) {
  late.then((t) => {
    if (!t) return;
    const tr = adjust(t);
    return api.putTranscript(rec.id, tr).then((store) => {
      const b = practice.bases.get(rec.id);
      if (b) {
        b.transcripts = store;
        if (!b.transcript) { b.transcript = transcriptIn(store); if (practice.activeId === rec.id && b.transcript) practicePanel.set(b.transcript, store); }
      }
      notifyTranscripts(rec.id, store);
      toast(`Transcript added to "${rec.name}".`, 'success');
    }, () => toast(`The transcript of "${rec.name}" could not be saved.`, 'error'));
  });
}

$('#learn-name').addEventListener('input', learnVerseDebounce(learnPanel, $('#learn-name')));
$('#learn-folder').addEventListener('change', () => { if (learnTake) showLearnVerse(learnPanel, $('#learn-name').value, learnFolder()); });
$('#learn-save-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!learnTake) return;
  const name = $('#learn-name').value.trim();
  if (!name) return;
  const btn = $('#learn-save');
  btn.disabled = true;
  try {
    learnPreview.pause();
    const rec = await saveBaseline({ name, ...learnTake, source: 'mic', meta: learnMeta.read() }, learnProgress);
    const link = rec.meta && rec.meta.verse;
    toast(`Saved "${rec.name}" to the library${link ? `, linked to Gītā ${link.id}: its words are the verse's` : ''}.`, 'success', 4000);
    $('#learn-discard').click();
  } catch (err) {
    toast(err.message, 'error', 6000);
  } finally {
    btn.disabled = false;
    learnProgress.hide();
  }
});

async function defaultName() {
  const list = await getLibrary();
  return `Sloka ${list.length + 1}`;
}

const LEARN_FOLDER_KEY = 'tutor-learn-folder';
async function refreshLearnFolders(select) {
  const sel = $('#learn-folder');
  const folders = await getFolders(true);
  let want = select !== undefined ? select : sel.value;
  if (select === undefined && !sel.dataset.ready) { try { want = localStorage.getItem(LEARN_FOLDER_KEY) || ''; } catch { want = ''; } }
  sel.innerHTML = '';
  const targets = targetFolders(folders);
  if (!targets.length) { const o = document.createElement('option'); o.value = ''; o.textContent = 'Choose a folder…'; sel.appendChild(o); }
  for (const f of targets) { const o = document.createElement('option'); o.value = f.path; o.textContent = f.path; sel.appendChild(o); }
  const nw = document.createElement('option');
  nw.value = '__new__';
  nw.textContent = 'New folder…';
  sel.appendChild(nw);
  sel.value = targets.some((f) => f.path === want) ? want : targets.length ? targets[0].path : '';
  sel.dataset.ready = '1';
}
$('#learn-folder').addEventListener('change', async (e) => {
  const sel = e.target;
  if (sel.value !== '__new__') { try { localStorage.setItem(LEARN_FOLDER_KEY, sel.value); } catch { /* ignore */ } return; }
  const name = await askDialog({ title: 'New folder', label: 'Folder name', value: '', okText: 'Create' });
  let made = '';
  if (name) { try { made = (await api.createFolder(name)).path; } catch (err) { toast(err.message, 'error'); } }
  await refreshLearnFolders(made);
  try { localStorage.setItem(LEARN_FOLDER_KEY, made); } catch { /* ignore */ }
});
const learnFolder = () => { const v = $('#learn-folder').value; return v === '__new__' ? '' : v; };
// Slokas are always saved in a folder. Asks for one when none is chosen; throws when refused.
async function requireLearnFolder() {
  let folder = learnFolder();
  if (folder) return folder;
  folder = await chooseFolder({ title: 'Which folder should this sloka go in?', okText: 'Save here', message: 'Slokas are kept in folders of the library, for example one per chapter.' });
  if (!folder) throw new Error('Choose a folder to save the sloka in.');
  await refreshLearnFolders(folder);
  try { localStorage.setItem(LEARN_FOLDER_KEY, folder); } catch { /* ignore */ }
  return folder;
}

// Saves a take as a sloka: the WAV, its analysis features and its metadata sidecar (who
// recorded it, style, text, what was measured in the voice, how it was captured).
async function saveBaseline({ name, samples, sampleRate, duration, blob, source, meta = null, capture = null, edit = null }, progress) {
  const folder = await requireLearnFolder();
  progress.show('Listening closely and remembering…');
  const features = await analyzer.features(samples, sampleRate, (p) => progress.set(p * 0.9));
  if (features.activeFrac < 0.05 || features.peakDb < -40) {
    throw new Error('Hardly any sound was detected. Check the microphone level and try again.');
  }
  progress.set(0.92, 'Saving to the library…');
  const rec = await api.createBaseline({ name, blob, duration, sampleRate, source, folder, autolink: true }); // CH12-03 → Gītā 12.3, when the dataset is here
  try { await api.putFeatures(rec.id, serializeFeatures(features)); } catch { /* cache is optional */ }
  try {
    const m = meta || {};
    const text = m.text && m.text.body ? deriveText(m.text.body) : null;
    let stats = null;
    try { stats = voiceStats(features, samples, { aksharaCount: text ? text.aksharaCount : null }); } catch { stats = null; }
    rec.meta = await api.putMeta(rec.id, {
      speaker: m.speaker || null,
      style: m.style || null,
      text: m.text || null,
      voice: stats ? stats.voice : null,
      measured: stats ? stats.measured : null,
      capture: capture ? { ...capture, environment: null } : null,
      edit: edit || null,
    });
  } catch (err) {
    toast(`The sloka was saved, but its details could not be: ${err.message}`, 'error', 6000);
  }
  progress.set(1, 'Done');
  libraryCache = null;
  return rec;
}

// Learn › file tab
let learnFile = null;
const drawLearnFile = () => { if (learnFile) drawWaveform($('#learn-file-wave'), learnFile.samples, { progress: 0 }); };
redraws.add(drawLearnFile);
const learnFilePanel = createTranscriptPanel($('#learn-file-transcript'), { title: 'Sloka text', editable: false, emptyText: 'Name the sloka as a verse of the Gītā (CH12-03 for 12.3, in a chapter folder) and its words appear here; otherwise type its text under Details below. The file itself is not transcribed.' });
$('#learn-file-name-input').addEventListener('input', learnVerseDebounce(learnFilePanel, $('#learn-file-name-input')));
const learnFileMeta = buildMetaFields($('#learn-file-meta-fields'), { compact: true });
function setLearnFile(l) {
  if (learnFile !== l) { learnFilePanel.cancel(); learnFilePanel.reset(); learnFileMeta.reset(); }
  learnFile = l;
  setHidden($('#learn-file-none'), !!l);
  setHidden($('#learn-file-loaded'), !l);
  if (!l) return;
  $('#learn-file-name').textContent = l.name;
  $('#learn-file-meta').textContent = `${fmtTime(l.duration)} · ${l.sampleRate} Hz`;
  $('#learn-file-name-input').value = l.name.replace(/\.[^.]+$/, '');
  $('#learn-file-wave')._peaks = null;
  drawLearnFile();
  showLearnVerse(learnFilePanel, $('#learn-file-name-input').value, learnFolder());
}
$('#learn-file-browse').addEventListener('click', () => $('#learn-file-input').click());
$('#learn-file-change').addEventListener('click', () => $('#learn-file-input').click());
async function loadFile(file) {
  try {
    getCtx();
    toast(`Loading ${file.name}…`, 'info', 1500);
    const dec = await decodeBlob(file);
    setLearnFile({ name: file.name, blob: file, samples: dec.samples, sampleRate: dec.sampleRate, duration: dec.duration });
  } catch (err) {
    toast(err.message || 'Could not load this file.', 'error', 5000);
  }
}
$('#learn-file-input').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  await loadFile(f);
  activateTab('learn-file');
});
$('#learn-file-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!learnFile) return;
  const name = $('#learn-file-name-input').value.trim();
  if (!name) return;
  const btn = $('#learn-file-save');
  btn.disabled = true;
  try {
    // Re-encode as mono 16-bit WAV so every sloka in the library is uniform.
    const { take, info, changed, removedStart = 0, removedEnd = 0 } = trimTake(learnFile, $('#learn-file-trim').checked);
    const blob = encodeWav(take.samples, take.sampleRate);
    const rec = await saveBaseline({ name, samples: take.samples, sampleRate: take.sampleRate, duration: take.duration, blob, source: 'file', meta: learnFileMeta.read(), edit: { trimStartSec: removedStart, trimEndSec: removedEnd } }, learnProgress);
    const link = rec.meta && rec.meta.verse;
    toast(`Saved "${rec.name}" to the library${link ? `, linked to Gītā ${link.id}: its words are the verse's` : ''}.${changed ? ` ${info}` : ''}`, 'success', changed ? 5000 : 4000);
  } catch (err) {
    toast(err.message, 'error', 6000);
  } finally {
    btn.disabled = false;
    learnProgress.hide();
  }
});

// ======================================================================
// SELF EVALUATION (element ids and identifiers still say "practice")
// ======================================================================

const basePlayer = new Player();
const heardPlayer = new Player();
let practice = {
  bases: new Map(), // id → { record, samples, sampleRate, duration, blob, features, transcript } of ticked slokas
  selection: [], // ids of the ticked slokas, in library order
  activeId: null, // the sloka being previewed, and whose report is open
  base: null, // = bases.get(activeId) once loaded
  take: null, // the attempt { samples, sampleRate, duration, blob }
  heard: null, // its features
  heardTranscripts: new Map(), // part key → the take's words there (see transcribeTakePart)
  heardJobs: new Map(), // part key → its transcription while it runs: { take, language, tier, ctrl, promise }
  options: null, // comparison options of this take, reused when a sloka is ticked later
  results: new Map(), // id → comparison result, or { error }
  pairContrast: new Map(), // "idA|idB" → how alike two slokas are (see locate.js)
  wordSims: new Map(), // id → share of that sloka's words heard (0..1), once its transcript diff was done
  phonology: new Map(), // id → comparePhonology() of the words heard against the sloka's text
  result: null, // = results.get(activeId) when it is a real result
  selected: null,
  teach: false, // Teach: one sloka at a time, Play then Listen
  session: null, // the stored record of this take (Self Evaluation / Teach), see saveSession()
  slips: new Map(), // id → what went wrong in the recitation itself this take: [{ kind, at, pada, … }] (see quizscore.js)
  progress: null, // what the history says about this take once it is saved (reports.progress): moments, bests
};
// The moments of the take just saved — a first Excellent, a new best, a streak — read from
// the whole history (every session and attempt of this learner), and the best each sloka
// had before, for "not your best today".
let progressToken = 0;
async function refreshProgress(key) {
  const token = ++progressToken;
  let list;
  try { list = await api.listAssessments(); } catch { return; }
  if (token !== progressToken || !practice.take) return;
  assessmentsCache = list;
  practice.progress = progress(list, { profileId: learnerId || null, current: key });
  renderMoments();
  refreshVerdicts();
  renderQuizScore();
}
function renderMoments() {
  const p = practice.progress;
  for (const [sel, on] of [['#score-moments', !practice.quiz], ['#quiz-moments', !!practice.quiz]]) {
    const el = $(sel);
    el.innerHTML = '';
    const ms = on && p && gradeWordsOn ? p.moments : [];
    for (const m of ms) { const li = document.createElement('li'); li.textContent = `${m.emoji} ${m.text}`; el.appendChild(li); }
    setHidden(el, !ms.length);
  }
}
const bestBeforeOf = (id) => (practice.progress && practice.progress.slokas && practice.progress.slokas[id] ? practice.progress.slokas[id].best : null);
// The slips of a sloka in this take, as far as they are sure. The ear's count is good to
// a tenth at best, so what it marks on its own is provisional: "akṣaras dropped" stands
// once the words are in and miss akṣaras too; "stuck in a pāda" stands once the sound
// comparison finds a pause the sloka does not have. Until then neither is shown or graded.
// Less than half of the sloka was recited (or none of it): not transcribed, not scored.
const partialOf = (id) => isPartial(practice.slips.get(id) || []);
function slipsOf(id) {
  const raw = practice.slips.get(id) || [];
  if (!raw.length) return raw;
  if (isPartial(raw)) return raw.filter((x) => x.kind === 'partial' || x.kind === 'skipped'); // under half recited: that is the whole story
  const res = practice.results.get(id);
  const ph = practice.phonology.get(id);
  const out = [];
  for (const slip of raw) {
    if (!slip.unsure) { out.push(slip); continue; }
    const { unsure, ...sure } = slip;
    if (slip.kind === 'dropped') { if (ph && ph.counts && ph.counts.missing >= 2) out.push({ ...sure, by: 'words' }); continue; }
    if (slip.kind === 'stall') { // a pause the sloka does not have, found by the comparison at that very moment
      const devs = res && Array.isArray(res.deviations) ? res.deviations : [];
      const near = slip.at != null && devs.some((d) => d.tHeard && (d.types || [d.type]).includes('timing') && slip.at >= d.tHeard[0] - 0.75 && slip.at <= d.tHeard[1] + 0.75);
      if (near) out.push({ ...sure, by: 'sound' });
      continue;
    }
    out.push(slip);
  }
  return out;
}
function addSlip(id, slip) {
  if (!id || !slip) return;
  const list = practice.slips.get(id) || [];
  list.push(slip);
  practice.slips.set(id, list);
}
// The learner's pace, as far as it is known: the ratio of their tempo to the reference's
// and their usual pauses (a profile may carry them; see js/meta.js), else sensible defaults.
function learnerPace() {
  const p = profileById(learnerId);
  const pace = p && p.pace && typeof p.pace === 'object' ? p.pace : {};
  return {
    tempoRatio: Number(pace.tempoRatio) > 0 ? Number(pace.tempoRatio) : 1,
    padaPauseMs: Number(pace.padaPauseMs) > 0 ? Number(pace.padaPauseMs) : 600,
    slokaPauseMs: Number(pace.slokaPauseMs) > 0 ? Number(pace.slokaPauseMs) : 1000,
    aksPerSec: Number(pace.aksPerSec) > 0 ? Number(pace.aksPerSec) : null, // akṣaras per second of their singing, once measured
    countRatio: Number(pace.countRatio) > 0 ? Number(pace.countRatio) : 1, // syllable nuclei the counter hears per akṣara of their voice
  };
}
// Where the learner is in the sloka, in akṣaras: the syllable count calibrated to their
// voice, and — once their speed is known (this take's earlier slokas, or their profile) —
// blended half and half with the time they have been singing at that speed, which rides
// over the counter's slips. The learner's speed, never the teacher's.
function earPosition(ear, st) {
  const byCount = st.count / (ear.countRatio || 1);
  if (!ear.aksPerSec || !ear.expected) return byCount;
  const byTime = Math.min(ear.expected + 2, (ear.activeMs / 1000) * ear.aksPerSec);
  return 0.5 * byCount + 0.5 * byTime;
}
// How many slokas one take may hold (Self Evaluation, a quiz): a chapter's worth. The take
// stays in memory whole, and every sloka's stretch is transcribed from it, so the number is
// a matter of the machine's memory and patience; a heuristic from navigator.deviceMemory /
// hardwareConcurrency may replace the constant.
const MAX_SLOKAS_PER_TAKE = 22;
let practiceRecorder = null;
function getPracticeRecorder() {
  if (!practiceRecorder) {
    practiceRecorder = new Recorder(getCtx());
    practiceRecorder.addEventListener('level', (e) => practiceUI.onLevel(e.detail));
  }
  return practiceRecorder;
}
const practiceUI = bindRecorderUI({
  button: $('#practice-rec'), label: $('#practice-rec-label'), timer: $('#practice-timer'), meter: $('#practice-meter'), clip: $('#practice-clip'), live: $('#practice-live'),
  idleText: 'Tap to start recording', recordingText: 'Recording… tap to stop',
});
practiceUI.elapsed = () => (practiceRecorder ? practiceRecorder.elapsed : 0);
// ---------- Evaluating…: the results from the moment a recording stops until the open report is ready ----------
// Shown in place of the report body (and of the quiz block) from the stop of a recording
// until the open sloka's results are in: its comparison, its words when they are expected
// (automatic transcription, a quiz, or words already heard for this take) and, in a quiz,
// the score. A report opened with Previous / Next whose words are still on their way shows
// it again until they come. The block mirrors whichever progress is running — the
// comparison's (step 2's bar, folded away by then) or the speech worker's (in the Transcript
// block, under the folded Analysis) — so the Stop of a quiz's listening is at hand there too.
let evaluating = false;
const evalProgress = progressUI('evaluating-progress');
const evalSources = { compare: null, words: null };
let evalShown = null;
function renderEvalProgress() {
  const src = evalSources.compare || evalSources.words;
  if (!src) { evalProgress.hide(); evalShown = null; $('#evaluating-sub').textContent = 'the results of this sloka are on their way'; return; }
  if (evalShown !== src) { evalProgress.show(src.text || ' ', src.stop); evalShown = src; }
  evalProgress.set(src.p, src.text);
  $('#evaluating-sub').textContent = '';
}
// a progress bar whose state the Evaluating block mirrors
function mirrored(ui, key) {
  return {
    show(text, stopFn) { ui.show(text, stopFn); evalSources[key] = { p: 0, text: text || '', stop: stopFn || null }; renderEvalProgress(); },
    set(p, text) { ui.set(p, text); const src = evalSources[key]; if (src) { src.p = p; if (text) src.text = text; renderEvalProgress(); } },
    hide() { ui.hide(); evalSources[key] = null; renderEvalProgress(); },
  };
}
const practiceProgress = mirrored(progressUI('practice-progress'), 'compare');
function setEvaluating(on) {
  evaluating = !!on;
  setHidden($('#evaluating'), !evaluating);
  if (evaluating) renderEvalProgress();
  const r = practice.results.get(practice.activeId);
  setHidden($('#report-body'), evaluating || !practice.result || !isReport(r));
  setHidden($('#quiz-score'), evaluating || !(practice.quiz && practice.quizAttempt));
}
// the open report's words are in the take's cache: on screen in a moment
const wordsCached = (r) => practice.heardTranscripts.has(partKey(heardPartOf(r)));
// Whether more is on its way for the open report: a quiz's score, or its words, expected
// and not on screen yet.
function moreComing(r) {
  if (!isReport(r)) return false;
  if (practice.quiz && (quizScoring || !practice.quizAttempt)) return true;
  if (sttPractice.heard || !(sttSettings.auto || practice.heardTranscripts.size)) return false;
  return !!sttBothInflight || wordsCached(r);
}
// Evaluating… ends when nothing more is on its way for the open report; a report whose
// words are cached but not on screen gets them first.
function settleEvaluating() {
  if (!evaluating) return;
  const r = practice.results.get(practice.activeId);
  if (!practice.result || !isReport(r)) { setEvaluating(false); return; }
  if (practice.quiz && (quizScoring || !practice.quizAttempt)) return; // the score is coming
  if (sttPractice.heard || !(sttSettings.auto || practice.heardTranscripts.size)) { setEvaluating(false); return; } // on screen, or no words wanted
  if (sttBothInflight) return; // the words are coming
  if (wordsCached(r)) { transcribeBoth(false); return; }
  setEvaluating(false); // nothing more is coming: the report shows without its words
}
const drawBaseWave = bindWave($('#practice-base-wave'), basePlayer, () => practice.base && practice.base.samples, $('#practice-base-cur'), $('#practice-base-dur'));
bindPlayButton($('#practice-base-play'), basePlayer);
bindPlayButton($('#res-play-base'), basePlayer);
bindPlayButton($('#res-play-heard'), heardPlayer);
const practicePanel = createTranscriptPanel($('#practice-transcript'), {
  title: 'Sloka text',
  emptyText: NO_WORDS_NOTE,
  editable: false, // the words are corrected in the Library alone
  play: (s, e) => { heardPlayer.pause(); basePlayer.playRange(s, e); },
  // a transcription that finished after another sloka was opened still belongs to its own sloka
  onStale: async (t, id) => {
    if (!id || !t) return;
    const store = await api.putTranscript(id, t).catch(() => null);
    const b = practice.bases.get(id);
    if (b) { if (store) b.transcripts = store; if (t.language === sttSettings.language) b.transcript = t; }
    if (store) notifyTranscripts(id, store);
  },
  onChange: async (t) => {
    if (!practice.base) return;
    const base = practice.base;
    base.transcript = t;
    try {
      base.transcripts = await api.putTranscript(base.record.id, t);
      notifyTranscripts(base.record.id, base.transcripts);
      practicePanel.setOthers(base.transcripts);
      if (t.edited) toast('Corrected text saved with the sloka.', 'success');
    } catch (err) {
      toast(`The text could not be saved: ${err.message}`, 'error', 6000);
    }
    // keep the mismatch highlights in step with the corrected sloka text
    if (sttPractice.heard) { sttPractice.base = t; renderTranscriptDiff(); }
  },
});

const applyPracticeSpeed = bindSpeed({ slider: $('#practice-speed'), valueEl: $('#practice-speed-val'), chips: $('#practice-speed-chips'), onChange: (r) => setPracticeSpeed(r) });
const applyResSpeed = bindSpeed({ slider: $('#res-speed'), valueEl: $('#res-speed-val'), onChange: (r) => setPracticeSpeed(r) });
const applyTextsSpeed = bindSpeed({ chips: $('#practice-texts-speed'), onChange: (r) => setPracticeSpeed(r) });
function setPracticeSpeed(r) {
  basePlayer.rate = r;
  heardPlayer.rate = r;
  applyPracticeSpeed(r, true);
  applyResSpeed(r, true);
  applyTextsSpeed(r, true);
}

$('#practice-headphones').addEventListener('change', (e) => {
  const cb = $('#practice-playalong');
  cb.disabled = !e.target.checked || !!practice.quiz; // no playing along in a quiz: it is from memory
  if (cb.disabled) cb.checked = false;
});

const chart = new ComparisonChart($('#compare-chart'), { onSelect: (id) => selectDeviation(id, true) });
basePlayer.addEventListener('tick', () => { if (practice.result) chart.setPlayhead('base', basePlayer.playing ? basePlayer.currentTime : null); });
heardPlayer.addEventListener('tick', () => { if (practice.result) chart.setPlayhead('heard', heardPlayer.playing ? heardPlayer.currentTime : null); });
// One at a time, except when both are meant to play together (below).
basePlayer.addEventListener('play', () => { if (!duet) heardPlayer.pause(); });
heardPlayer.addEventListener('play', () => { if (!duet) basePlayer.pause(); });
for (const p of [basePlayer, heardPlayer]) {
  for (const ev of ['pause', 'ended', 'rangeend']) p.addEventListener(ev, () => { $$('.dev-actions .btn.playing').forEach((b) => b.classList.remove('playing')); syncDuet(); });
}

// ---------- both together: the sloka in the left ear, the take in the right ----------
// Each player's audio is routed through a stereo panner once, lazily (a media element can be
// attached to the audio graph only once, and from then on plays only through it). Outside a
// duet the panners sit in the middle, so ordinary playback is unchanged. Both start at the
// beginning of the part that was compared, at the same speed, so the ear can follow them.
let duet = false;
const DUET_PAN = 0.85;
const panners = new Map(); // player → StereoPannerNode
function pannerOf(player) {
  let node = panners.get(player);
  if (node) return node;
  const ctx = getCtx();
  const src = ctx.createMediaElementSource(player.el);
  node = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (node) { src.connect(node); node.connect(ctx.destination); } else { src.connect(ctx.destination); }
  panners.set(player, node || { pan: { value: 0 } });
  return panners.get(player);
}
function setPans(base, heard) {
  pannerOf(basePlayer).pan.value = base;
  pannerOf(heardPlayer).pan.value = heard;
}
async function playBoth() {
  const res = practice.result;
  if (duet) { stopDuet(); return; }
  if (!res || !practice.base || !heardPlayer.loaded) return;
  try { setPans(-DUET_PAN, DUET_PAN); } catch (err) { toast(`Playing both together is not possible here: ${err.message}`, 'error'); return; }
  duet = true;
  $('#res-play-both').classList.add('playing');
  const [b0, b1] = res.matched ? res.matched.base : [0, basePlayer.duration];
  const [h0, h1] = res.matched ? res.matched.heard : [0, heardPlayer.duration];
  await Promise.all([basePlayer.playRange(b0, b1), heardPlayer.playRange(h0, h1)]);
}
function stopDuet() {
  if (!duet) return;
  duet = false;
  basePlayer.pause();
  heardPlayer.pause();
  try { setPans(0, 0); } catch { /* never routed */ }
  $('#res-play-both').classList.remove('playing');
}
// A duet is over when neither side plays any more.
function syncDuet() {
  if (duet && !basePlayer.playing && !heardPlayer.playing) stopDuet();
}
$('#res-play-both').addEventListener('click', () => { getCtx(); playBoth(); });
// the Analysis fold: the chart draws itself when it becomes visible, the rest follows
$('#analysis').addEventListener('toggle', () => { if ($('#analysis').open) redrawAll(); });
// How to read the two transcripts: an overlay off the small "i" by "Yours", closed by a
// click elsewhere or Escape.
{
  const btn = $('#stt-legend-btn');
  const pop = $('#stt-legend');
  const open = (on) => { setHidden(pop, !on); btn.setAttribute('aria-expanded', on ? 'true' : 'false'); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); open(pop.hidden); });
  document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target)) open(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { open(false); btn.focus(); } });
}

// ---------- tolerance: how much variation is acceptable per category ----------

const TOL_KEY = 'tutor-tolerance';
// The user's own tolerance, or null for the defaults (which follow the learner: speech
// recognition is 2–5× less accurate on children, so their pronunciation tolerance is wider).
let tolerance = (() => { try { const v = JSON.parse(localStorage.getItem(TOL_KEY) || 'null'); return v ? normalizeTolerance(v) : null; } catch { return null; } })();
// Tolerances switched off altogether: scores and grades only, no within/outside verdicts,
// no quiz correctness. Attempts and sessions made meanwhile record `noTolerance`.
const TOL_OFF_KEY = 'tutor-tolerance-off';
let tolOff = (() => { try { return localStorage.getItem(TOL_OFF_KEY) === '1'; } catch { return false; } })();
// The learner's allowance on the words (speech recognition is 2–5× less accurate on a child)
// widens the three word-level tolerances by the same amount.
const learnerTolerance = (learner = learnerSpeaker()) => {
  const extra = presetsFor(learner, null).pronunciationTolerance - ADULT_PRESET.pronunciationTolerance;
  return { ...DEFAULT_TOLERANCE, phoneme: DEFAULT_TOLERANCE.phoneme + extra, vowel: DEFAULT_TOLERANCE.vowel + extra, syllable: DEFAULT_TOLERANCE.syllable + extra, pronunciation: DEFAULT_TOLERANCE.pronunciation + extra };
};
// A quiz always judges on the defaults for the learner (fixed for the attempt once scored).
// null everywhere when tolerances are off (or the open attempt was made with them off).
const activeTolerance = () => {
  if (practice.quiz && practice.quizAttempt) return attemptTolerance(practice.quizAttempt);
  if (tolOff) return null;
  return practice.quiz ? learnerTolerance() : tolerance || learnerTolerance();
};
const attemptTolerance = (a) => recordTolerance(a);
function renderToleranceFields() {
  const host = $('#tol-fields');
  host.innerHTML = '';
  const cur = tolerance || learnerTolerance();
  for (const c of QUIZ_CATEGORIES) {
    const label = document.createElement('label');
    label.className = 'tol-field';
    label.innerHTML = '<span></span><input type="number" min="0" max="100" step="1" /><span>%</span>';
    label.firstChild.textContent = c.label;
    const inp = $('input', label);
    inp.value = String(cur[c.id]);
    inp.disabled = tolOff;
    inp.setAttribute('aria-label', `${c.label} tolerance in percent`);
    inp.addEventListener('change', () => {
      tolerance = normalizeTolerance({ ...(tolerance || learnerTolerance()), [c.id]: inp.value });
      inp.value = String(tolerance[c.id]);
      try { localStorage.setItem(TOL_KEY, JSON.stringify(tolerance)); } catch { /* ignore */ }
      refreshVerdicts();
    });
    host.appendChild(label);
  }
  $('#tol-reset').disabled = tolOff;
  $('#tol-row').classList.toggle('off', tolOff);
  $('#tol-ignore').checked = tolOff;
  renderToleranceRow();
}
renderToleranceFields();
$('#tol-reset').addEventListener('click', () => {
  tolerance = null;
  try { localStorage.removeItem(TOL_KEY); } catch { /* ignore */ }
  renderToleranceFields();
  refreshVerdicts();
});
$('#tol-ignore').addEventListener('change', (e) => {
  tolOff = e.target.checked;
  try { if (tolOff) localStorage.setItem(TOL_OFF_KEY, '1'); else localStorage.removeItem(TOL_OFF_KEY); } catch { /* ignore */ }
  renderToleranceFields();
  refreshVerdicts();
  syncSession();
});
// The explanatory lines of the Tolerance settings (the fields live on the Settings page).
function renderToleranceRow() {
  const d = learnerTolerance();
  const who = learnerSpeaker();
  const words = `phonemes ${d.phoneme} %, vowel length ${d.vowel} %, syllables ${d.syllable} %${d.phoneme !== DEFAULT_TOLERANCE.phoneme ? ` (widened for ${learnerName()}, aged ${ageGroupLabel(who.ageGroup).toLowerCase()})` : ''}`;
  $('#tol-hint').textContent = `A category is within tolerance when its score is at least 100 % minus the tolerance. Defaults: ${words}; emphasis, pitch contour and timing ${d.timing} %, phrasing ${d.phrasing} %.`;
  $('#tol-quiz-note').textContent = tolOff
    ? 'Tolerances are off: Self Evaluation, Teach and quizzes show scores and grades only until you switch them back on.'
    : `These tolerances apply to Self Evaluation and Teach. A quiz always judges on the defaults for the chosen learner (${words}; emphasis, pitch contour and timing ${d.timing} %, phrasing ${d.phrasing} %), and every attempt records the tolerance it was judged with.`;
}
// What the chosen learner means for the evaluation, under the options.
function renderLearnerNote() {
  const who = learnerSpeaker();
  const el = $('#practice-learner-note');
  if (!who) { el.textContent = 'No one is chosen as the learner (sidebar): adult allowances. For a child, add them under People so pitch, pace and pronunciation are judged with a child\'s allowances.'; return; }
  const p = presetsFor(who, null);
  const st = p.pitchTolSt === 1 ? 'a semitone' : p.pitchTolSt === 0.75 ? '¾ semitone' : `${p.pitchTolSt} semitones`;
  const desc = speakerLabel(who);
  el.textContent = `Judging ${learnerName()}${desc ? ` (${desc})` : ''}: pitch within ${st}, pace ${p.speedBand[0]}–${p.speedBand[1]}× when speed is judged, pronunciation tolerance ${p.pronunciationTolerance} %.${who.ageGroup === '12to15' ? ' A voice changes fast at this age: re-record your own baselines every few months.' : ''}`;
}
learnerListeners.add(() => { renderToleranceFields(); renderLearnerNote(); refreshVerdicts(); renderHomeBadges(); });
// Scores of one report in the seven categories (null where not judgeable), for verdicts.
function reportScores(id) {
  const r = practice.results.get(id);
  if (!isReport(r)) return null;
  const ph = practice.phonology.get(id) || null;
  return itemScores(r, { phonology: ph, sttAvailable: practice.wordSims.has(id), partial: partialOf(id) });
}

// ---------- weights: what the overall score is made of ----------
const WEIGHTS_KEY = 'tutor-weights';
let weights = (() => { try { const v = JSON.parse(localStorage.getItem(WEIGHTS_KEY) || 'null'); return v ? normalizeWeights(v) : null; } catch { return null; } })();
const activeWeights = () => (practice.quiz && practice.quizAttempt && practice.quizAttempt.weights) || weights || CATEGORY_WEIGHTS;
function renderWeightFields() {
  const host = $('#weight-fields');
  host.innerHTML = '';
  const cur = weights || CATEGORY_WEIGHTS;
  for (const c of QUIZ_CATEGORIES) {
    const label = document.createElement('label');
    label.className = 'tol-field';
    label.innerHTML = '<span></span><input type="number" min="0" max="100" step="1" />';
    label.firstChild.textContent = c.label;
    label.title = c.hint;
    const inp = $('input', label);
    inp.value = String(cur[c.id]);
    inp.setAttribute('aria-label', `${c.label} weight`);
    inp.addEventListener('change', () => {
      weights = normalizeWeights({ ...(weights || CATEGORY_WEIGHTS), [c.id]: inp.value });
      inp.value = String(weights[c.id]);
      try { localStorage.setItem(WEIGHTS_KEY, JSON.stringify(weights)); } catch { /* ignore */ }
      refreshVerdicts();
      syncSession();
    });
    host.appendChild(label);
  }
}
renderWeightFields();
$('#weights-reset').addEventListener('click', () => {
  weights = null;
  try { localStorage.removeItem(WEIGHTS_KEY); } catch { /* ignore */ }
  renderWeightFields();
  refreshVerdicts();
  syncSession();
});
const verdictCategories = () => (practice.quiz ? practice.quiz.categories : QUIZ_CATEGORIES.map((c) => c.id));
function reportVerdict(id) {
  const sc = reportScores(id);
  return sc ? itemVerdict(sc, verdictCategories(), activeTolerance()) : { ok: null, failed: [], judged: [] };
}
const catLabel = categoryLabel;
function verdictText(v) {
  if (v.ok === null) return '';
  return v.ok ? 'Within tolerance' : `Outside tolerance: ${v.failed.map((c) => catLabel(c).toLowerCase()).join(', ')}`;
}
// Tolerance changed, or a transcript diff arrived: redo every verdict on screen.
function refreshVerdicts() {
  if (practice.result && practice.activeId) renderTiles(practice.result, practice.activeId);
  if (!$('#practice-results').hidden) renderReportBrowser();
}

// ---------- choosing slokas (one or many) ----------

const SELECTION_KEY = 'tutor-eval-selection';
function savedSelection() {
  try { const v = JSON.parse(localStorage.getItem(SELECTION_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
// ---------- the sloka picker: folders that open, a search box, the ticked slokas as chips ----------
// One component for Self Evaluation, Teach and the Quiz: a library of many folders with
// dozens of slokas each stays compact (folders are closed until opened), and what is ticked
// is always in view above the folders, as chips with a count.
//   mode     'multi' (checkboxes, a folder-level "all") or 'single' (one at a time)
//   max      multi: no more than this many (further boxes lock)
//   onChange(ids, activated)  the selection changed; `activated` is the sloka to preview
//   onActivate(id)            a ticked sloka's chip or name was clicked: preview it
//   openKey  localStorage key remembering which folders are open
function createSlokaPicker(host, { mode = 'multi', max = null, onChange, onActivate = null, openKey = null, pickLabel = 'Tick', activeId = () => null } = {}) {
  host.innerHTML = `
    <div class="picker-toolbar">
      <input type="search" class="picker-search" data-role="search" placeholder="Find a sloka…" aria-label="Find a sloka" />
      <button class="btn btn-ghost btn-sm" type="button" data-act="all" title="Tick every sloka in the library">Tick all</button>
      <button class="btn btn-ghost btn-sm" type="button" data-act="clear">Clear</button>
    </div>
    <div class="picker-summary" data-role="summary"></div>
    <div class="picker-folders" data-role="folders"></div>`;
  const search = $('[data-role="search"]', host);
  const summary = $('[data-role="summary"]', host);
  const foldersEl = $('[data-role="folders"]', host);
  const allBtn = $('[data-act="all"]', host);
  const clearBtn = $('[data-act="clear"]', host);
  let records = [];
  let selected = [];
  let open = new Set();
  try { open = new Set(JSON.parse(localStorage.getItem(openKey || '') || '[]')); } catch { open = new Set(); }
  const saveOpen = () => { if (openKey) { try { localStorage.setItem(openKey, JSON.stringify([...open])); } catch { /* ignore */ } } };
  const byId = () => new Map(records.map((r) => [r.id, r]));
  const folderOfRec = (r) => r.folder || '';
  const change = (ids, activated) => { selected = ids; onChange(ids, activated); };

  const toggle = (id) => {
    if (mode === 'single') { change([id], id); return; }
    if (selected.includes(id)) { change(selected.filter((x) => x !== id), undefined); return; }
    if (max && selected.length >= max) { toast(`At most ${max} slokas. Untick one to swap, or raise the maximum.`, 'info'); return; }
    change([...selected, id], id);
  };
  const renderSummary = () => {
    summary.innerHTML = '';
    const count = document.createElement('span');
    count.className = 'count';
    const n = selected.length;
    count.textContent = mode === 'single' ? (n ? '1 chosen' : 'None chosen') : max ? `${n} of ${max} ticked` : `${n} ticked`;
    summary.appendChild(count);
    if (!n) { const s = document.createElement('span'); s.className = 'none'; s.textContent = mode === 'single' ? 'Open a folder below and choose a sloka.' : 'Open a folder below and tick slokas; they appear here.'; summary.appendChild(s); return; }
    const map = byId();
    const act = activeId();
    const shown = selected.slice(0, 40);
    for (const id of shown) {
      const r = map.get(id);
      const chip = document.createElement('span');
      chip.className = `picker-chip${id === act ? ' active' : ''}`;
      chip.innerHTML = '<button class="name" type="button"></button><button class="x" type="button" aria-label="Untick">×</button>';
      $('.name', chip).textContent = r ? r.name : 'gone';
      $('.name', chip).title = r ? `${r.folder ? r.folder + ' · ' : ''}click to preview` : '';
      $('.name', chip).addEventListener('click', () => { if (onActivate) onActivate(id); });
      $('.x', chip).addEventListener('click', () => change(selected.filter((x) => x !== id), undefined));
      summary.appendChild(chip);
    }
    if (selected.length > shown.length) { const m = document.createElement('span'); m.className = 'picker-chip'; m.innerHTML = '<span class="more"></span>'; m.firstChild.textContent = `+${selected.length - shown.length} more`; summary.appendChild(m); }
  };
  const renderFolders = () => {
    foldersEl.innerHTML = '';
    const q = search.value.trim().toLowerCase();
    const groups = new Map();
    for (const r of records.slice().sort((x, y) => folderOfRec(x).localeCompare(folderOfRec(y)) || x.name.localeCompare(y.name))) {
      const f = folderOfRec(r);
      if (!groups.has(f)) groups.set(f, []);
      groups.get(f).push(r);
    }
    if (!groups.size) { const e = document.createElement('div'); e.className = 'picker-empty'; e.textContent = 'No slokas.'; foldersEl.appendChild(e); return; }
    const act = activeId();
    const full = mode === 'multi' && max && selected.length >= max;
    let anyShown = false;
    for (const [f, items] of groups) {
      const matching = q ? items.filter((r) => r.name.toLowerCase().includes(q)) : items;
      if (q && !matching.length) continue;
      anyShown = true;
      const nSel = items.filter((r) => selected.includes(r.id)).length;
      const box = document.createElement('div');
      const isOpen = q ? true : open.has(f) || (groups.size === 1);
      box.className = `picker-folder${isOpen ? ' open' : ''}`;
      box.innerHTML = `
        <div class="picker-folder-head" role="button" tabindex="0">
          <svg class="caret" viewBox="0 0 24 24"><path fill="currentColor" d="M9 6l6 6-6 6z"/></svg>
          <span class="fname"></span>
          <span class="fsel"></span>
          <span class="fcount"></span>
          ${mode === 'multi' ? '<input type="checkbox" title="Tick or untick every sloka in this folder" aria-label="All of this folder" />' : ''}
        </div>
        <div class="picker-items"></div>`;
      const head = $('.picker-folder-head', box);
      $('.fname', head).textContent = folderLabel(f);
      $('.fcount', head).textContent = `${items.length} sloka${items.length === 1 ? '' : 's'}`;
      $('.fsel', head).textContent = nSel ? `${nSel} ${mode === 'single' ? 'chosen' : 'ticked'}` : '';
      const fcb = $('input', head);
      if (fcb) {
        fcb.checked = nSel === items.length && items.length > 0;
        fcb.indeterminate = nSel > 0 && nSel < items.length;
        fcb.addEventListener('click', (e) => {
          e.stopPropagation();
          const ids = items.map((r) => r.id);
          if (fcb.checked) {
            let next = [...selected, ...ids.filter((id) => !selected.includes(id))];
            if (max && next.length > max) { next = next.slice(0, max); toast(`At most ${max} slokas: the first ${max} were ticked.`, 'info'); }
            change(next, ids.find((id) => next.includes(id)));
          } else change(selected.filter((id) => !ids.includes(id)), undefined);
        });
      }
      const flip = () => { if (open.has(f)) open.delete(f); else open.add(f); saveOpen(); renderFolders(); };
      head.addEventListener('click', (e) => { if (e.target !== fcb) flip(); });
      head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
      const list = $('.picker-items', box);
      for (const r of matching) {
        const on = selected.includes(r.id);
        const row = document.createElement('div');
        row.className = `picker-item${on ? ' checked' : ''}${r.id === act ? ' active' : ''}${full && !on ? ' disabled' : ''}`;
        row.innerHTML = `<input type="${mode === 'single' ? 'radio' : 'checkbox'}" /><button class="iname" type="button"></button><span class="idur mono"></span>`;
        const inp = $('input', row);
        inp.checked = on;
        inp.disabled = full && !on;
        inp.setAttribute('aria-label', `${pickLabel} ${r.name}`);
        inp.addEventListener('click', (e) => { e.preventDefault(); toggle(r.id); });
        const nm = $('.iname', row);
        nm.textContent = r.name;
        nm.title = on ? 'Preview this sloka' : `${pickLabel} this sloka`;
        nm.addEventListener('click', () => { if (on) { if (onActivate) onActivate(r.id); } else toggle(r.id); });
        $('.idur', row).textContent = fmtTime(r.duration);
        list.appendChild(row);
      }
      foldersEl.appendChild(box);
    }
    if (!anyShown) { const e = document.createElement('div'); e.className = 'picker-empty'; e.textContent = `No sloka matches “${search.value.trim()}”.`; foldersEl.appendChild(e); }
  };
  const render = () => { renderSummary(); renderFolders(); setHidden(allBtn, mode !== 'multi' || !!max); };
  search.addEventListener('input', renderFolders);
  allBtn.addEventListener('click', () => change(records.map((r) => r.id), undefined));
  clearBtn.addEventListener('click', () => change([], undefined));
  return {
    setRecords(list) { records = list.slice(); render(); },
    setSelection(ids) { selected = ids.slice(); render(); },
    setMode(m, mx = null) { mode = m; max = mx; render(); },
    setBusy(b) { host.classList.toggle('busy', b); search.disabled = b; allBtn.disabled = b; clearBtn.disabled = b; },
    refresh: render,
    get openFolders() { return [...open]; },
    get selection() { return selected.slice(); },
  };
}

const practicePicker = createSlokaPicker($('#practice-picker'), {
  mode: 'multi',
  max: MAX_SLOKAS_PER_TAKE,
  openKey: 'tutor-picker-open',
  onChange: (ids, activated) => setSelection(ids, activated),
  onActivate: (id) => setSelection(practice.selection.includes(id) ? practice.selection : [...practice.selection, id], id),
  activeId: () => practice.activeId,
});

function setListBusy(busy) {
  practicePicker.setBusy(busy);
}
const nameOf = (id) => { const r = (libraryCache || []).find((x) => x.id === id); return r ? r.name : 'this sloka'; };

// Called whenever the view opens. `selectIds` (from the Library) replaces the ticked slokas.
async function refreshPracticeSelect(selectIds) {
  const list = await getLibrary();
  const picked = selectIds ? [].concat(selectIds) : null;
  if (picked && practice.quiz) leaveQuiz(false); // the Library sent a plain selection
  let want;
  if (practice.quiz) want = practice.quiz.items.map((it) => it.id);
  else if (picked) want = practice.teach ? picked.slice(0, 1) : picked;
  else if (practice.teach) want = practice.selection.includes(practice.activeId) ? [practice.activeId] : practice.selection.slice(0, 1);
  else want = practice.selection.length ? practice.selection : savedSelection();
  practicePicker.setMode(practice.teach ? 'single' : 'multi');
  practicePicker.setRecords(list);
  setHidden($('#practice-base-empty'), list.length > 0);
  renderQuizBox();
  await setSelection(want, picked ? picked[0] : undefined);
}

// Teach shows the same list, one sloka at a time, with Play and Listen under the preview.
function setTeachMode(on) {
  if (practice.teach === on) return;
  if (on && practice.quiz) leaveQuiz(false);
  practice.teach = on;
  if (on) practice.selectionBeforeTeach = practice.selection.slice();
  else practice.selection = (practice.selectionBeforeTeach && practice.selectionBeforeTeach.length) ? practice.selectionBeforeTeach : savedSelection();
  hideResults();
  practiceUI.reset();
  renderModeChrome();
}
function renderModeChrome() {
  const teach = practice.teach;
  const quiz = practice.quiz;
  $('#practice-title').textContent = teach ? 'Teach' : quiz ? 'Quiz' : 'Self Evaluation';
  $('.subtitle', $('#view-evaluate')).textContent = teach
    ? 'Learn one sloka at a time: play it at any speed, then let SlokAbhyasa listen to you and show exactly where you drifted.'
    : quiz ? `${quiz.name}: recite its slokas in one recording, in any order. Every attempt is saved and scored; "Leave quiz" returns to the list of quizzes.`
      : 'Pick one or more slokas, perform once, and browse a report for each: exactly where you drifted, and where recordings conflict.';
  $('#practice-step1-title').textContent = teach ? 'Choose a sloka' : quiz ? 'This quiz' : 'Choose one or more slokas';
  setHidden($('#practice-base'), !previewShown());
  $('#practice-base-role').textContent = teach ? 'Learning' : practice.quiz ? 'Quiz' : 'Previewing';
  setHidden($('#teach-hint'), !teach || !(libraryCache || []).length);
  setHidden($('#practice-list-hint'), teach || !!practice.quiz || !(libraryCache || []).length);
  $('#practice-step2-title').textContent = teach ? 'Play it, then recite it back' : practice.quiz ? (quizTextOn ? 'Recite with the text shown' : 'Recite from memory') : 'Perform it';
}

// The picker shows the same selection the app holds: ticks, chips, the previewed sloka.
function syncBaseList() {
  practicePicker.setSelection(practice.selection);
  renderSlokaTexts();
  const n = practice.selection.length;
  $('#practice-pick-count').textContent = practice.quiz ? `${practice.quiz.name} · ${n} sloka${n === 1 ? '' : 's'}` : practice.teach ? (n ? nameOf(practice.selection[0]) : '') : n ? `${n} sloka${n === 1 ? '' : 's'} ticked` : '';
}

function updateRecLabel() {
  if (practiceRecorder && practiceRecorder.active) return;
  const n = practice.selection.length;
  $('#practice-rec').disabled = !practice.base || quizScoring;
  $('#practice-rec-label').textContent = !n ? (practice.quiz ? 'None of this quiz\'s slokas is in the library any more' : 'Choose a sloka first')
    : !practice.base ? 'Loading sloka…'
      : quizScoring ? 'Scoring the quiz…'
        : practice.quiz ? `Tap to start the quiz recording · ${n} sloka${n === 1 ? '' : 's'}`
          : practice.teach ? 'Tap to listen: recite the sloka, then tap again to stop'
            : n > 1 ? `Tap to start recording · compared with ${n} slokas` : 'Tap to start recording';
}

// The ticked slokas changed. Audio and finished reports of slokas that stay ticked are
// kept, and a take that is already there is compared with any sloka that was added.
async function setSelection(ids, activate) {
  if (Array.isArray(ids) && ids.length) warmStt(); // the speech model loads now, idle until the first sloka ends
  if (!practice.quiz && !practice.teach && ids.length > MAX_SLOKAS_PER_TAKE) {
    toast(`One take holds ${MAX_SLOKAS_PER_TAKE} slokas at most; the first ${MAX_SLOKAS_PER_TAKE} are kept.`, 'info', 6000);
    ids = ids.slice(0, MAX_SLOKAS_PER_TAKE);
  }
  const order = (await getLibrary()).map((r) => r.id);
  practice.selection = order.filter((id) => ids.includes(id));
  if (!practice.quiz && !practice.teach) { try { localStorage.setItem(SELECTION_KEY, JSON.stringify(practice.selection)); } catch { /* ignore */ } }
  for (const id of [...practice.bases.keys()]) if (!practice.selection.includes(id)) practice.bases.delete(id);
  for (const id of [...practice.results.keys()]) if (!practice.selection.includes(id)) practice.results.delete(id);
  const next = activate && practice.selection.includes(activate) ? activate
    : practice.selection.includes(practice.activeId) ? practice.activeId
      : practice.selection[0] || null;
  syncBaseList();
  if (next !== practice.activeId || !next || !practice.base) await setActiveBase(next);
  else updateRecLabel();
  if (practice.heard && practice.selection.length && !$('#practice-results').hidden) {
    await runComparisons();
    showActiveReport();
  }
}

const baseLoads = new Map(); // id → promise, so a sloka is never loaded twice at once
function ensureBase(id) {
  if (practice.bases.has(id)) return Promise.resolve(practice.bases.get(id));
  if (baseLoads.has(id)) return baseLoads.get(id);
  const load = (async () => {
    const record = (await getLibrary()).find((r) => r.id === id);
    if (!record) throw new Error('This sloka is no longer in the library.');
    getCtx();
    const blob = await api.fetchAudioBlob(id);
    const dec = await decodeBlob(blob);
    let features = null;
    const cached = await api.getFeatures(id).catch(() => null);
    if (cached) { try { features = deserializeFeatures(cached); } catch { features = null; } }
    if (!isValidFeatures(features)) {
      practiceProgress.show(`Listening to “${record.name}”…`);
      features = await analyzer.features(dec.samples, dec.sampleRate, (v) => practiceProgress.set(v));
      practiceProgress.hide();
      api.putFeatures(id, serializeFeatures(features)).catch(() => {});
    }
    const transcripts = await api.getTranscript(id).catch(() => null);
    // `transcript` is the one in the language chosen for speech to text, if it exists
    const base = { record, ...dec, blob, features, transcripts, transcript: transcriptIn(transcripts) };
    if (practice.selection.includes(id)) practice.bases.set(id, base);
    // a sloka from before metadata existed gets its voice measured now that it is loaded
    if (record.meta && !record.meta.voice) {
      try {
        const stats = voiceStats(features, dec.samples, { aksharaCount: record.meta.text ? record.meta.text.aksharaCount : null });
        api.patchMeta(id, { voice: stats.voice, measured: stats.measured }).then((m) => { record.meta = m; }).catch(() => {});
      } catch { /* optional */ }
    }
    return base;
  })();
  baseLoads.set(id, load);
  load.then(() => baseLoads.delete(id), () => baseLoads.delete(id));
  return load;
}

// Makes one ticked sloka the one that is previewed, played and, after a take, reported on.
let activeToken = 0;
async function setActiveBase(id) {
  const token = ++activeToken;
  basePlayer.pause();
  heardPlayer.pause();
  practice.activeId = id || null;
  syncBaseList();
  if (!id) {
    practice.base = null;
    basePlayer.unload();
    practicePanel.reset();
    setHidden($('#practice-base'), true);
    hideResults();
    updateRecLabel();
    return;
  }
  practice.base = null;
  updateRecLabel();
  try {
    const base = await ensureBase(id);
    if (token !== activeToken) return; // another one was picked meanwhile
    $('#practice-base-name').textContent = base.record.name;
    $('#practice-base-wave')._peaks = null;
    await basePlayer.load(base.blob);
    if (token !== activeToken) return;
    practice.base = base;
    warmStt(); // the model, ready before the recording rather than during it
    setHidden($('#practice-base'), !previewShown());
    drawBaseWave();
    practicePanel.reset();
    practicePanel.set(referenceWords(base), base.transcripts); // the Gītā's words, or the typed text; the recording is not transcribed
    showActiveReport();
  } catch (err) {
    if (token !== activeToken) return;
    practiceProgress.hide();
    toast(`Could not load “${nameOf(id)}”: ${err.message}`, 'error', 6000);
  } finally {
    if (token === activeToken) updateRecLabel();
  }
}

// Another script to show the text in: the sloka panel and an open report's words follow.
sttLanguageListeners.add(() => {
  renderSlokaTexts();
  if (practice.result && sttPractice.heard) renderTranscriptDiff();
});
// A transcript stored in the background reaches the loaded slokas too.
transcriptListeners.add((id, store) => {
  const b = practice.bases.get(id);
  if (!b) return;
  b.transcripts = store;
  if (!b.transcript) b.transcript = transcriptIn(store);
  if (practice.activeId === id && practice.base === b) {
    if (b.transcript && !practicePanel.transcript && !practicePanel.busy) practicePanel.set(b.transcript, store);
    else practicePanel.setOthers(store);
  }
});

$('#practice-rec').addEventListener('click', async () => {
  const rec = getPracticeRecorder();
  if (rec.active) {
    // the last stretch recorded goes to the speech worker now, when the pages were turned
    if (recSegments && recSegments.parts.length) markSegment(slokaTextItems()[currentTextIndex(slokaTextItems())]);
    const segments = recSegments;
    recSegments = null;
    // the sloka in view when the take stops, barely begun: less than half recited, not scored
    if (liveEar && liveEar.item && liveEar.expected && liveEar.pos < liveEar.expected * 0.5 && liveEar.counter.state_().elapsedMs >= 2000 && !partialOf(liveEar.item.id)) addSlip(liveEar.item.id, { kind: 'partial', count: Math.round(liveEar.pos), expected: liveEar.expected, by: 'ear' });
    stopEar();
    setHidden($('#practice-rec-stop-listen'), true);
    const raw = await rec.stop();
    practiceUI.setRecording(false);
    setListBusy(false);
    updateRecLabel();
    basePlayer.pause();
    if (!raw || raw.duration < 0.5) { toast('That was too short. Try again.', 'error'); return; }
    const { take, info, changed, removedStart = 0 } = trimTake(raw, $('#practice-trim').checked);
    if (take.duration < 0.5) { toast('Hardly any sound was heard. Try again.', 'error'); return; }
    if (changed) toast(info, 'info', 2500);
    take.blob = encodeWav(take.samples, take.sampleRate);
    // the stretches transcribed while recording, in the take's time (the trimmed lead taken off)
    take.segments = segments && segments.parts.length ? segments.parts.map((p) => ({ ...p, from: p.from - removedStart, to: p.to - removedStart })) : null;
    for (const list of practice.slips.values()) for (const x of list) if (x.at != null) x.at = Math.max(0, Math.round((x.at - removedStart) * 100) / 100); // the slips in the take's time too
    practice.take = take;
    await heardPlayer.load(take.blob);
    showEvaluating(); // the results card, with Evaluating… in it, from now until the sloka's report is in
    await analyseAttempt();
  } else {
    if (!practice.base) return;
    try {
      hideResults();
      practiceUI.reset();
      await rec.start();
      practiceUI.setRecording(true);
      setListBusy(true);
      recSegments = { from: 0, parts: [], stopped: false };
      practice.slips = new Map();
      practice.listenStopped = false;
      setHidden($('#practice-rec-stop-listen'), true);
      recTextIndex = currentTextIndex(slokaTextItems());
      recNote('');
      startEar(rec); // several slokas: each is heard to its end and sent on by itself
      if ($('#practice-playalong').checked && $('#practice-headphones').checked) {
        basePlayer.seek(0);
        basePlayer.play();
      }
    } catch (err) {
      toast(err.message, 'error', 6000);
    }
  }
});

// One take, compared with every ticked sloka.
async function analyseAttempt() {
  const take = practice.take;
  if (!take || !practice.selection.length) return;
  practiceProgress.show('Listening back to what you sang…');
  $('#practice-rec').disabled = true;
  setListBusy(true);
  try {
    practice.results.clear();
    practice.pairContrast.clear();
    practice.heardTranscripts.clear();
    stopTakeTranscriptions();
    // The words are needed soon (word diff, quiz pronunciation): for a take that is
    // transcribed whole, the speech worker starts on them now, while the analysis worker
    // compares the take. (A longer take is transcribed part by part once the parts are known.)
    if (sttSettings.auto && take.duration <= TAKE_WHOLE_MAX_SEC && practice.selection.length === 1) transcribeTakePart(null, false).catch(() => {}); // several slokas: each stretch once it is found
    practice.heard = await analyzer.features(take.samples, take.sampleRate, (p) => practiceProgress.set(p * 0.6), { warps: true });
    practice.options = {
      ignoreKey: $('#practice-ignorekey').checked,
      judgeSpeed: $('#practice-tempo').checked,
      flagDynamics: true, // everything is measured; the filter chips decide what is shown
      mode: 'chant',
      learner: learnerSpeaker(), // who recites: a child's allowances when one is chosen
    };
    await runComparisons(0.6);
    const good = reportIds().filter((id) => isReport(practice.results.get(id)));
    if (!good.length) {
      const first = practice.results.get(reportIds()[0]);
      toast(first ? first.error : 'Nothing could be compared.', 'error', 7000);
      hideResults();
      return;
    }
    // open the previewed sloka's report if it matches the take, otherwise the first one that does
    const matching = good.filter((id) => practice.results.get(id).match.ok);
    const pool = matching.length ? matching : good;
    setHidden($('#practice-base'), !previewShown());
    if (pool.includes(practice.activeId) && practice.base) showActiveReport();
    else await setActiveBase(pool[0]);
    if (practice.quiz) scoreQuizAttempt();
    else saveSession(); // a Self Evaluation / Teach take is kept for the Reports dashboard
    transcribeAllParts(); // the other reports' words, in the background
  } catch (err) {
    hideResults(); // Evaluating… goes with the results card
    toast(err.message, 'error', 7000);
  } finally {
    practiceProgress.hide();
    setListBusy(false);
    updateRecLabel();
  }
}

// The take's options for one sloka: who recorded it (so the voices are matched within the
// range the pairing can need) and how its style says it is judged. A sloka from before
// metadata existed, whose style no one has set, is judged as before (chant: pitch counts).
function optionsFor(base) {
  const meta = base.record.meta;
  const mode = meta && meta.style && !meta.migrated ? compareModeFor(meta.style.mode) : 'chant';
  return { ...practice.options, reference: speakerOf(meta), mode };
}

// Compares the take with every ticked sloka that has no report yet, one after another.
let compareQueue = Promise.resolve();
function runComparisons(p0 = 0) {
  compareQueue = compareQueue.then(() => compareMissing(p0)).catch(() => {});
  return compareQueue;
}
async function compareMissing(p0) {
  const todo = practice.selection.filter((id) => !practice.results.has(id));
  if (!todo.length || !practice.heard) return;
  setListBusy(true);
  try {
    for (let k = 0; k < todo.length; k++) {
      const id = todo[k];
      if (!practice.selection.includes(id) || practice.results.has(id)) continue;
      const label = todo.length > 1 ? `Comparing with “${nameOf(id)}” (${k + 1} of ${todo.length})…` : 'Comparing with the sloka…';
      try {
        const base = await ensureBase(id);
        practiceProgress.show(label);
        practiceProgress.set(p0 + (1 - p0) * (k / todo.length), label);
        const result = await analyzer.compare(base.features, practice.heard, optionsFor(base));
        if (practice.selection.includes(id)) practice.results.set(id, result);
      } catch (err) {
        if (practice.selection.includes(id)) practice.results.set(id, { error: err.message });
      }
    }
    await comparePairs();
    syncSession(); // slokas ticked after the take join its session
  } finally {
    practiceProgress.hide();
    setListBusy(false);
    updateRecLabel();
  }
}

// ---------- sessions: a Self Evaluation or Teach take, kept for the Reports dashboard ----------
// Created when the take's first comparisons are in, with the recording; updated as more
// slokas are ticked or pronunciation scores arrive from the transcripts.

function sessionItems() {
  return practice.selection.map((id) => {
    const r = practice.results.get(id);
    const rec = (libraryCache || []).find((x) => x.id === id);
    const sc = itemScores(r, { phonology: practice.phonology.get(id) || null, sttAvailable: practice.wordSims.has(id), partial: partialOf(id) });
    return { id, name: rec ? rec.name : nameOf(id), folder: rec ? rec.folder || '' : '', ...sc, diag: comparisonDiag(r), slips: slipsOf(id) };
  });
}
// A session's overall counts the slokas recited (ticked ones that were not found in the
// take are left out; a quiz counts them as 0).
const sessionSummary = (items) => {
  const sum = attemptSummary(items.filter((it) => it.matched), QUIZ_CATEGORIES.map((c) => c.id), activeTolerance(), activeWeights());
  if (sum.grade && items.some((it) => it.partial || isPartial(it.slips))) sum.grade = 'practice'; // a sloka under half recited: the take's recommendation is Needs practice
  return sum;
};
async function saveSession() {
  const take = practice.take;
  if (!take || practice.quiz || practice.session) return;
  const items = sessionItems();
  if (!items.length) return;
  const sum = sessionSummary(items);
  const session = { pending: true };
  practice.session = session;
  try {
    const saved = await api.createSession({
      kind: practice.teach ? 'teach' : 'evaluation', at: new Date().toISOString(), takeDuration: take.duration,
      items, overall: sum.overall, grade: sum.grade, options: { ignoreKey: practice.options.ignoreKey, judgeSpeed: practice.options.judgeSpeed },
      tolerance: activeTolerance(), noTolerance: tolOff, learner: learnerSpeaker(), weights: activeWeights(),
    });
    if (practice.session !== session) { api.deleteSession(saved.id).catch(() => {}); return; } // the take was discarded meanwhile
    session.id = saved.id;
    session.pending = false;
    session.sent = JSON.stringify(items);
    refreshProgress(`session:${saved.id}`);
    api.putSessionAudio(saved.id, take.blob).catch((err) => console.warn(`The session's recording could not be kept: ${err.message}`));
    if (session.dirty) syncSession();
  } catch (err) {
    practice.session = null;
    console.warn(`The session could not be saved: ${err.message}`);
  }
}
let sessionSyncTimer = null;
function syncSession() {
  const session = practice.session;
  if (!session) return;
  if (session.pending) { session.dirty = true; return; }
  clearTimeout(sessionSyncTimer);
  sessionSyncTimer = setTimeout(async () => {
    if (practice.session !== session || !session.id) return;
    const items = sessionItems();
    const body = JSON.stringify(items);
    if (body === session.sent) return;
    session.sent = body;
    session.dirty = false;
    const sum = sessionSummary(items);
    try { await api.updateSession(session.id, { items, overall: sum.overall, grade: sum.grade, tolerance: activeTolerance(), noTolerance: tolOff, weights: activeWeights() }); refreshProgress(`session:${session.id}`); } catch (err) { console.warn(`The session could not be updated: ${err.message}`); }
  }, 600);
}

// ---------- reports: one per sloka, plus the conflicts between them ----------

const isReport = (r) => !!r && !r.error;
const reportIds = () => practice.selection.filter((id) => practice.results.has(id));
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// Two reports claim the same audio when their matched stretches of the take overlap by more
// than half of the shorter one.
function spansOverlap(a, b) {
  const [a0, a1] = a.matched.heard;
  const [b0, b1] = b.matched.heard;
  const ov = Math.min(a1, b1) - Math.max(a0, b0);
  return ov > 0.5 * Math.min(a1 - a0, b1 - b0);
}

// For slokas that claim the same audio: are they the same material (one verse inside a
// longer recording, two versions of a verse), or different material that cannot both be right?
async function comparePairs() {
  const ids = reportIds().filter((id) => { const r = practice.results.get(id); return isReport(r) && r.match.ok; });
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      const key = pairKey(ids[a], ids[b]);
      if (practice.pairContrast.has(key) || !spansOverlap(practice.results.get(ids[a]), practice.results.get(ids[b]))) continue;
      try {
        const [A, B] = await Promise.all([ensureBase(ids[a]), ensureBase(ids[b])]);
        practice.pairContrast.set(key, await analyzer.contrast(A.features, B.features));
      } catch { practice.pairContrast.set(key, null); }
    }
  }
}

// What is wrong (or notable) about a report as a whole: { level: 'bad' | 'warn' | 'info', text }.
function reportFlag(id) {
  const r = practice.results.get(id);
  if (!r) return null;
  if (r.error) return { level: 'bad', text: 'Could not be compared' };
  if (partialOf(id)) return { level: 'bad', text: `${slipsLabel(slipsOf(id))} · not scored · Needs practice` };
  if (!r.match.ok) return { level: 'bad', text: 'Does not sound like this sloka' };
  if (r.match.by === 'words') return { level: 'info', text: 'Confirmed by the words (the recordings sound different)' };
  const clash = [];
  const same = [];
  for (const other of reportIds()) {
    const o = practice.results.get(other);
    if (other === id || !isReport(o) || !o.match.ok || !spansOverlap(r, o)) continue;
    const c = practice.pairContrast.get(pairKey(id, other));
    (c != null && c >= MISMATCH_CONTRAST ? clash : same).push(`“${nameOf(other)}”`);
  }
  if (clash.length) return { level: 'warn', text: `Conflicts with ${clash.join(', ')}: different material matched to the same part of your recording` };
  if (same.length) return { level: 'info', text: `Same part of your recording as ${same.join(', ')}` };
  return null;
}

// The take's scoreboard, above the single report: the take's overall (the mean over the
// slokas recited) with its grade and words, then one card per sloka — its score, grade and
// what went wrong — the open one marked; a card opens its report.
function renderTakeBoard(ids) {
  const board = $('#take-board');
  if (ids.length < 2 || practice.quiz) { setHidden(board, true); return; }
  setHidden(board, false);
  const items = sessionItems();
  const sum = sessionSummary(items);
  const recited = items.filter((it) => it.matched);
  const partial = items.filter((it) => partialOf(it.id));
  const notFound = items.filter((it) => !it.matched && !it.missing && !partialOf(it.id));
  const pending = ids.filter((id) => !practice.results.has(id));
  $('#take-ring').style.setProperty('--pct', String(sum.overall == null ? 0 : sum.overall));
  $('#take-overall').textContent = sum.overall == null ? '–' : String(sum.overall);
  const grade = gradeById(sum.grade);
  const takeSlips = recited.flatMap((it) => it.slips || []);
  setGrade($('#take-grade'), grade, $('#take-words'), { seed: practice.session && practice.session.id ? `session:${practice.session.id}` : 'take', slips: takeSlips, score: sum.overall });
  const bits = [`${ids.length} slokas`, `${recited.length} recited and scored`];
  if (partial.length) bits.push(`${partial.length} less than half recited (not scored)`);
  if (notFound.length) bits.push(`${notFound.length} not recited`);
  if (pending.length) bits.push(`${pending.length} still comparing`);
  const waiting = recited.filter((it) => !practice.wordSims.has(it.id)).length;
  if (!sttSettings.auto) bits.push('the words not heard (Settings)');
  else if (waiting && !practice.listenStopped) bits.push(`the words of ${waiting} on their way`);
  if (practice.listenStopped) bits.push('listening stopped');
  $('#take-sub').textContent = `${bits.join(' · ')} — the overall is the mean over the slokas recited`;
  const cards = $('#take-cards');
  cards.innerHTML = '';
  for (const id of ids) {
    const r = practice.results.get(id);
    const card = document.createElement('button');
    card.type = 'button';
    card.setAttribute('role', 'tab');
    card.setAttribute('aria-selected', id === practice.activeId ? 'true' : 'false');
    const { overall, grade: g } = isReport(r) ? reportOverall(id) : { overall: null, grade: null };
    const sc = reportScores(id);
    const bad = !!(r && (r.error || partialOf(id) || (isReport(r) && !sc.matched)));
    card.className = `take-card${id === practice.activeId ? ' active' : ''}${bad ? ' bad' : ''}${!r ? ' pending' : ''}`;
    card.innerHTML = '<span class="tc-name"></span><span class="tc-score"></span><span class="tc-grade"></span><span class="tc-note"></span>';
    $('.tc-name', card).textContent = nameOf(id);
    $('.tc-name', card).title = nameOf(id);
    const noteEl = $('.tc-note', card);
    if (!r) { $('.tc-score', card).textContent = '…'; noteEl.textContent = 'comparing'; }
    else if (r.error) { $('.tc-score', card).textContent = '–'; noteEl.textContent = 'could not be compared'; noteEl.classList.add('bad'); }
    else if (partialOf(id)) { $('.tc-score', card).textContent = '–'; $('.tc-grade', card).textContent = gradeText(gradeById('practice')); $('.tc-grade', card).classList.add('practice'); noteEl.textContent = slipsLabel(slipsOf(id)) + ' · not scored'; noteEl.classList.add('bad'); }
    else if (!sc.matched) { $('.tc-score', card).textContent = '–'; $('.tc-grade', card).textContent = gradeText(gradeById('practice')); $('.tc-grade', card).classList.add('practice'); noteEl.textContent = 'not recited'; noteEl.classList.add('bad'); }
    else {
      $('.tc-score', card).textContent = overall == null ? '–' : String(overall);
      if (g) { $('.tc-grade', card).textContent = gradeText(g); $('.tc-grade', card).classList.add(g.id); }
      const sl = slipsOf(id);
      noteEl.textContent = sl.length ? slipsLabel(sl) : practice.wordSims.has(id) ? '' : practice.listenStopped || !sttSettings.auto ? 'sound only' : 'words on their way';
      if (sl.length) noteEl.classList.add('bad');
    }
    card.title = id === practice.activeId ? 'This report is open below' : 'Open this sloka\'s report';
    card.addEventListener('click', () => openReport(id));
    cards.appendChild(card);
  }
}
function renderReportBrowser() {
  const ids = reportIds();
  renderTakeBoard(ids);
  setHidden($('#reports'), ids.length < 2);
  setHidden($('#report-title-row'), !ids.length);
  const map = $('#report-map');
  map.innerHTML = '';
  const T = Math.max(0.1, practice.take ? practice.take.duration : 1);
  const pct = (t) => `${Math.max(0, Math.min(1, t / T)) * 100}%`;
  for (const id of ids) {
    const r = practice.results.get(id);
    const flag = reportFlag(id);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `report-row${id === practice.activeId ? ' active' : ''}${flag && flag.level !== 'info' ? ` flag-${flag.level}` : ''}`;
    row.setAttribute('role', 'tab');
    row.setAttribute('aria-selected', id === practice.activeId ? 'true' : 'false');
    row.innerHTML = '<span class="rr-name"></span><span class="rr-track"></span><span class="rr-score mono"></span><span class="rr-info"><span class="rr-count"></span><span class="rr-flag"></span></span>';
    $('.rr-name', row).textContent = nameOf(id);
    $('.rr-name', row).title = nameOf(id);
    if (isReport(r)) {
      const track = $('.rr-track', row);
      const [s0, s1] = r.matched.heard;
      const span = document.createElement('span');
      span.className = `rr-span${flag && flag.level !== 'info' ? ` ${flag.level}` : ''}`;
      span.style.left = pct(s0);
      span.style.width = pct(s1 - s0);
      span.title = `Found at ${fmtTime(s0)} – ${fmtTime(s1)} of your recording`;
      track.appendChild(span);
      const shown = r.deviations.filter(devMatchesFilter);
      for (const d of shown) {
        if (!d.tHeard) continue;
        const m = document.createElement('i');
        m.className = `rr-mark type-${d.type}`;
        m.style.left = pct(d.tHeard[0]);
        m.style.width = pct(d.tHeard[1] - d.tHeard[0]);
        track.appendChild(m);
      }
      const { overall, grade } = reportOverall(id);
      const sEl = $('.rr-score', row);
      sEl.innerHTML = '<span></span><span class="rr-grade"></span>';
      sEl.firstChild.textContent = overall == null ? '–' : String(overall);
      if (grade) { sEl.lastChild.textContent = gradeText(grade); sEl.lastChild.classList.add(grade.id); }
      sEl.title = 'Overall score, weighted over the categories judged so far';
      $('.rr-count', row).textContent = shown.length ? `${shown.length} conflict${shown.length === 1 ? '' : 's'}` : 'No conflicts';
      const v = reportVerdict(id);
      if (v.ok !== null) {
        const ve = document.createElement('span');
        ve.className = `rr-verdict ${v.ok ? 'ok' : 'bad'}`;
        ve.textContent = verdictText(v);
        $('.rr-info', row).insertBefore(ve, $('.rr-flag', row));
      }
      // what went wrong in the recitation itself: "restarted pāda 3", "stuck in pāda 2"…
      const sl = slipsOf(id);
      if (sl.length) {
        const se = document.createElement('span');
        se.className = 'rr-slip';
        se.textContent = slipsLabel(sl);
        se.title = 'The recitation is scored in full; a slip like this makes its grade Needs practice';
        $('.rr-info', row).insertBefore(se, $('.rr-flag', row));
      }
    } else {
      $('.rr-score', row).textContent = '–';
    }
    const fl = $('.rr-flag', row);
    if (flag) { fl.textContent = flag.text; fl.className = `rr-flag ${flag.level}`; } else fl.remove();
    row.addEventListener('click', () => openReport(id));
    map.appendChild(row);
  }
  const idx = ids.indexOf(practice.activeId);
  $('#reports-title').textContent = `Report · ${idx >= 0 ? nameOf(practice.activeId) : ''}`;
  $('#reports-fold-sub').textContent = `${ids.length} rows · where each sloka was found in your recording, and its conflicts`;
  $('#report-pos').textContent = idx >= 0 ? `${idx + 1} / ${ids.length}` : '';
  $('#report-name').textContent = practice.activeId ? nameOf(practice.activeId) : ''; // the name alone: the verdict is the ring's and the rows' to tell
}
// The preview above the results changes height with the sloka, so keep the reports in view.
async function openReport(id) {
  if (id === practice.activeId) return;
  await setActiveBase(id);
  $('#practice-results').scrollIntoView({ block: 'start' });
}
function stepReport(delta) {
  const ids = reportIds();
  if (ids.length < 2) return;
  const idx = Math.max(0, ids.indexOf(practice.activeId));
  openReport(ids[(idx + delta + ids.length) % ids.length]);
}
$('#report-prev').addEventListener('click', () => stepReport(-1));
$('#report-next').addEventListener('click', () => stepReport(1));

// Shows the report of the active sloka (or why there is none).
function showActiveReport() {
  if (!practice.take || !reportIds().length) return;
  setHidden($('#practice-results'), false);
  const r = practice.results.get(practice.activeId);
  if (!isReport(r)) {
    practice.result = null;
    practice.selected = null;
    renderReportBrowser();
    $('#report-error').textContent = r ? `This sloka could not be compared: ${r.error}` : 'This sloka has not been compared yet.';
    setHidden($('#report-error'), false);
    setHidden($('#report-body'), true);
    resetTranscriptUI();
    setEvaluating(false); // nothing is coming for it
    return;
  }
  if (partialOf(practice.activeId)) {
    practice.result = null; // nothing to show but the note
    practice.selected = null;
    renderReportBrowser();
    $('#report-error').textContent = `${slipsLabel(slipsOf(practice.activeId))} — this sloka is not transcribed or scored. Needs practice: recite the whole of it, then evaluate again.`;
    setHidden($('#report-error'), false);
    setHidden($('#report-body'), true);
    resetTranscriptUI();
    setEvaluating(false);
    return;
  }
  setHidden($('#report-error'), true);
  setHidden($('#report-body'), false);
  renderResult(r);
  renderQuizScore();
  if (sttSettings.auto || practice.heardTranscripts.size) transcribeBoth(false);
  else $('#stt-summary').textContent = WORDS_OFF_NOTE; // the sloka's words still shown; yours not heard
  // its words (or the quiz's score) still on their way: Evaluating… until they come (the
  // body, just shown, hides again under it)
  if (evaluating || moreComing(r)) setEvaluating(true);
  settleEvaluating();
}

// ======================================================================
// QUIZ MODE (inside Self Evaluation) and the QUIZ view
// ======================================================================

let quizScoring = false;
// The preview (waveform, play, speed, the transcript panel) is Teach's; Self Evaluation and a
// quiz show the chosen sloka in the text panel instead.
const previewShown = () => !!practice.teach && !!practice.base;

// ---------- the slokas' text during a quiz ----------
// On by default: each chosen sloka's text (typed in its details, else its transcript in the
// chosen language) is shown one at a time above the record button, and the step is "Recite
// with the text shown". Off: "Recite from memory", nothing shown. The recordings stay hidden
// either way until the take is in.
const QUIZ_TEXT_KEY = 'tutor-quiz-text';
const EVAL_TEXT_KEY = 'tutor-eval-text';
let quizTextOn = (() => { try { return localStorage.getItem(QUIZ_TEXT_KEY) !== '0'; } catch { return true; } })();
// ... and during Self Evaluation: with two or more slokas ticked their texts are listed in the
// same panel; off, no sloka text is shown there at all (the preview's text panel included).
let evalTextOn = (() => { try { return localStorage.getItem(EVAL_TEXT_KEY) !== '0'; } catch { return true; } })();
{
  const bind = (sel, key, get, set) => {
    const cb = $(sel);
    cb.checked = get();
    cb.addEventListener('change', () => {
      set(cb.checked);
      try { if (cb.checked) localStorage.removeItem(key); else localStorage.setItem(key, '0'); } catch { /* ignore */ }
      renderModeChrome();
      renderSlokaTexts();
    });
  };
  bind('#settings-quiz-text', QUIZ_TEXT_KEY, () => quizTextOn, (v) => { quizTextOn = v; });
  bind('#settings-eval-text', EVAL_TEXT_KEY, () => evalTextOn, (v) => { evalTextOn = v; });
}
// The chandas hint under a sloka, and how many lines a sloka is written in (2: the
// half-verses, 4: the pādas).
const CHANDAS_HINT_KEY = 'tutor-chandas-hint';
const SLOKA_LINES_KEY = 'tutor-sloka-lines';
let chandasHintOn = (() => { try { return localStorage.getItem(CHANDAS_HINT_KEY) !== '0'; } catch { return true; } })();
let slokaLines = (() => { try { return localStorage.getItem(SLOKA_LINES_KEY) === '4' ? 4 : 2; } catch { return 2; } })();
{
  const cb = $('#settings-chandas-hint');
  cb.checked = chandasHintOn;
  cb.addEventListener('change', () => {
    chandasHintOn = cb.checked;
    try { if (chandasHintOn) localStorage.removeItem(CHANDAS_HINT_KEY); else localStorage.setItem(CHANDAS_HINT_KEY, '0'); } catch { /* ignore */ }
    renderSlokaTexts();
  });
  const marksCb = $('#settings-marks');
  marksCb.checked = marksOn;
  marksCb.addEventListener('change', () => {
    marksOn = marksCb.checked;
    try { if (marksOn) localStorage.removeItem(MARKS_KEY); else localStorage.setItem(MARKS_KEY, '0'); } catch { /* ignore */ }
    for (const fn of sttLanguageListeners) fn(displayLanguage()); // everything written in a script is drawn again
    if (sttPractice.heard) renderTranscriptDiff();
  });
  for (const r of $$('input[name="sloka-lines"]')) {
    r.checked = Number(r.value) === slokaLines;
    r.addEventListener('change', () => {
      if (!r.checked) return;
      slokaLines = Number(r.value) === 4 ? 4 : 2;
      try { if (slokaLines === 2) localStorage.removeItem(SLOKA_LINES_KEY); else localStorage.setItem(SLOKA_LINES_KEY, '4'); } catch { /* ignore */ }
      renderSlokaTexts();
      if (practice.base && practice.base.transcript) practicePanel.set(practice.base.transcript, practice.base.transcripts); // redrawn in its new lines
      if (sttPractice.heard) renderTranscriptDiff();
    });
  }
}
// The chandas of a record: its details' (the server keeps it with the text), else read from
// the text now, the Gītā table deciding the family when the name says which verse it is.
function chandasOf(record, text) {
  if (record && record.meta && record.meta.chandas && record.meta.chandas.family) return record.meta.chandas;
  if (!text) return null;
  const v = record ? gitaVerse(record.name) : null;
  return identifyChandas(text, { expected: v ? gitaFamily(v.chapter, v.verse) : null });
}
// Hide the Transcript block of the results (the sloka's words and yours) in Self Evaluation
// and quizzes; the words are still heard and scored.
const HIDE_TRANSCRIPT_KEY = 'tutor-hide-transcript';
let hideTranscript = (() => { try { return localStorage.getItem(HIDE_TRANSCRIPT_KEY) === '1'; } catch { return false; } })();
{
  const cb = $('#settings-hide-transcript');
  cb.checked = hideTranscript;
  cb.addEventListener('change', () => {
    hideTranscript = cb.checked;
    try { if (hideTranscript) localStorage.setItem(HIDE_TRANSCRIPT_KEY, '1'); else localStorage.removeItem(HIDE_TRANSCRIPT_KEY); } catch { /* ignore */ }
    setHidden($('#transcript'), hideTranscript);
  });
}
// Grades shown as an emoji and a few words of encouragement (the default), or as the plain
// labels a teacher reviewing many takes may prefer.
const GRADE_WORDS_KEY = 'tutor-grade-words';
let gradeWordsOn = (() => { try { return localStorage.getItem(GRADE_WORDS_KEY) !== '0'; } catch { return true; } })();
{
  const cb = $('#settings-grade-words');
  cb.checked = gradeWordsOn;
  cb.addEventListener('change', () => {
    gradeWordsOn = cb.checked;
    try { if (gradeWordsOn) localStorage.removeItem(GRADE_WORDS_KEY); else localStorage.setItem(GRADE_WORDS_KEY, '0'); } catch { /* ignore */ }
    refreshVerdicts();
    renderQuizScore();
    renderQuizList();
    if (assessmentsCache) renderReports();
  });
}
// The sloka's text in Devanagari: the text typed in its details (in whatever script), else
// its transcript. The panel writes it in the chosen script.
const slokaTextOf = (base) => {
  const meta = base.record && base.record.meta;
  const typed = meta && meta.text && meta.text.body && meta.text.origin !== 'transcript' ? meta.text : null;
  const text = typed ? typed.body : base.transcript && base.transcript.text ? base.transcript.text : '';
  return text ? toDeva(text) : '';
};
// The slokas the panel pages through: a quiz's, else the ticked ones; never in Teach, which
// has the preview. One is in view at a time: its name, a play button (not before a quiz's
// take: the recordings stay hidden), the speed, and its text when the setting allows. Outside
// a quiz's wait the sloka in view is the active one, whose recording the play button plays
// and whose report opens first, so Previous / Next change the active sloka.
function slokaTextItems() {
  if (practice.teach) return [];
  const byId = new Map((libraryCache || []).map((r) => [r.id, r]));
  if (practice.quiz) return practice.quiz.items.filter((it) => byId.has(it.id));
  return practice.selection.filter((id) => byId.has(id)).map((id) => ({ id, name: byId.get(id).name, folder: byId.get(id).folder || '' }));
}
let quizTextIndex = 0; // the page before a quiz's take, when no sloka is active for playing
const textShown = () => (practice.quiz ? (practice.take ? true : quizTextOn) : evalTextOn);
const playShown = () => !practice.quiz || !!practice.take;
// The speech model is loaded in the worker as soon as a sloka is ready to be recited (and
// transcription will be wanted), so a stretch sent while recording, or the take itself,
// finds it ready: the loading is what used to make the page stutter.
const warmed = new Set(); // "tier:device" already asked for in this page
function warmStt() {
  if (!sttSettings.auto) return; // the words are not heard: no model to load
  sttTier().then((tier) => {
    const device = sttSettings.cpuTiers.includes(tier) ? 'wasm' : null;
    const key = `${tier}:${device || 'auto'}`;
    if (warmed.has(key)) return;
    warmed.add(key);
    stt.warm({ tier, device, language: sttSettings.language }).catch(() => warmed.delete(key)); // a tier this browser cannot run: asked again next time, and reported when used
  }).catch(() => {});
}
const recordingNow = () => !!practiceRecorder && practiceRecorder.active;
let recTextIndex = 0; // the page while recording in Self Evaluation: the active sloka is left alone
function currentTextIndex(items) {
  if (!items.length) return -1;
  if (practice.quiz && !practice.take) return Math.max(0, Math.min(items.length - 1, quizTextIndex));
  if (recordingNow()) return Math.max(0, Math.min(items.length - 1, recTextIndex));
  const i = items.findIndex((it) => it.id === practice.activeId);
  return i < 0 ? 0 : i;
}
let slokaTextsToken = 0;
async function renderSlokaTexts() {
  const host = $('#practice-texts');
  const items = slokaTextItems();
  const i = currentTextIndex(items);
  setHidden(host, i < 0);
  if (i < 0) return;
  const token = ++slokaTextsToken;
  $('#practice-texts-title').textContent = practice.quiz ? 'The slokas of this quiz' : items.length > 1 ? 'The selected slokas' : 'The sloka';
  const withText = textShown();
  setHidden($('#practice-text'), !withText);
  setHidden($('#practice-text-names'), withText);
  for (const sel of ['#practice-texts-prev', '#practice-texts-next']) setHidden($(sel), !withText || items.length < 2);
  $('#practice-texts-pos').textContent = withText && items.length > 1 ? `${i + 1} of ${items.length}` : '';
  if (!withText) {
    // the names alone: four at most, all of them in the tooltip
    const byId = new Map((libraryCache || []).map((r) => [r.id, r]));
    const names = items.map((it) => { const ch = chandasHintOn ? chandasOf(byId.get(it.id), null) : null; return ch && ch.name ? `${it.name} (${ch.name.toLowerCase()})` : it.name; });
    const el = $('#practice-text-names');
    el.textContent = names.slice(0, 4).join(', ') + (names.length > 4 ? ` and ${names.length - 4} more` : '');
    el.title = names.length > 4 ? names.join(', ') : '';
    return;
  }
  const it = items[i];
  $('#practice-texts-prev').disabled = i <= 0;
  $('#practice-texts-next').disabled = i >= items.length - 1;
  const linkOf = (b) => (b && b.record && b.record.meta && b.record.meta.verse ? b.record.meta.verse : null);
  const cachedLink = linkOf(practice.bases.get(it.id));
  $('#practice-text-name').textContent = `${it.folder ? `${it.name} · ${it.folder}` : it.name}${cachedLink ? ` · Gītā ${cachedLink.id}` : ''}`;
  for (const sel of ['#practice-texts-play', '#practice-texts-speed', '#practice-text-time']) setHidden($(sel), !playShown());
  const body = $('#practice-text-body');
  const hintEl = $('#practice-text-chandas');
  setHidden(body, false);
  const show = (base) => {
    const text = slokaTextOf(base);
    const ch = chandasOf(base.record, text);
    const hint = chandasHintOn && ch && ch.family ? chandasLabel(ch) : '';
    hintEl.textContent = hint;
    hintEl.title = hint ? chandasPattern(ch) : '';
    setHidden(hintEl, !hint);
    if (text) body.innerHTML = scriptHtml(withDandas(layoutSloka(text, { perPada: ch ? ch.perPada : null, lines: slokaLines }))).split('<br>').map((l, i) => `<span class="sloka-line" data-line="${i}">${l}</span>`).join('<br>');
    else body.textContent = 'No text yet: transcribe this sloka, or type its text under Details in the Library.';
    body.classList.toggle('muted', !text);
    setHidden($('#practice-text-legend'), !(text && marksShown()));
    // the verse's meaning, from the dataset (and your own, in the chosen language, over it)
    const link = linkOf(base);
    const meaningEl = $('#practice-text-meaning');
    setHidden(meaningEl, true);
    if (link) {
      $('#practice-text-name').textContent = `${it.folder ? `${it.name} · ${it.folder}` : it.name} · Gītā ${link.id}`;
      const lang = { sanskrit: 'sa', kannada: 'kn', telugu: 'te', english: 'en' }[displayLanguage()] || 'en';
      const showMeaning = (entry) => {
        if (token !== slokaTextsToken || !entry) return;
        const tr = entry.translations || {};
        const meaning = tr[lang] || tr.en || '';
        meaningEl.textContent = meaning;
        setHidden(meaningEl, !meaning);
      };
      if (base.verseEntry) showMeaning(base.verseEntry);
      else api.getVerse(link.dataset, link.id).then((entry) => { base.verseEntry = entry; showMeaning(entry); }).catch(() => {});
    }
  };
  const cached = practice.bases.get(it.id);
  if (cached) { show(cached); return; } // a sloka already loaded: no "Loading…" flicker when paging
  setHidden(hintEl, true);
  body.textContent = 'Loading…';
  body.classList.add('muted');
  let base = null;
  try { base = await ensureBase(it.id); } catch { base = null; }
  if (token !== slokaTextsToken) return;
  if (base) show(base); else { body.textContent = 'This sloka could not be loaded.'; }
}
function stepText(delta) {
  const items = slokaTextItems();
  const i = currentTextIndex(items);
  const j = i + delta;
  if (j < 0 || j >= items.length) return;
  if (recordingNow()) {
    // a page turned while recording: the stretch since the last turn is the sloka that was in
    // view — off to the speech worker it goes; the page itself turns without touching the
    // active sloka or the recording
    const partial = !!(liveEar && liveEar.item && liveEar.item.id === items[i].id && liveEar.expected && liveEar.pos < liveEar.expected * 0.5 && liveEar.counter.state_().elapsedMs >= 2000);
    if (partial) addSlip(items[i].id, { kind: 'partial', count: Math.round(liveEar.pos), expected: liveEar.expected, by: 'ear' });
    markSegment(items[i], null, { transcribe: !partial });
    if (practice.quiz) quizTextIndex = j; else recTextIndex = j;
    renderSlokaTexts();
    earPageTurned();
    return;
  }
  if (practice.quiz && !practice.take) { quizTextIndex = j; renderSlokaTexts(); return; }
  setActiveBase(items[j].id);
}

// ---------- the words while recording ----------
// With several slokas in a take, each page turn (Previous / Next) closes the stretch recorded
// since the last one and sends it to the speech worker at once, as a background job, so the
// words are ready by the time the take is compared. The worker is its own thread: the
// recording and the page go on untouched. Afterwards each report's stretch of the take takes
// the words of the recorded stretch that overlaps it well enough (transcribeTakePart), and is
// transcribed afresh otherwise.
let recSegments = null; // { from, parts: [{ from, to, name, promise, transcript }] } in recording time
function markSegment(item, toSec = null, { transcribe = true } = {}) {
  const rec = practiceRecorder;
  if (!rec || !rec.active || !recSegments) return;
  const snap = rec.snapshot();
  const from = recSegments.from;
  const to = toSec != null ? Math.max(from, Math.min(snap.duration, toSec)) : snap.duration;
  recSegments.from = to;
  if (to - from < 2) return; // a page turned back and forth: nothing to hear
  const seg = { from, to, id: item ? item.id : null, name: item ? item.name : '', promise: null, transcript: null, done: true, ctrl: null };
  recSegments.parts.push(seg);
  // less than half recited, the listening stopped, or the words not wanted: the stretch is kept apart, its words never asked for
  if (!transcribe || recSegments.stopped || !sttSettings.auto) { seg.skipped = true; seg.promise = Promise.resolve(null); return; }
  const sr = snap.sampleRate;
  const samples = snap.samples.slice(Math.round(from * sr), Math.round(to * sr));
  const parts = recSegments.parts;
  seg.done = false;
  seg.ctrl = new AbortController();
  recNote(`Listening to ${seg.name || 'that stretch'} in the background…`);
  setHidden($('#practice-rec-stop-listen'), false);
  seg.promise = runTranscription(samples, sr, null, seg.name || 'your recording', seg.ctrl.signal, { background: true })
    .then((t) => { seg.transcript = t; try { checkSegmentWords(seg); } catch { /* a guess only */ } return t; })
    .catch(() => null)
    .finally(() => { seg.done = true; const busy = parts.find((p) => !p.done); if (!busy) { if (!recSegments.stopped) recNote(''); setHidden($('#practice-rec-stop-listen'), true); } else recNote(`Listening to ${busy.name || 'that stretch'} in the background…`); });
}
// Stop listening: the background jobs of this take are stopped and no more are queued; the
// sound is still compared, and the open report can still ask for its words afterwards.
$('#practice-rec-stop-listen').addEventListener('click', () => {
  if (!recSegments) return;
  recSegments.stopped = true;
  for (const p of recSegments.parts) if (p.ctrl && !p.done) p.ctrl.abort();
  practice.listenStopped = true;
  recNote('Listening stopped for this take: the sound is still compared; the words of the open report come when it is opened.');
  setHidden($('#practice-rec-stop-listen'), true);
});
// The words of a stretch heard in the background, against every sloka of the take: when
// they are clearly another sloka's than the page assumed (the learner skipped ahead, or
// went back), the stretch is relabelled and, while the recording goes on, the page turns
// to the sloka after the one actually heard — the count going on as it is.
function checkSegmentWords(seg) {
  const t = seg.transcript;
  if (!t || !seg.id) return;
  const heard = tokenizeTranscript(t).map((w) => w.word);
  if (heard.length < 4) return;
  const items = slokaTextItems();
  if (items.length < 2) return;
  const sims = items.map((it) => { const base = practice.bases.get(it.id); const text = base ? slokaTextOf(base) : ''; if (!text) return 0; const c = compareWords(tokenize(text).map((w) => w.word), heard); return c ? c.summary.similarity : 0; });
  const assumed = items.findIndex((it) => it.id === seg.id);
  let best = 0;
  for (let i = 1; i < sims.length; i++) if (sims[i] > sims[best]) best = i;
  if (assumed < 0 || best === assumed || sims[best] < 0.55 || sims[best] < sims[assumed] + 0.25) return;
  seg.id = items[best].id;
  seg.name = items[best].name;
  seg.relabelled = true;
  const now = slokaTextItems();
  const i = currentTextIndex(now);
  if (recordingNow() && liveEar && i === assumed + 1 && best + 1 < now.length && best + 1 !== i) {
    if (practice.quiz) quizTextIndex = best + 1; else recTextIndex = best + 1;
    renderSlokaTexts();
    liveEar.retarget(best + 1);
  }
  toast(`That was ${items[best].name}, not ${items[assumed].name}.`, 'info', 5000);
}
function recNote(text) {
  const el = $('#practice-rec-note');
  el.textContent = text;
  setHidden(el, !text);
}

// ---------- the ear: a sloka heard to its end, in a take of several ----------
// While several slokas are recorded in one take, the app counts the akṣaras it hears (the
// nuclei of the loudness envelope, dsp/syllables.js) against the akṣaras of the sloka in
// view — its text, speaker line included — and once they are all but in and a pause
// follows, the sloka is complete: its stretch, up to where the pause began, goes to the
// speech worker at once as a background job, and the panel turns to the next sloka by
// itself, exactly what Previous / Next did by hand. The worker takes the queued stretches
// one after another, in the background, until none is left, so the words of every sloka
// but the last are ready when the take stops. The count is a guide, not a judge: the
// comparison afterwards finds each sloka in the take on its own (segmentFor).
let liveEar = null;
// The akṣara plan of a sloka in view (see chandas.aksharaPlan): the dataset's for a linked
// verse (a custom plan when the verse does not scan), else read from its text.
function planOf(item) {
  const base = item && practice.bases.get(item.id);
  if (!base) return null;
  const link = base.record && base.record.meta && base.record.meta.verse;
  if (link && base.verseEntry) { const p = versePlan(base.verseEntry, { speakerLine: link.speakerLineRecited !== false }); if (p && p.total) return p; }
  const text = slokaTextOf(base);
  if (!text) return null;
  const ch = chandasOf(base.record, text);
  const p = aksharaPlan(text, { perPada: ch ? ch.perPada : null });
  return p.total ? p : null;
}
// How long the sloka takes its teacher: the recording's sounding time, else its length.
function expectedSecOf(item) {
  const base = item && practice.bases.get(item.id);
  if (!base) return null;
  const v = base.record && base.record.meta && base.record.meta.voice;
  return v && v.activeSec > 0 ? v.activeSec : base.duration || null;
}
// Where a count of akṣaras heard stands in the plan: the pāda in progress (1-based; 0 the
// speaker line) and whether the count sits at a pāda's end, give or take the counter's
// tenth. A pause at a boundary is a breath; a pause inside a pāda is a stall.
function padaAt(plan, count) {
  if (!plan || !plan.checkpoints.length) return { pada: null, atBoundary: false };
  const cps = plan.checkpoints;
  const tolAt = (k) => Math.max(1, Math.round(cps[k] * 0.1));
  let k = 0;
  while (k < cps.length - 1 && count > cps[k] + tolAt(k)) k++;
  const atBoundary = Math.abs(count - cps[k]) <= tolAt(k);
  const pada = plan.speakerLine ? k : k + 1;
  return { pada, atBoundary, padas: plan.padas.length };
}
// The count at which a pāda begins (0 the speaker line).
function startCountOf(plan, pada) {
  const cps = plan.checkpoints;
  if (pada === 0) return 0;
  return plan.speakerLine ? cps[pada - 1] : pada === 1 ? 0 : cps[pada - 2];
}
const padaName = (p) => (p === 0 ? 'the speaker line' : `pāda ${p}`);
// The pāda-start fingerprints of a sloka (dsp/starts.js): from its features and the timings
// of its transcript, made once and kept with the loaded sloka; null when the recording
// has no timings, or its starts are too alike to tell apart.
function fingerprintsOf(item, plan) {
  const base = item && practice.bases.get(item.id);
  if (!base || !base.features || !plan) return null;
  if (base.fingerprints !== undefined && base.fingerprintsPlan === plan.total) return base.fingerprints;
  let fp = null;
  try {
    const chunks = base.transcript && Array.isArray(base.transcript.chunks) ? base.transcript.chunks : [];
    const templates = startTemplates(base.features, padaStarts(chunks, plan));
    if (templates.length >= 2) { const { threshold } = calibrate(templates, base.features); if (threshold != null) fp = { templates, threshold }; }
  } catch { fp = null; }
  base.fingerprints = fp;
  base.fingerprintsPlan = plan.total;
  return fp;
}
// The samples of the recording between two moments (seconds), from the recorder's chunks.
function samplesBetween(rec, fromSec, toSec) {
  const sr = rec.ctx.sampleRate;
  const a = Math.max(0, Math.round(fromSec * sr));
  const b = Math.max(a, Math.round(toSec * sr));
  const out = new Float32Array(b - a);
  let at = 0;
  for (const c of rec.chunks) {
    const end = at + c.length;
    if (end > a && at < b) out.set(c.subarray(Math.max(0, a - at), Math.min(c.length, b - at)), Math.max(0, at - a));
    at = end;
    if (at >= b) break;
  }
  return out;
}
// The MFCC frames of what was sung from `at` for a template's length, with the mean of the
// last few seconds taken off (as the teacher's recording has its own mean taken off).
async function liveRows(rec, at) {
  const ctx = Math.max(0, at - 3);
  const x = resample(samplesBetween(rec, ctx, at + TEMPLATE_SEC + 0.05), rec.ctx.sampleRate, FEAT_SR);
  if (x.length < FEAT_SR * (TEMPLATE_SEC + 0.1)) return null;
  const F = await analyzer.features(x, FEAT_SR, null); // in the analysis worker: the page stays smooth
  return mfccRows(F, Math.round((at - ctx) / F.hopSec), TEMPLATE_FRAMES, { mean: meanOf(F) });
}
// Sound after a pause: where in the sloka does it begin? A start the count has already
// passed is a restart — of a pāda (the count goes back to its start) or of the sloka (what
// came before was a false start; the stretch begins again here). A start that is simply
// next is the recitation going on. Nothing is done on a doubtful match.
async function hearRestart(ear, p) {
  const { plan, fp, rec, item } = ear;
  if (!plan || !fp || !item) return;
  let rows = null;
  try { rows = await liveRows(rec, p.at); } catch { rows = null; }
  if (!rows || rows.length < MIN_TEMPLATE_FRAMES || liveEar !== ear || ear.item !== item) return;
  const m = matchStart(rows, fp.templates, { threshold: fp.threshold });
  if (!m.confident) return;
  const k = m.best.pada;
  const first = plan.speakerLine ? 0 : 1;
  const since = Math.max(0, ear.counter.count - p.count) / (ear.countRatio || 1); // akṣaras heard since the pause ended
  const setPosition = (aks) => { ear.counter.count = Math.round(aks * (ear.countRatio || 1)); ear.activeMs = ear.aksPerSec ? (aks / ear.aksPerSec) * 1000 : 0; };
  const was = p.pos != null ? p.pos : p.count;
  if (k === first) {
    if (was < plan.total * 0.25) return; // only just begun: not a restart
    addSlip(item.id, { kind: 'falseStart', at: Math.round((recSegments ? recSegments.from : 0) * 100) / 100, word: padaFirstWord(item, plan, first), by: 'sound' });
    setPosition(since);
    ear.stalled = new Set();
    if (recSegments) recSegments.from = Math.max(recSegments.from, p.at - 0.15);
    recNote(`${item.name} from the top: the count starts again`);
    return;
  }
  const sc = startCountOf(plan, k);
  if (was < sc + 3) return; // the pāda is simply next
  addSlip(item.id, { kind: 'restart', at: Math.round(p.at * 100) / 100, pada: k, word: padaFirstWord(item, plan, k), by: 'sound' });
  setPosition(sc + since);
  ear.stalled = new Set();
  recNote(`${padaName(k)} again: the count goes back to ${sc}`);
}
// The first word of a pāda of the sloka in view (the speaker line's for 0), by the akṣaras.
function padaFirstWord(item, plan, pada) {
  const base = item && practice.bases.get(item.id);
  const text = base ? slokaTextOf(base) : '';
  if (!text || !plan) return undefined;
  const start = startCountOf(plan, pada);
  let acc = 0;
  for (const w of tokenize(text)) { if (acc >= start) return w.word; acc += syllabify(w.word).length; }
  return undefined;
}
// The learner taps a line of the text while the ear listens: "I am here" — the count is
// set to that line's first pāda; a tap on the count line starts the sloka's count again.
function earResync(line) {
  const ear = liveEar;
  if (!ear || !ear.plan || !recordingNow()) return;
  const plan = ear.plan;
  const lines = $$('#practice-text-body .sloka-line').length;
  const sp = plan.speakerLine ? 1 : 0;
  const bodyLines = Math.max(1, lines - sp);
  const per = Math.max(1, Math.round(plan.padas.length / bodyLines));
  const pada = line == null ? (sp ? 0 : 1) : sp && line === 0 ? 0 : Math.min(plan.padas.length, (line - sp) * per + 1);
  const aks = startCountOf(plan, pada);
  ear.counter.count = Math.round(aks * (ear.countRatio || 1));
  ear.activeMs = ear.aksPerSec ? (aks / ear.aksPerSec) * 1000 : 0;
  ear.stalled = new Set();
  ear.pending = null;
  ear.manual = true;
  renderEar(ear, ear.counter.state_());
  recNote(line == null ? `${ear.item ? ear.item.name : 'The sloka'} from the top` : `From ${padaName(pada)}`);
}
$('#practice-text-body').addEventListener('click', (e) => { const line = e.target.closest('.sloka-line'); if (line && liveEar && recordingNow()) earResync(Number(line.dataset.line)); });
$('#practice-rec-count').addEventListener('click', () => { if (liveEar && recordingNow()) earResync(null); });
// The line of the text that holds a pāda (the speaker line first when there is one).
function lineOfPada(plan, pada) {
  const lines = $$('#practice-text-body .sloka-line').length;
  const sp = plan.speakerLine ? 1 : 0;
  if (pada === 0) return 0;
  const bodyLines = Math.max(1, lines - sp);
  const per = Math.max(1, Math.round(plan.padas.length / bodyLines));
  return Math.min(lines - 1, sp + Math.floor((pada - 1) / per));
}
// What the ear learnt of the learner's pace this take — the ratio of their tempo to the
// teacher's, their pauses between pādas and between slokas — folded into the chosen
// profile as a running mean (twenty takes deep, so it follows them as they change).
async function savePace(ear) {
  const p = profileById(learnerId);
  if (!p || !ear || (!ear.tempoN && !ear.speedN)) return;
  const median = (a) => { if (!a.length) return null; const z = a.slice().sort((x, y) => x - y); return z[Math.floor(z.length / 2)]; };
  const cur = p.pace && typeof p.pace === 'object' ? p.pace : {};
  const n = Math.max(0, Math.min(20, Number(cur.n) || 0));
  const mix = (old, val) => (val == null ? (old == null ? null : old) : old == null || !n ? val : (old * n + val) / (n + 1));
  const pace = {};
  const tr = mix(cur.tempoRatio, ear.tempo); if (tr != null) pace.tempoRatio = Math.round(tr * 100) / 100;
  const pp = mix(cur.padaPauseMs, median(ear.padaPauses)); if (pp != null) pace.padaPauseMs = Math.round(pp);
  const sp = mix(cur.slokaPauseMs, median(ear.slokaPauses)); if (sp != null) pace.slokaPauseMs = Math.round(sp);
  if (ear.speedN) { const v = mix(cur.aksPerSec, ear.aksPerSec); if (v != null) pace.aksPerSec = Math.round(v * 100) / 100; }
  if (ear.countRatioN) { const v = mix(cur.countRatio, ear.countRatio); if (v != null) pace.countRatio = Math.round(v * 100) / 100; }
  pace.n = n + 1;
  try { const saved = await api.patchProfile(p.id, { pace }); Object.assign(p, saved); } catch { /* next time */ }
}
function startEar(rec) {
  stopEar();
  const items = slokaTextItems();
  if (items.length < 2) return; // the ear counts whether or not the words are heard
  const sr = rec.ctx.sampleRate;
  const pace = learnerPace();
  const ear = { rec, counter: new SyllableCounter(sr), read: 0, samplesRead: 0, item: null, plan: null, fp: null, expected: null, expectedMs: 0, tempo: pace.tempoRatio, tempoN: 0, aksPerSec: pace.aksPerSec, speedN: 0, countRatio: pace.countRatio, countRatioN: 0, activeMs: 0, lastElapsed: 0, pos: 0, stalled: new Set(), prevPause: 0, pending: null, padaPauses: [], slokaPauses: [], done: false, listener: null };
  // the sloka in view: its plan, its fingerprints, the teacher's time for it
  const target = (i) => {
    ear.item = slokaTextItems()[i] || null;
    ear.plan = planOf(ear.item);
    ear.fp = fingerprintsOf(ear.item, ear.plan);
    ear.expected = ear.plan ? ear.plan.total : null;
    ear.expectedMs = (expectedSecOf(ear.item) || 0) * 1000;
    ear.stalled = new Set();
    ear.pending = null;
  };
  const begin = () => {
    target(currentTextIndex(slokaTextItems()));
    ear.counter.reset();
    ear.activeMs = 0;
    ear.lastElapsed = 0;
    ear.pos = 0;
    ear.done = false;
  };
  ear.retarget = target; // the page turned on by the words: the count goes on, the sloka changes
  ear.begin = begin;
  begin();
  ear.listener = () => {
    if (!rec.active || liveEar !== ear) return;
    for (; ear.read < rec.chunks.length; ear.read++) { ear.counter.push(rec.chunks[ear.read]); ear.samplesRead += rec.chunks[ear.read].length; }
    const st = ear.counter.state_();
    const dt = st.elapsedMs - ear.lastElapsed; // the time sung: the clock runs while there is sound
    ear.lastElapsed = st.elapsedMs;
    if (dt > 0 && st.pauseMs < 200) ear.activeMs += dt;
    const pos = earPosition(ear, st);
    ear.pos = pos;
    renderEar(ear, st);
    if (ear.done) return;
    // sound again after a pause: a pause at a pāda's end is a breath (measured, for the
    // learner's pace); what the sound begins with says whether it is a restart
    if (ear.prevPause >= 250 && st.pauseMs < ear.prevPause) {
      const resumedAt = ear.samplesRead / sr - st.pauseMs / 1000;
      if (ear.plan && ear.prevPause < 3000 && padaAt(ear.plan, pos).atBoundary) ear.padaPauses.push(ear.prevPause);
      if (ear.fp && ear.prevPause >= 400 && !ear.pending) ear.pending = { at: resumedAt, count: st.count, pos };
    }
    ear.prevPause = st.pauseMs;
    if (ear.pending && ear.samplesRead / sr - ear.pending.at >= TEMPLATE_SEC + 0.15) { const p = ear.pending; ear.pending = null; hearRestart(ear, p).catch(() => {}); }
    const sung = st.elapsedMs - st.pauseMs; // sound heard before the pause, in this sloka
    if (sung < 3000) return;
    const exp = ear.expected;
    const pauseBegan = ear.samplesRead / sr - st.pauseMs / 1000;
    // the sloka is complete when the count is at its end (the counter's tenth allowed) and a
    // pause follows, of the length this learner leaves between slokas; a count well short
    // needs a long pause — longer still when the clock has run far past the teacher's time,
    // which means the learner is stalling or has dropped akṣaras
    const slokaPause = Math.max(500, Math.round(pace.slokaPauseMs * 0.6));
    const overTime = ear.expectedMs > 0 && sung > 1.6 * ear.expectedMs * ear.tempo;
    const complete = exp
      ? (pos >= exp - 2 && st.pauseMs >= slokaPause) || (pos >= exp * (overTime ? 0.35 : 0.5) && st.pauseMs >= 1500) || (pos >= exp * 1.3 && st.pauseMs >= 400)
      : sung >= 4000 && st.pauseMs >= 1500;
    if (!complete) {
      // a long pause inside a pāda (not at a pāda's end) is a stall: marked once per pāda
      if (ear.plan && ear.item && st.pauseMs >= 1200 && pos < exp - 2) {
        const { pada, atBoundary } = padaAt(ear.plan, pos);
        if (!atBoundary && !ear.stalled.has(pada)) { ear.stalled.add(pada); addSlip(ear.item.id, { kind: 'stall', at: Math.round(pauseBegan * 100) / 100, pada, unsure: true, by: 'ear' }); } // the sound comparison will say
      }
      return;
    }
    ear.slokaPauses.push(st.pauseMs);
    const partial = !!(ear.item && exp && pos < exp * 0.5); // less than half: not transcribed, not scored
    if (partial) addSlip(ear.item.id, { kind: 'partial', at: Math.round(pauseBegan * 100) / 100, count: Math.round(pos), expected: exp, by: 'ear' });
    else if (ear.item && exp && pos < exp - 2) addSlip(ear.item.id, { kind: 'dropped', at: Math.round(pauseBegan * 100) / 100, count: Math.round(pos), expected: exp, unsure: true, by: 'ear' }); // the words will say
    else if (exp) {
      // a sloka recited whole teaches the ear this learner: their speed, how their voice
      // counts, and their pace against the teacher's
      const mean = (old, n, v) => (n ? (old * n + v) / (n + 1) : v);
      const secs = ear.activeMs / 1000;
      if (secs > 1) { const v = Math.max(0.5, Math.min(15, exp / secs)); ear.aksPerSec = ear.aksPerSec ? mean(ear.aksPerSec, ear.speedN, v) : v; ear.speedN++; }
      const cr = st.count / exp;
      if (cr >= 0.6 && cr <= 1.6) { ear.countRatio = mean(ear.countRatio, ear.countRatioN, cr); ear.countRatioN++; }
      if (ear.expectedMs > 0) { const r = Math.max(0.5, Math.min(2.5, sung / ear.expectedMs)); ear.tempo = mean(ear.tempo, ear.tempoN, r); ear.tempoN++; }
    }
    const now = slokaTextItems();
    const i = currentTextIndex(now);
    markSegment(now[i], pauseBegan + 0.25, { transcribe: !partial }); // the stretch ends where the pause began
    if (i + 1 < now.length) {
      if (practice.quiz) quizTextIndex = i + 1; else recTextIndex = i + 1;
      renderSlokaTexts();
      begin();
    } else {
      ear.done = true;
      renderEar(ear, st);
    }
  };
  rec.addEventListener('level', ear.listener);
  liveEar = ear;
}
function stopEar() {
  if (liveEar) { liveEar.rec.removeEventListener('level', liveEar.listener); const ear = liveEar; liveEar = null; savePace(ear); }
  $('#practice-rec-count').textContent = '';
  for (const el of $$('#practice-text-body .sloka-line.current')) el.classList.remove('current');
}
// a page turned by hand while the ear listens: the count starts again for the sloka now in view
function earPageTurned() { if (liveEar) liveEar.begin(); }
function renderEar(ear, st) {
  const el = $('#practice-rec-count');
  if (ear.done) { el.textContent = `every sloka heard · tap to stop`; return; }
  if (!ear.expected) { el.textContent = `${st.count} akṣaras`; return; }
  const pos = Math.round(earPosition(ear, st));
  const { pada, padas } = padaAt(ear.plan, pos);
  const where = pada == null || pos >= ear.expected ? '' : pada === 0 ? ' · the speaker line' : ` · pāda ${pada} of ${padas}`;
  el.textContent = `${pos} of ${ear.expected} akṣaras${where}`;
  el.title = `Where you are, by your own speed${ear.aksPerSec ? ` (${ear.aksPerSec.toFixed(1)} akṣaras a second)` : ''} and the syllables heard. Tap a line of the text to say "I am here"; tap here to count this sloka from the top`;
  const cur = pada != null && pos < ear.expected ? lineOfPada(ear.plan, pada) : -1;
  $$('#practice-text-body .sloka-line').forEach((ln, i) => ln.classList.toggle('current', i === cur));
}
// The recorded stretch whose words serve a report's stretch of the take: the best overlap,
// when it covers it well (the page was turned near the sloka's end).
function segmentFor(win) {
  const take = practice.take;
  if (!take || !take.segments || !win) return null;
  let best = null;
  let bestIou = 0;
  for (const seg of take.segments) {
    const inter = Math.max(0, Math.min(seg.to, win[1]) - Math.max(seg.from, win[0]));
    const union = Math.max(seg.to, win[1]) - Math.min(seg.from, win[0]);
    const iou = union > 0 ? inter / union : 0;
    if (iou > bestIou) { bestIou = iou; best = seg; }
  }
  return bestIou >= 0.6 ? best : null;
}
$('#practice-texts-prev').addEventListener('click', () => stepText(-1));
$('#practice-texts-next').addEventListener('click', () => stepText(1));
bindPlayButton($('#practice-texts-play'), basePlayer);
const textTime = () => { $('#practice-text-time').textContent = basePlayer.loaded && basePlayer.duration ? `${fmtTime(basePlayer.currentTime)} / ${fmtTime(basePlayer.duration)}` : ''; };
basePlayer.addEventListener('tick', textTime);
basePlayer.addEventListener('loaded', textTime);
sttLanguageListeners.add(() => renderSlokaTexts()); // the text follows the language

// Opens a quiz: its slokas become the selection, the checklist gives way to the quiz box.
async function enterQuiz(quiz) {
  if (!practice.quiz) practice.selectionBeforeQuiz = practice.selection.slice();
  // a quiz from the old scoring chose content / pronunciation: that choice now means the
  // categories that replaced them, and is saved so the list and the reports agree
  const modern = modernCategories(quiz.categories);
  if (modern.join() !== (quiz.categories || []).join()) { quiz.categories = modern; api.patchQuiz(quiz.id, { categories: modern }).catch(() => {}); }
  practice.quiz = quiz;
  practice.quizAttempt = null;
  hideResults();
  practiceUI.reset();
  $('#practice-playalong').checked = false;
  $('#practice-playalong').disabled = true;
  if (practice.teach) { practice.teach = false; renderModeChrome(); }
  quizTextIndex = 0;
  showView('quiz');
  await refreshPracticeSelect();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function leaveQuiz(restore = true) {
  if (!practice.quiz) return;
  practice.quiz = null;
  practice.quizAttempt = null;
  quizScoring = false;
  hideResults();
  $('#practice-playalong').disabled = !$('#practice-headphones').checked;
  renderQuizBox();
  setHidden($('#practice-base'), !previewShown());
  if (restore) setSelection(practice.selectionBeforeQuiz || savedSelection());
}
$('#quiz-leave').addEventListener('click', () => { leaveQuiz(true); showView('quiz'); });

function renderQuizBox() {
  const q = practice.quiz;
  renderToleranceRow();
  setHidden($('#practice-quiz-box'), !q);
  const n = (libraryCache || []).length;
  setHidden($('#practice-picker'), !!q);
  setHidden($('#practice-list-hint'), !!q || practice.teach || n === 0);
  setHidden($('#teach-hint'), !!q || !practice.teach || n === 0);
  renderModeChrome();
  if (!q) return;
  $('#quiz-box-name').textContent = q.name;
  $('#quiz-box-hint').textContent = quizTextOn
    ? 'Recite these in one recording, in any order, with the text shown below. The recordings stay hidden until you have recorded; then every report opens as usual.'
    : 'Recite these from memory, in one recording and in any order. The slokas stay hidden until you have recorded; then every report opens as usual.';
  const ol = $('#quiz-box-items');
  ol.innerHTML = '';
  const lib = new Set((libraryCache || []).map((r) => r.id));
  for (const it of q.items) {
    const li = document.createElement('li');
    li.textContent = it.name;
    if (it.folder) { const f = document.createElement('span'); f.className = 'muted small'; f.textContent = it.folder; li.appendChild(f); }
    if (!lib.has(it.id)) { li.classList.add('gone'); li.title = 'No longer in the library'; }
    ol.appendChild(li);
  }
  renderSlokaTexts();
}

// Share of a sloka's words heard in the take, over the parts that were compared.
function wordSimilarity(res, baseT, heardT, baseDuration, takeDuration) {
  const d = windowedDiff(res, baseT, heardT, baseDuration, takeDuration);
  return d.ai.length ? { similarity: d.summary.similarity, phonology: d.phonology, corrections: d.corrections } : null;
}

// What the comparison decided on the way to its scores, kept with a quiz attempt so a
// surprising verdict can be looked into: how alike the material was (match contrast), which
// stretches were compared, the tempo, the voice warp and the key offset.
function comparisonDiag(r) {
  if (!isReport(r)) return r && r.error ? { error: r.error } : null;
  const n = (v, d = 3) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(d)) : null);
  return {
    contrast: n(r.match && r.match.contrast),
    located: (r.match && r.match.located) || null,
    matchedBy: r.match && r.match.by ? r.match.by : r.match && r.match.ok ? 'sound' : null,
    matchedBase: r.matched ? r.matched.base.map((t) => n(t, 2)) : null,
    matchedHeard: r.matched ? r.matched.heard.map((t) => n(t, 2)) : null,
    tempoRatio: n(r.tempoRatio),
    voiceWarp: n(r.voiceWarp),
    keyOffset: n(r.keyOffset, 2),
    mode: r.mode || null,
    deviations: Array.isArray(r.deviations) ? r.deviations.length : null,
    contentCoveredPct: r.scores ? n(r.scores.contentCoveredPct, 1) : null,
  };
}

// After the comparisons of a quiz take: transcribe what is needed for the pronunciation
// category, work out every category's correctness, save the attempt, show the card.
async function scoreQuizAttempt() {
  const quiz = practice.quiz;
  const take = practice.take;
  if (!quiz || !take) return;
  const attempt = { at: new Date().toISOString(), saved: false, sttAvailable: false, items: [], byCategory: {}, score: null, error: null, tolerance: tolOff ? null : learnerTolerance(), noTolerance: tolOff, learner: learnerSpeaker(), weights: weights || CATEGORY_WEIGHTS };
  practice.quizAttempt = attempt;
  quizScoring = true;
  updateRecLabel();
  renderQuizScore();
  setEvaluating(true); // until the score and the open sloka's words are in
  const live = () => practice.quiz === quiz && practice.take === take && practice.quizAttempt === attempt;
  const prog = practiceProgress;
  // Stop skips the rest of the listening: the attempt is scored without pronunciation.
  const skip = new AbortController();
  const stop = () => { skip.abort(); stopTakeTranscriptions(); };
  try {
    // For each recited sloka: the words of the stretch of the take it was found in, and the
    // sloka's own words (stored transcripts are reused). Pronunciation is left out of the
    // attempt altogether when the listening fails, and for the slokas not reached when it is
    // stopped.
    let stt = sttSettings.auto; // off in Settings: the words are not heard, the word categories not judged
    const sims = new Map();
    // every sloka that was compared, matched or not: a "not found" that the timbre gave
    // (another microphone than the sloka's) is overturned when the words are there
    const ids = stt ? quiz.items.map((it) => it.id).filter((id) => isReport(practice.results.get(id))) : [];
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k];
      if (!live()) return;
      if (skip.signal.aborted) break;
      let base;
      try { base = await ensureBase(id); } catch { continue; }
      const res = practice.results.get(id);
      if (partialOf(id)) continue; // less than half recited: not transcribed, not scored
      let heardT;
      try {
        prog.show(`Quiz: listening to the words of your recording (${k + 1} of ${ids.length})…`, stop);
        heardT = await transcribeTakePart(heardPartOf(res), false);
        if (!heardT) throw new DOMException('Transcription stopped', 'AbortError');
      } catch (err) {
        if (isStopped(err)) { toast('Pronunciation was not scored for the rest: the listening was stopped.', 'info', 5000); break; }
        stt = false;
        toast(`Pronunciation could not be scored: ${err.message}`, 'error', 7000);
        break;
      }
      if (!live()) return;
      // the sloka's words: the Gītā's, or the typed text; a sloka without words has no word scores
      const ref = referenceWords(base, res);
      if (!ref) continue;
      const words = tokenizeTranscript(ref).length;
      const heard = await hearAgainIfPoor(res, ref, heardT, base.duration, false);
      if (!live()) return;
      heardT = heard.heardT;
      const ws = heard.ws;
      if (ws) {
        sims.set(id, ws);
        practice.wordSims.set(id, ws.similarity);
        if (ws.phonology) practice.phonology.set(id, ws.phonology);
        setWordSlips(id, ws.corrections);
        if (confirmByWords(res, ws.similarity, words) && practice.activeId === id) showActiveReport();
      }
    }
    if (!live()) return;
    attempt.sttAvailable = stt;
    // the scores
    attempt.items = quiz.items.map((it) => {
      const r = practice.results.get(it.id);
      const sc = itemScores(r, { phonology: sims.has(it.id) ? sims.get(it.id).phonology : null, sttAvailable: stt, partial: partialOf(it.id) });
      return { id: it.id, name: it.name, folder: it.folder, ...sc, diag: comparisonDiag(r), slips: slipsOf(it.id) };
    });
    const sum = attemptSummary(attempt.items, quiz.categories, attempt.tolerance, attempt.weights);
    Object.assign(attempt, sum);
    refreshVerdicts();
    // saved with every category, so the chosen categories can change afterwards, and with
    // the tolerance and learner it was judged with
    const saved = await api.addQuizAttempt(quiz.id, {
      at: attempt.at, takeDuration: take.duration, categories: quiz.categories, score: attempt.score, overall: attempt.overall,
      byCategory: attempt.byCategory, counted: attempt.counted, recited: attempt.recited, items: attempt.items, correct: attempt.correct,
      tolerance: attempt.tolerance, noTolerance: attempt.noTolerance, learner: attempt.learner, weights: attempt.weights,
    });
    if (!live()) return;
    quiz.attempts = saved.attempts;
    attempt.saved = true;
    toast(`Quiz attempt ${quiz.attempts.length} saved.`, 'success');
    refreshProgress(`quiz:${quiz.id}:${quiz.attempts.length}`);
    if (Array.isArray(saved.awards) && saved.awards.length) showBadgeCard(saved.awards, quiz);
    // the take itself is kept with the quiz, so a scoring can be looked into afterwards
    api.putQuizAttemptAudio(quiz.id, quiz.attempts.length, take.blob).catch((err) => console.warn(`The attempt's recording could not be kept: ${err.message}`));
  } catch (err) {
    if (live()) { attempt.error = err.message; toast(`The quiz attempt could not be saved: ${err.message}`, 'error', 8000); }
  } finally {
    if (live() || practice.quizAttempt === null) { quizScoring = false; prog.hide(); updateRecLabel(); }
    if (live()) { renderQuizScore(); settleEvaluating(); }
  }
}

function renderQuizScore() {
  const quiz = practice.quiz;
  const a = practice.quizAttempt;
  const card = $('#quiz-score');
  if (!quiz || !a) { setHidden(card, true); return; }
  setHidden(card, evaluating); // Evaluating… stands in for it until the score is in
  $('#quiz-score-name').textContent = quiz.name;
  const status = $('#quiz-score-status');
  const tol = attemptTolerance(a);
  status.textContent = a.error ? `Not saved: ${a.error}` : !a.saved ? 'Scoring…' : `Attempt ${quiz.attempts.length} · saved ${fmtDate(a.at)}${a.sttAvailable ? '' : sttSettings.auto ? ' · pronunciation not available' : ' · the words not heard (off in Settings): phonemes, vowel length and syllables not judged'}`;
  const corr = a.saved || a.error ? correctness(a.items, quiz.categories, tol) : null;
  const pct = corr ? corr.pct : null;
  const tolText = (c) => (tol ? `tolerance ${tol[c]} %` : 'no tolerance');
  const overall = corr ? attemptOverall(a.items, quiz.categories, weightsOf(a)) : null;
  $('#quiz-ring').style.setProperty('--pct', String(overall == null ? 0 : overall));
  $('#quiz-overall').textContent = overall == null ? '–' : String(overall);
  const quizSlips = a.items.flatMap((it) => (Array.isArray(it.slips) ? it.slips : []));
  setGrade($('#quiz-grade'), gradeWithSlips(overall, quizSlips), $('#quiz-words'), { seed: `${quiz.id}:${quiz.attempts ? quiz.attempts.length : 0}`, slips: quizSlips, score: overall, best: practice.progress && practice.progress.quizzes && practice.progress.quizzes[quiz.id] ? practice.progress.quizzes[quiz.id].best : null });
  const penalised = a.items.filter((it) => selfCorrections(it.slips).length);
  const qpen = $('#quiz-penalty');
  qpen.textContent = penalised.length ? `${Math.round(SLIP_PENALTY * 100)} % off for self-correction in ${penalised.length === 1 ? penalised[0].name : `${penalised.length} slokas`}: ${penalised.map((it) => `${penalised.length > 1 ? `${it.name} ` : ''}${slipsLabel(selfCorrections(it.slips))}`).join(' · ')}` : '';
  setHidden(qpen, !qpen.textContent);
  const n = a.items.length;
  $('#quiz-overall-sub').textContent = !corr ? 'Scoring…' : `${n} sloka${n === 1 ? '' : 's'} · ${a.recited ?? 0} recited · weighted on ${quiz.categories.map((c) => catLabel(c).toLowerCase()).join(', ')}`;
  const vEl = $('#quiz-verdict');
  vEl.textContent = !corr ? '' : !tol ? 'Judged without a tolerance' : pct == null ? '' : `${corr.correct} of ${corr.counted} correct · ${pct}%`;
  vEl.className = `score-verdict${corr && tol && pct != null ? (pct === 100 ? ' ok' : pct === 0 ? ' bad' : '') : ''}`;
  // category chips with each category's share within tolerance
  const chips = $('#quiz-cats');
  chips.innerHTML = '';
  for (const c of QUIZ_CATEGORIES) {
    const on = quiz.categories.includes(c.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip${on ? ' active' : ''}`;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = c.hint;
    const pr = corr && corr.passRate ? corr.passRate[c.id] : null;
    b.innerHTML = `<span></span><span class="val"></span>`;
    b.firstChild.textContent = c.label;
    b.lastChild.textContent = pr ? `${pr.ok}/${pr.n}` : (a.saved && tol ? 'n/a' : '');
    b.title = `${c.hint} · ${tolText(c.id)}`;
    b.addEventListener('click', async () => {
      const next = on ? quiz.categories.filter((x) => x !== c.id) : [...quiz.categories, c.id];
      if (!next.length) return; // keep at least one
      quiz.categories = normalizeCategories(next);
      renderQuizScore();
      renderQuizList();
      try { await api.patchQuiz(quiz.id, { categories: quiz.categories }); } catch (err) { toast(err.message, 'error'); }
    });
    chips.appendChild(b);
  }
  // per-sloka table
  const table = $('#quiz-table');
  table.innerHTML = '';
  const cats = columnsFor(a.items);
  const aw = weightsOf(a);
  const head = document.createElement('tr');
  // the Correct column exists only when there is a tolerance to be correct against
  head.innerHTML = '<th>Sloka</th><th>Recited</th>' + cats.map((c) => `<th title="${tolText(c.id)} · weight ${aw[c.id]}">${c.label}</th>`).join('') + `<th title="Weighted over the chosen categories">Overall</th>${tol ? '<th>Correct</th>' : ''}`;
  table.appendChild(head);
  const gradeCell = (o, slips = null) => { const g = gradeWithSlips(o, slips); return o == null ? '–' : `${o} <span class="rr-grade ${g.id}" title="${slips && slips.length ? slipsLabel(slips) : ''}">${gradeText(g)}</span>` + (slips && slips.length ? ` <span class="muted small">· ${slipsLabel(slips)}</span>` : ''); };
  for (const it of a.items) {
    const tr = document.createElement('tr');
    const openable = practice.results.has(it.id) && isReport(practice.results.get(it.id));
    tr.className = `${it.missing ? 'missing' : it.matched ? '' : 'unmatched'}${it.id === practice.activeId ? ' active' : ''}${openable ? ' openable' : ''}`;
    if (openable) { tr.title = 'Open this sloka\'s words and analysis'; tr.addEventListener('click', () => { if (it.id !== practice.activeId) setActiveBase(it.id); }); }
    const d = it.diag || {};
    const recited = it.missing ? 'not compared' : it.matched ? 'yes' : `not found${d.contrast != null ? ` <span class="muted small" title="How alike the material was: the match cost against the sloka divided by the cost against it played backwards; below 0.87 counts as the same material">· contrast ${d.contrast.toFixed(2)}</span>` : ''}`;
    const cells = [`<td></td>`, `<td>${recited}</td>`];
    for (const c of cats) {
      const v = it[c.id];
      const on = quiz.categories.includes(c.id);
      const w = tol ? withinTolerance(v, tol[c.id]) : null;
      const mark = w == null ? '' : `<span class="mark ${w ? 'ok' : 'bad'}" title="${w ? 'within' : 'outside'} ${tol[c.id]} %">${w ? '✓' : '✗'}</span>`;
      cells.push(`<td class="${on ? 'on' : 'off'}">${v == null ? '–' : v}${on ? mark : ''}</td>`);
    }
    cells.push(`<td class="on">${it.missing ? '–' : gradeCell(itemOverall(it, quiz.categories, aw), it.slips)}</td>`);
    if (tol) {
      const v = itemVerdict(it, quiz.categories, tol);
      cells.push(`<td class="on">${v.ok === null ? '–' : v.ok ? 'yes' : 'no'}</td>`);
    }
    tr.innerHTML = cells.join('');
    tr.firstChild.textContent = it.folder ? `${it.name} · ${it.folder}` : it.name;
    tr.firstChild.title = it.missing ? 'This sloka could not be compared (missing from the library, or the comparison failed)' : '';
    table.appendChild(tr);
  }
  if (a.saved || a.error) {
    if (tol) {
      const tr = document.createElement('tr');
      tr.className = 'total';
      tr.innerHTML = `<td>Within tolerance</td><td>${a.recited} of ${a.counted}</td>` + cats.map((c) => { const pr = corr.passRate[c.id]; return `<td class="${quiz.categories.includes(c.id) ? 'on' : 'off'}">${pr ? `${pr.ok}/${pr.n}` : '–'}</td>`; }).join('') + `<td class="on">${gradeCell(overall, quizSlips)}</td><td class="on">${pct == null ? '–' : `${corr.correct} of ${corr.counted} · ${pct}%`}</td>`;
      table.appendChild(tr);
    }
    const avg = document.createElement('tr');
    avg.className = 'total';
    avg.innerHTML = `<td>Average score</td><td>${tol ? '' : `${a.recited} of ${a.counted}`}</td>` + cats.map((c) => `<td class="${quiz.categories.includes(c.id) ? 'on' : 'off'}">${a.byCategory[c.id] == null ? '–' : a.byCategory[c.id]}</td>`).join('') + `<td class="on">${tol ? '' : gradeCell(overall, quizSlips)}</td>${tol ? '<td></td>' : ''}`;
    table.appendChild(avg);
  }
  const nAtt = quiz.attempts ? quiz.attempts.length : 0;
  setHidden($('#quiz-trend-fold'), !nAtt);
  $('#quiz-trend-sub').textContent = nAtt > 1 ? `${nAtt} attempts, per category` : 'retake the quiz and every attempt is drawn here';
  if (nAtt) renderTrend($('#quiz-trend'), quiz);
}

// Score per category over the attempts of a quiz: an SVG line chart and a table.
const TREND_SERIES = [
  { id: 'overall', label: 'Correct', color: 'var(--accent)', width: 3 },
  { id: 'weighted', label: 'Overall score', color: 'var(--text)', width: 2.2 },
  { id: 'phoneme', label: 'Phonemes', color: 'var(--content)', width: 1.6 },
  { id: 'vowel', label: 'Vowel length', color: 'var(--heard)', width: 1.6 },
  { id: 'syllable', label: 'Syllables', color: 'var(--missing)', width: 1.6 },
  { id: 'emphasis', label: 'Emphasis', color: 'var(--dynamics)', width: 1.6 },
  { id: 'pitch', label: 'Pitch contour', color: 'var(--pitch)', width: 1.6 },
  { id: 'phrasing', label: 'Phrasing', color: 'var(--muted)', width: 1.6 },
  { id: 'timing', label: 'Timing', color: 'var(--timing)', width: 1.6 },
];
function renderTrend(host, quiz) {
  const attempts = (quiz.attempts || []).slice().sort((x, y) => String(x.at).localeCompare(String(y.at)));
  host.innerHTML = '';
  if (!attempts.length) return;
  const hasItems = (a) => Array.isArray(a.items) && a.items.length;
  const attemptScore = (a) => (hasItems(a) ? correctness(a.items, quiz.categories, attemptTolerance(a)).pct : a.score == null ? null : a.score);
  const weightedOf = (a) => (hasItems(a) ? attemptOverall(a.items, quiz.categories, weightsOf(a)) : a.overall == null ? null : a.overall);
  const valueOf = (a, id) => (id === 'overall' ? attemptScore(a) : id === 'weighted' ? weightedOf(a) : a.byCategory ? a.byCategory[id] : null);
  const h4 = document.createElement('h4');
  h4.textContent = attempts.length > 1 ? `Trend over ${attempts.length} attempts` : 'Trend';
  host.appendChild(h4);
  if (attempts.length < 2) {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = 'Retake this quiz and every attempt is drawn here, per category.';
    host.appendChild(p);
  }
  const W = 640;
  const H = 220;
  const L = 34;
  const R = 12;
  const T = 12;
  const B = 28;
  const n = attempts.length;
  const xOf = (i) => (n === 1 ? L + (W - L - R) / 2 : L + ((W - L - R) * i) / (n - 1));
  const yOf = (v) => T + ((100 - v) / 100) * (H - T - B);
  let svg = `<svg class="trend-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score trend">`;
  for (const g of [0, 25, 50, 75, 100]) {
    svg += `<line x1="${L}" x2="${W - R}" y1="${yOf(g)}" y2="${yOf(g)}" stroke="var(--chart-grid)" stroke-width="1"/>`;
    svg += `<text x="${L - 6}" y="${yOf(g) + 4}" font-size="10" text-anchor="end" fill="var(--chart-text)">${g}</text>`;
  }
  attempts.forEach((a, i) => {
    svg += `<text x="${xOf(i)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="var(--chart-text)">${i + 1}</text>`;
  });
  for (const sr of TREND_SERIES.slice().reverse()) {
    const pts = attempts.map((a, i) => [xOf(i), valueOf(a, sr.id)]).filter(([, v]) => v != null);
    if (!pts.length) continue;
    if (pts.length > 1) svg += `<polyline fill="none" stroke="${sr.color}" stroke-width="${sr.width}" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(([x, v]) => `${x},${yOf(v)}`).join(' ')}"/>`;
    for (const [x, v] of pts) svg += `<circle cx="${x}" cy="${yOf(v)}" r="${sr.id === 'overall' ? 4 : 2.5}" fill="${sr.color}"><title>${sr.label}: ${v}</title></circle>`;
  }
  svg += '</svg>';
  const wrap = document.createElement('div');
  wrap.innerHTML = svg;
  host.appendChild(wrap.firstChild);
  const legend = document.createElement('div');
  legend.className = 'trend-legend';
  legend.innerHTML = TREND_SERIES.map((sr) => `<span><i class="sw ${sr.id}"></i>${sr.label}${sr.id === 'overall' ? ' (% of slokas within tolerance in the chosen categories)' : sr.id === 'weighted' ? ' (weighted over the chosen categories)' : ' (average score)'}</span>`).join('');
  host.appendChild(legend);
  const wrapT = document.createElement('div');
  wrapT.className = 'quiz-table-wrap';
  const table = document.createElement('table');
  table.className = 'quiz-table';
  const tcols = columnsFor(attempts.flatMap((a) => a.items || []));
  table.innerHTML = '<tr><th>#</th><th>When</th><th>Recited</th>' + tcols.map((c) => `<th>${c.label}</th>`).join('') + '<th>Overall</th><th>Correct</th><th></th></tr>';
  attempts.forEach((a, i) => {
    const tr = document.createElement('tr');
    const sc = valueOf(a, 'overall');
    const wt = valueOf(a, 'weighted');
    const g = gradeOf(wt);
    tr.innerHTML = `<td>${i + 1}</td><td></td><td>${a.recited ?? '–'} of ${a.counted ?? '–'}</td>` + tcols.map((c) => `<td class="${quiz.categories.includes(c.id) ? 'on' : 'off'}">${a.byCategory && a.byCategory[c.id] != null ? a.byCategory[c.id] : '–'}</td>`).join('') + `<td class="on">${wt == null ? '–' : `${wt} <span class="rr-grade ${g.id}">${g.label}</span>`}</td><td class="on">${sc == null ? '–' : `${sc}%`}</td><td></td>`;
    tr.children[1].textContent = fmtDate(a.at);
    // the kept recording of the attempt, played in place
    if (a.audio) {
      const n = (quiz.attempts || []).indexOf(a) + 1;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm btn-ghost';
      btn.textContent = 'Listen';
      btn.title = 'The recording of this attempt';
      btn.addEventListener('click', () => {
        const old = $('audio', tr.lastChild);
        if (old) { old.remove(); return; }
        const au = document.createElement('audio');
        au.controls = true;
        au.src = api.quizAttemptAudioUrl(quiz.id, n);
        au.style.display = 'block';
        au.style.marginTop = '4px';
        tr.lastChild.appendChild(au);
        au.play().catch(() => {});
      });
      tr.lastChild.appendChild(btn);
    }
    table.appendChild(tr);
  });
  wrapT.appendChild(table);
  host.appendChild(wrapT);
}

// ---------- the Quiz view: set one up, and the saved ones ----------

// ======================================================================
// REPORTS — past quiz attempts and evaluation sessions, by date or by folder
// ======================================================================

const REPORTS_KEY = 'tutor-reports';
const reports = (() => {
  const d = { mode: 'date', period: 'week', date: isoDate(), folder: '', group: false };
  try { return { ...d, ...JSON.parse(localStorage.getItem(REPORTS_KEY) || '{}'), selected: null }; } catch { return { ...d, selected: null }; }
})();
const saveReports = () => { try { const { selected, ...rest } = reports; localStorage.setItem(REPORTS_KEY, JSON.stringify(rest)); } catch { /* ignore */ } };
let assessmentsCache = null;

const catCols = QUIZ_CATEGORIES;
const scoreCell = (v, on = true) => `<td class="${on ? 'on' : 'off'}">${v == null ? '–' : v}</td>`;
const gradeHtml = (overall, grade = null) => { const g = (typeof grade === 'string' ? gradeById(grade) : grade) || gradeOf(overall); return overall == null || !g ? '–' : `${overall} <span class="rr-grade ${g.id}">${gradeText(g)}</span>`; };
const fmtWhen = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtWhenShort = (iso) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
// "CH-12-1008" for "CH-12-1008 · 2026-10-08 06:58": the date is shown beside it anyway
const quizShortName = (name) => String(name || '').split(' · ')[0];

async function refreshReports() {
  try { assessmentsCache = await api.listAssessments(); } catch (err) { assessmentsCache = assessmentsCache || []; toast(err.message, 'error'); }
  await getFolders(true);
  renderReports();
}

function reportsRange() { return periodRange(reports.period, reports.date); }
function reportsInPeriod() {
  const range = reportsRange();
  return (assessmentsCache || []).filter((a) => inRange(a.at, range));
}

function renderReports() {
  // controls
  $$('#reports-mode .chip').forEach((b) => { const on = b.dataset.mode === reports.mode; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  $$('#reports-period .chip').forEach((b) => { const on = b.dataset.period === reports.period; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  $('#reports-date').value = reports.date;
  setHidden($('#reports-nav'), reports.period === 'all');
  setHidden($('#reports-folder-field'), reports.mode !== 'folder');
  const folderSel = $('#reports-folder');
  const folders = visibleFolders(foldersCache || []).map((f) => f.path).filter(Boolean);
  fillSelect(folderSel, [{ value: '', label: 'All folders' }, ...folders.map((f) => ({ value: f, label: f }))], reports.folder);
  if (folderSel.value !== reports.folder) { reports.folder = folderSel.value; saveReports(); }
  $('#reports-group').checked = !!reports.group;
  // what the period holds
  const range = reportsRange();
  const inPeriod = reportsInPeriod();
  const shown = reports.mode === 'folder' && reports.folder ? inPeriod.filter((a) => a.folders.some((f) => f === reports.folder || f.startsWith(`${reports.folder}/`))) : inPeriod;
  const strip = $('#reports-progress');
  const pr = progress(assessmentsCache || [], { profileId: learnerId || null });
  const pbits = [];
  if (pr.streak.days >= 2) pbits.push(`🔥 ${pr.streak.days} days in a row`);
  if (pr.streak.weeks >= 1) pbits.push(`🗓️ ${pr.streak.weeks} week${pr.streak.weeks === 1 ? '' : 's'} of steady practice`);
  for (const m of pr.all || []) if (!['dayStreak', 'weekStreak'].includes(m.kind) && pbits.length < 5) pbits.push(`${m.emoji} ${m.text}`);
  if (!pbits.length && pr.plateau) pbits.push(`${pr.plateau.emoji} ${pr.plateau.text}`);
  const nb = learnerBadges().length;
  if (nb) pbits.push(`🏅 ${nb} badge${nb === 1 ? '' : 's'}`);
  strip.innerHTML = '';
  if (pbits.length) { const lead = document.createElement('span'); lead.className = 'lead'; lead.textContent = learnerName() ? `${learnerName()}'s progress` : 'Progress'; strip.appendChild(lead); }
  for (const b of pbits) { const sp = document.createElement('span'); sp.textContent = b; strip.appendChild(sp); }
  setHidden(strip, !pbits.length || !gradeWordsOn);
  const sum = summarize(shown);
  const summary = $('#reports-summary');
  summary.innerHTML = '';
  const bits = [[range.label, 'range'], [`<b>${sum.count}</b> session${sum.count === 1 ? '' : 's'} · ${sum.quizzes} quiz${sum.quizzes === 1 ? '' : 'zes'}, ${sum.evaluations} evaluation${sum.evaluations === 1 ? '' : 's'}`], [`<b>${sum.slokas}</b> sloka${sum.slokas === 1 ? '' : 's'} assessed`]];
  if (sum.mean != null) bits.push([`average overall <b>${sum.mean}</b> · best <b>${sum.best}</b> ${(gradeOf(sum.best) || {}).label || ''}`]);
  for (const [html, cls] of bits) { const s = document.createElement('span'); if (cls) s.className = cls; s.innerHTML = html; summary.appendChild(s); }
  setHidden($('#reports-by-date'), reports.mode !== 'date');
  setHidden($('#reports-by-folder'), reports.mode !== 'folder');
  if (reports.mode === 'date') renderReportsList(inPeriod);
  else renderReportsFolder(shown);
}

function renderReportsList(list) {
  const ul = $('#reports-list');
  ul.innerHTML = '';
  setHidden($('#reports-empty'), list.length > 0);
  if (reports.selected && !list.some((a) => a.key === reports.selected)) reports.selected = null;
  for (const a of list) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `session-row${a.key === reports.selected ? ' active' : ''}`;
    row.innerHTML = '<span class="sr-when"></span><span class="sr-name"><span class="kind"></span><span class="label"></span></span><span class="sr-count"></span><span class="sr-score mono"><span></span><span class="rr-grade"></span></span>';
    $('.sr-when', row).textContent = fmtWhen(a.at);
    const kind = $('.kind', row);
    kind.textContent = KIND_LABEL[a.kind] || a.kind;
    kind.classList.toggle('quiz', a.kind === 'quiz');
    $('.label', row).textContent = a.kind === 'quiz' ? a.name : (a.items || []).map((it) => it.name).slice(0, 4).join(', ') + ((a.items || []).length > 4 ? '…' : '');
    $('.sr-count', row).textContent = `${a.recited ?? 0} of ${a.counted ?? (a.items || []).length} recited${a.kind === 'quiz' && a.correct != null ? ` · ${a.correct}% correct` : ''}`;
    const g = gradeById(a.grade) || gradeOf(a.overall);
    $('.sr-score > span:first-child', row).textContent = a.overall == null ? '–' : String(a.overall);
    if (g) { $('.rr-grade', row).textContent = gradeText(g); $('.rr-grade', row).classList.add(g.id); }
    row.addEventListener('click', () => { reports.selected = reports.selected === a.key ? null : a.key; renderReports(); });
    ul.appendChild(row);
  }
  renderReportsDetail(list.find((a) => a.key === reports.selected) || null);
}

function renderReportsDetail(a) {
  const box = $('#reports-detail');
  $('#reports-detail-audio').innerHTML = '';
  if (!a) { setHidden(box, true); return; }
  setHidden(box, false);
  $('#reports-detail-title').textContent = a.kind === 'quiz' ? `Quiz · ${a.name} · attempt ${a.attempt}` : `${KIND_LABEL[a.kind]} · ${fmtWhen(a.at)}`;
  const subs = [fmtWhen(a.at)];
  if (a.takeDuration) subs.push(`${fmtTime(a.takeDuration)} recording`);
  if (a.kind === 'quiz') subs.push(`scored on ${a.categories.map(catLabel).join(' + ')}`);
  $('#reports-detail-sub').textContent = subs.join(' · ');
  const listen = $('#reports-detail-listen');
  setHidden(listen, !a.audio);
  listen.onclick = () => {
    const host = $('#reports-detail-audio');
    if (host.firstChild) { host.innerHTML = ''; return; }
    const au = document.createElement('audio');
    au.controls = true;
    au.src = a.kind === 'quiz' ? api.quizAttemptAudioUrl(a.quizId, a.attempt) : api.sessionAudioUrl(a.sessionId);
    host.appendChild(au);
    au.play().catch(() => {});
  };
  const table = $('#reports-detail-table');
  table.innerHTML = '';
  const cols = columnsFor(a.items);
  const aw = weightsOf(a);
  const head = document.createElement('tr');
  // a quiz judged with tolerances off has no Correct column
  const judged = a.kind === 'quiz' && !!a.tolerance;
  head.innerHTML = '<th>Sloka</th><th>Recited</th>' + cols.map((c) => `<th title="${a.tolerance ? `tolerance ${a.tolerance[c.id] ?? '–'} %` : 'no tolerance'} · weight ${aw[c.id]}">${c.label}</th>`).join('') + `<th>Overall</th>${judged ? '<th>Correct</th>' : ''}`;
  table.appendChild(head);
  for (const it of a.items || []) {
    const tr = document.createElement('tr');
    tr.className = it.missing ? 'missing' : it.matched ? '' : 'unmatched';
    const d = it.diag || {};
    const recited = it.missing ? 'not compared' : it.matched ? 'yes' : `not found${d.contrast != null ? ` <span class="muted small">· contrast ${Number(d.contrast).toFixed(2)}</span>` : ''}`;
    const cells = ['<td class="sloka-cell"></td>', `<td>${recited}</td>`];
    for (const c of cols) cells.push(scoreCell(it[c.id], a.categories.includes(c.id)));
    cells.push(`<td class="on">${it.missing ? '–' : gradeHtml(it.overall, it.grade)}${Array.isArray(it.slips) && it.slips.length ? ` <span class="muted small">· ${slipsLabel(it.slips)}</span>` : ''}</td>`);
    if (judged) { const v = itemVerdict(it, a.categories, a.tolerance); cells.push(`<td class="on">${v.ok === null ? '–' : v.ok ? 'yes' : 'no'}</td>`); }
    tr.innerHTML = cells.join('');
    tr.firstChild.textContent = it.folder ? `${it.name} · ${it.folder}` : it.name;
    table.appendChild(tr);
  }
  const tot = document.createElement('tr');
  tot.className = 'total';
  // a quiz averages every sloka (one not recited counts 0); an evaluation only those recited
  const counted = (a.items || []).filter((it) => !it.missing && (a.kind === 'quiz' || it.matched));
  const avg = (c) => { const vs = counted.filter((it) => it[c] != null).map((it) => it[c]); return vs.length ? Math.round(vs.reduce((x, y) => x + y, 0) / vs.length) : null; };
  tot.innerHTML = `<td>${a.kind === 'quiz' ? 'Overall' : 'Overall · recited slokas'}</td><td>${a.recited ?? 0} of ${a.counted ?? 0}</td>` + cols.map((c) => scoreCell(avg(c.id), a.categories.includes(c.id))).join('') + `<td class="on">${gradeHtml(a.overall, a.grade)}</td>${judged ? `<td class="on">${a.correct == null ? '–' : `${a.correct}%`}</td>` : ''}`;
  table.appendChild(tot);
}

// By folder: one line per sloka per assessment — the sloka, every category, the overall.
function renderReportsFolder(list) {
  const rows = slokaRows(list, { folder: reports.folder || null });
  const table = $('#reports-folder-table');
  table.innerHTML = '';
  setHidden($('#reports-folder-empty'), rows.length > 0);
  setHidden(table.parentElement, rows.length === 0);
  if (!rows.length) return;
  const grouped = !!reports.group; // grouped: the sloka is the group heading, not a column
  const head = document.createElement('tr');
  head.innerHTML = `<th>When</th>${grouped ? '' : '<th>Sloka</th>'}<th>In</th>` + catCols.map((c) => `<th>${c.label}</th>`).join('') + '<th>Overall</th>';
  table.appendChild(head);
  const ordered = grouped ? rows.slice().sort((x, y) => x.sloka.localeCompare(y.sloka) || String(y.at).localeCompare(String(x.at))) : rows;
  let lastSloka = null;
  for (const r of ordered) {
    if (grouped && r.sloka !== lastSloka) {
      lastSloka = r.sloka;
      const mine = ordered.filter((x) => x.slokaId === r.slokaId && x.overall != null);
      const best = mine.length ? Math.max(...mine.map((x) => x.overall)) : null;
      const gh = document.createElement('tr');
      gh.className = 'group-head';
      gh.innerHTML = `<td colspan="${2 + catCols.length + 1}"></td>`;
      gh.firstChild.textContent = `${r.sloka}${r.folder ? ` · ${r.folder}` : ''} — ${mine.length} assessment${mine.length === 1 ? '' : 's'}${best != null ? `, best ${best} ${(gradeOf(best) || {}).label || ''}` : ''}`;
      table.appendChild(gh);
    }
    const tr = document.createElement('tr');
    tr.className = r.missing ? 'missing' : r.matched ? '' : 'unmatched';
    tr.innerHTML = `<td></td>${grouped ? '' : '<td class="sloka-cell"></td>'}<td class="sloka-cell"></td>` + catCols.map((c) => scoreCell(r[c.id])).join('') + `<td class="on">${r.missing ? '–' : gradeHtml(r.overall, r.grade)}${r.slips && r.slips.length ? ` <span class="muted small">· ${slipsLabel(r.slips)}</span>` : ''}</td>`;
    tr.children[0].textContent = fmtWhenShort(r.at);
    if (!grouped) tr.children[1].textContent = `${r.sloka}${r.folder && !reports.folder ? ` · ${r.folder}` : ''}`;
    const inCell = tr.children[grouped ? 1 : 2];
    inCell.textContent = r.kind === 'quiz' ? `Quiz · ${quizShortName(r.name)}` : KIND_LABEL[r.kind];
    if (r.kind === 'quiz') inCell.title = r.name;
    tr.title = r.matched ? '' : r.missing ? 'Not compared' : 'Not found in the recording';
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => { reports.mode = 'date'; reports.selected = r.assessment; reports.period = 'all'; saveReports(); renderReports(); $('#reports-detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    table.appendChild(tr);
  }
}

$$('#reports-mode .chip').forEach((b) => b.addEventListener('click', () => { reports.mode = b.dataset.mode; saveReports(); renderReports(); }));
$$('#reports-period .chip').forEach((b) => b.addEventListener('click', () => { reports.period = b.dataset.period; saveReports(); renderReports(); }));
$('#reports-prev').addEventListener('click', () => { reports.date = shiftPeriod(reports.period, reports.date, -1); saveReports(); renderReports(); });
$('#reports-next').addEventListener('click', () => { reports.date = shiftPeriod(reports.period, reports.date, 1); saveReports(); renderReports(); });
$('#reports-today').addEventListener('click', () => { reports.date = isoDate(); saveReports(); renderReports(); });
$('#reports-date').addEventListener('change', (e) => { if (e.target.value) { reports.date = e.target.value; saveReports(); renderReports(); } });
$('#reports-folder').addEventListener('change', (e) => { reports.folder = e.target.value; saveReports(); renderReports(); });
$('#reports-group').addEventListener('change', (e) => { reports.group = e.target.checked; saveReports(); renderReports(); });
$('#reports-detail-close').addEventListener('click', () => { reports.selected = null; renderReports(); });

const QUIZ_SETUP_KEY = 'tutor-quiz-setup';
let quizListCache = [];
let quizPicks = []; // ids of the slokas chosen for the next quiz, in the order they were ticked

function quizSetup() {
  const mode = ($('input[name="quiz-mode"]:checked') || {}).value === 'single' ? 'single' : 'multiple';
  const max = Math.max(2, Math.min(MAX_SLOKAS_PER_TAKE, Math.round(Number($('#quiz-max').value) || 10)));
  return { mode, max };
}
function saveQuizSetup() { try { localStorage.setItem(QUIZ_SETUP_KEY, JSON.stringify(quizSetup())); } catch { /* ignore */ } }

// The whole library, in folder order; "Pick at random" draws from the folders open in the
// picker (all of them when none is open).
function quizCandidates() {
  return (libraryCache || []).slice().sort((x, y) => (x.folder || '').localeCompare(y.folder || '') || x.name.localeCompare(y.name));
}
const quizPicker = createSlokaPicker($('#quiz-picker'), {
  mode: 'multi',
  max: MAX_SLOKAS_PER_TAKE,
  openKey: 'tutor-quiz-picker-open',
  pickLabel: 'Include',
  onChange: (ids) => { quizPicks = ids; renderQuizSlokas(); },
});

async function refreshQuizView() {
  const lib = await getLibrary(true);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(QUIZ_SETUP_KEY) || 'null'); } catch { saved = null; }
  if (saved) {
    const modeEl = $(`input[name="quiz-mode"][value="${saved.mode === 'single' ? 'single' : 'multiple'}"]`);
    if (modeEl) modeEl.checked = true;
    if (saved.max) $('#quiz-max').value = String(Math.max(2, saved.max));
  }
  setHidden($('#quiz-empty'), lib.length > 0);
  setHidden($('#quiz-setup'), lib.length === 0);
  setHidden($('#quiz-choose'), lib.length === 0);
  quizPicker.setRecords(lib);
  renderQuizSlokas();
  try { quizListCache = await api.listQuizzes(); } catch (err) { quizListCache = []; toast(err.message, 'error'); }
  renderQuizList();
}
$$('input[name="quiz-mode"]').forEach((r) => r.addEventListener('change', () => { saveQuizSetup(); renderQuizSlokas(); }));
$('#quiz-max').addEventListener('change', () => { $('#quiz-max').value = String(quizSetup().max); saveQuizSetup(); renderQuizSlokas(); });

// The rules of the choice: one in single mode, two to `max` in multiple mode (boxes lock once
// the maximum is reached), Start only when the rule is met.
function renderQuizSlokas() {
  const { mode, max } = quizSetup();
  const allowed = new Set(quizCandidates().map((r) => r.id));
  quizPicks = quizPicks.filter((id) => allowed.has(id));
  if (mode === 'single') quizPicks = quizPicks.slice(0, 1);
  else quizPicks = quizPicks.slice(0, max);
  quizPicker.setMode(mode === 'single' ? 'single' : 'multi', mode === 'single' ? null : max);
  quizPicker.setSelection(quizPicks);
  const n = quizPicks.length;
  const full = mode === 'multiple' && n >= max;
  const ready = mode === 'single' ? n === 1 : n >= 2;
  $('#quiz-start').disabled = !ready;
  $('#quiz-random').disabled = !allowed.size;
  const openNames = quizPicker.openFolders.filter((f) => (libraryCache || []).some((r) => (r.folder || '') === f));
  $('#quiz-random').textContent = mode === 'single' ? 'Pick one at random' : `Pick ${max} at random`;
  $('#quiz-random').title = openNames.length ? `From the open folder${openNames.length === 1 ? '' : 's'}: ${openNames.map(folderLabel).join(', ')}` : 'From the whole library, spread across its folders (open folders to draw from those alone)';
  $('#quiz-choose-hint').textContent = !allowed.size ? 'No slokas in the library yet.'
    : mode === 'single' ? 'Open a folder and choose one sloka, then start the quiz.'
      : full ? `Maximum reached (${max}). Untick one to swap, or raise the maximum above.`
        : n < 2 ? `Open folders and tick at least two slokas (up to ${max}), or let "Pick at random" choose; it draws from the open folders.` : `Pick up to ${max}.`;
}
$('#quiz-random').addEventListener('click', () => {
  const { mode, max } = quizSetup();
  const open = new Set(quizPicker.openFolders);
  let pool = quizCandidates().filter((r) => open.has(r.folder || ''));
  if (!pool.length) pool = quizCandidates();
  quizPicks = pickBaselines(pool, mode === 'single' ? 1 : max).map((r) => r.id);
  renderQuizSlokas();
});

$('#quiz-start').addEventListener('click', async () => {
  const { mode, max } = quizSetup();
  const chosen = quizCandidates().filter((r) => quizPicks.includes(r.id));
  if (!chosen.length || (mode === 'multiple' && chosen.length < 2)) return;
  const items = chosen.map((r) => ({ id: r.id, name: r.name, folder: r.folder || '' }));
  const folders = [...new Set(items.map((it) => it.folder))];
  const suggestion = folders.map((f) => folderLabel(f)).join(', ');
  const friendly = await askDialog({ title: 'Name this quiz', message: 'The date and time are added to the name to keep it unique.', label: 'Friendly name', value: suggestion, okText: 'Start' });
  if (!friendly) return;
  const name = `${friendly} · ${fmtStamp()}`;
  let quiz;
  try {
    quiz = await api.createQuiz({ name, folders, mode, maxFiles: mode === 'single' ? 1 : max, items, categories: DEFAULT_QUIZ_CATEGORIES });
  } catch (err) { toast(err.message, 'error', 6000); return; }
  quizPicks = [];
  await enterQuiz(quiz);
});

function renderQuizList() {
  if (!badgesCache) getBadges().then(() => renderQuizList()); // the marks, once the badges are known
  const ul = $('#quiz-list');
  ul.innerHTML = '';
  setHidden($('#quiz-none'), quizListCache.length > 0);
  for (const q of quizListCache) {
    const li = document.createElement('li');
    li.className = 'quiz-item';
    li.dataset.id = q.id;
    const lastScore = q.last ? q.last.score : null;
    li.innerHTML = `
      <div class="quiz-item-top">
        <span class="quiz-item-name"></span>
        <span class="quiz-item-score mono" title="Latest score on this quiz's chosen categories"></span>
        <button class="btn btn-sm btn-primary" type="button" data-act="retake">Retake</button>
        <button class="btn btn-sm" type="button" data-act="details">Details</button>
        <button class="btn btn-sm btn-ghost" type="button" data-act="delete">Delete</button>
      </div>
      <div class="quiz-item-meta"></div>
      <div class="quiz-item-details" hidden></div>`;
    $('.quiz-item-name', li).textContent = q.name;
    const badge = learnerBadges().find((b) => b.kind === 'quiz' && b.quizId === q.id);
    if (badge) { const m = document.createElement('span'); m.className = 'quiz-badge'; m.textContent = badgeEmoji(badge); m.title = `Mastered on ${fmtBadgeDay(badge.earnedAt)}${badge.level > 1 ? ` · level ${badge.level}` : ''}`; $('.quiz-item-name', li).appendChild(m); }
    const lastGrade = q.last && q.last.overall != null ? gradeById(q.last.grade) || gradeOf(q.last.overall) : null;
    // an attempt judged without a tolerance has no correctness: its overall and grade lead
    $('.quiz-item-score', li).textContent = lastScore == null ? (lastGrade ? '' : q.attempts ? '–' : 'not taken') : `${lastScore}% correct`;
    if (lastGrade) {
      const g = document.createElement('span');
      g.className = `rr-grade ${lastGrade.id}`;
      g.textContent = `${lastScore == null ? '' : ' · '}${q.last.overall} ${gradeText(lastGrade)}`;
      $('.quiz-item-score', li).appendChild(g);
    }
    $('.quiz-item-score', li).title = 'Latest attempt: share of slokas within tolerance in the chosen categories, then the weighted overall score and its grade';
    const meta = $('.quiz-item-meta', li);
    const parts = [
      `${q.items.length} sloka${q.items.length === 1 ? '' : 's'} from ${q.folders.map(folderLabel).join(', ') || 'the library'}`,
      `${q.attempts} attempt${q.attempts === 1 ? '' : 's'}`,
    ];
    if (q.last) parts.push(`last ${fmtDate(q.last.at)}`);
    if (q.attempts > 1 && q.best != null) parts.push(`best ${q.best}% correct${q.bestOverall != null ? ` · ${q.bestOverall} ${(gradeOf(q.bestOverall) || {}).label || ''}` : ''}`);
    parts.push(`scored on ${modernCategories(q.categories).map((c) => (QUIZ_CATEGORIES.find((x) => x.id === c) || {}).label || c).join(' + ')}`);
    for (const t of parts) { const sp = document.createElement('span'); sp.textContent = t; meta.appendChild(sp); }
    $('[data-act="retake"]', li).addEventListener('click', async () => {
      try { await enterQuiz(await api.getQuiz(q.id)); } catch (err) { toast(err.message, 'error'); }
    });
    $('[data-act="details"]', li).addEventListener('click', async () => {
      const box = $('.quiz-item-details', li);
      if (!box.hidden) { box.hidden = true; return; }
      box.hidden = false;
      box.textContent = 'Loading…';
      try {
        const full = await api.getQuiz(q.id);
        box.innerHTML = '';
        const ol = document.createElement('ol');
        ol.className = 'quiz-items';
        const lib = new Set((libraryCache || []).map((r) => r.id));
        for (const it of full.items) {
          const item = document.createElement('li');
          item.textContent = it.name;
          if (it.folder) { const f = document.createElement('span'); f.className = 'muted small'; f.textContent = it.folder; item.appendChild(f); }
          if (!lib.has(it.id)) { item.classList.add('gone'); item.title = 'No longer in the library'; }
          ol.appendChild(item);
        }
        box.appendChild(ol);
        const trend = document.createElement('div');
        trend.className = 'quiz-trend';
        box.appendChild(trend);
        if (full.attempts.length) renderTrend(trend, full);
        else { const p = document.createElement('p'); p.className = 'muted small'; p.textContent = 'Not taken yet.'; trend.appendChild(p); }
      } catch (err) { box.textContent = err.message; }
    });
    $('[data-act="delete"]', li).addEventListener('click', async () => {
      const ok = await askDialog({ title: 'Delete this quiz?', message: `"${q.name}" and its ${q.attempts} saved attempt${q.attempts === 1 ? '' : 's'} will be removed.`, input: false, okText: 'Delete', danger: true });
      if (!ok) return;
      try {
        await api.deleteQuiz(q.id);
        if (practice.quiz && practice.quiz.id === q.id) leaveQuiz(true);
        quizListCache = quizListCache.filter((x) => x.id !== q.id);
        renderQuizList();
      } catch (err) { toast(err.message, 'error'); }
    });
    ul.appendChild(li);
  }
}

$('#practice-again').addEventListener('click', () => {
  hideResults();
  practiceUI.reset();
  $('#practice-rec').focus();
  $('#practice-step2').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------- steps 1 and 2 fold once there are results, so the report is what you see ----------
// A folded head keeps its summary (what is ticked, how long the take was); click it, or
// press Enter on it, to open the step again. "Record again" and any new take unfold both.
const FOLDING_STEPS = ['#practice-step1', '#practice-step2'];
function setStepFolded(sel, folded) {
  const card = $(sel);
  const was = card.classList.contains('collapsed');
  card.classList.toggle('collapsed', folded);
  $('.step-head', card).setAttribute('aria-expanded', folded ? 'false' : 'true');
  if (was && !folded) redrawAll(); // its canvases were skipped while it was folded
}
for (const sel of FOLDING_STEPS) {
  const head = $('.step-head', $(sel));
  head.setAttribute('role', 'button');
  head.tabIndex = 0;
  head.setAttribute('aria-expanded', 'true');
  const toggle = () => setStepFolded(sel, !$(sel).classList.contains('collapsed'));
  head.addEventListener('click', (e) => { if (e.target.closest('button, input, select, a, label')) return; toggle(); });
  head.addEventListener('keydown', (e) => { if (e.target === head && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); } });
}
// The results card from the moment a recording stops: Evaluating… in it and the steps
// folded away, until the open sloka's report is in.
function showEvaluating() {
  setHidden($('#practice-results'), false);
  renderReportBrowser(); // no reports yet
  setHidden($('#report-error'), true);
  setEvaluating(true);
  focusResults();
  $('#practice-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function focusResults() {
  const take = practice.take;
  $('#practice-step2-summary').textContent = take ? `Recorded ${fmtTime(take.duration)} · open to record again` : '';
  for (const sel of FOLDING_STEPS) setStepFolded(sel, true);
  renderSlokaTexts(); // the take exists now: the text panel gives way to the sloka itself
}
function unfoldSteps() {
  $('#practice-step2-summary').textContent = '';
  for (const sel of FOLDING_STEPS) setStepFolded(sel, false);
}

function hideResults() {
  practice.progress = null;
  renderMoments();
  unfoldSteps();
  stopDuet();
  practice.result = null;
  practice.selected = null;
  setEvaluating(false);
  practice.results.clear();
  practice.pairContrast.clear();
  practice.wordSims.clear();
  practice.phonology.clear();
  practice.heard = null;
  practice.heardTranscripts.clear();
  stopTakeTranscriptions();
  practice.quizAttempt = null;
  practice.session = null;
  setHidden($('#quiz-score'), true);
  if (practice.quiz) { practice.take = null; setHidden($('#practice-base'), true); renderSlokaTexts(); } // the next attempt is from memory again
  setHidden($('#practice-results'), true);
  heardPlayer.pause();
  resetTranscriptUI();
}

const TYPE_LABEL = { pitch: 'Pitch', timing: 'Timing', content: 'Content', missing: 'Missing', extra: 'Extra', dynamics: 'Dynamics' };

// Which kinds of deviation the list and the chart show. Everything is always measured and
// scored; by default content, missing/extra and pitch are shown, timing and dynamics on request.
const FILTER_KEY = 'tutor-dev-filter';
const FILTER_KINDS = ['content', 'missing', 'pitch', 'timing', 'dynamics'];
const DEFAULT_FILTER = ['content', 'missing', 'pitch'];
let devFilter = new Set((() => {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null');
    if (Array.isArray(saved)) {
      const ok = saved.filter((k) => FILTER_KINDS.includes(k));
      if (ok.length) return ok;
    }
  } catch { /* default */ }
  return DEFAULT_FILTER;
})());
const allKindsShown = () => FILTER_KINDS.every((k) => devFilter.has(k));
function applyDevFilter() {
  const all = allKindsShown();
  $$('.chip', $('#dev-filters')).forEach((x) => {
    const on = x.dataset.filter === 'all' ? all : devFilter.has(x.dataset.filter);
    x.classList.toggle('active', on);
    x.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  chart.setFilter(all ? null : devMatchesFilter);
  renderDeviations();
  renderReportBrowser(); // its conflict marks and counts follow the same chips
}
$('#dev-filters').addEventListener('click', (e) => {
  const c = e.target.closest('.chip[data-filter]');
  if (!c) return;
  const k = c.dataset.filter;
  if (k === 'all') {
    devFilter = new Set(allKindsShown() ? DEFAULT_FILTER : FILTER_KINDS); // "All" again → back to the default view
  } else if (devFilter.has(k)) {
    if (devFilter.size > 1) devFilter.delete(k); // always keep at least one kind visible
  } else {
    devFilter.add(k);
  }
  try { localStorage.setItem(FILTER_KEY, JSON.stringify([...devFilter])); } catch { /* ignore */ }
  applyDevFilter();
});

function renderResult(res) {
  practice.result = res;
  practice.selected = null;
  setHidden($('#practice-results'), false);
  setHidden($('#report-overall'), !!practice.quiz); // the quiz block carries the overall instead
  setHidden($('#transcript'), hideTranscript); // the words, when wanted on screen
  renderTiles(res, practice.activeId);
  const notes = $('#result-notes');
  notes.innerHTML = '';
  for (const n of res.notes) { const li = document.createElement('li'); li.textContent = n; notes.appendChild(li); }
  chart.setResult(res);
  applyDevFilter();
  resetTranscriptUI();
}

// The categories a stored attempt or session was scored on: today's seven, or, for a record
// from before this scoring, the old five (content, pronunciation, timing, pitch, dynamics).
function columnsFor(items) {
  const legacy = (items || []).some((it) => it && !it.missing && ['phoneme', 'vowel', 'syllable'].every((k) => it[k] == null) && ['content', 'pronunciation', 'dynamics'].some((k) => it[k] != null));
  return legacy ? [LEGACY_CATEGORIES[0], LEGACY_CATEGORIES[1], QUIZ_CATEGORIES.find((c) => c.id === 'timing'), QUIZ_CATEGORIES.find((c) => c.id === 'pitch'), LEGACY_CATEGORIES[2]] : QUIZ_CATEGORIES;
}
const weightsOf = (a) => (a && a.weights ? normalizeWeights(a.weights) : CATEGORY_WEIGHTS);

// The weighted overall of a report over the categories that could be judged, and its grade.
function reportOverall(id) {
  const sc = reportScores(id);
  const slips = slipsOf(id);
  const raw = sc ? overallScore(sc, verdictCategories(), activeWeights()) : null;
  const overall = applySlipPenalty(raw, slips); // 15 % off for self-correction
  return { overall, raw, grade: gradeWithSlips(overall, slips), slips };
}
// A grade as it is shown: its emoji and its word ("🌟 Excellent"), or the word alone when
// the Settings ask for plain labels. The word is always there, so the emoji never carries
// the grade by itself.
const gradeText = (g) => (!g ? '' : gradeWordsOn && g.emoji ? `${g.emoji} ${g.label}` : g.label);
// Puts a grade badge in an element (empty when there is no grade), and, given an element
// for them, a few words of encouragement under it (see gradeWords): the phrase is picked
// by `seed` so a report always says the same thing, names the first slip when there was
// one, and says "not your best" rather than praising a take below the learner's best.
function setGrade(el, grade, wordsEl = null, opts = {}) {
  el.textContent = gradeText(grade);
  el.className = `${el.className.split(' ')[0]}${grade ? ` ${grade.id}` : ''}`;
  if (grade) el.setAttribute('aria-label', grade.label); else el.removeAttribute('aria-label');
  if (!wordsEl) return;
  const w = grade && gradeWordsOn ? gradeWords(grade, { ...opts, ageGroup: (learnerSpeaker() || {}).ageGroup || null }) : null;
  wordsEl.textContent = w ? w.text : '';
  setHidden(wordsEl, !w);
}

// The category tiles of the open report, each judged against the tolerance, and the ring
// with the weighted overall and its grade. Tiles of categories that could not be judged
// (no transcript yet, pitch shown for interest only, dynamics not measured) are collapsed
// at the bottom of the report; the judged ones stay by the ring.
function renderTiles(res, id) {
  const s = res.scores;
  const sc = reportScores(id) || {};
  const tol = activeTolerance();
  const judged = [];
  const unjudged = [];
  const put = (cat, value, sub) => {
    $(`#score-${cat}`).textContent = value == null ? '–' : String(value);
    $(`#score-${cat}-sub`).textContent = sub;
    const tile = $(`.score[data-cat="${cat}"]`);
    const w = tol ? withinTolerance(sc[cat], tol[cat]) : null;
    const counted = !practice.quiz || practice.quiz.categories.includes(cat); // a quiz scores its chosen categories only
    tile.classList.toggle('ok', counted && w === true);
    tile.classList.toggle('bad', counted && w === false);
    tile.classList.toggle('off', !counted);
    $(`#score-${cat}-tol`).textContent = !counted ? 'not scored in this quiz' : w === null ? '' : w ? `within ${tol[cat]} %` : `outside ${tol[cat]} %`;
    (sc[cat] == null ? unjudged : judged).push(tile);
  };
  // the words: phonemes, vowel length, syllables — once the transcript is in
  const ph = practice.phonology.get(id) || null;
  const waiting = practice.heardTranscripts.size || sttSettings.auto ? 'waiting for the transcript' : 'not heard: "Hear the words" is off in Settings';
  const errs = ph ? ph.errors : {};
  const slipList = (kinds) => { const parts = kinds.filter((k) => errs[k]).map((k) => `${errs[k]} ${ERROR_LABEL[k].split(' (')[0]}`); return parts.length ? parts.join(', ') : 'all right'; };
  put('phoneme', sc.phoneme, !ph ? waiting : `${ph.counts.phonemesCompared} sounds · ${slipList(['aspiration', 'voicing', 'place', 'nasality', 'visarga', 'length', 'vowel', 'missing', 'added', 'other'])}`);
  put('vowel', sc.vowel, !ph ? waiting : ph.counts.vowelsCompared ? `${ph.counts.vowelSlips} of ${ph.counts.vowelsCompared} vowels the wrong length` : 'no vowel to compare');
  put('syllable', sc.syllable, !ph ? waiting : `${ph.counts.ref} akṣaras · ${ph.counts.missing} missing, ${ph.counts.added} added, ${ph.counts.replaced} replaced`);
  // the sound, each relative to the speaker
  put('emphasis', sc.emphasis, s.emphasis == null ? 'too little to compare' : `pattern agreement ${Math.round(100 * Math.max(0, s.emphasisCorr || 0))}%`);
  const pitchStyle = s.weights && s.weights.pitch === 0 && s.pitch != null; // recited text: pitch is shown, not judged
  put('pitch', s.pitch, s.pitch == null ? 'not enough steady pitch' : `in tune ${s.pitchInTunePct}% · avg ${s.pitchMeanCents} cents off${pitchStyle ? ' · for interest, not judged' : ''}`);
  const pd = s.phrasingDetail || {};
  put('phrasing', sc.phrasing, s.phrasing == null ? 'not measured' : pd.sloka || pd.take ? `${pd.kept} of ${pd.sloka} pauses kept · ${pd.extra} added` : 'no pauses in either');
  put('timing', s.timing, s.timingCoveredPct ? `${s.timingCoveredPct}% of the piece flagged` : 'steady throughout');
  // judged tiles by the ring, in weight order; the rest collapsed at the bottom
  const grid = $('#scores');
  for (const t of judged) grid.appendChild(t);
  const fold = $('#scores-unjudged');
  const foldTiles = $('#scores-unjudged-tiles');
  for (const t of unjudged) foldTiles.appendChild(t);
  setHidden(fold, !unjudged.length);
  $('#scores-unjudged-title').textContent = `Not judged: ${unjudged.map((t) => catLabel(t.dataset.cat).toLowerCase()).join(', ')}`;
  // the overall: weighted over what was judged
  const { overall, raw, grade, slips } = reportOverall(id);
  $('#score-ring').style.setProperty('--pct', String(overall == null ? 0 : overall));
  $('#score-overall').textContent = overall == null ? '–' : String(overall);
  setGrade($('#score-grade'), grade, $('#score-words'), { seed: id, slips, score: overall, best: bestBeforeOf(id) });
  const pen = $('#score-penalty');
  pen.textContent = penaltyText(raw, overall, slips);
  setHidden(pen, !pen.textContent);
  const aw = activeWeights();
  $('#score-overall-sub').textContent = judged.length ? `weighted: ${judged.map((t) => `${catLabel(t.dataset.cat).toLowerCase()} ${aw[t.dataset.cat]}`).join(', ')}` : 'nothing could be judged';
  $('#score-overall-sub').title = 'The overall is the weighted mean of the categories that could be judged';
  const v = reportVerdict(id);
  const vEl = $('#score-verdict');
  vEl.textContent = v.ok === null ? '' : v.ok ? 'Within tolerance' : `Outside tolerance: ${v.failed.map((c) => catLabel(c).toLowerCase()).join(', ')}`;
  vEl.className = `score-verdict${v.ok === null ? '' : v.ok ? ' ok' : ' bad'}`;
}

// A deviation is shown when any of its kinds is selected ("missing" covers extra material too).
function devMatchesFilter(d) {
  return d.types.some((t) => devFilter.has(t) || ((t === 'missing' || t === 'extra') && devFilter.has('missing')));
}

function renderDeviations() {
  const res = practice.result;
  const list = $('#dev-list');
  list.innerHTML = '';
  if (!res) return;
  const all = res.deviations;
  const counts = {};
  for (const d of all) counts[d.type] = (counts[d.type] || 0) + 1;
  const parts = Object.entries(counts).map(([t, c]) => `${c} ${TYPE_LABEL[t].toLowerCase()}`);
  $('#dev-summary').textContent = all.length ? `${all.length} deviation${all.length === 1 ? '' : 's'} · ${parts.join(', ')}` : 'Deviations';
  const shown = all.filter(devMatchesFilter);
  setHidden($('#dev-empty'), shown.length > 0);
  if (!shown.length && all.length) $('#dev-empty').textContent = 'Nothing of this kind.';
  else $('#dev-empty').textContent = 'No noticeable deviations. Beautifully done.';
  for (const d of shown) {
    const li = document.createElement('li');
    li.className = `dev-item type-${d.type} sev-${d.severity}${practice.selected === d.id ? ' selected' : ''}`;
    li.dataset.id = String(d.id);
    const badge = d.types.map((t) => TYPE_LABEL[t]).join(' + ');
    const heardTxt = d.tHeard ? `yours ${fmtTime(d.tHeard[0])}–${fmtTime(d.tHeard[1])}` : 'nothing on your side';
    li.innerHTML = `
      <div class="dev-main">
        <div class="dev-top">
          <span class="dev-badge">${badge}</span>
          <span class="dev-time mono">${fmtTime(d.tBase[0])} – ${fmtTime(d.tBase[1])}</span>
          <span class="dev-sev" title="Severity ${d.severity} of 3">${'●'.repeat(d.severity)}${'○'.repeat(3 - d.severity)}</span>
        </div>
        <div class="dev-label"></div>
        <div class="dev-detail muted small"></div>
      </div>
      <div class="dev-actions">
        <button class="btn btn-sm btn-alt-base" type="button" data-play="base">
          <svg class="ico-play" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
          <svg class="ico-pause" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
          <span>Sloka</span>
        </button>
        <button class="btn btn-sm btn-alt-heard" type="button" data-play="heard" ${d.tHeard ? '' : 'disabled'}>
          <svg class="ico-play" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
          <svg class="ico-pause" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
          <span>Yours</span>
        </button>
      </div>`;
    $('.dev-label', li).textContent = d.label;
    $('.dev-detail', li).textContent = `${d.detail} (sloka ${fmtTime(d.tBase[0])}–${fmtTime(d.tBase[1])}, ${heardTxt})`;
    li.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-play]');
      selectDeviation(d.id, false);
      if (btn) playDeviation(d, btn.dataset.play, btn);
    });
    list.appendChild(li);
  }
}

function selectDeviation(id, scroll) {
  practice.selected = id;
  $$('.dev-item').forEach((li) => li.classList.toggle('selected', li.dataset.id === String(id)));
  chart.select(id);
  if (scroll && id != null) {
    const li = $(`.dev-item[data-id="${id}"]`);
    if (li) li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

const PAD = 0.15;
function playDeviation(d, which, btn) {
  getCtx();
  const p = which === 'base' ? basePlayer : heardPlayer;
  const other = which === 'base' ? heardPlayer : basePlayer;
  if (btn.classList.contains('playing')) { p.pause(); return; }
  other.pause();
  $$('.dev-actions .btn.playing').forEach((b) => b.classList.remove('playing'));
  const range = which === 'base' ? d.tBase : d.tHeard;
  if (!range) { toast('There is nothing on your side for this one.', 'info'); return; }
  btn.classList.add('playing');
  p.playRange(range[0] - PAD, range[1] + PAD);
}

// ======================================================================
// LIBRARY
// ======================================================================

const libPlayer = new Player();
let libPlayingId = null;
// ---------- everything saved about a sloka: a popup on a right-click in the Library ----------
// Every key of the details file is listed (known ones under their own names, any other under
// its key), so nothing saved is hidden. The popup is focused when it opens and goes when the
// focus leaves it, on Esc, or on a click elsewhere.
const META_LABELS = {
  schemaVersion: 'Schema', source: 'Source', role: 'Role', speaker: 'Who recorded it', profileId: 'Person', voiceType: 'Voice', ageGroup: 'Age group',
  style: 'Style', mode: 'Mode', tradition: 'Tradition', pitchPrescribed: 'Pitch prescribed', text: 'Text', language: 'Language', script: 'Script', origin: 'Origin',
  aksharaCount: 'Akṣaras', body: 'Text', title: 'Title', voice: 'Voice, as measured', medianF0Hz: 'Median pitch (Hz)', f0P10Hz: 'Pitch, 10th percentile (Hz)',
  f0P90Hz: 'Pitch, 90th percentile (Hz)', f0RangeSemitones: 'Pitch range (semitones)', voicedFraction: 'Voiced fraction', leadSilenceSec: 'Silence at the start (s)',
  trailSilenceSec: 'Silence at the end (s)', activeSec: 'Sound (s)', tempoSylPerSec: 'Tempo (akṣaras per s)', measured: 'Recording, as measured', durationSec: 'Duration (s)',
  sampleCount: 'Samples', peakDbfs: 'Peak (dBFS)', rmsDbfs: 'Loudness, RMS (dBFS)', noiseFloorDbfs: 'Noise floor (dBFS)', snrDb: 'Voice above the room (dB)',
  clippedSampleCount: 'Clipped samples', capture: 'Capture', device: 'Microphone', sampleRate: 'Sample rate (Hz)', channelCount: 'Channels', echoCancellation: 'Echo cancellation',
  noiseSuppression: 'Noise suppression', autoGainControl: 'Automatic gain', environment: 'Environment', edit: 'Edits', trimStartSec: 'Trimmed at the start (s)',
  trimEndSec: 'Trimmed at the end (s)', consent: 'Consent', givenBy: 'Given by', shareScope: 'Share scope', notes: 'Notes', id: 'Id', createdAt: 'Created',
  updatedAt: 'Updated', audio: 'Audio file', pcmSha256: 'PCM SHA-256', channels: 'Channels', bitDepth: 'Bit depth', format: 'Format', software: 'Software', app: 'App',
  version: 'Version', featVersion: 'Analysis version', chandas: 'Chandas', family: 'Family', perPada: 'Syllables per pāda', padas: 'Pādas', syllables: 'Syllables in the text',
  expectedSyllables: 'Syllables the metre expects', exact: 'Exact', form: 'Form', weights: 'Laghu / guru', confidence: 'Confidence', verse: 'Gītā verse', chapter: 'Chapter',
  at: 'Computed', migrated: 'From before details existed', folder: 'Folder', file: 'File', duration: 'Duration (s)', name: 'Name',
  verse: 'Verse (reference dataset)', dataset: 'Dataset', datasetVersion: 'Dataset version', speakerLineRecited: 'Speaker line recited', textHash: 'Text hash', mappedBy: 'Linked by', pinned: 'Text pinned', kind: 'Kind',
};
const metaPopup = $('#meta-popup');
const metaLabel = (k) => META_LABELS[k] || k;
function metaValue(k, v) {
  if (v === null || v === undefined || v === '') return { text: '—', cls: 'none' };
  if (typeof v === 'boolean') return { text: v ? 'yes' : 'no' };
  if (typeof v === 'number') return { text: Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100) };
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return { text: fmtDate(v), title: v };
    if (k === 'pcmSha256') return { text: `${v.slice(0, 16)}…`, title: v, cls: 'mono' };
    if (k === 'profileId') { const who = profileById(v); return { text: who ? who.name : v }; }
    if (v.length > 160) return { text: `${v.slice(0, 160)}…`, title: v };
    return { text: v };
  }
  if (Array.isArray(v)) return { text: v.length ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : '—', cls: v.length ? '' : 'none' };
  return { text: JSON.stringify(v), cls: 'mono' };
}
function renderMetaPopup(r) {
  $('#meta-popup-name').textContent = r.name;
  const body = $('#meta-popup-body');
  body.innerHTML = '';
  const section = (title, obj) => {
    const h = document.createElement('h4');
    h.textContent = title;
    body.appendChild(h);
    const dl = document.createElement('dl');
    for (const [k, v] of Object.entries(obj)) {
      const dt = document.createElement('dt'); dt.textContent = metaLabel(k); dt.title = k;
      const dd = document.createElement('dd');
      const { text, title, cls } = metaValue(k, v);
      dd.textContent = text; if (title) dd.title = title; if (cls) dd.className = cls;
      dl.appendChild(dt); dl.appendChild(dd);
    }
    body.appendChild(dl);
  };
  section('The file', { folder: r.folder || '(top level)', file: r.file, duration: r.duration, sampleRate: r.sampleRate, source: r.source, createdAt: r.createdAt });
  const meta = r.meta;
  if (!meta) { section('Details', { notes: 'No details file yet.' }); return; }
  const scalars = {};
  const objects = [];
  for (const [k, v] of Object.entries(meta)) {
    if (k === 'name') continue; // the heading
    if (v && typeof v === 'object' && !Array.isArray(v)) objects.push([k, v]); else scalars[k] = v;
  }
  section('Details', scalars);
  for (const [k, v] of objects) section(metaLabel(k), k === 'chandas' && v.family ? { ...v, chandas: chandasLabel(v) } : v);
}
function showMetaPopup(r, x, y) {
  renderMetaPopup(r);
  setHidden(metaPopup, false);
  metaPopup.style.left = '0px';
  metaPopup.style.top = '0px';
  const w = metaPopup.offsetWidth;
  const h = metaPopup.offsetHeight;
  metaPopup.style.left = `${Math.max(8, Math.min(x, window.innerWidth - w - 8))}px`;
  metaPopup.style.top = `${Math.max(8, Math.min(y, window.innerHeight - h - 8))}px`;
  $('#meta-popup-body').scrollTop = 0;
  metaPopup.focus();
}
function hideMetaPopup() { if (!metaPopup.hidden) setHidden(metaPopup, true); }
metaPopup.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); hideMetaPopup(); } });
metaPopup.addEventListener('focusout', (e) => { if (!metaPopup.contains(e.relatedTarget)) hideMetaPopup(); });
document.addEventListener('mousedown', (e) => { if (!metaPopup.hidden && !metaPopup.contains(e.target)) hideMetaPopup(); });
$('#meta-popup-close').addEventListener('click', hideMetaPopup);

const syncLib = () => { $$('.lib-item .btn-play').forEach((b) => b.classList.toggle('playing', libPlayer.playing && b.closest('.lib-item').dataset.id === libPlayingId)); };
for (const ev of ['play', 'pause', 'ended']) libPlayer.addEventListener(ev, syncLib);

$('#library-trim-all').addEventListener('click', trimAllBaselines);
async function trimAllBaselines() {
  const list = await getLibrary(true);
  if (!list.length) return;
  const ok = await askDialog({
    title: 'Trim silence in all slokas?',
    message: `Silence at the start and end of ${list.length} recording${list.length === 1 ? '' : 's'} will be removed from the WAV files in the library folder. Sound in the middle is never touched, and the originals are kept in library/backup.`,
    input: false,
    okText: 'Trim',
  });
  if (!ok) return;
  const btn = $('#library-trim-all');
  btn.disabled = true;
  libPlayer.unload();
  const prog = progressUI('library-progress');
  prog.show('Trimming…');
  const trimmed = [];
  try {
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      prog.set(i / list.length, `Trimming ${r.name} (${i + 1} of ${list.length})…`);
      const res = await api.trimBaseline(r.id);
      if (!res.changed) continue;
      trimmed.push(r.id);
      // Refresh the cached analysis so practising against it stays instant.
      prog.set((i + 0.4) / list.length, `Re-learning ${r.name}…`);
      try {
        getCtx();
        const dec = await decodeBlob(await api.fetchAudioBlob(r.id));
        const features = await analyzer.features(dec.samples, dec.sampleRate, (p) => prog.set((i + 0.4 + 0.6 * p) / list.length));
        await api.putFeatures(r.id, serializeFeatures(features));
      } catch { /* it will simply be recomputed on the next practice */ }
    }
    prog.set(1, 'Done');
    libraryCache = null;
    toast(trimmed.length ? `Trimmed ${trimmed.length} of ${list.length} sloka${list.length === 1 ? '' : 's'}.` : 'All slokas were already tight.', 'success', 5000);
    await refreshLibrary();
    // trimmed audio invalidates what Self Evaluation has loaded and any open reports
    if (practice.selection.some((id) => trimmed.includes(id))) {
      for (const id of trimmed) practice.bases.delete(id);
      const sel = practice.selection;
      await setSelection([]);
      await setSelection(sel);
    }
  } catch (err) {
    toast(err.message, 'error', 6000);
  } finally {
    btn.disabled = false;
    prog.hide();
  }
}

// Slokas ticked in the Library, to be evaluated against together.
const libPicked = new Set();
function syncLibPicked() {
  const n = libPicked.size;
  const btn = $('#library-evaluate');
  btn.disabled = n === 0;
  btn.textContent = n ? `Self Evaluation with selected (${n})` : 'Self Evaluation with selected';
}
$('#library-evaluate').addEventListener('click', async () => {
  if (!libPicked.size) return;
  libPlayer.pause();
  const ids = [...libPicked];
  showView('evaluate');
  await refreshPracticeSelect(ids);
});

$('#library-new-folder').addEventListener('click', async () => {
  const name = await askDialog({ title: 'New folder', message: 'A subfolder of the library. You can also make folders and move files with Explorer; SlokAbhyasa picks the changes up.', label: 'Folder name', value: '', okText: 'Create' });
  if (!name) return;
  try { await api.createFolder(name); foldersCache = null; toast('Folder created.', 'success'); refreshLibrary(); } catch (err) { toast(err.message, 'error'); }
});

async function refreshLibrary() {
  await getProfiles(); // the tags name who recorded each sloka
  const list = (await getLibrary(true)).slice().sort((a, b) => (a.folder || '').localeCompare(b.folder || '') || a.name.localeCompare(b.name));
  const folders = visibleFolders(await getFolders(true));
  for (const id of [...libPicked]) if (!list.some((r) => r.id === id)) libPicked.delete(id);
  syncLibPicked();
  const ul = $('#library-list');
  ul.innerHTML = '';
  setHidden($('#library-empty'), list.length > 0 || folders.length > 1);
  setHidden($('#library-toolbar'), list.length === 0 && folders.length <= 1);
  const grouped = folders.length > 1;
  const byFolder = new Map(folders.map((f) => [f.path, []]));
  for (const r of list) { const k = r.folder || ''; if (!byFolder.has(k)) byFolder.set(k, []); byFolder.get(k).push(r); }
  const rows = [];
  for (const [folder, items] of byFolder) {
    if (grouped) rows.push({ heading: folder, count: items.length });
    for (const r of items) rows.push({ rec: r });
  }
  for (const row of rows) {
    if (row.heading !== undefined) {
      const h = document.createElement('li');
      h.className = 'lib-folder';
      h.innerHTML = '<span></span><span class="muted small"></span>';
      h.firstChild.textContent = folderLabel(row.heading);
      h.lastChild.textContent = row.count ? `${row.count} sloka${row.count === 1 ? '' : 's'}` : 'empty';
      ul.appendChild(h);
      continue;
    }
    const r = row.rec;
    const li = document.createElement('li');
    li.className = 'lib-item';
    li.dataset.id = r.id;
    li.addEventListener('contextmenu', (e) => { e.preventDefault(); showMetaPopup(r, e.clientX, e.clientY); }); // everything saved about it
    li.innerHTML = `
      <div class="lib-top">
        <button class="btn-play small" type="button" aria-label="Play">
          <svg class="ico-play" viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
          <svg class="ico-pause" viewBox="0 0 24 24"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
        </button>
        <div class="lib-name"></div>
        <input class="lib-pick" type="checkbox" title="Select for Self Evaluation" />
      </div>
      <div class="lib-meta"><span class="mono">${fmtTime(r.duration)}</span><span>${r.source === 'mic' ? 'Microphone' : 'Imported file'}</span><span>${fmtDate(r.createdAt)}</span></div>
      <div class="lib-meta lib-tags"></div>
      <div class="lib-actions">
        <button class="btn btn-sm btn-primary" type="button" data-act="practice">Self Evaluation</button>
        <button class="btn btn-sm" type="button" data-act="details">Details</button>
        <button class="btn btn-sm" type="button" data-act="rename">Rename</button>
        <button class="btn btn-sm" type="button" data-act="move">Move…</button>
        <button class="btn btn-sm" type="button" data-act="transcript">Transcript</button>
        <button class="btn btn-sm btn-ghost" type="button" data-act="delete">Delete</button>
      </div>`;
    $('.lib-name', li).textContent = r.name;
    $('.lib-name', li).title = r.file;
    renderLibTags($('.lib-tags', li), r);
    $('[data-act="details"]', li).addEventListener('click', () => libDetailsPanel(li, r));
    $('.btn-play', li).addEventListener('click', async () => {
      getCtx();
      if (libPlayingId === r.id && libPlayer.loaded) { libPlayer.toggle(); return; }
      libPlayingId = r.id;
      try { await libPlayer.load(api.audioUrl(r.id)); libPlayer.play(); } catch (err) { toast(err.message, 'error'); }
    });
    const pick = $('.lib-pick', li);
    pick.setAttribute('aria-label', `Select ${r.name} for Self Evaluation`);
    pick.checked = libPicked.has(r.id);
    pick.addEventListener('change', () => { if (pick.checked) libPicked.add(r.id); else libPicked.delete(r.id); syncLibPicked(); });
    $('[data-act="practice"]', li).addEventListener('click', async () => {
      libPlayer.pause();
      showView('evaluate');
      await refreshPracticeSelect(r.id);
    });
    $('[data-act="move"]', li).addEventListener('click', async () => {
      const folder = await chooseFolder({ title: `Move "${r.name}" to`, current: r.folder || '' });
      if (folder === null || folder === (r.folder || '')) return;
      try { await api.moveBaseline(r.id, folder); libraryCache = null; toast(`Moved to ${folderLabel(folder)}.`, 'success'); refreshLibrary(); } catch (err) { toast(err.message, 'error'); }
    });
    $('[data-act="rename"]', li).addEventListener('click', async () => {
      const name = await askDialog({ title: 'Rename sloka', value: r.name, okText: 'Rename' });
      if (!name || name === r.name) return;
      try { await api.renameBaseline(r.id, name); libraryCache = null; toast('Renamed.', 'success'); refreshLibrary(); } catch (err) { toast(err.message, 'error'); }
    });
    $('[data-act="delete"]', li).addEventListener('click', async () => {
      const ok = await askDialog({ title: `Delete "${r.name}"?`, message: 'The WAV file and its analysis will be removed from the library folder. This cannot be undone.', input: false, okText: 'Delete', danger: true });
      if (!ok) return;
      try {
        if (libPlayingId === r.id) libPlayer.unload();
        await api.deleteBaseline(r.id);
        libraryCache = null;
        if (practice.selection.includes(r.id)) await setSelection(practice.selection.filter((x) => x !== r.id));
        toast('Deleted.', 'success');
        refreshLibrary();
      } catch (err) { toast(err.message, 'error'); }
    });
    $('[data-act="transcript"]', li).addEventListener('click', () => libTranscriptPanel(li, r));
    ul.appendChild(li);
  }
  syncLib();
}

// ======================================================================
// SPEECH TO TEXT — self evaluation results and library
// ======================================================================

const sttPractice = { base: null, heard: null };
const sttProgress = mirrored(progressUI('stt-progress'), 'words'); // the take's words; the Evaluating block shows it too
// (no model dropdown and no Transcribe button anywhere: the words are heard automatically,
// with the model chosen for this computer — unless the Settings switch is off)
{
  const cb = $('#settings-stt-auto');
  cb.checked = sttSettings.auto;
  cb.addEventListener('change', () => { sttSettings.auto = cb.checked; saveStt(); syncSttAuto(); if (cb.checked) warmStt(); });
  sttAutoBoxes.add(cb);
}
$('#stt-run').addEventListener('click', () => transcribeBoth(true));

function resetTranscriptUI() {
  sttPractice.base = null;
  sttPractice.heard = null;
  setHidden($('#stt-out'), true);
  $('#stt-base').innerHTML = '';
  $('#stt-heard').innerHTML = '';
  $('#stt-summary').textContent = '';
  setHidden($('#stt-phon'), true);
  practicePanel.highlight(new Set());
}

// The take's words, made in the speech worker; whoever needs them (the word diff, quiz
// scoring) waits for the same job. A take of up to one Whisper window is transcribed whole,
// once, as soon as it is recorded. A longer take is transcribed part by part, each part being
// the stretch a sloka was found in: Whisper loses its way in a long chant (it wrote 12.2's
// words, then "प्व्व्व्…" for the rest of a two-sloka take), while a single sloka's worth it
// transcribes well. Timings in a part's transcript are absolute take times. Resolves with
// null when it was stopped. `force` redoes a transcript made with another model.
const TAKE_WHOLE_MAX_SEC = 30;
const TAKE_PART_PAD_SEC = 0.3;

// The stretch of the take a report's transcript should cover: the part where the sloka was
// found whenever the take holds more than this sloka (a quiz or an evaluation of several, a
// long take), null for the whole take. A report's "Yours" then shows that sloka's words
// alone, and Whisper, which loses its way in a long chant, gets a single sloka's worth.
function heardPartOf(res) {
  const take = practice.take;
  if (!take || !res || !res.match || res.match.located !== 'heard') return null;
  return res.matched.heard;
}
const partKey = (win) => (win ? `${win[0].toFixed(1)}-${win[1].toFixed(1)}` : 'all');

async function transcribeTakePart(win, force, language = sttSettings.language) {
  const take = practice.take;
  if (!take) return null;
  const tier = await sttTier();
  const fits = (t) => !!t && t.language === language && (!force || t.tier === tier);
  if (practice.take !== take) return null;
  const key = language === sttSettings.language ? partKey(win) : `${language}:${partKey(win)}`; // a hearing in another language is kept apart
  const have = practice.heardTranscripts.get(key);
  if (fits(have)) return have;
  const seg = !force ? segmentFor(win) : null;
  if (seg) {
    const t = await seg.promise;
    if (practice.take !== take) return null;
    if (t && t.language === language) {
      const abs = shiftTranscript(t, seg.from, take.duration);
      practice.heardTranscripts.set(key, abs);
      return abs;
    }
  }
  const old = practice.heardJobs.get(key);
  if (old && old.take === take && fits(old)) return old.promise;
  if (old) old.ctrl.abort();
  const ctrl = new AbortController();
  const job = { take, language, tier, ctrl, promise: null };
  const sr = take.sampleRate;
  const from = win ? Math.max(0, Math.round((win[0] - TAKE_PART_PAD_SEC) * sr)) : 0;
  const to = win ? Math.min(take.samples.length, Math.round((win[1] + TAKE_PART_PAD_SEC) * sr)) : take.samples.length;
  const samples = win ? take.samples.subarray(from, to) : take.samples;
  const what = win ? `your attempt (${fmtTime(win[0])}–${fmtTime(win[1])})` : 'your attempt';
  sttProgress.show('Starting…', () => ctrl.abort());
  job.promise = runTranscription(samples, sr, sttProgress, what, ctrl.signal, { language })
    .then((t) => {
      const abs = win ? shiftTranscript(t, from / sr, take.duration) : t;
      if (practice.take === take) practice.heardTranscripts.set(key, abs);
      return abs;
    })
    .catch((err) => { if (isStopped(err)) return null; throw err; })
    .finally(() => { if (practice.heardJobs.get(key) === job) { practice.heardJobs.delete(key); if (!practice.heardJobs.size) sttProgress.hide(); } });
  practice.heardJobs.set(key, job);
  return job.promise;
}
// The take's words for a report are heard in the language the text is shown in; Whisper
// knows Sanskrit chant far better as Sanskrit than as Kannada, Telugu or English, so when
// that hearing is poor (under 40 % of the sloka's words) the part is heard again as
// Sanskrit and the better of the two kept — written in the chosen script either way.
async function hearAgainIfPoor(res, refT, heardT, baseDuration, force = false) {
  const take = practice.take;
  const ws = refT && heardT && take ? wordSimilarity(res, refT, heardT, baseDuration, take.duration) : null;
  if (!take || !refT || !heardT || sttSettings.language === 'sanskrit' || (ws && ws.similarity >= 0.4)) return { heardT, ws };
  let again = null;
  try { again = await transcribeTakePart(heardPartOf(res), force, 'sanskrit'); } catch { again = null; }
  if (practice.take !== take || !again) return { heardT, ws };
  const ws2 = wordSimilarity(res, refT, again, baseDuration, take.duration);
  return ws2 && (!ws || ws2.similarity > ws.similarity) ? { heardT: again, ws: ws2 } : { heardT, ws };
}
// Every report's words in the background once the take is compared: each sloka's stretch of
// the take is transcribed in turn, the open report's first, and its word scores computed as
// they arrive, so a report opens with its words ready and a session's scores cover every
// sloka. A quiz scores its words in its own pass; with transcription not automatic, nothing
// runs until asked.
async function transcribeAllParts() {
  if (practice.quiz || !sttSettings.auto) return;
  const take = practice.take;
  const ids = reportIds().filter((id) => isReport(practice.results.get(id)));
  if (ids.length < 2) return; // one report: it transcribes itself when it opens
  const order = [practice.activeId, ...ids].filter((id, i, a) => ids.includes(id) && a.indexOf(id) === i);
  for (const id of order) {
    if (practice.take !== take) return;
    if (practice.wordSims.has(id) || partialOf(id)) continue; // less than half recited: no words asked for
    if (practice.listenStopped && id !== practice.activeId) continue; // the listening was stopped: only the open report's words
    const res = practice.results.get(id);
    try {
      const heardT = await transcribeTakePart(heardPartOf(res), false);
      if (practice.take !== take || !heardT) return;
      const base = await ensureBase(id);
      const ref = referenceWords(base, res);
      if (!ref) continue; // the sloka has no words: nothing to compare the words with
      const { ws } = await hearAgainIfPoor(res, ref, heardT, base.duration, false);
      if (practice.take !== take || !ws) continue;
      if (!practice.wordSims.has(id)) {
        practice.wordSims.set(id, ws.similarity);
        if (ws.phonology) practice.phonology.set(id, ws.phonology);
      }
      refreshVerdicts();
      syncSession();
    } catch (err) {
      if (isStopped(err)) return;
      // the report says why when it is opened
    }
  }
}
function stopTakeTranscriptions() {
  for (const job of practice.heardJobs.values()) job.ctrl.abort();
}

// The sloka's typed text as the reference for its words, when the whole sloka was compared
// (a text has no timings, so it cannot be windowed to a part). null: use the transcript.
// The sloka's words, for the comparison and the Sloka text row: the Gītā's (the verse the
// recording is linked to, with its timings), else the text typed in its details, else a
// transcript someone corrected — never Whisper's hearing of the teacher's recording, which
// is not transcribed in Learn, Self Evaluation or a quiz. null when the sloka has no words.
function referenceWords(base, res = null) {
  if (!base) return null;
  const t = base.transcript;
  if (t && t.from === 'reference') return t;
  const typed = typedReference(base, res);
  if (typed) return typed;
  if (t && t.edited) return t;
  return null;
}
function typedReference(base, res) {
  const meta = base.record && base.record.meta;
  const text = meta && meta.text && meta.text.body && meta.text.origin !== 'transcript' ? meta.text : null;
  if (!text) return null;
  const win = res && res.matched && res.matched.base;
  const whole = !win || (win[0] <= 0.75 && win[1] >= base.duration - 0.75);
  if (!whole && base.transcript) return null;
  return { text: toDeva(text.body), chunks: [], language: 'sanskrit', typed: true };
}

let sttBothInflight = null;
// Shows the word diff for the open report. The attempt is transcribed once per take, the
// sloka only if it has no usable transcript yet (its typed text, when there is one, is the
// reference instead).
function transcribeBoth(force) {
  if (!practice.base || !practice.take || !practice.result) { if (force) toast('Record an attempt first.', 'info'); return Promise.resolve(); }
  if (sttBothInflight) return sttBothInflight;
  const btn = $('#stt-run');
  const id = practice.activeId;
  const take = practice.take;
  const current = () => practice.activeId === id && practice.take === take && !!practice.result;
  sttBothInflight = (async () => {
    btn.disabled = true;
    try {
      getCtx();
      const baseT = referenceWords(practice.base, practice.result);
      if (!baseT) { $('#stt-summary').textContent = NO_WORDS_NOTE; settleEvaluating(); return; } // no words to compare with: the report stands on the sound alone
      if (partialOf(id)) { $('#stt-summary').textContent = `${slipsLabel(slipsOf(id))}: not transcribed, not scored. Needs practice.`; settleEvaluating(); return; }
      let heardT = await transcribeTakePart(heardPartOf(practice.result), force);
      if (!current() || !heardT) return; // stopped: the report stays without a word diff
      heardT = (await hearAgainIfPoor(practice.result, baseT, heardT, practice.base.duration, force)).heardT;
      if (!current()) return;
      sttPractice.base = baseT;
      sttPractice.heard = heardT;
      renderTranscriptDiff();
    } catch (err) {
      toast(err.message, 'error', 9000);
    } finally {
      btn.disabled = false;
      sttBothInflight = null;
      // another report was opened while this ran: do the same for the one now on screen
      if (practice.activeId !== id && practice.result && (sttSettings.auto || practice.heardTranscripts.size)) transcribeBoth(false);
      // no words for this report (stopped, or failed): it shows without them
      else if (current() && !sttPractice.heard && !(practice.quiz && (quizScoring || !practice.quizAttempt))) setEvaluating(false);
    }
  })();
  return sttBothInflight;
}

// The word diff of a sloka and the take, over the parts of each that were compared.
function windowedDiff(res, baseT, heardT, baseDuration, takeDuration) {
  const A = windowedTokens(baseT, res.matched.base, baseDuration);
  const B = windowedTokens(heardT, res.matched.heard, takeDuration);
  const ai = A.toks.map((_, i) => i).filter((i) => A.inside[i]);
  const bi = B.toks.map((_, i) => i).filter((i) => B.inside[i]);
  const aw = ai.map((i) => A.toks[i].norm);
  const bw = bi.map((i) => B.toks[i].norm);
  // character by character, blind to word breaks; whole words only for texts too long for that
  let cmp = compareWords(aw, bw);
  if (!cmp) {
    const ops = diffWords(aw, bw);
    cmp = { delA: new Set(), insB: new Set(), summary: diffSummary(ops, aw.length, bw.length) };
    for (const o of ops) { if (o.op === 'delete') cmp.delA.add(o.a); else if (o.op === 'insert') cmp.insB.add(o.b); }
  }
  const delA = new Set([...cmp.delA].map((k) => ai[k]));
  const insB = new Set([...cmp.insB].map((k) => bi[k]));
  const dimA = new Set(A.toks.map((_, i) => i).filter((i) => !A.inside[i]));
  const dimB = new Set(B.toks.map((_, i) => i).filter((i) => !B.inside[i]));
  // the same words, as text, for the akṣara-and-phoneme comparison
  // pāda by pāda when the whole text was compared (the metre is read from the text itself)
  const perPada = ai.length === A.toks.length ? identifyChandas(baseT.text).perPada : null;
  const offset = perPada ? uvacaOffset(baseT.text) : 0; // the pādas start after "arjuna uvāca"
  const phonology = ai.length ? comparePhonology(ai.map((i) => A.toks[i].word).join(' '), bi.map((i) => B.toks[i].word).join(' '), { perPada, offset }) : null;
  // the learner correcting themself: a word said twice, a pāda or the sloka started again
  let corrections = [];
  if (ai.length) {
    const refToks = ai.map((i) => A.toks[i]);
    const heardToks = bi.map((i) => B.toks[i]);
    let refPada = null;
    if (perPada) { refPada = []; let acc = 0; for (const t of refToks) { refPada.push(acc < offset ? 0 : 1 + Math.floor((acc - offset) / perPada)); acc += syllabify(t.word).length; } }
    corrections = findSelfCorrections(refToks, heardToks, { refPada }).map((c) => { const tok = heardToks[c.at]; const ch = tok && heardT.chunks && heardT.chunks[tok.chunk]; return { ...c, at: ch && typeof ch.start === 'number' ? ch.start : undefined }; });
  }
  return { A, B, ai, bi, delA, insB, dimA, dimB, summary: cmp.summary, phonology, corrections };
}
// What the words found the learner correcting, kept as this sloka's slips (replacing what
// the words found before; a restart the sound heard already only gains its word).
function setWordSlips(id, corrections) {
  if (!id) return;
  const list = (practice.slips.get(id) || []).filter((x) => !(x.by === 'words' && (x.kind === 'repeat' || x.kind === 'restart')));
  for (const c of corrections || []) {
    if (c.kind === 'restart') {
      const same = list.find((x) => x.kind === 'restart' && x.pada != null && x.pada === c.pada);
      if (same) { if (!same.word) same.word = c.word; continue; }
    }
    const slip = { kind: c.kind, word: c.word, by: 'words' };
    if (c.pada != null) slip.pada = c.pada;
    if (c.at != null) slip.at = Math.round(c.at * 100) / 100;
    list.push(slip);
  }
  practice.slips.set(id, list);
}
// The points a sloka lost to self-correction, said under its score.
function penaltyText(raw, overall, slips) {
  const sc = selfCorrections(slips);
  if (!sc.length || raw == null || overall == null) return '';
  return `Lost ${raw - overall} point${raw - overall === 1 ? '' : 's'} (${Math.round(SLIP_PENALTY * 100)} %) for self-correction: ${slipsLabel(sc)}`;
}

// The akṣara-and-phoneme breakdown under the word diff: what kind of slips, with examples.
// A folded <details>: the scores in its summary line, the slips inside. Its open state is
// kept while the report lives (a re-render after a transcript edit does not fold it again).
function renderPhonologyReport(host, ph) {
  const wasOpen = host.open;
  host.innerHTML = '';
  if (!ph) { setHidden(host, true); host.open = false; return; }
  setHidden(host, false);
  const sum = document.createElement('summary');
  sum.innerHTML = '<svg class="step-caret" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg><h4></h4>';
  $('h4', sum).textContent = `Sounds and syllables · phonemes ${ph.phonemes ?? '–'} · vowel length ${ph.vowels ?? '–'} · syllables ${ph.syllables}`;
  host.appendChild(sum);
  const body = document.createElement('div');
  body.className = 'phon-body';
  const p = document.createElement('div');
  p.className = 'muted small';
  const parts = Object.entries(ph.errors).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} × ${ERROR_LABEL[k]}`);
  const echoes = ph.counts.visargaEchoes ? ` · ${ph.counts.visargaEchoes} visarga${ph.counts.visargaEchoes === 1 ? '' : 's'} Whisper wrote out as "ha", read as ḥ` : '';
  const sandhi = ph.counts.visargaSandhi ? ` · ${ph.counts.visargaSandhi} visarga${ph.counts.visargaSandhi === 1 ? '' : 's'} sounded by the sandhi rule before k / p / s (jihvāmūlīya, upadhmānīya, the sibilant), read as ḥ` : '';
  p.textContent = `${ph.counts.ref} akṣaras in the text, ${ph.counts.heard} heard · ${ph.counts.missing} missing, ${ph.counts.added} added, ${ph.counts.replaced} replaced · ${parts.length ? parts.join(' · ') : 'no slips in the sounds'}${echoes}${sandhi}`;
  body.appendChild(p);
  if (ph.padas && ph.padas.length > 1) {
    const q = document.createElement('div');
    q.className = 'muted small phon-padas';
    const per = ph.padas[0].ref; // the text's akṣaras per pāda
    const cells = ph.padas.map((pd, i) => `pāda ${i + 1}: ${pd.heard} of ${pd.ref}${pd.missing ? ` (${pd.missing} missing)` : ''}${pd.added ? ` (+${pd.added})` : ''}`);
    q.textContent = `${per === 11 ? 'Triṣṭubh' : per === 8 ? 'Anuṣṭubh' : 'Pādas'} · syllables heard per pāda — ${cells.join(' · ')}`;
    body.appendChild(q);
  }
  if (ph.examples.length) {
    const ul = document.createElement('ul');
    for (const e of ph.examples) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="ak"></span> heard as <span class="ak-heard"></span> <span class="muted small"></span>`;
      li.children[0].textContent = e.ref;
      li.children[1].textContent = e.heard || '∅';
      li.children[2].textContent = `— ${ERROR_LABEL[e.kind]}: ${e.detail}`;
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }
  host.appendChild(body);
  host.open = wasOpen;
}

function renderTranscriptDiff() {
  const res = practice.result;
  if (!res || !practice.base || !practice.take || !sttPractice.base || !sttPractice.heard) return;
  const { A, B, ai, delA, insB, dimA, dimB, summary: sm, phonology, corrections } = windowedDiff(res, sttPractice.base, sttPractice.heard, practice.base.duration, practice.take.duration);
  if (ai.length) {
    practice.wordSims.set(practice.activeId, sm.similarity);
    if (phonology) practice.phonology.set(practice.activeId, phonology);
    setWordSlips(practice.activeId, corrections);
    // a "not this sloka" verdict from the timbre is overturned when the words say otherwise
    if (confirmByWords(res, sm.similarity, ai.length)) {
      toast('The words confirm this is the sloka, though the recordings sound different; its scores now count.', 'info', 7000);
      const notes = $('#result-notes');
      notes.innerHTML = '';
      for (const n of res.notes) { const li = document.createElement('li'); li.textContent = n; notes.appendChild(li); }
    }
    syncSession();
  }
  renderPhonologyReport($('#stt-phon'), phonology);
  renderCorrections($('#stt-corrections'), slipsOf(practice.activeId));
  refreshVerdicts();
  // both rows in the sloka's metre: its lines and daṇḍas, the recitation laid out the same way
  const pp = (chandasOf(practice.base.record, sttPractice.base.text) || {}).perPada || null;
  renderTranscriptText($('#stt-base'), sttPractice.base, A.toks, delA, 'w-del', (s, e) => { heardPlayer.pause(); basePlayer.playRange(s, e); }, dimA, true, pp);
  renderTranscriptText($('#stt-heard'), sttPractice.heard, B.toks, insB, 'w-ins', (s, e) => { basePlayer.pause(); heardPlayer.playRange(s, e); }, dimB, true, pp);
  practicePanel.highlight(delA, 'w-del', dimA);
  $('#stt-summary').textContent = ai.length
    ? `${Math.round(sm.similarity * 100)}% of the sloka's ${sttPractice.base.typed ? 'typed text' : 'text'} heard (${sm.matched} of ${ai.length} words) · ${sm.missing} missing · ${sm.extra} extra or different · ${sttLanguageLabel(sttPractice.base.language)}`
    : 'Nothing was recognised in the sloka. Try again.';
  setHidden($('#stt-out'), false);
  settleEvaluating(); // the open report's words are on screen
}

// Under the words: what the learner corrected — the word said again, the word a pāda or
// the sloka was started again at — and what it cost.
function renderCorrections(host, slips) {
  const sc = selfCorrections(slips);
  host.innerHTML = '';
  setHidden(host, !sc.length);
  if (!sc.length) return;
  const lead = document.createElement('b');
  lead.textContent = `Self-correction · ${Math.round(SLIP_PENALTY * 100)} % off this sloka's score: `;
  host.appendChild(lead);
  const ul = document.createElement('ul');
  for (const x of sc) {
    const li = document.createElement('li');
    const w = x.word ? `<span class="cw">${escapeHtml(inScript(x.word, displayLanguage()))}</span>` : '';
    li.innerHTML = x.kind === 'repeat' ? `the word ${w} said twice` : x.kind === 'falseStart' || x.pada === 0 || (x.pada === 1 && x.by === 'words' && x.refIndex === 0) ? `the sloka started again${w ? ` at ${w}` : ''}` : `pāda ${x.pada != null ? x.pada : '?'} started again${w ? ` at ${w}` : ''}`;
    ul.appendChild(li);
  }
  host.appendChild(ul);
}

// Library › what a sloka's sidecar says, in a glance: who, how judged, text, voice.
function renderLibTags(host, r) {
  host.innerHTML = '';
  const meta = r.meta;
  const tag = (text, cls = '', title = '') => { const s = document.createElement('span'); s.className = `lib-tag${cls ? ` ${cls}` : ''}`; s.textContent = text; if (title) s.title = title; host.appendChild(s); };
  if (!meta) { tag('no details', 'warn'); return; }
  const sp = speakerOf(meta);
  const who = sp && sp.profileId ? profileById(sp.profileId) : null;
  if (who) tag(`by ${who.name}`); else if (sp) tag(speakerLabel(sp));
  if (meta.verse) tag(`Gītā ${meta.verse.id}${r.verseCurrent === false ? ' · text differs from the dataset' : ''}`, r.verseCurrent === false ? 'warn' : 'verse', meta.verse.text && meta.verse.text.deva ? meta.verse.text.deva.join(' ') : '');
  if (meta.migrated) tag('style not set · judged as chant', 'warn');
  else tag(styleMode(meta.style && meta.style.mode).label);
  // a recording whose voice barely rises above the room blurs every comparison against it
  if (meta.measured && meta.measured.snrDb != null && meta.measured.snrDb < 25) tag(`noisy · ${Math.round(meta.measured.snrDb)} dB`, 'warn', `The voice is only ${Math.round(meta.measured.snrDb)} dB above the room noise; evaluations against this recording are less reliable. Record it again in a quiet moment (Learn), then delete this one.`);
  if (meta.text && meta.text.aksharaCount) tag(`${meta.text.aksharaCount} akṣaras`);
  if (meta.chandas && meta.chandas.family) tag(meta.chandas.exact ? meta.chandas.name : `${meta.chandas.name} · ${meta.chandas.syllables} of ${meta.chandas.expectedSyllables} syllables`, meta.chandas.exact ? '' : 'warn', `${chandasLabel(meta.chandas)} · from the ${meta.chandas.source}`);
  if (meta.voice && meta.voice.medianF0Hz) tag(`${Math.round(meta.voice.medianF0Hz)} Hz`);
  setHidden(host, !host.childElementCount);
}

// Library › Details panel: the metadata, editable, plus what was measured.
function libDetailsPanel(li, r) {
  let host = $('.lib-details', li);
  if (host) { host.hidden = !host.hidden; return; }
  host = document.createElement('div');
  host.className = 'lib-details';
  host.innerHTML = '<div class="lib-verse"></div><div class="meta-fields"></div><dl class="lib-measured"></dl><div class="row-actions left"><button class="btn btn-sm btn-primary" type="button" data-act="save">Save details</button><span class="muted small" data-f="status"></span></div>';
  li.appendChild(host);
  const fields = buildMetaFields($('.meta-fields', host), { compact: true });
  const dl = $('.lib-measured', host);
  const status = $('[data-f="status"]', host);
  const showMeasured = (meta) => {
    dl.innerHTML = '';
    const rows = [];
    const v = meta && meta.voice;
    const m = meta && meta.measured;
    const c = meta && meta.capture;
    if (v && v.medianF0Hz) rows.push(['Voice', `median ${Math.round(v.medianF0Hz)} Hz (${Math.round(v.f0P10Hz)}–${Math.round(v.f0P90Hz)} Hz, ${v.f0RangeSemitones} st range)`]);
    if (v && v.tempoSylPerSec) rows.push(['Pace', `${v.tempoSylPerSec} akṣaras per second`]);
    if (m && m.snrDb != null) rows.push(['Recording', `peak ${m.peakDbfs} dBFS · noise floor ${m.noiseFloorDbfs} dBFS · SNR ${m.snrDb} dB${m.clippedSampleCount ? ` · ${m.clippedSampleCount} clipped samples` : ''}`]);
    if (c && c.device) rows.push(['Microphone', `${c.device}${c.sampleRate ? ` · ${c.sampleRate} Hz` : ''}${c.echoCancellation === false && c.noiseSuppression === false ? ' · raw (no processing)' : ''}`]);
    if (meta && meta.edit && (meta.edit.trimStartSec || meta.edit.trimEndSec)) rows.push(['Trimmed', `${meta.edit.trimStartSec.toFixed(1)} s from the start, ${meta.edit.trimEndSec.toFixed(1)} s from the end`]);
    if (meta && meta.audio && meta.audio.pcmSha256) rows.push(['Audio id', meta.audio.pcmSha256.slice(0, 16)]);
    for (const [k, val] of rows) { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = val; dl.append(dt, dd); }
    setHidden(dl, !rows.length);
  };
  const apply = (meta) => {
    fields.set(meta);
    fields.lockText(!!(meta && meta.verse), lockNote(meta));
    showMeasured(meta);
    renderVerseBox($('.lib-verse', host), r, meta, apply);
    const tp = $('.lib-transcript', li); // an open transcript panel follows the link
    if (tp && tp.__panel) tp.__panel.setEditable(!(meta && meta.verse), lockNote(meta));
  };
  apply(r.meta);
  if (!r.meta) api.getMeta(r.id).then(apply).catch(() => {});
  $('[data-act="save"]', host).addEventListener('click', async () => {
    const v = fields.read();
    status.textContent = 'Saving…';
    try {
      const meta = await api.patchMeta(r.id, { speaker: v.speaker || { profileId: null, voiceType: 'preferNotToSay', ageGroup: 'unspecified' }, style: v.style, text: v.text });
      r.meta = meta;
      const loaded = practice.bases.get(r.id);
      if (loaded) loaded.record.meta = meta;
      libraryCache = null;
      renderLibTags($('.lib-tags', li), r);
      apply(meta);
      status.textContent = 'Saved.';
      toast('Details saved with the sloka.', 'success');
    } catch (err) { status.textContent = ''; toast(err.message, 'error'); }
  });
}

// The words of a linked recording are the dataset's: neither its text nor its transcript is edited.
const lockNote = (meta) => (meta && meta.verse ? `The words shown are the Gītā's, verse ${meta.verse.id}, from the reference dataset, and are not edited here. Unlink the verse under Details to type your own text; a meaning or notes can be added to the verse there.` : '');

// Library › Details › the verse of the reference dataset this recording is a recording of:
// the link (made by name on save, by "Link to the Gītā", or here), the dataset's text, and
// the verse's own customisations — a corrected text, a translation, notes — kept in the
// app's data (<data>/reference/gita.custom.json) over the read-only dataset.
let referenceIds = null; // the datasets the server found, once asked
async function referenceDatasets() {
  if (referenceIds) return referenceIds;
  try { referenceIds = (await api.listReference()).filter((d) => !d.errors.length).map((d) => d.id); } catch { referenceIds = []; }
  return referenceIds;
}
function renderVerseBox(box, r, meta, apply) {
  box.innerHTML = '';
  referenceDatasets().then(async (ids) => {
    if (!ids.length) { box.hidden = true; return; }
    box.hidden = false;
    const link = meta && meta.verse;
    const head = document.createElement('div');
    head.className = 'lib-verse-head';
    const title = document.createElement('strong');
    const actions = document.createElement('span');
    actions.className = 'row-actions';
    const btn = (label, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = `btn btn-sm ${cls}`; b.textContent = label; b.addEventListener('click', fn); actions.appendChild(b); return b; };
    const relink = async () => {
      const guess = mapNameToVerse(r.name, r.folder || '');
      const ans = await askDialog({ title: 'Link to a verse of the Gītā', message: 'The verse this recording is a recording of, as chapter.verse (12.3), or 1.21-22 for two recited as one, or 12.colophon.', label: 'Verse', value: link ? link.id : guess ? guess.id : '', okText: 'Link' });
      if (!ans) return;
      const id = String(ans.text !== undefined ? ans.text : ans).trim();
      if (!parseVerseId(id)) { toast('That is not a verse id.', 'error'); return; }
      try { const m = await api.linkVerse(r.id, { dataset: ids[0], verseId: id }); r.meta = m; const loaded = practice.bases.get(r.id); if (loaded) loaded.record.meta = m; libraryCache = null; renderLibTags($('.lib-tags', r.li || box.closest('li')), r); apply(m); toast(`Linked to Gītā ${id}.`, 'success'); } catch (err) { toast(err.message, 'error'); }
    };
    if (!link) {
      title.textContent = 'Not linked to the Gītā';
      btn('Link…', 'btn-primary', relink);
      head.append(title, actions);
      box.appendChild(head);
      const hint = document.createElement('div');
      hint.className = 'muted small';
      const guess = mapNameToVerse(r.name, r.folder || '');
      hint.textContent = guess ? `The name reads as verse ${guess.id}; "Link to the Gītā" in the toolbar links every recording whose name reads this way.` : 'A name like CH12-03 would read as a verse by itself.';
      box.appendChild(hint);
      return;
    }
    const metre = link.metre && link.metre.name ? ` · ${link.metre.name}` : '';
    title.textContent = `Gītā ${link.id}${metre}`;
    btn('Change…', 'btn-ghost', relink);
    btn('Unlink', 'btn-ghost', async () => { try { const m = await api.unlinkVerse(r.id); r.meta = m; r.verseCurrent = null; const loaded = practice.bases.get(r.id); if (loaded) loaded.record.meta = m; libraryCache = null; renderLibTags($('.lib-tags', box.closest('li')), r); apply(m); toast('Unlinked.', 'info'); } catch (err) { toast(err.message, 'error'); } });
    head.append(title, actions);
    box.appendChild(head);
    const text = document.createElement('div');
    text.className = 'lib-verse-text stt-text';
    const copy = { speaker: { deva: link.text ? link.text.speaker : null }, deva: (link.text && link.text.deva) || [] }; // the sidecar's copy of the verse
    text.innerHTML = scriptHtml(withDandas(layoutSloka(verseBody(copy, { speakerLine: link.speakerLineRecited }), { perPada: link.metre && link.metre.family === 'trishtubh' ? 11 : 8, lines: slokaLines })));
    box.appendChild(text);
    const sub = document.createElement('div');
    sub.className = 'muted small';
    sub.textContent = `From the ${link.dataset} dataset${link.datasetVersion ? ` (version ${link.datasetVersion})` : ''}, linked by ${{ name: 'its name', learn: 'Learn', migration: '"Link to the Gītā"', manual: 'hand' }[link.mappedBy] || link.mappedBy}${r.verseCurrent === false ? ' · the dataset\'s text has changed since' : ''}${meta.text && meta.text.origin === 'typed' ? ' · the text typed below is the reference for comparisons' : ' · this text is the reference for comparisons'}.`;
    box.appendChild(sub);
    // the verse's customisations: a translation of your own, notes
    let entry = null;
    try { entry = await api.getVerse(link.dataset, link.id); } catch { entry = null; }
    const custom = (entry && entry.custom) || {};
    const form = document.createElement('div');
    form.className = 'lib-verse-custom';
    form.innerHTML = `<div class="field-label">Your additions to verse ${link.id} <em class="muted">(kept in your data, shown wherever the verse is)</em></div>
      <label class="field"><span>Meaning in your words (${langName(displayLanguage())})</span><textarea data-f="translation" rows="2" placeholder="${entry && entry.translations && entry.translations.en ? entry.translations.en.slice(0, 120) : ''}"></textarea></label>
      <label class="field"><span>Notes on this verse</span><textarea data-f="notes" rows="2" placeholder="how it is recited, a variant reading…"></textarea></label>
      <div class="row-actions left"><button class="btn btn-sm" type="button" data-act="save-custom">Save additions</button><span class="muted small" data-f="custom-status"></span></div>`;
    const lang = { sanskrit: 'sa', kannada: 'kn', telugu: 'te', english: 'en' }[displayLanguage()] || 'en';
    const trEl = $('[data-f="translation"]', form);
    const notesEl = $('[data-f="notes"]', form);
    trEl.value = (custom.translations && custom.translations[lang]) || '';
    notesEl.value = custom.notes || '';
    $('[data-act="save-custom"]', form).addEventListener('click', async () => {
      const st = $('[data-f="custom-status"]', form);
      st.textContent = 'Saving…';
      try {
        const fields = { ...custom, translations: { ...(custom.translations || {}), [lang]: trEl.value.trim() }, notes: notesEl.value.trim() };
        if (!fields.translations[lang]) delete fields.translations[lang];
        await api.putVerseCustom(link.dataset, link.id, fields);
        const loaded = practice.bases.get(r.id); if (loaded) loaded.verseEntry = null;
        st.textContent = 'Saved.';
        toast('Your additions to the verse are saved.', 'success');
      } catch (err) { st.textContent = ''; toast(err.message, 'error'); }
    });
    box.appendChild(form);
  });
}

// Library › Transcript panel (editable, stored with the sloka)
function libTranscriptPanel(li, r) {
  let host = $('.lib-transcript', li);
  if (host) { host.hidden = !host.hidden; return; }
  host = document.createElement('div');
  host.className = 'lib-transcript transcript-panel';
  li.appendChild(host);
  let store = null; // every language this sloka is transcribed in; the panel shows the chosen one
  const panel = createTranscriptPanel(host, {
    editable: !(r.meta && r.meta.verse), // a linked recording's words are the dataset's
    controls: false, // no Transcribe button, no model: "Transcribe all" in the toolbar makes the missing words
    play: (s, e) => playLibraryRange(r, s, e),
    onChange: async (t) => {
      store = await api.putTranscript(r.id, t);
      panel.setOthers(store);
      const loaded = practice.bases.get(r.id);
      if (loaded) { loaded.transcripts = store; loaded.transcript = transcriptIn(store); }
      if (practice.activeId === r.id && practice.base) practicePanel.set(transcriptIn(store), store);
      notifyTranscripts(r.id, store);
      toast('Transcript saved with the sloka.', 'success');
    },
  });
  panel.setSource(async () => {
    getCtx();
    const dec = await decodeBlob(await api.fetchAudioBlob(r.id));
    return { samples: dec.samples, sampleRate: dec.sampleRate, what: `"${r.name}"` };
  });
  host.__panel = panel;
  panel.setEditable(!(r.meta && r.meta.verse), lockNote(r.meta));
  const show = () => panel.swap(transcriptIn(store), store);
  api.getTranscript(r.id).then((s) => { store = s; show(); }).catch(() => {});
  const onLanguage = () => { if (!host.isConnected) { sttLanguageListeners.delete(onLanguage); return; } show(); };
  sttLanguageListeners.add(onLanguage);
  const onStored = (id, s) => {
    if (!host.isConnected) { transcriptListeners.delete(onStored); return; }
    if (id !== r.id) return;
    store = s;
    if (!panel.transcript && !panel.busy && transcriptIn(store)) show(); else panel.setOthers(store);
  };
  transcriptListeners.add(onStored);
}

// Library › every recording whose name names a verse of the Gītā (CH12-03 → 12.3) is linked
// to it; a recording whose transcript does not match the verse's words is listed, not linked.
$('#library-link-verses').addEventListener('click', async () => {
  const ids = await referenceDatasets();
  if (!ids.length) { toast('No reference dataset was found.', 'error'); return; }
  const btn = $('#library-link-verses');
  btn.disabled = true;
  try {
    const rep = await api.mapVerses(ids[0], { write: true });
    const words = await api.wordsFromVerses(ids[0], {}); // every linked recording's words from its verse
    const parts = [`${rep.linked} linked`, `${words.written.length} with the verse's words`];
    if (rep.doubtful.length) parts.push(`${rep.doubtful.length} doubtful, left alone (${rep.doubtful.map((d) => `${d.name} → ${d.verse}`).join(', ')})`);
    if (rep.unmapped.length) parts.push(`${rep.unmapped.length} without a verse in the name (${rep.unmapped.map((d) => d.name).join(', ')})`);
    toast(parts.join(' · '), rep.linked ? 'success' : 'info', 9000);
    libraryCache = null;
    await refreshLibrary();
  } catch (err) { toast(err.message, 'error', 6000); } finally { btn.disabled = false; }
});

// Library › every sloka without words yet, in the background.
$('#library-transcribe-all').addEventListener('click', async () => {
  const list = await getLibrary();
  let queued = 0;
  for (const r of list) {
    const store = await api.getTranscript(r.id).catch(() => null);
    const missing = missingLanguages(store);
    if (!missing.length) continue;
    queueBackgroundTranscription(r, async () => {
      const loaded = practice.bases.get(r.id);
      if (loaded) return { samples: loaded.samples, sampleRate: loaded.sampleRate };
      getCtx();
      return decodeBlob(await api.fetchAudioBlob(r.id));
    }, missing);
    queued += missing.length;
  }
  toast(queued ? `${queued} transcription${queued === 1 ? '' : 's'} queued in the background (see the sidebar).` : 'Every sloka is already transcribed.', 'info', 5000);
});

async function playLibraryRange(r, s, e) {
  getCtx();
  if (libPlayingId !== r.id || !libPlayer.loaded) {
    libPlayingId = r.id;
    await libPlayer.load(api.audioUrl(r.id));
  }
  libPlayer.playRange(s, e);
}

// ---------- start ----------

showView(location.hash.slice(1) || 'home');
getLibrary();
renderLearnerNote();
renderLearnerSelect();
