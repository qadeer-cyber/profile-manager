import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Dialog } from './Dialog.jsx';
import { useToast } from './Toasts.jsx';
import { planBulkCreate, remainingLines, BULK_PROXY_LINES_MAX } from '../lib/bulkCreate.js';
import { plural } from '../lib.js';
import '../bulk-create.css';

// Create many profiles at once: paste proxies (one per line), each line becomes one profile with its own proxy.
export function BulkCreateDialog({ folders = [], onClose, onDone }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [defaultType, setDefaultType] = useState('http');
  const [pattern, setPattern] = useState('Profile {n}');
  const [startAt, setStartAt] = useState(1);
  const [folder, setFolder] = useState('');
  const [tags, setTags] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [protection, setProtection] = useState('standard');
  const [templates, setTemplates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { api('/api/templates').then(t => setTemplates(Array.isArray(t) ? t : [])).catch(() => setTemplates([])); }, []);
  const plan = useMemo(() => planBulkCreate({ text, defaultType, pattern, startAt }), [text, defaultType, pattern, startAt]);

  const create = async () => {
    setBusy(true); setMessage('');
    try {
      // Only the lines that parse and are not repeated are sent, so line numbers in the preview stay the ones shown.
      const sendable = plan.rows.filter(r => r.state === 'ok');
      let state = await api('/api/bulk/jobs', { method: 'POST', body: {
        action: 'createWithProxies', proxyLines: sendable.map(r => r.line), defaultType, namePattern: pattern, startAt: Number(startAt) || 1,
        folder: folder.trim(), tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        ...(templateId ? { templateId } : { protection }),
      } });
      while (state.status === 'running' || state.status === 'queued') {
        await new Promise(r => setTimeout(r, 150));
        state = await api(`/api/bulk/jobs/${state.id}`);
      }
      const items = state.items || [];
      const created = items.filter(i => i.ok).length;
      // Lines left for the user: sent lines the server could not create, plus lines that were never sent (not understood, repeated).
      const skipped = plan.rows.filter(r => r.state !== 'ok').map(r => r.line);
      const notCreated = [...remainingLines(sendable, items), ...skipped];
      if (state.status === 'failed' && !items.length) { setMessage(state.error || 'The batch failed.'); }
      else if (notCreated.length) {
        setText(notCreated.join('\n'));
        setStartAt((Number(startAt) || 1) + plan.rows.length);
        const firstError = items.find(i => i.ok === false)?.error || '';
        setMessage(`Created ${plural(created, 'profile')}. ${plural(notCreated.length, 'line')} left below: fix or remove ${notCreated.length === 1 ? 'it' : 'them'}. ${firstError}`.trim());
        if (created) onDone?.();
      } else {
        toast(`Created ${plural(created, 'profile')}`, 'success');
        onDone?.(); onClose();
      }
    } catch (e) { setMessage(e.message || 'Could not create the profiles.'); }
    setBusy(false);
  };

  return <Dialog wide title="Bulk create from proxy list" onClose={onClose}
    footer={<><span className="bulk-summary" role="status">{plan.summary}</span><button onClick={onClose}>Close</button>
      <button className="primary" disabled={busy || !plan.canCreate} aria-busy={busy} onClick={create}>{busy ? 'Creating…' : `Create ${plan.counts.ok || ''} profile${plan.counts.ok === 1 ? '' : 's'}`.replace('  ', ' ')}</button></>}>
    <div className="bulk-grid">
      <div className="bulk-col">
        <label>Proxies, one per line
          <textarea className="bulk-lines" rows={6} spellCheck={false} autoFocus value={text} onChange={e => setText(e.target.value)}
            placeholder={'203.0.113.10:8000:user:password\nsocks5://user:password@203.0.113.11:1080\n203.0.113.12:8000'} aria-describedby="bulk-lines-hint" /></label>
        <p id="bulk-lines-hint" className="muted small">Up to {BULK_PROXY_LINES_MAX} lines. A line without a scheme uses the type below. Passwords are saved encrypted and are never shown again.</p>
        <label>Type for lines without a scheme<select value={defaultType} onChange={e => setDefaultType(e.target.value)}>
          <option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option></select></label>
      </div>
      <div className="bulk-col">
        <label>Name pattern<input value={pattern} onChange={e => setPattern(e.target.value)} maxLength={80} aria-describedby="bulk-name-hint" /></label>
        <p id="bulk-name-hint" className="muted small">Use {'{n}'} for the number, for example “Shop {'{n}'}”.</p>
        <label>First number<input type="number" min={1} max={99999} value={startAt} onChange={e => setStartAt(e.target.value)} /></label>
        <label>Folder (optional)<input list="pm-folders-bulkcreate" value={folder} onChange={e => setFolder(e.target.value)} /></label>
        <datalist id="pm-folders-bulkcreate">{folders.filter(Boolean).map(f => <option key={f} value={f} />)}</datalist>
        <label>Tags (optional, comma separated)<input value={tags} onChange={e => setTags(e.target.value)} /></label>
        <label>Start from template<select value={templateId} onChange={e => setTemplateId(e.target.value)}>
          <option value="">None: new default profiles</option>
          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        {templateId ? <p className="muted small">The template’s own settings are used, including its protection.</p>
          : <label>Protection<select value={protection} onChange={e => setProtection(e.target.value)}>
            <option value="standard">Standard (default)</option><option value="off">Off</option></select></label>}
      </div>
    </div>
    {message && <div className="notice warn" role="alert">{message}</div>}
    {plan.rows.length > 0 && <div className="bulk-preview" role="region" aria-label="Preview">
      <table><thead><tr><th>#</th><th>Profile name</th><th>Proxy</th><th>Result</th></tr></thead>
        <tbody>{plan.rows.map(r => <tr key={r.index} data-state={r.state}>
          <td>{r.index + 1}</td><td title={r.name}>{r.name}</td><td className="mono-sm" title={r.label}>{r.label || '—'}</td>
          <td><span className={'pill bulk-' + r.state}>{r.state === 'ok' ? 'Ready' : r.state === 'invalid' ? 'Not understood' : 'Repeated'}</span> {r.message && <span className="muted small">{r.message}</span>}</td>
        </tr>)}</tbody></table>
    </div>}
  </Dialog>;
}
