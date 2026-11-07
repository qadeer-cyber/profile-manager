import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {_electron} from 'playwright';

assert.equal(process.platform, 'win32');
assert.equal(process.env.CI, 'true');
const appData = process.env.APPDATA;
assert.ok(appData && !fs.existsSync(path.join(appData, 'azwah-multi-browser-ultimate')));
const root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'azwah-owner-qa-'));
const install = path.join(root, 'ultimate');
const env = {...process.env};
delete env.PM_USER_DATA;
let app, page;
const run = async () => {
  app = await _electron.launch({executablePath: path.join(install, 'Azwah Multi Browser Ultimate.exe'), env, timeout: 90000});
  page = await app.firstWindow();
  await page.waitForFunction(() => !!window.pm?.uiToken, undefined, {timeout: 90000});
};
const api = (method, route, body) => page.evaluate(async ({method, route, body}) => {
  const response = await fetch('/api' + route, {method, headers: {'X-UI-Token': window.pm.uiToken, 'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
  return {status: response.status, body: response.status === 204 ? null : await response.json()};
}, {method, route, body});
const expect = async (method, route, status, body) => {
  const response = await api(method, route, body);
  assert.equal(response.status, status, method + ' ' + route);
  return response.body;
};
try {
  execFileSync(path.resolve('release-ultimate/Azwah-Multi-Browser-Ultimate-Setup-x64.exe'), ['/S', '/D=' + install], {timeout: 240000});
  await run();
  const activation = await expect('GET', '/activation', 200);
  assert.equal(activation.active, true);
  assert.equal(activation.enforced, false);
  const workspace = await expect('POST', '/workspaces', 201, {name:'QA workspace'});
  const first = await expect('POST', '/profiles', 201, {name:'QA First', folder:'QA folder', workspaceId: workspace.id});
  const second = await expect('POST', '/profiles', 201, {name:'QA Second'});
  assert.equal(first.workspaceId, workspace.id);
  await expect('PUT', '/profiles/' + first.id, 200, {name:'QA Edited', folder:'QA folder', workspaceId:workspace.id});
  assert.equal((await expect('GET', '/profiles/' + first.id, 200)).name, 'QA Edited');
  console.log('PASS workspace assignment and profile create/edit');
  await page.locator('[data-nav=profiles]').click();
  await page.getByRole('button', {name:'New profile', exact:true}).click();
  const dialog = page.getByRole('dialog');
  for (const name of ['General','Proxy','Fingerprint','Extra']) {
    const tab = dialog.getByRole('tab', {name, exact:true});
    await tab.click();
    assert.equal(await tab.getAttribute('aria-selected'), 'true');
  }
  console.log('PASS General / Proxy / Fingerprint / Extra tabs can each be selected');
  await expect('POST', '/profiles/' + first.id + '/cookies/import', 200, {cookies:[{name:'owner-isolation', value:'isolated', domain:'example.test', path:'/', secure:true, httpOnly:true, sameSite:'Lax'}]});
  const previousSettings = await expect('GET', '/settings', 200);
  await expect('PUT', '/settings', 200, {defaultHeadless: !previousSettings.defaultHeadless});
  await app.close(); app = undefined;
  await run();
  const persisted = await expect('GET', '/profiles/' + first.id, 200);
  assert.equal(persisted.name, 'QA Edited');
  assert.equal(persisted.folder, 'QA folder');
  assert.equal(persisted.workspaceId, workspace.id);
  assert.equal((await expect('GET', '/settings', 200)).defaultHeadless, !previousSettings.defaultHeadless);
  console.log('PASS profile, folder, workspace assignment and setting persist after restart');
  const cookies = async id => (await expect('GET', '/profiles/' + id + '/cookies', 200)).cookies;
  assert.ok((await cookies(first.id)).some(cookie => cookie.name === 'owner-isolation' && cookie.value === 'isolated'));
  assert.ok(!(await cookies(second.id)).some(cookie => cookie.name === 'owner-isolation'));
  console.log('PASS persisted imported cookie remains isolated to its profile');
  await expect('DELETE', '/profiles/' + second.id, 204);
  const remaining = await expect('GET', '/profiles', 200);
  assert.ok(remaining.some(profile => profile.id === first.id));
  assert.ok(!remaining.some(profile => profile.id === second.id));
  console.log('PASS deleting the synthetic profile preserves its sibling');
} finally {
  if (app) await app.close().catch(() => {});
  fs.rmSync(root, {recursive:true, force:true, maxRetries:5, retryDelay:200});
}
