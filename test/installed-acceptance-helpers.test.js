import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {assertIssuedDevice, startAuthenticatedProxyFixture, waitForIssuedToken} from '../scripts/installed-acceptance-helpers.mjs';

const license = device => 'AZW1.' + Buffer.from(JSON.stringify({device})).toString('base64url') + '.signature';

test('fresh-looking licenses for the previous device fail before upload', () => {
  assert.throws(() => assertIssuedDevice(license('previous-device'), 'employee-device'), /does not target/);
  assert.doesNotThrow(() => assertIssuedDevice(license('employee-device'), 'employee-device'));
});

test('token readiness excludes the previously issued license', async () => {
  const old = license('previous-device');
  const next = license('employee-device');
  const savedDocument = globalThis.document;
  let value = old;
  globalThis.document = {querySelector: () => ({value})};
  try {
    const page = {
      async waitForFunction(predicate, previous) {
        assert.equal(previous, old);
        assert.equal(predicate(previous), false);
        value = next;
        assert.equal(predicate(previous), true);
      },
      getByLabel(name, options) {
        assert.equal(name, 'License token');
        assert.equal(options.exact, true);
        return {inputValue: async () => value};
      },
    };
    assert.equal(await waitForIssuedToken(page, old), next);
  } finally {
    if (savedDocument === undefined) delete globalThis.document;
    else globalThis.document = savedDocument;
  }
});

test('installed proxy fixture authenticates a CONNECT tunnel used by the app', async t => {
  const proxy = await startAuthenticatedProxyFixture('qa', 'password');
  t.after(() => proxy.close());
  const request = credentials => new Promise((resolve, reject) => {
    const agent = new HttpsProxyAgent(`http://${credentials}@127.0.0.1:${proxy.port}`);
    http.get('http://203.0.113.10/ip', {agent}, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    }).on('error', reject);
  });
  assert.equal(await request('qa:wrong'), 407);
  assert.deepEqual(proxy.hits, []);
  assert.equal(await request('qa:password'), 200);
  assert.deepEqual(proxy.hits, ['/ip']);
});
