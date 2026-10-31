// Real Chromium observables for deepened M20–M23, M28–M30 and the M24 page-hook prototype.
// Skips when the pinned CfT build is not installed. Linux headless is not a Windows qualification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { spawnServer, stopServer } from './_ports.mjs';
import { withBrowserTestEnv, chromiumAvailableForTests } from './_browser-env.mjs';
import { privateNetworkWeakening } from '../server/fingerprint-settings.js';
import { processCommandLine } from '../server/proc.js';
import { MANIFEST } from '../server/chromium.js';

const skip = chromiumAvailableForTests() ? false : 'Chromium not installed for browser tests';

test('advanced privacy observables persist across restart', { timeout: 240000, skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-adv-privacy-'));
  const env = withBrowserTestEnv({ PM_DATA_DIR: dir, PM_API_TOKEN: 'adv-privacy' });
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><title>privacy</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const pageUrl = `http://127.0.0.1:${server.address().port}/`;
  let proc;
  const auth = { Authorization: 'Bearer adv-privacy', 'Content-Type': 'application/json' };
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
  async function open(id) {
    const launched = await api('POST', `/profiles/${id}/launch`, { headless: true, automation: true, url: pageUrl });
    const browser = await chromium.connectOverCDP(launched.cdp.httpEndpoint);
    const page = browser.contexts()[0].pages()[0];
    if (!page.url().startsWith(pageUrl)) await page.goto(pageUrl);
    return { browser, page };
  }
  async function readPage(page) {
    return page.evaluate(async () => {
      const hashBytes = async bytes => {
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
      };
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const context = canvas.getContext('2d');
      context.fillStyle = '#123456';
      context.fillRect(0, 0, 32, 32);
      context.font = '16px monospace';
      const fontWidth = context.measureText('mmmm').width;
      const pixels = context.getImageData(0, 0, 32, 32).data;
      const geo = await new Promise(resolve => {
        navigator.geolocation.getCurrentPosition(
          pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy }),
          error => resolve({ code: error.code }),
          { timeout: 4000 },
        );
      });
      let mediaError = null;
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        mediaError = 'granted';
      } catch (error) {
        mediaError = error.name;
      }
      let localFonts = { api: 'missing' };
      if (typeof window.queryLocalFonts === 'function') {
        try {
          const fonts = await window.queryLocalFonts();
          localFonts = { api: 'resolved', count: fonts.length };
        } catch (error) {
          localFonts = { api: 'rejected', name: error.name };
        }
      }
      const permissions = {};
      for (const name of ['geolocation', 'local-fonts', 'local-network-access', 'camera', 'microphone']) {
        try {
          permissions[name] = (await navigator.permissions.query({ name })).state;
        } catch (error) {
          permissions[name] = `query_error:${error.name || 'Error'}`;
        }
      }
      let full = '';
      try {
        const high = await navigator.userAgentData.getHighEntropyValues(['uaFullVersion']);
        full = high.uaFullVersion || '';
      } catch { /* auxiliary CDP may hide hints */ }
      return {
        language: navigator.language,
        languages: navigator.languages,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        geo,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scale: window.devicePixelRatio,
        permissions,
        fontWidth,
        mediaError,
        localFonts,
        canvasHash: await hashBytes(pixels),
        prototype: window.__pmCanvasPrototype || null,
        ua: navigator.userAgent,
        full,
      };
    });
  }
  try {
    proc = await spawnServer(env);
    await fetch(`${proc.url}/api/settings`, {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ minFreeMemoryGiB: 0, maxRunningProfiles: 6 }),
    });
    const acceptance = await fetch(`${proc.url}/api/privacy-acceptance`).then(r => r.json());
    assert.equal(acceptance.A.denominator, 43);
    assert.equal(acceptance.B.recalculatedHere, false);
    assert.equal(acceptance.C.rows.find(row => row.id === 'M24').qualification, 'BLOCKED');
    assert.equal(acceptance.m42.guarantee, 'UNSUPPORTED');
    assert.equal(acceptance.D.status, 'NOT_RUN');
    assert.equal(acceptance.geolocationNative.status, 'BLOCKED_SPAWN');
    assert.equal(acceptance.C.rows.find(row => row.id === 'M26').prototypeQualification, 'EXPERIMENTAL_NOT_ENGINE');

    const version = MANIFEST.browserVersion;
    const major = `${version.split('.')[0]}.0.0.0`;
    const id = (await api('POST', '/profiles', {
      name: 'Advanced privacy',
      browserSettings: { locale: 'de-DE', timezoneId: 'Europe/Berlin', languages: ['de-DE', 'en-US'] },
      advancedSettings: {
        userAgent: { mode: 'reduced' },
        screen: { preset: '1280x800', deviceScaleFactor: 2 },
        geolocation: { permission: 'allow', latitude: 48.137, longitude: 11.575, accuracy: 25 },
        fingerprint: { fonts: 'restricted', mediaDevices: 'restricted', portScan: 'real' },
      },
    })).id;

    let session = await open(id);
    const first = await readPage(session.page);
    assert.equal(first.language, 'de-DE');
    assert.deepEqual(first.languages.slice(0, 2), ['de-DE', 'en-US']);
    assert.equal(first.timeZone, 'Europe/Berlin');
    assert.deepEqual(first.geo, { lat: 48.137, lon: 11.575, acc: 25 });
    assert.equal(first.innerWidth, 1280);
    assert.equal(first.innerHeight, 800);
    assert.equal(first.scale, 2);
    if (first.localFonts.api === 'missing') {
      assert.notEqual(first.permissions['local-fonts'], 'granted', 'FontAccess off: permission query may throw instead of denied');
    } else {
      assert.equal(first.permissions['local-fonts'], 'denied');
    }
    assert.equal(first.permissions['local-network-access'], 'denied');
    assert.equal(first.permissions.camera, 'denied');
    assert.equal(first.permissions.microphone, 'denied');
    assert.notEqual(first.mediaError, 'granted');
    assert.ok(first.mediaError === 'NotAllowedError' || first.mediaError === 'NotFoundError', first.mediaError);
    assert.equal(first.localFonts.api, 'missing');
    assert.ok(first.fontWidth > 0);
    assert.equal(first.prototype, null);
    assert.ok(first.ua.includes(major));
    assert.equal(first.ua.includes(version), false);
    if (first.full) assert.equal(first.full, version);
    const prefs = JSON.parse(fs.readFileSync(path.join(dir, 'profiles', id, 'Default', 'Preferences'), 'utf8'));
    assert.equal(prefs.profile.default_content_setting_values.local_fonts, 2);
    assert.equal(prefs.profile.default_content_setting_values.media_stream_camera, 2);
    assert.equal(prefs.profile.default_content_setting_values.media_stream_mic, 2);
    assert.equal(prefs.profile.default_content_setting_values.local_network_access, 2);
    const resources = await api('GET', '/resources');
    const pid = resources.browsers.profiles.find(row => row.id === id)?.pid;
    assert.ok(pid);
    const commandLine = await processCommandLine(pid);
    assert.match(commandLine, /FontAccess/);
    assert.equal(privateNetworkWeakening(commandLine).features.length, 0);
    await session.browser.close().catch(() => {});
    await api('POST', `/profiles/${id}/stop`, {});

    session = await open(id);
    const second = await readPage(session.page);
    assert.equal(second.timeZone, 'Europe/Berlin');
    assert.deepEqual(second.languages.slice(0, 2), ['de-DE', 'en-US']);
    assert.deepEqual(second.geo, { lat: 48.137, lon: 11.575, acc: 25 });
    assert.equal(second.innerWidth, 1280);
    assert.equal(second.scale, 2);
    if (second.localFonts.api === 'missing') {
      assert.notEqual(second.permissions['local-fonts'], 'granted');
    } else {
      assert.equal(second.permissions['local-fonts'], 'denied');
    }
    assert.equal(second.permissions.camera, 'denied');
    assert.equal(second.canvasHash, first.canvasHash);
    await session.browser.close().catch(() => {});
    await api('POST', `/profiles/${id}/stop`, {});

    const deniedId = (await api('POST', '/profiles', {
      name: 'Geo deny',
      advancedSettings: { geolocation: { permission: 'deny' } },
    })).id;
    session = await open(deniedId);
    const denied = await readPage(session.page);
    assert.equal(denied.geo.code, 1);
    assert.ok(
      denied.permissions.geolocation === 'denied' || String(denied.permissions.geolocation).startsWith('query_error:'),
      `geolocation permission observable: ${denied.permissions.geolocation}`,
    );
    await session.browser.close().catch(() => {});
    await api('POST', `/profiles/${deniedId}/stop`, {});

    const canvasId = (await api('POST', '/profiles', { name: 'Canvas prototype' })).id;
    session = await open(canvasId);
    const plain = await readPage(session.page);
    assert.equal(plain.prototype, null);
    await session.browser.close().catch(() => {});
    await api('POST', `/profiles/${canvasId}/stop`, {});
    await api('PATCH', `/profiles/${canvasId}`, {
      advancedSettings: { experimental: { canvasReadback: 'prototype' } },
    });
    session = await open(canvasId);
    const hooked = await readPage(session.page);
    assert.equal(hooked.prototype.experimental, true);
    assert.equal(hooked.prototype.customEngine, false);
    assert.equal(hooked.prototype.captchaBypass, false);
    assert.notEqual(hooked.canvasHash, plain.canvasHash);
    const hookedHash = hooked.canvasHash;
    await session.browser.close().catch(() => {});
    await api('POST', `/profiles/${canvasId}/stop`, {});
    session = await open(canvasId);
    const again = await readPage(session.page);
    assert.equal(again.canvasHash, hookedHash);
    assert.equal(again.prototype.customEngine, false);
    await session.browser.close().catch(() => {});
    await api('POST', `/profiles/${canvasId}/stop`, {});

    const webglId = (await api('POST', '/profiles', { name: 'WebGL read prototype' })).id;
    session = await open(webglId);
    const plainGl = await session.page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 4;
      c.height = 4;
      const gl = c.getContext('webgl');
      if (!gl) return { context: false };
      gl.clearColor(0, 1, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const px = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { context: true, px: [...px], marker: window.__pmWebglReadPrototype || null };
    });
    assert.equal(plainGl.context, true);
    assert.deepEqual(plainGl.px, [0, 255, 0, 255]);
    assert.equal(plainGl.marker, null);
    await session.browser.close().catch(() => {});
    await api('POST', `/profiles/${webglId}/stop`, {});
    await api('PATCH', `/profiles/${webglId}`, {
      advancedSettings: { experimental: { webglReadback: 'prototype' } },
    });
    session = await open(webglId);
    const hookedGl = await session.page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 4;
      c.height = 4;
      const gl = c.getContext('webgl');
      gl.clearColor(0, 1, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const px = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { px: [...px], marker: window.__pmWebglReadPrototype };
    });
    assert.equal(hookedGl.marker.customEngine, false);
    assert.notDeepEqual(hookedGl.px, [0, 255, 0, 255]);
    const hookedPx = hookedGl.px;
    await session.browser.close().catch(() => {});
    await api('POST', `/profiles/${webglId}/stop`, {});
    session = await open(webglId);
    const againGl = await session.page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 4;
      c.height = 4;
      const gl = c.getContext('webgl');
      gl.clearColor(0, 1, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const px = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [...px];
    });
    assert.deepEqual(againGl, hookedPx);
    await session.browser.close().catch(() => {});
    await api('POST', `/profiles/${webglId}/stop`, {});
  } finally {
    if (proc) await stopServer(proc).catch(() => {});
    await new Promise(resolve => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
