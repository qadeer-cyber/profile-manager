import './_isolated-data.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startLocalHttpFixture } from './_local-http-fixture.mjs';
import { startChromiumCdpFixture } from './_chromium-cdp-fixture.mjs';
import { typeHumanTextOverCdp, humanInputReport } from '../server/human-input.js';

test('typeHumanTextOverCdp fills an input on a local fixture page', { timeout: 120000 }, async t => {
  const fixture = await startLocalHttpFixture({ body: '<!doctype html><html><body><input id="t" /></body></html>' });
  t.after(() => fixture.close());
  const { port, endpoint } = await startChromiumCdpFixture(t);
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 10000 });
  t.after(() => browser.close());
  const page = browser.contexts()[0].pages()[0];
  await page.goto(fixture.origin, { waitUntil: 'domcontentloaded' });
  await page.locator('#t').waitFor();
  const result = await typeHumanTextOverCdp(port, 'hello', { wpm: 600, selector: '#t', jitterMs: 0 });
  assert.equal(result.typed, 5);
  assert.equal(await page.inputValue('#t'), 'hello');
});

test('humanInputReport documents Firefox unsupported', () => {
  assert.equal(humanInputReport().firefox.supported, false);
});
