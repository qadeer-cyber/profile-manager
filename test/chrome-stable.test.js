import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertProfileVersion, resolveWindowsChromeStable, verifyStableBrowserLocation } from '../server/browser-runtime/chrome-stable.js';

test('requires discovered signed Chrome Stable metadata and rejects missing or old candidates', async () => {
  const candidate = { path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', version: '156.0.1.0' };
  const run = async (_file, args) => {
    assert.equal(args.at(-2), '-EncodedCommand');
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    assert.match(script, /Get-AuthenticodeSignature/);
    assert.match(script, /App Paths/);
    return { stdout: JSON.stringify(candidate) };
  };
  assert.deepEqual(await resolveWindowsChromeStable({ run }), candidate);
  await assert.rejects(resolveWindowsChromeStable({ run: async () => ({ stdout: '' }) }), { code: 'CHROME_STABLE_MISSING' });
  candidate.version = '135.0.1.0';
  await assert.rejects(resolveWindowsChromeStable({ run }), { code: 'CHROME_STABLE_TOO_OLD' });
});

test('guards existing Chrome profile data against version downgrade', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-version-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.doesNotThrow(() => assertProfileVersion(dir, '156.0.1.0'));
  fs.writeFileSync(path.join(dir, 'Last Version'), '156.0.2.0');
  assert.throws(() => assertProfileVersion(dir, '156.0.1.0'), { code: 'CHROME_PROFILE_DOWNGRADE' });
  assert.doesNotThrow(() => assertProfileVersion(dir, '157.0.0.0'));
  assert.equal(fs.readFileSync(path.join(dir, 'Last Version'), 'utf8'), '156.0.2.0');
});

test('Stable Chrome identity gate rejects mismatches and clears its temporary location permission', async () => {
  const expected = { ip: '8.8.8.8', timezone: 'Europe/Berlin', latitude: 52.5, longitude: 13.4, accuracy: 50000 };
  for (const mismatch of [null, 'ip', 'timezone', 'coordinates']) {
    const calls = [];
    const page = {
      goto: async () => ({ ok: () => true, json: async () => ({ ip: mismatch === 'ip' ? '1.1.1.1' : expected.ip }) }),
      evaluate: async () => calls.includes('grant')
        ? { ...expected, accuracy: mismatch === 'coordinates' ? 50 : expected.accuracy }
        : mismatch === 'timezone' ? 'UTC' : expected.timezone,
      close: async () => { calls.push('close'); },
    };
    const context = { newPage: async () => page,
      grantPermissions: async () => { calls.push('grant'); },
      clearPermissions: async () => { calls.push('clear'); },
    };
    const check = verifyStableBrowserLocation(context, expected);
    if (mismatch) await assert.rejects(check, { code: 'PROXY_BROWSER_IDENTITY_FAILED' });
    else await check;
    assert.deepEqual(calls, mismatch === 'ip' || mismatch === 'timezone' ? ['close'] : ['grant', 'clear', 'close']);
  }
});
