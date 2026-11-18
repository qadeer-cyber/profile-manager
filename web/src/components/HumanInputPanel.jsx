import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export function HumanInputPanel({ profileId, profiles, toast }) {
  const [text, setText] = useState('Hello {Enter}world');
  const [wpm, setWpm] = useState(180);
  const [jitter, setJitter] = useState(35);
  const [selector, setSelector] = useState('');
  const [deterministic, setDeterministic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const [caps, setCaps] = useState(null);
  const selected = profiles.find(p => p.id === profileId);
  const canType = selected?.running && profileId;
  useEffect(() => {
    api('/api/human-input').then(setCaps).catch(() => {});
  }, []);
  useEffect(() => {
    if (!profileId) return;
    const poll = () => api(`/api/profiles/${profileId}/human-input/status`).then(s => setTyping(!!s.active)).catch(() => {});
    poll();
    const t = setInterval(poll, 800);
    return () => clearInterval(t);
  }, [profileId]);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api(`/api/profiles/${profileId}/human-input`, {
        method: 'POST',
        body: {
          text,
          wpm,
          jitterMs: deterministic ? 0 : jitter,
          selector: selector.trim() || undefined,
          deterministic,
        },
      });
      toast(`Typed ${r.typed} segments (${r.transport})`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const cancel = async () => {
    try {
      const r = await api(`/api/profiles/${profileId}/human-input/cancel`, { method: 'POST' });
      toast(r.cancelled ? 'Typing cancelled' : 'No active typing', r.cancelled ? 'success' : 'error');
    } catch (e) { toast(e.message, 'error'); }
  };
  const ff = selected?.browserEngine === 'firefox';
  return <section className="panel"><h2>Human input (UI testing)</h2>
    <p className="muted">Authorized keystroke emulation only — not for CAPTCHA or account bypass. Chromium uses CDP; Firefox uses geckodriver when automation is enabled.</p>
    {caps && <p className="muted small">Special keys: {caps.specialKeys?.slice(0, 6).join(', ')}… — use <code>{'{Enter}'}</code> syntax in text.</p>}
    <label>CSS selector (optional focus target)<input value={selector} onChange={e => setSelector(e.target.value)} placeholder="#email or [name=q]" /></label>
    <label>Text<textarea rows={3} value={text} onChange={e => setText(e.target.value)} /></label>
    <div className="two">
      <label>Speed (WPM, 20–600)<input type="number" min={20} max={600} value={wpm} onChange={e => setWpm(Number(e.target.value))} /></label>
      <label>Jitter (ms, 0–200)<input type="number" min={0} max={200} value={jitter} disabled={deterministic} onChange={e => setJitter(Number(e.target.value))} /></label>
    </div>
    <label className="check"><input type="checkbox" checked={deterministic} onChange={e => setDeterministic(e.target.checked)} /> Deterministic timing (no jitter — for tests)</label>
    <div className="row">
      <button className="primary" disabled={busy || !canType || !text.trim()} onClick={run}>{busy ? 'Typing…' : 'Type into focused page'}</button>
      <button disabled={!typing || !profileId} onClick={cancel}>Cancel typing</button>
    </div>
    {!canType && profileId && <p className="muted">Launch this profile with automation and keep it running.</p>}
    {ff && canType && <p className="muted small">Firefox path requires geckodriver on PATH or cached under Settings → automation drivers.</p>}
  </section>;
}
