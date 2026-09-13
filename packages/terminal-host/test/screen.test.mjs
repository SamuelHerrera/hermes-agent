import test from 'node:test';
import assert from 'node:assert/strict';
import xterm from '@xterm/headless';
const { Terminal } = xterm;
const write = (t, data) => new Promise(r => t.write(data, r));
function state(t) {
  const b = t.buffer.active;
  return { type: b.type, x: b.cursorX, y: b.cursorY,
    lines: Array.from({length: b.length}, (_, i) => b.getLine(i).translateToString(true)) };
}
test('snapshot restores both buffers and differential output after alternate exit', async () => {
  const { Screen, restoreScreen } = await import('../src/screen.mjs');
  const screen = new Screen({ cols: 40, rows: 8 });
  const live = new Terminal({ cols: 40, rows: 8, allowProposedApi: true });
  const restored = new Terminal({ cols: 40, rows: 8, allowProposedApi: true });
  try {
    const prefix = 'normal\r\nkeep\x1b[?1049h\x1b[2J\x1b[3;4H\x1b[31mAlternate';
    await Promise.all([screen.write(Buffer.from(prefix)), write(live, prefix)]);
    const snapshot = await screen.snapshot();
    await restoreScreen(restored, snapshot);
    assert.deepEqual(state(restored), state(live));
    const delta = '\x1b[0m!\x1b[?1049l\r\ncontinued';
    await Promise.all([screen.write(Buffer.from(delta)), write(live, delta), write(restored, delta)]);
    assert.deepEqual(state(restored), state(live));
  } finally { screen.dispose(); live.dispose(); restored.dispose(); }
});
test('state checkpoint preserves partial ANSI, UTF8, modes and resize at callback boundary', async () => {
  const { Screen, restoreScreen } = await import('../src/screen.mjs');
  const screen = new Screen({ cols: 40, rows: 8 });
  const restored = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  try {
    await screen.write(Buffer.from('line\r\n\x1b[2;6r\x1b[?6h\x1b[3;2H'));
    await screen.write(Buffer.from([0xe2, 0x82]));
    const snap = await screen.snapshot();
    assert.equal(snap.format, 'hermes-xterm-state');
    await restoreScreen(restored, snap);
    const events = [];
    screen.onEvent = e => events.push(e);
    await screen.write(Buffer.from([0xac]));
    await screen.write(Buffer.from('\x1b['));
    const split = await screen.snapshot();
    await restoreScreen(restored, split);
    events.length = 0;
    await screen.write(Buffer.from('31mRED\x1b[?1049hALT'));
    await screen.resize(50, 10);
    await screen.write(Buffer.from('\x1b[?1049l\r\nEND'));
    for (const e of events) {
      if (e.type === 'resize') restored.resize(e.cols, e.rows);
      else await write(restored, e.data);
    }
    assert.deepEqual(state(restored), state(screen.term));
  } finally { screen.dispose(); restored.dispose(); }
});
test('checkpoint format never exposes ANSI preview as a reconstruction stream', async () => {
  const { Screen, restoreScreen } = await import('../src/screen.mjs');
  const screen = new Screen();
  const target = new Terminal({ allowProposedApi: true });
  try {
    await screen.write(Buffer.from('x'.repeat(101)));
    const snapshot = await screen.snapshot();
    assert.equal(snapshot.data, undefined);
    assert.equal(snapshot.exact, undefined);
    assert.equal(snapshot.replay, undefined);
    assert.equal(snapshot.preview.approximate, true);
    assert.match(snapshot.preview.data, /x/);
    await restoreScreen(target, snapshot);
    assert.deepEqual(state(target), state(screen.term));
  } finally { screen.dispose(); target.dispose(); }
});
export { state, write, Terminal };
