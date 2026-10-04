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

export async function getTranscript(id) {
  const res = await fetch(`/api/baselines/${encodeURIComponent(id)}/transcript`);
  if (res.status === 404) return null;
  await check(res);
  return res.json();
}

export async function putTranscript(id, transcript) {
  await check(await fetch(`/api/baselines/${encodeURIComponent(id)}/transcript`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(transcript),
  }));
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
