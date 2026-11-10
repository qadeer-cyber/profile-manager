// Export only explicitly selected diagnostics. Never serialize a profile or an API response.
const text = (value, pattern) => typeof value === 'string' && pattern.test(value) ? value : null;
const zone = value => text(value, /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+)$/);
const timestamp = value => Number.isFinite(value) && value > 0 && value <= Date.now() ? new Date(value).toISOString() : null;

export function privacyEvidence(profile, { runtime, environment, fresh = false } = {}) {
  const location = profile?.lastProxyLocation;
  const exitAt = timestamp(location?.browserExitVerifiedAt);
  const timezoneAt = timestamp(location?.browserTimezoneVerifiedAt);
  const active = profile?.running === true && Number.isFinite(location?.expiresAt) && location.expiresAt > Date.now();
  const browserZone = fresh ? zone(environment?.timezone?.value) : null;
  const exitIp = active && exitAt ? text(location?.ip, /^(?=.{3,45}$)[0-9a-f:.]+$/i) : null;
  const verifiedTimezone = active && timezoneAt ? zone(location?.timezone) : null;
  return {
    schemaVersion: 1,
    browser: {
      engine: text(profile?.browserEngine, /^(?:firefox|chromium)$/),
      runtime: text(profile?.advancedSettings?.runtime, /^(?:compatibility|stable-chrome|custom-native-chromium|azwah-native|privacy)$/),
      version: fresh ? text(runtime?.chromiumVersion?.value, /^\d+\.\d+\.\d+\.\d+$/) : null,
    },
    proxy: {
      type: text(profile?.proxy?.type, /^(?:http|https|socks5)$/),
      exit: { status: exitIp ? 'PASS' : 'UNVERIFIED', ip: exitIp, observedAt: exitIp ? exitAt : null },
      approximateCountry: exitIp ? text(location?.country, /^[A-Z]{2}$/) : null,
      configuredTimezone: zone(location?.timezone) || zone(profile?.browserSettings?.timezoneId),
      timezone: { status: verifiedTimezone && browserZone && verifiedTimezone !== browserZone ? 'FAIL' : verifiedTimezone ? 'PASS' : 'UNVERIFIED',
        observed: browserZone || verifiedTimezone, verifiedAtLaunch: verifiedTimezone ? timezoneAt : null },
    },
    checks: { ipv4: 'UNVERIFIED', ipv6: 'UNVERIFIED', dns: 'UNVERIFIED', webrtc: 'UNVERIFIED', fingerprintConsistency: 'UNVERIFIED' },
  };
}
