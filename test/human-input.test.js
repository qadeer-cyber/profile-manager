import './_isolated-data.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startLocalHttpFixture } from './_local-http-fixture.mjs';
import { startChromiumCdpFixture } from './_chromium-cdp-fixture.mjs';
import { typeHumanTextOverCdp, humanInputReport } from '../server/human-input.js';

async function typeOnFixture(t, text) {
  const fixture = await startLocalHttpFixture({ body: '<!doctype html><html><body><input id="t" /></body></html>' });
  t.after(() => fixture.close());
  const { port, endpoint } = await startChromiumCdpFixture(t);
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 10000 });
  t.after(() => browser.close());
  const page = browser.contexts()[0].pages()[0];
  await page.goto(fixture.origin, { waitUntil: 'domcontentloaded' });
  await page.locator('#t').waitFor();
  const result = await typeHumanTextOverCdp(port, text, { wpm: 600, selector: '#t', jitterMs: 0, deterministic: true });
  assert.equal(await page.inputValue('#t'), text);
  return result;
}

test('typeHumanTextOverCdp fills an input on a local fixture page', { timeout: 120000 }, async t => {
  const result = await typeOnFixture(t, 'hello');
  assert.equal(result.typed, 5);
  assert.equal(result.deterministic, true);
});

test('typeHumanTextOverCdp types Unicode into input', { timeout: 120000 }, async t => {
  const result = await typeOnFixture(t, 'café');
  assert.equal(result.typed, 4);
});

test('humanInputReport documents Firefox geckodriver path', () => {
  const report = humanInputReport();
  assert.equal(report.firefox.supported, true);
  assert.equal(report.firefox.transport, 'geckodriver');
  assert.equal(report.firefox.timingMeasured, false);
});

test('typeHumanTextOverCdp measures inter-key intervals', { timeout: 120000 }, async t => {
  const fixture = await startLocalHttpFixture({ body: '<!doctype html><html><body><input id="t" /></body></html>' });
  t.after(() => fixture.close());
  const { port, endpoint } = await startChromiumCdpFixture(t);
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 10000 });
  t.after(() => browser.close());
  const page = browser.contexts()[0].pages()[0];
  await page.goto(fixture.origin, { waitUntil: 'domcontentloaded' });
  await page.locator('#t').waitFor();
  const result = await typeHumanTextOverCdp(port, 'hi.', { wpm: 120, selector: '#t', deterministic: true });
  assert.equal(await page.inputValue('#t'), 'hi.');
  assert.equal(result.timingMeasured, true);
  assert.equal(result.timingModel, 'interkey-wpm-v1');
  assert.equal(result.scheduleMs.length, 3);
  assert.equal(result.measuredIntervalsMs.length, 3);
  for (let i = 0; i < result.scheduleMs.length; i += 1) {
    assert.ok(result.measuredIntervalsMs[i] >= result.scheduleMs[i] - 25, `interval ${i} measured ${result.measuredIntervalsMs[i]} planned ${result.scheduleMs[i]}`);
  }
  assert.ok(result.scheduleMs[2] > result.scheduleMs[0]);
});
