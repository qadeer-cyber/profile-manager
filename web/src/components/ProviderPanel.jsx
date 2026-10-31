import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from './Toasts.jsx';

const EMPTY = { provider: 'brightdata', label: '', secret: '', apiToken: '', customerId: '', zone: '', username: '' };

export function ProviderPanel({ onChanged }) {
  const toast = useToast();
  const [catalog, setCatalog] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [usage, setUsage] = useState(null);
  const [session, setSession] = useState('');
  const [country, setCountry] = useState('');
  const [proxyId, setProxyId] = useState('');
  const load = () => Promise.all([api('/api/proxy-providers'), api('/api/proxy-providers/accounts')]).then(([providers, saved]) => { setCatalog(providers); setAccounts(saved); }).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);
  const selected = catalog.find(item => item.id === form.provider);
  const save = async () => {
    setBusy(true); setError('');
    try {
      const config = form.provider === 'oxylabs' ? { username: form.username } : form.provider === 'brightdata' ? { customerId: form.customerId, zone: form.zone } : {};
      await api('/api/proxy-providers/accounts', { method: 'POST', body: { provider: form.provider, label: form.label, secret: form.secret, apiToken: form.apiToken, config } });
      setForm(EMPTY); toast('Provider account saved', 'success'); await load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const materialize = async account => {
    setBusy(true); setError('');
    try {
      await api(`/api/proxy-providers/accounts/${account.id}/materialize`, { method: 'POST', body: { session, country } });
      toast('Proxy added from the provider template', 'success'); onChanged();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const rotate = async account => {
    if (!proxyId) { setError('Enter the proxy id to update'); return; }
    setBusy(true); setError('');
    try {
      await api(`/api/proxy-providers/accounts/${account.id}/rotate`, { method: 'POST', body: { proxyId, session, country } });
      toast('Session updated', 'success'); onChanged();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const importList = async account => {
    setBusy(true); setError('');
    try {
      const result = await api(`/api/proxy-providers/accounts/${account.id}/import`, { method: 'POST', body: { mode: 'direct', pages: 1 } });
      toast(`Imported ${result.created}, duplicates ${result.duplicates}, failed ${result.failed}`, result.failed ? 'error' : 'success');
      onChanged();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const showUsage = async account => {
    setBusy(true); setError('');
    try { setUsage({ id: account.id, ...(await api(`/api/proxy-providers/accounts/${account.id}/usage`, { method: 'POST', body: {} })) }); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };
  return <section className="panel"><h2>Proxy providers</h2>
    <p className="muted">These adapters use the provider’s published proxy or account API. Manual host, port, username, and password remain available. Credentials are stored encrypted and are not shown again. Usage/traffic numbers come only from each provider’s documented API when you click Usage — there is no invented bandwidth savings or traffic saver.</p>
    {error && <p className="err-text" role="alert">{error}</p>}
    <div className="provider-list">{catalog.map(item => <article key={item.id}><strong>{item.name}</strong><p className="muted">{item.notes}</p><a href={item.docs} target="_blank" rel="noreferrer">Documentation</a></article>)}</div>
    <div className="two">
      <label>Provider<select aria-label="Provider" value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value })}>{catalog.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Label<input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} /></label>
    </div>
    {form.provider === 'brightdata' && <div className="two"><label>Customer id<input value={form.customerId} onChange={e => setForm({ ...form, customerId: e.target.value })} autoComplete="off" /></label><label>Zone<input value={form.zone} onChange={e => setForm({ ...form, zone: e.target.value })} autoComplete="off" /></label></div>}
    {form.provider === 'oxylabs' && <label>Username<input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} autoComplete="off" /></label>}
    <label>{form.provider === 'webshare' ? 'API token' : 'Proxy password'}<input type="password" value={form.secret} onChange={e => setForm({ ...form, secret: e.target.value })} autoComplete="new-password" /></label>
    {form.provider === 'brightdata' && <label>Account API key for balance (optional)<input type="password" value={form.apiToken} onChange={e => setForm({ ...form, apiToken: e.target.value })} autoComplete="new-password" /></label>}
    <button className="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save account'}</button>
    {!!accounts.length && <div className="toolbar"><label>Country<input value={country} onChange={e => setCountry(e.target.value)} placeholder="us" /></label><label>Session<input value={session} onChange={e => setSession(e.target.value)} placeholder="new id rotates" /></label><label>Proxy id<input value={proxyId} onChange={e => setProxyId(e.target.value)} placeholder="for session update" /></label></div>}
    {accounts.map(account => <div key={account.id} className="ext-row"><strong>{account.label}</strong> <span className="muted">{account.provider}</span>
      <div className="row">
        {account.provider !== 'webshare' && <button disabled={busy} onClick={() => materialize(account)}>Add proxy</button>}
        {account.provider !== 'webshare' && <button disabled={busy || !session} onClick={() => rotate(account)}>Apply session</button>}
        {account.provider === 'webshare' && <button disabled={busy} onClick={() => importList(account)}>Import proxy list</button>}
        <button disabled={busy} onClick={() => showUsage(account)}>Usage</button>
        <button className="ghost-danger" disabled={busy} onClick={async () => { await api(`/api/proxy-providers/accounts/${account.id}`, { method: 'DELETE' }); load(); }}>Remove</button>
      </div>
      {usage?.id === account.id && <pre className="log">{JSON.stringify(usage, null, 2)}</pre>}
    </div>)}
    {selected && <p className="muted">{selected.sessionControl ? 'Session controls follow that provider’s username parameters.' : 'This provider does not document a session-rotation control here.'}</p>}
  </section>;
}
