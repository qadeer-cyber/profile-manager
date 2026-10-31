import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCookieRobotUrl, validateCookieRobotUrlList } from '../server/cookie-robot-url.js';

test('validateCookieRobotUrl accepts ordinary https URLs', () => {
  assert.equal(validateCookieRobotUrl('https://Example.COM/path'), 'https://example.com/path');
});

test('validateCookieRobotUrl rejects credentials and non-http(s)', () => {
  assert.throws(() => validateCookieRobotUrl('ftp://example.com/'), /http/);
  assert.throws(() => validateCookieRobotUrl('https://user:pass@example.com/'), /credentials/);
});

test('validateCookieRobotUrl rejects Google account and recaptcha paths', () => {
  assert.throws(() => validateCookieRobotUrl('https://accounts.google.com/foo'), err => err.code === 'URL_NOT_ALLOWED');
  assert.throws(() => validateCookieRobotUrl('https://example.com/recaptcha/api2'), err => err.code === 'URL_NOT_ALLOWED');
});

test('validateCookieRobotUrlList enforces batch size', () => {
  assert.throws(() => validateCookieRobotUrlList([]), /1-30/);
});
