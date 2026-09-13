import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { connect } from '../src/client.mjs';
const exec = promisify(execFile);
const cli = new URL('../src/cli.mjs', import.meta.url).pathname;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 100; i++) { if (await fn()) return; await wait(30); }
  assert.fail('condition timed out');
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'host-lifecycle-'));
  const run = (...args) => exec(process.execPath, [cli, ...args, '--dir', dir]);
  t.after(async () => { await run('stop', '--force').catch(() => {}); await rm(dir, { recursive: true, force: true }); });
  await run('start');
  return { dir, run, client: await connect(dir) };
}
async function alive(pid) {
  if (process.platform === 'win32') { try { process.kill(pid, 0); return true; } catch { return false; } }
  // Zombies have stopped executing; some CI init processes reap them slowly.
  const state = await exec('ps', ['-p', String(pid), '-o', 'stat=']).then(r => r.stdout.trim()).catch(() => '');
  return state && !state.startsWith('Z');
}
for (const operation of ['terminate', 'stop']) {
  test(`${operation} kills an ordinary non-detached child without killing unrelated work`, async t => {
    const { dir, client } = await fixture(t);
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    t.after(() => sentinel.kill('SIGKILL'));
    const file = join(dir, 'child.pid');
    let childPid;
    t.after(() => { if (childPid) { try { process.kill(childPid, 'SIGKILL'); } catch {} } });
    const childCode = `${process.platform === 'win32' ? '' : "process.on('SIGHUP',()=>{});"}require('fs').writeFileSync(${JSON.stringify(file)},String(process.pid));setInterval(()=>{},1000)`;
    const code = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'inherit'});setInterval(()=>{},1000)`;
    const s = await client.request('create', { scope: 'child', requestId: 'child', file: process.execPath, args: ['-e', code] });
    await until(async () => { try { childPid = Number(await readFile(file)); return true; } catch { return false; } });
    if (operation === 'terminate') await client.request('terminate', { ...s, scope: 'child' });
    else await client.request('stop', { force: true });
    await until(async () => !(await alive(childPid)) && !(await alive(s.pid)));
    assert.ok(await alive(sentinel.pid));
    if (process.platform === 'win32') t.diagnostic('Native Windows taskkill /T /F descendant gate exercised');
  });
}

test('POSIX ownership guard refuses a non-PTY PID', { skip: process.platform === 'win32' }, async () => {
  const { ownProcessTree } = await import('../src/process-tree.mjs');
  const kill = ownProcessTree({ pid: process.pid, ptsName: '/dev/not-owned', onExit() {} });
  assert.throws(kill, /PROCESS_OWNERSHIP_LOST/);
});

for (const operation of ['terminate', 'stop']) {
  test(`${operation} kills hangup-ignoring foreground and background descendants`, { skip: process.platform === 'win32' }, async t => {
    const { dir, client } = await fixture(t);
    const pids = [];
    t.after(() => { for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch {} } });
    const program = `process.on('SIGHUP',()=>{});require('fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)`;
    const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
    const bg = join(dir, 'bg'), fg = join(dir, 'fg');
    // Real interactive job control: jobs have separate groups in one owned PTY.
    const s = await client.request('create', { scope: 'tree', requestId: 'tree', file: '/bin/sh', args: ['-i'] });
    const a = await client.request('attach', { scope: 'tree', terminalId: s.terminalId });
    await client.request('input', { ...a.identity, data: `${quote(process.execPath)} -e ${quote(program)} ${quote(bg)} &\n${quote(process.execPath)} -e ${quote(program)} ${quote(fg)}\n` });
    await until(async () => {
      try { pids.splice(0, pids.length, Number(await readFile(bg)), Number(await readFile(fg))); return true; } catch { return false; }
    });
    assert.ok(await alive(pids[0])); assert.ok(await alive(pids[1]));
    if (operation === 'terminate') await client.request('terminate', a.identity);
    else await client.request('stop', { force: true });
    await until(async () => !(await alive(pids[0])) && !(await alive(pids[1])));
  });
}
