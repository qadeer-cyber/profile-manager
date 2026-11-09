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
let app;
try {
  install();
  proof.manager = { path: exe, sha256: sha(exe) };
  proof.engine = { path: childExe, sha256: sha(childExe) };
  const open = async () => {
    app = await _electron.launch({ executablePath: exe, env: { ...process.env, PM_USER_DATA: data }, timeout: 90000 });
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
  for (const name of names) {
    await button('New profile').click();
    await page.getByPlaceholder('Profile name', { exact: true }).fill(name);
    await page.getByLabel('Chromium runtime', { exact: true }).selectOption('privacy');
    await button('Create profile').click();
    await button('Launch ' + name).waitFor({ timeout: 20000 });
  }
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
} finally {
  await app?.close();
  fs.writeFileSync(path.join(output, 'installed-gui.json'), JSON.stringify(proof, null, 2));
}
