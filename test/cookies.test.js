import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { clearProfileCookies, decryptCookieValue, encryptCookieValue, importProfileCookies, readProfileCookies, validateCookie } from '../server/cookies.js';

const secret = 'super-secret-cookie-value';
test('cookie encryption round-trips without logging the value', () => {
  const lines = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const originals = Object.fromEntries(methods.map(method => [method, console[method]]));
  for (const method of methods) console[method] = (...args) => lines.push(args.map(String).join(' '));
  try {
    const blob = encryptCookieValue('example.test', secret);
    assert.equal(blob.subarray(0, 3).toString(), 'v10');
    assert.equal(decryptCookieValue('example.test', blob).value, secret);
    assert.equal(decryptCookieValue('other.test', blob).state, 'unavailable');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cookies-'));
    const imported = importProfileCookies(dir, [validateCookie({ name: 'sid', value: secret, domain: 'example.test', path: '/', secure: true, httpOnly: true, sameSite: 'None', expires: Math.floor(Date.now() / 1000) + 3600 })]);
    assert.equal(imported.imported, 1);
    const [cookie] = readProfileCookies(dir);
    assert.equal(cookie.value, secret);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.secure, true);
    assert.equal(cookie.sameSite, 'None');
    assert.equal(clearProfileCookies(dir, { selected: [{ name: 'sid', domain: 'example.test', path: '/' }] }).cleared, 1);
    assert.equal(readProfileCookies(dir).length, 0);
  } finally {
    for (const method of methods) console[method] = originals[method];
  }
  assert.equal(lines.some(line => line.includes(secret)), false);
});
test('malformed cookies are rejected without echoing the value', () => {
  const bad = [
    { name: 'sid', value: secret, domain: 'example.test', path: '/', secure: false, httpOnly: false, sameSite: 'None' },
    { name: 'sid', value: secret, domain: '../etc', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
    { name: '', value: secret, domain: 'example.test', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
    { name: '__Host-sid', value: secret, domain: '.example.test', path: '/', secure: true, httpOnly: true, sameSite: 'Lax', hostOnly: false },
  ];
  for (const cookie of bad) {
    assert.throws(() => validateCookie(cookie), error => error.code === 'INVALID_COOKIE' && !error.message.includes(secret));
  }
});
