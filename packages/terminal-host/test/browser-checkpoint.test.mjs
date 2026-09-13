import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { vectors } from './vectors.mjs';
import { Screen } from '../src/screen.mjs';

test('opened browser xterm hydrates colors and suppresses mirror device replies', async () => {
  const server = createServer(async (req, res) => {
    try {
      const name = req.url === '/xterm.js' ? '../node_modules/@xterm/xterm/lib/xterm.js' : req.url === '/xterm-state-validation.mjs' ? '../src/xterm-state-validation.mjs' : '../src/xterm-state-v1.mjs';
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.end(await readFile(new URL(name, import.meta.url)));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const s = new Screen({ cols: 20, rows: 8 });
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(origin); await page.setContent('<div id="oracle"></div><div id="dest"></div>');
    await page.addScriptTag({ url: origin + '/xterm.js' });
    await page.addStyleTag({ path: fileURLToPath(new URL('../node_modules/@xterm/xterm/css/xterm.css', import.meta.url)) });
    const prefix = '\x1b]4;1;#123456\x07\x1b]10;#abcdef\x07\x1b]2;checkpoint title\x07normal\x1b[?1049h\x1b[2;6r\x1b(0lqk\x1b[38:2::12';
    await s.write(prefix);
    const snapshot = await s.snapshot();
    const result = await page.evaluate(async ({ origin, prefix, snapshot }) => {
      const adapter = await import(origin + '/adapter.mjs');
      const write = (t, v) => new Promise(r => t.write(v, r));
      const options = { cols: 20, rows: 8, scrollback: 2000, allowProposedApi: true };
      const unopened = new Terminal(options); let unopenedError = '';
      try { adapter.hydrateTerminalState(unopened, snapshot); } catch (e) { unopenedError = e.message; } finally { unopened.dispose(); }
      const oracle = new Terminal(options), dest = new Terminal(options);
      oracle.open(document.querySelector('#oracle')); dest.open(document.querySelector('#dest'));
      await write(oracle, prefix);
      let replies = ''; dest.onData(d => replies += d);
      adapter.hydrateTerminalState(dest, snapshot);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const initialDom = { actual: dest.element.querySelector('.xterm-rows').textContent, expected: oracle.element.querySelector('.xterm-rows').textContent };
      const colors = t => [t._core._themeService.colors.ansi[1].css, t._core._themeService.colors.foreground.css];
      const before = { actual: colors(dest), expected: colors(oracle) };
      const suffix = ':34:56mX\x1b[6n\x1bP$qm\x1b\\';
      await write(oracle, suffix); await write(dest, suffix);
      const lines = t => Array.from({ length: t.buffer.active.length }, (_, i) => t.buffer.active.getLine(i).translateToString());
      const result = { initialDom, unopenedError, before, actual: lines(dest), expected: lines(oracle), replies, opened: !!dest.element, rows: document.querySelectorAll('#dest .xterm-rows').length };
      oracle.dispose(); dest.dispose(); return result;
    }, { origin, prefix, snapshot });
    assert.match(result.unopenedError, /OPEN_BEFORE_HYDRATE/);
    assert.deepEqual(result.before.actual, result.before.expected);
    assert.deepEqual(result.actual, result.expected);
    assert.equal(result.replies, '');
    assert.equal(result.initialDom.actual, result.initialDom.expected);
    assert.equal(result.opened, true);
    assert.equal(result.rows, 1);
    let cases = 0;
    for (const vector of vectors) for (let split = 0; split <= vector.length; split++) {
      const host = new Screen({ cols: 20, rows: 8 });
      try {
        host.term.options.windowOptions = { pushTitle: true, popTitle: true };
        await host.write(vector.slice(0, split));
        const snapshot = JSON.parse(JSON.stringify(await host.snapshot()));
        const result = await page.evaluate(async ({ origin, vector, split, snapshot }) => {
          const a = await import(origin + '/adapter.mjs');
          const write = (t, v) => new Promise(r => t.write(v, r));
          const opts = { cols: 20, rows: 8, scrollback: 2000, allowProposedApi: true, windowOptions: { pushTitle: true, popTitle: true } };
          const o = new Terminal(opts), d = new Terminal(opts);
          a.initializeTerminalState(o);
          o.open(document.querySelector('#oracle')); d.open(document.querySelector('#dest'));
          try {
            await write(o, vector.slice(0, split));
            a.hydrateTerminalState(d, snapshot);
            await write(o, vector.slice(split)); await write(d, vector.slice(split));
            o.resize(17, 10); d.resize(17, 10);
            await write(o, '\r\nnext\x1b8!'); await write(d, '\r\nnext\x1b8!');
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            return { actual: a.captureTerminalState(d), expected: a.captureTerminalState(o),
              domActual: d.element.querySelector('.xterm-rows').textContent,
              domExpected: o.element.querySelector('.xterm-rows').textContent };
          } finally { o.dispose(); d.dispose(); }
        }, { origin, vector, split, snapshot });
        assert.deepEqual(result.actual, result.expected, `browser split ${split} of ${JSON.stringify(vector)}`);
        assert.equal(result.domActual, result.domExpected);
        cases++;
      } finally { host.dispose(); }
    }
    console.log(`opened browser continuation cases: ${cases}`);
  } finally { s.dispose(); await browser?.close(); await new Promise(r => server.close(r)); }
});
