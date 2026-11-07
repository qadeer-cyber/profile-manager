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
