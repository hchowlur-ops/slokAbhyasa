// Module worker: runs feature extraction and comparison off the main thread.

import { resample } from './dsp/resample.js';
import { extractFeatures, SR } from './dsp/features.js';
import { compareAuto } from './dsp/compare.js';
import { locate } from './dsp/locate.js';

self.onmessage = (e) => {
  const msg = e.data;
  const reply = (obj) => self.postMessage({ id: msg.id, ...obj });
  try {
    if (msg.type === 'features') {
      const x = resample(msg.samples, msg.sampleRate, SR);
      const features = extractFeatures(x, { onProgress: (p) => reply({ type: 'progress', value: p }) });
      reply({ type: 'features', features });
    } else if (msg.type === 'compare') {
      const result = compareAuto(msg.base, msg.heard, msg.options || {});
      reply({ type: 'result', result });
    } else if (msg.type === 'contrast') {
      // how alike two recordings are: about 0.5 for the same material, close to 1 for different material
      const [S, L] = msg.a.n <= msg.b.n ? [msg.a, msg.b] : [msg.b, msg.a];
      const loc = locate(S, L);
      reply({ type: 'result', result: loc ? loc.contrast : null });
    } else {
      reply({ type: 'error', message: `Unknown request ${msg.type}` });
    }
  } catch (err) {
    reply({ type: 'error', message: (err && err.message) || String(err) });
  }
};
