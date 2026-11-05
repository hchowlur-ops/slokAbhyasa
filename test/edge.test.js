import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, parsePort, parseRequestUrl, hostAllowed, originAllowed, siteAllowed, refusal, bodyTypeAllowed, staticTarget, decodePathPart, NO_FRAME_HEADERS, DEFAULT_PORT } from '../edge.js';

const P = 8787;
const refused = (fn, status) => assert.throws(fn, (err) => err instanceof HttpError && err.status === status);

test('the port: unset or empty is the default, a whole number is used as given (0 asks for a free one), junk is the default with a warning', () => {
  assert.deepEqual(parsePort(undefined), { port: DEFAULT_PORT, warning: null });
  assert.deepEqual(parsePort(''), { port: DEFAULT_PORT, warning: null });
  assert.deepEqual(parsePort(' 9000 '), { port: 9000, warning: null });
  assert.deepEqual(parsePort('0'), { port: 0, warning: null });
  assert.equal(parsePort('abc').port, DEFAULT_PORT);
  assert.ok(parsePort('abc').warning.includes('abc'));
  assert.equal(parsePort('-1').port, DEFAULT_PORT);
  assert.equal(parsePort('70000').port, DEFAULT_PORT);
  assert.equal(parsePort('80.5').port, DEFAULT_PORT);
});

test('parseRequestUrl: a path reads against the fixed base; two slashes, a backslash, an absolute target and an empty one are refused', () => {
  const u = parseRequestUrl('/api/baselines?name=CH12-03', P);
  assert.equal(u.pathname, '/api/baselines');
  assert.equal(u.searchParams.get('name'), 'CH12-03');
  assert.equal(u.host, `127.0.0.1:${P}`, 'the base is fixed, whatever the Host header said');
  refused(() => parseRequestUrl('//evil.example/x', P), 400);
  refused(() => parseRequestUrl('/\\evil.example/x', P), 400);
  refused(() => parseRequestUrl('http://127.0.0.1:8787/x', P), 400);
  refused(() => parseRequestUrl('', P), 400);
  refused(() => parseRequestUrl(undefined, P), 400);
  refused(() => parseRequestUrl('*', P), 400);
});

test('hostAllowed: the three own names with the port, case-insensitive; a wrong port, a foreign name or no header is not this server', () => {
  assert.equal(hostAllowed('127.0.0.1:8787', P), true);
  assert.equal(hostAllowed('localhost:8787', P), true);
  assert.equal(hostAllowed('[::1]:8787', P), true);
  assert.equal(hostAllowed('LOCALHOST:8787', P), true);
  assert.equal(hostAllowed('127.0.0.1:9000', P), false);
  assert.equal(hostAllowed('127.0.0.1', P), false, 'the bare name only on port 80');
  assert.equal(hostAllowed('localhost', 80), true);
  assert.equal(hostAllowed('evil.example:8787', P), false);
  assert.equal(hostAllowed('[', P), false);
  assert.equal(hostAllowed(undefined, P), false);
  assert.equal(hostAllowed('', P), false);
});

test('originAllowed: absent is a direct request; the own origins pass; null, a foreign site and the wrong scheme do not', () => {
  assert.equal(originAllowed(undefined, P), true);
  assert.equal(originAllowed('http://127.0.0.1:8787', P), true);
  assert.equal(originAllowed('http://localhost:8787', P), true);
  assert.equal(originAllowed('HTTP://LOCALHOST:8787', P), true);
  assert.equal(originAllowed('null', P), false, 'a page opened from disk');
  assert.equal(originAllowed('https://evil.example', P), false);
  assert.equal(originAllowed('https://127.0.0.1:8787', P), false, 'the wrong scheme');
  assert.equal(originAllowed('http://127.0.0.1:9000', P), false);
  assert.equal(originAllowed('', P), false);
});

test('siteAllowed: absent, none and same-origin pass; same-site (a page on another local port) and cross-site do not', () => {
  assert.equal(siteAllowed(undefined), true);
  assert.equal(siteAllowed('none'), true);
  assert.equal(siteAllowed('same-origin'), true);
  assert.equal(siteAllowed('same-site'), false, 'a dev server or a notebook on another port of localhost is not this app');
  assert.equal(siteAllowed('cross-site'), false);
  assert.equal(siteAllowed('anything-else'), false);
});

test('decodePathPart decodes a dataset or verse id and answers 400, not 500, on a bad encoding; the no-frame headers are the two the browsers honour', () => {
  assert.equal(decodePathPart('12.3'), '12.3');
  assert.equal(decodePathPart('g%C4%ABt%C4%81'), 'gītā');
  refused(() => decodePathPart('%E0'), 400);
  assert.deepEqual({ ...NO_FRAME_HEADERS }, { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" });
});

test('refusal: the first failing check, as a 403 with its sentence; a link to the app from another page still opens it', () => {
  assert.equal(refusal({ host: '127.0.0.1:8787' }, P), null);
  assert.equal(refusal({ host: 'localhost:8787', origin: 'http://localhost:8787', 'sec-fetch-site': 'same-origin' }, P, 'POST'), null);
  const host = refusal({ host: 'evil.example:8787', origin: 'http://127.0.0.1:8787' }, P);
  assert.equal(host.status, 403);
  assert.equal(host.message, 'This server answers only its own address');
  const origin = refusal({ host: '127.0.0.1:8787', origin: 'https://evil.example' }, P, 'POST');
  assert.equal(origin.status, 403);
  assert.equal(origin.message, 'Requests from other pages are not accepted');
  const site = refusal({ host: '127.0.0.1:8787', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' }, P, 'GET');
  assert.equal(site.status, 403, 'a cross-site image or script request');
  assert.equal(refusal({ host: '127.0.0.1:8787', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' }, P, 'GET'), null, 'a navigation cannot read the answer');
  assert.equal(refusal({ host: '127.0.0.1:8787', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', origin: 'https://evil.example' }, P, 'POST').status, 403, 'a form posted across sites carries its origin');
  assert.equal(refusal({ host: '127.0.0.1:8787', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' }, P, 'POST').status, 403, 'and the navigation rule covers GET only');
  assert.equal(refusal(undefined, P).status, 403, 'no headers at all');
});

test('bodyTypeAllowed: JSON wants application/json whatever its parameters; WAV takes the four labels; nothing else passes', () => {
  assert.equal(bodyTypeAllowed('application/json; charset=utf-8', 'json'), true);
  assert.equal(bodyTypeAllowed('Application/JSON', 'json'), true);
  assert.equal(bodyTypeAllowed('text/plain;charset=UTF-8', 'json'), false, 'what fetch sends for a bare string body');
  assert.equal(bodyTypeAllowed(undefined, 'json'), false);
  assert.equal(bodyTypeAllowed('application/x-www-form-urlencoded', 'json'), false, 'a form from another page');
  assert.equal(bodyTypeAllowed('audio/wav', 'wav'), true);
  assert.equal(bodyTypeAllowed('audio/x-wav', 'wav'), true);
  assert.equal(bodyTypeAllowed('audio/wave', 'wav'), true);
  assert.equal(bodyTypeAllowed('application/octet-stream', 'wav'), true);
  assert.equal(bodyTypeAllowed('application/json', 'wav'), false);
  assert.equal(bodyTypeAllowed('audio/wav', 'json'), false);
  assert.equal(bodyTypeAllowed('audio/wav', 'other'), false);
});

test('staticTarget: the app\'s four places and a dataset\'s two licence files, nothing else', () => {
  assert.deepEqual(staticTarget('/'), { kind: 'app', rel: 'index.html' });
  assert.deepEqual(staticTarget(''), { kind: 'app', rel: 'index.html' });
  assert.deepEqual(staticTarget('/index.html'), { kind: 'app', rel: 'index.html' });
  assert.deepEqual(staticTarget('/css/styles.css'), { kind: 'app', rel: 'css/styles.css' });
  assert.deepEqual(staticTarget('/js/dsp/locate.js'), { kind: 'app', rel: 'js/dsp/locate.js' });
  assert.deepEqual(staticTarget('/assets/logo.svg'), { kind: 'app', rel: 'assets/logo.svg' });
  assert.deepEqual(staticTarget('/js/app%2Ejs'), { kind: 'app', rel: 'js/app.js' }, 'decoded first');
  assert.deepEqual(staticTarget('/reference/gita/LICENSE'), { kind: 'licence', dataset: 'gita', file: 'LICENSE' });
  assert.deepEqual(staticTarget('/reference/gita/ATTRIBUTION.txt'), { kind: 'licence', dataset: 'gita', file: 'ATTRIBUTION.txt' });
  for (const p of [
    '/reference/gita/verses.json', '/reference/gita/manifest.json', '/reference/gita.custom.json', '/reference/gita', '/reference/Gita/LICENSE', '/reference/gita/license',
    '/reference/../serve.js/LICENSE', '/reference/a b/LICENSE', '/serve.js', '/local.json', '/package.json', '/.git/HEAD', '/js/../serve.js', '/css/..%2F..%2Fserve.js',
    '/css/%2e%2e/serve.js', '/js\\..\\serve.js', '/research_notes/', '/test/x', '/js/.hidden', '/js/', '/js', '/css', '/library/index.json', '/sessions/x.json',
    '/JS/app.js', 'js/app.js', '/js//app.js', '/js/./app.js', '/index.html/x', '/js/app.js%00',
  ]) assert.equal(staticTarget(p), null, p);
  refused(() => staticTarget('/js/%E0%A4'), 400);
  refused(() => staticTarget('/%'), 400);
});
