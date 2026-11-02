# SlokAbhyasa — Requirements

Derived from the code (`js/`, `serve.js`, `index.html`), the README, the release notes and the
research notes as of 2 November 2026 (version 1.6.0 + Unreleased on `AcousticAssessment`).
Requirement ids are stable handles for plans, tests and commit messages. "Built" means the
requirement is implemented and described in the README; "Open" names the note that carries it.

---

## 1. Product statement

SlokAbhyasa is a **local, private desktop web app** in which a teacher records Sanskrit slokas
(the Bhagavad Gītā, one verse at a time, from a bundled reference text) and a learner
practises them: listening at any speed, reciting one sloka back (Teach), reciting several in
one take (Self Evaluation), being tested from memory (Quiz), and reading progress (Reports,
Badges). The app judges a recitation by **what the Gītā asks of a reciter** — the right
sounds, the right vowel lengths, every syllable, the manner of the sloka — never by the
reciter's voice, range or loudness. It runs on one Windows laptop with Chrome, keeps every
recording on that machine, and needs no account, cloud or installation beyond Node.

### Personas

| Persona | Role in the data | Journeys |
|---|---|---|
| **Teacher** (`role: "teacher"` on every library recording) | Records the reference slokas; may be the learner too | Learn, Library |
| **Learner** (a profile in `profiles.json`, roles `["learner"]`; today one, male, 60+) | Recites; owns sessions, quiz attempts, badges, learnt pace, speaker-line templates | Teach, Self Evaluation, Quiz, Reports, Home |
| **Family / class** (profiles with voice type and age group; `shareScope` private/family/class/public) | Several learners on one machine, each judged with their own allowances | Settings › Who's reciting |
| **Maintainer** (the owner, and coding agents) | Runs tools, reads debug notes, changes the app | `tools/`, `debug-notes/`, `research_notes/` |

---

## 2. User journeys

### J1 — Record a verse (Learn)
1. Open Learn: chapter cards with "n of m recorded". Open a chapter; verse cards in order, ticked where a recording exists; "Next unrecorded".
2. Choose a verse: the record card shows "Gītā 12.3 · भक्तियोग · verse 3 of 20", the text in the chosen script with laghu/guru marks, the chandas hint, the meaning, existing recordings with play buttons, and the speaker-line tick when the verse has one.
3. Record (tap, recite, tap). The take shows its waveform, what the trimmer removed, its pace against the learner's known pace, a suggested name, the folder it goes to (`CH-12`), and what it replaces.
4. Save: the WAV is posted with `?verse=12.3&dataset=gita&speakerLine=1`; the sidecar is written with the verse's text as the reference text, the metre, the link; the chapter view re-reads; the next verse comes into view.

### J2 — Teach (one sloka, play then listen)
1. Pick one sloka in the picker (radio buttons). Play it at ½× … 2× with pitch kept.
2. Press Listen, recite, press again. The same report as Self Evaluation opens: scores, chart, deviations, transcript. A session of kind `teach` is kept with the take.

### J3 — Self Evaluation (several slokas, one take)
1. Tick slokas (folder checkboxes, search, chips). The sloka in view is the active one.
2. Record once. While recording, the **ear** counts nuclei, turns the page sloka by sloka, logs every tick; the space bar or → turns the page by hand (a pin). With the words switch on, Whisper hears each closed stretch.
3. On stop: the lead is trimmed; the **second opinion** cuts the whole take; each sloka is compared on its window; the scoreboard shows one card per sloka with a spinner until its sound and words are in; the whole-recital wave with the cuts stays above the open report; advice lines appear for first-time and Needs-practice slokas.
4. The session (`kind: "evaluation"`) is created at the first comparison and patched as more arrive; `take.wav` and `ear.json` are stored beside it.

### J4 — Quiz
1. Choose one sloka or several (at most the Settings cap, 10 by default); "Pick N at random" from the open folders. Start with a name; the quiz is saved.
2. Recite everything in one take (text shown, or from memory per Settings), in any order. Each attempt is scored per sloka and per chosen category; the recording is kept as `attempt-N.wav`.
3. A badge is awarded when the mastery rule is met (three Excellent attempts on three days by default).

### J5 — Reports, Badges, Home
By day / week / month / all time; one row per session or attempt; click for per-sloka lines and Listen; by folder for per-sloka history; badges on Home for the chosen learner.

### J6 — Library
Play, rename, move between folders (three levels, `backup` reserved), delete (optionally to backup), trim, edit details (who, style, tradition, text), link to the Gītā, see measurements, right-click for the raw sidecar; transcripts in the background.

### J7 — Maintainer: a wrong verdict
`node tools/debug-note.mjs <id>` → read the three windows and the ear's log → research note section → measurement → change → replay → take note with `--replay` → commit.

---

## 3. Functional requirements

### 3.1 Learn (reference recordings)
| Id | Requirement | Status |
|---|---|---|
| FR-LEARN-1 | Chapters and verses come from the bundled reference dataset `reference/gita` (719 entries: 701 verses incl. combined ids like `1.21-22`, chapter openings and colophons, dhyāna and invocation texts); a copy in `<data>/reference/gita/` takes precedence | Built |
| FR-LEARN-2 | One chapter in view at a time; coverage ("4 of 20 recorded") re-read on every visit; the last chapter remembered | Built |
| FR-LEARN-3 | The record card shows the verse text in the chosen script (Devanagari, Kannada, Telugu, IAST) with laghu/guru marks, the metre, the translation, and the speaker line dimmed with a tick deciding whether the recording's words include it | Built |
| FR-LEARN-4 | A take's pace (akṣaras per second over its sound) is shown against the learner's known pace before saving | Built |
| FR-LEARN-5 | Saving links the recording to the verse: `verse` in the sidecar, `text.origin = "reference"`, the chandas from the dataset, the suggested name `CH12-03` and folder `CH-12` | Built |
| FR-LEARN-6 | A verse's custom fields (overrides) are stored in `<data>/reference/<id>.custom.json`; the dataset folder is never written | Built |

### 3.2 Teach and Self Evaluation (the comparison)
| Id | Requirement | Status |
|---|---|---|
| FR-EVAL-1 | One recording is compared with every ticked sloka; a report per sloka; a scoreboard with the take's overall (mean over slokas recited) | Built |
| FR-EVAL-2 | Playback of the sloka at ½×–2× with pitch kept; optional playback in one ear while recording (headphones) | Built |
| FR-EVAL-3 | The **ear** (live): counts syllable nuclei, converts to akṣara position with the learner's `countRatio`, closes a sloka by count / run-on / next head / stop rules, turns the page, logs every 0.5 s tick and every decision (`sessions/<id>/ear.json`) | Built; close rules under review (see §6) |
| FR-EVAL-4 | The **second opinion** (after the stop): cuts the whole take from its pauses, the slokas' expected lengths and pins (the learner's page turns, the sloka's signatures, speaker lines); three methods (plan, teacher, share) compete by cost | Built; its "partial last sloka" hint is a known failure (2 November) |
| FR-EVAL-5 | Each sloka is compared on a window: today the second opinion's segment ± 0.5 s, the ear's stretch as fallback; a sound match is confirmed by contrast < 0.87, else vouched for by words, by the ear's count, or by the second opinion's length fit (0.7–1.4 of expected) | Built; replacement recommended (§6) |
| FR-EVAL-6 | Scores per sloka in seven categories (§4) from the words heard and from the sound; the overall is the weighted mean; the grade follows `GRADES` | Built |
| FR-EVAL-7 | **Slips** are named: `restart`, `falseStart`, `repeat` (self-corrections, 15 % off, grade Needs practice), `stall`, `dropped`, `skipped`, `partial`; unsure slips need the words or the sound to agree; a sloka's own echo (161 of the Gītā's 719) is not a repeat | Built |
| FR-EVAL-8 | A sloka under half recited or not found is not scored and says so; a sloka with any slip is Needs practice whatever its score | Built |
| FR-EVAL-9 | The whole-recital wave with every cut (ear's or "2nd (used)", thick where the learner turned the page) stays visible above an open report and follows the card's play button | Built |
| FR-EVAL-10 | Advice under the cards: a sloka recited for the first time, or Needs practice, is advised to be evaluated alone (`js/advice.js`) | Built |
| FR-EVAL-11 | A clean solo evaluation of a sloka (whole, found, Fair or better, no slip) stores its first and last 2 s as **signatures** in the learner's voice, used to pin that sloka in later recitals; a solo take that falls short asks for another | Built |
| FR-EVAL-12 | Sessions (`evaluation`, `teach`) are persisted at the first comparison with the weights, tolerance, options, learner and canon version in force, and patched as results arrive | Built |
| FR-EVAL-13 | Every verdict must be explainable offline from the kept session: the take note tool reproduces the windows, the second opinion and the ear's log without the browser | Built |

### 3.3 Words (speech to text)
| Id | Requirement | Status |
|---|---|---|
| FR-STT-1 | Whisper in a browser worker via transformers.js, three tiers (Fast = whisper-base ≈ 75 MB, Better = whisper-small ≈ 250 MB, Best = whisper-large-v3-turbo ≈ 750 MB, WebGPU); weights cached by the browser; nothing uploaded | Built |
| FR-STT-2 | The words are always heard as **Sanskrit**; Kannada, Telugu and IAST are written from the Sanskrit transcript (`js/lipi.js`, `js/translit.js`) | Built (11 October) |
| FR-STT-3 | WebGPU is used when an adapter exists, with q4 weights and fp32 arithmetic, never fp16 (Intel Iris Xe advertises shader-f16 and computes garbage); a hearing of nothing or one or two words over and over is redone on the CPU (wasm, q8); Best needs WebGPU | Built |
| FR-STT-4 | Per sloka of a recital: tokens within the window, the neighbours' edge words dropped, a looped hearing detected (3× run, or more akṣaras than sung with a run said twice) and re-run held steady (`repetition_penalty` 1.3, `no_repeat_ngram_size` 3), else the words are not used; a thin hearing re-heard in halves | Built (1 November) |
| FR-STT-5 | Background transcription of every saved sloka without words; transcripts per language in `<name>.transcript.json`; the text typed in a sloka's details wins over its transcript | Built |

### 3.4 Quiz, Reports, Badges
| Id | Requirement | Status |
|---|---|---|
| FR-QUIZ-1 | One sloka or several (2 … cap), random pick from open folders, a unique dated name, saved at once | Built |
| FR-QUIZ-2 | Recite in one take in any order; per-sloka and per-category scores; "correct" by tolerance; attempts with their audio | Built |
| FR-REP-1 | Every quiz attempt and session in one dashboard by period and by folder; totals, averages, best; Listen | Built |
| FR-REP-2 | Progress moments on save: first Excellent, a new best, a streak, "not your best today" | Built |
| FR-BADGE-1 | A quiz mastered: three Excellent attempts (every sloka recited, no slip) on three different days by default; stars at 5 and 10; chapter and Gītā badges by coverage; derived data rebuilt by `tools/badges.mjs --recompute` | Built |

### 3.5 Library, people, settings
| Id | Requirement | Status |
|---|---|---|
| FR-LIB-1 | Slokas are WAV files in folders (≤ 3 levels, `backup` reserved) with sidecars `<name>.json`, `.features.json`, `.transcript.json`, `.txt`; `index.json` is re-synced from the disk on every list so files moved with Explorer are found | Built |
| FR-LIB-2 | Rename, move, delete (with optional backup), trim silence (originals to `library/backup`), edit details, link/unlink a verse, right-click shows every key of the sidecar | Built |
| FR-LIB-3 | The WAV carries a Broadcast Wave `bext` chunk (name, style, date) so a file separated from its sidecar still says what it is; the sidecar carries a hash of the audio | Built |
| FR-PEOPLE-1 | People are profiles (`profiles.json`): name, voice type, age group, roles, learnt pace; the library refers to a person by id only | Built |
| FR-PEOPLE-2 | Allowances follow the learner: adults keep calibrated defaults, children get wider pitch and speed bands (`presetsFor` in `js/meta.js`) | Built |
| FR-SET-1 | Settings: slokas per take (2–20), weights (defaults 30/25/15/10/10/5/5), tolerance per category and "Ignore tolerances", speech recognition switch / tier / language, script, text shown during a quiz, grades with emoji or plain, badge rule, theme | Built |

### 3.6 Platform and operations
| Id | Requirement | Status |
|---|---|---|
| FR-OPS-1 | `node serve.js` serves the app and the API on localhost; `--open` opens the browser; `PORT` overrides | Built |
| FR-OPS-2 | The data folder is chosen by `local.json` or `SLOKABHYASA_DATA`; nothing inside the files refers to where they are | Built |
| FR-OPS-3 | A Windows package with a portable Node runtime, a launcher and a plain-language README (`tools/package.mjs`) | Built |
| FR-OPS-4 | Every analysed take can be written as a debug note (HTML + Markdown twin) into `debug-notes/` | Built (1–2 November) |

---

## 4. Scoring requirements (normative)

| Category | Weight | Source | Tolerance default |
|---|---|---|---|
| Phonemes | 30 | words | 15 |
| Vowel length | 25 | words | 20 |
| Syllables | 15 | words | 10 |
| Emphasis | 10 | sound | 60 |
| Pitch contour | 10 | sound | 60 |
| Phrasing | 5 | sound | 50 |
| Timing | 5 | sound | 60 |

Grades: Excellent ≥ 90, Good ≥ 80, Fair ≥ 65, Needs practice otherwise (`GRADES` in
`js/quizscore.js`). Self-corrections (`restart`, `falseStart`, `repeat`) deduct 15 %
(`SLIP_PENALTY`) and force Needs practice. "Dropped by words" needs ≥ 8 reference akṣaras,
≥ 4 missing and ≥ 10 % (`droppedByWords`). Recited text uses the comparison mode
`recitation` (pitch 0, timing 0.4, content 0.6); the comparison's own overall is kept for
tests and the API, the app grades the weighted mean. Legacy categories (content,
pronunciation, dynamics) still add up for records from before this scoring.

---

## 5. Non-functional requirements

| Id | Requirement | Evidence / budget |
|---|---|---|
| NFR-PRIV-1 | Audio and transcripts never leave the machine; the server binds to 127.0.0.1; the only network traffic is the one-time download of transformers.js (CDN) and Whisper weights (Hugging Face) | `serve.js`, `js/stt-worker.js` |
| NFR-PRIV-2 | No names under `library/`; profile ids only; consent and share scope recorded per recording | `meta-store.js` (`SHARE_SCOPES`, `CONSENT_BY`) |
| NFR-PERF-1 | MFCC + DTW 0.2–0.5 s per stretch in the worker; main-thread jitter under 25 ms while a worker runs | `roadmap.md` §0 |
| NFR-PERF-2 | The Best Whisper: about 21 s per lone sloka, ~1.5 s with Fast; the tab stays under about 4 GB; replays with `MULTI=on` starve the recorder (12 s lost), so faithful replays use `MULTI=off` | `roadmap.md`, `tools/replay-take.mjs` |
| NFR-DEP-1 | No runtime dependencies in the app or the server; no build step; ES modules shared between browser and Node | `package.json` |
| NFR-DUR-1 | Sidecars travel with the WAV by name; derived data (features cache versioned `FEAT_VERSION 5`, badges, HTML renderings, Markdown twins) is rebuildable | README §Where your files live |
| NFR-SCHEMA-1 | Every persisted file carries a version (`schemaVersion 1.1.0` sidecar, `1.0.0` profiles/badges, `RESULT_VERSION 2`, `CANON_VERSION 1`, ear log `version`) and is sanitised on read | `js/meta.js`, `meta-store.js` |
| NFR-A11Y-1 | Views are `<section>`s with `aria-label`/`aria-labelledby`; buttons carry text; keyboard page turns (space, →) during recording | `index.html` |
| NFR-PLAT-1 | Windows 11, Chrome, Node ≥ 18 (24 in use); PowerShell is used by the packager | `package.json`, `tools/package.mjs` |
| NFR-EXPL-1 | Every verdict is reproducible offline from the session's files by the tools; every rule's constant carries its evidence in a comment | `tools/`, `js/dsp/segment.js` |

---

## 6. Scope

**In scope now (this cycle, branch `AcousticAssessment`):** reliable boundaries in a recital
of several slokas; the words read carefully in a recital; the roadmap's P0 deliverables; debug
notes as the record of every analysed take.

**Open decisions (PLANNING input):**
- **Boundary placement.** The ear (dead reckoning by nucleus count) and the second opinion (pauses + expected lengths) both infer a sloka's place from how long it should be and fail together when the pace drifts (2 November: ear 2.8–5.6 s late, second opinion 8–12 s late, a whole sloka reported "dropped 18 of 32"). Recommended and not built: ordered placement by the sloka's own sound as the placer (measured: 98 of 113 slokas placed with contrast < 0.85 over 33 recitals, right on every hand-verified take); the ear for page turning only; a draggable cut where contrast is weak; the measurement as a regression bench. See `debug-notes/2026-11-02-assessment.md`.
- The mid-sloka pause floor and the slokas-per-take switch (`todo.md`, roadmap P0.5).
- Whether the 15 % self-correction penalty stacks on the syllable loss a repeated pāda already causes; whether a whole wrong pāda should grade lower.

**Deferred (recorded in `research_notes/todo.md`):** the P1 proofs of concept (features + DTW
phone features, phone decode, alignment quality, memory co-residency, native timing); GOP and
decode-based slips (P2); fine-tuning, a visarga detector, models on the server (P3, gated);
publishing on a public site; the learning-feature redesign beyond what shipped.

**Out of scope:** accounts, cloud storage, mobile apps, any upload of audio, a build pipeline
or framework, teacher-side analytics across learners, languages other than Sanskrit for the
heard words.

---

## 7. Known limits (state them in the UI or the notes; do not "fix" them silently)

| Limit | Where recorded |
|---|---|
| Whisper smooths away a single word said twice with a short breath, and a stuttered syllable; the simulations report these, not fail them | README §Simulated slips; `todo.md` 0b (a), (b) |
| The ear's sound checks (restart, next-sloka head) are always "doubtful" for this learner: the teacher's fingerprints calibrate thresholds 11.6–12.8 while live distances are 22–34 | `ear-log-findings.md`; take notes of 1–2 November |
| The ear's count accumulates error when the nucleus ratio drifts (13 % under on 2 November → 5.6 s late by the fourth sloka) | `debug-notes/take-20261102-063453-2dom.md` |
| This learner's own recordings score contrast 0.88–0.96 on the right window, so the contrast gate (0.87) cannot choose windows for this voice | `RELEASE-NOTES.md` 1 November |
| Library recordings of CH11 (9–10 s, recorded 16–17 October) do not serve as sound references; the learner's solo takes do | `debug-notes/2026-11-02-placement-by-sound.md` |
| Library recordings' own first/last 2 s do not work as signatures; solo evaluations do | project memory, 31 October |
| WebGPU fp16 on Iris Xe computes garbage; CPU fallback is slower | README §Settings |
