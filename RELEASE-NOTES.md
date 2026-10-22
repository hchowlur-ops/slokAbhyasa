# SlokAbhyasa — release notes

What changed in each packaged version (`node tools/package.mjs` builds
`dist/SlokAbhyasa-<version>-windows.zip`), newest first, and what has been built since the
last package. The README describes every feature as it stands; this file says when it came.

## Unreleased — since 1.6.0 (branch `AcousticAssessment`, 9–21 October 2026)

### 21 October 2026

- **A take of several slokas is judged by its sound.** The words are no longer heard
  for a take of several slokas unless the new Settings switch "Hear the words in a take
  of several slokas too" is on (off by default): a ten-sloka take scores in seconds
  instead of minutes. The open report's "Hear the words" button still hears that sloka.
- **The learner's own practice stands in for the words.** In such a take the three word
  categories (phonemes, vowel length, syllables) of each sloka are the mean of the
  learner's last three Good or Excellent evaluations of that sloka on its own. The card
  says "sound · words from your practice"; a sloka without three such evaluations shows
  the sound alone and asks to be evaluated on its own three times.
- **The ear confirms what the timbre rejects.** A sloka the sound comparison called
  "not this sloka" but whose stretch the ear closed with at least half the count is taken
  as recited, with a note, and its sound scores stand (dropped akṣaras are noted when the
  count was short).
- **The slokas of a take are taken in verse order** — 12.6 before 12.7 whatever their
  recording dates — the order the picker shows. The ear used to expect them in the
  library's creation order.
- **Every ticked sloka is loaded before the take.** Recordings load as they are ticked,
  the record button waits for any still loading, and a plan that arrives after the page
  turned is picked up on the next tick. The ear used to have no plan past the first sloka.
- **A fluent teacher's recording gets pāda starts.** A linked recording with fewer
  breaths than pādas gave the ear no fingerprints at all, so the sound-based restart
  detector could never fire; the starts now fall by each pāda's share of the akṣaras and
  move to a breath's end when one lies near.
- **The next sloka's opening heard by sound.** From three akṣaras before the plan's end
  the live sound is matched against the next sloka's first pāda; a confident match closes
  the sloka where that opening began, breath or no breath, and the next sloka's count
  starts from the akṣaras already counted.
- **Two slokas chanted without a breath.** The ear closes a sloka whose count is at the
  plan's end when the voice goes straight on for half a second, and one a few akṣaras
  short when a pause the length of the learner's own pause between slokas comes; the words
  confirm a sloka by two signals; a stretch heard badly is heard again in halves; the first
  ticked sloka is in view before the take.
- **Tools:** `tools/evaluate-set.mjs` scores the evaluation set of deliberate errors
  against the labels; `tools/bench/` benchmarks the speech and encoder models on this
  machine (a page, a headless runner and a Node runner). Session items now carry the
  words' findings (error counts and the akṣara-by-akṣara alignment).

### 18 October 2026

- **The canonical phonetic representation** (`js/canon.js`): the sound inventory with
  its features, the akṣaras in their pādas, the realisation slots, and the plan the ear
  counts against, compiled from the Gītā dataset and validated against the metre.
- A take starts on the first sloka (the page index was read while recording and kept the
  last take's page).

### 16–17 October 2026

- **The ear's expectations come from the learner alone:** what the app learns of a
  learner (speed, pauses), boundaries moved by the words, a pace-aware search where there
  is no ear. The comparison no longer reads a slower pace as "more material".
- Self-corrections are read from the words as one stream of sounds, blind to word breaks;
  dropped akṣaras are judged at the stop for every take, and from the words alone when the
  ear cannot.
- The simulated slips joined the test suite: unit tests on real transcripts and synthetic
  sound, and an end-to-end runner.
- Results: "Play both together" beside the scoreboard's ring; the sloka's name on the
  Analysis fold. Learn's review card shows the take's pace beside the chosen learner's.

### 11–15 October 2026

- **The Bhagavad Gītā reference dataset** (`reference/gita/`): every verse with its
  text, metre and translation; recordings linked to verses, the dataset read-only,
  customisations in the data folder; a linked recording's words are the verse's.
- **Learn, redesigned:** one sloka at a time from chapter and verse cards, the exact verse
  link, replace-or-keep with a backup; a "Slokas per take" setting.
- **Several slokas in one take:** each is heard to its end and sent on by itself; the ear
  counts against the akṣara plan and turns the page the moment a sloka is complete;
  restarts heard by the pāda-start fingerprints; a slip is graded Needs practice;
  self-correction costs 15 % and is named; under half recited is not scored; a scoreboard
  for the take; a spinner on the card being evaluated. (Packing two short slokas in one
  30-second window was built and removed on 14 October.)
- **Hearing the words** is a Settings switch, with a note on what is not judged when it is
  off; the words are heard in Sanskrit alone and written in Kannada, Telugu or IAST with
  laghu / guru marks; the sloka's words are the Gītā's or the typed text, never the
  teacher's recording transcribed; the Best model unless one was chosen; the visarga's
  sandhi in recitation honoured.
- Moments under the grade, a progress strip in Reports, badges for a quiz mastered.
- Library: no Transcribe button or model; a right-click lists everything saved about a
  sloka; the anusvāra as the circle or ṃ in the other scripts.
- `restart-server.cmd` stops the local server and starts it again. A presenter's script
  for a live demo.

### 9–10 October 2026

- The metre (chandas) of every sloka, its lines, a hint, and pāda-by-pāda counts; the
  Yours row laid out by the metre; the two-or-four-lines choice for anuṣṭubh.
- Words while recording: a page turned sends its stretch to the speech worker; one report
  at a time, the others transcribed in the background; each sloka's "Yours" is its own
  stretch of the take.
- Settings: the language the sloka's text is shown in; hide the sloka's text while
  recording; hide the results' Transcript block.
- The text of every chosen sloka in one scrolling panel; the About page and the invocation
  on every page; the new logo; daṇḍas on displayed ślokas; quiz results laid out like Self
  Evaluation; the demo video re-recorded.

## 1.6.0 — 8 October 2026

Shared folder picker and perform block for Teach, Self Evaluation and Quiz; the logo's
palette on every page; a switch to ignore tolerances; the results folded once there are
results, the overall in the middle and the analysis under it; Whisper's spelt-out visarga
and anusvāra read as the sounds they are; the Player page removed.

## 1.5.0 — 8 October 2026

Score the recitation, not the voice: phonemes, vowel length, syllables and manner become
the categories the words are judged on.

## 1.4.0 — 8 October 2026

Reports dashboard: past quizzes and evaluations by date or by folder.

## 1.3.0 — 8 October 2026

Telugu; every sloka transcribed in every language in the background.

## 1.2.0 — 8 October 2026

A weighted overall with grades; the transcript under the scores.

## 1.1.0 — 7 October 2026

Judge by who is reciting; a details file kept with every sloka.

## 1.0.0 — 4 October 2026

The first package: Teach, Self Evaluation, Quiz and the Library, the comparison by sound,
the words by Whisper on this computer.
