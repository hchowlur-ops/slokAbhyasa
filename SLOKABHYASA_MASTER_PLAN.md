# SlokAbhyasa — Master Plan (SDLC router and index)

Version described: **1.6.0 + Unreleased** (branch `AcousticAssessment`), repository state of
2 November 2026, 112 commits since 4 October 2026. This document routes every piece of
engineering work on SlokAbhyasa through four phases — **PLANNING → DESIGN → DEV → REVIEW** —
and names, for each phase, what to read, what to produce, and the gate that ends it. The four
companion documents hold the detail:

| Document | Holds | Read in phase |
|---|---|---|
| `SLOKABHYASA_REQUIREMENTS.md` | What the product must do: journeys, functional and non-functional requirements, scope, known limits | PLANNING, REVIEW |
| `SLOKABHYASA_ARCHITECTURE.md` | Module map, worker boundaries, every on-disk schema, the HTTP API, the algorithms' constants, structural patterns | DESIGN, DEV |
| `SLOKABHYASA_CODING_STANDARDS.md` | How code is written here: modules, naming, comments, tests, tools, commits | DEV, REVIEW |
| `SLOKABHYASA_VERIFICATION_CHECKLIST.md` | Definition of Done, the five test levels, coverage rules per change type, the release checklist | REVIEW (and read before DEV) |

The README (`README.md`) remains the complete description of every feature as it stands;
`RELEASE-NOTES.md` says when each came. These SDLC documents never duplicate feature prose:
they point into the README, the code and the notes.

---

## 1. Project facts every phase relies on

| Fact | Value | Where it is enforced |
|---|---|---|
| Product | A local, private app for learning and self-evaluating Sanskrit sloka recitation (Bhagavad Gītā first), with chanting as the focus | `README.md` §Workflows |
| Stack | Vanilla ES-module JavaScript in the browser (`index.html`, `js/`), a zero-dependency Node HTTP server (`serve.js`), Node CLI tools (`tools/`), Node's built-in test runner | `package.json` (`"type": "module"`, no dependencies, `engines.node >= 18`) |
| Runtime in use | Node 24.18, Chrome on Windows 11, Intel i5-1235U, Iris Xe (WebGPU fp32 only), 16 GB | `research_notes/Acoustic pronunciation assessment/roadmap.md` §0 |
| Server | `node serve.js` → `http://127.0.0.1:8787`, localhost only; static files plus `/api/*` | `serve.js` header |
| Data | Outside the repository: `C:\DevTrees\SlokAbhyasa-data` via `local.json` (`{ "data": ... }`) or `SLOKABHYASA_DATA` | `datadir.js`, `.gitignore` |
| Branches | `main` = packaged releases (1.0.0 … 1.6.0); `AcousticAssessment` = the working branch since 18 October 2026; a feature branch merges to `main` when a package is cut | `RELEASE-NOTES.md` |
| Second repository | `research_notes/` is its own private repo (`hchowlur-ops/SlokaAbhyasa-research-notes`), ignored by the app repo; every note has an HTML rendering made by `node tools/notes-html.mjs` | `.gitignore`, `research_notes/README.md` |
| Never committed | `library/`, `quizzes/`, `local.json`, `dist/`, `docs/handoff/` (deliberately untracked), personal data of any kind, people's names anywhere under the data folder | `.gitignore`; `meta-store.js` header |
| Never pushed without the owner | All work stays local until the owner pushes | standing rule |
| Privacy | Audio never leaves the machine; Whisper runs in a browser worker; people are referred to by profile id, names live only in `profiles.json` | `js/stt-worker.js`, `meta-store.js` |
| Learner on record | One profile (`p-20261008195044-8m0l`, male, 60+), pace learnt over 20 takes (2.17 akṣaras/s, 1.34 nuclei per akṣara, breaths 491 / 703 ms) | `<data>/profiles.json` |

---

## 2. The phase router

Each phase has an entry condition, the inputs to read, the outputs to produce, and an exit
gate. A piece of work may be small enough to pass through all four in an hour; it still
passes through all four.

### PLANNING — decide what to change and why, with evidence

| | |
|---|---|
| **Entry** | A request, a wrong verdict in the app, a measurement that moved, or the next item of the ordered backlog |
| **Read** | `research_notes/todo.md` (the backlog in priority order, with sizes S/M/L); `roadmap.md` (the P0–P3 path with go/no-go gates); `debug-notes/index.md` (evidence from analysed takes); `RELEASE-NOTES.md` §Unreleased (what already changed this cycle); `SLOKABHYASA_REQUIREMENTS.md` §Scope and §Known limits |
| **Produce** | (a) For a verdict problem: a **take note** first — `node tools/debug-note.mjs <session id>` — so the discussion starts from the three windows and the ear's log, not from memory. (b) A dated section in the relevant research note stating the problem, the evidence, the options and the chosen one. (c) A `todo.md` entry or an update of the one being worked. (d) For a change of approach: a **measurement over the kept data before any code changes** (pattern: `tools/place-by-sound.mjs`, `debug-notes/2026-11-02-placement-by-sound.md`) |
| **Gate** | The problem is stated in one sentence with a number attached (which take, which cut, how far off); the chosen option names the evidence that favours it; the size is estimated; the change type lane (§3) is named |

### DESIGN — fit the change into the architecture

| | |
|---|---|
| **Entry** | PLANNING gate passed |
| **Read** | `SLOKABHYASA_ARCHITECTURE.md` §Module map (where the logic belongs: pure module, controller, server, tool), §Schemas (which files change and whether a version must move), §API, §Patterns |
| **Produce** | The design as a short dated plan in the research note (the house form: parts A, B, C … each with "what", "where", "how verified"), naming: the pure functions to add or change and their new tests; every constant introduced with its unit and the evidence for its value; the schema fields added (with `schemaVersion` / `FEAT_VERSION` / `RESULT_VERSION` / `CANON_VERSION` moves if any); the API change if any; the UI strings; what a replay must show afterwards |
| **Gate** | Logic that can be pure is pure (in `js/dsp/` or a shared `js/*.js` module, testable in Node); nothing heavy is added to the main thread; no new runtime dependency; persisted data stays readable by `sanitize*` on old files; a measurement or replay that would falsify the design is named before coding |

### DEV — build it the way this codebase is built

| | |
|---|---|
| **Entry** | DESIGN gate passed |
| **Read** | `SLOKABHYASA_CODING_STANDARDS.md`; the module headers of the files to be touched |
| **Order of work** | 1. Pure module + its test (`test/<module>.test.js`, `npm test` green). 2. Controller wiring in `js/app.js` under the right section banner. 3. Server / API (`serve.js`, `js/api.js`) if any. 4. A tool for the offline view of the new behaviour if the change concerns a take's analysis (`tools/`). 5. README: the feature's section and the Layout table. 6. `RELEASE-NOTES.md`: a bullet under the day's heading in §Unreleased. 7. The research note's status line ("built <date>"). 8. Commit (one coherent change per commit; message style in the standards; `-F` file; trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`) |
| **Gate** | `npm test` passes in full; the replays or measurement named in DESIGN were run and their outcome recorded (a take note with `--replay`, or a line in the research note); docs updated in the same commit |

### REVIEW — prove it, record it, release it

| | |
|---|---|
| **Entry** | DEV gate passed |
| **Read** | `SLOKABHYASA_VERIFICATION_CHECKLIST.md` |
| **Produce** | The checklist for the lane ticked; a debug note for any take that was analysed (HTML + Markdown twin, `tools/note-md.mjs`); the research note committed in its own repository after `node tools/notes-html.mjs`; memory of any standing decision (the project memory file) |
| **Gate** | Definition of Done met for the lane; `git status` shows nothing personal; nothing pushed; for a release: `node tools/package.mjs`, version bumped in `package.json`, a `## <version> — <date>` section in the release notes |

---

## 3. Change-type lanes

The lane fixes which parts of the checklist apply. Name the lane in PLANNING.

| Lane | Typical files | Design must state | DEV must add | REVIEW must run |
|---|---|---|---|---|
| **A. DSP / scoring / verdict logic** | `js/dsp/*.js`, `js/phon.js`, `js/textdiff.js`, `js/quizscore.js`, `js/canon.js`, `js/chandas.js` | The rule in one sentence, its constants with units, the evidence (take ids, counts), what a wrong verdict would look like after | Unit tests on synthetic signals (`test/synth.js`) or on real transcripts quoted in the test; constants exported and tested | `npm test`; the offline measurement over all kept recitals since 20 October (`tools/place-by-sound.mjs`, `tools/second-opinion.mjs`); a live replay of the take that motivated it (`tools/replay-take.mjs STT=on MULTI=off CARDS=on`); the four hand-verified takes unchanged |
| **B. Live ear / controller flow** | `js/app.js` (§SELF EVALUATION, "the ear"), `js/earlog.js`, `js/dsp/ear.js` | The state machine change, which close rule, timing budget on the main thread | `test/ear.test.js` cases for every new decision; `EarLog` columns documented | A live replay (the ear only runs live); take note with `--replay`; main-thread jitter noted |
| **C. UI** | `index.html`, `css/styles.css`, `js/app.js` render functions, `js/visualizer.js` | Which view, which state object, the strings, both themes, phone width | `aria-*` on new controls; tokens not hex; a `data-view` route if a new view | Manual smoke of the view in light and dark; README section updated; screenshots in the debug note if a verdict display changed |
| **D. Server / API / data schema** | `serve.js`, `meta-store.js`, `reference.js`, `js/meta.js`, `js/transcripts.js`, `js/verses.js`, `datadir.js` | Endpoint table rows added; schema diff; version bump; migration via `sanitize*` on read | `test/meta-store.test.js`, `test/meta.test.js`, `test/verses.test.js`, `test/datadir.test.js` cases with temp dirs | Old files on disk still load; `GET /api/baselines` on the real library; Layout table and §Where your files live updated |
| **E. Speech to text** | `js/stt.js`, `js/stt-worker.js`, the words path in `js/app.js` | Tier, device, decoding options, cancellation, steady rerun | `test/stt.test.js` with `FakeWorker` | A live replay with `STT=on`; the bench (`tools/bench/`) when a model or option changed |
| **F. Reference dataset** | `reference/gita/*`, `tools/gita/*`, `tools/reference-check.mjs` | Source commit, licence, counts, overrides | `test/reference.test.js`, `test/gita-normalize.test.js`, `test/chandas.test.js` | `node tools/reference-check.mjs reference/gita`; manifest hash; the dataset's files remain read-only |
| **G. Tools, notes, documentation** | `tools/*.mjs`, `debug-notes/`, `research_notes/`, `README.md`, `RELEASE-NOTES.md` | Usage line; what it reads and never writes | A header comment with usage; `test/note-md.test.js` for converters | Runs on the real data folder; Markdown twin regenerated; README tools table |
| **H. Release** | `package.json`, `tools/package.mjs`, `RELEASE-NOTES.md` | Version, what is in, what is deferred | — | Full checklist §Release in the verification document |

---

## 4. Standing engineering rules (apply in every phase)

1. **Measure before you rule.** A new threshold or a new arbitration rule is not accepted on the take that motivated it. It is accepted when it holds over the kept recitals (33 since 20 October 2026 as of this writing) and does not move the four hand-verified takes (listed in the verification document). The assessment of 2 November (`debug-notes/2026-11-02-assessment.md`) records why: eleven of seventeen commits since 20 October adjusted the boundary logic, each validated on the take it was written for, and the verdicts regressed.
2. **Pure core, thin controller.** Decisions live in pure modules with tests; `js/app.js` wires them to the DOM, the workers and the API. If a rule can only be tested by running the app, move it.
3. **Nothing heavy on the main thread.** Features, alignment, locating and Whisper run in workers (`js/analysis-worker.js`, `js/stt-worker.js`). The live ear's per-tick work is bounded (nucleus counting, a banded DTW on 0.8 s fingerprints).
4. **Every persisted file carries a version** and is sanitised on read. Derived data (features cache, badges, Markdown twins, HTML renderings) is rebuildable by a tool and never the source of truth.
5. **The learner's own voice is the reference where one exists.** Signatures and sound placement use the learner's clean solo takes before the library recording.
6. **Docs move with the code, in the same commit.** README section, Layout table, release-notes bullet, research note status, debug note for any analysed take.
7. **Personal data never enters the repository**, and names never enter the data folder beyond `profiles.json`.

---

## 5. Current engineering state (2 November 2026)

| Item | State | Next gate |
|---|---|---|
| Boundary placement in a recital of several slokas | The second opinion's segment is the window (1 November); the 06:34 recital of 2 November cut wrong under it. Measured alternative: ordered placement by sound, 98 of 113 slokas placed with contrast under 0.85, right on every hand-verified take | Owner's decision on the recommendation in `debug-notes/2026-11-02-assessment.md` (sound placement as the placer, the ear for page turning only, a draggable cut where contrast is weak, the measurement as a regression bench) |
| Roadmap P0 (canonical representation, metre validation, evaluation-set tooling, bench) | Built 18–21 October | P0.5 decisions; the evaluation-set recordings and their first scoring |
| Roadmap P1 proofs of concept (features + DTW, phone decode, alignment quality, memory co-residency, native timing) | Not started | Go/no-go gates in `roadmap.md` §2 |
| Speaker-line templates in the learner's voice | 8 templates on file; a bad template harvested from a coarse chunk was removed on 1 November; harvest guard added | Keep signatures fresh (ageing rule open) |
| CH11 library recordings | Do not serve as sound references (contrast ≥ 0.9); the learner's solo takes do | Re-record or rely on solo takes as references |
| Tests | 246 passing (`npm test`) | Every lane A–E change adds tests |

---

## 6. Index of canonical locations

| Need | Go to |
|---|---|
| What a feature does today | `README.md` §Workflows (Learn, Teach, Self Evaluation, Quiz, Reports, Badges, Settings, Library), §How the comparison works, §The Bhagavad Gītā reference dataset |
| When it changed | `RELEASE-NOTES.md` |
| Why a rule is what it is | The research note named in `research_notes/todo.md`; the module header; the constant's trailing comment |
| What a take's verdict saw | `debug-notes/take-<id>.md` (or run `node tools/debug-note.mjs <id>`) |
| The ear's log of a take | `node tools/ear-log.mjs <id>` |
| The offline second opinion | `node tools/second-opinion.mjs <id>` |
| Placement by sound over all recitals | `node tools/place-by-sound.mjs [--since YYYY-MM-DD] [--only <id>]` |
| A quiz attempt re-run outside the browser | `node tools/analyse-attempt.mjs <quiz> [n]` |
| A take replayed live through the app | `node tools/replay-take.mjs TAKE=<id> NAMES=<a,b> FOLDER=<folder> STT=on MULTI=off CARDS=on` |
| Simulated slips end to end | `node tools/simulate-slips.mjs --take <wav> --sloka <name>` |
| The evaluation set scored | `node tools/evaluate-set.mjs` |
| Model benchmarks on this machine | `tools/bench/` (`bench.html`, `run.mjs`, `node.mjs`) |
| The Windows package | `node tools/package.mjs` → `dist/SlokAbhyasa-<version>-windows.zip` |
| Data folder location | `local.json` / `SLOKABHYASA_DATA` (`datadir.js`) |
| Schemas and API | `SLOKABHYASA_ARCHITECTURE.md` |
| How to write code here | `SLOKABHYASA_CODING_STANDARDS.md` |
| What "done" means | `SLOKABHYASA_VERIFICATION_CHECKLIST.md` |
