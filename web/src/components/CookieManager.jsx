import React, { useCallback, useState } from 'react';
import { api } from '../api.js';
import { useToast } from './Toasts.jsx';
import { Confirm } from './Dialog.jsx';

export function CookieManager({ profileId, browserEngine = 'chromium' }) {
  const toast = useToast();
  const [transferPassphrase,setTransferPassphrase]=useState(''),[transferConfirmed,setTransferConfirmed]=useState(false),[crossProfile,setCrossProfile]=useState(false);
  const [cookies, setCookies] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [confirm, setConfirm] = useState(null);
  const [revealed, setRevealed] = useState(() => new Set());
  const [readOnly, setReadOnly] = useState(browserEngine === 'firefox');
  const load = useCallback(async () => {
    setError('');
    try {
      const body = await api(`/api/profiles/${profileId}/cookies`);
      setReadOnly(!!body.readOnly);
      setCookies(body.cookies);
    }
    catch (e) { setCookies([]); setError(e.message); }
  }, [profileId]);
  React.useEffect(() => { load(); }, [load]);
  const keyOf = cookie => `${cookie.domain}\n${cookie.path}\n${cookie.name}`;
  const chosen = () => (cookies || []).filter(cookie => selected.has(keyOf(cookie))).map(cookie => ({ name: cookie.name, domain: cookie.domain, path: cookie.path }));
  const download = async () => {
    try {
      const body = await api(`/api/profiles/${profileId}/cookies`);
      const blob = new Blob([JSON.stringify({ version: 1, cookies: body.cookies }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'cookies.json'; link.click();
      URL.revokeObjectURL(url);
    } catch (e) { toast(e.message, 'error'); }
  };
  const onImport = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const cookies = Array.isArray(parsed) ? parsed : parsed.cookies;
      const result = await api(`/api/profiles/${profileId}/cookies/import`, { method: 'POST', body: { version: 1, cookies } });
      toast(`Imported ${result.imported} cookies`, 'success');
      setSelected(new Set());
      await load();
    } catch (e) { toast(e.message, 'error'); }
  };
  const clear = async body => {
    try {
      const result = await api(`/api/profiles/${profileId}/cookies/clear`, { method: 'POST', body });
      toast(`Cleared ${result.cleared} cookies`, 'success');
      setSelected(new Set());
      await load();
    } catch (e) { toast(e.message, 'error'); }
  };
  const exportEncrypted = async () => {
    try {
      const response=await fetch(`/api/profiles/${profileId}/cookies/export-encrypted`,{method:'POST',headers:{'Content-Type':'application/json',...(window.pm?.uiToken?{'X-UI-Token':window.pm.uiToken}:{})},body:JSON.stringify({passphrase:transferPassphrase,confirmSensitive:transferConfirmed})});
      if(!response.ok)throw Error((await response.json()).error||'Cookie export failed');
      const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download='cookies.azwc';link.click();URL.revokeObjectURL(url);setTransferPassphrase('');setTransferConfirmed(false);
    } catch(error){toast(error.message,'error');}
  };
  const importEncrypted = async event => {
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    try {
      if(file.size>300*1024)throw Error('Cookie archive exceeds 300 KiB');
      const bytes=new Uint8Array(await file.arrayBuffer());let value='';for(const byte of bytes)value+=String.fromCharCode(byte);
      await api(`/api/profiles/${profileId}/cookies/import-encrypted`,{method:'POST',body:{archive:btoa(value),passphrase:transferPassphrase,confirm:transferConfirmed,confirmTransfer:crossProfile}});
      setTransferPassphrase('');setTransferConfirmed(false);setCrossProfile(false);await load();toast('Encrypted cookies imported','success');
    } catch(error){toast(error.message,'error');}
  };
  return <div className="form">
    <section className="panel"><h3>Encrypted cookie transfer</h3><label>Cookie transfer passphrase<input type="password" autoComplete="new-password" value={transferPassphrase} onChange={e=>setTransferPassphrase(e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={transferConfirmed} onChange={e=>setTransferConfirmed(e.target.checked)} />I authorize transfer of sensitive cookies for this profile.</label>
      <label className="check"><input type="checkbox" checked={crossProfile} onChange={e=>setCrossProfile(e.target.checked)} />I explicitly authorize importing from another isolated profile.</label>
      <button disabled={!transferConfirmed||transferPassphrase.length<8} onClick={exportEncrypted}>Export encrypted cookies</button>
      {!readOnly&&<label>Import encrypted cookies<input type="file" accept=".azwc" disabled={!transferConfirmed||transferPassphrase.length<8} onChange={importEncrypted} /></label>}
      <p className="muted">Firefox cookie-only import remains unavailable. OS-bound cookie values require supported browser access. Full encrypted profile backups preserve more browser state.</p>
    </section>
    <div className="notice warn">Cookie values are shown only in this list and in an exported file. They are not written to the application log. Stop the profile before importing or clearing; a live browser keeps its own copy of the cookie database.{readOnly && ' Firefox gecko cookies are read-only here (export supported; import/clear are not implemented).'}</div>
    {error && <p className="err-text">{error}</p>}
    <div className="row">
      <button onClick={load}>Refresh</button>
      <button onClick={download} disabled={!cookies}>Export JSON</button>
      {!readOnly && <label className="file-btn">Import JSON<input type="file" accept="application/json,.json" onChange={onImport} /></label>}
      {!readOnly && <button className="ghost-danger" disabled={!selected.size} onClick={() => setConfirm('selected')}>Clear selected</button>}
      {!readOnly && <button className="ghost-danger" disabled={!cookies?.length} onClick={() => setConfirm('all')}>Clear all</button>}
    </div>
    <div className="table-wrap"><table className="grid cookies"><thead><tr><th></th><th>Name</th><th>Domain</th><th>Flags</th><th>Value</th></tr></thead><tbody>
      {(cookies || []).map(cookie => {
        const key = keyOf(cookie);
        const shown = revealed.has(key);
        return <tr key={key}>
          <td><input type="checkbox" aria-label={`Select cookie ${cookie.name}`} checked={selected.has(key)} onChange={() => setSelected(current => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; })} /></td>
          <td className="mono">{cookie.name}</td>
          <td className="mono">{cookie.domain}{cookie.path}</td>
          <td className="muted">{[cookie.secure ? 'Secure' : '', cookie.httpOnly ? 'HttpOnly' : '', cookie.sameSite, cookie.session ? 'session' : ''].filter(Boolean).join(' · ')}</td>
          <td>{cookie.valueState === 'unavailable' ? <span className="muted">Unavailable ({cookie.valueReason})</span> : <>
            <span className="mono">{shown ? cookie.value : '••••••'}</span>
            <button className="ghost" onClick={() => setRevealed(current => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; })}>{shown ? 'Hide' : 'Show'}</button>
          </>}</td>
        </tr>;
      })}
      {cookies && !cookies.length && <tr><td colSpan="5" className="empty">No cookies stored for this profile.</td></tr>}
    </tbody></table></div>
    {confirm === 'all' && <Confirm danger title="Clear all cookies" confirmLabel="Clear all" message="Delete every cookie in this profile? This cannot be undone." onClose={() => setConfirm(null)} onConfirm={() => clear({ confirm: 'clear-all' })} />}
    {confirm === 'selected' && <Confirm danger title="Clear selected cookies" confirmLabel="Clear selected" message={`Delete ${selected.size} selected cookies? Values are not included in this request.`} onClose={() => setConfirm(null)} onConfirm={() => clear({ confirm: 'clear-selected', cookies: chosen() })} />}
  </div>;
}
