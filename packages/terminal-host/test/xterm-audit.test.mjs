import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ENGINE } from '../src/xterm-state-validation.mjs';

test('pinned 6.0.0 headless and renderer common sources are byte-identical', async t => {
  const root = new URL('../node_modules/@xterm/', import.meta.url);
  const maps = await Promise.all(['headless/lib-headless/xterm-headless.js.map', 'xterm/lib/xterm.js.map'].map(async n => JSON.parse(await readFile(new URL(n, root), 'utf8'))));
  const common = m => Object.fromEntries(m.sources.map((n, i) => [n.split('/common/')[1], m.sourcesContent[i]]).filter(([n]) => n !== undefined));
  const [a, b] = maps.map(common);
  const keys = Object.keys(a).filter(k => k in b).sort();
  assert.equal(keys.length, 54); // 43 xterm sources + 11 VS Code common helpers.
  for (const k of keys) assert.equal(a[k], b[k], k);
  assert.equal(createHash('sha256').update(keys.map(k => k + '\0' + a[k]).join('')).digest('hex'), ENGINE.build);
  for (const name of ['headless', 'xterm']) assert.equal(JSON.parse(await readFile(new URL(name + '/package.json', root))).version, '6.0.0');
  t.diagnostic(`${keys.length} audited identical shared source files; build ${ENGINE.build}`);
});
