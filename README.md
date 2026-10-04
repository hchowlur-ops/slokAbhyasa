# SlokAbhyasa

A local web app for learning and memorising audio by ear: chants, verses, songs, phrases.
Play a recording at any speed, let SlokAbhyasa *learn* a sloka, then *evaluate yourself* against it
and see exactly where your attempt deviates, with the sloka and your own recording one click away.

SlokAbhyasa calls every recording it has learnt a *sloka* (a verse); the word is used for any short
piece, chanted, sung or spoken.

Everything runs on your machine. Slokas are ordinary WAV files in folders under `library/`
(one folder per chapter, say); quizzes are JSON files in `quizzes/`.

## Run it

```
node serve.js
```

Then open <http://127.0.0.1:8787> in Chrome, Edge, Firefox or Safari. No install step;
Node 18 or newer is the only requirement. (`npm start` does the same thing.)

### Where your files live

Your recordings and quizzes are yours, not part of the code: `library/`, `quizzes/` and
`local.json` are listed in `.gitignore`, so a `git push` never carries them along. By
default they sit beside the code. To keep them somewhere else (outside the repository, on
another drive, in a folder you already back up), write a `local.json` next to `serve.js`:

```json
{ "data": "C:\\Users\\you\\SlokAbhyasa" }
```

`library/` and `quizzes/` are then made inside that folder (a relative path counts from the
project folder, `~` is your home folder). The environment variable `SLOKABHYASA_DATA` does
the same and wins over the file. The server prints both locations when it starts. To move an
existing library, stop the server, move the `library` and `quizzes` folders to the new place,
write `local.json`, and start again; nothing inside the files refers to where they are.

The server binds to localhost only. Microphone access requires a "secure context", which
localhost is, so do not open `index.html` directly from the file system.

## Workflows

### Player
Drop or browse for an audio file. Play, pause, loop, seek by clicking the waveform, and change
the speed from 0.5× to 2× with the pitch preserved (or not, if you untick that option).
Space plays or pauses, the arrow keys skip 5 seconds.

### Learn
* **Listen with the microphone** – tap the red button, play or perform the material, tap again.
  Review what SlokAbhyasa heard, name it, save.
* **Use an audio file** – pick a file (or use the one already loaded in the Player) and save it
  directly as a sloka. Files are converted to mono 16-bit WAV.

The save row has a **Folder** choice: any existing folder of the library, or "New folder…"
to make one. Every sloka lives in a folder; there is no saving at the top level of the
library, and if no folder exists yet you are asked to name the first one when you save.
Folders are how the Quiz offers its material (a chapter per folder, say). The last folder used
is remembered.

Silence (and stray clicks) at the start and end of a take are trimmed automatically before
saving; untick "Trim silence at the start and end" to keep a recording as it was captured.
A short lead-in (about a tenth of a second) and the natural decay at the end are kept.

Saving also analyses the recording once and caches the result next to the WAV, so evaluating
yourself against it later starts instantly.

### Teach
Learning one sloka at a time. The list is the same as in Self Evaluation, grouped by folder,
but you choose exactly one. Under it appear two buttons:

* **Play** plays the sloka; the speed chips (or the slider) go from half speed ("½× slower")
  to double speed ("2× faster") with the pitch kept. Play it as often as you like.
* **Listen** starts recording; recite the sloka back and press Listen again (it reads
  "Stop · SlokAbhyasa is listening" meanwhile). Then SlokAbhyasa compares what it heard with the sloka and
  shows the same report as Self Evaluation: scores, chart, deviations, transcript.

Teach and Self Evaluation share their screen; switching back to Self Evaluation restores the
slokas you had ticked there.

### Self Evaluation
1. Tick one or more slokas; the list is grouped by folder. Click a name to preview it and
   listen at any speed.
2. Record your attempt once. If you wear headphones you can have the previewed sloka play
   while you record. The one recording is compared with every ticked sloka.
3. Read the results (one report per sloka, see "Several slokas at once" below):
   * **Scores** for content, pronunciation (once the transcript is there), timing, pitch and
     dynamics, plus an overall score (weighted for chanting and recitation: content 45 %,
     timing 35 %, pitch 20 %). Each tile says whether it is **within tolerance** (see below),
     and the ring carries the verdict for the whole report.
   * A **chart** with the sloka pitch contour and yours stretched onto the same timeline,
     a loudness lane, and shaded bands where something differed. Click a band to select it.
   * A **list of deviations**, each with a "Sloka" and a "Yours" button that plays just that
     moment (with a little padding) so you can hear the difference.
   * "Play the sloka" and "Play what SlokAbhyasa heard" play the whole recordings, at any speed.

**Several slokas at once.** With more than one sloka ticked, the results start with a
list of reports. Each row shows the sloka's name, a bar that stands for your recording from
start to end with the stretch where that sloka was found shaded, coloured marks for the
conflicts inside it, the overall score and the number of conflicts. Click a row, or use
Previous / Next, to open that sloka's full report; the preview at the top of the page
switches with it, so "Play the sloka" and the sloka text always belong to the open report.
Tick another sloka after a take and it is compared straight away, without recording again.
You can also tick slokas in the Library and press "Self Evaluation with selected".

*Different lengths.* A sloka does not have to be as long as your recording. When one is
much longer than the other (more than 1.5 times), SlokAbhyasa first finds the part of the longer
recording that matches the shorter one and compares only that: recite verses 1 to 8 in one take
and tick the single-verse slokas, or recite one verse against a sloka that holds the
whole chapter. The report says which part was used, all times stay those of the full
recordings, and the word comparison greys out the words outside that part.

*Conflicts.* Besides the deviations inside each report, the list highlights:

| Highlight | Meaning |
| --- | --- |
| Red outline, "Does not sound like this sloka" | Your recording does not seem to contain this material at all, so its scores mean little. |
| Amber outline and hatched bar, "Conflicts with …" | Two slokas with different material were both matched to the same part of your recording; at most one of them can be right. |
| Grey note, "Same part of your recording as …" | Two slokas that hold the same material (a verse, and a longer recording that contains it) matched the same part. Nothing is wrong. |
| Red outline, "Could not be compared" | The comparison failed for this sloka (for example a silent file); the report says why. |

**What is shown.** Everything is always measured and scored. By default the chart and the list
show **content**, **missing / extra** and **pitch** deviations; the chips above the list add
**Timing** or **Dynamics** (loudness), and **All** shows every kind (click it again for the
default view). Click any chip to show or hide that kind; the choice is remembered.

Options: ignore an overall key difference (on by default, so singing in a different key is
reported as a note but not penalised) and penalise overall tempo (off by default, since slow
practice is the point).

**Tolerance.** How much variation is acceptable in each category, as a percentage: a category
is within tolerance when its score is at least 100 minus the tolerance. The defaults are
content 10 %, pronunciation 10 %, and 60 % for timing, pitch and dynamics. Change them in the
"Tolerance" row under the recording options (Self Evaluation and Teach share the setting, which
is remembered); "Defaults" puts them back. Verdicts on screen follow a change at once. In the
list of reports each row says "Within tolerance" or which categories are outside it. A quiz
always judges on the default tolerances and its fields are locked.

### Transcripts (speech to text)
* **Learn** – after a take (or when you pick a file) the words are transcribed automatically
  and shown under the preview. Use "Edit" to correct them; the text is saved with the sloka
  as `<name>.transcript.json`. You need not wait for it before saving.
* **Self Evaluation** – as soon as you choose a sloka its text appears at the top of the page
  (transcribed on the spot if it has none yet). After each attempt your words are transcribed
  and compared: sloka words that were not heard are highlighted in red at the top and in the
  results; extra or different words in your attempt are highlighted in amber. Click any phrase
  to hear it. "Transcribe again" reruns with another language or model.
* **Library** – "Transcript" shows, creates or corrects the transcript of a sloka.

Every transcript panel has a language and model choice and an "Automatic" switch (shared
across the app); turn it off if you would rather transcribe only on demand.

**Transcription never holds you up.** It runs in its own worker thread, alongside the
acoustic analysis, and the app stays usable meanwhile:

* In **Learn** you can save while the words are still being written: the sloka is stored at
  once and the transcript is added to it when ready (a message tells you when).
* In **Self Evaluation** your attempt's transcription starts the moment you stop recording,
  while the comparison runs; the results appear first and the word diff fills in after.
* Every transcription shows a progress bar with a **Stop** button. Stopping leaves the
  recording without a transcript (press "Transcribe" later to make one); stopping while a
  quiz is being scored gives that attempt no pronunciation score. After a stop the next
  transcription can take a few seconds longer while the speech model is reloaded from the
  browser's cache.

**Correcting the text.** Recognition of chants is approximate, so every panel (Learn,
Self Evaluation, Library) has an "Edit" button. The editor shows one line per timed phrase; keep the
same number of lines and the click-to-play timings survive your corrections. Saving writes two
files next to the recording in `library/`:

* `<name>.txt` – the plain text, one phrase per line. Edit it in any text editor if you prefer;
  when it is newer than the JSON, SlokAbhyasa uses it the next time the sloka is opened.
* `<name>.transcript.json` – the same text with phrase timings, language and model.

Corrected text is used as the reference when your attempts are compared.

Languages: **English, Sanskrit (Devanagari), Kannada**. Models: Fast (whisper-base, about
75 MB), Better (whisper-small, about 250 MB), Best (whisper-large-v3-turbo, about 750 MB,
needs WebGPU). The default is Better when the browser has WebGPU, otherwise Fast.

On WebGPU the models run with 4-bit weights and 32-bit arithmetic, never 16-bit floats:
some GPUs (Intel Iris Xe among them) advertise fp16 but compute nonsense with it, which
Whisper turns into empty or garbled text. Some GPUs get a model wrong even in fp32 (the same
Iris Xe loops "the same two words" for whisper-small). When a GPU answer looks like that,
nothing or a word or two repeated for the whole length, the app redoes the transcription on
the processor, tells you once, and from then on keeps that model on the processor in this
browser (the `cpuTiers` list in the saved speech settings). A model that answers with no
words at all is reported as a failure rather than stored as an empty transcript.

Recognition runs on your computer with OpenAI's Whisper through transformers.js. The
library is loaded from a CDN and the model is downloaded from Hugging Face the first time
you use a tier (then cached by the browser), so that first use needs an internet connection.
Your audio is never uploaded. Sanskrit and chanted or sung material are recognised only
approximately; treat the words as a guide and rely on the acoustic comparison for the verdict.

### Quiz
A memory test drawn from your library.

1. **Folders to draw from** – tick one or more folders to narrow the list of slokas; with
   none ticked, the whole library is listed, grouped by folder. **How many** – one sloka, or
   several with a maximum (10 by default; at least 2).
2. **Choose the slokas** – tick them in the list. With "One sloka" you pick exactly one; with
   "Several" you pick at least two and at most the maximum, and the remaining boxes lock once
   the maximum is reached (untick one to swap, or raise the maximum). "Pick at random" fills
   the choice for you, spreading the picks across the ticked folders, and you can still adjust
   it. "Start quiz…" becomes available as soon as the rule is met.
3. **Start quiz…** – give it a friendly name; the date and time are appended so every quiz is
   unique (for example "CH-12 · 2026-09-23 14:05"). The quiz is saved at once.
4. You land in Self Evaluation in *quiz mode*: the picked names are listed, the slokas
   themselves stay hidden (it is from memory), "play the sloka while I record" is off, and
   you recite everything in one recording, in any order. Then the reports open exactly as in
   Self Evaluation, with the quiz score card on top.

**The score** is a percentage of correctness: the share of the picked slokas that are
correct. Each sloka is scored in five categories: **content** (the acoustic comparison's
content score, with skipped material counting against it), **pronunciation** (the share of
the sloka's words that speech recognition heard in your recording), **timing**, **pitch** and
**dynamics**; a sloka that was not found in your recording scores 0 everywhere. A sloka is
*correct* when every chosen category is within the quiz tolerance (fixed: content 10 %,
pronunciation 10 %, others 60 %). The chosen categories are **content and pronunciation** by
default; click the chips on the card to require timing, pitch or dynamics too (or drop one).
The choice is saved with the quiz and applies to every attempt, past and future, because every
category is measured and stored whatever you choose. The card shows each category's share
within tolerance, a per-sloka table with ✓ / ✗ marks, and the average scores. Pronunciation
needs the speech model; if it cannot run, that category is left out of the verdict and the
card says so.

**Attempts and trends.** Every attempt is saved automatically (per-category averages and the
per-sloka detail). "Record again" is a new attempt of the same quiz. The **Saved quizzes**
list shows each quiz's latest score, number of attempts and best score; **Retake** opens the
same picked slokas again, **Details** shows the picks and a trend chart: a thick line for the share of slokas
within tolerance in the chosen categories, and a thin line per category with its average
score, plus a table of all attempts; and
**Delete** removes the quiz with its attempts. The same trend is shown on the score card after
each attempt.

Quiz files live in `quizzes/<id>.json` and are plain JSON, so they can be backed up or read
elsewhere. A sloka deleted after a quiz was made is shown struck through and left out of
that quiz's averages.

### Library
Play, rename, move, delete, or jump straight into evaluating yourself against a sloka. The WAV files live in
`library/` and its subfolders with a small `index.json`; feel free to copy or back them up.

**Folders.** Slokas are grouped by folder, and "Move…" puts one into another folder (or a
new one); "New folder" makes an empty one. Folders are ordinary subfolders of `library/`, up to
three levels deep, and `library/backup` is reserved. Every sloka belongs to a folder: nothing
can be saved or moved to the top level of the library, and a WAV dropped at the top level with
Explorer is ignored (the server log says so) until it is put in a folder. Otherwise you can
make folders and move files with Explorer: when the library is listed, SlokAbhyasa reconciles
`index.json` with the disk, so a moved WAV keeps its entry (its sidecar files travel by name),
a WAV dropped into a folder gets an entry (its id and name are read from the file name when it
has the usual `<name>-<id>.wav` form), and an entry whose WAV is gone is removed.

"Trim silence in all slokas" applies the same start/end trimming to everything already in
the library (for recordings made before trimming existed, or imported files). The untouched
original of each changed file is kept in `library/backup/`. The same job can be run without
the browser:

```
node tools/trim-library.mjs            # trim in place
node tools/trim-library.mjs --dry-run  # only report what would change
```

## How the comparison works

Both recordings are resampled to 16 kHz and described every 20 ms by loudness, an activity
flag, pitch (YIN with an octave-error-resistant tracker), and 12 mel-frequency cepstral
coefficients that capture the sound of the syllable being sung. The two sequences are then
aligned with dynamic time warping (banded, with penalised open ends so extra sound at the start
or a missing ending is reported rather than distorting the alignment).

Along the aligned path SlokAbhyasa looks for:

| Type | What it means |
| --- | --- |
| Pitch | Sustained sharp or flat stretches after smoothing away vibrato and note attacks. |
| Timing | Rushed or dragged spans between onsets, pauses that the sloka does not have. |
| Content | Places where the sound itself does not match the sloka (wrong syllable, note or vowel). |
| Missing / extra | Sloka material with no counterpart, or sound you added. |
| Dynamics | Notably louder or softer stretches (hidden by default; choose Dynamics above the list). |

Before aligning, two more things happen when needed. If the two recordings judge "silence"
very differently (a quiet room against a noisy one, more than 6 dB apart relative to their
peaks), both are re-measured with the stricter threshold so pauses are not reported as extra
sound. If one recording is more than 1.5 times longer than the other, the shorter one is first
located inside the longer one (a coarse subsequence alignment on 100 ms blocks) and only that
window is compared. The same search run against the longer recording played backwards gives a
reference cost for "same voice, no shared content"; the ratio of the two costs (about 0.5 for the
same verse, about 1 for a different one) is what flags a sloka as not matching.

Limits: pitch tracking is monophonic (one voice or instrument at a time), and "content" means
acoustic similarity, not words. A very different microphone or room lowers content precision;
SlokAbhyasa tells you when that seems to be the case.

Scoring: each aspect's score is the share of the sloka that was *not* flagged for that
aspect (pitch uses the mean in-tune credit instead). The overall score is a weighted blend of
the three (content 45 %, timing 35 %, pitch 20 %; see `MODES` in `js/dsp/compare.js`).

## Tests

```
npm test
```

Runs the DSP suite on synthetic signals (tones, chant-like syllables, transpositions, inserted
pauses, dropped notes, a verse hidden inside a longer recording), the transcript diff, the quiz
scoring and picking, and the library helpers, with Node's built-in test runner.

## Layout

```
serve.js               local server: static files + /api/baselines, /api/folders, /api/quizzes
index.html, css/       the single-page UI
js/app.js              controller for the views (Teach shares the Self Evaluation screen)
js/player.js           HTMLAudioElement wrapper (speed, pitch preservation, range playback)
js/recorder.js         microphone capture through an AudioWorklet
js/analysis-worker.js  runs the DSP off the main thread
js/stt.js, js/stt-worker.js   speech to text (Whisper via transformers.js, in a worker)
js/textdiff.js         word tokenisation and diff for transcripts
js/quizscore.js        quiz scoring and random picking (pure, Node-testable)
js/libutil.js          folder-name cleaning, sloka file names, WAV header reading (shared with the server)
js/dsp/                features, alignment, locating a part inside a longer recording, deviations,
                       scoring, silence trimming (pure, Node-testable)
js/visualizer.js       waveforms and the comparison chart
datadir.js             where the data folder is (local.json / SLOKABHYASA_DATA, else the project folder)
tools/trim-library.mjs command-line trimming of every WAV in the library
test/                  synthetic signal generators and the DSP tests

Not in the repository (.gitignore), beside the code or wherever local.json points:
library/               your slokas, in folders if you like: <name>.wav, <name>.txt (transcript),
                       <name>.transcript.json (timings), <name>.features.json (analysis cache), index.json;
                       library/backup holds pre-trim originals
quizzes/               one JSON file per quiz: picked slokas, chosen categories, every attempt's scores
local.json             { "data": "..." } when the two folders above live somewhere else
```
