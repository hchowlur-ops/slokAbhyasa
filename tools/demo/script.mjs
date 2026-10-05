// The narration, one entry per beat. `say` is read by the voice (spelling tuned for the
// speech engine); `caption` is what the viewer reads (defaults to `say`).
export const VOICE = 'en-IN-NeerjaNeural';

export const BEATS = {
  intro: {
    say: 'Sloka Abhyasa is a small app for learning slokas by ear. You record a verse, or load one from a file. The app listens, remembers it, and later tells you how closely your own recitation matches. Everything runs on your computer. Nothing is uploaded.',
    caption: 'SlokAbhyasa is a small app for learning slokas by ear. You record a verse, or load one from a file. The app listens, remembers it, and later tells you how closely your own recitation matches. Everything runs on your computer; nothing is uploaded.',
  },
  library: {
    say: 'This library holds the learner\'s own recordings: the twenty slokas of chapter twelve of the Bhagavad Gita, Bhakti Yoga, together with its opening and closing lines, and one sloka from chapter eighteen. They are ordinary WAV files, kept in one folder per chapter.',
  },
  transcript: {
    say: 'Each recording can keep its words beside it, as a text file. The text is written on this computer by the Whisper speech model, and you can correct it by hand.',
  },
  player: {
    say: 'The Player plays any recording at any speed, with the pitch preserved. Slow a sloka down to three quarters, or half, and catch every syllable.',
  },
  learn: {
    say: 'To teach the app a new sloka, record it, or pick a file. Here is a recording of chapter eighteen, sloka sixty six, the famous closing sloka. The app trims the silence and writes down the words it hears.',
  },
  learnSave: {
    say: 'Give it a name, choose a folder, and save. The recording, its words and its analysis are stored together.',
  },
  teach: {
    say: 'Teach mode works on one sloka at a time. Here is the third sloka of chapter twelve, with its text.',
  },
  teachPlay: {
    say: 'Press Play to hear it, at half speed if you like.',
  },
  teachListen: {
    say: 'Then press Listen, and recite it yourself. For this demonstration the recitation rushes the first line, and skips a few syllables later on.',
  },
  results: {
    say: 'The app lines your recitation up with the original and scores it: content, timing, pitch and dynamics. The chart shows the two side by side, and the list below names each deviation, judged against a tolerance you can set yourself.',
  },
  diff: {
    say: 'Your words are compared with the sloka\'s text too. Sloka words that were not heard are highlighted, and so are extra or different words in your attempt.',
  },
  evaluate: {
    say: 'In Self Evaluation you can tick several slokas, recite any one of them from memory, and let the app work out which one you sang.',
  },
  evaluateRecord: {
    say: 'Here the learner recites one of the five.',
  },
  reports: {
    say: 'It found sloka three, opened its report, and marked the other four as not matching this recording. Every report is one click away.',
  },
  quiz: {
    say: 'Quizzes test your memory. Choose a folder, pick one sloka or several, and name the quiz.',
  },
  quizMode: {
    say: 'The recording stays hidden; only the name is shown. You recite it from memory, in one take.',
  },
  quizRecord: {
    say: 'When you stop, the app compares the take with the original, just as in Self Evaluation.',
  },
  quizScore: {
    say: 'Each sloka is judged on content, pronunciation, timing, pitch and dynamics, within fixed tolerances. You choose which categories count; here, content alone. The quiz score is the share of slokas that passed.',
  },
  quizTrend: {
    say: 'Every attempt is saved with the quiz, so the trend shows your progress over the weeks.',
  },
  outro: {
    say: 'Your recordings stay on your computer as plain WAV files, easy to copy and back up. Sloka Abhyasa is free and open source. Find it on GitHub, at hchowlur hyphen ops, slash, slok abhyasa.',
    caption: 'Your recordings stay on your computer as plain WAV files, easy to copy and back up. SlokAbhyasa is free and open source: github.com/hchowlur-ops/slokAbhyasa',
  },
};
