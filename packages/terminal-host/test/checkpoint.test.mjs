import test from 'node:test';
import assert from 'node:assert/strict';
import xterm from '@xterm/headless';
import { vectors } from './vectors.mjs';
import { Screen, restoreScreen } from '../src/screen.mjs';
import { captureTerminalState, initializeTerminalState } from '../src/xterm-state-v1.mjs';
const { Terminal } = xterm;
const write = (t, d) => new Promise(r => t.write(d, r));
function semantic(t) {
  initializeTerminalState(t);
  const c = t._core, i = c._inputHandler;
  return { buffers: visible(t), modes: structuredClone(c.coreService.decPrivateModes),
    charset: structuredClone(c._charsetService._charsets), glevel: c._charsetService.glevel,
    title: i._windowTitle, state: captureTerminalState(t) };
}
function visible(t) {
  return ['normal', 'alternate'].map(name => {
    const b = t.buffer[name];
    return { x: b.cursorX, y: b.cursorY, base: b.baseY,
      lines: Array.from({ length: b.length }, (_, y) => b.getLine(y).translateToString()) };
  });
}
test('JSON object key ordering does not change a valid checkpoint', async () => {
  const s = new Screen(), d = new Terminal({ allowProposedApi: true });
  try {
    await s.write('key order');
    const snap = await s.snapshot(); snap.engine = Object.fromEntries(Object.entries(snap.engine).reverse());
    await restoreScreen(d, snap);
    assert.deepEqual(semantic(d), semantic(s.term));
  } finally { s.dispose(); d.dispose(); }
});
test('every UTF8 byte boundary preserves direct xterm decoder continuation', async () => {
  const bytes = Buffer.from('🚀€汉á');
  for (let split = 0; split <= bytes.length; split++) {
    const source = new Terminal({ allowProposedApi: true }), dest = new Terminal({ allowProposedApi: true });
    initializeTerminalState(source);
    try {
      await write(source, bytes.subarray(0, split));
      await restoreScreen(dest, JSON.parse(JSON.stringify(captureTerminalState(source))));
      await write(source, bytes.subarray(split)); await write(dest, bytes.subarray(split));
      assert.deepEqual(semantic(dest), semantic(source), `UTF8 byte split ${split}`);
    } finally { source.dispose(); dest.dispose(); }
  }
});
test('public adapter rejects capture while a real xterm write is pending', async () => {
  const t = new Terminal({ allowProposedApi: true }); initializeTerminalState(t);
  try {
    const pending = write(t, 'not yet parsed');
    assert.throws(() => captureTerminalState(t), /INCOMPATIBLE_XTERM.*pending/);
    await pending;
    assert.equal(captureTerminalState(t).normal.x, 14);
  } finally { t.dispose(); }
});
test('stock payload limits, rejected CSI digits, combining strings and link growth remain state-sized', async () => {
  const s = new Screen({ cols: 20, rows: 8 });
  try {
    for (const prefix of ['\x1b[' + '1;'.repeat(40) + '123:456', '\x1b[38:2:' + '1:'.repeat(40), '\x1b]2;' + 'p'.repeat(9_999_999), '\x1b]2;' + 'p'.repeat(10_000_001)]) {
      s.term.reset();
      await s.write(prefix);
      const d = new Terminal({ allowProposedApi: true });
      try {
        await restoreScreen(d, JSON.parse(JSON.stringify(await s.snapshot())));
        await s.write('89mZ\x07'); await write(d, '89mZ\x07');
        assert.deepEqual(semantic(d), semantic(s.term));
      } finally { d.dispose(); }
    }
    s.term.reset();
    const sizes = [];
    await s.write('a');
    for (let n = 0; n < 3; n++) {
      await s.write('́'.repeat(10000));
      const snap = await s.snapshot(); sizes.push(JSON.stringify(snap).length);
      const d = new Terminal({ allowProposedApi: true });
      try { await restoreScreen(d, snap); assert.equal(d.buffer.active.getLine(0).getCell(0).getChars().length, 1 + 10000 * (n + 1)); }
      finally { d.dispose(); }
    }
    assert.ok(sizes[2] > sizes[1] && sizes[1] > sizes[0], 'legitimate retained state is not silently capped');
    s.term.reset();
    for (let n = 0; n < 1000; n++) await s.write(`\x1b]8;;https://example/${n}\x07\x1b]8;;\x07`);
    const snap = await s.snapshot();
    assert.equal(snap.links.entries.length, 1000);
    const d = new Terminal({ allowProposedApi: true });
    try { await restoreScreen(d, snap); assert.deepEqual(semantic(d), semantic(s.term)); }
    finally { d.dispose(); }
  } finally { s.dispose(); }
});
test('capture rejects untracked presentation instead of inventing absent color overrides', async () => {
  const t = new Terminal({ allowProposedApi: true });
  try { await write(t, '\x1b]10;#123456\x07'); assert.throws(() => captureTerminalState(t), /UNTRACKED_PRESENTATION/); }
  finally { t.dispose(); }
});
test('runtime field type drift is rejected before hydration', async () => {
  const s = new Screen(), d = new Terminal({ allowProposedApi: true });
  try {
    const snapshot = await s.snapshot();
    d._core._bufferService.buffers.normal.lines.get(0)._data = [];
    await assert.rejects(restoreScreen(d, snapshot), /INCOMPATIBLE_XTERM/);
    assert.equal(d._core._bufferService.buffers.normal.lines.get(0)._data.constructor, Array);
  } finally { s.dispose(); d.dispose(); }
});
test('checkpoint after shrink/reflow continues through repeated fresh restores', async () => {
  const s = new Screen({ cols: 80, rows: 8 });
  try {
    await s.write(('wide界á'.repeat(16) + '\r\n').repeat(20));
    for (const [cols, rows] of [[40, 8], [120, 10], [30, 5], [80, 8]]) {
      await s.resize(cols, rows);
      const d = new Terminal({ allowProposedApi: true });
      try {
        await restoreScreen(d, JSON.parse(JSON.stringify(await s.snapshot())));
        await s.write('\x1b[2Jafter\tX\x1b7\r\nnext\x1b8!');
        await write(d, '\x1b[2Jafter\tX\x1b7\r\nnext\x1b8!');
        assert.deepEqual(semantic(d), semantic(s.term));
      } finally { d.dispose(); }
    }
  } finally { s.dispose(); }
});
test('UTF8 decoder advances only at its queued boundary; clients receive decoded deltas once', async () => {
  const s = new Screen({ cols: 20, rows: 8 });
  try {
    let release;
    s.enqueue(() => new Promise(r => release = r));
    await Promise.resolve();
    const pending = s.write(Buffer.from([0xf0, 0x9f]));
    try { assert.equal(s.decoder.lastNeed, 0); } finally { release(); }
    await pending;
    const d = new Terminal({ allowProposedApi: true });
    try {
      await restoreScreen(d, await s.snapshot());
      const events = []; s.onEvent = e => events.push(e);
      await s.write(Buffer.from([0x9a, 0x80]));
      assert.equal(events.length, 1); assert.equal(events[0].data, '🚀');
      await write(d, events[0].data); assert.deepEqual(semantic(d), semantic(s.term));
    } finally { d.dispose(); }
  } finally { s.dispose(); }
});
test('incompatible, corrupt, and addon checkpoints fail before any destination mutation', async () => {
  const s = new Screen({ cols: 20, rows: 8 });
  try {
    await s.write('retained\x1b[38:2::12');
    const original = await s.snapshot();
    for (const corrupt of [
      x => x.version = 999,
      x => x.engine = { build: 'different' },
      x => x.normal.lines[0].data[0] = 'oops',
      x => x.parser.params._subParamsIdx = [99999],
      x => x.normal.x = 21,
      x => x.mouse._activeProtocol = 'UNKNOWN',
      x => x.charset.glevel = 8,
      x => x.presentation.colors = [{ index: 800, color: [1, 2, 3] }],
      x => x.normal.lines[0].extended = { 0: { _ext: 'oops', _urlId: 0 } }
    ]) {
      const d = new Terminal({ allowProposedApi: true });
      try {
        const before = semantic(d), snapshot = structuredClone(original); corrupt(snapshot);
        await assert.rejects(restoreScreen(d, snapshot), /INCOMPATIBLE|INVALID/);
        assert.deepEqual(semantic(d), before);
      } finally { d.dispose(); }
    }
    const d = new Terminal({ allowProposedApi: true });
    try {
      d.parser.registerCsiHandler({ final: 'm' }, () => false);
      await assert.rejects(restoreScreen(d, original), /INCOMPATIBLE/);
    } finally { d.dispose(); }
    s.term.parser.registerOscHandler(999, () => true);
    await assert.rejects(s.snapshot(), /INCOMPATIBLE/);
  } finally { s.dispose(); }
});
test('hyperlinks retain IDs and real marker disposal subscriptions', async () => {
  const s = new Screen({ cols: 20, rows: 8 });
  const d = new Terminal({ allowProposedApi: true });
  const links = t => [...t._core._oscLinkService._dataByLinkId].map(([id, e]) => ({ id, data: e.data, lines: e.lines.map(m => m.line) }));
  try {
    await s.write('\x1b]8;id=a;https://a.example\x1b\\link\r\nsecond\x1b]8;;\x1b\\\x1b[?1049h\x1b]8;;https://b.example\x07alt');
    await restoreScreen(d, JSON.parse(JSON.stringify(await s.snapshot())));
    assert.deepEqual(links(d), links(s.term));
    for (const delta of ['more\r\nlink', '\x1b]8;;\x07\x1b[?1049l', '\r\n'.repeat(2020)]) {
      await s.write(delta); await write(d, delta);
      assert.deepEqual(links(d), links(s.term));
      assert.deepEqual(semantic(d), semantic(s.term));
    }
    assert.equal(links(d).length, 0);
  } finally { s.dispose(); d.dispose(); }
});
test('parser and service continuation survives each split boundary', async () => {
  for (const vector of vectors) for (let split = 0; split <= vector.length; split++) {
    const s = new Screen({ cols: 20, rows: 8 });
    const d = new Terminal({ allowProposedApi: true });
    try {
      s.term.options.windowOptions = { pushTitle: true, popTitle: true };
      await s.write(vector.slice(0, split));
      await restoreScreen(d, JSON.parse(JSON.stringify(await s.snapshot())));
      await s.write(vector.slice(split)); await write(d, vector.slice(split));
      assert.deepEqual(semantic(d), semantic(s.term), `split ${split} of ${JSON.stringify(vector)}`);
      await s.resize(17, 10); d.resize(17, 10);
      await s.write('\r\ncontinue\x1b8!'); await write(d, '\r\ncontinue\x1b8!');
      assert.deepEqual(semantic(d), semantic(s.term), `resized split ${split} of ${JSON.stringify(vector)}`);
    } finally { s.dispose(); d.dispose(); }
  }
});
test('long-running repaint checkpoints stabilize and repeatedly continue in fresh terminals', async () => {
  const s = new Screen({ cols: 40, rows: 8 });
  const oracle = new Terminal({ cols: 40, rows: 8, scrollback: 2000, allowProposedApi: true });
  const frame = '\x1b[H\x1b[32mCPU ' + '1234567890'.repeat(20) + '\x1b[0m';
  const batch = frame.repeat(5000);
  const sizes = [];
  try {
    await s.write('normal\x1b[?1049h'); await write(oracle, 'normal\x1b[?1049h');
    for (let n = 0; n < 4; n++) {
      await s.write(batch); await write(oracle, batch);
      const snap = JSON.parse(JSON.stringify(await s.snapshot()));
      const dest = new Terminal({ allowProposedApi: true });
      try {
        await restoreScreen(dest, snap);
        assert.deepEqual(visible(dest), visible(oracle));
        const delta = '\x1b[3;4H!\x1b[?1049l\r\nnext\x1b[?1049h';
        await s.write(delta); await write(oracle, delta); await write(dest, delta);
        assert.deepEqual(visible(dest), visible(oracle));
        sizes.push(Buffer.byteLength(JSON.stringify(snap)));
      } finally { dest.dispose(); }
    }
    assert.ok(Math.max(...sizes) < 100_000, `state, not replay: ${sizes}`);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) < 10_000, `stable retained state: ${sizes}`);
    assert.equal(s.replay, undefined);
    console.log(JSON.stringify({ repaintBytes: Buffer.byteLength(batch) * 4, checkpointBytes: sizes }));
  } finally { s.dispose(); oracle.dispose(); }
});
