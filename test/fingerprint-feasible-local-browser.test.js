// Real CfT observables for feasible-local M21 (deny), M23 (reduced UA), M30 (process argv / port_scan_policy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
import { spawnServer, stopServer } from './_ports.mjs';
import { withBrowserTestEnv, chromiumAvailableForTests } from './_browser-env.mjs';
import { fingerprintFindings } from '../server/fingerprint-consistency.js';
import { privateNetworkWeakening } from '../server/fingerprint-settings.js';
import { processCommandLine } from '../server/proc.js';
import { MANIFEST } from '../server/chromium.js';

test('M21 M23 M30 stock-feasible browser observables', { timeout: 180000, skip: chromiumAvailableForTests() ? false : 'Chromium not installed for browser tests' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-feasible-local-'));
  const env = withBrowserTestEnv({ PM_DATA_DIR: dir, PM_API_TOKEN: 'feasible-local' });
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><title>feasible</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const pageUrl = `http://127.0.0.1:${server.address().port}/`;
  let proc;
  const auth = { Authorization: 'Bearer feasible-local', 'Content-Type': 'application/json' };
  const api = async (method, url, body) => {
    const response = await fetch(`${proc.url}/api/v1${url}`, {
      method,
      headers: auth,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = await response.json().catch(() => ({}));
    assert.equal(response.ok, true, `${method} ${url}: ${JSON.stringify(value)}`);
    return value;
  };
  async function withPage(id, fn) {
    const launched = await api('POST', `/profiles/${id}/launch`, { headless: true, automation: true, url: pageUrl });
    const browser = await chromium.connectOverCDP(launched.cdp.httpEndpoint);
    try {
      const page = browser.contexts()[0].pages()[0];
      await fn(page);
    } finally {
      await browser.close().catch(() => {});
    }
  }
  try {
    proc = await spawnServer(env);
    await fetch(`${proc.url}/api/settings`, { method: 'PUT', headers: auth, body: JSON.stringify({ minFreeMemoryGiB: 0, maxRunningProfiles: 6 }) });

    const denyId = (await api('POST', '/profiles', {
      name: 'Geo deny feasible',
      advancedSettings: { geolocation: { permission: 'deny' } },
    })).id;
    await withPage(denyId, async page => {
      assert.equal(await page.evaluate(async () => (await navigator.permissions.query({ name: 'geolocation' })).state), 'denied');
    });
    await api('POST', `/profiles/${denyId}/stop`, {});

    const version = MANIFEST.browserVersion;
    const major = `${version.split('.')[0]}.0.0.0`;
    const uaId = (await api('POST', '/profiles', {
      name: 'Reduced UA',
      advancedSettings: { userAgent: { mode: 'reduced' } },
    })).id;
    await withPage(uaId, async page => {
      const facts = await page.evaluate(async () => {
        let full = '';
        let chromium = '';
        try {
          const high = await navigator.userAgentData.getHighEntropyValues(['uaFullVersion', 'fullVersionList']);
          full = high.uaFullVersion || '';
          chromium = high.fullVersionList.find(item => item.brand === 'Chromium')?.version || '';
        } catch { /* auxiliary CDP clients may not see hints on every host */ }
        return { ua: navigator.userAgent, full, chromium };
      });
      assert.match(facts.ua, /HeadlessChrome\/\d+\.0\.0\.0/);
      assert.equal(facts.ua.includes(version), false);
      assert.ok(facts.ua.includes(major));
      if (facts.full) {
        assert.equal(facts.full, version);
        assert.equal(facts.chromium, version);
      }
      const resources = await api('GET', '/resources');
      const pid = resources.browsers.profiles.find(row => row.id === uaId)?.pid;
      const commandLine = pid ? await processCommandLine(pid) : '';
      assert.match(commandLine, /HeadlessChrome\/\d+\.0\.0\.0/);
      assert.equal(commandLine.includes(version), false);
    });
    await api('POST', `/profiles/${uaId}/stop`, {});

    const pnaId = (await api('POST', '/profiles', {
      name: 'PNA policy',
      advancedSettings: { fingerprint: { portScan: 'real' } },
    })).id;
    await withPage(pnaId, async () => {
      const resources = await api('GET', '/resources');
      const pid = resources.browsers.profiles.find(row => row.id === pnaId)?.pid;
      assert.ok(pid, 'expected browser pid from /resources');
      const commandLine = await processCommandLine(pid);
      assert.ok(commandLine && commandLine.includes('chrome'), commandLine);
      assert.equal(privateNetworkWeakening(commandLine).features.length, 0);
      const report = fingerprintFindings({
        advanced: { fingerprint: { portScan: 'real' } },
        commandLine,
        chromiumVersion: version,
        observation: null,
      });
      const portPolicy = report.findings.find(item => item.id === 'port_scan_policy');
      const portMask = report.findings.find(item => item.id === 'port_scan_mask');
      assert.equal(portPolicy.status, 'pass');
      assert.equal(portMask.status, 'unsupported');
    });
    await api('POST', `/profiles/${pnaId}/stop`, {});
  } finally {
    if (proc) await stopServer(proc).catch(() => {});
    await new Promise(resolve => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
