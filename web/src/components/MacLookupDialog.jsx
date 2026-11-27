import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Dialog } from './Dialog.jsx';
import '../get-started.css';

// "Whose MAC is this?" Type a full MAC or a fragment (4 or more hex digits, any separators) and see which profile and device it is.
export function MacLookupDialog({ onClose, onOpen }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const digits = text.replace(/[^0-9a-f]/gi, '').length;
  const junk = /[^0-9a-f:.\-\s]/i.test(text);
  useEffect(() => {
    setError('');
    if (digits < 4 || digits > 12 || junk) { setResult(null); return undefined; }
    const timer = setTimeout(() => api('/api/mac-lookup?mac=' + encodeURIComponent(text)).then(setResult).catch(e => { setResult(null); setError(e.message); }), 250);
    return () => clearTimeout(timer);
  }, [text, digits, junk]);
  const hint = !text ? 'Type a MAC address, or at least 4 hex digits of one.'
    : junk ? 'A MAC address uses only the digits 0-9 and letters A-F, with “:”, “-” or “.” between bytes.'
    : digits < 4 ? `${4 - digits} more hex digit${4 - digits === 1 ? '' : 's'} needed.` : digits > 12 ? 'A MAC address has 12 hex digits.' : '';
  return <Dialog wide title="Find profile by MAC address" onClose={onClose} footer={<button onClick={onClose}>Close</button>}>
    <label>MAC address or fragment<input autoFocus className="mono" spellCheck={false} value={text} onChange={e => setText(e.target.value)} placeholder="02:AB:CD:EF:01:23 or AB:CD" aria-describedby="mac-lookup-hint" /></label>
    <p id="mac-lookup-hint" className="muted small" role="status">{error || hint}</p>
    {result && result.matches.length === 0 && <div className="notice" role="status">
      <strong>No profile has this MAC.</strong> <span className="muted small">It may belong to a real device on your network (a router, a phone, your computer’s own adapter), not to one of your profiles. Profile MACs are labels saved in AZWAH.</span></div>}
    {result && result.matches.length > 0 && <ul className="mac-results" aria-label="Matching profiles">
      {result.matches.map(m => <li key={m.id}>
        <div><strong>{m.name}</strong>{m.folder ? <span className="muted small"> · {m.folder}</span> : null} {m.running && <span className="pill on">running</span>}
          {m.exact && <span className="pill observed">exact match</span>}</div>
        <div className="mono-sm">{m.mac}</div>
        <div className="muted small">{m.device.name ? <strong>{m.device.name}</strong> : null}{m.device.name ? ' · ' : ''}{m.device.reportsAs} · {m.device.code}</div>
        <button type="button" onClick={() => onOpen(m.id)}>Open details</button>
      </li>)}
    </ul>}
  </Dialog>;
}
