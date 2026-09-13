import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { connect } from '../src/client.mjs';
const wait = ms => new Promise(r => setTimeout(r, ms));
async function message(child, expected) {
  while ((await once(child, 'message'))[0] !== expected) {}
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'host-fault-'));
  const host = fork(new URL('./fault-host.mjs', import.meta.url), [dir], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = ''; host.stderr.on('data', data => { stderr += data; });
  const pids = [];
  t.after(async () => {
    if (host.exitCode === null) {
      try { await (await connect(dir)).request('stop', { force: true }); } catch {}
      host.kill('SIGKILL');
    }
    for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    await rm(dir, { force: true, recursive: true });
  });
  await message(host, 'ready');
  const client = await connect(dir);
  const create = async (cols = 80, code = 'process.stdin.resume()') => {
    const s = await client.request('create', { scope: 'fault', requestId: String(cols), cols, file: process.execPath, args: ['-e', code] });
    pids.push(s.pid); return { ...s, scope: 'fault' };
  };
  return { dir, client, host, create, stderr: () => stderr };
}
async function quick(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('RPC blocked by unrelated screen')), 750); })]); }
  finally { clearTimeout(timer); }
}
test('a failed force-stop keeps the host discoverable and allows cleanup retry', { skip: process.platform === 'win32' }, async t => {
  const { client, host, create } = await fixture(t);
  await create();
  let ack = message(host, 'kill-fail'); host.send('kill-fail'); await ack;
  await assert.rejects(client.request('stop', { force: true }), /TERMINATION_FAILED|PROCESS_QUERY_FAILED/);
  assert.equal((await client.request('status')).sessions, 1);
  ack = message(host, 'kill-restore'); host.send('kill-restore'); await ack;
  assert.equal((await client.request('stop', { force: true })).stopped, true);
});

test('force stop rejects pending barriers without waiting for screen progress', async t => {
  const { client, host, create } = await fixture(t);
  const bad = await create(81);
  const entered = message(host, 'snapshot-entered');
  const pending = client.request('attach', bad).catch(e => e);
  await entered;
  const exited = once(host, 'exit');
  await quick(client.request('stop', { force: true }));
  assert.match((await pending).message, /SESSION_ENDED|STOPPING/);
  assert.equal((await exited)[0], 0);
});

test('a screen timeout fails only its session and late completion cannot acquire a lease', async t => {
  const { client, host, create } = await fixture(t);
  const bad = await create(81), good = await create();
  await assert.rejects(client.request('attach', bad), /SCREEN_FAILED/);
  host.send('release'); await wait(100);
  assert.equal((await client.request('read', { ...bad, after: 0 })).failure, 'SCREEN_FAILED');
  await assert.rejects(client.request('attach', bad), /NOT_FOUND|SCREEN_FAILED/);
  assert.equal((await client.request('attach', good)).identity.generation, 1);
});

for (const failure of ['write', 'exit']) {
  test(`rejected screen ${failure} is contained to its session`, async t => {
    const { client, host, create, stderr } = await fixture(t);
    const good = await create();
    const bad = await create(failure === 'write' ? 82 : 83,
      failure === 'write' ? `setTimeout(()=>process.stdout.write('FAULT'),100);process.stdin.resume()` : 'process.stdin.resume()');
    if (failure === 'exit') {
      const armed = message(host, 'exit-armed'); host.send('reject-exit'); await armed;
      await client.request('terminate', bad);
    }
    await wait(300);
    assert.equal(host.exitCode, null, stderr());
    const a = await client.request('attach', good);
    await client.request('input', { ...a.identity, data: 'x' });
    const read = await client.request('read', { ...bad, after: 0 });
    assert.equal(read.failure, 'SCREEN_FAILED');
    assert.equal(read.cleanupError, undefined);
    assert.equal((await client.request('status')).sessions, 1);
  });
}

test('per-session admission is bounded while a screen barrier stalls', async t => {
  const { client, host, create } = await fixture(t);
  const s = await create(81);
  const entered = message(host, 'snapshot-entered');
  const first = client.request('attach', s).catch(e => e);
  await entered;
  const pending = Array.from({ length: 8 }, () => client.request('attach', s).catch(e => e));
  assert.equal((await quick(Promise.race(pending))).message, 'QUEUE_FULL');
  assert.equal((await quick(client.request('status'))).sessions, 1);
  host.send('release');
  const results = await Promise.all([first, ...pending]);
  assert.equal(results.filter(r => r.message === 'QUEUE_FULL').length, 1);
});

test('cancelled attach does not revoke a writer after its snapshot eventually resolves', async t => {
  const { dir, client, host, create } = await fixture(t);
  const s = await create(81);
  const endpoint = JSON.parse(await readFile(join(dir, 'endpoint.json'), 'utf8'));
  const entered = message(host, 'snapshot-entered');
  const controller = new AbortController();
  const pending = fetch(`http://127.0.0.1:${endpoint.port}/rpc`, {
    method: 'POST', headers: { authorization: `Bearer ${endpoint.token}` },
    body: JSON.stringify({ method: 'attach', params: s, epoch: endpoint.epoch }), signal: controller.signal,
  }).catch(e => e);
  await entered;
  controller.abort(); await pending; await wait(100);
  host.send('release');
  const a = await client.request('attach', s);
  assert.equal(a.identity.generation, 1, 'cancelled attach must never acquire a lease');
  assert.equal((await client.request('status')).sessions, 1, 'disconnect must not kill the PTY');
});

test('stalled snapshot cannot block status, another terminal or terminate', async t => {
  const { client, host, create } = await fixture(t);
  const bad = await create(81), good = await create();
  const entered = message(host, 'snapshot-entered');
  const pending = client.request('attach', bad).catch(e => e);
  await entered;
  assert.equal((await quick(client.request('status'))).sessions, 2);
  const lease = await quick(client.request('attach', good));
  await quick(client.request('input', { ...lease.identity, data: 'x' }));
  await quick(client.request('terminate', bad));
  assert.match((await pending).message, /SESSION_ENDED|SCREEN_FAILED/);
});
