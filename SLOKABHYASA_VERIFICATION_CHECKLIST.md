# SlokAbhyasa — Verification Checklist and Definition of Done

Tailored to the stack as of 2 November 2026: vanilla ES modules in Chrome, a zero-dependency
Node server, Node's built-in test runner (246 tests), offline analysis tools over the kept
sessions, live replays in headless Chrome, end-to-end simulations, an evaluation set and a
model bench. The lane letters refer to `SLOKABHYASA_MASTER_PLAN.md` §3.

---

## 1. Definition of Done (every change)

A change is done when all of the following hold, in the same commit unless stated:

- [ ] `npm test` passes in full (`ℹ fail 0`); tests were added for every pure rule that changed or was added.
- [ ] The verification steps for the change's lane (§3) were run and their outcome is recorded (take note, research note line, or the commit message).
- [ ] No regression on the boundary fixtures (§4) when the change touches lanes A or B.
- [ ] README: the feature's section says what the app now does; the Layout table lists any new file; the tools table lists any new tool.
- [ ] `RELEASE-NOTES.md`: a bullet under today's heading in §Unreleased for anything a user would notice.
- [ ] The research note that owns the topic has a dated status line; `node tools/notes-html.mjs` was run; the notes repository was committed.
- [ ] Any take analysed has a debug note (`node tools/debug-note.mjs <id> [--replay <log>]`) and the note's Markdown twin exists (`node tools/note-md.mjs`).
- [ ] `git status` shows nothing from `library/`, `quizzes/`, `local.json`, `dist/`, `docs/handoff/`; no person's name appears in anything committed.
- [ ] The commit message follows the house style (one prose paragraph, the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`); nothing was pushed.
- [ ] Every new constant has a trailing comment with its unit and reason.

---

## 2. Test levels

| Level | What | Command | Pass criterion | Cost |
|---|---|---|---|---|
| **L0 Unit** | Pure modules on synthetic signals and quoted transcripts | `npm test` (`node --test test/*.test.js`) | 0 failures; new behaviour has a named test | ~15 s |
| **L1 Offline over kept data** | The same pure modules run over real sessions in `<data>/sessions` | `node tools/second-opinion.mjs <id|all>`, `node tools/place-by-sound.mjs [--since d] [--only id]`, `node tools/analyse-attempt.mjs <quiz> [n]`, `node tools/ear-log.mjs <id>` | Numbers do not fall against the previous run; the fixtures in §4 hold | 5 s per take; ~3 min for all recitals since 20 October |
| **L2 Live replay** | A kept take played as the microphone through the real app in headless Chrome; the ear runs live, cards are pressed | `node tools/replay-take.mjs TAKE=<id> NAMES=<a,b> FOLDER=<folder> STT=on MULTI=off CARDS=on` | The verdicts expected in DESIGN appear; the ear log is attached to the take note with `--replay` | 1–3 min per take; needs Chrome and the model cached |
| **L3 Simulated slips end to end** | Flawed cuts of a real recitation through Self Evaluation and a one-sloka quiz | `node tools/simulate-slips.mjs --take <wav> --sloka <name> [--other <wav>] [--padas a,b,c]` | Exit code 0: control Excellent/Good with no slip; restarted pāda named, 15 % off, Needs practice; dropped pāda "akṣaras dropped"; wrong pāda scored without a slip; known limits reported not failed | ~10 min; needs the app running |
| **L4 Evaluation set and bench** | Labelled deliberate errors scored per category and voice; model speed and memory | `node tools/evaluate-set.mjs`; `tools/bench/` (`bench.html`, `node run.mjs`, `node node.mjs`) | Detection share per category does not fall; false-report share on clean takes does not rise; bench within the roadmap's budgets | as the set grows |
| **L5 Manual smoke** | The affected view in the real app, light and dark theme, with the real library | `node serve.js --open` | The checklist in §5 for the view | 5–15 min |
| **Release** | The package | `node tools/package.mjs` | The zip launches on a clean machine; §6 | 10 min |

Replays with `MULTI=on` starve the recorder (12 s of audio lost on a 63 s take); faithful
replays use `MULTI=off`.

---

## 3. Coverage rules by lane

| Lane | L0 | L1 | L2 | L3 | L4 | L5 | Notes |
|---|---|---|---|---|---|---|---|
| **A. DSP / scoring / verdict** | required: a test per rule, constants through consequences | required: all recitals since 20 October; fixtures §4 | required for the motivating take | required when slips or grades change | required when categories or phonology change | the scoreboard and a report | A rule validated on one take is not done |
| **B. Live ear / controller flow** | required: `test/ear.test.js`, `test/earlog.test.js` | required: `ear-log.mjs` on the motivating take | required (the ear only runs live) | when a close rule changes | — | record a take of 3–4 slokas yourself once | note main-thread jitter if the tick changed |
| **C. UI** | if a pure helper changed | — | if a verdict display changed | — | — | required: both themes, phone width, keyboard page turn, the wave above an open report | screenshots in the debug note when relevant |
| **D. Server / API / schema** | required: `meta-store`, `meta`, `verses`, `transcripts`, `datadir` tests with temp dirs; an old-shaped object still loads | run `GET /api/baselines` against the real library and open one sloka's details | — | — | — | Library, Learn save, Reports | version bump decided and written down |
| **E. Speech to text** | required: `test/stt.test.js` with `FakeWorker` | — | required with `STT=on`; `heard.json` from `CARDS=on` compared | if the words path changes | bench when a model or option changes | Settings › Speech recognition, a Teach take | |
| **F. Reference dataset** | required: `reference`, `gita-normalize`, `chandas`, `verses` tests | `node tools/reference-check.mjs reference/gita` | — | — | — | Learn's chapter and verse cards | the dataset's files stay read-only; manifest hash updated |
| **G. Tools, notes, docs** | `test/note-md.test.js` for converters; a tool's pure part if any | run the tool on the real data folder | — | — | — | open the HTML note and its Markdown twin | README tools table |
| **H. Release** | full | all recitals | one take | one sloka | the set | every view | §6 |

---

## 4. Regression fixtures for boundary placement (lanes A and B)

The cuts below were verified by hand on 1–2 November 2026 against the slokas' own sound
(`debug-notes/2026-11-01-arbiter.md`, `2026-11-02-placement-by-sound.md`). A change to the
ear, the second opinion, the adoption rule or the comparison windows must leave every cut
within **1.0 s** of these values when the take is re-evaluated (`tools/second-opinion.mjs`,
`tools/place-by-sound.mjs --only <id>`, or a replay), and must not change a sloka's "recited /
dropped" verdict on them.

| Take (session id) | Slokas | Cut 1 | Cut 2 | Cut 3 | Known wrong answers to watch for |
|---|---|---|---|---|---|
| `20261101-064104-33mt` (06:41, words on) | CH18-01..04 | 20.4 | 42.2 | 60.4 | a false "repeated उवाच सन्या" on CH18-01; CH18-04 starting inside CH18-03 |
| `20261101-070324-oo8n` (07:03) | CH18-01..04 | 17.2 | 35.4 | 50.1–52.3 (unresolved between the second opinion and the sound) | the ear 2.2 and 3.7 s late; "27 of 32 dropped" on CH18-04 |
| `20261101-083846-xeca` (08:38) | CH18-01..04 | 17.0 | 36.0 | 51.8 | the ear 3–4 s late; the right windows at contrast 0.885–0.93 rejected by the 0.87 gate |
| `20261102-063453-2dom` (06:34) | CH18-03..06 | 16.1 | 31.0 | 47.1 | the ear 2.8 / 5.6 s late; the second opinion's `partialLast` hypothesis 8–12 s late; CH18-06 "dropped 18 of 32" though whole |

Aggregate guard (`node tools/place-by-sound.mjs 2026-10-20`, last line of its output), as of
2 November 2026: `takes 33, slokas 113, sureByEither 98, takesAllSure 24, refsAgree 7`. A change
to `js/dsp/locate.js` or `features.js` must not lower `sureByEither` or `takesAllSure`.

Arbiter baseline (`debug-notes/2026-11-01-arbiter.md`): over 30 judgeable cuts of 22
recitals, the second opinion within 1 s on 24, the ear on 15. A change to `segment.js` or
`ear.js` reports the same tally after it.

---

## 5. Manual smoke checklists (L5)

**Self Evaluation (3–4 slokas, words on):** tick a folder; record; the page turns sloka by
sloka; space/→ turns by hand; on stop every card carries a spinner then a score; the
whole-recital wave shows every cut with "2nd (used)" or "ear" and a thick pin where the page
was turned by hand; the wave stays above an open report and follows the card's play button;
advice lines appear for first-time and Needs-practice slokas; the session appears in Reports
with Listen; `sessions/<id>/ear.json` exists; `node tools/debug-note.mjs <id>` renders it.

**Teach:** one sloka; play at 0.5× and 2× (pitch kept); Listen → report with scores, chart,
deviations and transcript; a clean take stores signatures (the notice says so when it does
not).

**Learn:** chapter cards with coverage; a verse with a speaker line shows the tick; record,
see the pace against the learner's; save → the sidecar has `verse`, `text.origin:
"reference"`, `chandas`; the next verse is in view.

**Quiz:** "Pick 3 at random" from one open folder; start; recite from memory; the attempt is
scored and listed; after the third Excellent on a third day a badge card appears and Home
shows it.

**Library:** rename, move to a new folder, trim (original under `backup/`), right-click shows
every sidecar key, Link to the Gītā on an unlinked sloka.

**Settings:** weights "Defaults" restores 30/25/15/10/10/5/5; tolerance "Ignore" removes
verdicts; the STT tier and language switch; the script switch rewrites the texts; dark theme
on every view.

**Both themes, phone width:** no horizontal scroll at 390 px; every token has a dark value.

---

## 6. Release checklist (lane H)

- [ ] `package.json` version bumped; `APP_VERSION` is read from it by `meta-store.js`.
- [ ] `RELEASE-NOTES.md`: §Unreleased renamed `## <version> — <date>`, a fresh §Unreleased opened.
- [ ] README: §Run it and §A package for people who will not install anything are current.
- [ ] L0–L5 run on the release commit; the fixtures of §4 hold.
- [ ] `node tools/package.mjs` → `dist/SlokAbhyasa-<version>-windows.zip`; unzip on a clean folder, double-click the launcher, the browser opens on `127.0.0.1:8787`, the reference dataset is inside, a take evaluates.
- [ ] The branch is merged to `main`; `main` is tagged by the owner; nothing is pushed by an agent.

---

## 7. Reviewer's checklist (what to look for in a diff)

- **Evidence:** does every new number carry its reason, and does the commit message name the take or measurement behind the rule?
- **Purity:** could this logic have been a function with a test? If it is in `app.js` and decides a verdict, ask for the module.
- **Both failure directions:** when a gate is loosened (a window accepted on length fit, a doubt withdrawn), what wrong verdict becomes possible, and is it excluded on the fixtures?
- **Self-knowledge:** does the new component say when it cannot decide (a contrast, a margin), or does it always return an answer?
- **Schema:** a new persisted field has a version decision, a `sanitize*` path and an old-file test.
- **Workers:** heavy work off the main thread; cancellation through `AbortController`; a stop is not an error.
- **Privacy:** no name in data, no network call outside the speech worker's model loading, nothing personal in the diff.
- **UI:** `aria-*` present, tokens not hex, dark theme covered, strings in the app's voice with correct diacritics.
- **Docs:** README section, Layout/tools table, release-notes bullet, research-note status, debug note and twin, all in the commit.
- **Scope:** the change does what the plan says — not narrower (a part left for later without saying so), not wider (an unrelated refactor).

---

## 8. Performance budgets to check when touched

| Budget | Value | Where measured |
|---|---|---|
| Features + DTW per stretch | 0.2–0.5 s in the worker | `tools/analyse-attempt.mjs`, the comparison's progress |
| Main-thread jitter while a worker runs | < 25 ms | DevTools performance trace during a replay |
| Best Whisper (large-v3-turbo) per lone sloka | ~21 s; Fast ~1.5 s | Settings notice; `tools/bench/` |
| Tab memory | < ~4 GB with Best resident | `tools/bench/`, Task Manager |
| Offline placement by sound | ~5 s per 60 s take (≈ 40 locates) | `tools/place-by-sound.mjs` timing |
| Test suite | ~15 s | `npm test` |
