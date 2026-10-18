// Packaged builds ignore the three dev/test switches. Nothing else in server/ may read them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { applyPackagedFlag, automationDefault, proxyLoopback, proxyTestInsecureTls } from '../server/testflags.js';
import { isResourcesBrowsers, installOne } from '../server/chromium.js';

const on = {
  PM_PACKAGED: '0',
  PM_AUTOMATION_DEFAULT: '1',
  PM_PROXY_LOOPBACK: '1',
  PM_PROXY_TEST_INSECURE_TLS: '1',
};

test('non-packaged honors the three test flags', () => {
  assert.equal(automationDefault(on), true);
  assert.equal(proxyLoopback(on), true);
  assert.equal(proxyTestInsecureTls(on), true);
  assert.equal(automationDefault({}), false);
  assert.equal(proxyLoopback({ PM_PROXY_LOOPBACK: '0' }), false);
  assert.equal(proxyTestInsecureTls({ PM_PROXY_TEST_INSECURE_TLS: 'yes' }), false);
});

test('packaged ignores all three flags', () => {
  const env = { ...on, PM_PACKAGED: '1' };
  assert.equal(automationDefault(env), false);
  assert.equal(proxyLoopback(env), false);
  assert.equal(proxyTestInsecureTls(env), false);
});

test('applyPackagedFlag overwrites an inherited PM_PACKAGED=0', () => {
  const env = { ...on };
  assert.equal(env.PM_PACKAGED, '0');
  applyPackagedFlag(env, true);
  assert.equal(env.PM_PACKAGED, '1');
  assert.equal(automationDefault(env), false);
  applyPackagedFlag(env, false);
  assert.equal(env.PM_PACKAGED, '0');
  assert.equal(automationDefault(env), true);
});

test('main.js applies the packaged flag before the backend import', () => {
  const src = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const flagAt = src.indexOf('applyPackagedFlag(process.env, app.isPackaged)');
  const importAt = src.indexOf("await import('../server/app.js')");
  assert.ok(flagAt > 0 && importAt > flagAt, 'PM_PACKAGED is set before startBackend loads the server');
  assert.match(src, /applyPackagedFlag\(process\.env, app\.isPackaged\)/);
});

test('server/ reads the three flags only inside testflags.js', () => {
  const names = ['PM_AUTOMATION_DEFAULT', 'PM_PROXY_LOOPBACK', 'PM_PROXY_TEST_INSECURE_TLS'];
  for (const file of fs.readdirSync(new URL('../server/', import.meta.url))) {
    if (!file.endsWith('.js') || file === 'testflags.js') continue;
    const src = fs.readFileSync(new URL('../server/' + file, import.meta.url), 'utf8');
    for (const name of names) assert.equal(src.includes(name), false, `${file} mentions ${name}`);
  }
  const browsers = fs.readFileSync(new URL('../server/browsers.js', import.meta.url), 'utf8');
  assert.match(browsers, /!!opts\.automation \|\| automationDefault\(\)/);
});

test('Chromium install root is never resources/browsers', async () => {
  const resources = path.join(path.resolve('tmp-not-created'), 'resources', 'browsers');
  assert.equal(isResourcesBrowsers(resources), true);
  assert.equal(isResourcesBrowsers(path.join(path.resolve('build'), 'bundled-browsers')), false);
  await assert.rejects(installOne('chromium', {
    root: resources,
    download: async () => { throw new Error('download should not start'); },
  }), e => e.code === 'BAD_INSTALL_ROOT');
});
