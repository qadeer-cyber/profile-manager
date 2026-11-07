// Installed Owner and Admin-generated Office must launch the bundled Firefox, not a system install.
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {_electron} from 'playwright';
import {startLocalHttpFixture} from '../test/_local-http-fixture.mjs';
import {FIREFOX_RUNTIME} from './firefox-runtime-pin.mjs';

if (process.platform !== 'win32' || process.env.CI !== 'true') throw new Error('An isolated Windows CI worker is required');
const phase = process.argv[2];
if (phase !== 'owner' && phase !== 'office') throw new Error('Pass owner or office');
const root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'azwah-fx-'));
const evidence = path.resolve('build-evidence/ultimate-firefox');
fs.mkdirSync(path.join(evidence, 'screenshots'), {recursive: true});
const results = [];
const check = (ok, message) => {
  results.push({pass: !!ok, phase, message});
  console.log(`${ok ? 'PASS' : 'FAIL'} ${phase}: ${message}`);
  if (!ok) throw new Error(message);
};
function closedEnv(userData) {
  const env = {...process.env, PM_USER_DATA: userData, PM_FIREFOX_NO_SYSTEM: '1', PATH: 'C:\\Windows\\System32', ProgramFiles: path.join(root, 'empty-program-files'), 'ProgramFiles(x86)': path.join(root, 'empty-program-files-x86')};
  delete env.PM_FIREFOX_EXECUTABLE;
  delete env.PM_FIREFOX_RESOURCES;
  fs.mkdirSync(env.ProgramFiles, {recursive: true});
  fs.mkdirSync(env['ProgramFiles(x86)'], {recursive: true});
  return env;
}
function processPath(pid) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${Number(pid)} -ErrorAction Stop).Path`], {encoding: 'utf8'});
  if (result.status !== 0) throw new Error(result.stderr || 'Could not read the Firefox process path');
  return result.stdout.trim();
}
async function api(page, route, body) {
  return page.evaluate(async ({route, body}) => {
    const response = await fetch('/api' + route, {method: body === undefined ? 'GET' : 'POST', headers: {'Content-Type': 'application/json', 'X-UI-Token': window.pm.uiToken}, body: body === undefined ? undefined : JSON.stringify(body)});
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = {raw: text.slice(0, 400)}; }
    return {status: response.status, body: parsed};
  }, {route, body});
}
async function officialCookieEditor(dest) {
  const metadata = await (await fetch('https://addons.mozilla.org/api/v5/addons/addon/cookie-editor/')).json();
  if (metadata.guid !== '{c3c10168-4186-445c-9c5b-63f12b8e2c87}') throw new Error('Official Cookie-Editor identity mismatch');
  const file = metadata.current_version.file;
  if (!String(file.url).startsWith('https://addons.mozilla.org/') || !/^sha256:[a-f0-9]{64}$/.test(file.hash)) throw new Error('Unexpected Cookie-Editor metadata');
  const bytes = Buffer.from(await (await fetch(file.url)).arrayBuffer());
  const hash = 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex');
  if (hash !== file.hash) throw new Error('Cookie-Editor checksum mismatch');
  fs.writeFileSync(dest, bytes);
}
async function proveFirefox(page, installDir) {
  const exe = path.join(installDir, 'resources', 'firefox', 'firefox.exe');
  const notice = path.join(installDir, 'resources', 'FIREFOX-REDISTRIBUTION.txt');
  const ini = fs.readFileSync(path.join(installDir, 'resources', 'firefox', 'application.ini'), 'utf8');
  check(fs.existsSync(exe) && fs.existsSync(notice) && ini.includes('Version=140.17.0'), 'Installed payload contains pinned Firefox 140.17.0 and the redistribution notice');
  const browser = await api(page, '/browser');
  check(browser.status === 200 && browser.body.firefox?.systemSearch === false, 'Installed application reports that system Firefox search is off');
  check(path.normalize(browser.body.firefox.path).toLowerCase() === path.normalize(exe).toLowerCase(), 'Resolved Firefox path is the executable inside this install tree');
  const fixture = await startLocalHttpFixture({body: '<!doctype html><html><head><title>fx-bundled</title></head><body>ok</body></html>'});
  try {
    const created = await api(page, '/profiles', {name: `${phase} bundled firefox`, browserEngine: 'firefox', browserSettings: {firefoxSessionMode: 'bidi', timezoneId: 'UTC', locale: 'en-US', languages: ['en-US']}});
    check(created.status === 201, 'Installed application creates a Firefox profile without a system Firefox');
    const id = created.body.id;
    const launch = async () => api(page, `/profiles/${id}/launch`, {headless: true, automation: true, url: fixture.origin});
    let opened = await launch();
    check(opened.status === 200, 'Bundled Firefox launches with no system Firefox on PATH');
    const running = await api(page, `/profiles/${id}`);
    const image = processPath(running.body.pid);
    check(image.toLowerCase() === exe.toLowerCase(), 'The live Firefox process image is the payload executable');
    const tree = await api(page, `/profiles/${id}/firefox/command`, {method: 'browsingContext.getTree', params: {}});
    const context = tree.body?.contexts?.[0]?.context;
    check(tree.status === 200 && context, 'Bundled Firefox accepted an application-owned BiDi session');
    const write = await api(page, `/profiles/${id}/firefox/command`, {method: 'script.evaluate', params: {expression: "localStorage.setItem('azwah-runtime','bundled'); localStorage.getItem('azwah-runtime')", target: {context}, awaitPromise: true}});
    check(JSON.stringify(write.body).includes('bundled'), 'Bundled Firefox stored a value in page localStorage');
    const xpi = path.join(root, `${phase}-cookie-editor.xpi`);
    await officialCookieEditor(xpi);
    const imported = await api(page, '/gecko-extensions/import', {path: xpi});
    check(imported.status === 201 && imported.body.geckoExtensionId === '{c3c10168-4186-445c-9c5b-63f12b8e2c87}', 'Official signed Cookie-Editor imports into the installed application');
    const installed = await api(page, `/profiles/${id}/gecko-extensions/${imported.body.id}/install`, {confirm: true});
    check(installed.status === 200 && installed.body.permanent === true, 'Bundled Firefox permanently installed the signed add-on');
    check((await api(page, `/profiles/${id}/stop`, {})).status === 200, 'Bundled Firefox stopped through the application');
    opened = await launch();
    check(opened.status === 200, 'Bundled Firefox relaunches offline from the same payload');
    const again = processPath((await api(page, `/profiles/${id}`)).body.pid);
    check(again.toLowerCase() === exe.toLowerCase(), 'The restarted Firefox process is still the payload executable');
    const tree2 = await api(page, `/profiles/${id}/firefox/command`, {method: 'browsingContext.getTree', params: {}});
    const read = await api(page, `/profiles/${id}/firefox/command`, {method: 'script.evaluate', params: {expression: "localStorage.getItem('azwah-runtime')", target: {context: tree2.body.contexts[0].context}, awaitPromise: true}});
    check(JSON.stringify(read.body).includes('bundled'), 'localStorage survived a bundled Firefox restart');
    const addons = await api(page, `/profiles/${id}/gecko-extensions`);
    check(addons.status === 200 && addons.body.addons.some(item => item.id === '{c3c10168-4186-445c-9c5b-63f12b8e2c87}' && item.active), 'Signed Cookie-Editor stayed active after the bundled Firefox restart');
    await api(page, `/profiles/${id}/stop`, {});
    return {exe, image};
  } finally { await fixture.close(); }
}

const record = {phase, firefox: FIREFOX_RUNTIME, host: os.release(), windows10: false, systemFirefoxUsed: false};
try {
  if (phase === 'owner') {
    const installer = path.resolve('release-ultimate-owner/Azwah-Multi-Browser-Ultimate-Setup-x64.exe');
    const installDir = path.join(root, 'owner');
    execFileSync(installer, ['/S', '/D=' + installDir], {timeout: 240000});
    const app = await _electron.launch({executablePath: path.join(installDir, 'Azwah Multi Browser Owner.exe'), env: closedEnv(path.join(root, 'owner-data')), timeout: 60000});
    try {
      const page = await app.firstWindow();
      await page.waitForFunction(() => !!window.pm, {timeout: 60000});
      await page.setViewportSize({width: 1366, height: 768});
      await page.locator('[data-nav=settings]').click();
      await page.getByText('Resolved executable:').waitFor();
      await page.screenshot({path: path.join(evidence, 'screenshots', 'owner-firefox-runtime-1366x768.png')});
      record.owner = await proveFirefox(page, installDir);
      record.ownerInstaller = {bytes: fs.statSync(installer).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex')};
    } finally { await app.close(); }
  } else {
    const adminInstaller = path.resolve('release-license-admin/Azwah-License-Admin-Setup-x64.exe');
    const adminDir = path.join(root, 'admin');
    const backup = path.join(root, 'backup.vault');
    const tokenFile = path.join(root, 'employee.azwah');
    const password = 'Disposable Firefox payload ' + crypto.randomUUID();
    execFileSync(adminInstaller, ['/S', '/D=' + adminDir], {timeout: 240000});
    const admin = await _electron.launch({executablePath: path.join(adminDir, 'Azwah License Admin.exe'), env: {...process.env, PM_USER_DATA: path.join(root, 'admin-data')}, timeout: 60000});
    let office;
    try {
      const adminPage = await admin.firstWindow();
      await adminPage.getByText('Welcome to Azwah License Admin').waitFor();
      await admin.evaluate(({dialog}, file) => { dialog.showSaveDialog = async () => ({canceled: false, filePath: file}); }, backup);
      await adminPage.getByLabel('Organization', {exact: true}).fill('Disposable Firefox qualification');
      await adminPage.getByLabel('Master password (14 characters minimum)', {exact: true}).fill(password);
      await adminPage.getByLabel('Confirm password', {exact: true}).fill(password);
      await adminPage.getByRole('button', {name: 'Create identity and choose backup', exact: true}).click();
      await adminPage.getByText('Issued: 0').waitFor();
      await admin.evaluate(({dialog}, dir) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [dir]}); }, root);
      await adminPage.getByRole('button', {name: 'Office Installer', exact: true}).click();
      await adminPage.getByLabel('Installer version', {exact: true}).fill('1.0.0');
      await adminPage.getByRole('button', {name: 'Generate Office Installer', exact: true}).click();
      await adminPage.getByText('Created ').waitFor({timeout: 240000});
      const officeInstaller = path.join(root, 'Azwah-Multi-Browser-Office-Setup-x64.exe');
      check(fs.existsSync(officeInstaller), 'Admin GUI generated an Office installer');
      const officeDir = path.join(process.env.ProgramFiles, 'Azwah Multi Browser Office');
      execFileSync(officeInstaller, ['/S'], {timeout: 240000});
      office = await _electron.launch({executablePath: path.join(officeDir, 'Azwah Multi Browser Office.exe'), env: closedEnv(path.join(root, 'office-data')), timeout: 60000});
      const officePage = await office.firstWindow();
      await officePage.waitForFunction(() => !!window.pm, {timeout: 60000});
      await officePage.setViewportSize({width: 1366, height: 768});
      const device = await officePage.getByLabel('Device identity code').inputValue();
      await adminPage.getByRole('button', {name: 'Employees', exact: true}).click();
      await adminPage.getByLabel('Employee reference', {exact: true}).fill('firefox-employee');
      await adminPage.getByLabel('Name', {exact: true}).fill('Disposable employee');
      await adminPage.getByLabel('Device code', {exact: true}).fill(device);
      await adminPage.getByRole('button', {name: 'Save employee', exact: true}).click();
      await adminPage.getByText('Devices: 1').waitFor();
      await adminPage.getByRole('button', {name: 'Generate License', exact: true}).click();
      await adminPage.getByLabel('Employee reference', {exact: true}).fill('firefox-employee');
      await adminPage.locator('section').getByRole('button', {name: 'Generate License', exact: true}).click();
      await adminPage.getByText('Issued: 1').waitFor();
      await adminPage.getByRole('button', {name: 'Active Licenses', exact: true}).click();
      await admin.evaluate(({dialog}, file) => { dialog.showSaveDialog = async () => ({canceled: false, filePath: file}); }, tokenFile);
      await adminPage.getByRole('button', {name: 'Save License File', exact: true}).click();
      await officePage.getByLabel('License file').setInputFiles(tokenFile);
      await officePage.getByLabel('I authorize activation on this device.').check();
      await officePage.getByRole('button', {name: 'Activate offline', exact: true}).click();
      await officePage.getByText('This device is activated').waitFor();
      await officePage.screenshot({path: path.join(evidence, 'screenshots', 'office-activated-1366x768.png')});
      record.office = await proveFirefox(officePage, officeDir);
      record.officeInstaller = {bytes: fs.statSync(officeInstaller).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(officeInstaller)).digest('hex'), published: false, reason: 'Contains only the disposable test organization public key; not uploaded as a release.'};
      record.adminInstaller = {bytes: fs.statSync(adminInstaller).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(adminInstaller)).digest('hex')};
    } finally {
      if (office) await office.close().catch(() => {});
      await admin.close().catch(() => {});
    }
  }
} catch (error) {
  if (!results.some(item => !item.pass && item.message === error.message)) results.push({pass: false, phase, message: error.message});
  console.error('FIREFOX_PAYLOAD_FAILURE', error.message);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(evidence, `${phase}.json`), JSON.stringify({...record, results}, null, 2));
  fs.rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
}
if (process.exitCode) process.exit(process.exitCode);
