import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {_electron} from 'playwright';

assert.equal(process.platform,'win32');
assert.equal(process.env.CI,'true');
const root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(),'azwah-admin-qa-'));
const install = path.join(root,'installed');
const password = 'Synthetic QA ' + crypto.randomUUID();
const backup = path.join(root,'organization-backup.vault');
let app, page;
async function launch(name) {
  app = await _electron.launch({executablePath:path.join(install,'Azwah Multi Browser Ultimate.exe'),env:{...process.env,PM_USER_DATA:path.join(root,name)},timeout:90000});
  page = await app.firstWindow();
  await page.waitForFunction(() => !!window.pm?.uiToken,undefined,{timeout:90000});
  await page.locator('[data-nav=license-admin]').click();
}
const request = (route, body) => page.evaluate(async ({route,body}) => {
  const r = await fetch('/api/admin/' + route,{method:body === undefined ? 'GET' : 'POST',headers:{'X-UI-Token':window.pm.uiToken,'Content-Type':'application/json'},body:body === undefined ? undefined : JSON.stringify(body)});
  return {status:r.status,body:await r.json()};
},{route,body});
async function clickRequest(label, route) {
  const [response] = await Promise.all([
    page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/admin/' + route),
    page.getByRole('button',{name:label,exact:true}).click(),
  ]);
  assert.equal(response.status(),200);
  const result = await response.json();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return result;
}
try {
  execFileSync(path.resolve('release-ultimate/Azwah-Multi-Browser-Ultimate-Setup-x64.exe'),['/S','/D=' + install],{timeout:240000});
  await launch('source');
  const created = await request('init',{organization:'QA Backup Organization',password,confirm:password});
  assert.equal(created.status,200);
  await page.reload();
  await page.locator('[data-nav=license-admin]').click();
  await page.getByRole('heading',{name:'QA Backup Organization',exact:true}).waitFor();
  await app.evaluate(({dialog}) => {
    dialog.showSaveDialog = async () => ({canceled:true});
    dialog.showOpenDialog = async () => ({canceled:true,filePaths:[]});
  });
  assert.deepEqual(await clickRequest('Save encrypted backup','backup'),{canceled:true});
  assert.deepEqual(await clickRequest('Generate Office installer','office-installer'),{canceled:true});
  assert.equal(await page.getByText('Backup saved',{exact:true}).count(),0);
  assert.equal(await page.getByText('Office installer created',{exact:true}).count(),0);
  console.log('PASS native backup and generation cancellation without success toast');
  await app.evaluate(({dialog},file) => {dialog.showSaveDialog = async () => ({canceled:false,filePath:file});},backup);
  await clickRequest('Save encrypted backup','backup');
  await page.getByText('Backup saved',{exact:true}).waitFor();
  assert.ok(fs.statSync(backup).size > 0);
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const sourceVault = path.join(root,'source','organization.vault');
  const before = hash(sourceVault);
  await app.close(); app = undefined;
  await launch('restored');
  await page.getByRole('heading',{name:'Create organization',exact:true}).waitFor();
  await app.evaluate(({dialog},file) => {dialog.showOpenDialog = async () => ({canceled:false,filePaths:[file]});},backup);
  await page.getByLabel('Master password (14 characters minimum)',{exact:true}).fill(password);
  await clickRequest('Restore encrypted backup','restore');
  await page.getByRole('heading',{name:'QA Backup Organization',exact:true}).waitFor();
  const restored = await request('list');
  assert.equal(restored.body.publicKey,created.body.publicKey);
  assert.equal(hash(sourceVault),before);
  assert.equal(JSON.stringify(restored.body).includes('PRIVATE KEY'),false);
  console.log('PASS actual encrypted backup restore on empty data and original vault preservation');
} finally {
  if (app) await app.close().catch(() => {});
  fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
