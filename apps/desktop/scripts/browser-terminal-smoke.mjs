#!/usr/bin/env node
// Real browser + backend PTY regression. Optional third argument intercepts
// only /desktop/ static assets from an isolated build (never deploys them).
// node scripts/browser-terminal-smoke.mjs http://127.0.0.1:9119/desktop/ /tmp/browser-build
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium, devices, expect } from '@playwright/test';

const url = process.argv[2];
const dist = process.argv[3];
assert.ok(url, 'Pass the authenticated browser Desktop URL');
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ ...devices['Pixel 7'] });
const errors = [];
let terminalId;
page.on('pageerror', error => errors.push(error.message));
if (dist) await page.route('**/desktop/**', async route => {
  const path = new URL(route.request().url()).pathname.replace(/^.*\/desktop\//, '') || 'index.html';
  assert.ok(!path.includes('..'));
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
  await route.fulfill({ body: await readFile(join(dist, path)), contentType: mime[extname(path)] || 'application/octet-stream' });
});
// Observe the actual audited UMD xterm instance, not a mocked PTY/display.
await page.addInitScript(() => {
  let constructor;
  Object.defineProperty(window, 'Terminal', {
    configurable: true,
    get: () => constructor,
    set: Terminal => {
      constructor = Terminal;
      const open = Terminal.prototype.open;
      Terminal.prototype.open = function (...args) {
        (window.__terminalSmokeInstances ??= []).push(this);
        return open.apply(this, args);
      };
    }
  });
});
const bufferText = () => page.evaluate(() => {
  const term = window.__terminalSmokeInstances?.at(-1);
  return term ? Array.from({ length: term.buffer.active.length }, (_, i) => term.buffer.active.getLine(i)?.translateToString(true)).join('\n') : '';
});
try {
  await page.goto(url);
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  const host = page.locator('[data-persistent-terminal][aria-hidden="false"]').last();
  terminalId = await host.getAttribute('data-persistent-terminal');
  await expect(host.locator('.xterm')).toBeVisible({ timeout: 30_000 });
  // xterm mounts before its PTY attaches. Wait for real shell output before input.
  await expect.poll(bufferText, { timeout: 20_000 }).toMatch(/[%$#>] /);
  await host.locator('textarea').focus();
  await page.keyboard.type('printf "MOBILE_PAINT_%s\\n" "VERIFIED"');
  await page.keyboard.press('Enter');
  await expect.poll(bufferText, { timeout: 20_000 }).toContain('MOBILE_PAINT_VERIFIED');
  // Buffer/WS success alone missed this bug: assert pixels actually painted.
  const screenshot = await host.screenshot({ path: '/tmp/hermes-mobile-terminal-smoke.png' });
  const brightPixels = await page.evaluate(async data => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let bright = 0;
    for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 100) bright++;
    return bright;
  }, screenshot.toString('base64'));
  // A Pixel 7 block cursor alone occupies fewer than 1,000 physical pixels;
  // demand enough painted foreground for the actual prompt/command/output.
  assert.ok(brightPixels > 2000, `Real PTY output reached xterm but the mobile terminal painted only ${brightPixels} bright pixels`);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', viewport: 'Pixel 7 / Chrome emulation', realPtyOutput: 'MOBILE_PAINT_VERIFIED', brightPixels, screenshot: '/tmp/hermes-mobile-terminal-smoke.png' }));
} finally {
  // Close this exact test tab through the real UI; the owner handles auth and
  // termination. Never reuse a potentially one-time WS ticket for cleanup.
  try {
    if (terminalId) await page.locator(`[data-tree-tab="terminal-instance:${terminalId}"]`).getByRole('button', { name: 'Close', exact: true }).click();
  } finally { await browser.close(); }
}
