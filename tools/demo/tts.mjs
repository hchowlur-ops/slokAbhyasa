// Generates one narration clip per beat with edge-tts and records their durations.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BEATS, VOICE } from './script.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'narration');
fs.mkdirSync(out, { recursive: true });
const durations = {};
for (const [id, b] of Object.entries(BEATS)) {
  const file = path.join(out, `${id}.mp3`);
  if (!fs.existsSync(file)) {
    execFileSync('python', ['-m', 'edge_tts', '--voice', VOICE, '--rate=-4%', '--text', b.say, '--write-media', file], { stdio: 'inherit' });
  }
  const d = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
  durations[id] = d;
  console.log(`${id.padEnd(16)} ${d.toFixed(1)} s`);
}
fs.writeFileSync(path.join(out, 'durations.json'), JSON.stringify(durations, null, 2));
console.log(`total narration: ${Object.values(durations).reduce((a, b) => a + b, 0).toFixed(0)} s`);
