import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BROWSER_SETTINGS, validateBrowserSettings as validate, browserContextSettings } from '../server/browser-settings.js';

test('defaults retain host/browser behavior without mutating defaults', () => {
  const a = validate({}); a.languages.push('en-US');
  assert.deepEqual(validate({}), DEFAULT_BROWSER_SETTINGS);
  assert.deepEqual(browserContextSettings(), {});
});
test('canonical tags, IANA timezone, ordered languages and partial update', () => {
  const a = validate({ locale: 'en-us', timezoneId: 'Asia/Karachi', languages: ['en-us', 'ur-pk'] });
  assert.deepEqual(a, { locale: 'en-US', timezoneId: 'Asia/Karachi', languages: ['en-US', 'ur-PK'] });
  assert.deepEqual(validate({ timezoneId: 'UTC' }, a), { ...a, timezoneId: 'UTC' });
  assert.deepEqual(validate({ locale: '', timezoneId: '', languages: [] }, a), DEFAULT_BROWSER_SETTINGS);
});
for (const value of [null, [], '', 1, { unknown: true }, { locale: null }, { locale: 'en_US' }, { locale: 'x' }, { locale: 'en-US\r\nX:1' }, { languages: 'en-US' }, { languages: [null] }, { languages: ['en-us', 'en-US'] }, { languages: Array(11).fill('en') }, { locale: 'en-US', languages: ['ur-PK'] }, { timezoneId: null }, { timezoneId: '+05:00' }, { timezoneId: 'Mars/Olympus' }]) {
  test(`reject invalid settings ${JSON.stringify(value)}`, () => assert.throws(() => validate(value), e => e.status === 400 && e.code === 'INVALID_BROWSER_SETTINGS'));
}
test('locale-only uses Playwright; ordered languages keep native Chromium language handling', () => {
  assert.deepEqual(browserContextSettings({ locale: 'de-DE', timezoneId: 'UTC', languages: [] }), { locale: 'de-DE', timezoneId: 'UTC' });
  assert.deepEqual(browserContextSettings({ locale: 'en-US', timezoneId: '', languages: ['en-US', 'ur-PK'] }), {});
});
