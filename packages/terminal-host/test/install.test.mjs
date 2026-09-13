import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installBundle } from '../src/install.mjs';

test('bundle installation is immutable and never overwrites a running version', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'host-install-'));
  try {
    const source = join(dir, 'source'); await mkdir(source);
    await writeFile(join(source, 'manifest.json'), JSON.stringify({ version: 'test-1', platform: process.platform, arch: process.arch }));
    await writeFile(join(source, 'node'), 'original');
    const first = await installBundle(source, join(dir, 'versions'));
    await writeFile(join(source, 'node'), 'replacement');
    assert.equal(await installBundle(source, join(dir, 'versions')), first);
    assert.equal(await readFile(join(first, 'node'), 'utf8'), 'original');
    await writeFile(join(source, 'manifest.json'), JSON.stringify({ version: '../escape', platform: process.platform, arch: process.arch }));
    await assert.rejects(installBundle(source, join(dir, 'versions')), /INVALID_BUNDLE/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
