// Builds a ready-to-use Windows package for people who will never see a terminal: the app,
// a portable Node.js runtime, a double-click launcher and a plain-language README, zipped.
//
//   node tools/package.mjs            → dist/SlokAbhyasa-<version>-windows.zip
//
// Runs on Windows (it uses PowerShell to unzip and zip). The Node runtime is downloaded
// from nodejs.org once (same version as the Node running this script) and cached in
// dist/cache. Nothing from the library, the tests or the tools goes in.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const NAME = `SlokAbhyasa-${pkg.version}-windows`;
const DIST = path.join(ROOT, 'dist');
const CACHE = path.join(DIST, 'cache');
const STAGE = path.join(DIST, NAME);
const NODE_VERSION = process.versions.node;
const NODE_ZIP = `node-v${NODE_VERSION}-win-x64`;
const APP_FILES = ['index.html', 'serve.js', 'datadir.js', 'meta-store.js', 'package.json', 'README.md', 'css', 'js', 'assets'];

const ps = (command) => execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: 'inherit' });

async function download(url, file) {
  if (fs.existsSync(file)) return;
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await pipeline(res.body, fs.createWriteStream(file + '.part'));
  fs.renameSync(file + '.part', file);
}

// ---------- stage ----------
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(path.join(STAGE, 'app'), { recursive: true });
for (const f of APP_FILES) fs.cpSync(path.join(ROOT, f), path.join(STAGE, 'app', f), { recursive: true });

// the runtime: node.exe and its licence from the official zip
const zip = path.join(CACHE, `${NODE_ZIP}.zip`);
await download(`https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}.zip`, zip);
const unpacked = path.join(CACHE, NODE_ZIP);
if (!fs.existsSync(path.join(unpacked, 'node.exe'))) {
  ps(`Expand-Archive -LiteralPath '${zip}' -DestinationPath '${CACHE}' -Force`);
}
fs.mkdirSync(path.join(STAGE, 'node'));
fs.copyFileSync(path.join(unpacked, 'node.exe'), path.join(STAGE, 'node', 'node.exe'));
fs.copyFileSync(path.join(unpacked, 'LICENSE'), path.join(STAGE, 'node', 'LICENSE'));

// the launcher: recordings go to the user's Documents folder (wherever Windows keeps it,
// OneDrive included), unless SLOKABHYASA_DATA is already set
fs.writeFileSync(path.join(STAGE, 'Start SlokAbhyasa.cmd'), [
  '@echo off',
  'setlocal',
  'title SlokAbhyasa',
  'set "HERE=%~dp0"',
  'if defined SLOKABHYASA_DATA goto :run',
  'for /f "tokens=2,*" %%A in (\'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders" /v Personal 2^>nul\') do set "DOCS=%%B"',
  'call set "DOCS=%DOCS%"',
  'if not defined DOCS set "DOCS=%USERPROFILE%\\Documents"',
  'set "SLOKABHYASA_DATA=%DOCS%\\SlokAbhyasa"',
  ':run',
  'echo.',
  'echo   SlokAbhyasa - learn slokas by ear',
  'echo   Your recordings are kept in: %SLOKABHYASA_DATA%',
  'echo   Keep this window open while you use the app. Close it to stop.',
  'echo.',
  '"%HERE%node\\node.exe" "%HERE%app\\serve.js" --open',
  'if errorlevel 1 (',
  '  echo.',
  '  echo   SlokAbhyasa could not start. Please read README.txt.',
  '  pause',
  ')',
  '',
].join('\r\n'));

fs.writeFileSync(path.join(STAGE, 'README.txt'), `SlokAbhyasa - learn slokas by ear
=================================

Record a sloka (or load a recording of your teacher), listen to it at any speed,
recite it back, and see exactly where you drifted. Quiz yourself from memory.
Everything happens on this computer; nothing is uploaded.

WHAT YOU NEED
- Windows 10 or 11 and a web browser. Edge is already on Windows; Chrome works
  well too.
- A microphone. The one built into a laptop is fine.
- Internet the first time you use the words feature: the app downloads the
  speech model once (about 75 MB for the Fast model; the Better and Best models
  are bigger) and keeps it.

HOW TO START
1. Unzip this folder anywhere you like, for example on the Desktop.
2. Double-click "Start SlokAbhyasa". A black window appears, and your browser
   opens the app. (If Windows says "Windows protected your PC", click
   "More info" and then "Run anyway". Windows says this about any program
   that does not come from the Store.)
3. When the browser asks, allow the microphone.

Keep the black window open while you use the app. Close it when you are done.
If you close the browser by mistake, double-click "Start SlokAbhyasa" again.

YOUR RECORDINGS
Everything you record is saved in your Documents folder, in
Documents\\SlokAbhyasa (the folders "library" and "quizzes"). They are ordinary
sound files. Copy that folder to keep a backup, or to take your slokas to
another computer.

IF SOMETHING GOES WRONG
- The browser says it cannot connect: wait a few seconds and reload the page
  (F5), or double-click "Start SlokAbhyasa" again.
- "Microphone permission was denied": click the lock or camera icon at the left
  of the browser's address bar, allow the microphone, and reload the page.
- The words it writes are wrong: chanting is hard for speech recognition. Try
  the "Best" model (the Model choice in any transcript panel), or correct the
  text with "Edit"; corrected text is what your recitations are judged against.
- Nothing happens when you double-click: right-click "Start SlokAbhyasa" and
  choose "Run as administrator" once, or unzip the folder again somewhere
  outside OneDrive.

UPDATING
Unzip the new version and start it the same way. Your recordings stay in
Documents\\SlokAbhyasa and are picked up as they are.

ABOUT
SlokAbhyasa version ${pkg.version}. Runs on Node.js (see node\\LICENSE).
Project page: https://github.com/hchowlur-ops/slokAbhyasa
`);

// ---------- zip ----------
const out = path.join(DIST, `${NAME}.zip`);
fs.rmSync(out, { force: true });
ps(`Compress-Archive -LiteralPath '${STAGE}' -DestinationPath '${out}' -CompressionLevel Optimal`);
const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(1);
console.log(`\n${out}  (${mb(out)} MB; node.exe ${mb(path.join(STAGE, 'node', 'node.exe'))} MB unpacked)`);
console.log(`unpacked copy: ${STAGE}`);
