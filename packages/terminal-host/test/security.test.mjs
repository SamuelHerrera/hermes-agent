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
