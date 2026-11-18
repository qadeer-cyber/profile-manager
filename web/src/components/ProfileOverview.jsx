import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { WEBRTC_CHOICES } from '../../../server/webrtc-policy.js';

const WEBRTC = Object.fromEntries(WEBRTC_CHOICES);

function row(label, value, title) {
  const empty = value == null || value === '';
  return <div className="overview-row" title={title || (typeof value === 'string' ? value : label)}><span>{label}</span><strong>{empty ? '—' : value}</strong></div>;
}

export function ProfileOverview({ form, languageText }) {
  const [version, setVersion] = useState('');
  const advanced = form.advancedSettings || {};
  const regional = form.browserSettings || {};
  const fingerprint = advanced.fingerprint || {};
  const screen = advanced.screen || {};
  const geo = advanced.geolocation || {};
  const engine = form.browserEngine === 'firefox' ? 'Firefox' : 'Chromium';
  useEffect(() => {
    if (form.browserEngine === 'firefox') { setVersion('Stock Firefox on this computer'); return; }
    api('/api/chromium-identity').then(r => setVersion(r.version || 'Unavailable')).catch(() => setVersion('Unavailable'));
  }, [form.browserEngine]);
  const proxy = form.proxyMode === 'none'
    ? 'Direct'
    : form.proxyMode === 'library'
      ? (form.proxyId ? 'Saved library proxy' : 'Library proxy not selected')
      : form.proxy?.host
        ? <span className="overview-proxy"><span>{(form.proxy.type || 'http').toUpperCase()}</span><span>{form.proxy.host}:{form.proxy.port}</span>{(form.proxy.username || form.proxy.password) && <span>Authentication set</span>}</span>
        : 'Custom proxy incomplete';
  const languages = (languageText || '').trim() || (regional.languages || []).join(', ') || 'Host languages';
  const screenText = screen.preset === 'custom'
    ? `${screen.width || '—'}×${screen.height || '—'}`
    : screen.preset && screen.preset !== 'native' ? String(screen.preset).replace('x', '×') : 'Native window';
  const geoData = geo.permission === 'allow' && geo.latitude != null ? `${geo.latitude}, ${geo.longitude}` : geo.permission === 'allow' ? 'Allow, no coordinates' : 'No custom coordinates';
  return <aside className="profile-overview" aria-label="Profile overview">
    <h3>Profile overview</h3>
    {row('Name', form.name || 'Untitled')}
    {row('Engine', engine)}
    {row('Version', version || 'Checking…', 'The installed browser version. This is not a substituted user-agent version.')}
    {row('Storage', 'Local', 'Profiles are stored in this computer’s data folder.')}
    {row('Folder', form.folder || 'No folder')}
    {row('Proxy', proxy, 'The password is never shown here.')}
    {row('Operating system', 'This computer', 'Platform and OS strings are not replaced.')}
    {row('WebRTC', WEBRTC[form.webrtcSettings?.mode] || form.webrtcSettings?.mode || 'Browser default')}
    {row('Timezone', regional.timezoneId || 'Host timezone')}
    {row('Geolocation access', geo.permission || 'default')}
    {row('Geolocation data', geoData)}
    {row('Languages', languages)}
    {row('Screen', screenText, 'Window size for the next launch. Screen APIs are not spoofed.')}
    {row('Fingerprint', `WebGL ${fingerprint.webgl || 'default'} · canvas ${fingerprint.canvas || 'real'} · audio ${fingerprint.audio || 'real'}`)}
  </aside>;
}
