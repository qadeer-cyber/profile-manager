import React, { useEffect, useState } from 'react';
import { validateBrowserSettings } from '../../../server/browser-settings.js';
import { DEFAULT_ADVANCED_SETTINGS, validateAdvancedSettings } from '../../../server/advanced-settings.js';
import { validateWebRtcSettings, WEBRTC_CHOICES } from '../../../server/webrtc-policy.js';
import { api } from '../api.js';
import { useToast } from './Toasts.jsx';
import { Drawer, Tabs } from './Drawer.jsx';
import { ProxyTestResult } from './ProxyTestResult.jsx';
import { useProxyLibrary } from '../hooks/useProxyLibrary.js';
import { FingerprintFields, IdentityFields, LocationFields, PreferenceFields, WindowFields } from './ProfileAdvanced.jsx';
import { CookieManager } from './CookieManager.jsx';
import { HardwarePanel } from './HardwarePanel.jsx';

export const emptyForm = { name: '', tags: '', folder: '', notes: '', workspaceId: '', automationEnabled: false, browserEngine: 'chromium', browserSettings: { locale: '', timezoneId: '', languages: [] }, webrtcSettings: { mode: 'browser_default' }, advancedSettings: structuredClone(DEFAULT_ADVANCED_SETTINGS), extensionAssignments: [], proxyMode: 'none', proxyId: '', proxy: { type: 'http', host: '', port: '', username: '', password: '' } };

// Profile editor: General / Proxy / Notes tabs. Proxy can be "none", a library entry
// (when the server has the proxy library), or a custom inline proxy (legacy API).
export function ProfileDialog({ initial, folders = [], onSave, onClose }) {
  const [f, setF] = useState(initial);
  const [tab, setTab] = useState('general');
  const [test, setTest] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [languageText, setLanguageText] = useState((initial.browserSettings?.languages || []).join(', '));
  const [library, setLibrary] = useState([]);
  const [libraryError, setLibraryError] = useState('');
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [configWarnings, setConfigWarnings] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const regional = f.browserSettings || emptyForm.browserSettings;
  const policy = f.webrtcSettings || emptyForm.webrtcSettings;
  const advanced = f.advancedSettings || emptyForm.advancedSettings;
  const setAdvanced = next => setF({ ...f, advancedSettings: next });
  const assignments = f.extensionAssignments || [];
  const setRegional = (key, value) => setF({ ...f, browserSettings: { ...regional, [key]: value } });
  const setAssignment = (extensionId, next) => {
    const without = assignments.filter(entry => entry.extensionId !== extensionId);
    setF({ ...f, extensionAssignments: next ? [...without, next] : without });
  };
  useEffect(() => { api('/api/extensions').then(setLibrary).catch(e => setLibraryError(e.message)).finally(() => setLibraryLoading(false)); }, []);
  useEffect(() => { api('/api/workspaces').then(setWorkspaces).catch(() => setWorkspaces([])); }, []);
  useEffect(() => {
    const body = { browserEngine: f.browserEngine || 'chromium', browserSettings: f.browserSettings, webrtcSettings: f.webrtcSettings, advancedSettings: f.advancedSettings };
    api('/api/profile-config/validate', { method: 'POST', body }).then(r => setConfigWarnings(r.warnings || [])).catch(() => setConfigWarnings([]));
  }, [f.browserEngine, f.browserSettings, f.webrtcSettings, f.advancedSettings]);
  const lib = useProxyLibrary();
  const toast = useToast();
  const set = (k, v) => setF({ ...f, [k]: v });
  const setP = (k, v) => { setTest(null); setF({ ...f, proxy: { ...f.proxy, [k]: v } }); };
  const runTest = async () => {
    setTest({ busy: true });
    try {
      const r = f.proxyMode === 'library' ? await api(`/api/proxies/${f.proxyId}/test`, { method: 'POST' })
        : initial.id && f.proxy.password === '••••' ? await api(`/api/profiles/${initial.id}/test-proxy`, { method: 'POST' })
        : await api('/api/proxy/test', { method: 'POST', body: { proxy: f.proxy } });
      setTest(r);
    } catch (e) { setTest({ ok: false, error: e.message }); }
  };
  const submit = async () => {
    if (!f.name.trim()) { setTab('general'); setFormError('Name is required'); return toast('Name is required', 'error'); }
    if (f.name.trim().length > 200) { setTab('general'); setFormError('Name is too long'); return toast('Name is too long', 'error'); }
    if (f.proxyMode === 'custom' && (!f.proxy.host || !f.proxy.port)) { setTab('proxy'); setFormError('Proxy host and port are required'); return toast('Proxy host and port are required', 'error'); }
    if (f.proxyMode === 'library' && !f.proxyId) { setTab('proxy'); setFormError('Pick a proxy from the library'); return toast('Pick a proxy from the library', 'error'); }
    let next;
    try {
      const browserSettings = validateBrowserSettings({ ...regional, languages: languageText.trim() ? languageText.split(',').map(s => s.trim()) : [] });
      const webrtcSettings = validateWebRtcSettings(policy);
      const advancedSettings = validateAdvancedSettings(advanced);
      next = { ...f, browserSettings, webrtcSettings, advancedSettings };
    } catch (e) { setTab(e.code === 'INVALID_WEBRTC_SETTINGS' ? 'webrtc' : e.code === 'INVALID_ADVANCED_SETTINGS' ? (e.tab || 'identity') : 'regional'); setFormError(e.message); return toast(e.message, 'error'); }
    setSaving(true); setFormError('');
    try { await onSave(next); }
    catch (e) { setFormError(e.message || 'Could not save the profile'); }
    finally { setSaving(false); }
  };
  const tagList = f.tags.split(',').map(t => t.trim()).filter(Boolean);
  return <Drawer title={initial.id ? 'Edit profile' : 'New profile'} subtitle={initial.id ? initial.name : 'Isolated browser profile with its own storage'} onClose={onClose}
    footer={<><button onClick={onClose} disabled={saving}>Cancel</button><button className="primary" onClick={submit} disabled={saving} aria-busy={saving}>{saving ? 'Saving…' : initial.id ? 'Save changes' : 'Create profile'}</button></>}>
    <Tabs value={tab} onChange={setTab} tabs={[['general', 'General'], ['proxy', 'Proxy'], ['regional', 'Region & language'], ['identity', 'Identity'], ['fingerprint', 'Fingerprint'], ['location', 'Location'], ['window', 'Window'], ['preferences', 'Startup'], ['webrtc', 'WebRTC'], ['extensions', 'Extensions'], ...(initial.id ? [['cookies', 'Cookies'], ['hardware', 'Hardware']] : [['hardware', 'Hardware']]), ['notes', 'Notes']]} />
    {tab === 'general' && <div className="form">
      <label>Name<input autoFocus value={f.name} onChange={e => set('name', e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="e.g. Shop account 1" /></label>
      <label>Folder<input list="pm-folders" value={f.folder} onChange={e => set('folder', e.target.value)} placeholder="No folder" />
        <datalist id="pm-folders">{folders.filter(Boolean).map(x => <option key={x} value={x} />)}</datalist></label>
      <label>Tags<input value={f.tags} onChange={e => set('tags', e.target.value)} placeholder="comma, separated" /></label>
      {tagList.length > 0 && <div className="chips">{tagList.map(t => <span key={t} className="tag">{t}</span>)}</div>}
      {formError && tab === 'general' && <p className="err-text" role="alert">{formError}</p>}
      <label>Workspace<select value={f.workspaceId || ''} onChange={e => set('workspaceId', e.target.value)}>
        <option value="">No workspace</option>
        {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}{w.vaultLocked ? ' (vault)' : ''}</option>)}
      </select></label>
      <p className="muted hint">Workspaces are local folders only — no cloud sync. Vault-locked workspaces require desktop secure storage.</p>
      <label>Browser engine<select value={f.browserEngine || 'chromium'} onChange={e => set('browserEngine', e.target.value)}>
        <option value="chromium">Chromium (native manual launch)</option>
        <option value="firefox">Firefox / Gecko (separate profile tree)</option>
      </select></label>
      <p className="muted hint">Manual launches use an independent browser process (no Playwright pipe). Firefox uses Settings → Firefox executable. Chromium extensions are not loaded on Firefox profiles.</p>
      {f.browserEngine === 'firefox' && <div className="notice warn" role="note">
        <strong>Firefox limits (honest):</strong> CookieRobot-local, Chromium extensions, and ChromeDriver bridges do not apply. Use geckodriver + marionette when automation is enabled. Antidetect patches are not included — stock Mozilla Firefox only.
      </div>}
      {configWarnings.length > 0 && <ul className="muted">{configWarnings.map(w => <li key={w.code}>{w.message}</li>)}</ul>}
      <label className="check toggle"><input type="checkbox" role="switch" checked={!!f.automationEnabled} onChange={e => set('automationEnabled', e.target.checked)} /> Enable automation (CDP)</label>
      <p className="muted hint">When on, launching this profile opens a local debugging port that automation tools can connect to. Any program on this computer can then control the browser, so leave it off unless you need it.{initial.running ? ' Applies on the next launch.' : ''}</p>
      {advanced.preferences?.restoreTabs !== true && <div className="notice">
        <strong>Tab restore is off</strong> for this profile. To reopen http(s) tabs after a graceful stop, open the <button type="button" className="link" onClick={() => setTab('preferences')}>Startup</button> tab and enable <em>Restore previous tabs</em>. Manual native launches save tabs on stop when that option is on.
        {initial.id && initial.tabRestore?.savedCount > 0 && <span> This profile already has {initial.tabRestore.savedCount} saved tab{initial.tabRestore.savedCount === 1 ? '' : 's'} waiting (they open only after you enable restore).</span>}
      </div>}
      {advanced.preferences?.restoreTabs === true && initial.id && <p className="muted hint">Tab restore is on — see the <button type="button" className="link" onClick={() => setTab('preferences')}>Startup</button> tab for startup URLs and saved-tab behavior.{!initial.running && initial.tabRestore?.savedCount > 0 ? ` Next launch can reopen ${initial.tabRestore.savedCount} saved tab${initial.tabRestore.savedCount === 1 ? '' : 's'}.` : ''}{initial.tabRestore?.corrupt ? ' Saved tab list file looks corrupt; stop the profile once to refresh it.' : ''}</p>}
    </div>}
    {tab === 'proxy' && <div className="form">
      <div className="seg">{[['none', 'Direct connection'], ...(lib.available ? [['library', 'From library']] : []), ['custom', 'Custom']].map(([k, l]) =>
        <button key={k} className={f.proxyMode === k ? 'sel' : ''} onClick={() => { setTest(null); set('proxyMode', k); }}>{l}</button>)}</div>
      {lib.available === false && <p className="muted">The reusable proxy library isn't available on this server yet, so proxies are set per profile.</p>}
      {f.proxyMode === 'library' && <label>Proxy<select value={f.proxyId} onChange={e => { setTest(null); set('proxyId', e.target.value); }}>
        <option value="">Select a proxy…</option>{lib.list.map(p => <option key={p.id} value={p.id}>{p.name} ({p.type}://{p.host}:{p.port}){p.lastTest?.status === 'failed' ? ' · failing' : ''}</option>)}</select></label>}
      {f.proxyMode === 'custom' && <div className="proxy-grid">
        <label>Type<select value={f.proxy.type} onChange={e => setP('type', e.target.value)}><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option></select></label>
        <label>Host<input value={f.proxy.host} onChange={e => setP('host', e.target.value)} placeholder="proxy.example.com" /></label>
        <label>Port<input inputMode="numeric" value={f.proxy.port} onChange={e => setP('port', e.target.value.replace(/\D/g, ''))} placeholder="8080" /></label>
        <label className="span2">Username<input value={f.proxy.username} onChange={e => setP('username', e.target.value)} placeholder="Optional" autoComplete="off" /></label>
        <label>Password<input type="password" value={f.proxy.password} onChange={e => setP('password', e.target.value)} placeholder="Optional" autoComplete="new-password" /></label>
      </div>}
      {f.proxyMode !== 'none' && <div className="row center"><button onClick={runTest} disabled={test?.busy || (f.proxyMode === 'library' ? !f.proxyId : !f.proxy.host || !f.proxy.port)}>Test connection</button><ProxyTestResult r={test} /></div>}
    </div>}
    {tab === 'regional' && <div className="form">
      <label>Locale<input value={regional.locale} onChange={e => setRegional('locale', e.target.value)} placeholder="Host default (e.g. en-US)" /></label>
      <label>Timezone<input value={regional.timezoneId} onChange={e => setRegional('timezoneId', e.target.value)} placeholder="Host default (e.g. Asia/Karachi)" /></label>
      <label>Preferred languages, in order<input value={languageText} onChange={e => setLanguageText(e.target.value)} placeholder="e.g. en-US, ur-PK" /></label>
      <p className="muted hint">Leave fields empty for host/browser defaults. Use IANA timezones and BCP 47 language tags. The first preferred language must match an explicit locale. Changes apply on the next launch; timezone does not change your IP address.</p>
    </div>}
    {tab === 'webrtc' && <div className="form">
      <div className="notice warn">Chromium cannot turn WebRTC off, spoof an address, or guarantee that a profile is anonymous. These choices are Chromium's real IP-handling policies. Browser default adds no policy flag. A restrictive policy only changes which network paths WebRTC may use. It does not promise zero leaks, and it does not change your proxy.</div>
      <label>WebRTC IP handling<select value={policy.mode} onChange={e => setF({ ...f, webrtcSettings: { mode: e.target.value } })}>
        {WEBRTC_CHOICES.map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
      </select></label>
      <p className="muted hint">Disable non-proxied UDP is the strongest restriction Chromium supports. WebRTC can still use TCP or a configured proxy. The saved policy is applied on the next launch and checked against the browser arguments before the process starts.{initial.running ? ' This profile is running, so the current window keeps the previous policy until you stop and launch it again.' : ''}</p>
      {(f.browserEngine || 'chromium') === 'firefox' && <p className="muted hint">On Firefox, the same mode is mapped to stock Gecko ICE prefs in <code>user.js</code>, not Chromium policy flags.</p>}
    </div>}
    {tab === 'extensions' && <div className="form">
      {(f.browserEngine || 'chromium') === 'firefox'
        ? <div className="notice warn">Extension assignments apply to Chromium profiles only. Switch the browser engine to Chromium on the General tab to load unpacked extensions.</div>
        : <div className="notice warn">Assigned extensions are copied unpacked extensions from the library. Chromium loads the enabled ones with --load-extension and does not load the others. Headless launches use a shell that often ignores extensions; use a visible window when an extension must run. This app does not review extension code, and loading one does not sandbox it beyond Chromium.</div>}
      {(f.browserEngine || 'chromium') === 'firefox' ? null : <>
      {libraryLoading && <p className="muted">Loading extensions…</p>}
      {libraryError && <p className="err-text">{libraryError}</p>}
      {!library.length && !libraryError && <p className="muted">No extensions in the library yet. Add an unpacked extension on the Extensions page, then assign it here.</p>}
      {library.map(ext => {
        const assigned = assignments.find(entry => entry.extensionId === ext.id);
        const perms = [...ext.permissions, ...ext.hostPermissions];
        return <div key={ext.id} className="ext-row">
          <label className="check"><input type="checkbox" checked={!!assigned} onChange={e => setAssignment(ext.id, e.target.checked ? { extensionId: ext.id, enabled: true } : null)} /> {ext.name} <span className="muted">{ext.version}</span></label>
          {assigned && <label className="check"><input type="checkbox" checked={assigned.enabled} onChange={e => setAssignment(ext.id, { extensionId: ext.id, enabled: e.target.checked })} /> Load on launch</label>}
          <div className="muted perms">Permissions: {perms.length ? perms.join(', ') : 'none declared'}{ext.optionalPermissions?.length ? ` · Optional: ${ext.optionalPermissions.join(', ')}` : ''}</div>
        </div>;
      })}
      <p className="muted hint">Disabled means the extension stays in the library but this profile does not pass it to Chromium. There is no supported launch flag that loads an unpacked extension and keeps it turned off.</p>
      </>}
    </div>}
    {tab === 'identity' && <IdentityFields settings={advanced} onChange={setAdvanced} />}
    {tab === 'fingerprint' && <FingerprintFields settings={advanced} onChange={setAdvanced} />}
    {tab === 'location' && <LocationFields settings={advanced} onChange={setAdvanced} />}
    {tab === 'window' && <WindowFields settings={advanced} onChange={setAdvanced} />}
    {tab === 'preferences' && <PreferenceFields settings={advanced} onChange={setAdvanced} />}
    {tab === 'cookies' && (initial.id ? <CookieManager profileId={initial.id} browserEngine={f.browserEngine || 'chromium'} /> : <p className="muted">Save the profile before managing its cookies.</p>)}
    {tab === 'hardware' && <HardwarePanel profileId={initial.id} />}
    {tab === 'notes' && <div className="form"><label>Notes<textarea rows="8" value={f.notes} onChange={e => set('notes', e.target.value)} placeholder="Anything worth remembering about this profile" /></label></div>}
  </Drawer>;
}
