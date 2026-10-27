import React, { useEffect, useState, useCallback, useRef, createContext, useContext } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toasts.jsx';

export function SettingsPage() {
  const toast = useToast();
  const [s, setS] = useState(null), [token, setToken] = useState(''), [show, setShow] = useState(false), [diag, setDiag] = useState(null);
  useEffect(() => { api('/api/settings').then(setS); api('/api/diagnostics').then(setDiag); api('/api/api-token').then(r => setToken(r.token)).catch(() => {}); }, []);
  if (!s) return null;
  const save = async () => { try { setS(await api('/api/settings', { method: 'PUT', body: s })); toast('Settings saved', 'success'); } catch (e) { toast(e.message, 'error'); } };
  return <>
    <header className="page-head"><h1>Settings</h1><button className="primary" onClick={save}>Save changes</button></header>
    <section className="panel"><h2>Browser</h2>
      <label className="check"><input type="checkbox" checked={s.defaultHeadless} onChange={e => setS({ ...s, defaultHeadless: e.target.checked })} /> Launch profiles without a visible window (headless)</label>
      <label>Custom Chromium executable (leave empty to use the bundled/downloaded Chromium)<input value={s.executablePath} onChange={e => setS({ ...s, executablePath: e.target.value })} placeholder="C:\\Path\\to\\chrome.exe" /></label>
      <label>Start page when a profile launches<input value={s.startUrl} onChange={e => setS({ ...s, startUrl: e.target.value })} placeholder="https://…" /></label>
    </section>
    <section className="panel"><h2>Automation API</h2>
      {token ? <><p className="muted">Use this token with <code>/api/v1</code> (header <code>Authorization: Bearer …</code>). Base URL changes each launch in the desktop app; see Diagnostics.</p>
        <div className="row"><input readOnly className="mono-input" value={show ? token : '•'.repeat(24)} /><button onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button><button onClick={() => { navigator.clipboard.writeText(token); toast('Token copied', 'success'); }}>Copy</button></div></>
        : <p className="muted">In web mode the token is in <code>data/api-token</code> or <code>PM_API_TOKEN</code>.</p>}
    </section>
    <section className="panel"><h2>Data</h2>
      <p>Data folder: <code>{diag?.dataDir}</code></p>
      {window.pm?.openDataDir && <button onClick={() => window.pm.openDataDir()}>Open data folder</button>}
      <p className="muted">Proxy passwords: {diag?.encryption.backend}{diag?.encryption.warning && <span className="err-text"> — {diag.encryption.warning}</span>}</p>
    </section>
  </>;
}

