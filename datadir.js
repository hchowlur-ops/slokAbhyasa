// Where the slokas and quizzes live (Node side: serve.js and the tools).
//
// By default beside the code, in ./library and ./quizzes, which git ignores. To keep them
// somewhere else entirely (outside the repository, on another drive, in a synced folder),
// either set SLOKABHYASA_DATA, or write local.json next to serve.js:
//
//   { "data": "C:\\Users\\you\\SlokAbhyasa" }
//
// local.json is ignored by git too, so the choice stays on this machine. A relative path is
// taken from the project folder; a leading ~ means the home folder.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LOCAL_CONFIG = 'local.json';

function expand(root, p) {
  const s = String(p).trim();
  if (!s) return null;
  if (s === '~' || s.startsWith('~/') || s.startsWith('~\\')) return path.join(os.homedir(), s.slice(1));
  return path.resolve(root, s);
}

export function readLocalConfig(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, LOCAL_CONFIG), 'utf8')) || {}; } catch { return {}; }
}

// The data folder: library/ and quizzes/ are made inside it.
export function resolveDataDir(root) {
  const fromEnv = process.env.SLOKABHYASA_DATA && expand(root, process.env.SLOKABHYASA_DATA);
  if (fromEnv) return fromEnv;
  const cfg = readLocalConfig(root);
  const fromFile = typeof cfg.data === 'string' && expand(root, cfg.data);
  return fromFile || root;
}
