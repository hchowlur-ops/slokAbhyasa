# SlokAbhyasa — Coding Standards

Parsed from the cleanest modules in the repository — `js/dsp/ear.js`, `js/dsp/segment.js`,
`js/dsp/locate.js`, `js/advice.js`, `js/meta.js`, `js/reports.js`, `datadir.js`,
`js/analyzer.js`, `test/ear.test.js`, `test/segment.test.js`, `tools/debug-note.mjs` — and
from the conventions visible in 112 commits. These are the rules a change must follow to read
as part of this codebase. Where a rule has an exception already in the code, the exception is
named.

---

## 1. Language, runtime, dependencies

- **ES modules everywhere.** `package.json` has `"type": "module"`; browser files, the server, the tools and the tests all use `import`/`export`. No CommonJS, no bundler, no transpiler, no TypeScript, no build step. The browser loads `js/app.js` as `<script type="module">`.
- **Zero runtime dependencies.** `dependencies` and `devDependencies` do not exist and are not added. The single external code path is transformers.js, imported from a CDN inside `js/stt-worker.js` on first use, with Whisper weights from Hugging Face cached by the browser. `tools/bench/` has its own `package.json` for the benchmark only.
- **Node built-ins with the `node:` prefix** (`import fs from 'node:fs'`, `node:test`, `node:assert/strict`, `node:path`, `node:crypto`, `node:url`).
- **Modern syntax as the code uses it:** `const` by default, `let` only when reassigned, arrow functions for small helpers, default parameters, destructured option objects with defaults (`{ decim = 5 } = {}`), optional chaining and `??` where they shorten a guard, template literals for every composed string, typed arrays for signals.
- **Browser and Node share pure modules.** Anything under `js/dsp/` and the pure `js/*.js` modules must run in both: no `window`, `document`, `fetch`, `Worker` or `fs` in them. DOM code lives in `js/app.js`, `js/visualizer.js`, `js/player.js`, `js/recorder.js`, `js/stt.js`; file-system code in `serve.js`, `meta-store.js`, `reference.js`, `datadir.js`, `tools/`.

---

## 2. Files and modules

- **One responsibility per module, stated in a prose header.** The first lines of every file are a `//` comment that says what the module is for and, where it matters, why it is built that way and what evidence set it. Examples to copy: `js/dsp/locate.js` ("Find where a short recording occurs inside a much longer one…"), `js/dsp/segment.js`, `datadir.js`. A tool's header also carries its usage lines:
  ```js
  //   node tools/debug-note.mjs <session id, or its last letters> [--out debug-notes] [--replay <log file>]... [--data <dir>]
  ```
- **`js/app.js` is sectioned, not split.** New controller code goes under the matching banner (`// ---------- the ear: … ----------` inside `// ===== SELF EVALUATION =====`); a new view gets a new `// =====` banner, a `<section class="view" id="view-<name>">`, an entry in `VIEWS` and a `data-view` button. Do not create a second controller file for part of a view.
- **Pure logic that grows past a screen leaves `app.js`** for a module with a test (`js/advice.js` and `js/earlog.js` are the pattern: small, pure, tested, imported by the controller).
- **Shared helpers stay tiny and local.** `const $ = (sel, root = document) => root.querySelector(sel)`, `$$`, `setHidden`, `fmtTime`, `r2`, `esc` — defined once at the top of the file that needs them, not in a utilities grab-bag. `js/dsp/util.js` and `js/libutil.js` are the two sanctioned shared helper modules (numeric; library names and WAV headers).
- **File names:** lowercase, hyphenated for tools and tests (`place-by-sound.mjs`, `note-md.test.js`), single words for modules (`segment.js`, `quizscore.js`). Tools are `.mjs`, app modules `.js`.

---

## 3. Naming

| Kind | Rule | Examples from the code |
|---|---|---|
| Functions, variables | `camelCase`, verbs for actions, nouns for values | `earDecision`, `segmentTake`, `confirmBySecond`, `soloPractice`, `nucleiNear` |
| Exported constants | `UPPER_SNAKE` with a trailing comment giving the unit and the reason | `export const GAP_FREE_SEC = 1.0; // a pause this long costs nothing as a cut` |
| Classes | `PascalCase`, only for stateful wrappers | `Player`, `Recorder`, `Analyzer`, `Transcriber`, `EarLog`, `SyllableCounter`, `ComparisonChart` |
| Feature objects | `F`, `B` (baseline), `H` (heard), `S`/`L` (short/long) in DSP code; frames `i0..i1`, seconds `from/to` | `locate(S, L)`, `sliceFeatures(F, i0, i1)` |
| Domain words | the project's vocabulary, in English identifiers without diacritics, with diacritics in comments and UI strings | `padaPauseMs`, `aksPerSec`, `countRatio`, `slokaPauseMs`; comments say *pāda*, *akṣara*, *śloka* / *sloka* |
| Time | seconds as `Sec`, milliseconds as `Ms`, frames unsuffixed with `HOP_SEC` to convert | `PIN_REACH_SEC`, `STOP_PAUSE_MS`, `loc.start * HOP_SEC` |
| Booleans | positive adjectives or `is*` / `has*` | `pinned`, `virtual`, `skipped`, `isStopped(err)`, `isPartial(slips)` |
| Element ids / classes | kebab-case, view-prefixed | `#take-advice`, `.picker-folder`, `.quiz-…`, `.lib-tag`, `#view-evaluate` |
| Legacy names | kept, and the mismatch written down | "element ids and identifiers still say *practice*" (the Self Evaluation section banner) |

---

## 4. Comments and prose

- **Comments are full sentences that give the rule and the evidence**, often with a date or a take id: `// a cut the student made by turning the page pins the boundary to the nearest pause within this` … `// the user's profile on 17 October`. A reader should learn *why* from the comment and *what* from the code.
- **Every threshold is explained where it is defined**, never at the call site.
- **No narrating comments** (`// increment i`), no TODO litter: open work goes to `research_notes/todo.md` or the research note, with a date.
- **Section banners** in long files: `// ---------- name ----------` for a topic, `// =====` lines around a view's name in `app.js`, `/* ---------- tokens ---------- */` in CSS.
- **UI strings** are plain English sentences in the app's voice ("Evaluate it alone, whole and clean; on its own a sloka is judged more surely…"), with Sanskrit terms in IAST diacritics (akṣara, pāda, śrībhagavān uvāca) and the sloka's name as the library names it (`CH18-03`).

---

## 5. Functions and data

- **Pure functions take and return plain objects**; they never mutate their inputs except where a function's name says so (`adoptSecondOpinion(take)` annotates `take.earLog`). Return shapes are documented in the header (`// Returns cutsFor's result with scale, hypothesis and hint`).
- **Options objects with defaults**, never positional booleans: `confirmBySecond(res, { ratio = null, pinned = false } = {})`, `placeOrdered(H, refs)`.
- **Guard numbers.** `Number.isFinite(x)` before arithmetic on anything read from JSON or a log; `null` means "unknown", never `NaN` or `-1`. Rounding (`r2`, `r3`) happens only at the edge: logs, JSON written for people, UI.
- **Signals are typed arrays** (`Float32Array` samples at 16 kHz after `resample`; `Uint8Array` masks; `Int32Array` indices). Loops over frames are plain `for` loops; no `map` over a million-element array.
- **Frames versus seconds are never mixed silently.** Feature indices are frames; everything that reaches a log or a session is seconds via `HOP_SEC`.
- **Versions on persisted shapes.** A new field in a file on disk means: add it to `newBaselineMeta` / the store's shape, bump the version if old readers would misread it, extend `sanitize*` so old files still load, and add a test that reads an old-shaped object.
- **Dates** are ISO strings in data (`at`, `createdAt`), formatted only for display (`fmtDate`).

---

## 6. Server and API (`serve.js`)

- Routes are dispatched by `parts = url.pathname.split('/').filter(Boolean)` into one `handle<Family>(req, res, parts)` per family; inside, `id = parts[2]`, `sub = parts[3]`, and the method is checked explicitly, with `405 { error: 'Method not allowed' }` for the rest.
- Responses go through `sendJson(res, code, obj)`; errors are `{ error: <sentence> }` and the sentence is written for a person ("Slokas are saved in folders: choose or create one").
- Bodies are validated before anything is written (`isWav(body)`, `cleanFolder`, `sanitizeMeta`); file writes are atomic enough for one user (`JSON.stringify(x, null, 2) + '\n'`).
- The server reads the data folder from `resolveDataDir(ROOT)`; nothing in the code hard-codes a path. It binds to `127.0.0.1` only. The reference dataset's own folder is never written.
- A new endpoint is added in three places in the same commit: `serve.js`, `js/api.js` (one function, `check(res)`), the API table in `SLOKABHYASA_ARCHITECTURE.md` and the README's Layout line for `serve.js`.

---

## 7. Browser UI (`index.html`, `css/styles.css`, `js/app.js`)

- **Markup is semantic and labelled:** views are `<section class="view" aria-labelledby="…">`, controls are `<button type="button">` with visible text, icons are inline `<svg>` with `fill="currentColor"`.
- **State lives in a JavaScript object per view** (`practice`, `learn`, …) with a one-line comment per field; the DOM is rendered from it by `render*` / `refresh*` functions that are safe to call again. `setHidden(el, bool)` toggles visibility; `toast(msg, kind)` reports outcomes; `askDialog({ title, label, options })` collects input and returns a promise.
- **Routing:** `VIEWS` + `showView(name)` + `location.hash`; a view that shares a section (Teach, a running quiz) switches mode inside `showView`, never by duplicating markup.
- **Styles:** every colour is a token in `:root`, overridden under `:root[data-theme="dark"]` (the app has an explicit theme switch, not only `prefers-color-scheme`); canvas code reads tokens through `cssVar()`. Class names are view-prefixed (`.quiz-`, `.picker-`, `.take-`, `.score-`, `.lib-`, `.tc-`); one `/* ---------- section ---------- */` per UI area; responsive rules collected under `/* ---------- responsive ---------- */`; `@media print` hides the chrome. No inline styles from JavaScript except canvas drawing and measured widths.
- **Long work shows progress and can be stopped:** a progress bar bound by `progressUI`, an `AbortController` passed to the worker, `isStopped(err)` distinguishes a stop from a failure, and the card carries a spinner with its state in the tooltip.
- **Nothing blocks the main thread** beyond the live ear's bounded tick; features, comparison, locating and Whisper go through the workers.
- **Text in three scripts** is rendered by `js/lipi.js` from the Sanskrit; never duplicate transliteration logic in the controller.

---

## 8. Tests (`test/`, `node --test`)

- **One test file per module**, named after it (`segment.test.js` for `js/dsp/segment.js`), using `import { test } from 'node:test'` and `assert` from `node:assert/strict`; `assert.equal` / `assert.deepEqual` / `assert.ok` with a message only where the failure would be unclear.
- **Test names are sentences that state the rule**, often with the date or source of the evidence: `'the expected time is the learner\'s own, or nothing: never the teacher\'s'`, `'a sloka that echoes itself is not a word said twice'`.
- **Synthetic signals come from `test/synth.js`** (`tone`, `melody`, `chant`, `vowel`, `concat`, `silence`, `timeWarp`, `addNoise`; 16 kHz); a test of a take builds its activity mask and true boundaries in a local `take(...)` helper (see `test/segment.test.js`). Real recordings are not committed; real **transcripts** are quoted verbatim in tests where Whisper's actual output is the point (`test/slips.test.js`, `test/textdiff.test.js`).
- **Workers are faked, not run** (`FakeWorker` in `test/stt.test.js` records what it is sent and replies on command).
- **File-system tests use a temp dir** (`fs.mkdtempSync(path.join(os.tmpdir(), 'slokabhyasa-…'))`) and restore environment variables in `finally` (`withEnv` in `test/datadir.test.js`).
- **Constants are tested through their consequences**, and a constant that changes must change a test's expectation on purpose.
- **A fix for a wrong verdict adds the case that was wrong** as a test when it is pure (the words, the decision), and as a replay in the take note when it is live.
- **The suite is fast and whole:** `npm test` runs everything in about 15 s; there is no "skip" category and no network.

---

## 9. Tools (`tools/*.mjs`)

- A tool reads its data folder with `resolveDataDir(ROOT)` (and accepts `--data <dir>`), reads a session by id or by the id's last letters, prints tables to stdout with fixed decimals (`r2`), and **never modifies sessions, quizzes or the library unless its name says so** (`trim-library`, `badges --recompute`, `map-verses`). Analysis tools say so in their header ("Nothing in the session is changed").
- Reports that are meant to be kept are written to `debug-notes/` as HTML with a Markdown twin (`markdownTwin` from `tools/note-md.mjs`), and listed in `debug-notes/index.html`.
- Imports are relative (`../js/dsp/locate.js`); in ad-hoc scripts outside the repo use `file:///C:/…` URLs (Windows `C:/…` paths are not valid ESM specifiers).
- A tool that drives the app (`replay-take.mjs`, `simulate-slips.mjs`) documents its environment flags (`STT=on MULTI=off CARDS=on`) and the Chrome profile it needs.

---

## 10. Documentation that moves with the code

| Change | Must also change |
|---|---|
| A feature's behaviour | The README section that describes it (the README is the complete description); the Layout table for a new file |
| Anything a user would notice | A bullet under today's `### <date>` in `RELEASE-NOTES.md` §Unreleased — a bold lead sentence, then the evidence and the rule in prose |
| A rule, threshold or approach | A dated section in the research note that owns the topic; `research_notes/todo.md` status; `node tools/notes-html.mjs`; commit in the notes' own repository |
| An analysed take | `node tools/debug-note.mjs <id> [--replay <log>]` (HTML + Markdown twin) |
| A standing decision | The project memory (the owner's notes), one line with the date |

---

## 11. Commits

- **One coherent change per commit**, docs included. Personal data, `docs/handoff/`, `local.json`, `dist/` never.
- **The message is one prose paragraph** (the house style, as in `git log`): what changed and why, with the evidence and the rule, Sanskrit terms in diacritics, numbers where they carry the argument; no bullet lists, no "fix bug". Example: *"A sloka that echoes itself is not a word said twice: a second saying that is where the sloka's own text goes on is the language, not a slip — 161 of the Gītā's 719 slokas carry such an echo, and 18.2's four takes of the morning each lost 15 % to it."*
- Long messages go through a file: `git commit -F <message file>`.
- Trailer on every commit:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  ```
- Nothing is pushed unless the owner says so.

---

## 12. Do not

- Add a dependency, a framework, a bundler, a type system, or a CSS preprocessor.
- Put decision logic in `js/app.js` that could be a pure function with a test.
- Introduce a number without a trailing comment saying what it is and why.
- Write under `reference/<id>/`, under `library/` from a tool that does not say so, or any name into the library.
- Call the network from the server or from any module other than the speech worker's model loading.
- Validate a rule on the take that motivated it alone (see the verification checklist §4).
- Leave the README, the release notes or the research note behind the code.
