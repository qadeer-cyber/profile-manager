// Installed Owner GUI acceptance for the one-line proxy, fingerprint sections,
// browser payload, and the profile controls that already exist. Not a Windows 10 run.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {_electron, chromium} from 'playwright';
import {startLocalHttpFixture} from '../test/_local-http-fixture.mjs';

if (process.platform !== 'win32' || process.env.CI !== 'true') throw new Error('An isolated Windows CI worker is required');
const root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'azwah-gui-'));
const install = path.join(root, 'installed');
const userData = path.join(root, 'userdata');
const evidence = path.resolve('build-evidence/ultimate-gui');
const shots = path.join(evidence, 'screenshots');
fs.mkdirSync(shots, {recursive: true});
const installer = path.resolve(process.env.AZWAH_GUI_INSTALLER || 'release-ultimate-owner/Azwah-Multi-Browser-Ultimate-Setup-x64.exe');
const secret = 'p4ss-gui';
const results = [];
let application, fixture, proxyServer, page;
const seen = [];
const check = (ok, message) => {
  results.push({pass: !!ok, message});
  console.log(`${ok ? 'PASS' : 'FAIL'} ${message}`);
  if (!ok) throw new Error(message);
};
function walk(dir, pred, out = [], depth = 0) {
  if (depth > 5 || !fs.existsSync(dir)) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return out; }
  for (const entry of entries) {
    if (entry.name.startsWith('chromium-')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, pred, out, depth + 1);
    else if (pred(entry.name)) out.push(full);
  }
  return out;
}
async function api(route, body) {
  return page.evaluate(async ({route, body}) => {
    const response = await fetch('/api' + route, {method: body === undefined ? 'GET' : 'POST', headers: {'Content-Type': 'application/json', 'X-UI-Token': window.pm.uiToken}, body: body === undefined ? undefined : JSON.stringify(body)});
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = {raw: text.slice(0, 300)}; }
    return {status: response.status, body: parsed};
  }, {route, body});
}
async function shot(name) {
  await page.screenshot({path: path.join(shots, `${name}.png`)});
}
async function overview() {
  return page.getByRole('complementary', {name: 'Profile overview'}).innerText();
}
async function paste(text) {
  await application.evaluate(({clipboard}, value) => clipboard.writeText(value), text);
  const input = page.getByLabel('Proxy details');
  await input.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+V');
  await input.evaluate(el => el.value);
}

const setup = spawnSync(installer, ['/S', '/D=' + install], {timeout: 180000, stdio: 'inherit'});
check(setup.status === 0 && fs.existsSync(path.join(install, 'Azwah Multi Browser Owner.exe')), 'Published-or-built NSIS installer installs the Owner executable');
const firefoxFiles = walk(install, name => name.toLowerCase() === 'firefox.exe');
check(firefoxFiles.length === 0, 'Installed tree has no Firefox executable; Firefox is not an offline payload');
const browsersDir = path.join(install, 'resources', 'browsers');
const chromiumDirs = fs.existsSync(browsersDir) ? fs.readdirSync(browsersDir).filter(name => /^chromium-\d+$/.test(name)) : [];
check(chromiumDirs.length > 0, 'Installed resources contain a Chromium runtime directory');
const whereFx = spawnSync('where.exe', ['firefox'], {encoding: 'utf8'});
const hostFirefox = whereFx.status === 0 ? whereFx.stdout.trim().split(/\r?\n/)[0] : '';

fixture = await startLocalHttpFixture({body: '<!doctype html><html><head><title>via-proxy</title></head><body>ok</body></html>'});
proxyServer = http.createServer((req, res) => {
  const auth = Buffer.from(String(req.headers['proxy-authorization'] || '').replace(/^Basic /i, ''), 'base64').toString('utf8');
  let target;
  try { target = new URL(req.url); } catch { res.writeHead(400).end(); return; }
  seen.push({kind: 'http', target: target.hostname, user: auth.split(':')[0], passLen: auth.includes(':') ? auth.slice(auth.indexOf(':') + 1).length : 0});
  if (auth !== `alice:${secret}`) { res.writeHead(407).end(); return; }
  if (target.hostname !== 'pm-proxy-test.invalid') { res.writeHead(403).end(); return; }
  const forward = http.request(fixture.origin + target.pathname, {method: req.method, headers: {host: '127.0.0.1'}}, up => { res.writeHead(up.statusCode, up.headers); up.pipe(res); });
  forward.on('error', () => res.destroy());
  req.pipe(forward);
});
proxyServer.on('connect', (req, socket) => {
  const auth = Buffer.from(String(req.headers['proxy-authorization'] || '').replace(/^Basic /i, ''), 'base64').toString('utf8');
  const [host, port] = String(req.url || '').split(':');
  seen.push({kind: 'connect', target: host, user: auth.split(':')[0], passLen: auth.includes(':') ? auth.slice(auth.indexOf(':') + 1).length : 0});
  if (auth !== `alice:${secret}` && auth !== 'alice:wrong-pass') { socket.write('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); socket.end(); return; }
  if (auth === 'alice:wrong-pass') { socket.write('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); socket.end(); return; }
  if (host !== 'api.ipify.org') { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.end(); return; }
  const upstream = net.connect(Number(port || 443), host, () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); upstream.pipe(socket); socket.pipe(upstream); });
  upstream.on('error', () => socket.end());
});
await new Promise(resolve => proxyServer.listen(0, '127.0.0.1', resolve));
const proxyPort = proxyServer.address().port;
const directIp = await new Promise((resolve, reject) => {
  const agent = new HttpsProxyAgent(`http://alice:${encodeURIComponent(secret)}@127.0.0.1:${proxyPort}`);
  const req = https.get('https://api.ipify.org?format=json', {agent, timeout: 20000}, res => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => { try { resolve(JSON.parse(body).ip); } catch (error) { reject(error); } });
  });
  req.on('error', reject);
});
check(typeof directIp === 'string' && directIp.includes('.'), 'Controlled proxy can reach the same HTTPS echo the Test Proxy button uses');

try {
  application = await _electron.launch({executablePath: path.join(install, 'Azwah Multi Browser Owner.exe'), env: {...process.env, PM_USER_DATA: userData}, timeout: 60000});
  page = await application.firstWindow();
  await page.waitForFunction(() => !!window.pm, {timeout: 60000});
  await page.setViewportSize({width: 1366, height: 768});
  const info = await page.evaluate(() => window.pm.appInfo());
  check(info.packaged && info.bundledBrowsers && info.edition === 'Owner / Personal', 'Installed Owner reports a packaged Chromium payload and no employee activation');
  const fx = await api('/profiles', {name: 'Firefox payload check', browserEngine: 'firefox'});
  const fxLaunch = await api(`/profiles/${fx.body.id}/launch`, {headless: true});
  if (!hostFirefox) check(fxLaunch.status !== 200, 'Without a preinstalled Firefox, the installed package cannot launch Firefox');
  else check(firefoxFiles.length === 0, 'A host Firefox exists and is not evidence of a packaged Firefox runtime');
  fs.writeFileSync(path.join(evidence, 'browser-payload.json'), JSON.stringify({
    chromiumDirectories: chromiumDirs,
    bundledBrowsersFlag: info.bundledBrowsers,
    firefoxExecutablesInInstall: firefoxFiles,
    hostFirefox: hostFirefox || null,
    firefoxLaunchStatus: fxLaunch.status,
    firefoxLaunchError: fxLaunch.body?.error || fxLaunch.body?.message || null,
    offlineFirefox: false,
  }, null, 2));

  await page.getByRole('button', {name: 'New profile'}).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', {name: 'Fingerprint'}).click();
  await dialog.getByRole('heading', {name: 'WebRTC'}).scrollIntoViewIfNeeded();
  await shot('webrtc-1366x768');
  await dialog.getByRole('heading', {name: 'Geolocation'}).scrollIntoViewIfNeeded();
  await shot('geolocation-1366x768');
  await dialog.getByLabel('WebGL', {exact: true}).scrollIntoViewIfNeeded();
  await shot('graphics-webgl-1366x768');
  await dialog.getByLabel('Canvas readback prototype').scrollIntoViewIfNeeded();
  await shot('canvas-audio-1366x768');
  await dialog.getByRole('tab', {name: 'Proxy'}).click();
  await dialog.getByRole('radio', {name: 'Custom'}).click();
  await shot('proxy-custom-empty-1366x768');
  await dialog.getByRole('radio', {name: 'HTTPS'}).click();
  await dialog.getByRole('radio', {name: 'HTTPS', checked: true}).waitFor();
  await dialog.getByLabel('Proxy details').pressSequentially('203.0.113.10:8080', {delay: 10});
  check((await overview()).includes('HTTPS') && (await overview()).includes('203.0.113.10:8080'), 'Typed host:port keeps the selected HTTPS protocol');
  await paste('socks5://alice:p%40@203.0.113.10:1080');
  await dialog.getByRole('radio', {name: 'SOCKS5', checked: true}).waitFor();
  check((await overview()).includes('SOCKS5') && !(await overview()).includes('p@'), 'Pasted URL form selects SOCKS5 and the overview does not show the decoded password');
  await dialog.getByRole('radio', {name: 'HTTPS'}).click();
  await dialog.getByRole('radio', {name: 'HTTPS', checked: true}).waitFor();
  await paste('[2001:db8::1]:1080:alice');
  const v6 = await overview();
  check(v6.includes('HTTPS') && v6.includes('[2001:db8::1]') && v6.includes('1080') && v6.includes('Authentication set'), 'Bracketed IPv6 with a username and no password keeps HTTPS');
  await dialog.getByLabel('Proxy details').fill('just-a-host');
  await dialog.getByText('Unrecognized format').waitFor();
  await dialog.getByRole('button', {name: 'Create profile'}).click();
  await dialog.getByText('The proxy line is not a valid host and port').waitFor();
  check(await dialog.isVisible(), 'A malformed line stays on screen and is not saved');
  await paste('http://user%3Aname:p%40ss@203.0.113.10:9');
  check((await dialog.getByRole('radio', {name: 'HTTP', checked: true}).count()) === 1, 'An explicit http scheme selects HTTP');
  check(!(await overview()).includes('p@ss'), 'Special-character password is absent from the overview');
  await dialog.getByRole('button', {name: 'Hide credentials'}).click();
  check(await dialog.getByLabel('Proxy details').getAttribute('type') === 'password', 'Hide credentials masks the one-line field');
  await shot('proxy-custom-hidden-1366x768');
  await dialog.getByRole('button', {name: 'Show credentials'}).click();
  await dialog.getByLabel('Proxy details').fill(`127.0.0.1:${proxyPort}:alice:${secret}`);
  await dialog.getByRole('radio', {name: 'HTTP', checked: true}).waitFor();
  await dialog.getByRole('button', {name: 'Hide credentials'}).click();
  await shot('proxy-custom-live-hidden-1366x768');
  await dialog.getByRole('button', {name: 'Test Proxy'}).click();
  await dialog.getByText(/Transport ok/).waitFor({timeout: 40000});
  const testText = await dialog.getByText(/Transport ok/).innerText();
  check(testText.includes(directIp), 'Test Proxy shows the egress address observed through this same proxy');
  check(!(await overview()).includes(secret) && !testText.includes(secret), 'Test Proxy result and overview do not repeat the password');
  await shot('proxy-test-result-1366x768');
  await dialog.getByRole('button', {name: 'Show credentials'}).click();
  await dialog.getByLabel('Proxy details').fill(`127.0.0.1:${proxyPort}:alice:wrong-pass`);
  await dialog.getByRole('button', {name: 'Test Proxy'}).click();
  await dialog.getByText(/Credentials rejected/).waitFor({timeout: 40000});
  check(seen.some(item => item.kind === 'connect' && item.user === 'alice' && item.passLen === 'wrong-pass'.length), 'The rejected test used the edited line, not a previous proxy');
  await dialog.getByLabel('Proxy details').fill(`127.0.0.1:${proxyPort}:alice:${secret}`);
  await dialog.getByRole('tab', {name: 'General'}).click();
  await dialog.getByLabel('Name', {exact: true}).fill('GUI proxy');
  await dialog.getByLabel('Folder').fill('Field kit');
  await dialog.getByLabel('Tags').fill('route, gui');
  await dialog.getByRole('button', {name: 'Create profile'}).click();
  await page.getByRole('cell', {name: 'GUI proxy', exact: true}).waitFor();
  await page.getByRole('button', {name: 'Edit GUI proxy', exact: true}).click();
  await page.getByRole('tab', {name: 'Proxy'}).click();
  const persisted = await page.getByLabel('Proxy details').inputValue();
  check(persisted.includes('••••') && !persisted.includes(secret), 'Reopened editor keeps a mask instead of the saved password');
  await shot('proxy-persisted-mask-1366x768');
  await page.getByRole('button', {name: 'Cancel'}).click();
  const saved = (await api('/profiles')).body.find(item => item.name === 'GUI proxy');
  check(saved.proxy.type === 'http' && saved.proxy.host === '127.0.0.1' && saved.proxy.port === proxyPort && saved.proxy.username === 'alice' && saved.proxy.password === '••••', 'Saved profile keeps the typed endpoint and a redacted password');
  check(saved.folder === 'Field kit' && saved.tags.includes('route') && saved.tags.includes('gui'), 'Folder and tags entered in the editor are stored');
  const browserUrl = `http://pm-proxy-test.invalid:${fixture.port}/`;
  const opened = await api(`/profiles/${saved.id}/launch`, {headless: true, automation: true, url: browserUrl});
  check(opened.status === 200 && opened.body.cdp?.httpEndpoint, 'Installed Chromium launches the GUI-saved profile');
  const browser = await chromium.connectOverCDP(opened.body.cdp.httpEndpoint, {timeout: 20000});
  try {
    const tab = browser.contexts()[0].pages()[0];
    await tab.goto(browserUrl, {timeout: 20000});
    check(await tab.title() === 'via-proxy', 'Browser traffic for the GUI-saved proxy reached the controlled proxy');
  } finally { await browser.close(); }
  check(seen.some(item => item.kind === 'http' && item.target === 'pm-proxy-test.invalid' && item.user === 'alice'), 'Browser routing presented the same username to the proxy');
  await api(`/profiles/${saved.id}/stop`, {});

  await page.getByRole('button', {name: 'Columns'}).click();
  await page.getByRole('checkbox', {name: 'Notes'}).uncheck();
  await page.reload();
  await page.getByRole('columnheader', {name: 'Profile name'}).waitFor();
  check(await page.getByRole('columnheader', {name: 'Notes'}).count() === 0, 'Column visibility survives a reload');
  const other = await api('/profiles', {name: 'Bulk mate', folder: 'Field kit', tags: ['gui']});
  check(other.status === 201, 'Second profile exists for bulk controls');
  await page.reload();
  await page.getByRole('cell', {name: 'Bulk mate', exact: true}).waitFor();
  await page.getByRole('checkbox', {name: 'Select GUI proxy'}).check();
  await page.getByRole('checkbox', {name: 'Select Bulk mate'}).check();
  await page.getByRole('button', {name: 'Tag selected'}).click();
  await page.getByLabel('Add tags').fill('bulk');
  await page.getByRole('button', {name: 'Apply'}).click();
  await page.getByRole('cell', {name: /bulk/}).first().waitFor();
  const tagged = (await api('/profiles')).body.filter(item => (item.tags || []).includes('bulk'));
  check(tagged.length === 2, 'Bulk tag applies to both selected profiles');
  await page.getByRole('button', {name: 'Delete Bulk mate', exact: true}).click();
  await page.getByRole('button', {name: 'Move to trash'}).click();
  await page.locator('[data-nav=trash]').click();
  await page.getByRole('cell', {name: 'Bulk mate', exact: true}).waitFor();
  await page.getByRole('button', {name: 'Restore'}).click();
  await page.locator('[data-nav=profiles]').click();
  await page.getByRole('cell', {name: 'Bulk mate', exact: true}).waitFor();
  check(true, 'Delete moves a profile to trash and restore brings it back');
  await page.getByRole('button', {name: 'Favorites are not stored'}).first().waitFor();
  check(await page.getByRole('button', {name: 'Favorites are not stored'}).first().isDisabled(), 'Favorites stay disabled because no favorite store exists');

  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(installer)) hash.update(chunk);
  fs.writeFileSync(path.join(evidence, 'acceptance.json'), JSON.stringify({
    source: process.env.GITHUB_SHA,
    installer: path.basename(installer),
    installerBytes: fs.statSync(installer).size,
    installerSha256: hash.digest('hex'),
    host: os.release(),
    windows10: false,
    legacyUpgrade: false,
    firefoxOfflineComplete: false,
    hostFirefox: hostFirefox || null,
    chromiumDirectories: chromiumDirs,
    results,
  }, null, 2));
} catch (error) {
  if (!results.some(item => !item.pass && item.message === error.message)) results.push({pass: false, message: error.message});
  console.error('GUI_ACCEPTANCE_FAILURE', error.message);
  process.exitCode = 1;
  fs.writeFileSync(path.join(evidence, 'acceptance.json'), JSON.stringify({source: process.env.GITHUB_SHA, results, failed: error.message, firefoxOfflineComplete: false, hostFirefox: hostFirefox || null}, null, 2));
} finally {
  if (application) await application.close().catch(() => {});
  if (proxyServer) { proxyServer.closeAllConnections?.(); await new Promise(resolve => proxyServer.close(resolve)); }
  if (fixture) await fixture.close();
  fs.rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
}
if (process.exitCode) process.exit(process.exitCode);
