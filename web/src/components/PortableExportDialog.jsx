import React, { useState } from 'react';
import { Dialog } from './Dialog.jsx';

export function PortableExportDialog({ profile, busy, onClose, onExport }) {
  const [passphrase, setPassphrase] = useState(''), [repeat, setRepeat] = useState(''), [confirmed, setConfirmed] = useState(false);
  return <Dialog title={`Export ${profile.name}`} onClose={onClose} footer={<><button disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !confirmed || passphrase.length < 8 || passphrase !== repeat} onClick={() => onExport({ passphrase, confirmSensitive: true })}>{busy ? 'Exporting…' : 'Download encrypted .pmp'}</button></>}>
    <p>This local file includes browser data, cookies, settings, proxy credentials and extension assets. Keep the file and its passphrase private. It is not uploaded.</p>
    <p className="muted">Some browser credentials and encrypted cookies are bound to the original operating system. Copying their bytes cannot guarantee they will decrypt on another computer.</p>
    <label>Passphrase<input type="password" autoComplete="new-password" minLength={8} maxLength={1024} value={passphrase} onChange={e => setPassphrase(e.target.value)} /></label>
    <label>Repeat passphrase<input type="password" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} /></label>
    <label className="check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I understand this export contains sensitive data.</label>
  </Dialog>;
}
