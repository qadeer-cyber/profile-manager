import test from 'node:test';
import assert from 'node:assert/strict';
import { privacyEvidence } from '../web/src/lib/privacy-evidence.js';

test('privacy export excludes account data and never infers leak protection from proxy identity', () => {
  const now = Date.now();
  const profile = { running: true, browserEngine: 'chromium', name: 'private-profile-name', token: 'secret',
    proxy: { type: 'socks5', host: 'private-proxy-name', username: 'private-user', password: 'private-password' },
    lastProxyLocation: { ip: '8.8.8.8', country: 'DE', timezone: 'Europe/Berlin', expiresAt: now + 60000,
      browserExitVerifiedAt: now, browserTimezoneVerifiedAt: now, cookie: 'private-cookie' },
  };
  const snapshot = privacyEvidence(profile, { fresh: true, environment: { timezone: { value: 'UTC' } } });
  assert.equal(snapshot.proxy.exit.status, 'PASS');
  assert.equal(snapshot.proxy.timezone.status, 'FAIL');
  assert.ok(Object.values(snapshot.checks).every(status => status === 'UNVERIFIED'));
  assert.doesNotMatch(JSON.stringify(snapshot), /private-|secret/);
  assert.equal(privacyEvidence({ ...profile, running: false }).proxy.exit.status, 'UNVERIFIED');
  assert.equal(privacyEvidence({ ...profile, lastProxyLocation: { ...profile.lastProxyLocation, expiresAt: now - 1 } }).proxy.exit.status, 'UNVERIFIED');
});
