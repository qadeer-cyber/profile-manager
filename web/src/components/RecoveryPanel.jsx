import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { Confirm } from './Dialog.jsx';

export function RecoveryPanel() {
  const [transfers, setTransfers] = useState([]);
  const [outcome, setOutcome] = useState('');
  const [items, setItems] = useState([]), [error, setError] = useState(''), [choice, setChoice] = useState(null), [busy, setBusy] = useState(false);
  const load = useCallback(() => Promise.all([api('/api/recovery/operations'), api('/api/recovery/transfers')]).then(([ops, files]) => { setItems(ops); setTransfers(files); }).catch(e => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const run = async () => {
    setBusy(true); setError('');
    try { const result = await api(choice.transfer ? `/api/recovery/transfers/${choice.id}/cleanup` : `/api/recovery/operations/${choice.id}/recover`, { method: 'POST', body: { confirm: true, cleanup: choice.cleanup } }); setOutcome(choice.transfer ? 'Interrupted transfer files cleaned; profile data was unchanged.' : result.verified ? 'Recovery verified: ' + result.state : 'Only remaining files were recovered. The profile remains incomplete; restore a backup before use.'); setChoice(null); await load(); }
    catch (e) { setError(e.message); setChoice(null); }
    finally { setBusy(false); }
  };
  return <section className="panel"><h2>Data recovery</h2><p className="muted">Interrupted restores retain copies for verification. Interrupted purges never retry deletion at startup. Recovering purge data may recover only the files that remain.</p><button disabled={busy} onClick={load}>Refresh recovery status</button>
    {outcome && <p role="status">{outcome}</p>}
    {error && <p role="alert" className="err-text">{error}</p>}
    {transfers.map(file => <div className="panel nested" key={file.id}><strong>Backup transfer · {file.state}</strong><p className="mono-sm">{file.id}</p>{file.cleanupAllowed ? <button disabled={busy} onClick={() => setChoice({ id: file.id, transfer: true, message: 'Delete this interrupted transfer’s private temporary copies. Live profile data is unchanged.' })}>Clean interrupted transfer</button> : <p className="muted">{file.state === 'active' ? 'Transfer is running; cleanup is disabled.' : 'Ownership needs manual review; files are retained.'}</p>}</div>)}
    {!items.length && !transfers.length && <p className="muted">No recovery operations need attention.</p>}
    {items.map(op => <div className="panel nested" key={op.id}><strong>{op.kind} · {op.state}</strong><p className="mono-sm">{op.id}</p>{op.error && <p className="err-text">{op.error}</p>}
      {op.recoverable !== false && op.kind === 'purge' && !['committed', 'rolled_back', 'partial_recovered'].includes(op.state) && <button disabled={busy} onClick={() => setChoice({ id: op.id, cleanup: false, message: 'Move retained purge files back to Trash. Missing bytes cannot be recreated. No further files will be deleted.' })}>Recover remaining files</button>}
      {op.recoverable !== false && op.kind === 'restore' && !['committed', 'rolled_back', 'partial_recovered'].includes(op.state) && <button disabled={busy} onClick={() => setChoice({ id: op.id, cleanup: false, message: 'Attempt rollback using retained files. Recovery stops if filesystem verification disagrees.' })}>Verify and recover</button>}
      {op.recoverable !== false && ['committed', 'rolled_back', 'partial_recovered'].includes(op.state) && <button disabled={busy} onClick={() => setChoice({ id: op.id, cleanup: true, message: 'Verify this completed operation and permanently remove its temporary recovery copies. Keep a separate backup before continuing.' })}>Verify and clean temporary copies</button>}
    </div>)}
    {choice && <Confirm title="Confirm recovery action" message={choice.message} confirmLabel="Continue" onConfirm={run} onClose={() => !busy && setChoice(null)} />}
  </section>;
}
