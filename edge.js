// Which requests the server answers (Node side, imported by serve.js): the rules applied
// before any route is looked at, as plain functions over header strings. Nothing here reads
// a file or opens a socket, so every rule has a test in test/edge.test.js.
//
// The server listens on 127.0.0.1 only, but any page the browser has open can send it
// requests (the structural audit of 2 November 2026): a page from elsewhere that asks for the
// learner's recordings, or a Host header the parser choked on. So: the request target is read
// against a fixed base, never the Host header; the Host must name this server; an Origin, when
// sent, must be this server's; a cross-site fetch is refused, though a plain link to the app
// (a navigation) is not; a JSON or WAV body must say what it is; and the static handler maps
// only the app's own files and each dataset's licence files.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status; // 400, 403, 413 or 415: the answer the dispatcher gives
  }
}

export const DEFAULT_PORT = 8787; // the port the app has always used; PORT in the environment overrides it

// The port from the environment: unset or empty → the default; a whole number up to 65535
// is used as given (0 asks the system for a free one, which a test needs); anything else is
// the default with a warning to print.
export function parsePort(value) {
  const s = value === undefined || value === null ? '' : String(value).trim();
  if (s === '') return { port: DEFAULT_PORT, warning: null };
  if (/^\d{1,5}$/.test(s) && Number(s) <= 65535) return { port: Number(s), warning: null };
  return { port: DEFAULT_PORT, warning: `PORT=${s} is not a port number: using ${DEFAULT_PORT}` };
}

const unreadable = () => new HttpError(400, 'That request cannot be read');

// The request's path and query, read against the fixed base http://127.0.0.1:<port>. The
// target must start with one slash: `//evil.example/x` or `/\evil.example/x` would be read as
// another host by the URL parser, and an absolute target (`http://…`) is not a path here.
export function parseRequestUrl(rawUrl, port) {
  const raw = typeof rawUrl === 'string' ? rawUrl : '';
  if (!/^\/(?![/\\])/.test(raw)) throw unreadable();
  try { return new URL(raw, `http://127.0.0.1:${port}`); } catch { throw unreadable(); }
}

const OWN_NAMES = ['127.0.0.1', 'localhost', '[::1]'];

// The Host header must be this server: one of its three names with its port (the bare name
// only on port 80). Missing → not allowed.
export function hostAllowed(host, port) {
  if (typeof host !== 'string' || !host.trim()) return false;
  const h = host.trim().toLowerCase();
  return OWN_NAMES.some((n) => h === `${n}:${port}` || (port === 80 && h === n));
}

// An Origin header, when sent, must be this server's over plain http. The literal `null`
// (a page opened from disk) and any other site are refused; no header means a direct request
// (the address bar, a tool), which is allowed.
export function originAllowed(origin, port) {
  if (origin === undefined || origin === null) return true;
  const o = String(origin).trim().toLowerCase();
  return OWN_NAMES.some((n) => o === `http://${n}:${port}` || (port === 80 && o === `http://${n}`));
}

const OWN_SITES = new Set(['none', 'same-origin']); // not same-site: a page on any other local port is same-site by the browser's rule and is not this app (review of 4 November 2026, finding 10)

// Sec-Fetch-Site, which the browser sets and a page cannot forge: absent (an older browser,
// a tool), none (the address bar) or same-origin is allowed; same-site and cross-site are not.
export function siteAllowed(secFetchSite) {
  if (secFetchSite === undefined || secFetchSite === null) return true;
  return OWN_SITES.has(String(secFetchSite).trim().toLowerCase());
}

// Headers on every answer: no page of any other site may put the app in a frame, where a
// click lined up over Trim or Delete would do the deed (review of 4 November 2026, finding 8).
export const NO_FRAME_HEADERS = Object.freeze({ 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" });

// A percent-encoded part of a path (a dataset id, a verse id): decoded, or a 400 when the
// encoding is bad, never a 500.
export function decodePathPart(s) {
  try { return decodeURIComponent(String(s)); } catch { throw new HttpError(400, 'That path cannot be read'); }
}

// The first refusal for a request, or null. A GET navigation (a link to the app from any
// other page, a bookmark page on disk) is cross-site by the browser's rule and must open the
// app, so the site check skips it: a navigation cannot read the answer, and a form posted
// across sites carries an Origin in every browser since 2019, which the origin check refuses.
export function refusal(headers, port, method = 'GET') {
  const h = headers || {};
  if (!hostAllowed(h.host, port)) return new HttpError(403, 'This server answers only its own address');
  const navigation = (method === 'GET' || method === 'HEAD') && String(h['sec-fetch-mode'] || '').toLowerCase() === 'navigate';
  if (!originAllowed(h.origin, port) || (!navigation && !siteAllowed(h['sec-fetch-site']))) return new HttpError(403, 'Requests from other pages are not accepted');
  return null;
}

const WAV_TYPES = new Set(['audio/wav', 'audio/x-wav', 'audio/wave', 'application/octet-stream']); // what browsers and tools label a WAV upload

// Whether a body's Content-Type is right for what the route expects: `json` wants
// application/json (its parameters ignored), `wav` one of the WAV labels.
export function bodyTypeAllowed(contentType, kind) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (kind === 'json') return type === 'application/json';
  if (kind === 'wav') return WAV_TYPES.has(type);
  return false;
}

const APP_ROOTS = new Set(['css', 'js', 'assets']); // the app's own folders; index.html at the root is the fourth place
const DATASET_ID = /^[a-z0-9][a-z0-9-]{0,39}$/; // a dataset's folder name, as the reference manifests name them
const LICENCE_FILES = new Set(['LICENSE', 'ATTRIBUTION.txt']); // the two files of a dataset the app shows a person

// What a static path maps to: { kind: 'app', rel } for the app's own files, { kind:
// 'licence', dataset, file } for a dataset's licence files, null for everything else (a 404).
// Any `.` or `..` or empty segment, any backslash and any dot-prefixed name are refused before
// the mapping; a bad percent-encoding is a 400.
export function staticTarget(pathname) {
  let p;
  try { p = decodeURIComponent(String(pathname || '')); } catch { throw new HttpError(400, 'That path cannot be read'); }
  if (p === '' || p === '/') return { kind: 'app', rel: 'index.html' };
  if (!p.startsWith('/') || p.includes('\\') || p.includes('\0')) return null;
  const parts = p.slice(1).split('/');
  if (parts.some((s) => s === '' || s.startsWith('.'))) return null;
  if (parts.length === 1) return parts[0] === 'index.html' ? { kind: 'app', rel: 'index.html' } : null;
  if (APP_ROOTS.has(parts[0])) return { kind: 'app', rel: parts.join('/') };
  if (parts.length === 3 && parts[0] === 'reference' && DATASET_ID.test(parts[1]) && LICENCE_FILES.has(parts[2])) return { kind: 'licence', dataset: parts[1], file: parts[2] };
  return null;
}
