# SlokAbhyasa

A local web app for learning and memorising audio by ear: chants, verses, songs, phrases.
Play a recording at any speed, let SlokAbhyasa *learn* a sloka, then *evaluate yourself* against it
and see exactly where your attempt deviates, with the sloka and your own recording one click away.

SlokAbhyasa calls every recording it has learnt a *sloka* (a verse); the word is used for any short
piece, chanted, sung or spoken.

Everything runs on your machine. Slokas are ordinary WAV files in folders under `library/`
(one folder per chapter, say); quizzes are JSON files in `quizzes/`.

## Demo

A five-minute narrated tour, recorded with a learner's library of Bhagavad Gita chapter 12:
learning a sloka from a file, Teach mode with a deliberately flawed recitation and its report,
Self Evaluation against several slokas at once, and a quiz.

[![Watch the demo: Teach mode report with a skipped phrase flagged](docs/demo/poster.jpg)](docs/demo/SlokAbhyasa-demo.mp4)

[`docs/demo/SlokAbhyasa-demo.mp4`](docs/demo/SlokAbhyasa-demo.mp4) (18 MB, 1440×900, with
[subtitles](docs/demo/SlokAbhyasa-demo.srt)). `tools/demo/` regenerates it from a library.

## Run it

```
node serve.js
```

Then open <http://127.0.0.1:8787> in Chrome, Edge, Firefox or Safari. No install step;
Node 18 or newer is the only requirement. (`npm start` does the same thing.)

### A package for people who will not install anything

```
node tools/package.mjs
```

builds `dist/SlokAbhyasa-<version>-windows.zip` (about 33 MB): the app, a portable Node.js
runtime downloaded from nodejs.org (same version as the one running the script, cached in
`dist/cache`), a `Start SlokAbhyasa.cmd` launcher and a plain-language `README.txt`. Whoever
receives it unzips the folder and double-clicks the launcher: a console window stays open
while the app runs, the browser opens on the app, and recordings go to their Documents
folder (`Documents\SlokAbhyasa`, found through the registry so OneDrive-redirected Documents
work too). Starting it twice just re-opens the running app (`serve.js --open`). The first use
of speech-to-text still needs the internet, for the model download. Publish the zip as an
asset of a GitHub release; the repository itself stays code-only. On a Mac or Linux
machine, install Node.js and run `node serve.js --open` from the `app` folder of the same
zip.

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

Each sloka is a WAV with sidecar files of the same name beside it: `<name>.json` holds its
**details** (who recorded it, how it is judged, its text, what was measured in the voice, how
it was captured, a hash of the audio), `<name>.features.json` the cached analysis and
`<name>.transcript.json` / `<name>.txt` the transcript. The details file is the source of
truth and travels with the WAV when you move or copy it with Explorer; the WAV itself also
carries a Broadcast Wave `bext` chunk with the name, style and date, so a file that gets
separated from its sidecar still says what it is. The names of people are kept out of the
library altogether, in `profiles.json` at the data root: a sloka refers to a person by id and
stores only their voice type and age group.

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

**Details of a sloka.** Under the name and folder, three optional fields are saved with the
sloka and used when it is evaluated against:

* **Recorded by** – the person whose voice this is, from the People list (see "Who's
  reciting" under Self Evaluation; "Someone new…" opens it). The evaluation uses their voice
  type and age group to decide how far apart the two voices can be, so a mispronunciation is
  never explained away as a voice difference.
* **How it is judged** – the style of the material: a sloka or stotra *recited* (pitch is a
  matter of style, shown but not scored), Vedic with svaras (pitch counts as a melody), a
  stotra or bhajan *sung*, a poem, prose, a song, Indian classical. A tradition or school
  (Śṛṅgeri, Kāñcī…) can be noted beside it.
* **Text** – the words as they should be recited, one pāda or line per row. SlokAbhyasa
  derives the script, the number of akṣaras and the pādas (on `।` and `॥`), measures the pace
  of the recording in akṣaras per second, and uses the text as the reference for the
  pronunciation score instead of the recording's own transcript, which may itself have errors.

The last person and style used are remembered. Slokas saved before these fields existed get a
details file on the next start, with nothing guessed: open **Details** in the Library to fill
them in; until a style is chosen such a sloka is judged as before (chanting, with pitch).

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
reported as a note but not penalised) and judge the speed of recitation (off by default).

**Speed is not judged unless you ask.** Recite at any pace, steady or not: a sloka taken
slowly throughout, or with its first line hurried and its last line drawn out, loses nothing.
Pauses, skipped and added material still count, since those are not a matter of pace. Tick
"Judge the speed of recitation" and rushed or dragged stretches (against your own overall
tempo) count in the timing score, and the overall tempo is penalised too. The choice applies
to quizzes as well.

**A different voice is allowed for.** A child reciting after an adult, or a woman after a
man, sings higher and, more to the point, with every vowel's resonances higher: the same
syllable has a different sound. Before anything is compared, the recording is read at the
"voice warp" that fits the sloka best, so the syllables line up and only real differences
are reported; the report then says, for instance, "Your voice is lighter in character than
the sloka's (25%); the comparison allowed for that." The key difference is ignored on top of
that, and an octave slip of the pitch tracker (common with high or very deep voices) is not
taken for a wrong note. Quizzes use the same comparison, so this applies to them too. The
tests pair a man's, a generic adult's, a woman's and a child's voice in every combination of
sloka voice and learner voice: each scores as the same voice would, and a wrong syllable is
found in every pairing. One honest limit: a high voice has its harmonics far apart, which
blurs its vowels, so when the voices are far apart a very slight slip can hide in the voice
difference; the report says so when that is the case.

**Who's reciting.** The sidebar has a "Who's reciting" choice and a **People…** button. Add
the people who use this installation with a voice type (child; woman or girl; man or boy
with a changed voice; prefer not to say) and an age group (under 8, 8–11, 12–15, 16–17,
18–39, 40–59, 60 and over; prefer not to say). Nothing else is stored, and no birth dates.
The chosen person is the learner: Self Evaluation, Teach and quizzes judge with the
allowances their voice calls for, following the research summarised in
`reports/Voice characteristics by age and gender.md`:

| Learner | Pitch counts as off beyond | Pace band (when speed is judged) | Pronunciation tolerance |
| --- | --- | --- | --- |
| Adult (or no one chosen) | 0.5 semitone | 0.75–1.33× | 10 % |
| Under 8 | 1 semitone | 0.67–1.5× | 30 % |
| 8 to 11 | ¾ semitone | 0.67–1.5× | 20 % |
| 12 to 15 | 0.6 semitone | 0.75–1.33× | 15 % |
| 60 and over | 0.5 semitone | 0.67–1.33× | 10 % |

A sustained pitch difference has to last a quarter of a second to be reported (an older
voice's tremor averages out at that scale), the content detector's floor is raised for young
children, whose articulation is still maturing, and the voice-warp search is confined to the
range the pairing of learner and recorder can need (narrow for two adults of the same voice
type, wide when a child is involved). The report lists the allowances it used. For 12 to 15
year olds the note reminds you that a voice changes fast at that age: re-record your own
baselines every few months. When the sloka's style says it is *recited*, the pitch tile shows
the figure "for interest, not judged" and the overall score is content 60 %, timing 40 %.

**Tolerance.** How much variation is acceptable in each category, as a percentage: a category
is within tolerance when its score is at least 100 minus the tolerance. The defaults are
content 10 %, pronunciation 10 % (wider for a child learner, see the table above: speech
recognition is 2–5 times less accurate on children's voices), and 60 % for timing, pitch and
dynamics. Change them in the "Tolerance" row under the recording options (Self Evaluation and
Teach share the setting, which is remembered); "Defaults" puts them back. Verdicts on screen
follow a change at once. In the list of reports each row says "Within tolerance" or which
categories are outside it. A quiz always judges on the default tolerances for the chosen
learner, its fields are locked, and every attempt records the tolerance and learner it was
judged with, so changing the learner later never rewrites old scores.

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

**How your words are judged.** The pronunciation score is the share of the sloka's text that
was heard in your attempt. The two texts are compared sound by sound rather than word by
word: each word is turned into a plain-Latin phonetic key (Devanagari, Kannada and the other
Indic scripts transliterated, diacritics dropped), the two streams are aligned character by
character with the spaces left out, and a word counts as heard when at least half of its
sound is there. That makes the score blind to the things the recogniser does differently
from one run to the next: spelling (निर्देश्यम or निर्देश्यम्), where it breaks words, and even
the script it chooses (Whisper writes Sanskrit now in Devanagari, now in IAST). A take
longer than 30 s is transcribed stretch by stretch, each stretch being where a sloka was
found in it: Whisper loses its way in a long chant, but transcribes a single sloka's worth
well.

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

Under each sloka's name a row of tags sums up its details file: who recorded it, how it is
judged (or "style not set · judged as chant" for a sloka from before details existed), the
number of akṣaras of its text and the median pitch of the voice. **Details** opens the same
fields as in Learn (recorded by, how it is judged, tradition, text), editable, with what was
measured underneath: the voice's median pitch and range, the pace in akṣaras per second, the
recording's peak, noise floor and signal-to-noise ratio, the microphone and whether the
browser processed the sound, how much silence was trimmed, and the first characters of the
audio hash. A sloka that was saved without these measurements gets them the first time it is
loaded for an evaluation.

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
coefficients that capture the sound of the syllable being sung. The coefficients are taken
from a spectral envelope rather than the raw spectrum: the harmonics (peaks within 10 dB of
the running maximum over ±250 Hz) are joined by straight lines in the log domain and lightly
smoothed, and each frame's mel bands are clamped to 40 dB below its loudest, so the harmonics
of a high voice, which are far apart, give the same vowel shape as those of a low one, and
bands holding only room noise look alike in both recordings. The two sequences are then
aligned with dynamic time warping (banded, with penalised open ends so extra sound at the
start or a missing ending is reported rather than distorting the alignment).

A take is also analysed at eleven vocal-tract-length warps (its spectrum read at 0.67× to
1.5× the frequency). The warp whose spectral frames lie closest to the sloka's wins, judged by
nearest-neighbour distance over a sample of frames of each, which needs no alignment and so
works before the search below; the unwarped reading keeps its place unless another is clearly
better (4 %), so a same-voice take is never warped on a whim. When the learner and the
recorder of the sloka are known, the search is confined to the warps their pairing can need
(0.86–1.16× for two adults of the same voice type, 0.8–1.25× across types, the full range
when a child is involved), so a wrong vowel cannot be absorbed by an implausible warp. This
is what lets a child be judged against an adult's recording on the words, not the voice.

The key difference between the two voices is found on pitch differences folded into one
octave (the most common pitch class, then the octave most of the frames sit in), and when the
key is ignored every remaining difference is compared within the octave, so a learner who
sings in another register is not told every note is wrong.

Along the aligned path SlokAbhyasa looks for:

| Type | What it means |
| --- | --- |
| Pitch | Sustained sharp or flat stretches after smoothing away vibrato and note attacks. |
| Timing | Pauses that the sloka does not have; rushed or dragged spans between onsets when speed is judged. |
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
the three: content 45 %, timing 35 %, pitch 20 % for chanting (the default, and for Vedic
material), content 60 %, timing 40 % for recited text, where pitch is shown for interest only
(see `MODES` in `js/dsp/compare.js`; the sloka's "How it is judged" picks the mode). The
thresholds behind "pitch", "timing" and "content" are scaled by the preset for the learner
(`presetsFor` in `js/meta.js`): adults keep the calibrated defaults, children get the wider
bands listed under "Who's reciting".

## Tests

```
npm test
```

Runs the DSP suite on synthetic signals (tones, chant-like syllables, transpositions, inserted
pauses, dropped notes, a verse hidden inside a longer recording, a child's allowances against
an adult's), the transcript diff, the quiz scoring and picking, the metadata (presets, text
derivation, voice measurements, sidecars, bext chunks, profiles) and the library helpers, with
Node's built-in test runner.

## Layout

```
serve.js               local server: static files + /api/baselines, /api/folders, /api/quizzes, /api/profiles
meta-store.js          server side of the details: sidecar files, audio hash, bext chunk, profiles.json
index.html, css/       the single-page UI
js/app.js              controller for the views (Teach shares the Self Evaluation screen)
js/meta.js             vocabularies, evaluation presets by learner, text derivation, voice measurements
                       (pure, shared by browser and server)
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
reports/               the research the presets and the details file follow

Not in the repository (.gitignore), beside the code or wherever local.json points:
library/               your slokas, in folders if you like: <name>.wav, <name>.json (details),
                       <name>.txt (transcript), <name>.transcript.json (timings),
                       <name>.features.json (analysis cache), index.json; library/backup holds pre-trim originals
profiles.json          the people (names, voice type, age group) — never inside library/
quizzes/               one JSON file per quiz: picked slokas, chosen categories, every attempt's scores
local.json             { "data": "..." } when the two folders above live somewhere else
```
