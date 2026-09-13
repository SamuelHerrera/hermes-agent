import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const clientURL = new URL('../src/client.mjs', import.meta.url).href;
const windows = process.platform === 'win32';
const shell = windows ? { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NoExit'] } : { file: '/bin/sh', args: ['-i'] };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'hermes-host-test-'));
  t.after(async () => {
    await exec(process.execPath, [cli, 'stop', '--dir', dir, '--force']).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });
  const run = (command, ...args) => exec(process.execPath, [cli, command, '--dir', dir, ...args]);
  await run('start');
  const { connect } = await import(clientURL);
  const client = await connect(dir);
  return { dir, run, client };
}
async function until(fn, predicate) {
  const deadline = Date.now() + 10000;
  let value;
  do {
    value = await fn();
    if (predicate(value)) return value;
    await new Promise(r => setTimeout(r, 30));
  } while (Date.now() < deadline);
  assert.fail(`condition timed out: ${JSON.stringify(value)}`);
}
test('shell PID and non-exported variable survive creator client process exit', async t => {
  const { dir, client } = await fixture(t);
  const code = `import {connect} from ${JSON.stringify(clientURL)};
    const c = await connect(${JSON.stringify(dir)});
    const s = await c.request('create', {scope:'test', requestId:'one', ...${JSON.stringify(shell)}});
    const a = await c.request('attach', {scope:'test', terminalId:s.terminalId});
    await c.request('input', {...a.identity, data:${JSON.stringify(windows ? "$secretLocal='retained42'; Write-Output \"PID=$PID\"\r" : "secretLocal=retained42; printf 'PID=%s\\n' \"$$\"\r")}});
    console.log(JSON.stringify({s, a}));`;
  const created = JSON.parse((await exec(process.execPath, ['--input-type=module', '-e', code])).stdout);
  const { s } = created;
  const a = await client.request('attach', { scope: 'test', terminalId: s.terminalId });
  assert.equal(a.pid, s.pid);
  t.diagnostic(`creator exited; reattached same PTY PID ${s.pid}, host epoch ${a.identity.epoch}`);
  await client.request('input', { ...a.identity, data: windows ? 'Write-Output "VERIFY=$PID/$secretLocal"\r' : 'printf "VERIFY=%s/%s\\n" "$$" "$secretLocal"\r' });
  const out = await until(() => client.request('read', { ...a.identity, after: 0 }), x => x.events.some(e => e.data?.includes(`VERIFY=${s.pid}/retained42`)));
  assert.ok(out.events.length);
  await client.request('terminate', a.identity);
  await until(() => client.request('list', { scope: 'test' }), x => x.sessions.length === 0);
  if (!windows) await until(async () => { try { process.kill(s.pid, 0); return false; } catch { return true; } }, Boolean);
});
test('create is idempotent within scope, including after termination', async t => {
  const { client } = await fixture(t);
  const params = { scope: 'a', requestId: 'same', ...shell };
  const [one, two] = await Promise.all([client.request('create', params), client.request('create', params)]);
  assert.deepEqual(one, two);
  const other = await client.request('create', { ...params, scope: 'b' });
  assert.notEqual(one.terminalId, other.terminalId);
  await client.request('terminate', { scope: 'a', terminalId: one.terminalId });
  await until(() => client.request('list', { scope: 'a' }), x => !x.sessions.length);
  assert.deepEqual(await client.request('create', params), one);
  await assert.rejects(client.request('attach', { scope: 'a', terminalId: one.terminalId }), /NOT_FOUND/);
});
test('writer generation rejects stale input and detach without killing replacement', async t => {
  const { client } = await fixture(t);
  const s = await client.request('create', { scope: 'a', requestId: 'writer', ...shell });
  const first = await client.request('attach', { scope: 'a', terminalId: s.terminalId });
  await assert.rejects(client.request('attach', { scope: 'b', terminalId: s.terminalId }), /SCOPE_MISMATCH/);
  const second = await client.request('attach', { scope: 'a', terminalId: s.terminalId });
  await assert.rejects(client.request('input', { ...first.identity, data: 'exit\r' }), /STALE_WRITER/);
  await assert.rejects(client.request('detach', first.identity), /STALE_WRITER/);
  await client.request('input', { ...second.identity, data: '\r' });
  await client.request('detach', second.identity);
  await assert.rejects(client.request('input', { ...second.identity, data: 'exit\r' }), /STALE_WRITER/);
  const third = await client.request('attach', { scope: 'a', terminalId: s.terminalId });
  assert.equal(third.pid, s.pid);
});
test('PTY screen snapshot precedes ordered deltas and host answers device queries', async t => {
  const { client } = await fixture(t);
  const program = `process.stdin.setRawMode(true); process.stdin.resume();
    process.stdin.on('data', d => { if(d.includes(82)) process.stdout.write('REPLY='+d.toString('hex')); else process.stdout.write('AFTER'); });
    process.stdout.write('NORMAL\\r\\n\\x1b[?1049hALT\\x1b[6n');`;
  const s = await client.request('create', { scope: 'screen', requestId: 'screen', file: process.execPath, args: ['-e', program] });
  const p = { scope: 'screen', terminalId: s.terminalId };
  await until(() => client.request('read', { ...p, after: 0 }), x => x.events.some(e => e.data?.includes('REPLY=')));
  const a = await client.request('attach', p);
  assert.equal(a.snapshot.format, 'hermes-xterm-state');
  const { restoreScreen } = await import('../src/screen.mjs');
  const { default: xterm } = await import('@xterm/headless');
  const view = new xterm.Terminal({ allowProposedApi: true, scrollback: 2000 });
  t.after(() => view.dispose());
  await restoreScreen(view, a.snapshot);
  assert.equal(view.buffer.active.type, 'alternate');
  await client.request('resize', { ...a.identity, cols: 100, rows: 30 });
  await client.request('input', { ...a.identity, data: 'x' });
  const read = await until(() => client.request('read', { ...p, after: a.snapshot.seq }), x => x.events.some(e => e.data?.includes('AFTER')));
  assert.equal(read.events[0].seq, a.snapshot.seq + 1);
  for (let i = 1; i < read.events.length; i++) assert.equal(read.events[i].seq, read.events[i-1].seq + 1);
  assert.equal(read.events[0].type, 'resize');
  for (const e of read.events) {
    if (e.type === 'resize') view.resize(e.cols, e.rows);
    else await new Promise(r => view.write(e.data, r));
  }
  assert.equal(view.cols, 100);
  assert.ok(Array.from({length: view.buffer.active.length}, (_, i) => view.buffer.active.getLine(i).translateToString()).join('\n').includes('AFTER'));
});
test('safe stop refuses detached work; concurrent start returns one host epoch', async t => {
  const { client, run } = await fixture(t);
  const s = await client.request('create', { scope: 'a', requestId: 'stop', ...shell });
  await assert.rejects(run('stop'), /LIVE_SESSIONS/);
  const initial = await client.request('status');
  const results = await Promise.all([run('start'), run('start')]);
  for (const r of results) assert.equal(JSON.parse(r.stdout).epoch, initial.epoch);
  assert.equal((await client.request('attach', { scope: 'a', terminalId: s.terminalId })).pid, s.pid);
});
test('local HTTP boundary rejects missing auth, browser origins, rebinding and stale epoch', async t => {
  const { dir } = await fixture(t);
  const { readFile, stat } = await import('node:fs/promises');
  const e = JSON.parse(await readFile(join(dir, 'endpoint.json'), 'utf8'));
  if (!windows) {
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    assert.equal((await stat(join(dir, 'endpoint.json'))).mode & 0o777, 0o600);
  }
  const url = `http://127.0.0.1:${e.port}/rpc`;
  const headers = { authorization: `Bearer ${e.token}`, 'content-type': 'application/json' };
  for (const h of [{}, { ...headers, origin: 'http://evil.test' }, { ...headers, host: 'evil.test' }, { ...headers, 'sec-fetch-site': 'same-origin' }]) {
    const { request } = await import('node:http');
    const status = await new Promise((resolve, reject) => {
      const req = request(url, { method: 'POST', headers: h }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.end(JSON.stringify({ epoch: e.epoch, method: 'status', params: {} }));
    });
    assert.equal(status, 403, JSON.stringify(Object.keys(h)));
  }
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ epoch: 'old', method: 'status', params: {} }) });
  assert.equal((await r.json()).error, 'HOST_LOST');
});
test('slow readers get explicit GAP while detached output keeps draining', async t => {
  const { client } = await fixture(t);
  const s = await client.request('create', { scope: 'flood', requestId: 'flood', file: process.execPath,
    args: ['-e', `process.stdout.write('x'.repeat(800000)+'FLOOD_DONE');process.stdin.resume();`] });
  const p = { scope: 'flood', terminalId: s.terminalId };
  await until(() => client.request('attach', p), a => a.snapshot.preview.data.includes('FLOOD_DONE'));
  await assert.rejects(client.request('read', { ...p, after: 0 }), /GAP/);
  const a = await client.request('attach', p);
  assert.deepEqual((await client.request('read', { ...p, after: a.snapshot.seq })).events, []);
  const status = await client.request('status');
  assert.ok(status.maxQueuedBytes <= 512 * 1024, `queue peak ${status.maxQueuedBytes}`);
});
test('invalid protocol values fail before PTY creation or mutation', async t => {
  const { client } = await fixture(t);
  for (const p of [{ requestId: 'bad', ...shell }, { scope: 'a', ...shell }, { scope: 'a', requestId: 'bad', ...shell, cols: -1 }]) {
    await assert.rejects(client.request('create', p), /INVALID_PARAMS/);
  }
  const s = await client.request('create', { scope: 'a', requestId: 'valid', ...shell });
  const a = await client.request('attach', { scope: 'a', terminalId: s.terminalId });
  await assert.rejects(client.request('resize', { ...a.identity, cols: 0, rows: 20 }), /INVALID_PARAMS/);
  await assert.rejects(client.request('input', { ...a.identity, data: 'x'.repeat(65537) }), /INVALID_PARAMS/);
  await assert.rejects(client.request('read', { ...a.identity, after: -1 }), /INVALID_PARAMS/);
});
test('process exit remains distinguishable from disconnect and attach cannot respawn it', async t => {
  const { client } = await fixture(t);
  const s = await client.request('create', { scope: 'exit', requestId: 'exit', file: process.execPath, args: ['-e', `process.stdout.write('FINAL');process.exitCode=7`] });
  const p = { scope: 'exit', terminalId: s.terminalId };
  const read = await until(() => client.request('read', { ...p, after: 0 }), x => x.exit?.exitCode === 7);
  assert.ok(read.events.some(e => e.data?.includes('FINAL')));
  await assert.rejects(client.request('attach', p), /NOT_FOUND/);
  assert.deepEqual((await client.request('list', { scope: 'exit' })).sessions, []);
});
test('explicit terminate kills a PTY process that ignores hangup', { skip: windows }, async t => {
  const { client } = await fixture(t);
  const s = await client.request('create', { scope: 'kill', requestId: 'kill', file: process.execPath,
    args: ['-e', `process.on('SIGHUP',()=>{});process.stdout.write('READY');process.stdin.resume();`] });
  const p = { scope: 'kill', terminalId: s.terminalId };
  await until(() => client.request('read', { ...p, after: 0 }), x => x.events.some(e => e.data?.includes('READY')));
  await client.request('terminate', p);
  await until(async () => { try { process.kill(s.pid, 0); return false; } catch { return true; } }, Boolean);
});
test('transport bounds request bodies and reports protocol capabilities', async t => {
  const { client, dir } = await fixture(t);
  const status = await client.request('status');
  assert.equal(status.protocol, 1);
  const { readFile } = await import('node:fs/promises');
  const e = JSON.parse(await readFile(join(dir, 'endpoint.json'), 'utf8'));
  const r = await fetch(`http://127.0.0.1:${e.port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${e.token}` }, body: ' '.repeat(140000) });
  assert.equal((await r.json()).error, 'REQUEST_TOO_LARGE');
});
test('create dimensions reach both PTY and headless snapshot', async t => {
  const { client } = await fixture(t);
  const s = await client.request('create', { scope: 'dimensions', requestId: 'dimensions', cols: 50, rows: 10,
    file: process.execPath, args: ['-e', `process.stdout.write('SIZE='+process.stdout.columns+'x'+process.stdout.rows);process.stdin.resume();`] });
  const p = { scope: 'dimensions', terminalId: s.terminalId };
  const a = await until(() => client.request('attach', p), a => a.snapshot.preview.data.includes('SIZE='));
  assert.equal(a.snapshot.cols, 50);
  assert.equal(a.snapshot.rows, 10);
  assert.match(a.snapshot.preview.data, /SIZE=50x10/);
});
test('HTTP chunk boundaries do not corrupt UTF8 scope', async t => {
  const { client, dir } = await fixture(t);
  const { readFile } = await import('node:fs/promises');
  const { request } = await import('node:http');
  const e = JSON.parse(await readFile(join(dir, 'endpoint.json'), 'utf8'));
  const body = Buffer.from(JSON.stringify({ epoch: e.epoch, method: 'create', params: { scope: '€scope', requestId: 'utf8', ...shell } }));
  const split = body.indexOf(Buffer.from('€')) + 1;
  await new Promise((resolve, reject) => {
    const req = request(`http://127.0.0.1:${e.port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${e.token}` } }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
    req.write(body.subarray(0, split));
    setTimeout(() => req.end(body.subarray(split)), 50);
  });
  assert.equal((await client.request('list', { scope: '€scope' })).sessions.length, 1);
});
test('stop closes admission before acknowledging shutdown', async t => {
  const { client } = await fixture(t);
  await client.request('stop');
  await assert.rejects(client.request('create', { scope: 'late', requestId: 'late', ...shell }), /STOPPING|fetch failed/);
});
test('optional native btop acceptance: same PID and alternate buffer after detach', async t => {
  if (windows) { t.skip('btop acceptance requires POSIX btop'); return; }
  const binary = await exec('which', ['btop']).then(r => r.stdout.trim()).catch(() => null);
  if (!binary) { t.skip('btop not installed'); return; }
  const { dir, client } = await fixture(t);
  const s = await client.request('create', { scope: 'btop', requestId: 'btop', file: binary,
    args: ['--config', join(dir, 'btop.conf'), '--force-utf', '--no-tty', '-u', '1000'], cols: 120, rows: 40 });
  const p = { scope: 'btop', terminalId: s.terminalId };
  const a = await until(() => client.request('attach', p), a => a.snapshot.preview.data.includes('\x1b[?1049h') && a.snapshot.preview.data.length > 2000);
  await client.request('detach', a.identity);
  await until(() => client.request('read', { ...p, after: a.snapshot.seq }), r => r.events.some(e => e.type === 'data'));
  const code = `import {connect} from ${JSON.stringify(clientURL)};const c=await connect(${JSON.stringify(dir)});console.log(JSON.stringify(await c.request('attach',${JSON.stringify(p)})));`;
  const b = JSON.parse((await exec(process.execPath, ['--input-type=module', '-e', code])).stdout);
  assert.equal(b.pid, s.pid);
  assert.ok(b.snapshot.seq >= a.snapshot.seq);
  assert.equal(b.snapshot.format, 'hermes-xterm-state');
  assert.match(b.snapshot.preview.data, /\x1b\[\?1049h/);
  const { default: xterm } = await import('@xterm/headless');
  const { restoreScreen } = await import('../src/screen.mjs');
  const { captureTerminalState } = await import('../src/xterm-state-v1.mjs');
  const first = new xterm.Terminal({ allowProposedApi: true }), second = new xterm.Terminal({ allowProposedApi: true });
  try {
    await restoreScreen(first, a.snapshot); await restoreScreen(second, b.snapshot);
    const updates = await client.request('read', { ...p, after: a.snapshot.seq });
    for (const e of updates.events.filter(e => e.seq <= b.snapshot.seq)) {
      if (e.type === 'resize') first.resize(e.cols, e.rows);
      else await new Promise(r => first.write(e.data, r));
    }
    assert.deepEqual(captureTerminalState(first), captureTerminalState(second));
  } finally { first.dispose(); second.dispose(); }
  t.diagnostic(`btop PID ${s.pid} retained across detach and separate reconnecting client; snapshot seq ${b.snapshot.seq}`);
  await client.request('terminate', p);
});
export { fixture, until, shell };
