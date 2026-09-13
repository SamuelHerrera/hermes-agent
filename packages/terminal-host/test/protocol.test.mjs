import test from 'node:test';
import assert from 'node:assert/strict';
test('registry admission bounds active PTYs and idempotency tombstones', async () => {
  const { admitCreate, LIMITS } = await import('../src/protocol.mjs');
  assert.equal(typeof admitCreate, 'function');
  assert.throws(() => admitCreate(LIMITS.sessions, 0), /SESSION_LIMIT/);
  assert.throws(() => admitCreate(0, LIMITS.creates), /CREATE_LIMIT/);
  assert.doesNotThrow(() => admitCreate(LIMITS.sessions - 1, LIMITS.creates - 1));
});
