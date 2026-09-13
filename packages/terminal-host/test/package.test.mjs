import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
const exec = promisify(execFile);
const npmRun = (args, options) => process.platform === 'win32'
  ? exec(process.execPath, [process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...args], options)
  : exec('npm', args, options);
test('packed package installs in isolation and starts an independent usable PTY host', { timeout: 120000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'host-package-'));
  const prefix = join(root, 'install');
  const runtime = join(root, 'run');
  const installed = join(prefix, 'node_modules', '@hermes', 'terminal-host');
  const cli = join(installed, 'src', 'cli.mjs');
  const run = (...args) => exec(process.execPath, [cli, ...args, '--dir', runtime]);
  t.after(async () => {
    await run('stop', '--force').catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  const packed = JSON.parse((await npmRun(['pack', '--workspaces=false', '--json', '--pack-destination', root], { cwd: resolve(import.meta.dirname, '..') })).stdout)[0];
  await npmRun(['install', '--prefix', prefix, '--workspaces=false', '--no-audit', '--no-fund', join(root, packed.filename)], { timeout: 90000 });
  assert.match((await run('--version')).stdout, /^0\.1\.0/);
  if (process.platform !== 'win32') {
    assert.match((await exec(join(prefix, 'node_modules', '.bin', 'hermes-terminal-host'), ['--version'])).stdout, /^0\.1\.0/);
  }
  const started = JSON.parse((await run('start')).stdout);
  assert.equal(JSON.parse((await run('status')).stdout).pid, started.pid);
  const { connect } = await import(pathToFileURL(join(installed, 'src', 'client.mjs')).href);
  const c = await connect(runtime);
  const s = await c.request('create', { scope: 'pack', requestId: 'pack', file: process.execPath, args: ['-e', 'process.stdin.resume()'] });
  assert.ok(s.pid > 0);
  await assert.rejects(run('stop'), /LIVE_SESSIONS/);
  await run('stop', '--force');
});
