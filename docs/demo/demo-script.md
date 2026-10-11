# SlokAbhyasa — presenter's demo script

A script for giving SlokAbhyasa a live, hands-on demonstration on your own laptop, to an
audience of Gītā learners and teachers with a few developers among them. The full tour takes
10–15 minutes; a 5-minute version is at the end. It follows the arc of the narrated video
(`docs/demo/SlokAbhyasa-demo.mp4`), scene by scene, but every scene here is something you
click and say yourself. Keep the video open in a player, paused: it is the fallback if the
live setup fails.

Every label in quotes is the exact wording on the screen. Durations are a guide; the only
scene that cannot be hurried is Teach, where the app has to listen and think.

---

## Before the demo

Do all of this *before* the audience arrives. The app's first use of anything (the speech
model, a sloka that has no transcript yet) takes far longer than its second, and that is not
what you want on stage.

### The machine

- [ ] **Node 18 or newer** is installed: `node --version` in a terminal.
- [ ] **The server is running**: in the project folder, `node serve.js` (or `npm start`). The
      console prints the address and where the library and quizzes live. Leave that window
      open; closing it stops the app.
- [ ] **http://127.0.0.1:8787 is open in Chrome.** Chrome (or Edge) because the "Best"
      speech model needs WebGPU, which Firefox and Safari may not give the app. Never open
      `index.html` from the file system: the microphone works only on localhost.
- [ ] **WebGPU checked.** Open "Settings" › "Speech recognition" › "Model". If you have never
      chosen a model on this machine, the one shown is the app's own choice: **"Better"
      means the browser has WebGPU, "Fast" means it has not.** Hover over "Best": its tooltip
      says "whisper-large-v3-turbo, about 750 MB download, needs WebGPU". Choosing "Best"
      without WebGPU gives the message *The "Best" model needs WebGPU, which this browser
      does not offer. Choose "Fast" or "Better".* What to pick:
      - a laptop with a proper graphics card: "Best";
      - WebGPU present but an ordinary laptop: "Better";
      - no WebGPU, or the toast *This computer's graphics card gets the … model wrong, so
        from now on it runs on the processor* has appeared: "Better" if a transcription of
        one sloka finishes in under half a minute in rehearsal, else "Fast". (Intel Iris Xe
        laptops land here: the card computes nonsense with the models and the app moves them
        to the processor by itself, which is correct but slow.)
- [ ] **"Transcribe automatically (Learn, Self Evaluation, quizzes)"** is ticked on the same
      card. Without it nothing is transcribed and the word scores never arrive.
- [ ] **The speech model is downloaded and warm.** The first use of a model tier downloads it
      (75 MB to 750 MB, from Hugging Face; the only moment the app needs the internet) and
      the first transcription after that compiles it. Open "Self Evaluation", tick one sloka:
      the model is loaded in its worker as soon as the sloka is ready. Then do one throwaway
      take in "Teach" (choose a sloka, tap the red button, recite, tap again) and wait until
      the report has its words under "Analysis". Look at the bottom of the sidebar, above
      "Who's reciting": if it says "Transcribing … " or "N transcriptions waiting…", wait
      until that line is gone. Do not start "Transcribe all" in the Library before a demo.
- [ ] **Internet** is not needed after that, but a tethered phone is a cheap insurance
      against a model that has to be fetched again.

### The library

- [ ] **A chapter-12 folder** (the video's is called "CH-12") with at least "CH12-01" to
      "CH12-05". Names of the form "CH12-03" matter: the app reads the Gītā verse from them
      and knows the metre without guessing.
- [ ] **Every sloka you will show has its transcript already.** In "Library" each card
      should carry the tags "N akṣaras" and "Anuṣṭubh" (amber with "· 31 of 32 syllables"
      when the transcript lost a syllable). A card without them: click its "Transcript",
      then "Transcribe"; or "Transcribe all" and wait for the sidebar to go quiet.
- [ ] **CH12-03 has its text typed in** ("Details" on its card › "Text of the sloka", one
      pāda or line per row, in any of the four scripts; "Save details"). The typed text is
      the reference for the word scores, so the Teach report does not blame the reciter for
      a slip of the speech model's own.
- [ ] **A learner is chosen** under "Who's reciting" in the sidebar: "People…" › add the
      reciter with a voice type and age group › "Done", then pick them. The report then
      says which allowances it used, which is a good line for teachers.
- [ ] **A quiz with two or three attempts already exists** ("Chapter 12 · sloka 3", say),
      made in rehearsal, so the "Trend" fold has a line to show and "Saved quizzes" is not
      empty.
- [ ] **A few Self Evaluation or Teach takes from this week** exist, so "Reports" › "Week"
      has rows.
- [ ] **A clean audio file** of a sloka that is *not* in the library yet (the video used the
      teacher's recording of 18.66) sits on the desktop for the Learn scene. If you saved it
      in rehearsal, delete that copy ("Library" › "Delete" on its card) so the demo does not
      make a duplicate. The import tab takes its folder from the "Folder" dropdown on the
      "Listen with the microphone" tab (the last one used is remembered): set it there first,
      or you will be asked "Which folder should this sloka go in?" on save, which is also fine.

### Sound

- [ ] **Microphone tested in "Learn"** › "Listen with the microphone": tap the red button
      (Chrome asks for the microphone once; "Allow"), speak, watch the level meter and the
      live waveform move, make sure "CLIP" does not light; tap again; "What SlokAbhyasa
      heard" appears with its words; "Discard". A laptop's own microphone picks up the whole
      room: a headset or a USB microphone close to the reciter is far better.
- [ ] **Headphones** plugged in for "Play both together", which puts the sloka in the left
      ear and the reciter in the right. Through room speakers the two sides are mixed and the
      point is lost; either hand the headphones to a volunteer and describe what they hear,
      or use the "Sloka" / "Yours" buttons of the deviations list instead, which play one
      side at a time.
- [ ] **The room is quiet** while recording; a noisy room gives the note *Your recording
      sounds quite different from the sloka overall (voice, microphone or room)* and
      blurs the content deviations.

### Screen and settings

- [ ] **"Settings" › "Sloka text" › "Show the sloka's text in"** set to the audience's
      script: "Sanskrit · संस्कृतम् (as heard)", "Kannada · ಕನ್ನಡ", "Telugu · తెలుగు" or
      "English · romanised (IAST)". The script scene below switches it live; put it back
      afterwards.
- [ ] "Show a hint of the chandas (metre)", "Show the slokas' text during Self Evaluation"
      and "Show the slokas' text while reciting a quiz" ticked; "Hide the transcript in the
      results" unticked; "Weights" and "Tolerance" at "Defaults"; "Ignore tolerances ·
      scores and grades only" off.
- [ ] Light theme for a projector ("Theme" at the foot of the sidebar switches), browser zoom
      at 110–125 % so the back row can read the transcript, no other tabs.
- [ ] **The demo video** (`docs/demo/SlokAbhyasa-demo.mp4`, 26 MB, with subtitles in
      `SlokAbhyasa-demo.srt`) open in a player and paused, in case the live part fails.

### The reciter

- [ ] Someone to recite: you, or a volunteer who knows chapter 12. They need **two
      recitations of CH12-03** ready:
      - a *good* one for Self Evaluation and the quiz (from memory, at an ordinary pace);
      - a *deliberately flawed* one for Teach: **rush the first line**, then **leave out
        two or three syllables in the second half** (drop a word in the third pāda, say).
        Rehearse it; the point is that the report finds exactly those two things, and a
        half-hearted flaw gives a muddled report.
- [ ] The reciter sits by the microphone, not by the projector's speakers.

---

## Timings at a glance

| Scene | Full tour | 5-minute version |
| --- | --- | --- |
| 1. Home | 0.5 min | 0.25 min |
| 2. Library | 1.5 min | — (one sentence) |
| 3. Learn | 1.5 min | — (one sentence) |
| 4. Teach | 4 min | 3 min |
| 5. Self Evaluation | 2 min | — |
| 6. The text in another script | 1 min | — |
| 7. Quiz | 2.5 min | 1 min (the saved list and its trend only) |
| 8. Reports | 0.75 min | 0.25 min |
| 9. Settings | 1 min | — |
| 10. About and close | 0.5 min | 0.5 min |
| **Total** | **≈ 15 min** | **≈ 5 min** |

Opening line, before any click (15 seconds): *"SlokAbhyasa is a small app for learning
slokas by ear. You give it a verse — recorded, or from a file — and it listens, remembers it,
and later tells you how closely your own recitation matches: the sounds, the vowel lengths,
every syllable, and the manner. Everything runs on this laptop; nothing is uploaded."*

---

## Scene 1 · Home — 0.5 min

**Clicks**
- The app is already open on "Home" (the house icon, first in the sidebar). If not, click
  the gold-and-blue **SlokAbhyasa** wordmark at the top of the sidebar.

**Say**
- "It opens with the invocation — ॐ श्री कृष्ण परमात्मने नमः — in Sanskrit, Kannada,
  Telugu and English."
- "And with the sloka the Gītā closes on, 18.66, with its translation."
- "The pages are on the left: Learn, Teach, Self Evaluation, Quiz, Reports, Library,
  Settings, About. We will go through them in the order a learner would."

**On screen**
- The invocation in four scripts, the logo, 18.66 in Devanagari and the English lines,
  "Bhagavad Gītā 18.66". The same invocation heads every page and sits under the logo in the
  sidebar.

**Pitfalls**
- None. If the page is blank, the server is not running: look for the console window.

---

## Scene 2 · Library — 1.5 min

**Clicks**
1. Sidebar › "Library".
2. Scroll the list slowly past the chapter-12 folder.
3. Point at the row of tags under one sloka's name.
4. **Right-click** the name of "CH12-03". A popup opens, "Everything saved about this
   sloka". Scroll inside it to the "Chandas" section at the bottom.
5. Press Esc (or click anywhere else) to close it.
6. Optional: click "Transcript" on "CH12-02" to show its stored words; click it again to fold.

**Say**
- "This is the learner's own library: a folder per chapter, and every sloka an ordinary WAV
  file on this computer. You can copy or back them up with Explorer."
- "Under each name, what the app knows about it: who recorded it, how it is judged — a sloka
  recited, a stotra sung, Vedic with svaras — how many akṣaras its text has, its metre, and
  the pitch of the voice."
- (popup) "A right-click lists everything saved with the sloka: the file, who recorded it,
  the text, the voice and the recording as measured, the microphone, what was trimmed, and
  here at the bottom the chandas — anuṣṭubh, four pādas of eight syllables, with the
  laghu-guru pattern it found in the text."
- "The words beside each recording were written by a speech model running on this laptop,
  and they can be corrected by hand — the Library is the one place to do that."

**On screen**
- Toolbar: "Self Evaluation with selected", "New folder", "Trim silence in all slokas",
  "Transcribe all", and the note "Right-click a sloka for everything saved about it."
- Each card: a play button, the name, the tag row ("by Ananya", "Sloka or stotra,
  recited", "32 akṣaras", "Anuṣṭubh", "178 Hz"), and the buttons "Details", "Rename",
  "Move…", "Transcript", "Delete".
- The popup's sections: "The file", "Details", "Text", "Voice, as measured", "Recording, as
  measured", "Capture", "Edits", … and "Chandas" with "Family", "Syllables per pāda",
  "Laghu / guru", "Gītā verse".

**Pitfalls**
- A card showing "no details" or "style not set · judged as chant" in amber is a sloka from
  an older version; say so in one phrase ("this one was saved before details existed") or
  pick another card.
- A tag "noisy · 18 dB" means that recording is poor; do not use that sloka in Teach.
- If the popup opens off-screen, close it with Esc and right-click nearer the middle.

---

## Scene 3 · Learn — 1.5 min (keep it short)

Import a file rather than record: it is deterministic and the microphone gets its turn in
Teach. If you would rather record, the microphone variant is below.

**Clicks (file)**
1. Sidebar › "Learn".
2. Tab "Use an audio file" › "Choose an audio file" › pick the prepared file.
3. Wait for the waveform; the transcript panel under it fills in by itself (a progress bar
   first: "Preparing the speech model…", then "Transcribing …").
4. Type a name in "Name this sloka" (for instance "CH18-66 demo").
5. Point at the details fields: "Recorded by", "How it is judged", "Tradition or school
   (optional)", "Text of the sloka (optional …)".
6. "Save to library". A toast: *Saved "CH18-66 demo" with its transcript to the library.*

**Clicks (microphone, the alternative)**
1. Tab "Listen with the microphone"; the label reads "Tap to start listening".
2. Tap the red button; play the teacher's recording near the microphone, or recite; the label
   reads "Listening… tap to stop"; tap again.
3. "What SlokAbhyasa heard": the waveform, a play button, the words.
4. "Name this sloka", "Folder" (any folder, or "New folder…"), "Save to library"
   ("Discard" throws it away).

**Say**
- "To teach the app a new sloka you record it — or, as here, you give it a file: the
  teacher's recording of 18.66."
- "It trims the silence, writes down the words it hears, and shows them. Do not wait for the
  words: you can save at once and they are added when ready."
- "Three optional details travel with it: whose voice this is, how it should be judged, and
  the text as it should be recited. Typing the text matters: the comparison then uses the
  text, not the model's own hearing, as the reference."
- "Save. The recording, its words and its details are stored together in the folder."

**On screen**
- The file's name and length, "Change file", the waveform, the transcript panel with its
  "Model" choice, "Automatic" switch and "Transcribe" / "Edit" buttons, the save row,
  "Trim silence at the start and end" ticked.
- On save, a progress bar "Listening closely and remembering…" for a few seconds (the
  recording is analysed once and the result cached, so evaluations against it start at once).

**Pitfalls**
- The file's words are still being written when you want to move on: save anyway; the toast
  says *Its transcript is still being written and will be added when ready.*
- The transcript comes back in Latin letters or looks wrong: say "approximate, as speech
  recognition of Sanskrit is; the Library's 'Edit' fixes it" and move on. Do not edit live.
- *Hardly any sound was detected*: the file is silent or the microphone was muted; pick the
  file again or check the level meter.
- No folder chosen: the dialog "Which folder should this sloka go in?" appears; choose one
  and "Save here".

---

## Scene 4 · Teach — 4 min (the heart of the demo)

**Clicks**
1. Sidebar › "Teach".
2. Step "1 · Choose a sloka": open the chapter-12 folder (click its head) and click the
   radio button of "CH12-03". The step's head now shows the name; the strip under the search
   box says "1 chosen".
3. Step "2 · Play it, then recite it back": the sloka's text with its daṇḍas sits at the top,
   over the waveform. Click the speed chip "½×", then the Play button. Let four or five
   seconds play; click Play again to stop; click "1×".
4. The red button's label reads "Tap to listen: recite the sloka, then tap again to stop".
   Tap it. The reciter gives the **flawed** recitation (first line rushed, a few syllables
   dropped in the second half). The label reads "Recording… tap to stop". Tap it again.
5. Steps 1 and 2 fold up ("Recorded 0:14 · open to record again"). Step "3 · Results" shows
   **"Evaluating…"** with a progress bar: "Listening back to what you sang…", "Comparing
   with the sloka…", then the transcription. Talk through it (below); do not click.
6. The ring appears: the overall score, its grade, and the verdict line.
7. Put the headphones on the reciter (or a volunteer). Click **"Play both together"**
   ("sloka left · yours right"). Let it play five seconds; click again to stop.
8. Click **"Analysis"** (the fold under it, "the words heard, category scores, the chart,
   every deviation"). Walk down it:
   - the "Transcript": the "Sloka" row and the "Yours" row, each with a play button; the
     highlighted words; the summary line under them ("88% of the sloka's typed text heard
     (14 of 16 words) · 2 missing · 1 extra or different · Sanskrit"); click the fold
     "Sounds and syllables · phonemes … · vowel length … · syllables …" under it: inside,
     the counts, then "Anuṣṭubh · syllables heard per pāda — pāda 1: 8 of 8 · pāda 2: …",
     which shows which pāda lost its syllables, and the slips named one by one;
   - the seven tiles: "Phonemes", "Vowel length", "Syllables", "Emphasis", "Pitch contour",
     "Phrasing", "Timing";
   - the notes under them;
   - the chart with its legend;
   - "Deviations" with the chips "Content", "Missing / extra", "Pitch", "Timing",
     "Dynamics", "All"; click a "Yours" button on one deviation, then its "Sloka" button.

**Say**
- (step 2) "Teach works on one sloka at a time. Here is 12.3 with its text, written in its
  pādas with the daṇḍas. Play it as often as you like — at half speed, with the pitch kept,
  which is how a beginner learns a line."
- (before recording) "Now the learner recites it back. For the demonstration we will rush
  the first line and drop a couple of syllables later on, so you can see what the app
  catches."
- (Evaluating…) "The moment you stop, three things happen: the app listens back and lines
  your take up with the sloka, sound by sound; it compares the two; and the speech model
  writes down what you said. The scores come first and the words follow — the model is the
  slow part."
- (the ring) "One overall score and a grade, out of seven categories. The words carry
  seventy per cent: the right sounds, the right vowel lengths, every syllable. The manner
  carries thirty: emphasis, the rise and fall, the pauses, the timing — all relative to your
  own voice, so a child and an adult are on the same scale. The verdict says which
  categories are outside the tolerance you set."
- (Play both together) "The sloka in the left ear, your recitation in the right, from the
  same moment at the same speed: the difference is heard, not read."
- (Transcript) "Your words against the sloka's text, laid out in the same metre. Sloka words
  that were not heard are highlighted in red; words of yours that are extra or different in
  amber. Click any phrase to hear it. Under them, the syllables counted pāda by pāda —
  here is the pāda that lost its syllables."
- (tiles) "Each category with its score, what it rests on, and whether it is within
  tolerance. Pitch contour is for interest only on a recited sloka — recitation prescribes
  no tune."
- (chart) "The two pitch contours on one timeline, a loudness lane, and shaded bands where
  something differed."
- (deviations) "Every deviation with two buttons, so you can hear just that moment in the
  sloka and in your own voice. The speed was not judged — we rushed the first line and it
  cost nothing; speed is judged only when you ask for it in the options."

**On screen**
- Step 2's options under the recorder: "I'm wearing headphones", "Play the sloka while I
  record", "Ignore an overall key difference" (ticked), "Judge the speed of recitation"
  (unticked), "Trim silence at the start and end of my recording" (ticked); the learner
  note ("Judging Ananya (…): pitch within ½ semitone …").
- The results card: the ring with the number, the grade ("Excellent", "Good", "Fair" or
  "Needs practice"), "Overall", the verdict ("Within tolerance" or "Outside tolerance:
  syllables, …"); "Play both together" with a "Speed" slider; the "Analysis" fold; at the
  very bottom a "Not judged: …" fold for categories that could not be judged.
- Notes such as *Overall you took 12% less time than the sloka (speed is not judged).* and
  *Your voice is lighter in character than the sloka's (8%); the comparison allowed for
  that.* — read one aloud if it is there.
- "Record again" at the head of the results.

**Pitfalls and recoveries**
- **The words take long.** The scores and the ring are already there; keep talking over the
  tiles and the chart and come back to the "Transcript" when the rows fill. The first
  transcription after a "Stop" is slower (the model is reloaded from the browser's cache);
  the first ever is much slower (download). If it is past a minute, click "Stop" on the
  progress bar, say "the acoustic comparison does not need the words", show the report
  without them, and use "Transcribe again" later or fall back to the video for the transcript.
- **The toast *This computer's graphics card gets the Better model wrong, so from now on it
  runs on the processor: slower, but right.*** appears: that is the app protecting itself
  from a GPU (Intel Iris Xe is the usual one) that computes nonsense; the transcription is
  redone on the processor. Say so; it only happens once per model.
- **"Does not sound like this sloka"** in red: the reciter did another verse, or the room
  swallowed the take. "Record again" (at the head of the results) opens both steps again.
- **The overall looks too kind or too harsh for the flaws**: the tiles say why. A rushed line
  costs nothing by design; dropped syllables show in "Syllables" and in "Missing / extra".
  If "Syllables" is still "Within tolerance", the dropped syllables were too few — the
  tolerance is 10 %, which on a 32-syllable sloka is three syllables.
- **No "Sounds and syllables" fold, or no per-pāda line inside it**: the sloka's text and
  the hearing did not align well enough; skip it.
- **Room speakers instead of headphones**: skip "Play both together"; the deviations' "Sloka"
  / "Yours" buttons make the same point one side at a time.
- Do not click the sidebar while the recording is running.

---

## Scene 5 · Self Evaluation — 2 min

**Clicks**
1. Sidebar › "Self Evaluation". (Teach and Self Evaluation share a screen; the slokas ticked
   here are remembered separately from Teach's choice.)
2. Step "1 · Choose one or more slokas": open the chapter-12 folder and tick "CH12-01" to
   "CH12-05" (or tick the folder's own checkbox, then untick the rest). The step's head reads
   "5 slokas ticked"; a chip per sloka sits under the search box.
3. Step "2 · Perform it": the panel "The selected slokas" shows one sloka at a time —
   "‹ Previous", "1 of 5", "Next ›" — with its play button, speed chips, the chandas hint
   ("Anuṣṭubh · 4 pādas of 8 syllables (32) · pathyā") and its text. Click "Next ›" twice so
   "CH12-03" is in view.
4. The red button reads "Tap to start recording · compared with 5 slokas". Tap; the reciter
   gives the **good** recitation of 12.3 from memory; tap again.
5. "Evaluating…"; then the results open on one report, with a "Reports" head above it:
   "‹ Previous", "1 / 5", "Next ›".
6. Click "Next ›" once or twice: the other reports carry the red flag "Does not sound like
   this sloka". Come back with "‹ Previous".
7. Open the fold **"All the reports"** ("5 rows · where each sloka was found in your
   recording, and its conflicts") and point at the bars.

**Say**
- "Self Evaluation takes several slokas at once. Tick five, and the panel pages through them
  with their text and their metre."
- "Recite any one of them from memory — the app works out which one you sang."
- "One recording, five reports. The one it found opens first with its score; the other four
  are flagged as not matching this recording. Previous and Next step through them."
- "All the reports: each bar is your recording from start to end, with the stretch where that
  sloka was found shaded. Recite verses one to eight in one take and tick eight slokas, and
  each report shows its own stretch."
- "Meanwhile the words of every report are transcribed in the background, in turn, so that
  Next opens a report with its words ready."

**On screen**
- The folder head's checkbox (half-filled when only some are ticked), "Tick all" and
  "Clear" over the picker, the chips with their × to untick.
- The chandas hint under the sloka's name in the panel; hover it for the pattern.
- The rows of "All the reports": name, bar, overall score, number of conflicts; "Within
  tolerance" or the categories outside it.

**Pitfalls and recoveries**
- The report that opens first is the sloka that was *in view* when you recorded, not
  necessarily the one recited. If a flagged report opens, click "Next ›" until the scored
  one, or click its row under "All the reports".
- An amber "Conflicts with …" on two reports means two slokas with different material
  matched the same stretch; it happens with very similar verses. Say "at most one of them can
  be right" and open the one with the higher score.
- Tick one sloka only if time is short; the panel then has no paging and the results have no
  "Reports" head — everything else is the same.
- Ticking another sloka after the take compares it straight away, without recording again:
  a nice aside if someone asks.

---

## Scene 6 · The text in another script — 1 min

**Clicks**
1. Sidebar › "Settings" › card "Sloka text" › "Show the sloka's text in" › choose
   "Kannada · ಕನ್ನಡ" (or "Telugu · తెలుగు").
2. Sidebar › "Self Evaluation": the results are still there. The panel's text and the
   "Sloka" / "Yours" rows of the report are now in Kannada, and above every akṣara a small
   ◡ or —, with the legend "Above each akṣara: ◡ laghu (light) · — guru (heavy)".
3. Back to "Settings", choose "English · romanised (IAST)"; back to "Self Evaluation" to show
   the Latin text with the same marks and "|", "||" for the daṇḍas.
4. Put the setting back to the audience's script.

**Say**
- "The words are always heard as Sanskrit, in Devanagari. Kannada, Telugu and romanised text
  are written *from* it, akṣara by akṣara, so the three never disagree with it."
- "In those scripts every akṣara carries its weight in the metre above it — laghu, light,
  or guru, heavy — the way chandas is taught."
- "The same setting governs every text in the app: the sloka panel, the transcripts in the
  Library, the rows of a report."

**Pitfalls**
- The marks do not appear in the Sanskrit view: that is by design; they are shown in the
  three written scripts.
- Teach's report is not where you left it if you switched between Teach and Self Evaluation:
  show the panel's text in step 2 instead, which switches script at once.

---

## Scene 7 · Quiz — 2.5 min

**Clicks**
1. Sidebar › "Quiz". Step "1 · New quiz".
2. Under "How many slokas" choose "One sloka". (The button reads "Pick one at random" now;
   with "Several slokas, at most 10" it reads "Pick 10 at random" and draws from the open
   folders.)
3. Open the chapter-12 folder in the picker and tick "CH12-03". The strip reads "1 chosen";
   "Start quiz…" lights up.
4. "Start quiz…" › the dialog "Name this quiz": type a friendly name ("Chapter 12 · sloka
   3"), "Start". The date and time are appended to keep it unique.
5. You land on the quiz screen: the title reads "Quiz", step "1 · This quiz" has a box with
   the "Quiz" tag, the name, "Leave quiz" and the list of slokas; step "2 · Recite with the
   text shown" shows the panel "The slokas of this quiz" with the text but **no play button**.
   The red button reads "Tap to start the quiz recording · 1 sloka".
6. Tap; the reciter gives the good recitation; tap again. "Evaluating…", then "Scoring the
   quiz…" on the button, then the toast *Quiz attempt 1 saved.*
7. The quiz block tops the results: the ring with the overall and grade, the correctness
   under it; the "Scored on" chips ("Phonemes", "Vowel length", "Syllables" lit; "Emphasis",
   "Pitch contour", "Phrasing", "Timing" not); the table with ✓ / ✗ per category and the
   "Within tolerance" row. Click "Emphasis" once to add it, watch the table change, click it
   again to drop it.
8. Open the "Trend" fold under the table: a line per attempt. (With one attempt it is a
   point; that is why the rehearsal quiz exists — see step 10.)
9. Below: "Play both together" and "Analysis", exactly as in Teach. Say so; do not open them.
10. Click the head of step 1 to open it, then "Leave quiz". Step "2 · Saved quizzes" lists
    every quiz: name, "100% correct" with its grade, "Retake", "Details", "Delete", and a line
    "1 sloka from CH-12 · 3 attempts · last … · best … · scored on Phonemes + Vowel length +
    Syllables". Click "Details" on the rehearsal quiz: the picks, the trend chart over its
    attempts, and a table with "Listen" on each attempt's recording.

**Say**
- "Quizzes test memory. Pick one sloka or several — or let the app pick at random from the
  chapters you have open — and name the quiz."
- "The recording stays hidden until you have recited; the text is shown by default, and a
  setting hides it to recite from memory, everything in one take, in any order."
- "Scored on fixed tolerances: a sloka is *correct* when every chosen category is within
  tolerance. By default the three word categories count; the chips add emphasis, pitch
  contour, phrasing or timing, and the choice applies to every attempt of this quiz, past and
  future, because everything is measured whatever you choose."
- "Every attempt is saved with its recording, so the trend shows the weeks of practice.
  Retake it any time."

**On screen**
- The dialog's note "The date and time are added to the name to keep it unique."
- After the take the panel gains its play button and speed chips; the quiz box's hint reads
  "Recite these from memory, in one recording and in any order…".
- In the table, the open sloka's row is highlighted; clicking another row (with several
  slokas) opens that sloka's words and analysis.

**Pitfalls and recoveries**
- The quiz **always transcribes** the take: the word categories need the speech model. Expect
  the same wait as in Teach; talk over "Evaluating…" with the scoring rules above. If the
  model cannot run, the word categories are left out of the verdict and the block says so.
- "Start quiz…" stays grey: with "Several slokas" at least two must be ticked; with "One
  sloka", exactly one.
- The "Leave quiz" button is inside step 1, which folds once results are in: click the step's
  head first.
- Short on time: skip steps 1–9 and show only "Saved quizzes" and "Details" of the rehearsal
  quiz (that is the 5-minute version).

---

## Scene 8 · Reports — 0.75 min

**Clicks**
1. Sidebar › "Reports". "By date" is lit, "Week" is lit.
2. Point at the summary line ("This week · 4 sessions · 1 quiz, 3 evaluations · 7 slokas
   assessed · average overall 84 · best 93 Excellent").
3. Click one row: its detail opens with one line per sloka, a totals line, "Listen" and
   "Close". "Close".
4. Click "By folder"; choose the chapter-12 folder under "Folder"; tick "Group by sloka".
5. "All time" if the week is thin.

**Say**
- "Reports gathers everything you have been assessed on — every quiz attempt, every Self
  Evaluation or Teach take — by day, week or month."
- "By folder, a teacher sees every assessment of every sloka of a chapter on one line each,
  with the seven categories, and grouped by sloka with its best score."
- "Each session keeps its recording: Listen plays it."

**Pitfalls**
- "Nothing in this period": click "All time" or "‹" to an earlier week. The choices are
  remembered, so put "Week" and "Today" back afterwards.

---

## Scene 9 · Settings — 1 min (brief)

**Clicks**
1. Sidebar › "Settings". Scroll through the four cards without changing anything:
   "Weights · what the overall score is made of" (seven fields, "Defaults"),
   "Tolerance · acceptable variation" (seven fields, "Defaults", and the switch "Ignore
   tolerances · scores and grades only"),
   "Speech recognition" ("Model": Fast / Better / Best; "Transcribe automatically (Learn,
   Self Evaluation, quizzes)"),
   "Sloka text" (the three switches, "Show the sloka's text in", "Show a hint of the chandas
   (metre)", "Write an anuṣṭubh sloka in" two lines or four).
2. Point at the right-hand card "Why these defaults" and at the note under both columns,
   "Whisper · how the words are heard".

**Say**
- "The weights: phonemes 30, vowel length 25, syllables 15, emphasis 10, pitch contour 10,
  phrasing 5, timing 5. Change them, and the weights in force are saved with every attempt,
  so an old score is never rewritten."
- "The tolerances: what counts as within tolerance in each category. A quiz always uses the
  defaults for the chosen learner. 'Ignore tolerances' turns every within-or-outside verdict
  off and leaves scores and grades, for a teacher who wants numbers only."
- "The speech model: three sizes, downloaded once, run on this computer. And how the text is
  shown — which we saw."
- "'Why these defaults' explains the weights from the Śikṣā classification of sounds and
  lists the references. And the Whisper note is the honest paragraph: the model has seen very
  little Sanskrit, so treat its words as a guide and type the sloka's text for a reliable
  reference."

**Pitfalls**
- Do not change a weight or tolerance live unless you mean to; verdicts on screen follow at
  once, and the audience's reports will look different from what they just saw.

---

## Scene 10 · About and close — 0.5 min

**Clicks**
1. Sidebar › "About".
2. Say the closing lines over it; then back to "Home" to leave the invocation on screen for
   questions.

**Say**
- "About says what it is for: students, and anyone learning the Bhagavad Gītā, who want to
  learn its ślokas by ear and recite them well. The akṣara, not the voice, is what is judged,
  so a child and an adult, a man and a woman, are measured on the same scale."
- "Everything ran on this laptop. Nothing you heard today was uploaded; the only download is
  the speech model, once."
- "Your recordings are plain WAV files in your own folders, easy to copy and back up."
- "SlokAbhyasa is free and open source: **github.com/hchowlur-ops/slokAbhyasa**. For
  people who will not install anything there is a zip with a launcher — unzip, double-click,
  and the browser opens on the app."

**On screen**
- The logo, the wordmark, "śloka · abhyāsa — verse, practice", three paragraphs.

---

## The 5-minute version

Keep four scenes and say one sentence each about the rest.

1. **Home** (15 s) — the opening line, the invocation and 18.66.
2. **Teach, complete** (3 min) — Scene 4 as written, but: play the sloka for three seconds
   only, skip the chart, open one deviation only. This is the scene that shows what the app
   is. While "Evaluating…" runs, say the Library and Learn sentences: *"The slokas are WAV
   files in a folder per chapter on this laptop; a new one is recorded or taken from a file,
   and the app writes down its words."*
3. **Quiz › Saved quizzes › "Details"** of the rehearsal quiz (45 s) — "quizzes ask for
   slokas from memory; every attempt is saved; this is the trend over three attempts" —
   and one glance at **"Reports"** › "By folder" (15 s).
4. **Close** (30 s) — the About sentence, nothing uploaded, the GitHub address.

Skip Self Evaluation, the script switch and Settings; offer them for questions. If the
Teach take fails twice, play the video from 1:54 (Teach) and talk over it.

---

## Questions the audience asks

**What exactly is scored, and why those weights?**
Seven categories. From the words heard: *phonemes* (30) — every consonant and vowel against
the text, by the features the Śikṣā treatises use (place of articulation, voicing, aspiration,
nasality, visarga, double consonants; one feature off earns half credit); *vowel length*
(25) — short against long, which changes the meaning in Sanskrit and is the commonest slip;
*syllables* (15) — akṣaras missing, added or replaced. From the sound, relative to the
reciter's own voice: *emphasis* (10), *pitch contour* (10, the rise and fall with the key
difference removed), *phrasing* (5, where the pauses fall), *timing* (5, pauses and material
the sloka does not have). The words carry 70 % because Sanskrit is written as it is spoken,
so a slip of the tongue is a slip of a letter; no category uses timbre or voice quality. The
overall is the weighted mean of the categories that could be judged; Excellent from 90, Good
from 80, Fair from 65. All of it is changeable in Settings.

**How accurate is the speech recognition, and why Sanskrit only?**
The words are written by OpenAI's Whisper running in the browser. It has seen very little
Sanskrit and no chant at all, so it hears a recited sloka approximately; a slip it reports
may be its own. That is why the app always hears Sanskrit in Devanagari — one transcript —
and *writes* Kannada, Telugu and romanised text from it, so the four never disagree; why its
spellings of the visarga and the anusvāra are read as the sounds they are; why the typed
text of a sloka is used as the reference when there is one; and why the tolerances on the
word categories are set so that a correct recitation passes even on an approximate
transcript (a real, well-recited take scored 97 / 92 / 95). The acoustic comparison — the
alignment, "Play both together", the deviations — does not depend on the words at all.

**Does anything get uploaded?**
No. The server binds to localhost; your audio never leaves the computer. The one thing
fetched from the internet is the speech model itself, once per size (75 MB to 750 MB from
Hugging Face, then cached by the browser), and the small library that runs it, from a CDN.
After that it works offline.

**Can it work for other texts — stotras, bhajans, Vedic chant, songs?**
Yes. "Sloka" is the app's word for any short recording it has learnt. "How it is judged" in a
sloka's details chooses the style: a sloka or stotra recited (pitch shown, not scored), Vedic
with svaras (pitch counts as a melody), a stotra or bhajan sung, a poem, prose, a song,
Indian classical. The metre reading knows the anuṣṭubh and the triṣṭubh family, which cover
the Gītā; other metres are counted but not named. The Gītā is where it is tuned, and names
like "CH12-03" let it use the Gītā's own list of metres.

**What about children's voices?**
Add the child under "People…" with a voice type and age group. Before anything is compared,
the take is read at the "voice warp" that fits the sloka best, so a child's higher vowels
line up with an adult's recording and only real differences are reported. The allowances
then widen with age: under 8, pitch within a semitone and +20 % on the word tolerances; 8 to
11, ¾ semitone and +10 %; 12 to 15, +5 % — because speech recognisers make two to five times
more errors on children's voices. The report lists the allowances it used. One honest limit:
when the two voices are very far apart a very slight slip can hide in the voice difference,
and the report says so when that is the case.

**What hardware is needed?**
Any laptop that runs Node 18 and Chrome, and a microphone. A graphics card with WebGPU lets
the "Best" model run and makes "Better" fast; without it the models run on the processor —
"Fast" in seconds, "Better" in tens of seconds per sloka. Some integrated cards (Intel Iris
Xe) compute nonsense with the models; the app notices, moves to the processor and tells you
once. The first use of a model downloads it, which is the only time the internet is needed.

**How are recordings stored? Can I back them up or move them?**
Each sloka is a mono 16-bit WAV in a folder of `library/` with sidecar files of the same
name: `.json` (its details), `.transcript.json` and `.txt` (its words), `.features.json` (the
cached analysis). Copy or move them with Explorer; the app reconciles its index with the disk.
Quizzes are JSON files in `quizzes/` with each attempt's recording beside them; takes from
Self Evaluation and Teach are in `sessions/`. People's names stay in `profiles.json` at the
data root, never inside the library. A `local.json` next to `serve.js` points the data folder
anywhere you like — another drive, a folder you already back up. None of it is in the code
repository.

**Can I correct the text?**
Yes, in two places. "Library" › "Transcript" › "Edit" corrects the words the model heard
(edited in Devanagari whatever script they are shown in; keep one line per phrase and the
click-to-play timings survive). "Library" › "Details" › "Text of the sloka" takes the
canonical text, in any of the four scripts, one pāda or line per row; that text becomes the
reference for every comparison, which removes the model's errors from one side of the
judgement. The `.txt` beside the WAV can also be edited in any text editor.

---

## Known limitations to be honest about

- **Whisper hears chants approximately.** It has seen very little Sanskrit and writes
  Devanagari the Hindi way (a visarga as "ह" or "हा", a nasal as anusvāra); the app folds those
  two, but other slips in a transcript still show in the word scores. Treat the words as a
  guide, rely on the acoustic comparison for the verdict, and type the sloka's text.
- **The first transcription is slow.** The first ever use of a model downloads it; the first
  transcription after a "Stop" is slower too, while the model is reloaded from the browser's
  cache. Warm it up before the demo.
- **Some GPUs get the models wrong.** Intel Iris Xe advertises 16-bit floats and computes
  garbage with them, and gets whisper-small wrong even at full precision (it loops "the same
  two words"). The app never uses fp16, redoes a nonsense answer on the processor, says so
  once, and keeps that model on the processor from then on; the decoder can also loop on its
  own when a chant's even rhythm leads it round in circles, and such an answer is redone once
  with a repetition penalty.
- **Speed is not judged by default.** A rushed or dragged line costs nothing unless "Judge
  the speed of recitation" is ticked; pauses, skipped and added material always count.
- **The quiz always transcribes.** Its word categories need the speech model, so every attempt
  waits for it; if the model cannot run, those categories are left out and the block says so.
- **Pitch is for interest on recited text.** With the style "Sloka or stotra, recited" the
  pitch tile is shown but does not count; recitation prescribes no tune.
- **"Content" means acoustic similarity, not words.** Pitch tracking is monophonic (one voice
  at a time); a very different microphone or room lowers the precision of the content
  deviations, and the report says when that seems to be the case; a noisy sloka recording
  (tagged "noisy · N dB" in the Library) blurs every comparison against it.
- **Long chants.** Whisper loses its way in a long take; the app transcribes stretch by
  stretch, each where a sloka was found, and a single sloka's worth comes out well.
- **Far-apart voices.** A high voice's harmonics are far apart, which blurs its vowels; when
  the learner's and the recorder's voices are very different, a very slight slip can hide in
  the voice difference. The report says so.
- **Settings live in the browser.** Weights, tolerances, the model choice and the text
  options are remembered per browser, not in the data folder; another browser starts from the
  defaults.

---

## If the live demo cannot run at all

Play `docs/demo/SlokAbhyasa-demo.mp4` (seven minutes, narrated, with subtitles) and pause it
at the Teach report to take questions; the arc is the same as this script, minus Self
Evaluation's script switch. The video's Library is a learner's chapter 12, so everything the
audience sees there matches what they would see live. Where the scenes start in the video:
Library 0:35, Learn 1:23, **Teach 1:54**, Self Evaluation 4:02, Quiz 5:01, Reports 6:12,
Settings 6:21, the outro 6:31.
