// Real Chromium protocol regressions. No mocks or conditional skips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { installRegionalLocale } from '../server/regional-locale.js';

const snapshot = () => ({
  locale: Intl.DateTimeFormat().resolvedOptions().locale,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  language: navigator.language, languages: [...navigator.languages],
});
test('native locale is configured before scripts across pages and popups', { timeout: 30000 }, async () => {
  const echo = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<script>window.first = (' + snapshot.toString() + ')()</script><pre>' + JSON.stringify(req.headers['accept-language']) + '</pre>');
  });
  await new Promise(r => echo.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + echo.address().port;
  let browser, other;
  const failures = [];
  try {
    browser = await chromium.launch({ headless: true, args: ['--enable-automation', '--accept-lang=fr-FR,de-DE'] });
    const context = await browser.newContext({ timezoneId: 'Asia/Karachi' });
    await installRegionalLocale(context, 'fr-FR', { onFailure: e => failures.push(e) });
    const check = async page => {
      await page.waitForFunction(() => window.first);
      assert.deepEqual(await page.evaluate(() => window.first), { locale: 'fr-FR', timezone: 'Asia/Karachi', language: 'fr-FR', languages: ['fr-FR', 'de-DE'] });
      assert.match(await page.locator('pre').textContent(), /fr-FR.*de-DE/);
    };
    const page = await context.newPage(); await page.goto(url); await check(page);
    const popupEvent = context.waitForEvent('page');
    await page.evaluate(url => { window.open(url); }, url);
    const popup = await popupEvent; await check(popup);
    await page.close();
    assert.equal(await popup.evaluate(() => Intl.DateTimeFormat().resolvedOptions().locale), 'fr-FR');
    await popup.reload(); await check(popup);
    for (let i = 0; i < 3; i++) {
      const p = await context.newPage(); await p.goto(url); await check(p); await p.close();
    }
    // Reproduce ownership handover repeatedly; an eventual wait would hide the
    // page-close race, so every first observation must already be correct.
    for (let i = 0; i < 5; i++) {
      const opener = await context.newPage(); await opener.goto(url);
      const opened = context.waitForEvent('page');
      await opener.evaluate(url => { window.open(url); }, url);
      const child = await opened; await check(child);
      await opener.close();
      assert.equal(await child.evaluate(() => Intl.DateTimeFormat().resolvedOptions().locale), 'fr-FR');
      await child.reload(); await check(child); await child.close();
    }
    // Independent browser ICU state cannot change the first browser's locale.
    other = await chromium.launch({ headless: true, args: ['--accept-lang=en-US,ur-PK'] });
    const second = await other.newContext({ timezoneId: 'America/New_York' });
    await installRegionalLocale(second, 'en-US', { onFailure: e => failures.push(e) });
    const secondPage = await second.newPage(); await secondPage.goto(url);
    assert.deepEqual(await secondPage.evaluate(() => window.first), { locale: 'en-US', timezone: 'America/New_York', language: 'en-US', languages: ['en-US', 'ur-PK'] });
    await popup.reload(); await check(popup);
    const cdp = await browser.newBrowserCDPSession();
    const { arguments: args } = await cdp.send('Browser.getBrowserCommandLine');
    assert.ok(args.includes('--remote-debugging-pipe'));
    assert.ok(!args.some(a => a.startsWith('--remote-debugging-port')));
    await cdp.detach();
  } finally {
    await other?.close(); await browser?.close();
    await new Promise(r => echo.close(r));
  }
  assert.deepEqual(failures, [], 'normal page/browser close must not invent a regional failure');
});
