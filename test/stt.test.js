import { test } from 'node:test';
import assert from 'node:assert/strict';

// The speech worker is replaced by a stand-in that records what it is sent and answers
// only when the test says so.
class FakeWorker {
  constructor() { this.sent = []; this.terminated = false; this.onmessage = null; this.onerror = null; FakeWorker.all.push(this); }
  postMessage(m) { this.sent.push(m); }
  terminate() { this.terminated = true; }
  reply(data) { this.onmessage({ data }); }
  get transcribes() { return this.sent.filter((m) => m.type === 'transcribe'); }
}
FakeWorker.all = [];
globalThis.Worker = FakeWorker;

const { Transcriber, isStopped } = await import('../js/stt.js');
const { looksDegenerate } = await import('../js/stt-worker.js');

const samples = () => new Float32Array(1600);
const settle = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const latest = () => FakeWorker.all[FakeWorker.all.length - 1];
// A rejection that is already handled, so the test can inspect it later.
const outcome = (p) => p.then((v) => ({ value: v }), (e) => ({ error: e }));

test('jobs reach the worker one at a time, in order', async () => {
  const stt = new Transcriber();
  const a = stt.transcribe({ samples: samples(), sampleRate: 16000, language: 'sanskrit', tier: 'fast' });
  const b = stt.transcribe({ samples: samples(), sampleRate: 16000, language: 'sanskrit', tier: 'fast' });
  const w = latest();
  assert.equal(w.transcribes.length, 1, 'the second job waits');
  w.reply({ type: 'result', id: w.transcribes[0].id, result: { text: 'one' } });
  assert.equal((await a).text, 'one');
  assert.equal(w.transcribes.length, 2, 'the second job is sent once the first is done');
  w.reply({ type: 'result', id: w.transcribes[1].id, result: { text: 'two' } });
  assert.equal((await b).text, 'two');
  assert.equal(w.terminated, false);
});

test('a queued job that is stopped never reaches the worker', async () => {
  const stt = new Transcriber();
  const ctrl = new AbortController();
  const a = stt.transcribe({ samples: samples(), sampleRate: 16000, language: 'sanskrit', tier: 'fast' });
  const b = outcome(stt.transcribe({ samples: samples(), sampleRate: 16000, language: 'sanskrit', tier: 'fast', signal: ctrl.signal }));
  const c = stt.transcribe({ samples: samples(), sampleRate: 16000, language: 'sanskrit', tier: 'fast' });
  const w = latest();
  ctrl.abort();
  assert.ok(isStopped((await b).error));
  w.reply({ type: 'result', id: w.transcribes[0].id, result: { text: 'a' } });
  await a;
  assert.equal(w.transcribes.length, 2);
  w.reply({ type: 'result', id: w.transcribes[1].id, result: { text: 'c' } });
  assert.equal((await c).text, 'c');
  assert.equal(w.sent.filter((m) => m.type === 'stop').length, 0);
});

test('stopping the running job frees the caller at once and asks the worker to stop', async () => {
  const stt = new Transcriber();
  const ctrl = new AbortController();
  const progress = [];
  const a = outcome(stt.transcribe({ samples: samples(), sampleRate: 16000, language: 'sanskrit', tier: 'fast', signal: ctrl.signal, onProgress: (p) => progress.push(p.stage) }));
  const b = stt.transcribe({ samples: samples(), sampleRate: 16000, language: 'sanskrit', tier: 'fast' });
  const w = latest();
  const id = w.transcribes[0].id;
  w.reply({ type: 'progress', id, stage: 'load' });
  ctrl.abort();
  assert.ok(isStopped((await a).error));
  assert.deepEqual(w.sent.filter((m) => m.type === 'stop').map((m) => m.id), [id]);
  w.reply({ type: 'progress', id, stage: 'transcribe' });
  assert.deepEqual(progress, ['load'], 'no progress after the stop');
  assert.equal(w.transcribes.length, 1, 'the next job waits for the worker to answer');
  w.reply({ type: 'stopped', id });
  assert.equal(w.transcribes.length, 2, 'the next job follows the acknowledgement');
  assert.equal(w.terminated, false, 'a worker that answers is kept');
  w.reply({ type: 'result', id: w.transcribes[1].id, result: { text: 'b' } });
  assert.equal((await b).text, 'b');
});

test('a worker too busy to answer a stop is replaced', async () => {
  const stt = new Transcriber({ stopGraceMs: 20 });
  const ctrl = new AbortController();
  const a = outcome(stt.transcribe({ samples: samples(), sampleRate: 16000, language: 'sanskrit', tier: 'fast', signal: ctrl.signal }));
  const b = stt.transcribe({ samples: samples(), sampleRate: 16000, language: 'sanskrit', tier: 'fast' });
  const w1 = latest();
  ctrl.abort();
  assert.ok(isStopped((await a).error));
  await sleep(60);
  assert.equal(w1.terminated, true);
  const w2 = latest();
  assert.notEqual(w2, w1, 'a new worker took over');
  assert.equal(w2.transcribes.length, 1, 'the waiting job went to the new worker');
  w2.reply({ type: 'result', id: w2.transcribes[0].id, result: { text: 'b' } });
  assert.equal((await b).text, 'b');
});

test('a stopped job that finishes anyway is dropped without disturbing the queue', async () => {
  const stt = new Transcriber({ stopGraceMs: 1000 });
  const ctrl = new AbortController();
  const a = outcome(stt.transcribe({ samples: samples(), sampleRate: 16000, language: 'sanskrit', tier: 'fast', signal: ctrl.signal }));
  const b = stt.transcribe({ samples: samples(), sampleRate: 16000, language: 'sanskrit', tier: 'fast' });
  const w = latest();
  ctrl.abort();
  assert.ok(isStopped((await a).error));
  w.reply({ type: 'result', id: w.transcribes[0].id, result: { text: 'late' } });
  await settle();
  assert.equal(w.transcribes.length, 2);
  assert.equal(w.terminated, false, 'the answer cancelled the replacement');
  w.reply({ type: 'result', id: w.transcribes[1].id, result: { text: 'b' } });
  assert.equal((await b).text, 'b');
});

test('an already aborted signal rejects before anything is sent', async () => {
  const stt = new Transcriber();
  const ctrl = new AbortController();
  ctrl.abort();
  const before = FakeWorker.all.length;
  const r = await outcome(stt.transcribe({ samples: samples(), sampleRate: 16000, language: 'sanskrit', tier: 'fast', signal: ctrl.signal }));
  assert.ok(isStopped(r.error));
  assert.equal(FakeWorker.all.length, before, 'no worker was started');
});

test('a worker failure fails every job and the next job gets a fresh worker', async () => {
  const stt = new Transcriber();
  const a = outcome(stt.transcribe({ samples: samples(), sampleRate: 16000, language: 'sanskrit', tier: 'fast' }));
  const b = outcome(stt.transcribe({ samples: samples(), sampleRate: 16000, language: 'sanskrit', tier: 'fast' }));
  const w1 = latest();
  w1.onerror({ message: 'boom' });
  assert.equal((await a).error.message, 'boom');
  assert.equal((await b).error.message, 'boom');
  assert.equal(w1.terminated, true);
  const c = stt.transcribe({ samples: samples(), sampleRate: 16000, language: 'sanskrit', tier: 'fast' });
  const w2 = latest();
  assert.notEqual(w2, w1);
  w2.reply({ type: 'result', id: w2.transcribes[0].id, result: { text: 'c' } });
  assert.equal((await c).text, 'c');
});

test('degenerate output: nothing, or a word or two repeated to the token limit', () => {
  assert.equal(looksDegenerate(''), true);
  assert.equal(looksDegenerate('   '), true);
  // what a miscomputing GPU produced for a 16 s sloka
  assert.equal(looksDegenerate(' Ṣākāṁ'.repeat(55)), true);
  assert.equal(looksDegenerate(' Ṣākṣāraṁ nirādhāsāṁ'.repeat(20)), true);
  assert.equal(looksDegenerate(' "D"'.repeat(140)), true);
  // real answers, from the CPU
  assert.equal(looksDegenerate('Ṣākṣāraṁ ānir desh yam avyaktam parjupāsate sarvatra gama chintyam ca kūtasthamacalam truvam'), false);
  assert.equal(looksDegenerate('येत्वक्षरम निर्देश्यम अव्यक्तं पर्युपासते सर्वत्रगम चिंत्यम्चा गूटस्थम चलं थुवं।'), false);
  // short answers are never judged, a chant that repeats a line is fine
  assert.equal(looksDegenerate('om om om'), false);
  assert.equal(looksDegenerate('om namah shivaya '.repeat(3) + 'om shanti shanti shanti'), false);
});

test('probe answers come back by id, independent of transcriptions', async () => {
  const stt = new Transcriber();
  const p = stt.probe();
  const w = latest();
  const m = w.sent.find((x) => x.type === 'probe');
  w.reply({ type: 'probe', id: m.id, device: 'webgpu' });
  assert.equal(await p, 'webgpu');
});
