import React, { useState } from 'react';
import { api } from '../api.js';
import { Dialog } from './Dialog.jsx';

export function ProfileFolderDialog({ from, onClose, onSaved }) {
  const [path, setPath] = useState(from || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const next = path.trim();
      const method = deleting ? 'DELETE' : from ? 'PATCH' : 'POST';
      const body = deleting ? { path: from } : from ? { from, to: next } : { path: next };
      await api('/api/profile-folders', { method, body });
      onSaved(deleting ? '__all' : next);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  return <Dialog title={from ? 'Manage folder' : 'Create folder'} onClose={() => { if (!busy) onClose(); }}
    footer={<>
      <button disabled={busy} onClick={onClose}>Cancel</button>
      {from && !deleting && <button disabled={busy} className="ghost-danger" onClick={() => setDeleting(true)}>Delete empty folder</button>}
      <button type="submit" form="profile-folder-form" className={deleting ? 'btn-danger' : 'primary'}
        disabled={busy || (!deleting && (!path.trim() || path.trim() === from))}>
        {busy ? 'Working…' : deleting ? 'Delete folder' : from ? 'Save path' : 'Create folder'}
      </button>
    </>}>
    <form id="profile-folder-form" onSubmit={save}>
      {deleting
        ? <p>Delete “{from}”? Only empty folders without subfolders or profiles in Trash can be deleted.</p>
        : <><label>Folder path<input autoFocus required value={path} maxLength={240} disabled={busy} onChange={event => setPath(event.target.value)} /></label>
          <p className="muted">Use / for nesting, for example Projects/Research. Create the parent first.</p></>}
      {error && <p className="bad" role="alert">{error}</p>}
    </form>
  </Dialog>;
}
