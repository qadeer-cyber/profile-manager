// Local Google / reCAPTCHA compatibility diagnostics (no CAPTCHA bypass, no remote upload).
import dns from 'node:dns/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { extensionLaunchPlan, extensionCommandArgs } from './extensions.js';
import { isPackaged } from './testflags.js';
import { getSetting } from './db.js';
import { chromiumIdentity } from './chromium-identity.js';
import { executableCompatibility } from './chromium-lifecycle.js';

const PLAYWRIGHT_INJECTED = Object.freeze([
  '--disable-extensions',
  '--remote-debugging-pipe',
  '--no-sandbox',
  '--enable-automation',
  '--disable-component-update',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--disable-infobars',
]);

export async function dnsDualStack(host = 'google.com') {
  const out = { host, a: [], aaaa: [], errors: [] };
  try { out.a = await dns.resolve4(host); } catch (e) { out.errors.push(`A: ${e.code || e.message}`); }
  try { out.aaaa = await dns.resolve6(host); } catch (e) { out.errors.push(`AAAA: ${e.code || e.message}`); }
  return out;
}

export function launchShapeReport(profileId = null) {
  const executablePath = getSetting('executablePath', '') || '';
  const identity = chromiumIdentity(executablePath && fs.existsSync(executablePath) ? executablePath : '');
  const ext = profileId ? extensionLaunchPlan(profileId) : extensionCommandArgs([]);
  const mitigations = {
    ignoreDisableExtensionsWhenNoExtensions: (ext.ignoreDefaultArgs || []).includes('--disable-extensions'),
    chromiumSandboxOnPackagedWindows: process.platform === 'win32' && isPackaged(),
    packagedBuild: isPackaged(),
  };
  return {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    chromium: {
      ...identity,
      executablePath: executablePath || null,
      compatibility: executablePath ? executableCompatibility(executablePath) : null,
    },
    playwrightInjectedSwitches: PLAYWRIGHT_INJECTED,
    appExtensionPlan: { args: ext.args, ignoreDefaultArgs: ext.ignoreDefaultArgs },
    mitigations,
    classification: {
      unavailableOnHostedCi: ['Physical Latitude 5480', 'Owner direct IPv6 path', 'Google reputation score'],
      unsupportedOnStockChromium: ['Multilogin canvas/WebGL mask', 'Hiding navigator.webdriver', 'Chrome-branded binary unless user installs Chrome separately'],
      knownArchitecturalDeltas: [
        'Chromium for Testing (not Google Chrome)',
        'Playwright control pipe (navigator.webdriver is often true)',
        'Playwright default switch bundle (~40 flags vs ~4 for manual Chromium)',
      ],
    },
  };
}

export async function probeBrowserSignals({ executablePath, timeoutMs = 20000 } = {}) {
  const configured = executablePath || getSetting('executablePath', '') || '';
  const exe = configured && fs.existsSync(configured) ? configured : undefined;
  const probeHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<script>
window.__pmProbe = {
  webdriver: navigator.webdriver,
  userAgent: navigator.userAgent,
  languages: navigator.languages,
  chromePresent: !!window.chrome,
  cookiesEnabled: navigator.cookieEnabled,
};
</script></body></html>`;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-gcompat-'));
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(userData, {
      headless: true,
      executablePath: exe || undefined,
      args: [],
      ignoreDefaultArgs: ['--disable-extensions'],
      chromiumSandbox: process.platform === 'win32' && isPackaged(),
      timeout: timeoutMs,
    });
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.setContent(probeHtml, { timeout: timeoutMs });
    const signals = await page.evaluate(() => window.__pmProbe);
    const recaptchaProbe = await page.evaluate(async () => {
      try {
        const url = 'https://www.gstatic.com/recaptcha/releases/preview/recaptcha__en.js';
        const r = await fetch(url, { mode: 'no-cors' });
        return { gstaticFetch: r.type || 'opaque', ok: true };
      } catch (e) {
        return { gstaticFetch: null, ok: false, error: String(e.message || e) };
      }
    }).catch(e => ({ ok: false, error: String(e.message || e) }));
    return { signals, recaptchaResourceLoad: recaptchaProbe };
  } catch (e) {
    return { error: String(e.message || e).split('\n')[0] };
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

export async function buildGoogleCompatReport({ profileId = null, probe = false } = {}) {
  const base = launchShapeReport(profileId);
  const dns = await dnsDualStack('google.com');
  const report = {
    ...base,
    dns,
    ownerSymptoms: {
      note: 'Endless google.com/sorry on proxy AND direct indicates Google risk scoring plus client-shape deltas; not proof of a single misconfigured fingerprint slider.',
      ipv6OnSorryPage: 'If Google shows an IPv6 starting 2402…, the host has IPv6 connectivity; broken or flagged IPv6 paths are environmental (see dns.aaaa).',
    },
  };
  if (probe) report.probe = await probeBrowserSignals({});
  return report;
}
