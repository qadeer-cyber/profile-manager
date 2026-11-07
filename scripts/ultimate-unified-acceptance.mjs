// Installed unified Ultimate app: owner features, in-window license admin, generated Office, bundled Firefox.
import {execFileSync, spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import {_electron, chromium} from 'playwright';
import {open} from './license-admin/admin.mjs';
import {asarHasEntry, normalizeAsarEntry, readAsarEntry} from './asar-entries.mjs';
import {startLocalHttpFixture} from '../test/_local-http-fixture.mjs';

if (process.platform !== 'win32' || process.env.CI !== 'true') throw new Error('An isolated Windows CI worker is required');
const asar = createRequire(import.meta.url)('@electron/asar');
const root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'azwah-unified-'));
const appData = process.env.APPDATA;
const migrationOnly = process.env.AZWAH_MIGRATION_ONLY === '1';
const installerOverride = process.env.AZWAH_UNIFIED_INSTALLER;
const expectedInstallerHash = process.env.AZWAH_UNIFIED_INSTALLER_SHA256;
const installer = path.resolve(installerOverride || 'release-ultimate/Azwah-Multi-Browser-Ultimate-Setup-x64.exe');
const evidence = path.resolve('build-evidence/ultimate-unified');
fs.mkdirSync(path.join(evidence, 'screenshots'), {recursive: true});
const results = [];
const check = (ok, message) => { results.push({pass: !!ok, message}); console.log(`${ok ? 'PASS' : 'FAIL'} ${message}`); if (!ok) throw new Error(message); };
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function closedEnv(extra = {}) {
  const env = {...process.env, PM_FIREFOX_NO_SYSTEM: '1', PATH: 'C:\\Windows\\System32', ProgramFiles: path.join(root, 'empty-pf'), 'ProgramFiles(x86)': path.join(root, 'empty-pf-x86'), ...extra};
  delete env.PM_USER_DATA; delete env.PM_FIREFOX_EXECUTABLE; delete env.PM_FIREFOX_RESOURCES;
  fs.mkdirSync(env.ProgramFiles, {recursive: true}); fs.mkdirSync(env['ProgramFiles(x86)'], {recursive: true});
  return env;
}
async function api(page, route, body) {
  return page.evaluate(async ({route, body}) => {
    const response = await fetch('/api' + route, {method: body === undefined ? 'GET' : 'POST', headers: {'Content-Type': 'application/json', 'X-UI-Token': window.pm.uiToken}, body: body === undefined ? undefined : JSON.stringify(body)});
    const text = await response.text();
    let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = {raw: text.slice(0, 300)}; }
    return {status: response.status, body: parsed};
  }, {route, body});
}
function processImage(pid) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${Number(pid)} -ErrorAction Stop).Path`], {encoding: 'utf8'});
  if (result.status !== 0) throw new Error(result.stderr || 'process path unavailable');
  return result.stdout.trim();
}

const password = 'Unified vault passphrase ' + crypto.randomUUID();
let ownerApp, adminApp, unified, office;
const record = {windows10: false, systemFirefoxUsed: false, separateAdminPublished: false};
try {
  if (!appData || !path.isAbsolute(appData)) throw new Error('Windows roaming AppData is unavailable');
  if (installerOverride || migrationOnly) {
    if (!installerOverride || !/^[a-f0-9]{64}$/i.test(expectedInstallerHash || '') ||
        sha(installer) !== expectedInstallerHash.toLowerCase()) {
      throw new Error('Installer reuse requires an explicit EXE and its verified SHA-256');
    }
  }
  record.installer = {bytes: fs.statSync(installer).size, sha256: sha(installer)};
  for (const directory of ['azwah-multi-browser-owner', 'azwah-license-admin', 'Azwah License Admin', 'azwah-multi-browser-ultimate']) {
    if (fs.existsSync(path.join(appData, directory))) throw new Error('Migration acceptance requires a clean Windows user account');
  }
  const oldOwner = path.resolve('prior-installers/Azwah-Multi-Browser-Full-Setup-x64.exe');
  const oldAdmin = path.resolve('prior-installers/Azwah-License-Admin-Setup-x64.exe');
  const ownerDir = path.join(root, 'old-owner');
  const adminDir = path.join(root, 'old-admin');
  execFileSync(oldOwner, ['/S', '/D=' + ownerDir], {timeout: 240000});
  execFileSync(oldAdmin, ['/S', '/D=' + adminDir], {timeout: 240000});
  ownerApp = await _electron.launch({executablePath: path.join(ownerDir, 'Azwah Multi Browser Owner.exe'), env: closedEnv(), timeout: 60000});
  const ownerPage = await ownerApp.firstWindow();
  await ownerPage.waitForFunction(() => !!window.pm, {timeout: 60000});
  const ownerPaths = await ownerApp.evaluate(({app}) => ({appData: app.getPath('appData'), userData: app.getPath('userData')}));
  check(path.relative(appData, ownerPaths.appData) === '', 'Owner uses the clean Windows AppData root');
  const ownerDb = path.join(ownerPaths.userData, 'data', 'profiles.db');
  const created = await api(ownerPage, '/profiles', {name: 'Kept from Owner', notes: 'migration-marker'});
  check(created.status === 201, 'Previous Owner installer stores a profile without activation');
  await ownerApp.close(); ownerApp = undefined;
  const ownerHash = sha(ownerDb);
  adminApp = await _electron.launch({executablePath: path.join(adminDir, 'Azwah License Admin.exe'), env: closedEnv(), timeout: 60000});
  const adminPaths = await adminApp.evaluate(({app}) => ({appData: app.getPath('appData'), userData: app.getPath('userData')}));
  check(path.relative(appData, adminPaths.appData) === '', 'Admin uses the clean Windows AppData root');
  const sourceVault = path.join(adminPaths.userData, 'organization.vault');
  const adminPage = await adminApp.firstWindow();
  const backup = path.join(root, 'source-organization.vault');
  await adminPage.getByText('Welcome to Azwah License Admin').waitFor();
  await adminApp.evaluate(({dialog}, file) => { dialog.showSaveDialog = async () => ({canceled: false, filePath: file}); }, backup);
  await adminPage.getByLabel('Organization', {exact: true}).fill('Preserved organization');
  await adminPage.getByLabel('Master password (14 characters minimum)', {exact: true}).fill(password);
  await adminPage.getByLabel('Confirm password', {exact: true}).fill(password);
  await adminPage.getByRole('button', {name: 'Create identity and choose backup', exact: true}).click();
  await adminPage.getByText('Issued: 0').waitFor();
  await adminApp.close(); adminApp = undefined;
  const sourceKey = open(backup, password).publicKey;
  const vaultHash = sha(sourceVault);
  check(!sourceKey.includes('PRIVATE'), 'Previous Admin vault public key can be read by the test harness');

  const ultimateDir = path.join(root, 'ultimate');
  execFileSync(installer, ['/S', '/D=' + ultimateDir], {timeout: 240000});
  check(fs.existsSync(path.join(ultimateDir, 'resources', 'firefox', 'firefox.exe')), 'Unified installer contains Firefox');
  check(fs.existsSync(path.join(ultimateDir, 'resources', 'FIREFOX-REDISTRIBUTION.txt')), 'Unified installer contains the Firefox license notice');
  const ultimateArchive = path.join(ultimateDir, 'resources', 'app.asar');
  const ultimateEntries = asar.listPackage(ultimateArchive);
  const requiredModules = ['server/ultimate-admin.js', 'scripts/license-admin/admin.mjs', 'scripts/license-admin/issuer.mjs', 'server/office/license.js'];
  for (const name of requiredModules) {
    check(asarHasEntry(ultimateEntries, name), `Unified package contains ${name}`);
    const bytes = readAsarEntry(asar, ultimateArchive, name);
    check(Buffer.isBuffer(bytes) && bytes.length > 0, `Unified package can read ${name}`);
  }
  const adminSource = readAsarEntry(asar, ultimateArchive, 'server/ultimate-admin.js').toString('utf8');
  const issuerSource = readAsarEntry(asar, ultimateArchive, 'scripts/license-admin/issuer.mjs').toString('utf8');
  check(adminSource.includes('../scripts/license-admin/admin.mjs') && issuerSource.includes('../../server/office/license.js') && !adminSource.includes('BEGIN PRIVATE KEY'), 'In-process license administration module links to its issuance dependency');
  check(!ultimateEntries.some(entry => /issuer-public\.pem|organization\.vault|BEGIN PRIVATE KEY/.test(normalizeAsarEntry(entry))), 'Unified application archive has no issuer certificate or vault');
  unified = await _electron.launch({executablePath: path.join(ultimateDir, 'Azwah Multi Browser Ultimate.exe'), env: closedEnv(), timeout: 90000});
  const page = await unified.firstWindow();
  await page.waitForFunction(() => !!window.pm, {timeout: 90000});
  await page.setViewportSize({width: 1366, height: 768});
  const info = await page.evaluate(() => window.pm.appInfo());
  check(info.product === 'Azwah Multi Browser Ultimate' && info.edition === 'Ultimate', 'Installed product is the single Ultimate application');
  const activation = await api(page, '/activation');
  check(activation.body.edition === 'ultimate' && activation.body.enforced === false && activation.body.active === true, 'Owner browser features do not require employee activation');
  const migrated = (await api(page, '/profiles')).body.find(item => item.name === 'Kept from Owner');
  check(migrated?.notes === 'migration-marker', 'Profiles from the previous Owner installation are readable');
  const receipt = JSON.parse(fs.readFileSync(path.join(info.userData, 'azwah-ultimate-migration.json'), 'utf8'));
  check(receipt.copied.some(item => item.kind === 'owner-data' && item.sha256 === ownerHash), 'Owner database matched at migration before backend startup');
  check(sha(path.join(info.userData, 'organization.vault')) === vaultHash, 'Migrated vault bytes match the previous Admin vault');
  check(sha(ownerDb) === ownerHash && sha(sourceVault) === vaultHash, 'Source Owner database and Admin vault are unchanged');
  const locked = await api(page, '/admin/status');
  check(locked.status === 200 && locked.body.exists === true && locked.body.unlocked === false, 'Migrated Admin vault starts locked');
  check((await api(page, '/admin/list')).status === 401, 'Locked vault denies access to its records');
  const added = await api(page, '/profiles', {name: 'While vault locked'});
  check(added.status === 201, 'A profile can be created while the administrator vault is locked');
  await page.locator('[data-nav=license-admin]').click();
  await page.screenshot({path: path.join(evidence, 'screenshots', 'license-admin-locked-1366x768.png')});
  await page.getByLabel('Master password', {exact: true}).fill('not-the-preserved-password');
  await page.getByRole('button', {name: 'Unlock', exact: true}).click();
  await page.getByText('Incorrect password or damaged vault').waitFor();
  check(true, 'Wrong vault password is rejected');
  await page.getByLabel('Master password', {exact: true}).fill(password);
  await page.getByRole('button', {name: 'Unlock', exact: true}).click();
  await page.getByRole('heading', {name: 'Preserved organization'}).waitFor();
  const listed = await api(page, '/admin/list');
  check(listed.status === 200 && listed.body.publicKey === sourceKey && !JSON.stringify(listed.body).includes('PRIVATE KEY'), 'Unlocked vault reports the same public key and no private key');
  record.migration = {ownerDbSha256: ownerHash, vaultSha256: vaultHash, publicKeySha256: crypto.createHash('sha256').update(sourceKey).digest('hex')};
  if (!migrationOnly) {
    const device = 'AZD1-' + 'cd'.repeat(32);
    await page.getByLabel('Employee reference', {exact: true}).fill('migrated-desk');
    await page.getByLabel('Name', {exact: true}).fill('Desk');
    await page.getByLabel('Device code', {exact: true}).fill(device);
    await page.getByRole('button', {name: 'Save employee', exact: true}).click();
    await page.getByLabel('Validity in days', {exact: true}).fill('30');
    await page.getByRole('button', {name: 'Issue license', exact: true}).click();
    await page.getByText(/^AZW1\./).waitFor();
    const issuedToken = await page.locator('textarea').inputValue();
    check(issuedToken.startsWith('AZW1.') && !issuedToken.includes('PRIVATE'), 'Issued license token is not a signing key');
    await page.getByRole('button', {name: 'Reissue', exact: true}).click();
    await page.getByText(/^AZW1\./).waitFor();
    const reissued = await page.locator('textarea').inputValue();
    check(reissued !== issuedToken, 'Reissue produces a replacement license');
    const exportFile = path.join(root, 'exported.azwah');
    fs.writeFileSync(exportFile, reissued, {mode: 0o600});
    check(fs.readFileSync(exportFile, 'utf8') === reissued, 'License token can be exported to a file');
    const backupOut = path.join(root, 'ultimate-backup.vault');
    await unified.evaluate(({dialog}, file) => { dialog.showSaveDialog = async () => ({canceled: false, filePath: file}); }, backupOut);
    await page.getByRole('button', {name: 'Save encrypted backup', exact: true}).click();
    await page.getByText('Backup saved').waitFor();
    check(open(backupOut, password).publicKey === sourceKey && !fs.readFileSync(backupOut, 'utf8').includes('PRIVATE KEY'), 'Organization backup restores the same public key and stays encrypted');
    await page.getByRole('button', {name: 'Lock', exact: true}).click();
    await page.getByRole('heading', {name: 'Unlock vault'}).waitFor();
    const officeOut = path.join(root, 'generated-office');
    fs.mkdirSync(officeOut, {recursive: true});
    await page.getByLabel('Master password', {exact: true}).fill(password);
    await page.getByRole('button', {name: 'Unlock', exact: true}).click();
    await page.getByRole('heading', {name: 'Preserved organization'}).waitFor();
    await unified.evaluate(({dialog}, dir) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [dir]}); }, officeOut);
    await page.getByRole('button', {name: 'Generate Office installer', exact: true}).click();
    await page.getByText('Office installer created').waitFor({timeout: 240000});
    const officeInstaller = path.join(officeOut, 'Azwah-Multi-Browser-Office-Setup-x64.exe');
    check(fs.existsSync(officeInstaller), 'Integrated Admin generated an Office installer');
    const officeDir = path.join(root, 'office');
    execFileSync(officeInstaller, ['/S', '/D=' + officeDir], {timeout: 240000});
    const officeList = asar.listPackage(path.join(officeDir, 'resources', 'app.asar')).join('\n');
    check(!officeList.includes('ultimate-admin.js') && !officeList.includes('license-admin') && !officeList.includes('BEGIN PRIVATE KEY'), 'Employee package has no issuance module and no private key');
    check(fs.existsSync(path.join(officeDir, 'resources', 'firefox', 'firefox.exe')) && fs.existsSync(path.join(officeDir, 'resources', 'browsers')), 'Employee package contains bundled Firefox and Chromium');
    office = await _electron.launch({executablePath: path.join(officeDir, 'Azwah Multi Browser Office.exe'), env: closedEnv(), timeout: 90000});
    const employee = await office.firstWindow();
    await employee.waitForFunction(() => !!window.pm, {timeout: 90000});
    await employee.setViewportSize({width: 1366, height: 768});
    check(await employee.locator('[data-nav=license-admin]').count() === 0, 'Employee window has no license-administration section');
    const employeeDevice = await employee.getByLabel('Device identity code').inputValue();
    const wrong = await api(employee, '/activation', {token: reissued, confirm: true});
    check(wrong.status === 400, 'Office rejects a license for a different device');
    const parts = reissued.split('.');
    parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    const tamper = await api(employee, '/activation', {token: parts.join('.'), confirm: true});
    check(tamper.body?.code === 'LICENSE_SIGNATURE_INVALID', 'Office rejects a tampered signature');
    await unified.bringToFront();
    await page.getByLabel('Employee reference', {exact: true}).fill('office-desk');
    await page.getByLabel('Name', {exact: true}).fill('Office desk');
    await page.getByLabel('Device code', {exact: true}).fill(employeeDevice);
    await page.getByRole('button', {name: 'Save employee', exact: true}).click();
    await page.getByRole('button', {name: 'Issue license', exact: true}).click();
    const officeToken = await page.locator('textarea').inputValue();
    const licenseFile = path.join(root, 'office-employee.azwah');
    fs.writeFileSync(licenseFile, officeToken);
    await employee.bringToFront();
    await employee.getByLabel('License file').setInputFiles(licenseFile);
    await employee.getByLabel('I authorize activation on this device.').check();
    await employee.getByRole('button', {name: 'Activate offline', exact: true}).click();
    await employee.getByText('This device is activated').waitFor();
    await employee.screenshot({path: path.join(evidence, 'screenshots', 'office-activated-1366x768.png')});
    const fixture = await startLocalHttpFixture();
    const fx = await api(employee, '/profiles', {name: 'Office Firefox', browserEngine: 'firefox', browserSettings: {firefoxSessionMode: 'bidi', timezoneId: 'UTC'}});
    const launched = await api(employee, `/profiles/${fx.body.id}/launch`, {headless: true, automation: true, url: fixture.origin});
    check(launched.status === 200, 'Office launches Firefox without a system Firefox');
    const image = processImage((await api(employee, `/profiles/${fx.body.id}`)).body.pid);
    check(image.toLowerCase() === path.join(officeDir, 'resources', 'firefox', 'firefox.exe').toLowerCase(), 'Office Firefox process image is inside the employee install tree');
    await api(employee, `/profiles/${fx.body.id}/stop`, {});
    await fixture.close();
    await office.close(); office = undefined;

    await page.bringToFront();
    await page.locator('[data-nav=profiles]').click();
    await page.getByRole('button', {name: 'New profile'}).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', {exact: true}).fill('GUI proxy');
    await dialog.getByRole('tab', {name: 'Proxy'}).click();
    await dialog.getByRole('radio', {name: 'Custom'}).click();
    await dialog.getByRole('radio', {name: 'HTTP'}).click();
    const proxy = http.createServer((req, res) => { res.writeHead(200, {'content-type': 'application/json'}); res.end('{"ip":"203.0.113.50"}'); });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    await dialog.getByLabel('Proxy details').fill(`127.0.0.1:${proxy.address().port}`);
    await dialog.getByRole('button', {name: 'Hide credentials'}).click();
    await page.screenshot({path: path.join(evidence, 'screenshots', 'unified-proxy-custom-1366x768.png')});
    await dialog.getByRole('button', {name: 'Create profile'}).click();
    await page.getByRole('cell', {name: 'GUI proxy', exact: true}).waitFor();
    const saved = (await api(page, '/profiles')).body.find(item => item.name === 'GUI proxy');
    check(saved.proxy?.host === '127.0.0.1' && saved.proxy.password === '', 'One-line proxy persisted without inventing a password');
    proxy.close();

    record.officeInstaller = {bytes: fs.statSync(officeInstaller).size, sha256: sha(officeInstaller), published: false};
  }
} catch (error) {
  if (!results.some(item => !item.pass && item.message === error.message)) results.push({pass: false, message: error.message});
  console.error('UNIFIED_ACCEPTANCE_FAILURE', error.message);
  process.exitCode = 1;
} finally {
  if (ownerApp) await ownerApp.close().catch(() => {});
  if (adminApp) await adminApp.close().catch(() => {});
  if (office) await office.close().catch(() => {});
  if (unified) await unified.close().catch(() => {});
  fs.writeFileSync(path.join(evidence, 'acceptance.json'), JSON.stringify({...record, results}, null, 2));
  fs.rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
}
if (process.exitCode) process.exit(process.exitCode);
