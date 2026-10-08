// Client for the local library API served by serve.js.

async function check(res) {
  if (res.ok) return res;
  let msg = `${res.status} ${res.statusText}`;
  try { const j = await res.json(); if (j && j.error) msg = j.error; } catch { /* ignore */ }
  throw new Error(msg);
}

export async function listBaselines() {
  const res = await check(await fetch('/api/baselines'));
  return res.json();
}

export async function createBaseline({ name, blob, duration, sampleRate, source, folder = '' }) {
  const q = new URLSearchParams({ name, duration: String(duration), sampleRate: String(sampleRate), source, folder });
  const res = await check(await fetch(`/api/baselines?${q}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: blob }));
  return res.json();
}

export const audioUrl = (id) => `/api/baselines/${encodeURIComponent(id)}/audio`;

export async function fetchAudioBlob(id) {
  const res = await check(await fetch(audioUrl(id)));
  return res.blob();
}

export async function renameBaseline(id, name) {
  const res = await check(await fetch(`/api/baselines/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }));
  return res.json();
}

export async function deleteBaseline(id) {
  await check(await fetch(`/api/baselines/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}

// Trims silence at both ends of the stored WAV. Returns { changed, removedStart, removedEnd, duration }.
export async function trimBaseline(id) {
  const res = await check(await fetch(`/api/baselines/${encodeURIComponent(id)}/trim`, { method: 'POST' }));
  return res.json();
}

// The sloka's transcripts, one per language: { current, available, languages: { code: transcript } }, or null.
export async function getTranscript(id) {
  const res = await fetch(`/api/baselines/${encodeURIComponent(id)}/transcript`);
  if (res.status === 404) return null;
  await check(res);
  return res.json();
}

// Stores one language's transcript (its `language` field says which). By default it becomes
// the current one, whose text the .txt file carries; `primary: false` leaves the current
// one alone and only fills a gap, never replacing a transcript that exists (background
// transcription of the other languages). Returns the store.
export async function putTranscript(id, transcript, { primary = true } = {}) {
  const res = await check(await fetch(`/api/baselines/${encodeURIComponent(id)}/transcript${primary ? '' : '?primary=0'}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(transcript),
  }));
  return res.json();
}

export async function deleteTranscript(id, language = null) {
  const q = language ? `?language=${encodeURIComponent(language)}` : '';
  const res = await check(await fetch(`/api/baselines/${encodeURIComponent(id)}/transcript${q}`, { method: 'DELETE' }));
  return res.json();
}

export async function getFeatures(id) {
  const res = await fetch(`/api/baselines/${encodeURIComponent(id)}/features`);
  if (res.status === 404) return null;
  await check(res);
  return res.json();
}

export async function putFeatures(id, serialized) {
  await check(await fetch(`/api/baselines/${encodeURIComponent(id)}/features`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(serialized),
  }));
}

// ---------- metadata sidecar ----------

export async function getMeta(id) {
  const res = await check(await fetch(`/api/baselines/${encodeURIComponent(id)}/meta`));
  return res.json();
}

// Replaces what the app may set in the sidecar (speaker, style, text, voice, measured,
// capture, consent, notes); the server keeps id, audio hash and software.
export async function putMeta(id, meta) {
  const res = await check(await fetch(`/api/baselines/${encodeURIComponent(id)}/meta`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(meta),
  }));
  return res.json();
}

// Changes only the keys given (e.g. { speaker }, { style }, { text: { body } }).
export async function patchMeta(id, patch) {
  const res = await check(await fetch(`/api/baselines/${encodeURIComponent(id)}/meta`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }));
  return res.json();
}

// ---------- people (speaker profiles) ----------

export async function listProfiles() {
  const res = await check(await fetch('/api/profiles'));
  return res.json();
}

export async function createProfile(profile) {
  const res = await check(await fetch('/api/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) }));
  return res.json();
}

export async function patchProfile(id, patch) {
  const res = await check(await fetch(`/api/profiles/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }));
  return res.json();
}

export async function deleteProfile(id) {
  await check(await fetch(`/api/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}

// ---------- folders ----------

export async function listFolders() {
  const res = await check(await fetch('/api/folders'));
  return res.json();
}

export async function createFolder(name) {
  const res = await check(await fetch('/api/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }));
  return res.json();
}

export async function moveBaseline(id, folder) {
  const res = await check(await fetch(`/api/baselines/${encodeURIComponent(id)}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder }),
  }));
  return res.json();
}

// ---------- quizzes ----------

const quizUrl = (id, sub = '') => `/api/quizzes/${encodeURIComponent(id)}${sub}`;
const jsonReq = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function listQuizzes() {
  const res = await check(await fetch('/api/quizzes'));
  return res.json();
}

export async function createQuiz(quiz) {
  const res = await check(await fetch('/api/quizzes', jsonReq('POST', quiz)));
  return res.json();
}

export async function getQuiz(id) {
  const res = await check(await fetch(quizUrl(id)));
  return res.json();
}

export async function addQuizAttempt(id, attempt) {
  const res = await check(await fetch(quizUrl(id, '/attempts'), jsonReq('POST', attempt)));
  return res.json();
}

export async function patchQuiz(id, patch) {
  const res = await check(await fetch(quizUrl(id), jsonReq('PATCH', patch)));
  return res.json();
}

export async function deleteQuiz(id) {
  await check(await fetch(quizUrl(id), { method: 'DELETE' }));
}
