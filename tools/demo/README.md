# Demo video

Makes the narrated demo (`SlokAbhyasa-demo.mp4` + `.srt`) by driving the real app in
headless Chrome: a fake microphone fed from library recordings makes the recitations
reproducible, the screen is captured through the DevTools screencast with an animated cursor
and captions, and ffmpeg mixes the narration and the chants onto the edited timeline (the
waits for transcription are cut out).

Needs: Node 18+, ffmpeg and ffprobe on the PATH, Google Chrome, Python with `edge-tts`
(`pip install edge-tts`; the narration voice is Microsoft's online neural voice), and a
library containing CH12-01 … CH12-05 and CH18-66 (the narrative is written around them;
`script.mjs` holds the words). The server must be running.

```
node tools/demo/prep-audio.mjs          # takes and slowed playback, from the library
node tools/demo/tts.mjs                 # narration clips → tools/demo/narration
node tools/demo/record.mjs prewarm      # Best-model transcripts for the slokas shown
node tools/demo/record.mjs 1            # library, learn, teach, self evaluation
set QUIZ_TAKE=quiz-take-single.wav
set QUIZ_TAKE_SECONDS=16.4
node tools/demo/record.mjs 2            # quiz and outro
node tools/demo/assemble.mjs <out.mp4>  # encode
```

Each recording session takes about as long as its part of the video plus the transcription
waits. Session 1 saves a sloka named "CH18-66 demo" and session 2 a quiz named
"Chapter 12 · sloka 3 · …": delete both afterwards (Library › Delete, and the quiz list).
`CHROME` and `APP` can be set in the environment when they differ from the defaults in
`record.mjs`. Frames and timelines land in `tools/demo/out/` (ignored by git, like the
generated audio and narration).
