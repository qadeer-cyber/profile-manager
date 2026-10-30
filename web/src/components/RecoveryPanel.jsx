import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { Confirm } from './Dialog.jsx';

export function RecoveryPanel() {
  const [items, setItems] = useState([]), [error, setError] = useState(''), [choice, setChoice] = useState(null), [busy, setBusy] = useState(false);
  const load = useCallback(() => api('/api/recovery/operations').then(setItems).catch(e => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const run = async () => {
    setBusy(true); setError('');
    try { await api(`/api/recovery/operations/${choice.id}/recover`, { method: 'POST', body: { confirm: true, cleanup: choice.cleanup } }); setChoice(null); await load(); }
    catch (e) { setError(e.message); setChoice(null); }
    finally { setBusy(false); }
  };
  return <section className="panel"><h2>Data recovery</h2><p className="muted">Interrupted restores retain copies for verification. Interrupted purges never retry deletion at startup. Recovering purge data may recover only the files that remain.</p><button disabled={busy} onClick={load}>Refresh recovery status</button>
    {error && <p role="alert" className="err-text">{error}</p>}
    {!items.length && <p className="muted">No recovery operations need attention.</p>}
    {items.map(op => <div className="panel nested" key={op.id}><strong>{op.kind} · {op.state}</strong><p className="mono-sm">{op.id}</p>{op.error && <p className="err-text">{op.error}</p>}
      {op.kind === 'purge' && !['committed', 'rolled_back', 'partial_recovered'].includes(op.state) && <button disabled={busy} onClick={() => setChoice({ id: op.id, cleanup: false, message: 'Move retained purge files back to Trash. Missing bytes cannot be recreated. No further files will be deleted.' })}>Recover remaining files</button>}
      {op.kind === 'restore' && !['committed', 'rolled_back', 'partial_recovered'].includes(op.state) && <button disabled={busy} onClick={() => setChoice({ id: op.id, cleanup: false, message: 'Attempt rollback using retained files. Recovery stops if filesystem verification disagrees.' })}>Verify and recover</button>}
      {['committed', 'rolled_back', 'partial_recovered'].includes(op.state) && <button disabled={busy} onClick={() => setChoice({ id: op.id, cleanup: true, message: 'Verify this completed operation and permanently remove its temporary recovery copies. Keep a separate backup before continuing.' })}>Verify and clean temporary copies</button>}
    </div>)}
    {choice && <Confirm title="Confirm recovery action" message={choice.message} confirmLabel="Continue" onConfirm={run} onClose={() => !busy && setChoice(null)} />}
  </section>;
}
