// Turns the recorded sessions into one MP4 (video from the screencast frames, audio from the
// narration and the chants, both placed on the edited timeline) plus an SRT of the captions.
//   node assemble.mjs <output.mp4> [session ids...]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = process.argv[2] || path.join(here, 'SlokAbhyasa-demo.mp4');
const sessions = process.argv.slice(3).length ? process.argv.slice(3) : ['1', '2'];
const FPS = 30;
const GAP = 0.6; // breath between sessions

// edited time of a wall time, given the session's cuts (frames inside a cut are dropped)
function editor(cuts) {
  const sorted = [...cuts].sort((a, b) => a.from - b.from);
  return {
    inCut: (t) => sorted.some((c) => t >= c.from && t < c.to),
    map: (t) => { let d = 0; for (const c of sorted) { if (t >= c.to) d += c.to - c.from; else if (t > c.from) d += t - c.from; } return t - d; },
  };
}

const frames = []; // { file, start, end } in final time
const audio = []; // { src, at, gain, dur, fade }
const captions = []; // { text, start, end }
let offset = 0;
for (const s of sessions) {
  const dir = path.join(here, 'out', s);
  const tl = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8'));
  const ed = editor(tl.cuts);
  const kept = tl.frames.filter((f) => !ed.inCut(f.t)).map((f) => ({ file: path.join(dir, 'frames', f.file), t: offset + ed.map(f.t) }));
  if (!kept.length) continue;
  // the first frame shows from the session's start
  kept[0].t = offset;
  for (let i = 0; i < kept.length; i++) frames.push({ file: kept[i].file, start: kept[i].t, end: i + 1 < kept.length ? kept[i + 1].t : offset + ed.map(tl.end) });
  for (const a of tl.audio) audio.push({ ...a, at: offset + ed.map(a.at) });
  for (const c of tl.captions) captions.push({ text: c.text, start: offset + ed.map(c.start), end: offset + ed.map(c.end) });
  offset += ed.map(tl.end) + GAP;
  console.log(`session ${s}: ${kept.length} frames kept of ${tl.frames.length}, ${ed.map(tl.end).toFixed(1)} s`);
}
const total = frames[frames.length - 1].end;
console.log(`video: ${frames.length} frames, ${total.toFixed(1)} s, ${audio.length} audio events`);

// concat list for the video: one entry per output tick, naming the frame current at that
// instant. (Per-entry `duration` lines are not used: the screencast sends bursts of frames
// a few milliseconds apart whenever something moves, and ffmpeg's image reader does not
// honour holds that short, which let the picture drift behind the sound.)
const nTicks = Math.ceil(total * FPS);
const lines = [];
let fi = 0;
for (let k = 0; k < nTicks; k++) {
  const t = k / FPS;
  while (fi + 1 < frames.length && frames[fi + 1].start <= t) fi++;
  lines.push(`file '${frames[fi].file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
}
const listFile = path.join(here, 'out', 'frames.txt');
fs.writeFileSync(listFile, lines.join('\n') + '\n');

// audio graph: each clip trimmed/faded/attenuated/delayed, then mixed
const inputs = ['-f', 'concat', '-safe', '0', '-r', String(FPS), '-i', listFile];
const chains = [];
audio.forEach((a, i) => {
  inputs.push('-i', a.src);
  const f = [];
  if (a.dur) { f.push(`atrim=0:${a.dur.toFixed(3)}`); if (a.fade) f.push(`afade=t=out:st=${Math.max(0, a.dur - a.fade).toFixed(3)}:d=${a.fade}`); }
  f.push('aformat=sample_rates=48000:channel_layouts=stereo', `volume=${a.gain}`, `adelay=${Math.round(a.at * 1000)}:all=1`);
  chains.push(`[${i + 1}:a]${f.join(',')}[a${i}]`);
});
const mixed = `${audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audio.length}:normalize=0:dropout_transition=0,apad[mix]`;
const filter = [...chains, mixed].join(';');
const filterFile = path.join(here, 'out', 'filter.txt');
fs.writeFileSync(filterFile, filter);

const args = ['-y', '-hide_banner', '-loglevel', 'error', '-stats', ...inputs,
  '-filter_complex_script', filterFile,
  '-map', '0:v', '-map', '[mix]',
  '-vf', `scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-tune', 'stillimage',
  '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
  '-t', total.toFixed(3), '-movflags', '+faststart', outFile];
console.log('encoding…');
execFileSync('ffmpeg', args, { stdio: 'inherit' });

// subtitles
const ts = (t) => { const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const s = t % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0').replace('.', ',')}`; };
const srt = captions.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n');
fs.writeFileSync(outFile.replace(/\.mp4$/i, '.srt'), srt);
const size = fs.statSync(outFile).size;
console.log(`done: ${outFile} (${(size / 1048576).toFixed(1)} MB, ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, '0')})`);
