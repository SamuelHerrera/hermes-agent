#!/usr/bin/env node
// Local emulation: node scripts/browser-mobile-zoom-smoke.mjs <desktop URL>
// Existing physical Chrome: add its forwarded CDP endpoint as argument three.
import assert from 'node:assert/strict';
import { chromium, devices } from '@playwright/test';

const [url, endpoint] = process.argv.slice(2);
assert.ok(url, 'Pass the Desktop URL');
const browser = endpoint
  ? await chromium.connectOverCDP(endpoint)
  : await chromium.launch({ channel: 'chrome' });
try {
  const page = endpoint
    ? browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith(url))
    : await browser.newPage({ ...devices['Pixel 7'] });
  assert.ok(page, 'Existing phone Desktop tab not found');
  if (!endpoint) await page.goto(url);
  const session = await page.context().newCDPSession(page);
  const before = await page.evaluate(() => visualViewport.scale);
  for (const scaleFactor of [1.5, 0.7]) {
    await session.send('Input.synthesizePinchGesture', { x: 200, y: 300, scaleFactor, gestureSourceType: 'touch' });
    const after = await page.evaluate(() => visualViewport.scale);
    assert.ok(Math.abs(after - before) < 0.01, `Pinch changed viewport scale: ${before} -> ${after}`);
  }
  const touchAction = await page.evaluate(() => getComputedStyle(document.documentElement).touchAction);
  assert.equal(touchAction, 'pan-x pan-y', 'One-finger scrolling must remain allowed');
  await session.detach();
  console.log(JSON.stringify({ result: 'PASS', device: endpoint ? 'physical Android' : 'Pixel 7 emulation', scale: before, touchAction }));
} finally {
  if (!endpoint) await browser.close();
}
// Do not close the users existing Chrome tabs/device browser.
process.exit(0);
