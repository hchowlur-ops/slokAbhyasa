// WAV encoding (16-bit PCM mono, real RIFF sizes) and decoding (PCM 8/16/24/32-bit
// and 32-bit float, any channel count, mixed down to mono). Works in the browser and in Node.

export function encodeWavBytes(samples, sampleRate) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++, o += 2) {
    const s = Math.round(samples[i] * 32768);
    v.setInt16(o, s < -32768 ? -32768 : s > 32767 ? 32767 : s, true);
  }
  return new Uint8Array(buf);
}

export function encodeWav(samples, sampleRate) {
  return new Blob([encodeWavBytes(samples, sampleRate)], { type: 'audio/wav' });
}

// bytes: Uint8Array, Buffer or ArrayBuffer. Returns { samples, sampleRate, channels, bitsPerSample }.
export function decodeWav(bytes) {
  const u8 = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  if (u8.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a RIFF/WAVE file');
  let fmt = null;
  let dataOff = -1;
  let dataLen = 0;
  let o = 12;
  while (o + 8 <= u8.byteLength) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      let format = v.getUint16(body, true);
      const channels = v.getUint16(body + 2, true);
      const sampleRate = v.getUint32(body + 4, true);
      const bits = v.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 26) format = v.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE
      fmt = { format, channels, sampleRate, bits };
    } else if (id === 'data') {
      dataOff = body;
      dataLen = Math.min(size, u8.byteLength - body);
      break;
    }
    o = body + size + (size & 1);
  }
  if (!fmt || dataOff < 0) throw new Error('WAV file is missing fmt or data chunk');
  const { format, channels, sampleRate, bits } = fmt;
  const bytesPer = bits / 8;
  const frames = Math.floor(dataLen / (bytesPer * channels));
  const samples = new Float32Array(frames);
  const g = 1 / channels;
  let p = dataOff;
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++, p += bytesPer) {
      let s;
      if (format === 3 && bits === 32) s = v.getFloat32(p, true);
      else if (bits === 8) s = (u8[p] - 128) / 128;
      else if (bits === 16) s = v.getInt16(p, true) / 32768;
      else if (bits === 24) s = ((u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16)) << 8 >> 8) / 8388608;
      else if (bits === 32) s = v.getInt32(p, true) / 2147483648;
      else throw new Error(`Unsupported WAV format (${bits}-bit, format ${format})`);
      acc += s;
    }
    samples[i] = acc * g;
  }
  return { samples, sampleRate, channels, bitsPerSample: bits };
}
