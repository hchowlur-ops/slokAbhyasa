// Small pure helpers shared by the server and the tests: folder names inside the
// library, ids embedded in sloka file names, and reading a WAV header.

export const RESERVED_FOLDERS = new Set(['backup']);

// A folder path relative to the library root, cleaned: forward slashes, no empty, dot or
// hidden segments, no reserved names, no characters Windows refuses. '' is the top level.
// Returns null when the input cannot be made into a usable folder path.
export function cleanFolder(input) {
  const raw = String(input == null ? '' : input).replace(/\\/g, '/').trim();
  if (!raw || raw === '/' || raw === '.') return '';
  const segs = [];
  for (const part of raw.split('/')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed === '.' || trimmed === '..' || trimmed.startsWith('.')) return null;
    const seg = trimmed.replace(/[<>:"|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().replace(/\.+$/, '').slice(0, 60);
    if (!seg) return null;
    segs.push(seg);
  }
  if (segs.length > 3) return null;
  if (segs.length && RESERVED_FOLDERS.has(segs[0].toLowerCase())) return null;
  return segs.join('/');
}

// File names are "<slug>-<id>.wav" with id = YYYYMMDD-HHMMSS-xxxx. Returns { id, slug } or null.
export function parseBaselineFilename(basename) {
  const m = /^(.*?)-?(\d{8}-\d{6}-[a-z0-9]{4})\.wav$/i.exec(basename);
  if (!m) return null;
  return { id: m[2], slug: m[1] };
}

// A readable name from a file name's slug part: "ch12-01" → "ch12-01", "gayatri-verse-1" → "gayatri verse 1".
export function nameFromSlug(slug, fallback = 'Untitled') {
  const s = String(slug || '').replace(/[-_]+/g, ' ').trim();
  return s || fallback;
}

// Reads the format and length of a RIFF/WAVE file from its first bytes.
// `bytes` should hold at least the header chunks (a few KB is plenty); `fileSize` lets the
// duration be estimated when the data chunk starts beyond the bytes given.
export function parseWavHeader(bytes, fileSize = bytes.length) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  if (u8.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let pos = 12;
  let fmt = null;
  let dataBytes = null;
  while (pos + 8 <= u8.length) {
    const id = tag(pos);
    const size = dv.getUint32(pos + 4, true);
    if (id === 'fmt ' && pos + 24 <= u8.length) {
      fmt = { channels: dv.getUint16(pos + 10, true), sampleRate: dv.getUint32(pos + 12, true), bits: dv.getUint16(pos + 22, true) };
    } else if (id === 'data') {
      dataBytes = size || Math.max(0, fileSize - pos - 8);
      break;
    }
    pos += 8 + size + (size & 1);
  }
  if (!fmt || !fmt.sampleRate || !fmt.channels || !fmt.bits) return null;
  if (dataBytes === null) dataBytes = Math.max(0, fileSize - 44);
  const bytesPerSec = fmt.sampleRate * fmt.channels * (fmt.bits / 8);
  return { ...fmt, duration: bytesPerSec ? dataBytes / bytesPerSec : 0 };
}
