// The verification probe must never open a permission prompt in the user's browser. On real
// Chrome Stable a prompt waits for a person: the probe would hang until its deadline and the whole
// report would become "unavailable" (found by the live Windows test on profile B, defaults).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { observeBrowser } from '../server/hardware.js';
import { fingerprintFindings } from '../server/fingerprint-consistency.js';

test('probe skips prompt-gated calls when permissions are undecided, and grades them as unavailable', { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    // Simulate a real headed Chrome: every permission is "prompt" and the prompt-gated APIs never settle.
    await ctx.addInitScript(() => {
      window.__promptCalls = [];
      const never = name => () => { window.__promptCalls.push(name); return new Promise(() => {}); };
      navigator.permissions.query = async () => ({ state: 'prompt' });
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = never('getUserMedia');
      window.queryLocalFonts = never('queryLocalFonts');
    });
    const started = Date.now();
    const seen = await observeBrowser(ctx, {});
    assert.equal(seen.availability, 'observed', `probe completed (${seen.reason || ''})`);
    assert.ok(Date.now() - started < 30000, 'well inside the 35 s deadline');
    assert.deepEqual([seen.mediaCapture.reason, seen.fontsQuery.reason], ['permission_not_decided', 'permission_not_decided']);

    const report = fingerprintFindings({ advanced: { fingerprint: { fonts: 'restricted', mediaDevices: 'restricted' } }, browserSettings: {}, webrtc: { mode: 'browser_default' },
      observation: seen, commandLine: 'chrome', chromiumVersion: '1.0.0.0', hostPlatform: process.platform, hostTimezone: 'UTC' });
    const byId = id => report.findings.find(item => item.id === id);
    assert.equal(byId('fonts_query_api').status, 'unavailable', 'not graded as pass without a call');
    assert.match(byId('fonts_query_api').summary, /permission prompt/);
    assert.equal(byId('media_capture').status, 'unavailable');
    assert.match(byId('media_capture').summary, /prompt/);
  } finally { await browser.close(); }
});

test('probe still exercises the APIs once the permission is decided', { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      navigator.permissions.query = async () => ({ state: 'denied' });
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); };
      window.queryLocalFonts = async () => { throw new DOMException('denied', 'NotAllowedError'); };
    });
    const seen = await observeBrowser(ctx, {});
    assert.equal(seen.availability, 'observed');
    assert.deepEqual([seen.mediaCapture.availability, seen.mediaCapture.errorName], ['observed', 'NotAllowedError']);
    assert.deepEqual([seen.fontsQuery.availability, seen.fontsQuery.resolved, seen.fontsQuery.errorName], ['observed', false, 'NotAllowedError']);
  } finally { await browser.close(); }
});
