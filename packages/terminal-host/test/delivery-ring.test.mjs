import test from 'node:test';
import assert from 'node:assert/strict';
import * as protocol from '../src/protocol.mjs';

test('delivery ring is byte bounded even when one decoded event exceeds its budget', () => {
  assert.equal(typeof protocol.DeliveryRing, 'function', 'delivery ring must enforce its byte budget');
  const ring = new protocol.DeliveryRing(100);
  ring.push({ seq: 1, type: 'data', data: 'small' });
  assert.equal(ring.read(0).length, 1);
  ring.push({ seq: 2, type: 'data', data: '\0'.repeat(100) });
  assert.ok(ring.bytes <= 100);
  assert.throws(() => ring.read(1), /GAP/);
  assert.deepEqual(ring.read(2), []);
  ring.push({ seq: 3, type: 'data', data: 'next' });
  assert.equal(ring.read(2)[0].data, 'next');
  assert.throws(() => ring.read(0), /GAP/);
});
