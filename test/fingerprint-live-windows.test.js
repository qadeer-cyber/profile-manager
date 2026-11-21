// Live fingerprint verification against real signed Chrome Stable on Windows.
//
// Two profiles with different, supported settings are launched at the same time. For every
// category the per-category verification row is cross-checked against the raw browser
// observation, so a "pass" must be backed by values the browser actually exposed. A setting
// changed while running must not pass, a stopped profile must not pass, and settings must
// survive a restart. Prints a per-category table for the CI log.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';

const NON_PASS = new Set(['warning', 'partial', 'unavailable', 'real-only', 'unsupported']);
// Findings read from the running browser process's real command line (an observation of the
// process, not of a page). Every other pass needs the in-page observation.
const PROCESS_EVIDENCE = new Set(['webrtc_flag', 'port_scan_policy']);

test('real Chrome Stable: per-category verification matches what the browser exposes', { timeout: 420000 }, async t => {
  if (process.platform !== 'win32') { t.skip('Chrome Stable runtime is Windows-only'); return; }
  const { resolveWindowsChromeStable } = await import('../server/browser-runtime/chrome-stable.js');
  let stable;
  try { stable = await resolveWindowsChromeStable(); } catch (error) { t.skip(`Chrome Stable not available: ${error.code || error.message}`); return; }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-fp-live-'));
  process.env.PM_DATA_DIR = dir;
  process.env.PM_API_TOKEN = 'fp-live-token';
  const { startServer } = await import('../server/app.js');
  const { setSetting } = await import('../server/db.js');
  // Only /a and /b set a cookie: Chrome also requests /favicon.ico, which must not overwrite it.
  const site = http.createServer((req, res) => {
    const value = { '/a': 'A', '/b': 'B' }[req.url];
    res.writeHead(value ? 200 : 404, { 'Content-Type': 'text/html', ...(value && { 'Set-Cookie': `fp_live=${value}; Path=/` }) }).end('<title>fp</title>');
  });
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${site.address().port}`;
  const server = await startServer({ port: 0, staticDir: null });
  setSetting('maxRunningProfiles', 6);
  const api = async (method, route, body, expected = 200) => {
    const r = await fetch(server.url + '/api/v1' + route, { method, body: body && JSON.stringify(body), signal: AbortSignal.timeout(90000),
      headers: { Authorization: 'Bearer fp-live-token', 'Content-Type': 'application/json' } });
    const data = await r.json().catch(() => null);
    assert.equal(r.status, expected, `${method} ${route}: ${JSON.stringify(data)}`);
    return data;
  };
  const report = id => api('GET', `/profiles/${id}/hardware`);
  const rows = rep => Object.fromEntries(rep.consistency.byCategory.map(row => [row.id, row]));
  const table = (label, rep) => {
    console.log(`# ${label}: engine ${rep.engine?.source} ${rep.engine?.version}; observed ${rep.browser.availability}${rep.browser.reason ? ` (${rep.browser.reason} at ${rep.browser.stage}: ${rep.browser.detail})` : ''}`);
    for (const row of rep.consistency.byCategory) console.log(`#   ${row.id.padEnd(18)} ${row.status.padEnd(11)} ${row.findings.filter(f => f.status !== 'unsupported').map(f => `${f.id}=${f.status}`).join(' ')}`);
  };

  // Cross-check every pass against the raw observation, independent of the consistency engine.
  function assertHonest(label, rep, profile) {
    const r = rows(rep), seen = rep.browser;
    assert.equal(rep.consistency.byCategory.length, 17, `${label}: 17 categories`);
    for (const row of rep.consistency.byCategory) {
      if (row.status === 'pass') {
        const checks = row.findings.filter(f => f.status !== 'unsupported');
        assert.ok(checks.length && checks.every(f => f.status === 'pass'), `${label}: ${row.id} pass without passing checks`);
        if (!checks.every(f => PROCESS_EVIDENCE.has(f.id))) assert.equal(seen.availability, 'observed', `${label}: ${row.id} pass without an observation`);
      }
    }
    const bs = profile.browserSettings;
    if (r.timezone.status === 'pass') assert.equal(seen.timezone, bs.timezoneId, `${label}: timezone pass but browser shows ${seen.timezone}`);
    if (r.languages.status === 'pass') {
      assert.deepEqual(seen.languages.slice(0, bs.languages.length), bs.languages, `${label}: languages pass but browser shows ${seen.languages}`);
      assert.equal(seen.locale, bs.locale);
    }
    if (r.deviceIdentity.status === 'pass') {
      assert.equal(seen.platform, 'Win32');
      if (seen.clientHints?.availability === 'observed') { assert.equal(seen.clientHints.platform, 'Windows'); assert.equal(seen.clientHints.mobile, false); }
    }
    if (r.userAgent.status === 'pass' || r.userAgent.status === 'partial') {
      assert.ok(seen.userAgent.includes(`Chrome/${rep.engine.version.split('.')[0]}.`), `${label}: UA ${seen.userAgent} vs engine ${rep.engine.version}`);
      if (seen.clientHints?.uaFullVersion) assert.equal(seen.clientHints.uaFullVersion, rep.engine.version);
    }
    const sc = profile.advancedSettings.screen;
    if (r.screen.status === 'pass') {
      if (sc.width != null) assert.equal(seen.screen.width, sc.width);
      if (sc.viewportWidth != null) assert.equal(seen.screen.innerWidth, sc.viewportWidth);
    }
    if (r.webgl.status === 'pass') assert.notEqual(seen.webgl?.availability, 'observed', `${label}: WebGL restriction pass but a WebGL context exists`);
    if (r.canvas.status === 'pass') assert.match(seen.canvas?.sha256 || '', /^[a-f0-9]{64}$/);
    if (r.portScan.status === 'pass') {
      // Every Local Network Access permission the browser exposes must be denied.
      const lna = ['local-network-access', 'local-network', 'loopback-network'].map(n => [n, seen.permissions?.[n]]).filter(([, v]) => v?.availability === 'observed');
      assert.ok(lna.length && lna.every(([, v]) => v.state === 'denied'), `${label}: portScan pass but ${JSON.stringify(lna)}`);
    }
    for (const id of ['webglMetadata', 'webgpu', 'navigatorHardware']) assert.ok(NON_PASS.has(r[id].status) || r[id].status === 'pass', `${label}: ${id} status ${r[id].status}`);
  }

  const ids = [];
  try {
    const host = await api('GET', '/device-identity');
    const A = await api('POST', '/profiles', {
      name: 'Live A', advancedSettings: { runtime: 'stable-chrome', screen: { preset: '1280x800' }, fingerprint: { webgl: 'restricted', fonts: 'restricted', mediaDevices: 'restricted' }, deviceIdentity: { preset: 'host' } },
      browserSettings: { locale: 'de-DE', languages: ['de-DE', 'en-US'], timezoneId: 'Asia/Tokyo' },
      webrtcSettings: { mode: 'disable_non_proxied_udp' },
    }, 201);
    const B = await api('POST', '/profiles', {
      name: 'Live B', advancedSettings: { runtime: 'stable-chrome' },
      browserSettings: { locale: 'en-US', languages: ['en-US'], timezoneId: 'America/New_York' },
    }, 201);
    ids.push(A.id, B.id);
    console.log(`# host ${host.host.label}; Chrome Stable ${stable.version}`);

    // Stopped: nothing may pass.
    const stopped = await report(A.id);
    assert.equal(stopped.browser.availability, 'unavailable');
    assert.equal(stopped.consistency.byCategory.some(r => r.status === 'pass' || r.status === 'partial'), false, 'stopped profile verified');

    await api('POST', `/profiles/${A.id}/launch`, { headless: false });
    await api('POST', `/profiles/${B.id}/launch`, { headless: false });
    const repA = await report(A.id), repB = await report(B.id);
    table('A', repA); table('B', repB);
    // Both running profiles must be observable; a probe that hangs (e.g. on a permission prompt) is a defect.
    assert.equal(repA.browser.availability, 'observed', `A not observed: ${repA.browser.reason}`);
    assert.equal(repB.browser.availability, 'observed', `B not observed: ${repB.browser.reason}`);
    assert.equal(repA.engine.source, 'chrome-stable');
    assert.equal(repA.engine.version, stable.version, 'verification compares against the Chrome that is running');
    const profA = await api('GET', `/profiles/${A.id}`), profB = await api('GET', `/profiles/${B.id}`);
    assertHonest('A', repA, profA); assertHonest('B', repB, profB);

    // Supported settings that must verify on real Chrome Stable.
    const ra = rows(repA), rb = rows(repB);
    for (const [id, r] of [['timezone', ra], ['languages', ra], ['deviceIdentity', ra], ['canvas', ra], ['webgl', ra], ['timezone', rb], ['languages', rb], ['deviceIdentity', rb]]) {
      assert.ok(r[id].status === 'pass' || r[id].status === 'partial', `${id}: ${r[id].status} ${JSON.stringify(r[id].findings)}`);
    }
    // Port-scan protection is on by default and must verify on both simultaneous profiles.
    for (const [label, r] of [['A', ra], ['B', rb]]) {
      assert.equal(r.portScan.status, 'pass', `${label} portScan: ${JSON.stringify(r.portScan.findings)}`);
    }
    assert.notEqual(ra.userAgent.status, 'warning', `user agent: ${JSON.stringify(ra.userAgent.findings)}`);
    assert.notEqual(ra.webrtc.status, 'warning', `webrtc: ${JSON.stringify(ra.webrtc.findings)}`);

    // Two-profile isolation: each browser shows its own settings and its own cookies.
    assert.equal(repA.browser.timezone, 'Asia/Tokyo');
    assert.equal(repB.browser.timezone, 'America/New_York');
    assert.notDeepEqual(repA.browser.languages, repB.browser.languages);
    const { liveContext } = await import('../server/browsers.js');
    await (await liveContext(A.id).newPage()).goto(origin + '/a');
    await (await liveContext(B.id).newPage()).goto(origin + '/b');
    const cookiesA = (await api('GET', `/profiles/${A.id}/cookies`)).cookies.filter(c => c.name === 'fp_live').map(c => c.value);
    const cookiesB = (await api('GET', `/profiles/${B.id}/cookies`)).cookies.filter(c => c.name === 'fp_live').map(c => c.value);
    assert.deepEqual([cookiesA, cookiesB], [['A'], ['B']], 'cookies stay in their own profile');

    // A setting saved while running applies on the next launch: it must not verify as pass now.
    const changed = await api('PUT', `/profiles/${A.id}`, { browserSettings: { locale: 'de-DE', languages: ['de-DE', 'en-US'], timezoneId: 'Europe/Berlin' } });
    assert.equal(changed.appliesOnNextLaunch, true);
    const staleReport = await report(A.id);
    table('A after saving a new timezone while running', staleReport);
    const stale = rows(staleReport);
    assert.equal(staleReport.browser.availability, 'observed', `A not observed after the save: ${staleReport.browser.reason} at ${staleReport.browser.stage}: ${staleReport.browser.detail}`);
    assert.equal(stale.timezone.status, 'warning', `stale timezone verified as ${stale.timezone.status}`);

    // Restart: the saved settings are applied and verified again.
    await api('POST', `/profiles/${A.id}/stop`);
    await api('POST', `/profiles/${A.id}/launch`, { headless: false });
    const restarted = await report(A.id);
    table('A after restart', restarted);
    assert.equal(restarted.browser.timezone, 'Europe/Berlin');
    assert.ok(['pass', 'partial'].includes(rows(restarted).timezone.status));
    assertHonest('A restarted', restarted, await api('GET', `/profiles/${A.id}`));
    // Port-scan protection must survive relaunch (Chromium's one-time Local Network Access migration
    // used to drop it from the second launch on). Check this restart and one more.
    assert.equal(rows(restarted).portScan.status, 'pass', `A portScan after restart: ${JSON.stringify(rows(restarted).portScan.findings)}`);
    await api('POST', `/profiles/${A.id}/stop`);
    await api('POST', `/profiles/${A.id}/launch`, { headless: false });
    const restartedAgain = await report(A.id);
    table('A after second restart', restartedAgain);
    assert.equal(rows(restartedAgain).portScan.status, 'pass', `A portScan after second restart: ${JSON.stringify(rows(restartedAgain).portScan.findings)}`);
    assertHonest('A restarted twice', restartedAgain, await api('GET', `/profiles/${A.id}`));

    // A failed observation cannot pass: once stopped, the same profile reports nothing as verified.
    await api('POST', `/profiles/${A.id}/stop`);
    const afterStop = await report(A.id);
    assert.equal(afterStop.consistency.byCategory.some(r => r.status === 'pass' || r.status === 'partial'), false);

    // Sanitized export: the verification report contains no proxy credentials or cookie values.
    assert.equal(JSON.stringify(repA).includes('fp_live'), false);
  } finally {
    for (const id of ids) await fetch(server.url + `/api/v1/profiles/${id}/stop`, { method: 'POST', headers: { Authorization: 'Bearer fp-live-token' } }).catch(() => {});
    await server.close();
    site.close();
  }
});
