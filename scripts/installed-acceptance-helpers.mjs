import assert from 'node:assert/strict';
import {startLocalHttpFixture} from '../test/_local-http-fixture.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function assertIssuedDevice(token, device) {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'AZW1') throw new Error('Expected an AZW1 license');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (claims.device !== device) throw new Error('New license does not target the Office device');
}

export async function waitForIssuedToken(page, previous = '') {
  await page.waitForFunction(old => {
    const value = document.querySelector('textarea')?.value || '';
    return value.startsWith('AZW1.') && value !== old;
  }, previous);
  return page.getByLabel('License token', {exact: true}).inputValue();
}

export async function activateInstalledOffice(page, licenseFile, evidence, getStatus) {
  const panel = page.getByRole('region', {name: 'Office activation', exact: true});
  const input = panel.getByLabel('Administrator license', {exact: true});
  const status = panel.getByRole('status');
  const diagnostic = {};
  const redact = value => String(value ?? '').replace(/AZW1\.[\w-]+\.[\w-]+/g, '[license redacted]').slice(0, 500);
  try {
    await panel.getByLabel('License file', {exact: true}).setInputFiles(licenseFile);
    await panel.getByRole('checkbox', {name: 'I authorize activation on this device.', exact: true}).check();
    const [response] = await Promise.all([
      page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/activation'),
      panel.getByRole('button', {name: 'Activate offline', exact: true}).click(),
    ]);
    const body = await response.json();
    diagnostic.post = {status: response.status(), active: body.active ?? null, code: body.code ?? null, error: redact(body.error)};
    if (!response.ok() || body.active !== true) throw new Error(`Office activation returned HTTP ${response.status()} (${body.code || 'no code'})`);
    await status.filter({hasText: /^This device is activated for offline use\.$/}).waitFor();
  } finally {
    const state = await getStatus().catch(() => null);
    diagnostic.get = state && {status: state.status, active: state.body?.active ?? null, code: state.body?.code ?? null, error: redact(state.body?.error)};
    diagnostic.dom = redact(await status.allTextContents().then(items => items.join(' | ')).catch(() => ''));
    const info = await page.evaluate(() => window.pm.appInfo()).catch(() => null);
    if (info?.logFile && fs.existsSync(info.logFile)) {
      diagnostic.mainLog = fs.readFileSync(info.logFile, 'utf8').split(/\r?\n/).filter(line => /backend|ERROR|activation/i.test(line)).slice(-15).map(redact);
    }
    fs.writeFileSync(path.join(evidence, 'office-activation.json'), JSON.stringify(diagnostic, null, 2));
    await page.screenshot({path: path.join(evidence, 'office-activation.png'), mask: [input]}).catch(() => {});
  }
}

export function hasExpectedOfficeTrust(installation, expectedPublicKey) {
  const trust = JSON.parse(fs.readFileSync(path.join(installation, 'resources', 'office-trust.json'), 'utf8'));
  return Object.keys(trust).sort().join(',') === 'organization,publicKey' &&
    typeof trust.organization === 'string' && trust.organization.length > 0 &&
    trust.publicKey === expectedPublicKey &&
    crypto.createPublicKey(trust.publicKey).asymmetricKeyType === 'ed25519';
}

export async function waitForOfficeDeviceCode(page, getStatus) {
  const response = await getStatus();
  const code = response.body?.deviceCode;
  if (response.status !== 200 || !/^AZD1-[a-f0-9]{64}$/.test(code || '')) {
    throw new Error(`Office device identity unavailable (HTTP ${response.status}, ${response.body?.code || 'no code'})`);
  }
  const panel = page.getByRole('region', {name: 'Office activation', exact: true});
  await panel.getByRole('button', {name: 'Copy Device Code', exact: true}).waitFor();
  const rendered = await panel.getByLabel('Device identity code', {exact: true}).inputValue();
  if (rendered !== code) throw new Error('Rendered Office device identity differs from activation API');
  return code;
}

export async function qualifyInstalledFirefox({page, api, installation, processImage}) {
  const fixture = await startLocalHttpFixture();
  const running = [];
  const checked = [];
  try {
    for (const [zone, january, july] of [['Europe/Berlin', -60, -120], ['Asia/Tokyo', -540, -540]]) {
      const created = await api(page, '/profiles', {name: 'Firefox QA ' + zone, browserEngine: 'firefox', browserSettings: {firefoxSessionMode:'bidi', timezoneId:zone}});
      assert.equal(created.status, 201, 'Firefox profile creation');
      const id = created.body.id;
      const launched = await api(page, '/profiles/' + id + '/launch', {headless:true, url:fixture.origin});
      assert.equal(launched.status, 200, 'Firefox launch: ' + JSON.stringify(launched.body));
      const handle = {id, pid: null};
      running.push(handle);
      const status = await api(page, '/profiles/' + id);
      assert.equal(status.status, 200);
      const pid = handle.pid = status.body.pid;
      assert.ok(Number.isInteger(pid) && pid > 0, 'Firefox process PID');
      assert.ok(!checked.some(other => other.pid === pid), 'Firefox profile process isolation');
      assert.equal(processImage(pid).toLowerCase(), path.join(installation, 'resources', 'firefox', 'firefox.exe').toLowerCase());
      const command = async (method, params) => {
        const response = await api(page, '/profiles/' + id + '/firefox/command', {method, params});
        assert.equal(response.status, 200, 'Firefox BiDi ' + method + ': ' + JSON.stringify(response.body));
        return response.body;
      };
      const tree = await command('browsingContext.getTree', {});
      const context = tree.contexts[0].context;
      await command('browsingContext.navigate', {context, url:fixture.origin, wait:'complete'});
      const evaluate = async expression => {
        const result = await command('script.evaluate', {expression, target:{context}, awaitPromise:false});
        assert.equal(result.type, 'success', 'Firefox BiDi evaluation');
        return result.result.value;
      };
      assert.equal(await evaluate('localStorage.getItem("azwah-qa") === null'), true, 'Firefox browser storage starts isolated');
      await evaluate('localStorage.setItem("azwah-qa", "isolated")');
      assert.equal(await evaluate('localStorage.getItem("azwah-qa")'), 'isolated');
      const observed = JSON.parse(await evaluate('JSON.stringify([Intl.DateTimeFormat().resolvedOptions().timeZone,new Date("2026-01-15T12:00:00Z").getTimezoneOffset(),new Date("2026-07-15T12:00:00Z").getTimezoneOffset()])'));
      assert.deepEqual(observed, [zone, january, july], 'Firefox timezone observed inside the installed browser');
      checked.push({zone, january, july, pid});
    }
  } finally {
    const errors = [];
    for (const {id, pid} of running) {
      try {
        const stop = await api(page, '/profiles/' + id + '/stop', {});
        assert.equal(stop.status, 200, 'Firefox stop response');
        const deadline = Date.now() + 10000;
        while (pid) {
          try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') break; throw error; }
          assert.ok(Date.now() < deadline, 'Bundled Firefox process remained alive after stop');
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (error) { errors.push(error); }
    }
    await fixture.close();
    if (errors.length) throw new AggregateError(errors, 'Firefox process cleanup failed: ' + errors.map(error => error.message).join('; '));
  }
  return checked;
}
