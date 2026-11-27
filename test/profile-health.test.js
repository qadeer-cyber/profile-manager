// Profile Health model (web/src/lib/profileHealth.js): pure logic, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHealth, configChecks, healthBadge, HEALTH_GROUPS } from '../web/src/lib/profileHealth.js';
import { FINGERPRINT_CATEGORIES } from '../server/fingerprint-catalog.js';
import { presetSettings } from '../server/protection-presets.js';

const proxied = { proxy: { id: 'p1' }, browserSettings: {}, lastProxyLocation: { ip: '203.0.113.9', timezone: 'America/New_York' } };
const row = (id, status, summaries = []) => ({ id, label: id, status, findings: summaries.map(s => ({ status: status === 'warning' ? 'warning' : 'pass', summary: s })) });

test('every group category id exists in the fingerprint catalog, and every catalog category is shown once', () => {
  const shown = HEALTH_GROUPS.flatMap(g => g.categories).sort();
  assert.deepEqual(shown, FINGERPRINT_CATEGORIES.map(c => c.id).sort());
});

test('a stopped profile is idle, never ok, and rows say they were not measured', () => {
  const byCategory = FINGERPRINT_CATEGORIES.map(c => row(c.id, 'unavailable'));
  const h = buildHealth({ profile: proxied, running: false, byCategory });
  assert.equal(h.verdict, 'idle');
  assert.ok(h.counts.unmeasured > 0 && h.counts.ok === 1, 'only the recorded proxy exit is ok');
  assert.match(h.groups.find(g => g.id === 'graphics').rows[0].summary, /Launch the profile/);
});

test('a custom timezone that differs from the proxy exit is a mismatch even without a browser', () => {
  const profile = { ...proxied, browserSettings: { timezoneId: 'Europe/Berlin' } };
  const rows = configChecks(profile);
  assert.equal(rows.find(r => r.id === 'proxy_timezone').state, 'mismatch');
  assert.equal(healthBadge(profile).state, 'mismatch');
  assert.equal(buildHealth({ profile, running: false }).verdict, 'attention');
  assert.equal(healthBadge(proxied), null);
  assert.equal(healthBadge({ proxy: null }), null);
});

test('mismatch outranks everything and carries the finding text', () => {
  const byCategory = FINGERPRINT_CATEGORIES.map(c => c.id === 'languages' ? row(c.id, 'warning', ['Saved en-US but the browser reports de-DE.']) : row(c.id, 'pass', ['ok']));
  const h = buildHealth({ profile: proxied, running: true, byCategory });
  assert.equal(h.verdict, 'attention');
  assert.match(h.headline, /1 mismatch to fix/);
  assert.match(h.groups.find(g => g.id === 'locale').rows.find(r => r.id === 'languages').summary, /de-DE/);
});

test('ok only when everything measured matched; real-only rows do not count against it', () => {
  const byCategory = FINGERPRINT_CATEGORIES.map(c => c.id === 'webgpu' ? row(c.id, 'real-only', ['Real value.']) : row(c.id, 'pass', ['matches']));
  const h = buildHealth({ profile: proxied, running: true, byCategory });
  assert.equal(h.verdict, 'ok');
  const partial = buildHealth({ profile: proxied, running: true, byCategory: byCategory.map(r => r.id === 'canvas' ? { ...r, status: 'unavailable' } : r) });
  assert.equal(partial.verdict, 'partial');
  assert.match(partial.headline, /1 check not fully measured/);
});

test('a direct connection and an unchecked proxy are never reported as matching', () => {
  assert.equal(configChecks({ proxy: null })[0].state, 'real');
  assert.equal(configChecks({ proxy: { id: 'p' } })[0].state, 'unmeasured');
  const none = buildHealth({ profile: { proxy: null }, running: true, byCategory: null });
  assert.equal(none.verdict, 'partial', 'a running profile with no live data is never reported as ok');
  assert.equal(none.headline, 'Nothing measured yet');
});

test('a Strict profile shows its launch rules: unmeasured until the build is known, then ok or one mismatch per broken rule', () => {
  const FULL = { canvas: true, identity: true, audioScreen: true, gpuFonts: true, rectsUa: true, mediaWebrtc: true };
  const strict = extra => ({ ...proxied, proxyId: 'p1', advancedSettings: { runtime: 'azwah-native', experimental: presetSettings('strict', FULL) }, ...extra });
  const rows = (profile, features) => buildHealth({ profile, running: false, features }).groups.flatMap(g => g.rows).filter(r => r.id.startsWith('strict'));
  assert.equal(rows(strict(), null)[0].state, 'unmeasured');
  assert.deepEqual(rows(strict(), FULL).map(r => r.state), ['ok']);
  const broken = rows(strict(), { ...FULL, mediaWebrtc: false });
  assert.deepEqual(broken.map(r => r.state), ['mismatch']); assert.match(broken[0].summary, /media devices and WebRTC address/);
  assert.equal(buildHealth({ profile: strict(), running: false, features: { ...FULL, rectsUa: false } }).verdict, 'attention');
  assert.deepEqual(rows({ ...proxied, advancedSettings: { experimental: presetSettings('standard', FULL) } }, FULL), [], 'no Strict rows for other presets');
});
