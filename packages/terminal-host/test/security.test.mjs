import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, chmod, symlink, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
test('private runtime refuses symlinks and unsafe existing directories', { skip: process.platform === 'win32' }, async t => {
  const { privateDirectory } = await import('../src/security.mjs');
  const root = await mkdtemp(join(tmpdir(), 'host-permissions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'private');
  await privateDirectory(dir);
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
  await chmod(dir, 0o755);
  await assert.rejects(privateDirectory(dir), /UNSAFE_DIRECTORY/);
  await symlink(dir, join(root, 'link'));
  await assert.rejects(privateDirectory(join(root, 'link')), /UNSAFE_DIRECTORY/);
});
test('publication replaces a permissive existing endpoint with a fresh private file', async t => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { connect } = await import('../src/client.mjs');
  const { open } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const exec = promisify(execFile);
  const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
  const root = await mkdtemp(join(tmpdir(), 'host-republish-'));
  const file = join(root, 'endpoint.json');
  const run = (...args) => exec(process.execPath, [cli, ...args, '--dir', root]);
  t.after(async () => { await run('stop', '--force').catch(() => {}); await rm(root, { recursive: true, force: true }); });
  await writeFile(file, 'old-public-token', { mode: 0o644 });
  if (process.platform === 'win32') {
    execFileSync('icacls.exe', [file, '/grant', '*S-1-1-0:(R)'], { stdio: 'pipe' });
  }
  const before = await stat(file);
  // Keep the old inode alive so the assertion cannot pass on inode reuse.
  const old = await open(file, 'r'); t.after(() => old.close());
  await run('start');
  const after = await stat(file);
  assert.notEqual(after.ino, before.ino, 'must never overwrite a permissive inode');
  assert.equal(await old.readFile('utf8'), 'old-public-token');
  assert.equal((await (await connect(root)).request('status')).sessions, 0);
  if (process.platform !== 'win32') assert.equal(after.mode & 0o777, 0o600);
  else {
    const code = `$ErrorActionPreference='Stop'; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $acl=Get-Acl -LiteralPath '${file.replaceAll("'", "''")}'; if(!$acl.AreAccessRulesProtected){throw 'inherited ACL'}; foreach($r in $acl.Access){if($r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid){throw 'foreign ACE'}}; 'private'`;
    assert.match(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], { encoding: 'utf8' }), /private/);
  }
});

test('native Windows runtime token inherits only current-user ACL', { skip: process.platform !== 'win32' }, async t => {
  const { privateDirectory } = await import('../src/security.mjs');
  const root = await mkdtemp(join(tmpdir(), 'host-acl-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await privateDirectory(root);
  const file = join(root, 'token');
  await writeFile(file, 'test-token');
  const code = `$ErrorActionPreference='Stop'; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $acl=Get-Acl -LiteralPath '${file.replaceAll("'", "''")}'; foreach($r in $acl.Access) { if($r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid) { throw 'foreign ACE' } }; 'private'`;
  assert.match(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], { encoding: 'utf8' }), /private/);
});
