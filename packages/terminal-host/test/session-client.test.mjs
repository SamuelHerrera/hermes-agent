import test from 'node:test';
import assert from 'node:assert/strict';
import { openSession } from '../src/session-client.mjs';
import { validate } from '../src/protocol.mjs';

test('per-session environment rejects non-string values and NUL entries', () => {
  const base = { scope: 'local/default', requestId: 'tab', file: '/bin/sh' };
  assert.throws(() => validate('create', { ...base, env: { BAD: 1 } }), /INVALID_PARAMS/);
  assert.throws(() => validate('create', { ...base, env: { BAD: 'a\0b' } }), /INVALID_PARAMS/);
  assert.doesNotThrow(() => validate('create', { ...base, env: { GOOD: 'owner' } }));
});

test('restoration attaches the persisted identity and never creates on missing host session', async () => {
  const calls = [];
  const client = { epoch: 'host', request: async (method, params) => {
    calls.push([method, params]); throw Error('NOT_FOUND');
  } };
  await assert.rejects(openSession(client, { scope: 'local/default', reference: { epoch: 'host', terminalId: 'saved', scope: 'local/default' } }), /NOT_FOUND/);
  assert.deepEqual(calls.map(([name]) => name), ['attach']);
});

test('owner mismatch fails before any request', async () => {
  const client = { epoch: 'host', request: async () => assert.fail('wrong owner must not be contacted') };
  await assert.rejects(openSession(client, { scope: 'local/other', reference: { epoch: 'host', terminalId: 'saved', scope: 'local/default' } }), /OWNER_MISMATCH/);
});

test('new session uses idempotent tab request and exposes detach separately from terminate', async () => {
  const calls = [];
  const identity = { epoch: 'host', terminalId: 'saved', scope: 'local/default', generation: 1 };
  const client = { epoch: 'host', request: async (method, params) => {
    calls.push([method, params]);
    if (method === 'create') return { epoch: 'host', terminalId: 'saved', pid: 42 };
    if (method === 'attach') return { identity, snapshot: { seq: 5 }, pid: 42 };
    return {};
  } };
  const session = await openSession(client, { scope: identity.scope, requestId: 'tab', spawn: { file: '/bin/sh', env: { EXAMPLE: 'owner' } } });
  assert.equal(session.reference.terminalId, 'saved');
  assert.equal(calls[0][1].requestId, 'tab');
  assert.deepEqual(calls[0][1].env, { EXAMPLE: 'owner' });
  await session.detach();
  assert.equal(calls.at(-1)[0], 'detach');
  await session.terminate();
  assert.equal(calls.at(-1)[0], 'terminate');
});
