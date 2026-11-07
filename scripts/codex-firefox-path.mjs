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
const system32 = path.join(process.env.SystemRoot, 'System32');
const powershell = path.join(system32, 'WindowsPowerShell', 'v1.0');
const env = {...process.env, PM_FIREFOX_NO_SYSTEM: '1', ProgramFiles: path.join(root,'no-system-pf'), 'ProgramFiles(x86)': path.join(root,'no-system-pf86')};
delete env.PM_FIREFOX_EXECUTABLE;
delete env.PM_FIREFOX_RESOURCES;
const registryPaths = [];
const configuredPath = () => registryPaths.join(path.delimiter);
delete env.PM_USER_DATA;
let app, page;
const run = async () => {
  app = await _electron.launch({executablePath: path.join(install, 'Azwah Multi Browser Ultimate.exe'), env: {...env, PATH:configuredPath()}, timeout: 90000});
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
  assert.ok(fs.existsSync(path.join(install,'resources','firefox','firefox.exe')));
  for (const dirs of [[system32], [system32,powershell]]) {
    registryPaths.splice(0,registryPaths.length,...dirs);
    await run();
    const shellProbe = await app.evaluate(async () => {
      const {execFile} = process.getBuiltinModule('node:child_process');
      return new Promise(resolve => execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command','(Get-Process -Id $PID).Id'],{windowsHide:true},(error,out) => resolve({code:error?.code ?? null,ok:!!out.trim()})));
    });
    const profile = await expect('POST', '/profiles', 201, {name:'Firefox diagnostic',browserEngine:'firefox',browserSettings:{firefoxSessionMode:'bidi',timezoneId:'UTC'}});
    const launched = await api('POST','/profiles/'+profile.id+'/launch',{headless:true,automation:true});
    console.log('FIREFOX_PROBE '+JSON.stringify({includesPowerShell:dirs.length===2,shellProbe,launched}));
    if (dirs.length===2) {
      assert.equal(launched.status,200);
      const state = await expect('GET','/profiles/'+profile.id,200);
      const image = execFileSync(path.join(powershell,'powershell.exe'),['-NoProfile','-NonInteractive','-Command',`(Get-Process -Id ${Number(state.pid)} -ErrorAction Stop).Path`],{encoding:'utf8'}).trim();
      assert.equal(image.toLowerCase(),path.join(install,'resources','firefox','firefox.exe').toLowerCase());
      console.log('PASS Firefox process is the bundled runtime');
    }
    if (launched.status===200) await expect('POST','/profiles/'+profile.id+'/stop',200,{});
    await app.close(); app=undefined;
  }
} finally {
  if (app) await app.close().catch(() => {});
  fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
