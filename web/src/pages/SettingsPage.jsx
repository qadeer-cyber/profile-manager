import React, { useEffect, useState, useCallback, useRef, createContext, useContext } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toasts.jsx';
import { useTheme } from '../hooks/useTheme.js';

function UpdatesSettings() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const refresh = () => window.pm?.updateStatus?.().then(setState).catch(() => {});
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, []);
  if (!state) return null;
  const latest = state.latest;
  const transfer = state.transfer;
  const status = { idle: 'Waiting for the first check', checking: 'Checking…', unavailable: 'Could not reach the release feed. Try again later.', current: 'You’re up to date', available: 'AZWAH Update Available' };
  async function check() {
    setBusy(true);
    try { setState(await window.pm.checkUpdate()); }
    finally { setBusy(false); }
  }
  return <section className="panel" id="updates">
    <h2>Updates</h2>
    <p>Installed version {state.version} · {state.channel === 'beta' ? 'Beta' : 'Stable'} channel</p>
    <p aria-live="polite">{status[state.status]}</p>
    {state.checkedAt && <p>Last successful check {new Date(state.checkedAt).toLocaleString()}</p>}
    {state.status === 'available' && <div>
      <h3>Version {latest.version}</h3>
      <p>{new Date(latest.publishedAt).toLocaleDateString()} · {(latest.size / 1048576).toFixed(1)} MiB</p>
      {latest.notes && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{latest.notes}</p>}
      <p>Close AZWAH normally before running the installer. The official release page contains the download and release notes.</p>
      <button disabled={transfer?.status === 'downloading' || (transfer?.status === 'verified' && transfer.version === latest.version)} onClick={() => void window.pm.downloadUpdate().catch(() => {})}>Download update</button>
      <button onClick={() => void window.pm.openUpdateRelease().catch(() => {})}>View release and download</button>
    </div>}
    {transfer?.status === 'downloading' && <div>
      <label>Installer download <progress value={transfer.received} max={transfer.size} /></label>
      <p>{transfer.received.toLocaleString()} of {transfer.size.toLocaleString()} bytes</p>
      <button onClick={() => void window.pm.cancelUpdate().catch(() => {})}>Cancel download</button>
    </div>}
    {transfer?.status === 'cancelled' && <p>Download cancelled. You can restart it.</p>}
    {transfer?.status === 'failed' && <p>Download failed or did not match the release checksum. Try again.</p>}
    {transfer?.status === 'verified' && <div>
      <p>Checksum verified · Version {transfer.version} · {transfer.size.toLocaleString()} bytes</p>
      <p style={{ overflowWrap: 'anywhere' }}>SHA-256 {transfer.sha256}</p>
      <p>Publisher signature has not been verified.</p>
      <button onClick={() => void window.pm.revealUpdate().catch(() => {})}>Show verified installer</button>
    </div>}
    <button disabled={busy || state.status === 'checking'} onClick={() => void check().catch(() => {})}>Check for updates</button>
  </section>;
}

function GeoIpSettings() {
  const toast = useToast();
  const [state, setState] = useState(null);
  const [account, setAccount] = useState('');
  const [license, setLicense] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/api/settings/geoip').then(setState).catch(error => toast(error.message, 'error')); }, [toast]);
  async function change(method) {
    setBusy(true);
    try {
      setState(await api('/api/settings/geoip', { method, ...(method === 'PUT' && { body: { account, license } }) }));
      setAccount('');
      setLicense('');
      toast(method === 'PUT' ? 'GeoIP credentials saved' : 'Stored GeoIP credentials removed', 'success');
    } catch (error) { toast(error.message, 'error'); }
    finally { setBusy(false); }
  }
  return <section className="panel" id="geoip">
    <h2>Proxy location</h2>
    <p>Auto Location uses the assigned proxy’s verified public exit. Locations are approximate and timezones are inferred from coordinates. IP geolocation by <a href="https://db-ip.com/" target="_blank" rel="noreferrer">DB-IP City Lite</a> (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>). MaxMind is optional.</p>
    <p>{state?.configured ? 'MaxMind advanced provider configured' : 'Using offline DB-IP City Lite'}</p>
    <label>MaxMind account ID<input inputMode="numeric" value={account} onChange={event => setAccount(event.target.value)} autoComplete="off" /></label>
    <label>MaxMind license key<input type="password" value={license} onChange={event => setLicense(event.target.value)} autoComplete="new-password" /></label>
    <div className="row">
      <button disabled={busy || !account.trim() || !license.trim()} onClick={() => change('PUT')}>Save GeoIP credentials</button>
      <button disabled={busy || state?.source !== 'local'} onClick={() => change('DELETE')}>Remove stored credentials</button>
    </div>
  </section>;
}

export function SettingsPage({ backupRequest = 0 }) {
  const toast = useToast();
  const [theme, setTheme] = useTheme();
  const [edition, setEdition] = useState(null);
  const [runtime, setRuntime] = useState(null);
  const [s, setS] = useState(null), [token, setToken] = useState(''), [show, setShow] = useState(false), [diag, setDiag] = useState(null);
  useEffect(() => { api('/api/settings').then(setS); api('/api/diagnostics').then(setDiag); api('/api/api-token').then(r => setToken(r.token)).catch(() => {}); api('/api/activation').then(setEdition).catch(() => {}); api('/api/browser').then(b => setRuntime(b.firefox || null)).catch(() => {}); }, []);
  useEffect(() => {
    if (s && backupRequest) document.getElementById('backup')?.scrollIntoView({ block: 'start' });
  }, [Boolean(s), backupRequest]);
  if (!s) return <p className="muted" aria-busy="true">Loading settings…</p>;
  const save = async () => { try { setS(await api('/api/settings', { method: 'PUT', body: s })); toast('Settings saved', 'success'); } catch (e) { toast(e.message, 'error'); } };
  return <div className="settings-layout">
    <nav className="settings-nav" aria-label="Settings sections">
      {[['edition', 'Edition'], ['appearance', 'Appearance'], ['launch', 'Launch and runtime'], ['geoip', 'Proxy location'], ['data', 'Data and security'], ['backup', 'Backup'], ['diagnostics', 'Diagnostics']].map(([id, label]) => <a key={id} href={'#' + id}>{label}</a>)}
    </nav>
    <div>
    <header className="page-head"><h1>Settings</h1><button className="primary" onClick={save}>Save changes</button></header>
    <section className="panel" id="edition"><h2>Edition</h2>
      <p>{edition?.edition === 'owner-personal' ? 'Owner / Personal. Implemented local features are enabled. Employee activation is not used.' : edition?.active ? `Office is activated${edition.label ? ' — ' + edition.label : ''}.` : edition?.enforced ? 'Office requires a device-bound license from your administrator. Open Edition in the sidebar to enter it.' : edition ? 'This process is not packaged as Owner and Office activation is not enforced.' : 'Edition status is unavailable.'}</p>
      <p className="muted">There is no subscription, payment, or profile limit in this build. {edition?.deviceCode ? <>Device code is on the Edition page and is not repeated here.</> : null}</p>
    </section>
    <section className="panel" id="appearance"><h2>Appearance</h2>
      <div className="seg" role="radiogroup" aria-label="Interface theme">{[['light', 'Light'], ['dark', 'Dark'], ['system', 'System']].map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={theme === value} className={theme === value ? 'sel' : ''} onClick={() => setTheme(value)}>{label}</button>)}</div>
      <p className="muted">The choice is saved in this browser profile as light, dark, or match the system. Interface language is English only; no other localization pack is shipped. There is no saved default workspace — each profile chooses one in the editor.</p>
    </section>
    <section className="panel" id="launch"><h2>Browser</h2>
      <label className="check"><input type="checkbox" checked={s.defaultHeadless} onChange={e => setS({ ...s, defaultHeadless: e.target.checked })} /> Launch profiles without a visible window (headless)</label>
      <label>Custom Chromium executable (leave empty to use the bundled/downloaded Chromium)<input value={s.executablePath} onChange={e => setS({ ...s, executablePath: e.target.value })} placeholder="C:\\Path\\to\\chrome.exe" /></label>
      <label>Custom Firefox executable (stock Mozilla Firefox — separate gecko profile tree)<input value={s.firefoxExecutablePath || ''} onChange={e => setS({ ...s, firefoxExecutablePath: e.target.value })} placeholder="Leave empty to use the bundled runtime" /></label>
      <p className="muted">Packaged builds launch the unmodified Mozilla Firefox ESR copied into resources/firefox. They do not search Program Files. A path entered here replaces that copy. Firefox is MPL 2.0; see FIREFOX-REDISTRIBUTION.txt beside the runtime. {runtime?.path ? <>Resolved executable: <code>{runtime.path}</code>.</> : 'No Firefox executable is resolved.'}</p>
      <label>Start page when a profile launches<input value={s.startUrl} onChange={e => setS({ ...s, startUrl: e.target.value })} placeholder="https://…" /></label>
      <label>Max running profiles at once (1–8)<input type="number" min={1} max={8} value={s.maxRunningProfiles ?? 4} onChange={e => setS({ ...s, maxRunningProfiles: Number(e.target.value) })} /></label>
      <label>Minimum free host memory guard (GiB, 0–4)<input type="number" min={0} max={4} value={s.minFreeMemoryGiB ?? 1} onChange={e => setS({ ...s, minFreeMemoryGiB: Number(e.target.value) })} /></label>
      <label>Max concurrent launches (1–4)<input type="number" min={1} max={4} value={s.maxConcurrentLaunches ?? 2} onChange={e => setS({ ...s, maxConcurrentLaunches: Number(e.target.value) })} /></label>
      <p className="muted">Latitude 5480 / 8 GiB defaults: 4 running profiles, 1 GiB free-memory guard, 2 parallel launches.</p>
    </section>
    <AutomationDriversPanel toast={toast} settings={s} onSettingsChange={setS} />
    <AutomationCliPanel />
    <AdbDevicesPanel toast={toast} />
    <section className="panel"><h2>Automation API</h2>
      {token ? <><p className="muted">Use this token with <code>/api/v1</code> (header <code>Authorization: Bearer …</code>). Base URL changes each launch in the desktop app; see Diagnostics.</p>
        <div className="row"><input readOnly className="mono-input" value={show ? token : '•'.repeat(24)} /><button onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button><button onClick={() => { navigator.clipboard.writeText(token); toast('Token copied', 'success'); }}>Copy</button></div></>
        : <p className="muted">In web mode the token is in <code>data/api-token</code> or <code>PM_API_TOKEN</code>.</p>}
    </section>
    <UpdatesSettings />
    <GeoIpSettings />
    <section className="panel" id="data"><h2>Data and security</h2>
      <p>Data folder: <code>{diag?.dataDir || 'Unavailable'}</code></p>
      {window.pm?.openDataDir && <button onClick={() => window.pm.openDataDir()}>Open data folder</button>}
      <p className="muted">Proxy passwords: {diag?.encryption?.backend || 'checking'}{diag?.encryption?.warning && <span className="err-text"> — {diag.encryption.warning}</span>}. Passwords are not shown in the profile overview, import lines, or this page.</p>
    </section>
    <section className="panel" id="diagnostics"><h2>Diagnostics and updates</h2>
      <p className="muted">Version {diag?.version || 'see Diagnostics'}. Chromium follows the pinned manifest. There is no separate automatic application updater. Open Help and diagnostics to install or roll back the browser payload.</p>
    </section>
    <div id="backup"><BackupPanel toast={toast} /></div>
    </div></div>;
}

function AutomationCliPanel() {
  const [caps, setCaps] = useState(null);
  const [wd, setWd] = useState(null);
  const [wdError, setWdError] = useState('');
  useEffect(() => {
    api('/api/human-input').then(setCaps).catch(() => setCaps(null));
    api('/api/webdriver').then(setWd).catch(e => setWdError(e.message));
  }, []);
  return <section className="panel"><h2>CLI &amp; automation</h2>
    <p className="muted">Local-only automation via <code>npm run pm-cli -- help</code> and bearer-token <code>/api/v1</code>. Enable automation on a profile, launch it, then attach Playwright/Puppeteer to the CDP HTTP/WebSocket endpoints (Profiles → automation icon, or the profile row when running). Manual native launches without automation do not expose CDP.</p>
    {caps && <ul className="muted small">
      <li>Human input: Chromium CDP + Firefox geckodriver ({caps.specialKeySyntax})</li>
      <li>Cancel: <code>POST /api/profiles/:id/human-input/cancel</code></li>
      <li>Engines: {(caps.supportedEngines || []).join(', ')}</li>
    </ul>}
    {!caps && !wdError && <p className="muted" aria-busy="true">Loading capability report…</p>}
    <h3 className="h3">Playwright / Puppeteer (CDP)</h3>
    <p className="muted small">Connect to <code>wsEndpoint</code> from a running profile with automation enabled. Manual native launches without CDP cannot attach.</p>
    <h3 className="h3">WebDriver bridge (optional)</h3>
    {wdError && <p className="err-text">{wdError}</p>}
    {wd && <ul className="muted small">
      <li>Report: <code>GET /api/webdriver</code> · Chromium: <code>POST /api/profiles/:id/webdriver/start</code> (requires CDP) · Firefox: <code>POST /api/profiles/:id/geckodriver/start</code></li>
      <li>Status: {(wd.activeSessions || []).length} active bridge session{(wd.activeSessions || []).length === 1 ? '' : 's'} · ChromeDriver {wd.requiresChromedriverOnPath ? 'must be on PATH or cached below' : 'available from cache/PATH'} · real navigate/quit when <code>PM_REAL_WEBDRIVER=1</code> in tests or driver installed</li>
    </ul>}
    {!wd && !wdError && <p className="muted">Loading WebDriver report…</p>}
  </section>;
}

function AdbDevicesPanel({ toast }) {
  const [report, setReport] = useState(null);
  const [diag, setDiag] = useState(null);
  const [info, setInfo] = useState(null);
  const [connectTarget, setConnectTarget] = useState('');
  const load = useCallback(async () => {
    try {
      const [devices, diagnostics] = await Promise.all([
        api('/api/adb/devices'),
        api('/api/adb/diagnostics'),
      ]);
      setReport(devices);
      setDiag(diagnostics);
    } catch (e) { toast(e.message, 'error'); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  const selectSerial = async serial => {
    try {
      await api('/api/adb/selection', { method: 'PUT', body: { serial } });
      toast(serial ? `Selected ${serial}` : 'Cleared device selection', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
  };
  const showInfo = async serial => {
    try { setInfo(await api(`/api/adb/devices/${encodeURIComponent(serial)}/info`)); }
    catch (e) { toast(e.message, 'error'); }
  };
  return <section className="panel"><h2>Local Android devices (ADB)</h2>
    <p className="muted">{report?.note || 'User-owned USB/network devices via host adb. Not a cloud phone farm.'}</p>
    {diag?.mockMode && <p className="notice warn">Mock adb (PM_MOCK_ADB) — CI/dev only. Real USB behavior is not verified until adb is on PATH with a physical device.</p>}
    {diag && <p className="muted small">{diag.versionLine || 'adb version unknown'} · {diag.counts?.device || 0} ready, {diag.counts?.unauthorized || 0} unauthorized, {diag.counts?.offline || 0} offline
      {diag.selectedSerial && <> · Selected <code>{diag.selectedSerial}</code>{diag.selectedPresent ? '' : ' (missing)'}</>}</p>}
    {diag?.recoveryHints?.length > 0 && <ul className="muted small">{diag.recoveryHints.map(h => <li key={h}>{h}</li>)}</ul>}
    {!report?.available && !report?.mockMode && <p className="muted">Status: {report?.reason || 'unavailable'} — install Android platform-tools and ensure <code>adb</code> is on PATH.</p>}
    {report?.available && <>
      <div className="row"><input placeholder="host:port for adb connect" value={connectTarget} onChange={e => setConnectTarget(e.target.value)} aria-label="ADB connect target" />
        <button type="button" onClick={async () => {
          try {
            const r = await api('/api/adb/connect', { method: 'POST', body: { serial: connectTarget.trim() } });
            toast(r.ok ? `Connected: ${r.target}` : (r.message || r.error), r.ok ? 'success' : 'error');
            load();
          } catch (e) { toast(e.message, 'error'); }
        }}>Connect</button>
        <button type="button" className="ghost" onClick={load}>Refresh</button></div>
      {report.devices?.length ? <div className="table-wrap"><table className="grid"><thead><tr><th></th><th>Serial</th><th>State</th><th>Model</th><th></th></tr></thead><tbody>
        {report.devices.map(d => <tr key={d.serial}>
          <td><input type="radio" name="adb-select" aria-label={'Select ' + d.serial} checked={report.selectedSerial === d.serial} onChange={() => selectSerial(d.serial)} disabled={d.state !== 'device'} /></td>
          <td className="mono-sm">{d.serial}</td>
          <td>{d.state}{d.state === 'unauthorized' && <span className="err-text"> — accept USB debugging on device</span>}</td>
          <td>{d.model || '—'}</td>
          <td className="actions">
            <button type="button" disabled={d.state !== 'device'} onClick={() => showInfo(d.serial)}>Info</button>
            <button type="button" className="ghost-danger" onClick={async () => {
              try {
                const r = await api('/api/adb/disconnect', { method: 'POST', body: { serial: d.serial } });
                toast(r.ok ? 'Disconnected' : (r.message || r.error), r.ok ? 'success' : 'error');
                load();
              } catch (e) { toast(e.message, 'error'); }
            }}>Disconnect</button></td>
        </tr>)}
      </tbody></table></div>
        : <p className="muted">No devices attached.</p>}
      {info?.ok && <div className="panel nested"><h3>Device info · <code>{info.serial}</code></h3>
        <p className="muted">Read-only getprop snapshot{info.mockMode ? ' (mock)' : ''}.</p>
        <ul>{Object.entries(info.properties || {}).map(([k, v]) => <li key={k}><code>{k}</code>: {v || '—'}</li>)}</ul>
        <button type="button" className="ghost" onClick={() => setInfo(null)}>Close</button></div>}
    </>}
  </section>;
}

function AutomationDriversPanel({ toast, settings, onSettingsChange }) {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api('/api/automation-drivers').then(setReport).catch(() => {}); }, []);
  useEffect(load, [settings.automationDriversOptIn]);
  const install = async driver => {
    setBusy(true);
    try {
      const r = await api('/api/automation-drivers/install', { method: 'POST', body: { driver, confirm: true } });
      setReport(r.report || r);
      toast(`${driver === 'both' ? 'Drivers' : driver} installed under data folder`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return <section className="panel"><h2>WebDriver helpers (optional cache)</h2>
    <p className="muted">ChromeDriver and geckodriver are <strong>not</strong> bundled in the offline installer. You can cache verified builds under your data folder after opt-in. CfT ChromeDriver matches pinned Chromium {report?.chromedriver?.pinnedBrowserVersion || '…'}; geckodriver is Mozilla MPL-2.0. You can still use <code>PM_CHROMEDRIVER_PATH</code> / <code>PM_GECKODRIVER_PATH</code> or PATH.</p>
    <label className="check"><input type="checkbox" checked={!!settings.automationDriversOptIn} onChange={e => onSettingsChange({ ...settings, automationDriversOptIn: e.target.checked })} /> I want to download automation drivers into my Azwah Multi Browser data folder (explicit opt-in)</label>
    {report && <ul className="muted">
      <li>ChromeDriver: {report.chromedriver.installed ? <>installed <code>{report.chromedriver.path}</code></> : 'not cached'}</li>
      <li>Geckodriver: {report.geckodriver.installed ? <>installed <code>{report.geckodriver.path}</code></> : 'not cached'}</li>
    </ul>}
    <div className="row">
      <button disabled={busy || !settings.automationDriversOptIn} onClick={() => install('chromedriver')}>Download ChromeDriver</button>
      <button disabled={busy || !settings.automationDriversOptIn} onClick={() => install('geckodriver')}>Download geckodriver</button>
      <button disabled={busy || !settings.automationDriversOptIn} onClick={() => install('both')}>Download both</button>
    </div>
    {!settings.automationDriversOptIn && <p className="muted">Save settings with opt-in checked, then download.</p>}
  </section>;
}

function BackupPanel({ toast }) {
  const [collision, setCollision] = useState('abort');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [encrypt, setEncrypt] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseAgain, setPassphraseAgain] = useState('');
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [listing, setListing] = useState(null);
  const [selectedRestoreIds, setSelectedRestoreIds] = useState([]);
  const authHeaders = () => ({ ...(window.pm?.uiToken ? { 'X-UI-Token': window.pm.uiToken } : {}) });
  const download = async () => {
    if (encrypt && (passphrase.length < 8 || passphrase !== passphraseAgain)) return toast('Use the same passphrase twice, at least 8 characters', 'error');
    setBusy(true);
    try {
      const response = await fetch('/api/backup', { method: 'POST', headers: { ...authHeaders(), ...(encrypt ? { 'Content-Type': 'application/json' } : {}) }, body: encrypt ? JSON.stringify({ encrypt: true, passphrase }) : undefined });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || `HTTP ${response.status}`); }
      const bytes = await response.arrayBuffer();
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = encrypt ? 'profile-manager-backup.pmbe' : 'profile-manager-backup.pmb'; link.click();
      URL.revokeObjectURL(url);
      setPassphrase(''); setPassphraseAgain('');
      toast(encrypt ? 'Encrypted backup downloaded. It stays on this computer.' : 'Backup downloaded. It contains profile data and proxy passwords.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const inspect = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const response = await fetch('/api/backup/inspect-stream', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...authHeaders(), ...(restorePassphrase ? { 'X-Backup-Passphrase': restorePassphrase } : {}) }, body: file });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setListing(payload);
      setSelectedRestoreIds((payload.profiles || []).map(p => p.id).filter(Boolean));
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const restore = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const body = file;
      const qs = new URLSearchParams({ collision });
      if (selectedRestoreIds.length) qs.set('profileIds', selectedRestoreIds.join(','));
      const response = await fetch(`/api/backup/restore-stream?${qs}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...authHeaders(), ...(restorePassphrase ? { 'X-Backup-Passphrase': restorePassphrase } : {}) }, body });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(payload.error || payload.message || `HTTP ${response.status}`), { code: payload.code });
      setResult(payload);
      setRestorePassphrase('');
      toast(`Restored ${payload.added.length + payload.replaced.length + payload.renamed.length} profiles`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return <section className="panel"><h2>Backup and restore</h2>
    <p className="muted">A backup includes profiles, browser data, extension files, and proxy secrets. It does not include the API token and it is not uploaded. Running profiles must be stopped first. An optional encrypted backup uses AES-256-GCM with scrypt (N=16384, r=8, p=1). Older unencrypted backups still restore. Restore checks every path and checksum before it changes this data folder.</p>
    <label className="check"><input type="checkbox" checked={encrypt} onChange={e => setEncrypt(e.target.checked)} /> Encrypt this backup with a passphrase</label>
    {encrypt && <div className="two"><label>Passphrase<input type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} autoComplete="new-password" /></label><label>Repeat passphrase<input type="password" value={passphraseAgain} onChange={e => setPassphraseAgain(e.target.value)} autoComplete="new-password" /></label></div>}
    <div className="row">
      <button className="primary" disabled={busy} onClick={download}>Download backup</button>
      <label>If a profile id already exists<select aria-label="Restore collision" value={collision} onChange={e => setCollision(e.target.value)}><option value="abort">Abort</option><option value="rename">Import as new profiles</option><option value="replace">Replace stopped profiles</option></select></label>
      <label>Restore passphrase<input type="password" value={restorePassphrase} onChange={e => setRestorePassphrase(e.target.value)} autoComplete="current-password" placeholder="Only for an encrypted file" /></label>
      <label className="file-btn">Inspect archive<input type="file" accept=".pmb,.pmbe,.pmp,application/octet-stream" onChange={inspect} disabled={busy} /></label>
      <label className="file-btn">Restore archive<input type="file" accept=".pmb,.pmbe,.pmp,application/octet-stream" onChange={restore} disabled={busy} /></label>
    </div>
    {listing?.profiles?.length > 0 && <div className="panel nested"><h3>Restore preview</h3>
      <p className="muted">{listing.format || 'backup'} · schema v{listing.schemaVersion ?? '?'} · {listing.fileChecksumCount || 0} checksums{listing.containsDatabase === false ? ' · portable (no full DB)' : ''}</p>
      <div className="row"><button type="button" className="ghost" onClick={() => setSelectedRestoreIds(listing.profiles.map(p => p.id).filter(Boolean))}>Select all</button>
        <button type="button" className="ghost" onClick={() => setSelectedRestoreIds([])}>Select none</button>
        <span className="muted">{selectedRestoreIds.length} of {listing.profiles.length} selected for selective restore</span></div>
      <ul>{listing.profiles.map(p => <li key={p.id}>
        <label className="check"><input type="checkbox" checked={selectedRestoreIds.includes(p.id)} onChange={e => setSelectedRestoreIds(ids => e.target.checked ? [...ids, p.id] : ids.filter(x => x !== p.id))} />
          <strong>{p.name}</strong> <span className="mono-sm">{p.id?.slice(0, 8)}…</span> · {p.fileCount ?? 0} files</label>
      </li>)}</ul>
      <p className="muted">With none checked, restore imports the whole archive. Check one or more rows for selective restore (collision policy still applies). Not Multilogin’s cloud format.</p></div>}
    {listing && !listing.profiles?.length && <p className="muted">{listing.encrypted ? 'Encrypted backup — enter passphrase and inspect again to preview profiles.' : 'No profiles listed in manifest.'}</p>}
    {result && <p className="muted">Added {result.added.length}, replaced {result.replaced.length}, renamed {result.renamed.length}{result.proxyDetached.length ? `, proxy detached on ${result.proxyDetached.length}` : ''}.</p>}
  </section>;
}

