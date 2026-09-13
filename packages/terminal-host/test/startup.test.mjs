import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const hostURL = new URL('../src/host.mjs', import.meta.url).href;
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'host-startup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
test('endpoint publication failure exits and rolls back only its owned lock', async t => {
  const dir = await fixture(t);
  await mkdir(join(dir, 'endpoint.json'));
  const result = await exec(process.execPath, [cli, 'serve', '--dir', dir], { timeout: 1500 }).catch(e => e);
  assert.equal(result.killed, false, 'failed startup must exit itself, not leak a listening host');
  assert.equal(result.code, 1);
  assert.ok((await stat(join(dir, 'endpoint.json'))).isDirectory(), 'preexisting endpoint must survive rollback');
  await assert.rejects(stat(join(dir, 'host.lock')), { code: 'ENOENT' });
});
test('real listen failure releases owned lock without removing preexisting artifacts', async t => {
  const dir = await fixture(t);
  await mkdir(join(dir, 'sentinel'));
  const code = `import http from 'node:http'; import net from 'node:net';
    import {serve} from ${JSON.stringify(hostURL)};
    const blocker=net.createServer(); await new Promise(r=>blocker.listen(0,'127.0.0.1',r));
    const listen=http.Server.prototype.listen;
    http.Server.prototype.listen=function(){return listen.call(this,blocker.address().port,'127.0.0.1')};
    try {await serve(${JSON.stringify(dir)})} catch(e){console.error(e.code);process.exitCode=1}
    finally {blocker.close()}`;
  const result = await exec(process.execPath, ['--input-type=module', '-e', code], { timeout: 3000 }).catch(e => e);
  assert.equal(result.code, 1); assert.match(result.stderr, /EADDRINUSE/);
  await assert.rejects(stat(join(dir, 'host.lock')), { code: 'ENOENT' });
  assert.ok((await stat(join(dir, 'sentinel'))).isDirectory());
});
test('an unowned existing lock is never removed on startup failure', async t => {
  const dir = await fixture(t);
  await mkdir(join(dir, 'host.lock'));
  await exec(process.execPath, [cli, 'serve', '--dir', dir]).catch(() => {});
  assert.ok((await stat(join(dir, 'host.lock'))).isDirectory());
});
