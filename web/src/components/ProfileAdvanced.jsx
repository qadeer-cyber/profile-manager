import React, { useEffect, useState } from 'react';
import { SCREEN_PRESETS } from '../../../server/advanced-settings.js';
import { FINGERPRINT_CONTROLS, FINGERPRINT_FIXED } from '../../../server/fingerprint-settings.js';
import { api } from '../api.js';

const PERMISSIONS = [['notifications', 'Notifications'], ['microphone', 'Microphone'], ['camera', 'Camera'], ['clipboard', 'Clipboard'], ['midi', 'MIDI']];
const STATES = [['default', 'Browser default'], ['ask', 'Ask'], ['allow', 'Allow'], ['deny', 'Deny']];

export function IdentityFields({ settings, onChange }) {
  const [identity, setIdentity] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/api/chromium-identity').then(setIdentity).catch(e => setError(e.message)); }, []);
  const mode = settings.userAgent?.mode || 'default';
  return <div className="form">
    <div className="notice">The version below is the Chromium this app launches. Presets can only use that version. Client hints keep the same full version. Headless windows say HeadlessChrome instead of Chrome. This does not make a profile undetectable.</div>
    <p><span className="label">Installed Chromium</span><br /><strong className="mono">{identity?.version || (error ? 'Unavailable' : 'Checking…')}</strong>{identity?.source === 'executable' ? <span className="muted"> · observed from the executable</span> : identity ? <span className="muted"> · pinned manifest</span> : null}</p>
    {identity?.versionMismatch && <p className="err-text">The executable version differs from the pinned manifest. Presets follow the executable so the browser is not mislabeled.</p>}
    {error && <p className="err-text">{error}</p>}
    <label>User-Agent preset<select value={mode} onChange={e => onChange({ ...settings, userAgent: { mode: e.target.value } })}>
      <option value="default">Browser default</option>
      <option value="reduced">Reduced — major version only in the UA string</option>
      <option value="full">Full — exact Chromium version in the UA string</option>
    </select></label>
    {identity?.presets?.[mode] && <p className="mono muted">{identity.presets[mode]}</p>}
    <p className="muted hint">A free-form user agent is rejected. A string that names a different Chromium version would disagree with client hints.</p>
  </div>;
}

export function LocationFields({ settings, onChange }) {
  const geo = settings.geolocation;
  const set = patch => onChange({ ...settings, geolocation: { ...geo, ...patch } });
  const allow = geo.permission === 'allow';
  return <div className="form">
    <div className="notice">Allow with coordinates uses Chromium's geolocation override. Deny and Ask use Chromium's permission state for each site you open. Default leaves the browser's own prompt alone. These are not a GPS spoof that other apps cannot see, and they do not change your IP address.</div>
    <label>Geolocation<select value={geo.permission} onChange={e => set({ permission: e.target.value, ...(e.target.value !== 'allow' ? { latitude: null, longitude: null, accuracy: null } : {}) })}>
      {STATES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    <div className="proxy-grid">
      <label>Latitude<input inputMode="decimal" disabled={!allow} value={geo.latitude ?? ''} onChange={e => set({ latitude: e.target.value })} placeholder="Optional" /></label>
      <label>Longitude<input inputMode="decimal" disabled={!allow} value={geo.longitude ?? ''} onChange={e => set({ longitude: e.target.value })} placeholder="Optional" /></label>
      <label>Accuracy (meters)<input inputMode="decimal" disabled={!allow} value={geo.accuracy ?? ''} onChange={e => set({ accuracy: e.target.value })} placeholder="Optional" /></label>
    </div>
    {!allow && <p className="muted hint">Coordinates are stored only when geolocation is Allow.</p>}
  </div>;
}

export function WindowFields({ settings, onChange }) {
  const screen = settings.screen;
  const set = patch => onChange({ ...settings, screen: { ...screen, ...patch } });
  const custom = screen.preset === 'custom';
  return <div className="form">
    <label>Screen preset<select value={screen.preset} onChange={e => {
      const preset = e.target.value;
      const known = SCREEN_PRESETS[preset];
      set(known ? { preset, width: known.width, height: known.height, viewportWidth: known.width, viewportHeight: known.height }
        : preset === 'native' ? { preset, width: null, height: null, viewportWidth: null, viewportHeight: null, deviceScaleFactor: null }
        : { preset });
    }}>
      <option value="native">Native window</option>
      {Object.entries(SCREEN_PRESETS).map(([id, size]) => <option key={id} value={id}>{size.width} × {size.height}</option>)}
      <option value="custom">Custom</option>
    </select></label>
    {custom && <div className="proxy-grid">
      <label>Screen width<input inputMode="numeric" value={screen.width ?? ''} onChange={e => set({ width: e.target.value })} /></label>
      <label>Screen height<input inputMode="numeric" value={screen.height ?? ''} onChange={e => set({ height: e.target.value })} /></label>
      <label>Viewport width<input inputMode="numeric" value={screen.viewportWidth ?? ''} onChange={e => set({ viewportWidth: e.target.value })} /></label>
      <label>Viewport height<input inputMode="numeric" value={screen.viewportHeight ?? ''} onChange={e => set({ viewportHeight: e.target.value })} /></label>
    </div>}
    <label>Device scale<select value={screen.deviceScaleFactor ?? ''} onChange={e => set({ deviceScaleFactor: e.target.value === '' ? null : Number(e.target.value) })} disabled={screen.preset === 'native'}>
      <option value="">Browser default</option>
      {[1, 1.25, 1.5, 2, 3].map(scale => <option key={scale} value={scale}>{scale}×</option>)}
    </select></label>
    <label className="check"><input type="checkbox" checked={!!screen.startMaximized} onChange={e => set({ startMaximized: e.target.checked, ...(e.target.checked ? { windowX: null, windowY: null } : {}) })} /> Start maximized</label>
    <div className="proxy-grid">
      <label>Window X<input inputMode="numeric" disabled={!!screen.startMaximized} value={screen.windowX ?? ''} onChange={e => set({ windowX: e.target.value })} placeholder="Default" /></label>
      <label>Window Y<input inputMode="numeric" disabled={!!screen.startMaximized} value={screen.windowY ?? ''} onChange={e => set({ windowY: e.target.value })} placeholder="Default" /></label>
    </div>
    <p className="muted hint">Invalid sizes, a viewport larger than the screen, an unknown scale, or a window position together with maximized are rejected and not saved.</p>
  </div>;
}

export function FingerprintFields({ settings, onChange }) {
  const fingerprint = settings.fingerprint || { webgl: 'default', fonts: 'real', mediaDevices: 'real', canvas: 'real', audio: 'real', portScan: 'real' };
  const set = (key, value) => onChange({ ...settings, fingerprint: { ...fingerprint, [key]: value } });
  return <div className="form">
    <div className="notice">These controls use Chromium’s own switches and permissions. Default and Real leave the signal alone. Restricted turns a real feature off or denies a permission. Custom values are accepted only when you type a real setting, such as a timezone or a screen size, elsewhere in this editor. Nothing here invents a GPU, font list, device, or browser version, and nothing here makes a profile undetectable.</div>
    {FINGERPRINT_CONTROLS.map(control => <label key={control.id}>{control.label}<select aria-label={control.label} value={fingerprint[control.id]} onChange={e => set(control.id, e.target.value)}>
      {control.modes.map(mode => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
    </select><span className="muted hint">{control.note}</span></label>)}
    {FINGERPRINT_FIXED.map(item => <p key={item.id}><span className="label">{item.label}</span><br />{item.reason}</p>)}
  </div>;
}

export function PreferenceFields({ settings, onChange }) {
  const prefs = settings.preferences;
  const [urls, setUrls] = useState((prefs.startupUrls || []).join('\n'));
  const setPerm = (key, value) => onChange({ ...settings, preferences: { ...prefs, permissions: { ...prefs.permissions, [key]: value } } });
  return <div className="form">
    <div className="notice">Startup options apply on the next manual launch (native Chromium or Firefox). They do not affect CookieRobot jobs, which use automation CDP with their own URL list.</div>
    <label>Startup URLs<textarea rows="4" value={urls} onChange={e => { setUrls(e.target.value); onChange({ ...settings, preferences: { ...prefs, startupUrls: e.target.value.split(/\s+/).map(s => s.trim()).filter(Boolean) } }); }} placeholder="https://example.com" /></label>
    <p className="muted hint">One http or https URL per line, at most 8. An explicit launch URL replaces them for that launch. Credentials in a URL are rejected.</p>
    <label className="check"><input type="checkbox" checked={prefs.restoreTabs === true} onChange={e => onChange({ ...settings, preferences: { ...prefs, restoreTabs: e.target.checked } })} /> Restore previous tabs</label>
    <label className="check"><input type="checkbox" checked={prefs.rememberLastWindow === true} onChange={e => onChange({ ...settings, preferences: { ...prefs, rememberLastWindow: e.target.checked } })} /> Remember last window size/position</label>
    <p className="muted hint">When enabled, a graceful stop saves window bounds to a local file (`.pm-window.json`) and reapplies them on the next launch where the browser supports it (Chromium flags / Firefox -width/-height).</p>
    <p className="muted hint">Off unless you turn it on for this profile. A graceful stop or last-window close saves that profile’s http(s) tabs and opens them on the next launch. An explicit launch address or the startup URLs above are used instead for that launch, so the old tabs are not opened beside them. Diagnostic tabs, browser-internal pages, loopback addresses, and addresses that contain a password are not saved. A crash does not rewrite the list.</p>
    {PERMISSIONS.map(([key, label]) => <label key={key}>{label}<select value={prefs.permissions[key]} onChange={e => setPerm(key, e.target.value)}>
      {STATES.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
    </select></label>)}
    <p className="muted hint">Notifications, camera, microphone, and MIDI are applied with Chromium's permission API when a page opens. Clipboard is stored in the profile preferences; Chromium does not expose a matching live permission call, so it is not described as enforced in the page.</p>
  </div>;
}
