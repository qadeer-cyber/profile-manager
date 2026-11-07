import React,{useEffect,useState} from 'react';
import {api} from '../api.js';
export function CookieEditorSetup(){
  const [profiles,setProfiles]=useState([]),[selected,setSelected]=useState(''),[confirmed,setConfirmed]=useState(false),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{api('/api/profiles').then(setProfiles).catch(e=>setMessage(e.message));},[]);
  async function act(setup){setBusy(true);try{const data=await api(`/api/profiles/${selected}/cookie-editor${setup?'/setup':''}`,setup?{method:'POST',body:{confirm:confirmed}}:{});setMessage(setup?data.message:JSON.stringify(data));}catch(e){setMessage(e.message);}finally{setBusy(false);}}
  return <section className="panel"><h2>Official Cookie-Editor</h2><p>Install from the official browser store in one selected profile. This opens the store and requires your browser confirmation. New and existing profiles use the same explicit workflow.</p>
    <label>Cookie-Editor profile<select value={selected} onChange={e=>{setSelected(e.target.value);setConfirmed(false);}}><option value="">Choose profile</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.name} · {p.browserEngine}</option>)}</select></label>
    <label className="check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />I authorize opening the official store in this profile.</label>
    <button disabled={!selected||!confirmed||busy} onClick={()=>act(true)}>Open official installation</button><button disabled={!selected||busy} onClick={()=>act(false)}>Inspect stopped profile</button><p role="status">{message}</p>
    <p className="muted">Cookie-Editor by Moustachauve is GPL-3.0. Extension payloads are not bundled. Browser stores enforce their installation policies. Cookies remain isolated per profile and may expire or be revoked by websites.</p><a href="https://github.com/Moustachauve/cookie-editor" target="_blank" rel="noreferrer">Official source and license</a>
  </section>;
}
