import React, { useState } from 'react';
import { PROXY_LINE_RULES, formatProxyLine, parseProxyLine } from '../../../server/proxy-line.js';

export function ProxyLineField({ proxy, onChange }) {
  const [line, setLine] = useState(() => formatProxyLine(proxy));
  const [error, setError] = useState('');
  const [reveal, setReveal] = useState(true);

  const commit = (raw, protocol = proxy.type) => {
    setLine(raw);
    if (!raw.trim()) { setError('Host and port are required'); return; }
    try {
      const parsed = parseProxyLine(raw, protocol);
      const type = parsed.schemeSelected ? parsed.type : protocol;
      setError('');
      onChange({ type, host: parsed.host, port: parsed.port, username: parsed.username, password: parsed.password });
    } catch (e) { setError(e.message); }
  };
  const selectProtocol = type => {
    const next = { ...proxy, type };
    const formatted = formatProxyLine(next);
    setLine(formatted);
    setError(formatted.trim() ? '' : 'Host and port are required');
    onChange(next);
  };
  const savedSecret = proxy.password === '••••';
  return <div className="proxy-line">
    <div className="seg" role="radiogroup" aria-label="Proxy protocol">
      {[['http', 'HTTP'], ['https', 'HTTPS'], ['socks5', 'SOCKS5']].map(([value, label]) =>
        <button key={value} type="button" role="radio" aria-checked={proxy.type === value} className={proxy.type === value ? 'sel' : ''} onClick={() => selectProtocol(value)}>{label}</button>)}
    </div>
    <label>Proxy details
      <input className="mono-input" type={reveal ? 'text' : 'password'} autoComplete="off" spellCheck="false" value={line} placeholder="host:port:username:password" onChange={e => commit(e.target.value)} />
    </label>
    <button type="button" className="ghost" onClick={() => setReveal(v => !v)}>{reveal ? 'Hide credentials' : 'Show credentials'}</button>
    {savedSecret && <p className="muted hint">A password is already stored encrypted. It is not loaded into this field. Leave the bullets in place to keep it, or replace the whole line to set a new password.</p>}
    {error && <p className="err-text" role="alert">{error}</p>}
    <details className="proxy-rules"><summary>Delimiter rules</summary><ul className="muted small">{PROXY_LINE_RULES.map(rule => <li key={rule}>{rule}</li>)}</ul></details>
  </div>;
}
