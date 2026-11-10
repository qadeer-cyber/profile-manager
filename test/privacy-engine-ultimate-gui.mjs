import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright';

assert.equal(process.platform, 'win32');
assert.equal(process.env.CI, 'true');
const installer = path.resolve(process.env.AZWAH_ULTIMATE_QA_EXE);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-ultimate-gui-'));
const target = path.join(root, 'installed');
const data = path.join(root, 'profile-data');
const output = path.resolve('build-evidence/ultimate-engine-gui');
fs.mkdirSync(output, { recursive: true });
const exe = path.join(target, 'Azwah Multi Browser Ultimate.exe');
const childExe = path.join(target, 'resources', 'privacy-engine', 'AzwahPrivacyPrototype.exe');
const install = () => execFileSync(installer, ['/S', '/D=' + target], { timeout: 240000 });
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const proof = { source: process.env.GITHUB_SHA, installerSha256: sha(installer), installerBytes: fs.statSync(installer).size };
console.log(JSON.stringify({ installer: proof }));
let app;
try {
  install();
  proof.manager = { path: exe, sha256: sha(exe) };
  proof.engine = { path: childExe, sha256: sha(childExe) };
  const open = async () => {
    const env = { ...process.env, PM_USER_DATA: data };
    for (const name of ['AZWAH_QA_PROXY_FIXTURES', 'AZWAH_MAXMIND_ACCOUNT_ID', 'AZWAH_MAXMIND_LICENSE_KEY']) delete env[name];
    app = await _electron.launch({ executablePath: exe, env, timeout: 90000 });
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.pm?.uiToken);
    return page;
  };
  let page = await open();
  const api = (route, options = {}) => page.evaluate(async ({ route, options }) => {
    const response = await fetch('/api' + route, {
      method: options.method || 'GET',
      headers: { 'X-UI-Token': window.pm.uiToken, 'Content-Type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  }, { route, options });
  await api('/settings', { method: 'PUT', body: { maxRunningProfiles: 8 } });
  const names = Array.from({ length: 5 }, (_, index) => 'QA Browser ' + (index + 1));
  const button = name => page.getByRole('button', { name, exact: true });
  const selected = name => page.getByRole('checkbox', { name: 'Select ' + name, exact: true });
  const waitForProfile = name => button('Launch ' + name).waitFor({ timeout: 20000 });
  for (const name of names) {
    await button('New profile').click();
    await page.getByPlaceholder('Profile name', { exact: true }).fill(name);
    await page.getByLabel('Chromium runtime', { exact: true }).selectOption('privacy');
    await button('Create profile').click();
    await waitForProfile(name);
  }
  const originalName = names[0];
  names[0] += ' renamed';
  await selected(originalName).check();
  await button('Edit selected').click();
  await page.getByPlaceholder('Profile name', { exact: true }).fill(names[0]);
  assert.equal(await page.getByLabel('Chromium runtime', { exact: true }).inputValue(), 'privacy');
  await button('Save changes').click();
  await waitForProfile(names[0]);
  if (!(await selected(names[0]).isChecked())) await selected(names[0]).check();
  await button('Duplicate selected').click();
  const copy = names[0] + ' (copy)';
  await waitForProfile(copy);
  if (await selected(names[0]).isChecked()) await selected(names[0]).uncheck();
  await selected(copy).check();
  await button('Delete selected').click();
  await button('Move to trash').click();
  await button('Launch ' + copy).waitFor({ state: 'detached' });
  for (const name of names) {
    await button('Launch ' + name).click();
    await button('Stop ' + name).waitFor({ timeout: 45000 });
  }
  const rows = async () => (await api('/profiles')).filter(profile => names.includes(profile.name));
  const running = await rows();
  assert.equal(running.length, 5);
  assert.equal(new Set(running.map(profile => profile.pid)).size, 5);
  for (const profile of running) {
    assert.ok(profile.running && profile.pid > 0);
    process.kill(profile.pid, 0);
    const actual = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `(Get-Process -Id ${profile.pid} -ErrorAction Stop).Path`], { encoding: 'utf8' }).trim();
    assert.equal(actual.toLowerCase(), childExe.toLowerCase());
  }
  proof.overlappingPids = running.map(profile => profile.pid);
  await page.screenshot({ path: path.join(output, 'five-running.png') });
  const first = running.find(profile => profile.name === names[0]);
  await button('Stop ' + first.name).click();
  await button('Launch ' + first.name).waitFor({ timeout: 45000 });
  for (const profile of running.filter(profile => profile.id !== first.id)) process.kill(profile.pid, 0);
  await button('Launch ' + first.name).click();
  await button('Stop ' + first.name).waitFor({ timeout: 45000 });
  assert.notEqual((await rows()).find(profile => profile.id === first.id).pid, first.pid);
  await app.close();
  app = undefined;
  const uninstaller = fs.readdirSync(target).find(file => /^Uninstall .*\.exe$/i.test(file));
  assert.ok(uninstaller, 'Installed Ultimate uninstaller is present');
  execFileSync(path.join(target, uninstaller), ['/S'], { timeout: 240000 });
  for (let i = 0; i < 40 && fs.existsSync(exe); i++) await delay(250);
  assert.equal(fs.existsSync(exe), false);
  install();
  page = await open();
  assert.deepEqual((await rows()).map(profile => profile.name).sort(), names);
  proof.gui = 'create, launch five, stop and restart one, reinstall profile retention';
  proof.autoLocation = { status: 'UNVERIFIED', reason: 'Controlled proxy fixtures or MaxMind City credentials are absent.' };
  const live = process.env.AZWAH_QA_PROXY_FIXTURES;
  const account = process.env.AZWAH_MAXMIND_ACCOUNT_ID;
  const license = process.env.AZWAH_MAXMIND_LICENSE_KEY;
  if (live && account && license) {
    proof.autoLocation = { status: 'FAIL' };
    let stage = 'fixture validation';
    try {
      const fixtures = JSON.parse(live);
      if (!Array.isArray(fixtures) || fixtures.length !== 2 ||
          new Set(fixtures.map(item => item.expected.ip)).size !== 2 ||
          new Set(fixtures.map(item => item.expected.country)).size !== 2 ||
          new Set(fixtures.map(item => item.expected.timezone)).size !== 2) throw new Error();
      stage = 'GeoIP settings';
      await api('/settings/geoip', { method: 'PUT', body: { account, license } });
      const create = async (fixture, index) => {
        const profile = await api('/profiles', { method: 'POST', body: {
          name: 'Live proxy QA ' + (index + 1), proxy: fixture.proxy,
          advancedSettings: { runtime: 'privacy' },
          browserSettings: { timezoneId: 'Pacific/Honolulu' },
        } });
        if (profile.advancedSettings.geolocation.mode !== null) throw new Error();
        return profile;
      };
      stage = 'profile creation';
      const profiles = await Promise.all(fixtures.map(create));
      stage = 'installed browser launch';
      await Promise.all(profiles.map(({ id }) => api('/profiles/' + id + '/launch', { method: 'POST', body: {} })));
      stage = 'independent identity checks';
      const current = await api('/profiles');
      const observations = profiles.map(({ id }, i) => {
        const profile = current.find(row => row.id === id);
        const result = profile?.lastProxyLocation;
        const expected = fixtures[i].expected;
        const canonical = timezone => new Intl.DateTimeFormat('en', { timeZone: timezone }).resolvedOptions().timeZone;
        if (!profile?.running || !result?.browserVerifiedAt || result.ip !== expected.ip ||
            result.country !== expected.country || canonical(result.timezone) !== canonical(expected.timezone) ||
            !result.approximate || !(result.radiusKm > 0) ||
            !Array.isArray(expected.bounds) || expected.bounds.length !== 4 ||
            !expected.bounds.every(Number.isFinite) ||
            result.latitude < expected.bounds[0] || result.latitude > expected.bounds[1] ||
            result.longitude < expected.bounds[2] || result.longitude > expected.bounds[3]) throw new Error();
        return { pid: profile.pid, country: result.country, timezone: result.timezone, radiusKm: result.radiusKm,
          matchedIndependentExit: true, matchedIndependentBounds: true };
      });
      if (new Set(observations.map(item => item.pid)).size !== 2) throw new Error();
      proof.autoLocation = { status: 'PASS', observations };
    } catch {
      throw new Error('Live Auto Location acceptance failed at ' + stage + '.');
    }
  }

} finally {
  if (app && !proof.gui) {
    try { await (await app.firstWindow()).screenshot({ path: path.join(output, 'gui-failure.png'), timeout: 4000 }); } catch {}
  }
  await app?.close();
  fs.writeFileSync(path.join(output, 'installed-gui.json'), JSON.stringify(proof, null, 2));
}
