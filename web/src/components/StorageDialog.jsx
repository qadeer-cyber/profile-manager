import React, { useEffect, useRef, useState } from 'react';
import { api, apiBinary } from '../api.js';
import { Dialog } from './Dialog.jsx';

const formatBytes = bytes => {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const download = (name, data, type) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const importSummary = r => [`Imported ${r.imported} bookmark${r.imported === 1 ? '' : 's'}`, r.duplicates && `${r.duplicates} already present (skipped)`, r.rejected?.length && `${r.rejected.length} rejected (only http and https links are imported)`].filter(Boolean).join(' · ') + '.';

export function StorageDialog({ profile, onClose }) {
  const fileInput = useRef(null);
  const [notice, setNotice] = useState(null);
  const baseName = profile.name.replace(/[^\w.-]+/g, '_');
  const importFile = async file => {
    if (!file) return;
    setBusy(true); setError(''); setNotice(null);
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('Bookmarks file is larger than 5 MB.');
      const result = await api(`/api/profiles/${profile.id}/bookmarks/import`, { method: 'POST', body: { content: await file.text() } });
      setNotice({ ok: true, text: importSummary(result) });
    } catch (e) { setNotice({ ok: false, text: `Nothing was imported: ${e.message}` }); }
    if (fileInput.current) fileInput.current.value = '';
    setBusy(false);
  };
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
      <div className="row" style={{ marginTop: '1rem', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" disabled={busy || profile.running} title={profile.running ? 'Stop the profile before export' : 'Export Chromium bookmarks JSON'}
          onClick={async () => {
            setBusy(true); setError('');
            try {
              const data = await api(`/api/profiles/${profile.id}/bookmarks/export`);
              download(`${baseName}-bookmarks.json`, JSON.stringify(data, null, 2), 'application/json');
            } catch (e) { setError(e.message); }
            setBusy(false);
          }}>Export bookmarks</button>
        <button type="button" disabled={busy || profile.running} title={profile.running ? 'Stop the profile before export' : 'Export bookmarks as HTML that other browsers can import'}
          onClick={async () => {
            setBusy(true); setError('');
            try { download(`${baseName}-bookmarks.html`, await apiBinary(`/api/profiles/${profile.id}/bookmarks/export.html`), 'text/html'); }
            catch (e) { setError(e.message); }
            setBusy(false);
          }}>Export bookmarks (HTML)</button>
        <button type="button" disabled={busy || profile.running} title={profile.running ? 'Stop the profile before import' : 'Import a Chrome Bookmarks file, an AZWAH export, or browser-export HTML'}
          onClick={() => fileInput.current?.click()}>Import bookmarks…</button>
        <input ref={fileInput} type="file" accept=".json,.html,.htm,application/json,text/html" hidden aria-label="Bookmarks file to import"
          onChange={e => importFile(e.target.files?.[0])} />
        <button type="button" disabled={busy || profile.running} title={profile.running ? 'Stop the profile before export' : 'Export recent history JSON'}
          onClick={async () => {
            setBusy(true); setError('');
            try {
              const data = await api(`/api/profiles/${profile.id}/history/export?limit=500`);
              download(`${baseName}-history.json`, JSON.stringify(data, null, 2), 'application/json');
            } catch (e) { setError(e.message); }
            setBusy(false);
          }}>Export history</button>
      </div>
      {notice && <p className={notice.ok ? 'muted' : 'err-text'} role={notice.ok ? 'status' : 'alert'}>{notice.text}</p>}
      <p className="muted">Import adds to the existing bookmarks: folders with the same name are merged, a link already in the same folder is skipped, and only http and https links are imported. If the import fails, the profile’s bookmarks are left unchanged.</p>
      {profile.running && <p className="muted">Stop this profile to import or export on-disk bookmarks or history.</p>}
    </div>}
  </Dialog>;
}
function Mini({ label, value }) { return <section className="stat"><span className="muted">{label}</span><b>{value}</b></section>; }
