// A sloka's transcripts, one per language, kept together in <name>.transcript.json:
//   { version: 2, current: 'sanskrit', languages: { sanskrit: {...}, kannada: {...} } }
// `current` is the language whose text is also written to <name>.txt (hand-editable).
// Files from before (a single transcript at the top level) are read as one language.
// Pure helpers, shared by the server, the command-line tools and the tests.

export const STORE_VERSION = 2;

const isTranscript = (t) => !!t && typeof t === 'object' && (typeof t.text === 'string' || Array.isArray(t.chunks));

// Any stored shape → { version, current, languages }. null when there is nothing in it.
export function normalizeStore(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.languages && typeof raw.languages === 'object') {
    const languages = {};
    for (const [code, t] of Object.entries(raw.languages)) if (isTranscript(t)) languages[code] = { ...t, language: code };
    const codes = Object.keys(languages);
    if (!codes.length) return null;
    const current = codes.includes(raw.current) ? raw.current : codes[0];
    return { version: STORE_VERSION, current, languages };
  }
  if (isTranscript(raw)) {
    const code = typeof raw.language === 'string' && raw.language ? raw.language : 'unknown';
    return { version: STORE_VERSION, current: code, languages: { [code]: { ...raw, language: code } } };
  }
  return null;
}

// The transcript of one language, or of the current one.
export function pickTranscript(store, language = null) {
  if (!store) return null;
  return store.languages[language || store.current] || null;
}

export const availableLanguages = (store) => (store ? Object.keys(store.languages) : []);

// Adds or replaces one language's transcript. `primary` makes it the current one.
export function putInStore(store, transcript, { primary = true } = {}) {
  const code = typeof transcript.language === 'string' && transcript.language ? transcript.language : 'unknown';
  const base = store ? { ...store, languages: { ...store.languages } } : { version: STORE_VERSION, current: code, languages: {} };
  base.languages[code] = { ...transcript, language: code };
  if (primary || !base.languages[base.current]) base.current = code;
  base.version = STORE_VERSION;
  return base;
}

// Removes one language (or everything when none is given). null when nothing is left.
export function removeFromStore(store, language = null) {
  if (!store || !language) return null;
  const languages = { ...store.languages };
  delete languages[language];
  const codes = Object.keys(languages);
  if (!codes.length) return null;
  return { ...store, languages, current: codes.includes(store.current) ? store.current : codes[0] };
}

// Moves every language's timestamps back by `removedStart` seconds (audio trimmed at the start).
export function shiftStore(store, removedStart, duration) {
  if (!store) return null;
  const languages = {};
  for (const [code, t] of Object.entries(store.languages)) {
    languages[code] = Array.isArray(t.chunks)
      ? { ...t, chunks: t.chunks.map((c) => ({ ...c, start: Math.max(0, (c.start || 0) - removedStart), end: c.end == null ? null : Math.max(0, Math.min(duration, c.end - removedStart)) })) }
      : t;
  }
  return { ...store, languages };
}

// The plain-text twin of a transcript: one line per timed phrase (or the whole text).
export function transcriptToText(t) {
  const lines = Array.isArray(t.chunks) && t.chunks.length
    ? t.chunks.map((c) => String(c.text || '').trim()).filter(Boolean)
    : [String(t.text || '').trim()];
  return lines.join('\n') + '\n';
}

// A hand-edited .txt applied to a transcript: timings are kept when the line count still
// matches the phrases.
export function applyTextEdit(t, text, editedAt) {
  const lines = String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const base = t || { language: 'unknown', tier: null };
  const chunks = Array.isArray(base.chunks) && base.chunks.length === lines.length ? base.chunks.map((c, i) => ({ ...c, text: lines[i] })) : [];
  return { ...base, text: lines.join(' '), chunks, edited: true, editedIn: 'file', createdAt: editedAt };
}

// What the API hands out: the store with a summary of what is there.
export function publicStore(store) {
  if (!store) return null;
  return { version: STORE_VERSION, current: store.current, available: availableLanguages(store), languages: store.languages };
}
