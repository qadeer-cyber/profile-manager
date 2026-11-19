// Netscape cookies.txt import/export. Every parsed cookie still goes through the server validator,
// malformed files are refused with line numbers only, and cookie values never appear in errors.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { looksLikeNetscape, parseNetscapeCookies, toNetscapeCookies, MAX_NETSCAPE_LINES } from '../server/cookie-formats.js';
import { validateCookie, importProfileCookies, readProfileCookies } from '../server/cookies.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cookie-formats-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const SECRET = 'S3cretSessionValue_do_not_log';
const FILE = [
  '# Netscape HTTP Cookie File',
  '# comment line',
  '',
  `.example.com\tTRUE\t/\tTRUE\t2000000000\tsid\t${SECRET}`,
  '#HttpOnly_www.example.org\tFALSE\t/app\tFALSE\t0\tpref\tdark',
  'shop.example.net\tFALSE\t/\tTRUE\t1999999999\t__Host-cart\tabc',
].join('\n');

test('format detection', () => {
  assert.equal(looksLikeNetscape(FILE), true);
  assert.equal(looksLikeNetscape('﻿' + FILE), true);
  assert.equal(looksLikeNetscape('[{"name":"a"}]'), false);
  assert.equal(looksLikeNetscape('{"version":1,"cookies":[]}'), false);
  assert.equal(looksLikeNetscape('a.com\tFALSE\t/\tFALSE\t0\tn\tv'), true, 'headerless tab-separated file');
});

test('parse maps flags, HttpOnly prefix, session cookies and host-only domains', () => {
  const { cookies, errors } = parseNetscapeCookies(FILE);
  assert.deepEqual(errors, []);
  assert.equal(cookies.length, 3);
  const [sid, pref, cart] = cookies;
  assert.deepEqual({ d: sid.domain, h: sid.hostOnly, s: sid.secure, x: sid.httpOnly, e: sid.expires }, { d: '.example.com', h: false, s: true, x: false, e: 2000000000 });
  assert.deepEqual({ d: pref.domain, h: pref.hostOnly, x: pref.httpOnly, p: pref.path, e: 'expires' in pref }, { d: 'www.example.org', h: true, x: true, p: '/app', e: false });
  assert.equal(cart.domain, 'shop.example.net');
  // Every converted cookie passes the real server validator.
  cookies.forEach((cookie, i) => assert.doesNotThrow(() => validateCookie(cookie, i)));
});

test('malformed lines are reported by number and never echo cookie values', () => {
  const bad = [
    `.a.com\tTRUE\t/\tTRUE\t2000000000\tonly-six-fields`,
    `.a.com\tYES\t/\tTRUE\t2000000000\tn\t${SECRET}`,
    `.a.com\tTRUE\t/\tTRUE\tnext-week\tn\t${SECRET}`,
    `\tTRUE\t/\tTRUE\t0\tn\t${SECRET}`,
  ].join('\n');
  const { cookies, errors } = parseNetscapeCookies(bad);
  assert.equal(cookies.length, 0);
  assert.deepEqual(errors.map(e => e.line), [1, 2, 3, 4]);
  assert.equal(JSON.stringify(errors).includes(SECRET), false);
  assert.throws(() => parseNetscapeCookies('x\n'.repeat(MAX_NETSCAPE_LINES + 1)), /more than/);
  assert.throws(() => parseNetscapeCookies(null), /must be text/);
});

test('the server validator still rejects unsafe cookies that parse cleanly', () => {
  const { cookies } = parseNetscapeCookies(`.example.com\tTRUE\t/\tFALSE\t0\t__Host-x\tv`);
  assert.throws(() => validateCookie(cookies[0], 0), /__Host-/);
  const insecure = parseNetscapeCookies(`a.com\tFALSE\t/\tFALSE\t0\t__Secure-x\tv`).cookies[0];
  assert.throws(() => validateCookie(insecure, 0), /__Secure-/);
});

test('round trip through the real cookie store keeps every field', () => {
  const profile = path.join(dir, 'profile');
  fs.mkdirSync(profile, { recursive: true });
  const { cookies } = parseNetscapeCookies(FILE);
  assert.equal(importProfileCookies(profile, cookies).imported, 3);
  const stored = readProfileCookies(profile);
  assert.equal(stored.length, 3);
  const { text, exported, skipped } = toNetscapeCookies(stored);
  assert.deepEqual([exported, skipped], [3, 0]);
  const again = parseNetscapeCookies(text).cookies;
  const key = c => [c.domain, c.path, c.name, c.value, c.secure, c.httpOnly, c.hostOnly, c.expires ?? 0].join('|');
  assert.deepEqual(again.map(key).sort(), cookies.map(key).sort());
});

test('export skips cookies whose value could not be read instead of writing empty values', () => {
  const { text, exported, skipped } = toNetscapeCookies([
    { name: 'ok', value: 'v', domain: 'a.com', path: '/', secure: false, httpOnly: false, hostOnly: true, expires: null },
    { name: 'locked', domain: 'b.com', path: '/', valueState: 'unavailable', valueReason: 'os_bound' },
  ]);
  assert.deepEqual([exported, skipped], [1, 1]);
  assert.equal(text.includes('locked'), false);
  assert.match(text, /^# Netscape HTTP Cookie File/);
});
