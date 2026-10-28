import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Dialog } from './Dialog.jsx';

const formatBytes = bytes => {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function StorageDialog({ profile, onClose }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState('');
  const load = () => {
    setBusy(true);
    api(`/api/profiles/${profile.id}/storage`).then(setInfo).catch(e => setError(e.message)).finally(() => setBusy(false));
  };
  useEffect(load, [profile.id]);
  const cleanup = async () => {
    setBusy(true); setError('');
    try { setInfo((await api(`/api/profiles/${profile.id}/storage/cleanup`, { method: 'POST', body: { confirm } })).storage); setConfirm(''); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };
  return <Dialog wide title={`Storage · ${profile.name}`} onClose={onClose} footer={<><button onClick={onClose}>Close</button></>}>
    {error && <p className="err-text" role="alert">{error}</p>}
    {!info && !error && <p className="muted">Reading the profile directory…</p>}
    {info && <div className="form">
      <p className="muted">{info.note}</p>
      <p>Data directory: <code>{info.dataDirectory}</code></p>
      <div className="stat-grid">
        <Mini label="Total" value={formatBytes(info.totalBytes)} />
        <Mini label="Cookies" value={formatBytes(info.cookies.bytes)} />
        <Mini label="Cache" value={formatBytes(info.cache.bytes)} />
        <Mini label="Site data" value={formatBytes(info.siteData.bytes)} />
      </div>
      <p className="muted">Cleanup never deletes cookies, login data, history, preferences, bookmarks, or extensions. Cache removes Cache, Code Cache, GPU caches, and service-worker cache. Site data also removes local storage, IndexedDB, and the service worker. A running profile cannot be cleaned.</p>
      <label>Type clear-cache or clear-site-data<input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="clear-cache" autoComplete="off" /></label>
      <button className="btn-danger" disabled={busy || !info.cleanupAllowed || (confirm !== 'clear-cache' && confirm !== 'clear-site-data')} onClick={cleanup}>{busy ? 'Working…' : 'Delete confirmed data'}</button>
    </div>}
  </Dialog>;
}
function Mini({ label, value }) { return <section className="stat"><span className="muted">{label}</span><b>{value}</b></section>; }
