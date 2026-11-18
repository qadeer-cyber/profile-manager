// Isolated Windows probe. Uses the already published Owner and Admin installers.
// It does not build, download, or repackage Chromium or Firefox.
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {_electron} from 'playwright';
import {migrateUltimateData} from '../electron/ultimate-migrate.js';

if (process.platform !== 'win32' || process.env.CI !== 'true') throw new Error('An isolated Windows CI worker is required');
const require = createRequire(import.meta.url);
const root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'azwah-path-probe-'));
const appData = path.join(root, 'appdata');
const evidence = path.resolve('build-evidence/migration-path');
fs.mkdirSync(evidence, {recursive: true});
fs.mkdirSync(appData, {recursive: true});
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function closedEnv() {
  const env = {...process.env, APPDATA: appData, PM_FIREFOX_NO_SYSTEM: '1', PATH: 'C:\\Windows\\System32', ProgramFiles: path.join(root, 'empty-pf'), 'ProgramFiles(x86)': path.join(root, 'empty-pf-x86')};
  delete env.PM_USER_DATA; delete env.PM_FIREFOX_EXECUTABLE; delete env.PM_FIREFOX_RESOURCES;
  fs.mkdirSync(env.ProgramFiles, {recursive: true}); fs.mkdirSync(env['ProgramFiles(x86)'], {recursive: true});
  return env;
}
function listing(dir) {
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir).map(name => {
    const stat = fs.lstatSync(path.join(dir, name));
    return {name, bytes: stat.isFile() ? stat.size : null, directory: stat.isDirectory(), symlink: stat.isSymbolicLink()};
  });
}
function readRows(file) {
  let DatabaseSync;
  try { ({DatabaseSync} = require('node:sqlite')); }
  catch (error) { return {error: error.message}; }
  let db;
  const snapshot = fs.mkdtempSync(path.join(root, 'sqlite-inspection-'));
  try {
    const copy = path.join(snapshot, 'profiles.db');
    fs.copyFileSync(file, copy);
    db = new DatabaseSync(copy, {readOnly: true});
    const profiles = db.prepare('SELECT name, notes FROM profiles ORDER BY name').all();
    let workspaces = null;
    try { workspaces = db.prepare('SELECT name, notes FROM workspaces ORDER BY name').all(); } catch { workspaces = null; }
    return {profiles, workspaces};
  } catch (error) {
    return {error: error.message};
  } finally { db?.close(); fs.rmSync(snapshot, {recursive: true, force: true}); }
}
async function rendererPost(page, route, body) {
  return page.evaluate(async ({route, body}) => {
    const response = await fetch('/api' + route, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-UI-Token': window.pm.uiToken}, body: JSON.stringify(body)});
    return {status: response.status};
  }, {route, body});
}

const report = {
  harness: 'owner-data-path-probe',
  harnessSha: process.env.GITHUB_SHA || null,
  assumedAppData: appData,
  assumedOwnerDb: path.join(appData, 'azwah-multi-browser-owner', 'data', 'profiles.db'),
  assumedAdminVault: path.join(appData, 'Azwah License Admin', 'organization.vault'),
  installers: {},
  owner: null,
  admin: null,
  migration: null,
  conclusion: null,
};
let ownerApp, adminApp;
try {
  const ownerInstaller = path.resolve('prior-installers/Azwah-Multi-Browser-Full-Setup-x64.exe');
  const adminInstaller = path.resolve('prior-installers/Azwah-License-Admin-Setup-x64.exe');
  report.installers.owner = {bytes: fs.statSync(ownerInstaller).size, sha256: sha(ownerInstaller), tag: 'azwah-multi-browser-owner-experimental.1'};
  report.installers.admin = {bytes: fs.statSync(adminInstaller).size, sha256: sha(adminInstaller), tag: 'azwah-license-admin-experimental.1'};
  const ownerDir = path.join(root, 'old-owner');
  execFileSync(ownerInstaller, ['/S', '/D=' + ownerDir], {timeout: 240000});
  ownerApp = await _electron.launch({executablePath: path.join(ownerDir, 'Azwah Multi Browser Owner.exe'), env: closedEnv(), timeout: 60000});
  const ownerPage = await ownerApp.firstWindow();
  await ownerPage.waitForFunction(() => !!window.pm, {timeout: 60000});
  const created = await rendererPost(ownerPage, '/profiles', {name: 'Kept from Owner', notes: 'migration-marker'});
  const workspace = await rendererPost(ownerPage, '/workspaces', {name: 'Kept workspace', notes: 'migration-workspace'});
  const paths = await ownerApp.evaluate(({app}) => ({userData: app.getPath('userData'), appData: app.getPath('appData'), name: app.getName(), envAppData: process.env.APPDATA || null}));
  const info = await ownerPage.evaluate(() => window.pm.appInfo());
  await ownerApp.close(); ownerApp = undefined;
  const reportedDb = path.join(paths.userData, 'data', 'profiles.db');
  report.owner = {
    createStatus: created.status,
    workspaceStatus: workspace.status,
    paths,
    rendererUserData: info.userData,
    assumedDbExists: fs.existsSync(report.assumedOwnerDb),
    reportedDb,
    reportedDbExists: fs.existsSync(reportedDb),
    wal: fs.existsSync(reportedDb + '-wal'),
    shm: fs.existsSync(reportedDb + '-shm'),
    reportedDataListing: listing(path.join(paths.userData, 'data')),
    assumedDataListing: listing(path.join(appData, 'azwah-multi-browser-owner', 'data')),
    sourceHash: fs.existsSync(reportedDb) ? sha(reportedDb) : null,
    rows: fs.existsSync(reportedDb) ? readRows(reportedDb) : null,
  };

  const adminDir = path.join(root, 'old-admin');
  execFileSync(adminInstaller, ['/S', '/D=' + adminDir], {timeout: 240000});
  adminApp = await _electron.launch({executablePath: path.join(adminDir, 'Azwah License Admin.exe'), env: closedEnv(), timeout: 60000});
  const adminPaths = await adminApp.evaluate(({app}) => ({userData: app.getPath('userData'), appData: app.getPath('appData'), name: app.getName(), envAppData: process.env.APPDATA || null}));
  await adminApp.close(); adminApp = undefined;
  report.admin = {
    vaultCreated: false,
    paths: adminPaths,
    assumedDirectory: path.join(appData, 'Azwah License Admin'),
    assumedDirectoryExists: fs.existsSync(path.join(appData, 'Azwah License Admin')),
    reportedUserData: adminPaths.userData,
  };

  if (report.owner.reportedDbExists) {
    const ultimateDir = path.join(root, 'ultimate-migrated');
    const before = report.owner.sourceHash;
    const receipt = migrateUltimateData({appData: paths.appData, ultimateDir});
    const copiedDb = path.join(ultimateDir, 'data', 'profiles.db');
    const copiedRows = fs.existsSync(copiedDb) ? readRows(copiedDb) : null;
    report.migration = {
      appData: paths.appData,
      receiptCopied: receipt.copied.map(item => ({kind: item.kind, source: item.source, sha256: item.sha256})),
      conflicts: receipt.conflicts,
      copiedDbExists: fs.existsSync(copiedDb),
      copiedRows,
      sourceStillExists: fs.existsSync(reportedDb),
      sourceHashUnchanged: sha(reportedDb) === before,
    };
  }
  const profileKept = report.migration?.copiedRows?.profiles?.some(row => row.name === 'Kept from Owner' && row.notes === 'migration-marker');
  if (report.owner.createStatus === 201 && !report.owner.assumedDbExists && report.owner.reportedDbExists && profileKept && report.migration.sourceHashUnchanged) report.conclusion = 'test-path';
  else if (!report.owner.reportedDbExists) report.conclusion = 'source-database-missing';
  else report.conclusion = 'needs-inspection';
} catch (error) {
  report.error = error.message;
  report.conclusion = report.conclusion || 'probe-failed';
  process.exitCode = 1;
} finally {
  if (ownerApp) await ownerApp.close().catch(() => {});
  if (adminApp) await adminApp.close().catch(() => {});
  fs.writeFileSync(path.join(evidence, 'path-report.json'), JSON.stringify(report, null, 2));
  console.log('OWNER_DATA_PATH_REPORT ' + JSON.stringify(report));
  fs.rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
}
if (process.exitCode) process.exit(process.exitCode);
