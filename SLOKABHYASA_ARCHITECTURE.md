# SlokAbhyasa — Architecture

Read from the code as of 2 November 2026 (1.6.0 + Unreleased, `AcousticAssessment`). Where the
README and the code differ, the code is followed. Sections: system shape, module map, workers,
on-disk schemas, HTTP API, algorithms and constants, structural patterns, identifiers.

---

## 1. System shape

```
Chrome (one tab, localhost)                           Node (serve.js, zero dependencies)
┌──────────────────────────────────────────┐          ┌──────────────────────────────────┐
│ index.html + css/styles.css              │  fetch   │ /api/baselines  /api/folders     │
│ js/app.js  (controller, 6 640 lines)     │ ───────▶ │ /api/quizzes    /api/sessions    │
│   ├ Player (HTMLAudioElement)            │  JSON /  │ /api/assessments /api/profiles   │
│   ├ Recorder (AudioWorklet → Float32)    │  WAV     │ /api/badges     /api/reference   │
│   ├ Analyzer ──▶ analysis-worker.js      │          │ static files from the project    │
│   │              (features, compare,     │          └──────────────┬───────────────────┘
│   │               locate)                │                         │ fs
│   ├ Transcriber ─▶ stt-worker.js         │          ┌──────────────▼───────────────────┐
│   │              (Whisper via            │          │ <data>  (local.json /             │
│   │               transformers.js, CDN)  │          │  SLOKABHYASA_DATA)                │
│   ├ SyllableCounter (the live ear)       │          │  library/  quizzes/  sessions/    │
│   └ pure modules: dsp/*, phon, textdiff, │          │  profiles.json  badges.json       │
│     quizscore, canon, chandas, verses,   │          │  speaker-lines/  reference/       │
│     meta, reports, badges, lipi, translit│          │  simulations/  demo/              │
└──────────────────────────────────────────┘          └───────────────────────────────────┘
                                                      reference/gita (in the repo, read-only)
tools/*.mjs (Node CLI: replay, ear-log, second-opinion, debug-note, place-by-sound, …)
test/*.test.js (node --test, 246 tests)
```

The browser never touches the file system; the server never runs DSP except silence trimming
(`js/dsp/trim.js`) and feature-cache validation on upload. Pure modules under `js/` are
imported by the browser, the server, the tools and the tests alike.

---

## 2. Module map

### 2.1 Browser controller and UI (DOM-bound)

| Module | Responsibility | Notes |
|---|---|---|
| `js/app.js` | The controller: routing, state per view, every render function, the live ear, the evaluation pipeline, the words path, sessions, quiz mode, library, settings | Sections banner-marked: helpers · dialog · theme · shared UI bindings · routing · state · STT settings · PEOPLE · LEARN · SELF EVALUATION · QUIZ · REPORTS · LIBRARY · SPEECH TO TEXT · start |
| `js/visualizer.js` | Canvas: waveforms, live meter, comparison chart, `cssVar()` | reads wave/chart tokens from CSS |
| `js/player.js` | `Player`: speed with pitch preservation, range playback, stereo panning | HTMLAudioElement |
| `js/recorder.js` | `Recorder`: microphone → Float32 PCM through an AudioWorklet | |
| `js/analyzer.js` | `Analyzer`: promise wrapper with request ids and progress over the analysis worker | |
| `js/stt.js` | `Transcriber`: wrapper over the speech worker; `STT_LANGUAGES`, `STT_TIERS`, `isStopped(err)` | |
| `js/earlog.js` | `EarLog`: cheap rows while recording, kept with the session | pure |
| `js/api.js` | Client of the HTTP API (one function per endpoint) | |

### 2.2 Pure, shared (browser + Node + tests)

| Module | Responsibility |
|---|---|
| `js/dsp/features.js` | Per-frame features at 16 kHz / 20 ms hop: RMS, activity, YIN pitch (semitones + confidence), 12 MFCCs from a smoothed envelope, vocal-tract warps; `serializeFeatures` / `deserializeFeatures`; `FEAT_VERSION = 5` |
| `js/dsp/compare.js` | `compare` (two passes of banded DTW, voice warp, key offset) and `compareAuto` (search inside a longer recording, windows, tempo prior); `MODES`, contrast gate, `confirmByWords/Ear/Second` |
| `js/dsp/dtw.js` | Banded DTW with open, penalised ends; path maps |
| `js/dsp/locate.js` | Subsequence DTW of block-averaged MFCCs; `contrast` = cost forward / cost against the take reversed; `sliceFeatures`, `stretchFeatures`, `rethreshold` |
| `js/dsp/deviations.js` | Deviations on an alignment: pauses, skipped/added material, rushed/dragged, pitch, octave folding |
| `js/dsp/segment.js` | The second opinion: pauses, expectations, cuts by dynamic programme, pins, three methods, `playRangeOf` |
| `js/dsp/ear.js` | The ear's decisions, pure: expected time from the learner's pace, position from nucleus count, close rules, count-ratio calibration, pāda starts from pauses |
| `js/dsp/syllables.js` | `SyllableCounter`: nuclei heard as audio comes in |
| `js/dsp/starts.js` | Pāda-start fingerprints (0.8 s of MFCC frames), calibration, banded match |
| `js/dsp/speakerlines.js` | Speaker-line templates in the learner's voice: harvest, store, find, assign; signature keys |
| `js/dsp/trim.js`, `activity.js`, `resample.js`, `fft.js`, `util.js` | Silence trimming, adaptive activity threshold, Blackman-windowed resampling, radix-2 FFT, numeric helpers |
| `js/phon.js` | Akṣaras and phonemes from Indic text; `comparePhonology` (akṣara alignment, error classes); `syllabify` |
| `js/canon.js` | Canonical phonetic representation: phoneme inventory with features/IPA/CLS, akṣara weights, realisation slots, traditions; `CANON_VERSION = 1` |
| `js/chandas.js` | Metre from text; the Gītā's verse table (`GITA_VERSES`, `GITA_IRREGULAR`, the triṣṭubh list); `aksharaPlan`, `layoutSloka` |
| `js/textdiff.js` | Tokenisation and diff of transcripts; windowed tokens; `neighbourEdges`, `loopedHearing`, `findSelfCorrections`, `refineBoundary` |
| `js/quizscore.js` | Categories, weights, tolerance, grades, slips and penalty, item/attempt overall, random picking |
| `js/meta.js` | Sidecar shape (`newBaselineMeta`, `SCHEMA_VERSION`), vocabularies (`AGE_GROUPS`, `VOICE_TYPES`, `STYLE_MODES`), presets by learner, text derivation, voice stats |
| `js/verses.js` | Verse ids, names and folders, hash input, dataset validation, combined verses, custom merge |
| `js/transcripts.js` | The transcript store per language; text edits applied to timings |
| `js/translit.js`, `js/lipi.js` | Romanised text back to script; Sanskrit written in Kannada/Telugu/IAST with laghu/guru marks |
| `js/reports.js`, `js/badges.js`, `js/advice.js` | Reports arithmetic and progress moments; badge rules; scoreboard advice |
| `js/libutil.js`, `js/wav.js` | Folder names, sloka file names, WAV header; WAV encode/decode |

### 2.3 Node only

| Module | Responsibility |
|---|---|
| `serve.js` | HTTP server and API; index sync from disk; WAV with `bext`; feature-cache validation; delegates to the stores |
| `meta-store.js` | Sidecar read/write/sanitise/move, audio hash, `bext`, `profiles.json`, speaker-lines store |
| `reference.js` | Loads datasets from `<data>/reference/<id>/` then `reference/<id>/`; validates; custom overrides; reloads on manifest change |
| `datadir.js` | `resolveDataDir(root)`, `resolveReferenceDirs` from `local.json` / `SLOKABHYASA_DATA` |
| `tools/*.mjs` | Offline analysis and maintenance (see the README's Layout table) |

---

## 3. Workers and protocols

**Analysis worker** (`js/analysis-worker.js`, module worker). Messages carry `id`; replies
echo it.

| Request | Payload | Reply |
|---|---|---|
| `features` | `{ samples: Float32Array, sampleRate, warps?: boolean }` | `{ type: 'progress', value }`* then `{ type: 'features', features }` |
| `compare` | `{ base, heard, options }` (feature objects) | `{ type: 'result', result }` |
| `contrast` | `{ a, b }` | `{ type: 'result', result: contrast | null }` |
| any | — | `{ type: 'error', message }` |

`Analyzer` (`js/analyzer.js`) keeps `pending: Map<id, {resolve, reject, onProgress}>`; a
worker error rejects every pending request and recreates the worker lazily.

**Speech worker** (`js/stt-worker.js`). Loads transformers.js from a CDN on first use and the
Whisper weights from Hugging Face once (browser cache). Requests `transcribe` carry the audio,
the language code, the tier, a `steady` flag (decoding with repetition penalty 1.3 and
no-repeat n-gram 3) and a cancellation; `Transcriber` resolves with chunks and timestamps;
cancellation surfaces as `AbortError` (`isStopped`). Device: `webgpu` when
`navigator.gpu.requestAdapter()` returns an adapter, else `wasm`; Best (`whisper-large-v3-turbo`)
is `webgpuOnly`. Weights on WebGPU are q4 for the big model with fp32 arithmetic throughout,
never fp16 (Intel Iris Xe advertises shader-f16 and computes garbage with it); q8 on wasm. A
hearing that is nothing or one or two words over and over is taken as a GPU miscomputing
attention and the job is redone on the CPU. `test/stt.test.js` substitutes a `FakeWorker` for
the protocol.

**The live ear** runs on the main thread: `SyllableCounter` consumes recorder frames; every
0.5 s the controller calls `earPositionOf` / `earDecision` (pure) and logs a row to `EarLog`;
sound checks (restart, next head) run a banded DTW on 0.8 s fingerprints and are queued, not
awaited.

---

## 4. On-disk schemas (the data folder)

All JSON is written as `JSON.stringify(x, null, 2) + '\n'`; every file is sanitised on read.

### 4.1 `library/index.json` — array of records
```json
{ "id": "20261031-095934-9wtq", "name": "CH18-09", "file": "CH-18/ch18-09-20261031-095934-9wtq.wav",
  "createdAt": "2026-10-31T13:59:34.316Z", "duration": 15.41, "sampleRate": 48000, "source": "mic" }
```
Re-synced from the disk on every `GET /api/baselines` (files added or moved with Explorer are
picked up). File name = `<folder>/<slug(name)>-<id>.wav`; sidecars share the base name.

### 4.2 `<name>.json` — the sidecar, `schemaVersion "1.1.0"` (`js/meta.js newBaselineMeta`)
| Field | Content |
|---|---|
| `name`, `source` (`mic` / `file`), `role` (`teacher`) | identity |
| `speaker` | `{ profileId, voiceType, ageGroup }` — never a name |
| `style` | `{ mode: plain_sloka | …, pitchPrescribed, tradition }` |
| `text` | `{ body, language: "sa", script: "Deva", padas: [{ index, text, charStart, charEnd, boundaryType }], aksharaCount, pauses: [{ afterPada, kind, licensed }], svara: { prescribed }, origin: reference | typed | transcript, title }` |
| `voice` | `{ medianF0Hz, f0P10Hz, f0P90Hz, f0RangeSemitones, voicedFraction, leadSilence… }` |
| `measured` | `{ durationSec, sampleCount, peakDbfs, rmsDbfs, noiseFloorDbfs, snrDb, clippedSampleCount }` |
| `capture` | microphone and browser processing, or `null` |
| `edit` | `{ trimStartSec, trimEndSec }` |
| `consent` | `{ givenBy: unspecified|self|guardian|teacher, shareScope: private|family|class|public }` |
| `verse` | `{ dataset: "gita", datasetVersion, id: "18.9", kind, chapter, verse, verseEnd, speakerLineRecited, text { speaker, deva[] }, textHash, metre { family, name }, licence, mappedBy: learn|map|hand, pinned, at }` or `null` |
| `chandas` | `{ family, name, perPada, padas, syllables, expectedSyllables, exact, form (pathyā…), weights ("GLGG…"), confidence, source }` (written by Learn, the link, or `tools/chandas.mjs`) |
| `audio` | `{ pcmSha256, durationSec, sampleRate, channels, bitDepth, format }` — the PCM the sidecar describes; checked against the WAV on read |
| `notes`, `id`, `createdAt`, `updatedAt`, `software` | free notes; the record id; timestamps; `{ name: "SlokAbhyasa", version }` that wrote it |

### 4.3 `<name>.features.json` — cache, `featVersion 5`
`sr 16000, hop 320, hopSec 0.02, n, duration, rmsDb[], loud[], active[], st[] (semitones, NaN unvoiced), conf[], mfcc[] (n×12), mfccMean[12], trimStart, trimEnd, peakDb, floorDb, thrDb, activeFrac, voicedFrac`. Rebuilt when `featVersion` differs.

### 4.4 `<name>.transcript.json` — store by language
`{ version: 2, current: "sanskrit", languages: { sanskrit: { language, text, chunks: [{ text, timestamp: [from, to] }], tier, model, device, edited, editedIn, from: whisper|reference|typed, verse }, kannada: …, telugu: …, english: … } }` (`js/transcripts.js normalizeStore`; keys are the Whisper language codes of `STT_LANGUAGES`). `<name>.txt` mirrors the current text.

### 4.5 `profiles.json` — `schemaVersion "1.0.0"`
```json
{ "profiles": [{ "id": "p-20261008195044-8m0l", "name": "Hari", "voiceType": "male", "ageGroup": "60plus",
  "roles": ["learner"], "pace": { "tempoRatio": 1.22, "padaPauseMs": 491, "slokaPauseMs": 703,
  "aksPerSec": 2.17, "countRatio": 1.34, "n": 20 }, "createdAt": "…", "updatedAt": "…" }] }
```
`pace` is learnt from each whole, clean sloka of a take (`calibrateCountRatio`, running means over `n`).

### 4.6 `sessions/<id>.json` — a Self Evaluation or Teach take
| Field | Content |
|---|---|
| `id`, `kind` (`evaluation` / `teach`), `at`, `takeDuration`, `audio: "take.wav"` | |
| `items[]` | per ticked sloka: `id, name, folder, matched, missing, phoneme, vowel, syllable, emphasis, pitch, phrasing, timing` (scores or `null`), `diag { contrast, located (how the sloka was found: on the ear's or the second opinion's window, `heard` when searched for inside the whole take, null whole-to-whole), matchedBy: sound|words|ear|second, matchedBase [from,to], matchedHeard [from,to], tempoRatio, voiceWarp, keyOffset, mode, deviations, contentCoveredPct }`, `slips [{ kind, at, count?, expected?, pada?, by: ear|words|sound, unsure? }]`, `phonology { errors { place, aspiration, voicing, nasality, visarga, vowel, vowelLength, added, other }, counts { ref, heard, missing, added, replaced, phonemesCompared, vowelsCompared, vowelSlips, visargaEchoes, visargaSandhi }, aligned [{ ref, heard, kind }] }` |
| `overall`, `grade` | mean over slokas recited; `excellent|good|fair|practice` |
| `options { ignoreKey, judgeSpeed }`, `tolerance`, `noTolerance`, `weights` (the seven + legacy), `canon { version }`, `learner { profileId, voiceType, ageGroup }` | the settings in force |

### 4.7 `sessions/<id>/ear.json` — the ear's log (takes of several slokas)
`version, take, pace (the learner's), headDetection, words (switch), learner, at, removedStart, takeDuration, segments [{ name, from, to, skipped, byHand }], columns, fields, dropped, rows [[t, wall, nuclei, pos, active, pause, thr, lvl, event…]], secondOpinion { version, recited, items, pace, quiet, sungTotal, spanTotal, pauses, sound, lastPos, pinned, chosen: plan|teacher|share, results { <method>: { cost, scale, hypothesis: whole|partialLast, segments [{ index, from, to, ratio }], boundaries [{ from, to, pinned, virtual, runnerUp }] } }, spread, speakerLines, signatures }, adopted [{ name, ear [from,to], second [from,to], ratio, pinned, offered, kept: second|ear, by, contrast }]`. Read by `tools/ear-log.mjs` (`formatEarLog`).

### 4.8 `quizzes/<id>.json` + `quizzes/<id>/attempt-N.wav`
`id, name, createdAt, folders[], mode: single|several, maxFiles, items [{ id, name, folder }], categories[], attempts [{ at, takeDuration, categories, score, byCategory { … }, counted, recited, items [per sloka scores, correct, slips, diag], tolerance, weights, learner }]`.

### 4.9 `badges.json`, `speaker-lines/<profileId>.json`
Badges: `{ schemaVersion "1.0.0", rule { differentDays }, badges [{ id: "quiz:<quizId>:excellent" | "chapter:<n>" | "gita", kind: quiz|chapter|gita, quizId?, chapter?, title, learner (profile id or "device"), level (1–3 by `LEVELS [3, 5, 10]`), earnedAt, levelAt[] }] }` — derived, rebuilt by `tools/badges.mjs --recompute`; the days and slokas shown with a badge are read from the attempts.
Speaker lines: `{ version: 1, phrases: { dhrtarastra|sanjaya|arjuna|sribhagavan: [template], "sloka:<libraryId>:start"|"…:end": [template] } }`, template = `{ frames, data (base64 Float32 MFCC rows), at, sec, session, sloka, addedAt, seeded? }`.

### 4.10 Reference dataset `reference/<id>/`
`manifest.json` (`schemaVersion, id, work, name, version, sourceCommit, source, licence, attribution, updateUrl, files, sha256, translations, counts, checks, overrides`), `verses.json` (entries `{ id, kind: verse|opening|colophon|…, chapter, verse, verseEnd, speaker { who, deva, iast }, deva[], iast[], metre { family, name }, translations { en }, variants[], recitedWith }`), `LICENSE`, `ATTRIBUTION.txt`. Overrides: `<data>/reference/<id>.custom.json`. Validated by `js/verses.js validateDataset` on load and by `tools/reference-check.mjs`.

---

## 5. HTTP API (`serve.js`, all under `http://127.0.0.1:8787/api`)

Errors are `{ error }` with 400/404/405/500. Audio bodies are `audio/wav`; everything else JSON.

| Family | Method and path | Purpose |
|---|---|---|
| **baselines** | `GET /baselines` | list (re-synced from disk), each with `meta` and `verseCurrent` |
| | `POST /baselines?name&folder&duration&sampleRate&source[&verse&dataset&speakerLine&autolink]` (WAV body) | create; writes sidecar, `bext`; folder required |
| | `GET /baselines/:id` · `PATCH /baselines/:id` · `DELETE /baselines/:id[?backup=1]` | record with meta · rename · delete (to `backup/` when asked) |
| | `GET|HEAD /baselines/:id/audio` | the WAV |
| | `GET|PUT|DELETE /baselines/:id/features` | the cache (validated against `FEAT_VERSION` and the audio hash) |
| | `GET|PUT[?primary=0]|DELETE[?language] /baselines/:id/transcript` | the transcript store |
| | `GET|PUT|PATCH /baselines/:id/meta` | the sidecar (sanitised) |
| | `POST /baselines/:id/trim` | trim silence, original to `backup/`, caches dropped |
| | `GET|PUT|PATCH|DELETE /baselines/:id/verse` | link to a verse / update / unlink |
| | `POST /baselines/:id/move` `{ folder }` | move with sidecars |
| **folders** | `GET /folders` · `POST /folders { name }` | subfolders of the library (≤ 3 levels, `backup` reserved) |
| **quizzes** | `GET /quizzes` · `POST /quizzes` · `GET|PATCH|DELETE /quizzes/:id` | |
| | `POST /quizzes/:id/attempts` · `PUT|GET|HEAD /quizzes/:id/attempts/:n/audio` | an attempt and its recording |
| **sessions** | `GET /sessions` (newest first) · `POST /sessions` · `GET|PUT|PATCH|DELETE /sessions/:id` | |
| | `PUT|GET|HEAD /sessions/:id/audio` · `PUT|GET /sessions/:id/ear` | `take.wav`, `ear.json` |
| **assessments** | `GET /assessments` | quiz attempts and sessions in one shape, by date (Reports, progress, badges) |
| **profiles** | `GET /profiles` · `POST /profiles` · `PATCH|DELETE /profiles/:id` · `GET|PUT /profiles/:id/speaker-lines` | people; the learner's templates |
| **badges** | `GET /badges[?learner]` · `POST /badges/recompute` · `PATCH /badges { rule }` | |
| **reference** | `GET /reference` · `GET /reference/:ds` · `GET /reference/:ds/coverage` · `GET /reference/:ds/chapters/:n` · `GET /reference/:ds/verses/:id` | datasets, chapters with coverage, a verse (combined ids composed) |
| | `PUT|DELETE /reference/:ds/verses/:id/custom` · `POST /reference/:ds/map` · `POST /reference/:ds/words` | overrides; link recordings by name; reference words for transcripts |
| **static** | `GET|HEAD /<path>` | the app's files; never the data folder |

`js/api.js` exposes one function per row (`listBaselines`, `createBaseline`, `putSessionEar`,
`getVerse`, `recomputeBadges`, …) and a `check(res)` that throws the server's `error`.

---

## 6. Algorithms and the constants that define them

| Stage | Where | Key constants |
|---|---|---|
| Features | `features.js` | `SR 16000`, `HOP 320` (20 ms), `MFCC_WIN 512`, `N_MEL 26`, `N_MFCC 12`, `F_MIN 60`–`F_MAX 1230` Hz, `YIN_THRESHOLD 0.15`, `VOICED_ON/OFF 0.25/0.40`, `WARP_ALPHAS 0.67…1.5`, `MEL_DYNAMIC_RANGE_DB 40`, `FEAT_VERSION 5` |
| Comparison | `compare.js` | `MODES` (recitation 0/0.4/0.6, chant 0.2/0.35/0.45, singing, instrument), `LOCATE_RATIO 1.5`, `MISMATCH_CONTRAST 0.87`, `WORD_MATCH_MIN 0.75`, `WORD_SHARE_MIN 0.8`, `EAR_CONFIRM_SHARE 0.5`, `SECOND_CONFIRM_RATIO [0.7, 1.4]`, `SEARCH_TEMPOS [0.5, 0.7, 1, 1.4, 2]`, `SEARCH_CONVINCING 0.95`, `PAUSE_MIN_SEC 0.15`, `PAUSE_SLACK_SEC 0.3`, `EAR_WINDOW_PAD_SEC 0.5` (app) |
| Locate | `locate.js` | block decimation 5 frames, slope 0.5–2, contrast = forward cost / reversed cost (≈ 0.5 same material, ≈ 1 none) |
| The ear | `ear.js` | `DEFAULT_PADA_PAUSE_MS 600`, `DEFAULT_SLOKA_PAUSE_MS 1000`, `STOP_PAUSE_MS 4000`, `MIN_SUNG_MS 3000`, `RUN_ON_MS 500`; learner's `countRatio`, `aksPerSec` |
| Second opinion | `segment.js` | `MIN_GAP_SEC 0.25`, `GAP_FREE_SEC 1.0`, `GAP_COST 0.15`, `SCALE_MIN/MAX 0.6/1.6` step 1.05, `SCALE_PRIOR 0.5`, `LENGTH_WEIGHT 1`, `THROUGH_COST 0.2`, `VALLEY_*`, `QUIET_SHARE 0.4`, `QUIET_MIN_DB 6`, `LAST_WHOLE_FROM 0.6`, `LAST_PARTIAL_TO 0.5`, `PIN_REACH_SEC 1.5` |
| Fingerprints | `starts.js` | `TEMPLATE_SEC 0.8`, calibrated thresholds per recording |
| Words | `textdiff.js` | `loopedHearing` (3× run; > 1.3× akṣaras with a run ≥ 10 said twice; `maxL 80`), `SELF_CORR_EXACT_UNDER 8`, `CHAR_DIFF_MAX_CELLS 2e6` |
| Scoring | `quizscore.js` | weights 30/25/15/10/10/5/5, `GRADES` 90/80/65, `SLIP_PENALTY 0.15`, `DROPPED_MIN_AKSHARAS 4` |
| Canon | `canon.js` | `CANON_VERSION 1`, `TRADITIONS`, realisation slots |
| Placement by sound (measurement) | `tools/place-by-sound.mjs` | `TEMPOS [0.8, 0.9, 1, 1.1, 1.25]`, `SURE 0.85` |

### The evaluation pipeline of a take of several slokas (as built)
1. Live: the ear closes stretches (`practice.take.segments[]`), the learner's page turns pin, the words are heard per stretch when the switch is on.
2. Stop: lead trimmed (`removedStart`); `secondOpinionOf(take)` → `segmentTake` with pins (page turns > signatures (two passes) > speaker lines); `adoptSecondOpinion` records `earLog.adopted` and sets `seg.second` where the two windows are within 6 s.
3. Per sloka: `compareSloka` on the second opinion's window ± 0.5 s; if the contrast fails the gate, `confirmBySecond` by length fit; else the ear's window is tried and kept when the sound matches or the ear's count vouches; the chosen window becomes `seg.from/to`.
4. Words: `transcribeTakePart` → `windowedTokens` → `neighbourEdges` → diff → `loopedHearing` → steady rerun or words unused → `comparePhonology` → `findSelfCorrections` → slips.
5. `slipsOf` filters unsure slips; scores and grade; `saveSession` at the first result, patched after.

---

## 7. Structural patterns (how things are done here)

| Pattern | Where | Rule |
|---|---|---|
| **Pure core, thin controller** | `js/dsp/*`, `js/*.js` vs `js/app.js` | Decisions are pure functions over plain objects; `app.js` holds state and DOM |
| **State object per view, render from state** | `practice`, `learn`, quiz state | Mutate the object, call `render*` / `refresh*`; no DOM-as-state |
| **Request-id worker protocol** | `Analyzer`, `Transcriber` | Promise per request; progress callbacks; `AbortController` cancellation → `AbortError` |
| **Versioned persistence + sanitise on read** | `SCHEMA_VERSION`, `FEAT_VERSION`, `RESULT_VERSION`, `CANON_VERSION`, `BADGES_VERSION` | Old files always load; migrations live in `sanitize*`, never in callers |
| **Sidecars by name** | `meta-store.js` | Data travels with the WAV; the WAV also self-describes (`bext`) |
| **Derived data is rebuildable** | features cache, badges, HTML renderings, Markdown twins | A tool recreates it; never hand-edited |
| **Measurement tools beside the app** | `tools/second-opinion.mjs`, `place-by-sound.mjs`, `analyse-attempt.mjs` | The same pure modules run offline over kept sessions; nothing in a session is changed |
| **Evidence in constants** | every `export const X = n; // why` | A number without its reason does not merge |
| **The learner's voice first** | signatures, speaker lines, references | Prefer the learner's clean solo takes to the library recording |
| **Hash routing** | `VIEWS`, `showView`, `#evaluate` | Teach, Self Evaluation and a running quiz share `#view-evaluate` |
| **Theming by tokens** | `css/styles.css :root`, `:root[data-theme="dark"]` | Canvas reads tokens via `cssVar` |
| **One shared component factory** | `createSlokaPicker`, `createTranscriptPanel`, `bindRecorderUI`, `progressUI` | Built once per page, configured by options |
| **Localhost-only server, zero deps** | `serve.js` | No framework, no middleware; `parts[]` dispatch |

---

## 8. Identifiers and naming on disk

| Thing | Form | Example |
|---|---|---|
| Record / session / quiz id | `YYYYMMDD-HHMMSS-<4 base36>` (local time of creation) | `20261102-063453-2dom` |
| Profile id | `p-YYYYMMDDHHMMSS-<4>` | `p-20261008195044-8m0l` |
| Library file | `<Folder>/<slug(name)>-<id>.wav` | `CH-18/ch18-09-20261031-095934-9wtq.wav` |
| Sloka name | `CH<chapter>-<verse>` (Gītā), free text otherwise | `CH18-09`, `Ch01-01` |
| Verse id | `<chapter>.<verse>`, `1.21-22`, `12.opening`, `12.colophon`, `dhyana.1` | `18.9` |
| Signature key | `sloka:<libraryId>:start` / `:end` | `sloka:20260912-130131-hsjj:start` |
| Debug note | `debug-notes/take-<id>.html` + `.md`; dated reports `YYYY-MM-DD-<slug>.html` + `.md` | `take-20261102-063453-2dom.md` |
| Replay output | `dist/replays/<take>/` | |
