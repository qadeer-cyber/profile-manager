// Deterministic Profile Manager block inside gecko user.js (preserves user lines outside the block).
import fs from 'node:fs';
import path from 'node:path';
import { geckoWebRtcUserPrefLines, geckoTimezoneUserPrefLine } from './firefox-gecko-prefs.js';
import { validateWebRtcSettings } from './webrtc-policy.js';

export const PM_GECKO_BEGIN = '// >>> profile-manager managed >>>';
export const PM_GECKO_END = '// <<< profile-manager managed <<<';

function escapePrefValue(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildManagedGeckoPrefLines({ proxy, relayUrl, regional, webrtcSettings }) {
  const lines = [];
  if (relayUrl) {
    lines.push('user_pref("network.proxy.type", 1);');
    try {
      const u = new URL(relayUrl);
      lines.push(`user_pref("network.proxy.http", "${escapePrefValue(u.hostname)}");`);
      lines.push(`user_pref("network.proxy.http_port", ${Number(u.port)});`);
      lines.push(`user_pref("network.proxy.ssl", "${escapePrefValue(u.hostname)}");`);
      lines.push(`user_pref("network.proxy.ssl_port", ${Number(u.port)});`);
      lines.push(`user_pref("network.proxy.socks", "${escapePrefValue(u.hostname)}");`);
      lines.push(`user_pref("network.proxy.socks_port", ${Number(u.port)});`);
    } catch { /* skip malformed relay */ }
  } else if (proxy) {
    lines.push('user_pref("network.proxy.type", 1);');
    const type = String(proxy.type || 'http').toLowerCase();
    if (type === 'socks5' || type === 'socks') {
      lines.push(`user_pref("network.proxy.socks", "${escapePrefValue(proxy.host)}");`);
      lines.push(`user_pref("network.proxy.socks_port", ${Number(proxy.port)});`);
      lines.push(`user_pref("network.proxy.socks_version", 5);`);
    } else {
      lines.push(`user_pref("network.proxy.http", "${escapePrefValue(proxy.host)}");`);
      lines.push(`user_pref("network.proxy.http_port", ${Number(proxy.port)});`);
      lines.push(`user_pref("network.proxy.ssl", "${escapePrefValue(proxy.host)}");`);
      lines.push(`user_pref("network.proxy.ssl_port", ${Number(proxy.port)});`);
    }
  } else {
    lines.push('user_pref("network.proxy.type", 0);');
  }
  if (regional?.languages?.length) {
    lines.push(`user_pref("intl.accept_languages", "${escapePrefValue(regional.languages.join(','))}");`);
    if (regional.locale) lines.push(`user_pref("intl.locale.requested", "${escapePrefValue(regional.locale)}");`);
  }
  const tzLine = geckoTimezoneUserPrefLine(regional?.timezoneId);
  if (tzLine) lines.push(tzLine);
  for (const l of geckoWebRtcUserPrefLines(validateWebRtcSettings(webrtcSettings || {}))) lines.push(l);
  return lines;
}

export function splitGeckoUserJs(content) {
  const text = String(content || '');
  const begin = text.indexOf(PM_GECKO_BEGIN);
  const end = text.indexOf(PM_GECKO_END);
  if (begin === -1 || end === -1 || end < begin) {
    return { before: text.trimEnd(), after: '' };
  }
  const before = text.slice(0, begin).trimEnd();
  const after = text.slice(end + PM_GECKO_END.length).trimStart();
  return { before, after };
}

export function writeManagedGeckoUserJs(profileDir, managedLines) {
  const file = path.join(profileDir, 'user.js');
  fs.mkdirSync(profileDir, { recursive: true });
  let before = '';
  let after = '';
  if (fs.existsSync(file)) {
    const parts = splitGeckoUserJs(fs.readFileSync(file, 'utf8'));
    before = parts.before;
    after = parts.after;
  }
  const block = [
    PM_GECKO_BEGIN,
    ...managedLines,
    PM_GECKO_END,
  ].join('\n');
  const chunks = [before, block, after].filter(Boolean);
  fs.writeFileSync(file, chunks.join('\n') + '\n', { mode: 0o600 });
}
