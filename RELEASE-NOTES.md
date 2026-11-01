# SlokAbhyasa — release notes

What changed in each packaged version (`node tools/package.mjs` builds
`dist/SlokAbhyasa-<version>-windows.zip`), newest first, and what has been built since the
last package. The README describes every feature as it stands; this file says when it came.

## Unreleased — since 1.6.0 (branch `AcousticAssessment`, 9 October – 1 November 2026)

### 1 November 2026

- **The second opinion places every sloka of a recital.** On three recitals of CH18-01..04
  the ear cut two to four seconds late at every cut after the first (a breath shorter than
  the one it had learnt, a count a few short, and the lateness carried on), so slokas were
  judged on stretches holding the previous sloka's last pāda and the next one's first, and
  the last sloka came out "akṣaras dropped" though recited whole. The second opinion had
  every cut within half a second of where the slokas' own recordings lie in the take by
  sound; measured over 30 cuts of 22 recitals since 20 October it is the more reliable
  (within a second of the sound on 24 cuts against the ear's 15). Its segment is now the
  window each sloka is compared on. Where the sound comparison falls short of the match line
  there — this learner's own recordings sit at contrast 0.88–0.96 on the right window — the
  second opinion's placement vouches for the sloka when its sung time lies within 70–140 % of
  the expected; failing that, the ear's stretch has its say and is kept when the sound
  matches there or the ear's count vouches for it. A stretch that keeps the second opinion's
  window loses the ear's count and the "akṣaras dropped" that count made. The whole-recital
  wave marks such a cut "2nd (used)", and the ear's log keeps each sloka's two windows and
  which it kept. A first version of the day kept the ear's window unless the sound matched on
  the second opinion's, and lost the 08:38 recital to it: the right windows for CH18-02..04
  sat at contrast 0.885–0.93, over the line. A speaker line the words place with one chunk
  spanning the whole window is no longer harvested as a template (one cut so at 18.3 s of the
  morning's first take held CH18-01's tail and then pinned CH18-02's start two seconds early).
- **The whole recital's wave stays when a card is open.** Opening a sloka's card no longer
  hides the recital's wave: it stays above the report, its playhead follows the card's play
  button as it does the whole recital's, and the open card again closes the report.
- **Advice under the cards of a recital.** A sloka recited for the first time: practise it on
  its own a few times before it joins a recital. A sloka that is Needs practice: evaluate it
  alone, whole and clean, where it is judged more surely and a clean take keeps its
  signatures.
- **The words of a sloka in a recital, read more carefully.** The previous sloka's last words
  at the head of a sloka's window, or the next sloka's first words at its tail (the ear's cut
  early or late), are the neighbours', not akṣaras you added. A hearing in which the
  recogniser looped — far more sounds than the sloka has and a run said three times over, or
  more akṣaras than the ear heard sung and a run said twice — is heard once more held steady
  (a repetition penalty from the first run), and if it still loops its words are not used: no
  slips, no word scores, the card says "the recogniser looped on its words · sound only". A
  hearing far thinner than the stretch's nuclei, asked for from a card, is heard again in two
  halves as a live stretch already was. The words' "akṣaras dropped" is doubted when the
  ear counted the stretch whole, or the second opinion placed the stretch at its expected
  length, and the words miss six akṣaras and 15 % of the sloka or more (the recogniser
  skipping, not you; a pāda dropped takes a quarter off the sung time and is not doubted). And a short echo across two words with the recogniser's
  drift — *uvāccha sanyā|sasya* read as a-sany / a-sasy — is no longer a repeat: a saying
  under eight sounds must begin where a heard word begins and be said again to the sound.

### 31 October 2026

- **A sloka that echoes itself is no longer a repeat.** The self-correction detector
  took CH18-02's kāmyānāṁ karmaṇāṁ nyāsaṁ saṁnyāsaṁ for words said twice and cost the
  take 15 % and Needs practice; 161 of the Gītā's 719 slokas echo themselves so. A second
  saying that is where the sloka's own text goes on is now the language, not a slip; a
  real restart in such a sloka is still heard.
- **A sloka practised on its own places itself in a recital.** A clean evaluation of a
  sloka alone keeps its first and last two seconds in your voice; in a recital the second
  opinion matches every sloka's beginning, then confirms each with its ending, and pins
  the cuts between slokas placed from both ends. The picker shows how often each sloka
  was evaluated alone and ticks those whose signatures are kept; a recital with a sloka
  without them says so, and a Settings switch can require it. A solo take that cannot keep
  the signatures says why and asks for another; a speaker line heard in a recital counts
  as the beginning of its sloka.
- **The next sloka in view.** With several slokas the panel shows the sloka in view and,
  under it, the next one, so a page turn is never a surprise.
- **The speaker lines heard in your own voice.** The Gītā's four speaker lines are matched
  after a take against templates of how *you* say them, harvested whenever a sloka's words
  are in and place its line; a line heard marks the start of the sloka that opens with it,
  and the second opinion pins the cut before it. Kept per learner beside the profiles.

### 28 October 2026

- **A sloka ending with the word the next begins with is not a repeat.** 1.1 ends with
  "sañjaya" and 1.2 opens with "sañjaya uvāca"; when a sloka's window ran a little into
  the next, the words read the word said twice. The self-correction detector now knows the
  next sloka's opening.
- **Why Needs practice.** An i beside the take's grade lists which slokas need practice
  and for what; an i on a card that speaks of akṣaras dropped or words missing names the
  missing akṣaras, with a way to the analysis, or offers to hear the words. The analysis
  names the words missing from what was heard.
- **Every sloka's card plays and transcribes.** A play button on each card hears that
  sloka alone; a words icon hears its words now, whatever the Settings say, and opens its
  report on the Analysis fold with the words shown. The whole recital's play button sits
  under the overall score; its card is gone (the wave still shows when no card is chosen).
  The report's Transcript block shows only once the words are in, and its own Transcribe
  button is gone.
- **"Akṣaras dropped" by the count alone needs a real shortfall.** When the words are not
  heard, the ear's count marks a sloka dropped only at the bar the words use: four or more
  akṣaras short and a tenth of the plan. A take of 92 was graded Needs practice for two
  slokas counted two and three short.
- **Yours plays the sloka's own sound.** In a sloka's report, Yours and Play both together
  start at the sloka's first sound after the breath and end after its last, instead of at
  the looser edges of the stretch it was compared on, which began inside the previous
  sloka's tail.
- **The second opinion cuts through sound where there is no breath**, at a dip of the
  level and at a cost, so a learner who goes straight on into the next sloka no longer
  sends its cut to the next pause; the slokas a take never reached are left unplaced
  instead of being squeezed in. A session's file is re-read before the
  recording and the ear's log are written into it, so one no longer loses the other's
  mark.

### 27 October 2026

- **The whole recital, then each sloka.** With several slokas the results open on the
  whole recital: a card of its own whose play button plays the whole take, and whose wave
  shows where the teacher's slokas were matched, where the ear cut and where the second
  opinion cut (a thick line where you turned the page). A sloka's card opens its report,
  where Yours plays that sloka's stretch alone and everything shown is its; the open card
  again comes back. A Transcribe this sloka button hears the open sloka's words on demand.
- **Turn the page from the keyboard, and tell the ear.** In Self Evaluation and a quiz the
  space bar or → turns to the next sloka and ← to the previous; while you recite, a turn
  is your word that the sloka is over: the stretch closes where your breath began, the
  ear starts the next count at once and learns your pace from the sloka you confirmed, and
  the second opinion keeps your cut. A key pressed just as the ear turns by itself agrees
  with it rather than turning twice. Previous and ← are off while you recite.

### 24 October 2026

- **A second opinion on the sloka boundaries.** After a take of several slokas the app
  now also finds where the slokas lie from the whole recording: the cuts chosen together
  among the take's pauses so that every sloka's sung time agrees with what is expected of
  it (the plan at your speed, the teacher's time at your tempo, or each sloka's share of
  the take's sound), a longer breath preferred; the pace on the day is fitted within a
  range, and the ear's count at the stop says whether the take ended inside its last
  sloka. Nothing is decided by it yet: it is written into the ear's log beside the ear's
  own stretches, and `tools/second-opinion.mjs` compares the two on one kept take or all
  of them. What it found on the kept takes is in the research note on the boundaries.

### 22 October 2026

- **The ear's log.** A take of several slokas keeps a log of what the ear saw and decided
  — the count against the plan about eleven times a second, pauses, restart and
  next-sloka checks by sound, each close and its rule, each page turn, the stretches sent
  on and the words back — saved beside the session as `sessions/<id>/ear.json` at no cost
  to the take. `tools/ear-log.mjs` prints it with the comparison's windows and a summary
  (when each sloka closed, by what rule, how long after the last sound the page turned,
  the counter's nuclei per akṣara and the akṣaras per second against the learnt pace);
  `tools/replay-take.mjs` replays a kept take through the live app in headless Chrome
  and prints the same.

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
