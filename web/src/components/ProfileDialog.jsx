import React, { useEffect, useMemo, useState } from 'react';
import { validateBrowserSettings } from '../../../server/browser-settings.js';
import { DEFAULT_ADVANCED_SETTINGS, validateAdvancedSettings } from '../../../server/advanced-settings.js';
import { validateWebRtcSettings, WEBRTC_CHOICES } from '../../../server/webrtc-policy.js';
import { api } from '../api.js';
import { useToast } from './Toasts.jsx';
import { Drawer, Tabs } from './Drawer.jsx';
import { ProxyTestResult } from './ProxyTestResult.jsx';
import { ProxyLineField } from './ProxyLineField.jsx';
import { ProfileOverview } from './ProfileOverview.jsx';
import { useProxyLibrary } from '../hooks/useProxyLibrary.js';
import { assignableLibraryProxies } from '../lib/proxySwitch.js';
import { FingerprintFields, IdentityFields, LocationFields, PreferenceFields, WindowFields } from './ProfileAdvanced.jsx';
import { CookieManager } from './CookieManager.jsx';
import { HardwarePanel } from './HardwarePanel.jsx';

export const emptyForm = { name: '', tags: '', folder: '', notes: '', workspaceId: '', automationEnabled: false, browserEngine: 'chromium', browserSettings: { locale: '', timezoneId: '', languages: [] }, webrtcSettings: { mode: 'browser_default' }, advancedSettings: structuredClone(DEFAULT_ADVANCED_SETTINGS), extensionAssignments: [], proxyMode: 'none', proxyId: '', proxy: { type: 'http', host: '', port: '', username: '', password: '' } };

const UNAVAILABLE = [
  ['WebRTC Masked, Custom, or Disabled', 'The saved value is a Chromium IP-handling policy, or the same mode mapped to Firefox user.js. WebRTC is not turned off and no address is written in.'],
  ['Timezone masked from the proxy IP', 'Empty uses this computer’s zone. A filled IANA name is applied on the next launch. The zone is not calculated from the proxy.'],
  ['Geolocation data Masked', 'Coordinates are stored only when access is Allow. They are not derived from the proxy address.'],
  ['Navigator Masked or Custom', 'hardwareConcurrency, deviceMemory, platform, and OSCPU stay whatever this browser reports.'],
  ['WebGL metadata Masked or Custom', 'Vendor and renderer strings are not replaced. Restricted turns WebGL off. Noise is not available.'],
  ['Canvas Noise or Disabled', 'The readback stays the browser’s own image. The optional page hook is labeled separately and is not canvas noise.'],
  ['AudioContext Noise', 'Audio stays on the browser’s own render path.'],
  ['Port scan Masked or Custom', 'Local probes keep the browser’s own result. No port list is hidden.'],
];

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
  const [templateId, setTemplateId] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [proxyLineOk, setProxyLineOk] = useState(true);
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
  const baseline = useMemo(() => JSON.stringify({ form: initial, languageText: (initial.browserSettings?.languages || []).join(', ') }), [initial]);
  const dirty = JSON.stringify({ form: f, languageText }) !== baseline;
  const requestClose = () => { if (dirty) setConfirmClose(true); else onClose(); };
  const runTest = async () => {
    setTest({ busy: true });
    try {
      const r = f.proxyMode === 'library' ? await api(`/api/proxies/${f.proxyId}/test`, { method: 'POST' })
        : initial.id && f.proxy.password === '••••' ? await api(`/api/profiles/${initial.id}/test-proxy`, { method: 'POST' })
        : await api('/api/proxy/test', { method: 'POST', body: { proxy: { ...f.proxy, port: Number(f.proxy.port) } } });
      setTest(r);
    } catch (e) { setTest({ ok: false, error: e.message }); }
  };
  const useTemplate = async () => {
    if (!templateId) return;
    try {
      const created = await api(`/api/proxies/templates/${templateId}/instantiate`, { method: 'POST', body: {} });
      setF(current => ({ ...current, proxyMode: 'library', proxyId: created.id }));
      await lib.reload();
      toast('Live proxy created from the saved template', 'success');
    } catch (e) { setFormError(e.message); toast(e.message, 'error'); }
  };
  const submit = async () => {
    if (!f.name.trim()) { setTab('general'); setFormError('Name is required'); return toast('Name is required', 'error'); }
    if (f.name.trim().length > 200) { setTab('general'); setFormError('Name is too long'); return toast('Name is too long', 'error'); }
    if (f.proxyMode === 'custom' && (!proxyLineOk || !f.proxy.host || !f.proxy.port)) { setTab('proxy'); setFormError('The proxy line is not a valid host and port'); return toast('The proxy line is not a valid host and port', 'error'); }
    if (f.proxyMode === 'library' && !f.proxyId) { setTab('proxy'); setFormError('Pick a proxy from the library'); return toast('Pick a proxy from the library', 'error'); }
    if (f.proxyMode === 'template') { setTab('proxy'); setFormError('Create a live proxy from the template before saving'); return toast('Create a live proxy from the template before saving', 'error'); }
    let next;
    try {
      const browserSettings = validateBrowserSettings({ ...regional, languages: languageText.trim() ? languageText.split(',').map(s => s.trim()) : [] });
      const webrtcSettings = validateWebRtcSettings(policy);
      const advancedSettings = validateAdvancedSettings(advanced);
      next = { ...f, browserSettings, webrtcSettings, advancedSettings };
    } catch (e) {
      const nextTab = e.code === 'INVALID_ADVANCED_SETTINGS' && e.tab === 'preferences' ? 'extra' : (e.code === 'INVALID_WEBRTC_SETTINGS' || e.code === 'INVALID_BROWSER_SETTINGS' || e.code === 'INVALID_ADVANCED_SETTINGS') ? 'fingerprint' : 'general';
      setTab(nextTab); setFormError(e.message); return toast(e.message, 'error');
    }
    setSaving(true); setFormError('');
    try { await onSave(next); }
    catch (e) { setFormError(e.message || 'Could not save the profile'); }
    finally { setSaving(false); }
  };
  const tagList = f.tags.split(',').map(t => t.trim()).filter(Boolean);
  const templates = (lib.list || []).filter(p => p.tags?.includes('template'));
  const proxyReady = f.proxyMode === 'library' ? !!f.proxyId : f.proxyMode === 'custom' && !!f.proxy.host && !!f.proxy.port;
  return <Drawer className="editor-sheet" title={initial.id ? 'Edit browser profile' : 'New browser profile'} subtitle={initial.running ? 'This profile is running. Proxy, region, fingerprint, and extension changes apply on the next launch.' : 'Local profile. Nothing here is uploaded.'} onClose={requestClose}
    footer={<>
      {confirmClose && <span className="muted">Discard unsaved changes?</span>}
      {confirmClose && <button type="button" onClick={onClose}>Discard</button>}
      <button type="button" onClick={requestClose} disabled={saving}>Cancel</button>
      <button type="button" className="primary" onClick={submit} disabled={saving} aria-busy={saving} aria-label={initial.id ? 'Save changes' : 'Create profile'}>{saving ? 'Saving…' : initial.id ? 'Update' : 'Create'}</button>
    </>}>
    <div className="editor-top">
      <button type="button" className="ghost" onClick={requestClose}>Back</button>
      <Tabs value={tab} onChange={setTab} tabs={[['general', 'General'], ['proxy', 'Proxy'], ['fingerprint', 'Fingerprint'], ['extra', 'Extra']]} />
    </div>
    {formError && <p className="err-text" role="alert">{formError}</p>}
    <div className="editor-layout" data-shot={'editor-' + tab}>
      <div className="editor-main">
        {tab === 'general' && <div className="form">
          <label>Name<input autoFocus value={f.name} onChange={e => set('name', e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="Profile name" /></label>
          <div className="two">
            <label>Folder<input list="pm-folders" value={f.folder} onChange={e => set('folder', e.target.value)} placeholder="No folder" />
              <datalist id="pm-folders">{folders.filter(Boolean).map(x => <option key={x} value={x} />)}</datalist></label>
            <label>Workspace<select value={f.workspaceId || ''} onChange={e => set('workspaceId', e.target.value)}>
              <option value="">No workspace</option>
              {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}{w.vaultLocked ? ' (vault)' : ''}</option>)}
            </select></label>
          </div>
          <label>Tags<input value={f.tags} onChange={e => set('tags', e.target.value)} placeholder="Search or type tags, comma separated" /></label>
          {tagList.length > 0 && <div className="chips">{tagList.map(t => <span key={t} className="tag">{t}</span>)}</div>}
          <label>Notes<textarea rows="4" value={f.notes} onChange={e => set('notes', e.target.value)} placeholder="Note" /></label>
          <label>Browser engine<select aria-label="Browser engine" value={f.browserEngine || 'chromium'} onChange={e => set('browserEngine', e.target.value)}>
            <option value="chromium">Chromium</option>
            <option value="firefox">Firefox</option>
          </select></label>
          <p className="muted hint">Manual launches use an independent browser process. Firefox uses the executable from Settings. Chromium extensions are not loaded on Firefox profiles. Profile templates are saved from the profile list when that action is available.</p>
          {f.browserEngine === 'firefox' && <div className="notice warn" role="note">
            <strong>Firefox limits:</strong> CookieRobot, Chromium extensions, and ChromeDriver do not apply. Use geckodriver when automation is enabled. This is stock Firefox, not a patched build.
          </div>}
          {configWarnings.length > 0 && <ul className="muted">{configWarnings.map(w => <li key={w.code}>{w.message}</li>)}</ul>}
          <label className="check toggle"><input type="checkbox" role="switch" checked={!!f.automationEnabled} onChange={e => set('automationEnabled', e.target.checked)} /> Enable automation (CDP or geckodriver)</label>
          <p className="muted hint">When on, launch opens a local debugging port. Any program on this computer can then control the browser.{initial.running ? ' Applies on the next launch.' : ''}</p>
          {advanced.preferences?.restoreTabs !== true && <div className="notice">
            <strong>Tab restore is off.</strong> Turn it on under Extra → Startup to reopen http(s) tabs after a graceful stop.
            {initial.id && initial.tabRestore?.savedCount > 0 && <span> {initial.tabRestore.savedCount} saved tab{initial.tabRestore.savedCount === 1 ? '' : 's'} are waiting.</span>}
          </div>}
        </div>}
        {tab === 'proxy' && <div className="form">
          <div className="seg" role="radiogroup" aria-label="Proxy source">{[['none', 'None'], ['custom', 'Custom'], ...(lib.available ? [['library', 'Saved']] : []), ['template', 'Template']].map(([k, l]) =>
            <button key={k} type="button" role="radio" aria-checked={f.proxyMode === k} className={f.proxyMode === k ? 'sel' : ''} disabled={k === 'template' && lib.available && !templates.length && !lib.loading} title={k === 'template' && !templates.length ? 'No saved proxy templates yet' : undefined} onClick={() => { setTest(null); set('proxyMode', k); }}>{l}</button>)}</div>
          {lib.available === false && <p className="muted">The reusable proxy library is not available on this server, so only a custom proxy or no proxy can be saved.</p>}
          {f.proxyMode === 'library' && <label>Saved proxy<select aria-label="Saved proxy" value={f.proxyId} onChange={e => { setTest(null); set('proxyId', e.target.value); }}>
            <option value="">Select a proxy…</option>{assignableLibraryProxies(lib.list).map(p => <option key={p.id} value={p.id}>{p.name} ({p.type}://{p.host}:{p.port}){p.lastTest?.status === 'failed' ? ' · last test failed' : ''}</option>)}</select></label>}
          {lib.loading && <p className="muted" aria-busy="true">Loading proxy library…</p>}
          {lib.error && <p className="err-text">{lib.error}</p>}
          {f.proxyMode === 'template' && <div className="form">
            <p className="muted">A template is not assigned directly. Creating a live proxy copies it, then this profile uses that saved proxy.</p>
            <label>Saved template<select aria-label="Saved template" value={templateId} onChange={e => setTemplateId(e.target.value)}>
              <option value="">Select a template…</option>{templates.map(p => <option key={p.id} value={p.id}>{p.name} ({p.type}://{p.host}:{p.port})</option>)}
            </select></label>
            <button type="button" disabled={!templateId} onClick={useTemplate}>Create live proxy from template</button>
          </div>}
          {f.proxyMode === 'custom' && <ProxyLineField proxy={f.proxy} onValidity={setProxyLineOk} onChange={proxy => { setTest(null); setF(current => ({ ...current, proxy })); }} />}
          {f.proxyMode !== 'none' && f.proxyMode !== 'template' && <div className="row center">
            <button type="button" onClick={runTest} disabled={test?.busy || !proxyReady}>Test Proxy</button>
            <ProxyTestResult r={test} />
          </div>}
          {test && !test.busy && <p className="muted hint">Test Proxy sends one request with this same proxy configuration and reports the observed egress address, latency, and status when the service returns them. A successful transport check is not a statement about every browser API, and it is not an anonymity claim.</p>}
          {initial.running && f.proxyMode !== 'none' && <p className="notice">This profile is running. The open browser keeps its current route until you stop it and launch again.</p>}
        </div>}
        {tab === 'fingerprint' && <div className="form">
          {initial.firefoxSession?.state === 'disconnected' && <p className="notice warn" role="alert">Firefox remote session disconnected. The requested timezone is unverified. Stop and relaunch this profile to recover.</p>}
          <h3 className="h3">Region and language</h3>
          <label>Locale<input value={regional.locale} onChange={e => setRegional('locale', e.target.value)} placeholder="Host default (e.g. en-US)" /></label>
          <label>Timezone<input value={regional.timezoneId} onChange={e => setRegional('timezoneId', e.target.value)} placeholder="Host default (e.g. Asia/Karachi)" /></label>
          {f.browserEngine === 'firefox' && <label>Firefox session mode<select value={regional.firefoxSessionMode || 'marionette'} onChange={e => setRegional('firefoxSessionMode', e.target.value)}><option value="marionette">Marionette / geckodriver (Windows host timezone)</option><option value="bidi">Managed BiDi timezone (independent geckodriver unavailable)</option></select></label>}
          <label>Preferred languages, in order<input value={languageText} onChange={e => setLanguageText(e.target.value)} placeholder="e.g. en-US, ur-PK" /></label>
          <p className="muted hint">Empty fields keep the host values. The first preferred language must match an explicit locale. These values do not change the proxy address.</p>
          <h3 className="h3">WebRTC</h3>
          <div className="notice warn">These are the browser’s real IP-handling choices. Browser default adds no policy flag. A restrictive policy does not turn WebRTC off, spoof an address, or promise that media follows the proxy.</div>
          <label>WebRTC IP handling<select value={policy.mode} onChange={e => setF({ ...f, webrtcSettings: { mode: e.target.value } })}>
            {WEBRTC_CHOICES.map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
          </select></label>
          {(f.browserEngine || 'chromium') === 'firefox' && <p className="muted hint">On Firefox the same mode is written to stock Gecko ICE prefs in user.js.</p>}
          <h3 className="h3">Identity and window</h3>
          <IdentityFields settings={advanced} onChange={setAdvanced} />
          <WindowFields settings={advanced} onChange={setAdvanced} profileId={initial.id} />
          <h3 className="h3">Geolocation</h3>
          <LocationFields settings={advanced} onChange={setAdvanced} />
          <h3 className="h3">Graphics, canvas, and audio</h3>
          <FingerprintFields settings={advanced} onChange={setAdvanced} />
          <h3 className="h3">Not available on this build</h3>
          {UNAVAILABLE.map(([label, reason]) => <p key={label} className="unavailable-choice"><span className="label">{label}</span><br />{reason}</p>)}
        </div>}
        {tab === 'extra' && <div className="form">
          <h3 className="h3">Startup</h3>
          <PreferenceFields settings={advanced} onChange={setAdvanced} />
          <h3 className="h3">Extensions</h3>
          {(f.browserEngine || 'chromium') === 'firefox'
            ? <div className="notice warn">Chromium extension assignments do not apply on Firefox. Import a signed or unpacked add-on on the Extensions page. There is no signing bypass.</div>
            : <div className="notice warn">Enabled unpacked extensions are passed with --load-extension. A headless window often ignores them. This app does not review extension code.</div>}
          {(f.browserEngine || 'chromium') !== 'firefox' && <>
            {libraryLoading && <p className="muted" aria-busy="true">Loading extensions…</p>}
            {libraryError && <p className="err-text">{libraryError}</p>}
            {!library.length && !libraryError && <p className="muted">No extensions in the library yet. Add one on the Extensions page, then assign it here.</p>}
            {library.map(ext => {
              const assigned = assignments.find(entry => entry.extensionId === ext.id);
              const perms = [...ext.permissions, ...ext.hostPermissions];
              return <div key={ext.id} className="ext-row">
                <label className="check"><input type="checkbox" checked={!!assigned} onChange={e => setAssignment(ext.id, e.target.checked ? { extensionId: ext.id, enabled: true } : null)} /> {ext.name} <span className="muted">{ext.version}</span></label>
                {assigned && <label className="check"><input type="checkbox" checked={assigned.enabled} onChange={e => setAssignment(ext.id, { extensionId: ext.id, enabled: e.target.checked })} /> Load on launch</label>}
                <div className="muted perms">Permissions: {perms.length ? perms.join(', ') : 'none declared'}{ext.optionalPermissions?.length ? ` · Optional: ${ext.optionalPermissions.join(', ')}` : ''}</div>
              </div>;
            })}
          </>}
          <h3 className="h3">Cookies</h3>
          {initial.id ? <CookieManager profileId={initial.id} browserEngine={f.browserEngine || 'chromium'} /> : <p className="muted">Save the profile before importing or exporting cookies.</p>}
          <h3 className="h3">Hardware</h3>
          <HardwarePanel profileId={initial.id} />
          <p className="muted hint">Bookmarks are whatever the browser saved in this profile. There is no separate bookmark editor. Encrypted portable backup is on the profile row. Cookie-Editor setup is on the Extensions page.</p>
        </div>}
      </div>
      <ProfileOverview form={f} languageText={languageText} />
    </div>
  </Drawer>;
}
