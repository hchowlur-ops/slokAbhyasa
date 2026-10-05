// Builds the sound the demo needs from the library, into tools/demo/audio:
//   attempt-03.wav         an imperfect recitation of CH12-03 (first line rushed, 1.1 s skipped)
//   quiz-take-single.wav   CH12-03 as recorded, for the quiz
//   ch12-01-x075.wav, ch12-03-x050.wav   what the viewer hears when the app plays slowly
//   Gita 18-66 (teacher).wav             the pre-trim original of CH18-66, imported in Learn
// Each take ends in 4 s of silence: Chrome's fake microphone loops its file, and the loop
// must land in silence rather than back at the sloka's start.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDataDir } from '../../datadir.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(resolveDataDir(path.resolve(here, '..', '..')), 'library');
const AUDIO = path.join(here, 'audio');
fs.mkdirSync(AUDIO, { recursive: true });
const index = JSON.parse(fs.readFileSync(path.join(LIB, 'index.json'), 'utf8'));
const wav = (name) => { const r = index.find((x) => x.name.toLowerCase() === name.toLowerCase()); if (!r) throw new Error(`no sloka named ${name}`); return path.join(LIB, ...r.file.split('/')); };
const ff = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const out = (f) => path.join(AUDIO, f);

const c1 = wav('CH12-01');
const c3 = wav('CH12-03');
ff('-i', c3, '-filter_complex', '[0:a]atrim=0:5.7,asetpts=PTS-STARTPTS,atempo=1.12[a];[0:a]atrim=5.7:6.6,asetpts=PTS-STARTPTS[b];[0:a]atrim=7.7,asetpts=PTS-STARTPTS,apad=pad_dur=4[c];[a][b][c]concat=n=3:v=0:a=1[out]', '-map', '[out]', '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', out('attempt-03.wav'));
ff('-i', c3, '-af', 'apad=pad_dur=4', '-c:a', 'pcm_s16le', out('quiz-take-single.wav'));
ff('-i', c1, '-af', 'atempo=0.75', out('ch12-01-x075.wav'));
ff('-i', c3, '-af', 'atempo=0.5', out('ch12-03-x050.wav'));
fs.copyFileSync(c1, out('Gita 12-01.wav'));
const backup = fs.readdirSync(path.join(LIB, 'backup')).find((f) => /^ch18-66-/i.test(f));
fs.copyFileSync(backup ? path.join(LIB, 'backup', backup) : wav('CH18-66'), out('Gita 18-66 (teacher).wav'));
console.log(`audio ready in ${AUDIO}`);
