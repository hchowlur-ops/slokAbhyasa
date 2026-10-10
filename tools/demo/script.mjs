// The narration, one entry per beat. `say` is read by the voice (spelling tuned for the
// speech engine); `caption` is what the viewer reads (defaults to `say`).
export const VOICE = 'en-IN-NeerjaNeural';

export const BEATS = {
  intro: {
    say: 'Sloka Abhyasa is a small app for learning slokas by ear. You record a verse, or load one from a file. The app listens, remembers it, and later tells you how closely your own recitation matches: the words, the vowel lengths, every syllable, and the manner. Everything runs on your computer. Nothing is uploaded.',
    caption: 'SlokAbhyasa is a small app for learning slokas by ear. You record a verse, or load one from a file. The app listens, remembers it, and later tells you how closely your own recitation matches: the words, the vowel lengths, every syllable, and the manner. Everything runs on your computer; nothing is uploaded.',
  },
  home: {
    say: 'It opens with an invocation and the closing sloka of the Gita. The pages are on the left.',
  },
  library: {
    say: 'The Library holds the learner\'s own recordings, a folder per chapter: the twenty slokas of chapter twelve of the Bhagavad Gita, Bhakti Yoga, with its opening and closing lines, and one sloka from chapter eighteen. They are ordinary WAV files, kept on this computer.',
  },
  metadata: {
    say: 'A right-click lists everything saved about a sloka: who recorded it, how it is judged, the voice and the recording as measured, and the chandas, the metre found in its text.',
  },
  transcript: {
    say: 'Each recording keeps its words beside it. They are written on this computer by the Whisper speech model, and you can correct them by hand.',
  },
  learn: {
    say: 'To teach the app a new sloka, record it, or pick a file. Here is a recording of chapter eighteen, sloka sixty six, the famous closing sloka. The app trims the silence and writes down the words it hears.',
  },
  learnSave: {
    say: 'Give it a name, choose a folder, and save. The recording, its words and its details are stored together.',
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
  evaluating: {
    say: 'The moment you stop, the app listens back, compares the two, and transcribes your words. It says Evaluating until the report is ready.',
  },
  results: {
    say: 'The report opens with one overall score and a grade: a weighted mean of seven categories. Phonemes, vowel length, syllables, emphasis, pitch contour, phrasing and timing, each judged against a tolerance you can set yourself.',
    caption: 'The report opens with one overall score and a grade: a weighted mean of seven categories — phonemes, vowel length, syllables, emphasis, pitch contour, phrasing and timing — each judged against a tolerance you can set yourself.',
  },
  duet: {
    say: 'Play both together plays the sloka in the left ear and your recitation in the right, so the difference is heard rather than read.',
  },
  analysis: {
    say: 'Under Analysis, your words stand against the sloka\'s text, laid out in its metre. Sloka words that were not heard are highlighted, and so are extra or different words in your attempt. Click any phrase to hear it.',
  },
  analysisMore: {
    say: 'Below come the seven category tiles, a chart with the two pitch contours on one timeline, and the list of deviations, each with a button that plays just that moment.',
  },
  evaluate: {
    say: 'In Self Evaluation you can tick several slokas. The panel shows one at a time, with its text and its metre; Previous and Next page through them. Recite any one from memory, and let the app work out which one you sang.',
  },
  evaluateRecord: {
    say: 'Here the learner recites one of the five.',
  },
  reports: {
    say: 'It found sloka three, opened its report, and marked the other four as not matching this recording. Previous and Next step through the reports, and All the reports lists them. The other slokas\' words are transcribed in the background meanwhile.',
  },
  quiz: {
    say: 'Quizzes test your memory. Open a folder, pick one sloka or several, and name the quiz.',
  },
  quizMode: {
    say: 'The recording stays hidden. The text is shown by default, and a setting hides it, to recite from memory in one take.',
  },
  quizRecord: {
    say: 'When you stop, the app compares the take with the original, just as in Self Evaluation, and scores the quiz.',
  },
  quizScore: {
    say: 'Each sloka is judged within fixed tolerances; the chips choose which categories count. Here, phonemes, vowel length and syllables. The quiz score is the share of slokas within tolerance; the overall is their weighted mean, with a grade.',
    caption: 'Each sloka is judged within fixed tolerances; the chips choose which categories count — here phonemes, vowel length and syllables. The quiz score is the share of slokas within tolerance; the overall is their weighted mean, with a grade.',
  },
  quizTrend: {
    say: 'Every attempt is saved with the quiz, so the trend shows your progress over the weeks. Retake it any time.',
  },
  reportsPage: {
    say: 'Reports gathers every evaluation and every quiz attempt, by date or by folder.',
  },
  settings: {
    say: 'Settings holds the weights and the tolerances, the speech model and its language, how the text is shown, and a short guide to Whisper.',
  },
  outro: {
    say: 'Your recordings stay on your computer as plain WAV files, easy to copy and back up. Sloka Abhyasa is free and open source. Find it on GitHub, at hchowlur hyphen ops, slash, slok abhyasa.',
    caption: 'Your recordings stay on your computer as plain WAV files, easy to copy and back up. SlokAbhyasa is free and open source: github.com/hchowlur-ops/slokAbhyasa',
  },
};
