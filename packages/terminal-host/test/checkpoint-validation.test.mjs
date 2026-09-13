import test from 'node:test';
import assert from 'node:assert/strict';
import xterm from '@xterm/headless';
import { Screen, restoreScreen } from '../src/screen.mjs';

test('undersized checkpoint cells are rejected before destination mutation', async () => {
  const source = new Screen({ cols: 20, rows: 8 });
  const dest = new xterm.Terminal({ cols: 20, rows: 8, allowProposedApi: true });
  try {
    await source.write('source');
    await new Promise(resolve => dest.write('KEEP', resolve));
    const checkpoint = await source.snapshot();
    checkpoint.normal.lines[0].length = 0;
    checkpoint.normal.lines[0].data = [];
    await assert.rejects(restoreScreen(dest, checkpoint), /INVALID_CHECKPOINT/);
    assert.equal(dest.buffer.normal.getLine(0).translateToString(true), 'KEEP');
    await new Promise(resolve => dest.write('CONTINUE', resolve));
    assert.equal(dest.buffer.normal.getLine(0).translateToString(true), 'KEEPCONTINUE');
  } finally { source.dispose(); dest.dispose(); }
});
