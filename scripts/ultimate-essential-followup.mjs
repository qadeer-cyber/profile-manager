// Follow-on installed checks for the retained Ultimate installer.
// Does not rebuild browsers. Does not claim a copy is safe while Owner or Admin is still running.
import {execFileSync, spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {_electron} from 'playwright';
import {asarLookupPath} from './asar-entries.mjs';
import {windowsEmployeeIdentity} from './windows-employee-identity.mjs';
import {createRecordingProxy} from './recording-proxy.mjs';

if (process.platform !== 'win32' || process.env.CI !== 'true') throw new Error('An isolated Windows CI worker is required');
const asar = createRequire(import.meta.url)('@electron/asar');
const {DatabaseSync} = await import('node:sqlite');
const root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'azwah-essential-'));
const evidence = path.resolve('build-evidence/ultimate-essential');
fs.mkdirSync(evidence, {recursive: true});
const installer = path.resolve(process.env.AZWAH_UNIFIED_INSTALLER || 'release-ultimate/Azwah-Multi-Browser-Ultimate-Setup-x64.exe');
const expectedHash = (process.env.AZWAH_UNIFIED_INSTALLER_SHA256 || '').toLowerCase();
const results = [];
const record = {
  installerSource: process.env.AZWAH_INSTALLER_SOURCE_SHA || null,
  harness: process.env.GITHUB_SHA || null,
  concurrentMigration: 'unqualified — this job does not copy while Owner or Admin is running',
  windows10: false,
  separateStandardAccount: false,
  osSecretPrefix: null,
};
const check = (ok, message) => { results.push({pass: !!ok, message}); console.log(`${ok ? 'PASS' : 'FAIL'} ${message}`); if (!ok) throw new Error(message); };
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const password = 'Essential vault ' + crypto.randomUUID();
const proxyPassword = 'Px' + crypto.randomBytes(9).toString('base64url');
const cookieValue = 'Ck' + crypto.randomBytes(9).toString('base64url');
function closedEnv(extra = {}) {
  const env = {...process.env, PM_FIREFOX_NO_SYSTEM: '1', PROXY_TEST_URL: 'http://203.0.113.10/ip', PATH: 'C:\\Windows\\System32', ProgramFiles: path.join(root, 'empty-pf'), 'ProgramFiles(x86)': path.join(root, 'empty-pf-x86'), ...extra};
  delete env.PM_USER_DATA; delete env.PM_FIREFOX_EXECUTABLE; delete env.PM_FIREFOX_RESOURCES;
  fs.mkdirSync(env.ProgramFiles, {recursive: true}); fs.mkdirSync(env['ProgramFiles(x86)'], {recursive: true});
  return env;
}
async function api(page, route, body) {
  return page.evaluate(async ({route, body}) => {
    const response = await fetch('/api' + route, {method: body === undefined ? 'GET' : 'POST', headers: {'Content-Type': 'application/json', 'X-UI-Token': window.pm.uiToken}, body: body === undefined ? undefined : JSON.stringify(body)});
    const text = await response.text();
    let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = {raw: text.slice(0, 180)}; }
    return {status: response.status, body: parsed};
  }, {route, body});
}
function processImage(pid) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${Number(pid)} -ErrorAction Stop).Path`], {encoding: 'utf8'});
  if (result.status !== 0) throw new Error(result.stderr || 'process path unavailable');
  return result.stdout.trim();
}
async function replaceIssuedToken(page, previous) {
  await page.getByRole('button', {name: 'Issue license', exact: true}).click();
  await page.waitForFunction(old => {
    const value = document.querySelector('textarea')?.value || '';
    return value.startsWith('AZW1.') && value !== old;
  }, previous);
  return page.locator('textarea').inputValue();
}
function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

let app;
let employeeSession;
const hits = [];
const proxy = createRecordingProxy(hits);
try {
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || sha(installer) !== expectedHash) throw new Error('Follow-on requires the retained installer and its verified SHA-256');
  record.installer = {bytes: fs.statSync(installer).size, sha256: expectedHash};
  const installDir = path.join(root, 'ultimate');
  execFileSync(installer, ['/S', '/D=' + installDir], {timeout: 240000});
  const port = await listen(proxy);
  app = await _electron.launch({executablePath: path.join(installDir, 'Azwah Multi Browser Ultimate.exe'), env: closedEnv(), timeout: 90000});
  let page = await app.firstWindow();
  await page.waitForFunction(() => !!window.pm, {timeout: 90000});
  const info = await page.evaluate(() => window.pm.appInfo());
  const userData = info.userData;
  const dbPath = path.join(userData, 'data', 'profiles.db');
  const init = await api(page, '/admin/init', {organization: 'Essential organization', password, confirm: password});
  check(init.status === 200 && init.body.publicKey && !init.body.publicKey.includes('PRIVATE'), 'Installed Ultimate created an organization identity');
  await page.locator('[data-nav=profiles]').click();
  await page.getByRole('button', {name: 'New profile'}).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', {exact: true}).fill('GUI proxy');
  await dialog.getByRole('tab', {name: 'Proxy'}).click();
  await dialog.getByRole('radio', {name: 'Custom'}).click();
  await dialog.getByRole('radiogroup', {name: 'Proxy protocol'}).getByRole('radio', {name: 'HTTP', exact: true}).click();
  await dialog.getByLabel('Proxy details').fill(`127.0.0.1:${port}:azwah:${proxyPassword}`);
  await dialog.getByRole('button', {name: 'Test Proxy'}).click();
  await dialog.getByText(/Transport ok/).waitFor({timeout: 20000});
  check(hits.some(url => url.includes('/ip')), 'Test Proxy sent a request through the saved proxy configuration');
  await dialog.getByRole('button', {name: 'Hide credentials'}).click();
  await dialog.getByRole('button', {name: 'Create profile'}).click();
  await page.getByRole('cell', {name: 'GUI proxy', exact: true}).waitFor();
  const saved = (await api(page, '/profiles')).body.find(item => item.name === 'GUI proxy');
  check(saved?.proxy?.host === '127.0.0.1' && saved.proxy.port === port && saved.proxy.hasPassword === true && saved.proxy.password !== proxyPassword, 'Proxy GUI saved the host and did not return the password');
  await app.close(); app = undefined;
  const database = new DatabaseSync(dbPath, {readOnly: true});
  let stored = '';
  try { stored = database.prepare('SELECT password FROM proxies WHERE host=?').get('127.0.0.1').password; }
  finally { database.close(); }
  check(stored !== proxyPassword && /^(ss:v1:|enc:v1:)/.test(stored), 'Proxy password is stored as a sealed secret');
  record.osSecretPrefix = stored.startsWith('ss:v1:') ? 'ss:v1' : stored.startsWith('enc:v1:') ? 'enc:v1' : 'other';
  app = await _electron.launch({executablePath: path.join(installDir, 'Azwah Multi Browser Ultimate.exe'), env: closedEnv(), timeout: 90000});
  page = await app.firstWindow();
  await page.waitForFunction(() => !!window.pm, {timeout: 90000});
  await page.getByRole('checkbox', {name: 'Select GUI proxy'}).check();
  await page.getByRole('button', {name: 'Edit selected'}).click();
  const reloaded = page.getByRole('dialog');
  await reloaded.getByRole('tab', {name: 'Proxy'}).click();
  await reloaded.getByLabel('Proxy details').waitFor();
  check((await reloaded.getByLabel('Proxy details').inputValue()).includes(`127.0.0.1:${port}`), 'Reloaded profile editor still shows the saved proxy');
  await reloaded.getByRole('button', {name: 'Test Proxy'}).click();
  await reloaded.getByText(/Transport ok/).waitFor({timeout: 20000});
  await reloaded.getByRole('button', {name: 'Save changes'}).click();
  const beforeRoute = hits.length;
  const routed = await api(page, `/profiles/${saved.id}/launch`, {headless: true, url: 'http://203.0.113.10/azwah-route'});
  check(routed.status === 200, 'Chromium launch accepted the profile');
  const routeDeadline = Date.now() + 20000;
  while (Date.now() < routeDeadline && !hits.slice(beforeRoute).some(url => url.includes('azwah-route'))) await new Promise(resolve => setTimeout(resolve, 250));
  check(hits.slice(beforeRoute).some(url => url.includes('azwah-route')), 'Chromium sent the requested URL through the configured proxy');
  const firstPid = (await api(page, `/profiles/${saved.id}`)).body.pid;
  const firstImage = processImage(firstPid);
  check(firstImage.toLowerCase().includes(path.join(installDir, 'resources', 'browsers').toLowerCase()), 'Chromium process image is inside the installer tree');
  check((await api(page, `/profiles/${saved.id}/stop`, {})).status === 200, 'Chromium stop succeeded');
  check((await api(page, `/profiles/${saved.id}/launch`, {headless: true})).status === 200, 'Chromium launch succeeded again after stop');
  check((await api(page, `/profiles/${saved.id}/stop`, {})).status === 200, 'Chromium stop succeeded after restart');

  const firefoxProfile = await api(page, '/profiles', {name: 'Bundled Firefox', browserEngine: 'firefox', browserSettings: {firefoxSessionMode: 'bidi', timezoneId: 'UTC'}});
  check(firefoxProfile.status === 201, 'Ultimate can create a Firefox profile');
  const firefoxLaunch = await api(page, `/profiles/${firefoxProfile.body.id}/launch`, {headless: true, automation: true});
  check(firefoxLaunch.status === 200, 'Ultimate launches Firefox without a system Firefox');
  const firefoxImage = processImage((await api(page, `/profiles/${firefoxProfile.body.id}`)).body.pid);
  check(firefoxImage.toLowerCase() === path.join(installDir, 'resources', 'firefox', 'firefox.exe').toLowerCase(), 'Ultimate Firefox process image is the bundled runtime');
  check((await api(page, `/profiles/${firefoxProfile.body.id}/stop`, {})).status === 200, 'Ultimate Firefox stop succeeded');

  const cookieProfile = await api(page, '/profiles', {name: 'Cookie shelf', browserEngine: 'chromium'});
  const cookie = {name: 'kept', value: cookieValue, domain: 'example.test', path: '/', secure: true, httpOnly: true, sameSite: 'Lax'};
  check((await api(page, `/profiles/${cookieProfile.body.id}/cookies/import`, {cookies: [cookie]})).status === 200, 'A cookie can be imported into a stopped profile');
  const extensionDir = path.join(root, 'extension');
  fs.mkdirSync(extensionDir);
  fs.writeFileSync(path.join(extensionDir, 'manifest.json'), JSON.stringify({manifest_version: 3, name: 'Kept Extension', version: '1.0.0'}));
  const imported = await api(page, '/extensions/import', {path: extensionDir});
  check(imported.status === 201, 'An unpacked extension can be imported');
  check((await api(page, `/profiles/${cookieProfile.body.id}/extensions`, {extensionId: imported.body.id, enabled: true})).status === 200, 'The extension can be assigned');
  const shelf = path.join(userData, 'data', 'profiles', cookieProfile.body.id);
  check(fs.existsSync(shelf), 'Profile storage directory exists');
  await app.close(); app = undefined;
  app = await _electron.launch({executablePath: path.join(installDir, 'Azwah Multi Browser Ultimate.exe'), env: closedEnv(), timeout: 90000});
  page = await app.firstWindow();
  await page.waitForFunction(() => !!window.pm, {timeout: 90000});
  const cookies = await api(page, `/profiles/${cookieProfile.body.id}/cookies`);
  check(cookies.body?.cookies?.some(item => item.name === 'kept' && item.value === cookieValue), 'Imported cookie remains after the application is reopened');
  const extensions = (await api(page, `/profiles/${cookieProfile.body.id}`)).body.extensions || [];
  check(extensions.some(item => item.name === 'Kept Extension' && item.enabled), 'Assigned extension remains after the application is reopened');
  check(fs.existsSync(shelf), 'Profile storage directory remains after the application is reopened');

  await page.locator('[data-nav=license-admin]').click();
  await page.getByLabel('Master password', {exact: true}).fill(password);
  await page.getByRole('button', {name: 'Unlock', exact: true}).click();
  await page.getByRole('heading', {name: 'Essential organization'}).waitFor();
  const officeOut = path.join(root, 'generated-office');
  fs.mkdirSync(officeOut);
  await app.evaluate(({dialog}, dir) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [dir]}); }, officeOut);
  await page.getByRole('button', {name: 'Generate Office installer', exact: true}).click();
  await page.getByText('Office installer created').waitFor({timeout: 240000});
  const officeInstaller = path.join(officeOut, 'Azwah-Multi-Browser-Office-Setup-x64.exe');
  const officeDir = path.join(root, 'office');
  execFileSync(officeInstaller, ['/S', '/D=' + officeDir], {timeout: 240000});
  const officeNames = asar.listPackage(path.join(officeDir, 'resources', 'app.asar')).map(name => name.replaceAll('\\', '/'));
  check(!officeNames.some(name => /ultimate-admin|license-admin|issuer-public\.pem|organization\.vault/.test(name)), 'Generated Office archive has no issuance module, issuer, or vault');
  const officeText = asar.extractFile(path.join(officeDir, 'resources', 'app.asar'), asarLookupPath('server/app.js')).toString('utf8');
  check(!officeText.includes('BEGIN PRIVATE KEY'), 'Generated Office server code has no private key');
  employeeSession = windowsEmployeeIdentity(officeDir, path.join(officeDir, 'Azwah Multi Browser Office.exe'));
  const employee = await employeeSession.launch();
  record.separateStandardAccount = true;
  const employeeDevice = await employee.getByLabel('Device identity code').inputValue();
  check(/^AZD1-[a-f0-9]{64}$/.test(employeeDevice), 'Separate standard account exposes its own device code');
  await page.bringToFront();
  await page.getByLabel('Employee reference', {exact: true}).fill('standard-desk');
  await page.getByLabel('Name', {exact: true}).fill('Standard desk');
  await page.getByLabel('Device code', {exact: true}).fill(employeeDevice);
  await page.getByRole('button', {name: 'Save employee', exact: true}).click();
  await page.getByText('Employee saved').waitFor();
  await app.evaluate(() => { globalThis.__azwahRealNow = Date.now; Date.now = () => globalThis.__azwahRealNow() - 5 * 86400000; });
  await page.getByLabel('Validity in days', {exact: true}).fill('1');
  const expiredToken = await replaceIssuedToken(page, '');
  await app.evaluate(() => { Date.now = globalThis.__azwahRealNow; delete globalThis.__azwahRealNow; });
  await page.getByLabel('Validity in days', {exact: true}).fill('30');
  const currentToken = await replaceIssuedToken(page, expiredToken);
  check(currentToken !== expiredToken && currentToken.startsWith('AZW1.'), 'A current license is distinct from the backdated license');
  const expired = await api(employee, '/activation', {token: expiredToken, confirm: true});
  check(expired.body?.code === 'LICENSE_EXPIRED', 'Office on the standard account rejects an expired license');
  const licenseFile = path.join(root, 'standard.azwah');
  fs.writeFileSync(licenseFile, currentToken);
  await employee.bringToFront();
  await employee.getByLabel('License file').setInputFiles(licenseFile);
  await employee.getByLabel('I authorize activation on this device.').check();
  await employee.getByRole('button', {name: 'Activate offline', exact: true}).click();
  try {
    await employee.getByText('This device is activated for offline use.', {exact: true}).waitFor();
  } catch (error) {
    const status = await employee.locator('[role=status]').allTextContents();
    throw new Error(`Office did not activate. Status: ${status.join(' | ').slice(0, 300)}`);
  }
  const activated = await api(employee, '/activation');
  check(activated.body?.active === true, 'Standard-account Office reports an active license');
  await employeeSession.close();
  const reopened = await employeeSession.launch();
  const persisted = await api(reopened, '/activation');
  check(persisted.body?.active === true, 'Standard-account activation remains after the Office application is reopened');
  const officeFirefox = await api(employee, '/profiles', {name: 'Office Firefox', browserEngine: 'firefox', browserSettings: {firefoxSessionMode: 'bidi', timezoneId: 'UTC'}});
  const officeLaunch = await api(employee, `/profiles/${officeFirefox.body.id}/launch`, {headless: true, automation: true});
  check(officeLaunch.status === 200, 'Generated Office launches Firefox without a system Firefox');
  const officeImage = processImage((await api(employee, `/profiles/${officeFirefox.body.id}`)).body.pid);
  check(officeImage.toLowerCase() === path.join(officeDir, 'resources', 'firefox', 'firefox.exe').toLowerCase(), 'Office Firefox process image is inside the employee install tree');
  check((await api(employee, `/profiles/${officeFirefox.body.id}/stop`, {})).status === 200, 'Office Firefox stop succeeded');
  await employeeSession.dispose(); employeeSession = undefined;

  await app.close(); app = undefined;
  const uninstaller = path.join(installDir, 'Uninstall Azwah Multi Browser Ultimate.exe');
  check(fs.existsSync(uninstaller), 'The installer provides an uninstaller');
  execFileSync(uninstaller, ['/S'], {timeout: 240000});
  check(fs.existsSync(dbPath), 'Uninstall leaves the profile database in place');
  execFileSync(installer, ['/S', '/D=' + installDir], {timeout: 240000});
  app = await _electron.launch({executablePath: path.join(installDir, 'Azwah Multi Browser Ultimate.exe'), env: closedEnv(), timeout: 90000});
  page = await app.firstWindow();
  await page.waitForFunction(() => !!window.pm, {timeout: 90000});
  const restored = (await api(page, '/profiles')).body.find(item => item.name === 'GUI proxy');
  check(restored?.proxy?.host === '127.0.0.1' && restored.proxy.hasPassword === true, 'Reinstall keeps the profile and its sealed proxy');
  check(fs.existsSync(path.join(userData, 'organization.vault')), 'Reinstall keeps the organization vault');
} catch (error) {
  if (!results.some(item => !item.pass && item.message === error.message)) results.push({pass: false, message: error.stack || error.message});
  console.error('ESSENTIAL_FOLLOWUP_FAILURE', error.message);
  process.exitCode = 1;
} finally {
  if (employeeSession) await employeeSession.dispose().catch(() => {});
  if (app) await app.close().catch(() => {});
  proxy.close();
  fs.writeFileSync(path.join(evidence, 'essential.json'), JSON.stringify({...record, results}, null, 2));
  fs.rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
}
if (process.exitCode) process.exit(process.exitCode);
