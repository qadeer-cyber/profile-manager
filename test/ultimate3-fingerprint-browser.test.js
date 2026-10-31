// Live Chromium (and Firefox when installed) evidence for Ultimate 3.0 M20–M23, M28–M30.
// Headless Linux is not a Windows qualification and not an undetectability claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { spawnServer, stopServer } from './_ports.mjs';
import { withBrowserTestEnv, chromiumAvailableForTests } from './_browser-env.mjs';
import { connectMarionette } from './_marionette-client.mjs';
import { MANIFEST, expectedExecutable } from '../server/chromium.js';
import { validateBrowserSettings } from '../server/browser-settings.js';
import { validateAdvancedSettings } from '../server/advanced-settings.js';
import { advancedLaunchPlan, applyAdvancedPreferences } from '../server/advanced-launch.js';
import { assertPrivateNetworkLaunchPolicy, privateNetworkWeakening } from '../server/fingerprint-settings.js';
import { processCommandLine } from '../server/proc.js';
import { resolveFirefoxExecutable, firefoxProcessEnv } from '../server/browser-runtime/firefox-launch.js';
import { buildManagedGeckoPrefLines, writeManagedGeckoUserJs } from '../server/firefox-gecko-userjs.js';
import { languageListMatchesStock, timezoneOffsetMinutes, assessAcceptLanguage } from '../server/regional-consistency.js';
import { classifyLocalNetworkProbe, probeOutcomeChanged } from '../server/local-network-probe.js';
import {
  ROW_CONTRACTS,
  ULTIMATE3_CONTRACT_VERSION,
  decideRelease,
  featureCompletion,
  stockChecksFor,
} from '../server/ultimate3-acceptance.js';

const skip = chromiumAvailableForTests() ? false : 'Chromium not installed for browser tests';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function readSurface(page) {
  return page.evaluate(async () => {
    const permissions = {};
    for (const name of ['geolocation', 'local-fonts', 'local-network-access', 'camera', 'microphone']) {
      try { permissions[name] = (await navigator.permissions.query({ name })).state; }
      catch (error) { permissions[name] = `query_error:${error.name || 'Error'}`; }
    }
    const geo = await new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy }),
        error => resolve({ code: error.code }),
        { timeout: 4000 },
      );
    });
    let mediaError = 'missing';
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        stream.getTracks().forEach(track => track.stop());
        mediaError = 'granted';
      } catch (error) { mediaError = error.name || 'Error'; }
    }
    let devices = { count: 0, labeled: 0, error: '' };
    if (navigator.mediaDevices?.enumerateDevices) {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        devices = { count: list.length, labeled: list.filter(device => device.label).length, error: '' };
      } catch (error) { devices = { count: 0, labeled: 0, error: error.name || 'Error' }; }
    }
    let localFonts = { api: 'missing' };
    if (typeof window.queryLocalFonts === 'function') {
      try {
        const fonts = await window.queryLocalFonts();
        localFonts = { api: 'resolved', count: fonts.length };
      } catch (error) { localFonts = { api: 'rejected', name: error.name }; }
    }
    let hints = { mobile: null, platform: '', full: '', brands: [], chromium: '' };
    if (navigator.userAgentData) {
      hints.mobile = navigator.userAgentData.mobile === true;
      hints.brands = (navigator.userAgentData.brands || []).map(item => item.brand);
      try {
        const high = await navigator.userAgentData.getHighEntropyValues(['uaFullVersion', 'fullVersionList', 'platform']);
        hints.full = high.uaFullVersion || '';
        hints.platform = high.platform || '';
        hints.chromium = (high.fullVersionList || []).find(item => item.brand === 'Chromium')?.version || '';
      } catch { /* hints stay partial */ }
    }
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const fontWidth = context ? context.measureText('mmmmmmmmmm').width : 0;
    const intl = Intl.DateTimeFormat().resolvedOptions();
    return {
      language: navigator.language,
      languages: [...navigator.languages],
      timeZone: intl.timeZone,
      intlLocale: intl.locale,
      offset: new Date().getTimezoneOffset(),
      geo,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      scale: window.devicePixelRatio,
      permissions,
      mediaError,
      devices,
      localFonts,
      hints,
      ua: navigator.userAgent,
      fontWidth,
    };
  });
}

async function localNetworkProbe({ executablePath, deny }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), deny ? 'pm-u3-pna-deny-' : 'pm-u3-pna-open-'));
  const target = http.createServer((req, res) => { res.end('local-ok'); });
  const pageServer = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><title>pna</title>');
  });
  const targetPort = await listen(target);
  const pagePort = await listen(pageServer);
  let browser;
  try {
    const settings = validateAdvancedSettings(deny ? { fingerprint: { portScan: 'real' } } : {});
    if (deny) applyAdvancedPreferences(dir, settings);
    const plan = advancedLaunchPlan(settings, { headless: true, version: MANIFEST.browserVersion });
    assertPrivateNetworkLaunchPolicy(plan.args);
    browser = await chromium.launchPersistentContext(dir, {
      executablePath,
      headless: true,
      viewport: { width: 800, height: 600 },
      args: [...plan.args, `--ip-address-space-overrides=127.0.0.1:${pagePort}=public`],
    });
    const page = browser.pages()[0] || await browser.newPage();
    await page.goto(`http://127.0.0.1:${pagePort}/`, { waitUntil: 'domcontentloaded' });
    const observed = await page.evaluate(async port => {
      let permissionState = 'unknown';
      try { permissionState = (await navigator.permissions.query({ name: 'local-network-access' })).state; }
      catch (error) { permissionState = `query_error:${error.name || 'Error'}`; }
      let fetchOk = false;
      let errorName = '';
      try {
        await fetch(`http://127.0.0.1:${port}/probe`, { cache: 'no-store' });
        fetchOk = true;
        errorName = 'ok';
      } catch (error) {
        fetchOk = false;
        errorName = error.name || 'Error';
      }
      return { permissionState, fetchOk, errorName };
    }, targetPort);
    return { ...observed, classified: classifyLocalNetworkProbe(observed) };
  } finally {
    await browser?.close().catch(() => {});
    await new Promise(resolve => target.close(() => resolve()));
    await new Promise(resolve => pageServer.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function observeFirefox(regional) {
  const executablePath = process.env.PM_FIREFOX_EXECUTABLE || resolveFirefoxExecutable() || '';
  if (!executablePath || !fs.existsSync(executablePath)) return { availability: 'not_run', reason: 'firefox_missing' };
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-u3-ff-'));
  const marionettePort = await new Promise((resolve, reject) => {
    const socket = http.createServer();
    socket.listen(0, '127.0.0.1', () => {
      const chosen = socket.address().port;
      socket.close(() => resolve(chosen));
    });
    socket.on('error', reject);
  });
  const managed = buildManagedGeckoPrefLines({ regional });
  managed.push(`user_pref("marionette.port", ${marionettePort});`);
  managed.push('user_pref("browser.shell.checkDefaultBrowser", false);');
  writeManagedGeckoUserJs(profileDir, managed);
  const plan = {
    executablePath,
    profileDir,
    timezoneId: regional.timezoneId,
    marionettePort,
    args: ['--headless', '-no-remote', '-profile', profileDir, '-marionette'],
  };
  const env = { ...firefoxProcessEnv(plan), MOZ_DISABLE_CONTENT_SANDBOX: '1' };
  const proc = spawn(executablePath, plan.args, { env, stdio: 'ignore' });
  let client;
  try {
    client = await connectMarionette(marionettePort, 20000);
    await client.command('WebDriver:NewSession', {
      capabilities: { alwaysMatch: { browserName: 'firefox', acceptInsecureCerts: true } },
    });
    await client.command('Marionette:SetContext', { value: 'content' });
    await client.command('WebDriver:Navigate', { url: 'about:blank' });
    const payload = await client.command('WebDriver:ExecuteScript', {
      script: 'return { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, timezoneOffset: new Date().getTimezoneOffset(), locale: navigator.language, languages: Array.from(navigator.languages || []), intlLocale: Intl.DateTimeFormat().resolvedOptions().locale }',
      args: [],
    });
    await client.command('Marionette:Quit').catch(() => {});
    return { availability: 'observed', ...(payload?.value || payload || {}) };
  } finally {
    client?.close();
    if (proc.exitCode == null) {
      try { process.kill(proc.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

test('Ultimate 3 fingerprint surfaces match the profile in a live browser', { timeout: 300000, skip }, async () => {
  const results = {
    'm21-native-coordinates': 'blocked',
    'm23-arbitrary-version': 'blocked',
    'm28-substitute-font-list': 'blocked',
    'm29-fake-device-labels': 'blocked',
  };
  const details = {};
  const record = (id, ok, detail) => {
    results[id] = ok ? 'pass' : 'fail';
    if (detail !== undefined) details[id] = detail;
    return ok;
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-u3-browser-'));
  const seenHeaders = [];
  const pageServer = http.createServer((req, res) => {
    if (req.headers['accept-language']) seenHeaders.push(String(req.headers['accept-language']));
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><title>ultimate3</title>');
  });
  const pagePort = await listen(pageServer);
  const pageUrl = `http://127.0.0.1:${pagePort}/`;
  const env = withBrowserTestEnv({
    PM_DATA_DIR: dir,
    PM_API_TOKEN: 'u3-fp',
    PM_FIREFOX_EXECUTABLE: process.env.PM_FIREFOX_EXECUTABLE || '',
  });
  let proc;
  const browsers = [];
  const auth = { Authorization: 'Bearer u3-fp', 'Content-Type': 'application/json' };
  const api = async (method, url, body) => {
    const response = await fetch(`${proc.url}/api/v1${url}`, {
      method,
      headers: auth,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = await response.json().catch(() => ({}));
    assert.equal(response.ok, true, `${method} ${url} ${response.status} ${JSON.stringify(value)}`);
    return value;
  };
  async function open(id) {
    const launched = await api('POST', `/profiles/${id}/launch`, { headless: true, automation: true, url: pageUrl });
    const browser = await chromium.connectOverCDP(launched.cdp.httpEndpoint);
    browsers.push(browser);
    const page = browser.contexts()[0].pages()[0];
    if (!page.url().startsWith(pageUrl)) await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    return page;
  }
  async function closeSession(id) {
    await Promise.all(browsers.splice(0).map(browser => browser.close().catch(() => {})));
    await api('POST', `/profiles/${id}/stop`, {});
  }
  try {
    proc = await spawnServer(env);
    await fetch(`${proc.url}/api/settings`, {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ minFreeMemoryGiB: 0, maxRunningProfiles: 4 }),
    });
    const version = MANIFEST.browserVersion;
    const major = `${version.split('.')[0]}.0.0.0`;
    const berlinOffset = timezoneOffsetMinutes('Europe/Berlin');
    const tokyoOffset = timezoneOffsetMinutes('Asia/Tokyo');
    const screenPlan = advancedLaunchPlan(validateAdvancedSettings({
      screen: { preset: '1280x800', deviceScaleFactor: 2 },
    }), { headless: true, version });
    record('m22-launch-plan', screenPlan.args.includes('--window-size=1280,800') && screenPlan.args.includes('--force-device-scale-factor=2') && screenPlan.launch.viewport.width === 1280 && screenPlan.launch.deviceScaleFactor === 2);
    record('m30-refuse-weakening-flags', (() => {
      try { assertPrivateNetworkLaunchPolicy(['--disable-features=LocalNetworkAccessChecks']); return false; }
      catch { return assertPrivateNetworkLaunchPolicy(screenPlan.args).features.length === 0; }
    })());
    record('m30-masked-mode-rejected', (() => { try { validateAdvancedSettings({ fingerprint: { portScan: 'masked' } }); return false; } catch { return true; } })());
    record('m29-allow-capture-rejected', (() => {
      try {
        validateAdvancedSettings({ fingerprint: { mediaDevices: 'restricted' }, preferences: { permissions: { camera: 'allow' } } });
        return false;
      } catch { return true; }
    })());
    record('m23-custom-ua-rejected', (() => { try { validateAdvancedSettings({ userAgent: { mode: 'custom' } }); return false; } catch { return true; } })());
    assert.ok(record('m20-config-locale-language', (() => {
      try {
        validateBrowserSettings({ locale: 'de-DE', timezoneId: 'Europe/Berlin', languages: ['en-US'] });
        return false;
      } catch (error) { return error.code === 'INVALID_BROWSER_SETTINGS'; }
    })()));

    const berlin = await api('POST', '/profiles', {
      name: 'Berlin',
      automationEnabled: true,
      browserSettings: { locale: 'de-DE', timezoneId: 'Europe/Berlin', languages: ['de-DE', 'en-US'] },
      advancedSettings: {
        userAgent: { mode: 'full' },
        screen: { preset: '1280x800', deviceScaleFactor: 2 },
        geolocation: { permission: 'allow', latitude: 52.52, longitude: 13.405, accuracy: 30 },
        fingerprint: { fonts: 'restricted', mediaDevices: 'restricted', portScan: 'real' },
      },
    });
    let page = await open(berlin.id);
    const first = await readSurface(page);
    const accept = seenHeaders[0] || '';
    details['m20-observed'] = {
      timeZone: first.timeZone,
      offset: first.offset,
      expectedOffset: berlinOffset,
      language: first.language,
      languages: first.languages,
      intlLocale: first.intlLocale,
      accept,
      screen: [first.screenWidth, first.screenHeight, first.innerWidth, first.innerHeight, first.scale],
    };
    assert.ok(record('m20-chromium-timezone-id', first.timeZone === 'Europe/Berlin', first.timeZone));
    assert.ok(record('m20-chromium-timezone-offset', first.offset === berlinOffset, `${first.offset} != ${berlinOffset}`));
    assert.ok(record('m20-chromium-locale', first.language === 'de-DE', first.language));
    assert.ok(record('m20-chromium-languages', languageListMatchesStock(['de-DE', 'en-US'], first.languages), first.languages.join(',')));
    assert.ok(record('m20-chromium-intl-locale', first.intlLocale === 'de-DE', first.intlLocale));
    assert.ok(record('m20-chromium-accept-language', assessAcceptLanguage(accept, ['de-DE', 'en-US']).status === 'pass', accept));
    assert.ok(record('m21-allow-coordinates', first.geo.lat === 52.52 && first.geo.lon === 13.405 && first.geo.acc === 30, JSON.stringify(first.geo)));
    assert.ok(record('m22-inner-size', first.innerWidth === 1280 && first.innerHeight === 800, `${first.innerWidth}x${first.innerHeight}`));
    assert.ok(record('m22-screen-size', first.screenWidth === 1280 && first.screenHeight === 800, `${first.screenWidth}x${first.screenHeight}`));
    assert.ok(record('m22-device-scale', first.scale === 2, String(first.scale)));
    assert.ok(record('m23-pinned-full', first.ua.includes(version), first.ua));
    const hintsOk = first.hints.full === version && first.hints.chromium === version && first.hints.mobile === false && first.hints.platform === 'Linux' && first.hints.brands.includes('Chromium');
    details['m23-hints-full'] = first.hints;
    assert.ok(record('m23-client-hints-match-binary', hintsOk, JSON.stringify(first.hints)));
    const fontsOk = first.localFonts.api === 'missing' || first.localFonts.api === 'rejected';
    const fontPermissionOk = first.permissions['local-fonts'] !== 'granted';
    assert.ok(record('m28-permission-or-api-absent', fontPermissionOk, first.permissions['local-fonts']));
    assert.ok(record('m28-query-local-fonts-unavailable', fontsOk, JSON.stringify(first.localFonts)));
    assert.ok(record('m28-canvas-measure-still-real', first.fontWidth > 0, String(first.fontWidth)));
    assert.ok(record('m29-camera-mic-denied', first.permissions.camera === 'denied' && first.permissions.microphone === 'denied', JSON.stringify(first.permissions)));
    assert.ok(record('m29-capture-not-granted', first.mediaError !== 'granted', first.mediaError));
    assert.ok(record('m29-labels-hidden-when-denied', first.devices.labeled === 0, JSON.stringify(first.devices)));
    assert.ok(record('m30-permission-denied', first.permissions['local-network-access'] === 'denied', first.permissions['local-network-access']));
    const resources = await api('GET', '/resources');
    const pid = resources.browsers?.profiles?.find(row => row.id === berlin.id)?.pid;
    assert.ok(pid, 'browser pid');
    const commandLine = await processCommandLine(pid);
    details['m30-command'] = privateNetworkWeakening(commandLine);
    assert.ok(record('m28-launch-flag', commandLine.includes('FontAccess'), commandLine.slice(0, 400)));
    assert.ok(record('m28-preference-persisted', (() => {
      const prefs = JSON.parse(fs.readFileSync(path.join(dir, 'profiles', berlin.id, 'Default', 'Preferences'), 'utf8'));
      return prefs.profile.default_content_setting_values.local_fonts === 2
        && prefs.intl.accept_languages === 'de-DE,en-US';
    })()));
    assert.ok(record('m30-process-has-no-weakening', privateNetworkWeakening(commandLine).features.length === 0));
    await closeSession(berlin.id);

    page = await open(berlin.id);
    const again = await readSurface(page);
    assert.ok(record('m21-persist-restart', again.geo.lat === 52.52 && again.geo.lon === 13.405 && again.timeZone === 'Europe/Berlin', JSON.stringify({ geo: again.geo, timeZone: again.timeZone })));
    await closeSession(berlin.id);

    const tokyo = await api('POST', '/profiles', {
      name: 'Tokyo',
      automationEnabled: true,
      browserSettings: { locale: 'ja-JP', timezoneId: 'Asia/Tokyo', languages: ['ja-JP'] },
      advancedSettings: {
        geolocation: { permission: 'allow', latitude: 35.6762, longitude: 139.6503, accuracy: 40 },
      },
    });
    page = await open(tokyo.id);
    const isolated = await readSurface(page);
    assert.ok(record('m20-chromium-isolation', isolated.timeZone === 'Asia/Tokyo' && isolated.offset === tokyoOffset && isolated.language === 'ja-JP', JSON.stringify({ timeZone: isolated.timeZone, offset: isolated.offset, language: isolated.language })));
    assert.ok(record('m21-isolation', isolated.geo.lat === 35.6762 && isolated.geo.lon === 139.6503 && isolated.geo.lat !== 52.52, JSON.stringify(isolated.geo)));
    await closeSession(tokyo.id);

    const denied = await api('POST', '/profiles', {
      name: 'Geo deny',
      advancedSettings: { geolocation: { permission: 'deny' } },
    });
    page = await open(denied.id);
    const deniedGeo = await readSurface(page);
    assert.ok(record('m21-deny', deniedGeo.geo.code === 1, JSON.stringify(deniedGeo.geo)));
    await closeSession(denied.id);

    const reduced = await api('POST', '/profiles', {
      name: 'Reduced UA',
      browserSettings: { locale: 'en-US', timezoneId: 'UTC', languages: ['en-US'] },
      advancedSettings: { userAgent: { mode: 'reduced' } },
    });
    page = await open(reduced.id);
    const reducedSurface = await readSurface(page);
    details['m23-reduced'] = { ua: reducedSurface.ua, hints: reducedSurface.hints };
    assert.ok(record('m23-pinned-reduced', reducedSurface.ua.includes(major) && !reducedSurface.ua.includes(version) && reducedSurface.hints.full === version, reducedSurface.ua));
    await closeSession(reduced.id);

    const executablePath = expectedExecutable('chromium');
    const treatment = await localNetworkProbe({ executablePath, deny: true });
    const control = await localNetworkProbe({ executablePath, deny: false });
    details['m30-probe'] = { treatment, control };
    record('m30-treatment-probe-blocked', treatment.fetchOk === false && treatment.permissionState === 'denied', JSON.stringify(treatment));
    record('m30-pref-changes-probe', probeOutcomeChanged(control, treatment), JSON.stringify({ control, treatment }));
    assert.equal(treatment.fetchOk, false, `restricted probe reached loopback: ${JSON.stringify(treatment)}`);
    assert.equal(treatment.permissionState, 'denied');

    const firefox = await observeFirefox({ locale: 'de-DE', timezoneId: 'Europe/Berlin', languages: ['de-DE', 'en-US'] });
    details['m20-firefox'] = firefox;
    if (firefox.availability === 'not_run') {
      results['m20-firefox-timezone-id'] = 'not_run';
      results['m20-firefox-timezone-offset'] = 'not_run';
      results['m20-firefox-locale'] = 'not_run';
    } else {
      assert.ok(record('m20-firefox-timezone-id', firefox.timezone === 'Europe/Berlin', JSON.stringify(firefox)));
      assert.ok(record('m20-firefox-timezone-offset', firefox.timezoneOffset === timezoneOffsetMinutes('Europe/Berlin'), String(firefox.timezoneOffset)));
      record('m20-firefox-locale', firefox.locale === 'de-DE', firefox.locale);
    }
  } finally {
    await Promise.all(browsers.splice(0).map(browser => browser.close().catch(() => {})));
    if (proc) await stopServer(proc).catch(() => {});
    await new Promise(resolve => pageServer.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    const stock = Object.keys(ROW_CONTRACTS).flatMap(id => stockChecksFor(id, results));
    const evidence = {
      contractVersion: ULTIMATE3_CONTRACT_VERSION,
      capturedAt: new Date().toISOString(),
      chromium: MANIFEST.browserVersion,
      results,
      details,
      decisions: Object.fromEntries(Object.keys(ROW_CONTRACTS).map(id => [id, decideRelease(id, results)])),
      featureCompletion: featureCompletion(stock),
    };
    console.log(`ULTIMATE3_EVIDENCE ${JSON.stringify(evidence)}`);
    if (process.env.PM_ULTIMATE3_EVIDENCE === '1') {
      const out = path.resolve('docs/handoff/ultimate3/evidence/track-a-linux.json');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
    }
  }
});
