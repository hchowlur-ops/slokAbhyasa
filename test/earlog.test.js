import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EarLog, rowsOf, ROW_FIELDS, EAR_LOG_VERSION } from '../js/earlog.js';

test('EarLog: rows carry the recording clock and the wall clock, the cap holds, finish keeps the header', () => {
  let clock = 1000;
  const log = new EarLog({ cap: 3, now: () => clock });
  log.head = { take: { items: ['A', 'B'] } };
  clock = 1010;
  log.push('tick', 0.0853, 3, 0, 80, 2.19, -42, -30);
  clock = 1500;
  log.push('close', 17.234, 'A', 'pause', 20.4, 32, 28, 1520, 14800, 0, 0, 1, 17.53, 0);
  log.push('turn', 17.234, 1, 'B');
  log.push('tick', 17.3, 29, 0, 15000, 0.1, -42, -31); // over the cap: dropped, counted
  const kept = log.finish({ removedStart: 0.4 });
  assert.equal(kept.version, EAR_LOG_VERSION);
  assert.deepEqual(kept.take, { items: ['A', 'B'] });
  assert.equal(kept.removedStart, 0.4);
  assert.equal(kept.dropped, 1);
  assert.equal(kept.rows.length, 3);
  assert.deepEqual(kept.rows[0].slice(0, 3), ['tick', 0.085, 10]);
  assert.deepEqual(kept.rows[1].slice(0, 3), ['close', 17.234, 500]);
  assert.equal(kept.fields, ROW_FIELDS);
  const rows = rowsOf(kept);
  assert.equal(rows[0].nuclei, 3);
  assert.equal(rows[0].levelDb, -30);
  assert.equal(rows[1].by, 'pause');
  assert.equal(rows[1].expected, 32);
  assert.equal(rows[2].name, 'B');
  // a kept log survives the round trip through JSON
  assert.equal(rowsOf(JSON.parse(JSON.stringify(kept)))[1].to, 17.53);
});
