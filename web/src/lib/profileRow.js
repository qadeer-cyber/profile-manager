// Pure display helpers for the compact profile table. No React here so node --test can cover it.

const NATIVE_RUNTIMES = ['azwah-native', 'custom-native-chromium'];
export const isNativeRuntime = p => NATIVE_RUNTIMES.includes(p?.advancedSettings?.runtime) && p?.browserEngine !== 'firefox';

// Short engine label for the table cell; `full` is the exact label shown before the redesign and
// stays available as the tooltip and in the details dialog. `qualifier` keeps the honesty marker
// (development / experimental) visible in the compact cell.
export function engineLabel(p) {
  if (p?.browserEngine === 'firefox') return { short: 'Firefox', full: 'Firefox', qualifier: '' };
  const runtime = p?.advancedSettings?.runtime;
  if (NATIVE_RUNTIMES.includes(runtime)) return { short: 'Native Chromium', full: 'Azwah Native Chromium (development)', qualifier: 'dev' };
  if (runtime === 'privacy') return { short: 'Privacy Engine', full: 'Azwah Privacy Engine (experimental)', qualifier: 'exp' };
  if (runtime === 'stable-chrome') return { short: 'Chrome Stable', full: 'Google Chrome Stable', qualifier: '' };
  return { short: 'Chromium', full: 'Chromium', qualifier: '' };
}

const pad = n => String(n).padStart(2, '0');
// Compact "Today 14:05" / "Nov 3, 14:05" / "Nov 3, 2024" label; the caller keeps the full
// locale string as the tooltip.
export function compactDate(value, now = new Date()) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return `Today ${time}`;
  const month = d.toLocaleString('en-US', { month: 'short' });
  if (d.getFullYear() === now.getFullYear()) return `${month} ${d.getDate()}, ${time}`;
  return `${month} ${d.getDate()}, ${d.getFullYear()}`;
}

export function proxyLabel(proxy) {
  if (!proxy) return { text: 'Direct', title: 'Direct connection', direct: true, authenticated: false };
  return {
    text: proxy.name || `${proxy.host}:${proxy.port}`,
    title: `${proxy.type}://${proxy.host}:${proxy.port}`,
    direct: false,
    authenticated: !!(proxy.username || proxy.hasPassword),
  };
}

// Which check produced the stored proxy-exit evidence. Wording is unchanged from the previous
// table so nothing claims more verification than actually happened.
export function proxyVerificationLevel(loc) {
  if (!loc) return null;
  if (loc.browserVerifiedAt) return { key: 'browser-full', label: 'Browser exit, timezone and coordinates checked at launch' };
  if (loc.browserTimezoneVerifiedAt) return { key: 'browser-timezone', label: 'Browser exit and timezone checked at launch' };
  if (loc.browserExitVerifiedAt) return { key: 'browser-exit', label: 'Browser exit checked at launch' };
  return { key: 'probe', label: 'Proxy probe only' };
}

export const approximatePlace = loc => [loc?.city, loc?.region, loc?.country].filter(Boolean).join(', ');

// Full proxy-exit evidence, field for field as the previous inline row text showed it.
export function proxyEvidenceFields(loc, toLocale = d => d.toLocaleString()) {
  if (!loc) return [];
  const fields = [
    ['Proxy exit', loc.ip],
    ['Approximate location', approximatePlace(loc) || 'Unknown'],
    ['Timezone', loc.timezone || 'Unknown'],
  ];
  if (Number.isFinite(loc.utcOffsetMinutes)) fields.push(['UTC offset', `${loc.utcOffsetMinutes >= 0 ? '+' : ''}${loc.utcOffsetMinutes} min`]);
  if (Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) fields.push(['Coordinates', `${loc.latitude.toFixed(2)}, ${loc.longitude.toFixed(2)}`]);
  fields.push(['Accuracy', loc.radiusKm == null ? 'Provider accuracy radius unavailable' : `${loc.radiusKm} km provider radius`]);
  fields.push(['Source', loc.source || 'Unknown']);
  fields.push(['Verification', proxyVerificationLevel(loc).label]);
  const at = loc.browserExitVerifiedAt || (Number.isFinite(loc.expiresAt) ? loc.expiresAt - 86_400_000 : null);
  if (at) fields.push(['Checked', toLocale(new Date(at))]);
  return fields;
}

// One-line tooltip summary for the proxy cell.
export function proxyEvidenceSummary(loc) {
  if (!loc) return '';
  const level = proxyVerificationLevel(loc);
  return [`Proxy exit ${loc.ip}`, approximatePlace(loc) && `Approx.: ${approximatePlace(loc)}`, loc.timezone, level.label].filter(Boolean).join(' · ');
}

// The verification statements shown for native-runtime profiles. Same wording as before.
export function nativeVerification(p) {
  if (!isNativeRuntime(p)) return [];
  const out = [];
  if (p.proxy) {
    const loc = p.lastProxyLocation;
    out.push(['Proxy exit', p.running && loc?.browserExitVerifiedAt ? 'Verified at startup' : 'No current browser verification']);
    out.push(['Location', p.running && loc ? 'Approximate GeoIP' : 'No current GeoIP result']);
    out.push(['Timezone', p.running && loc?.nativeTimezoneVerifiedAt ? 'Native ICU checked at startup' : 'No current browser verification']);
    out.push(['Geolocation API, DNS and WebRTC', 'Not verified']);
  }
  out.push(['MAC isolation', 'Unavailable — Azwah has no provisioned virtual network adapter for this profile.']);
  return out;
}

export function tabRestoreBadge(tabRestore, running) {
  if (!tabRestore?.enabled) return null;
  const count = tabRestore.savedCount || 0;
  return {
    text: count ? `Tabs ${count}` : 'Tabs',
    title: running ? 'Tab restore on — saved on graceful stop' : count ? `${count} tab(s) saved for next launch` : 'Tab restore on — no saved tabs yet',
  };
}

// Compact, always-visible automation endpoint label for a running profile ("CDP :9333").
// The full endpoint stays in the tooltip and the details dialog.
export function cdpLabel(cdp) {
  const endpoint = cdp?.wsEndpoint || cdp?.debuggerAddress;
  if (!endpoint) return null;
  const port = /:(\d+)(?:\/|$)/.exec(String(endpoint))?.[1];
  return { text: port ? `:${port}` : String(endpoint), endpoint: String(endpoint) };
}
