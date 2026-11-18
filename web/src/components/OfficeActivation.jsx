import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
export function OfficeActivation() {
  const [status,setStatus]=useState(null),[token,setToken]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false);
  const load=()=>api('/api/activation').then(value=>{setStatus(value);if(value.edition==='owner-personal')document.title='Azwah Multi Browser Owner';}).catch(e=>setMessage(e.message));
  useEffect(()=>{load();const timer=setInterval(load,60000);return()=>clearInterval(timer);},[]);
  async function activate(event) {
    event.preventDefault();setBusy(true);setMessage('');
    try {setStatus(await api('/api/activation',{method:'POST',body:{token:token.trim(),confirm}}));setToken('');setConfirm(false);setMessage('This device is activated for offline use.');}
    catch(error){setMessage(error.message);}finally{setBusy(false);}
  }
  if(status?.edition==='owner-personal')return <section className="panel" aria-label="Owner Edition"><h2>Azwah Multi Browser — Owner / Personal Edition</h2><p role="status">All currently implemented browser-management features are enabled for personal evaluation. No employee activation is required.</p><p>This separate edition does not issue employee licenses or represent an activated Office installation. Office builds retain device-bound Ed25519 activation. Existing feature and platform limitations still apply.</p></section>;
  return <section className="panel" aria-label="Office activation"><h2>{status?.organization?'Activate Azwah Multi Browser Office':'Azwah Multi Browser — Office Edition'}</h2>{status?.organization&&<p>Organization: {status.organization}</p>}<p className="muted">Local browser profiles, encrypted backups and device-bound office activation. Built on the protected Ultimate 3.0 baseline.</p>
    <p>{status?.active ? `Activated${status.label ? ' — '+status.label : ''}. Expires ${new Date(status.expiresAt).toLocaleString()}.` : 'An administrator-issued device license enables office functionality. Your existing data and backup exports remain accessible.'}</p>
    <label>Device identity code<input readOnly value={status?.deviceCode||'Unavailable'} /></label>
    {status?.deviceCode&&<button type="button" onClick={()=>(window.pm?.desktop ? window.pm.copyDeviceCode() : navigator.clipboard.writeText(status.deviceCode)).then(()=>setMessage('Device code copied.')).catch(()=>setMessage('Select and copy the device code.'))}>Copy Device Code</button>}
    {!status?.active&&<form onSubmit={activate}><label>Administrator license<textarea value={token} onChange={e=>setToken(e.target.value)} maxLength={8192} autoComplete="off" spellCheck="false" /></label>
      <label>License file<input type="file" accept=".azwah,.txt" onChange={async e=>{const f=e.target.files?.[0];if(f&&f.size<=8192)setToken(await f.text());else setMessage('License files must be at most 8 KiB.');}} /></label>
      <label className="check"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)} />I authorize activation on this device.</label><button disabled={busy||!confirm||!token.trim()}>Activate offline</button></form>}
    <p role="status">{message||status?.error||status?.code}</p><p className="muted">Device changes may require reissue. Offline licenses cannot receive immediate remote revocations. Cookies and browser data are never part of activation.</p>
  </section>;
}
