import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

function Pill({ availability }) {
  const label = availability || 'observed';
  return <span className={'pill ' + label}>{label}</span>;
}
function Fact({ label, availability, children }) {
  return <div className="fact"><div><strong>{label}</strong><div className="muted">{children}</div></div><Pill availability={availability} /></div>;
}

export function HardwarePanel({ profileId, allowExport = false }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const url = profileId ? `/api/profiles/${profileId}/hardware` : '/api/hardware';
    api(url).then(setReport).catch(e => setError(e.message));
  }, [profileId]);
  if (error) return <p className="err-text">{error}</p>;
  if (!report) return <p className="muted">Reading hardware…</p>;
  const browser = report.browser || {};
  function exportReport() {
    const { configured, browser, unsupported, consistency } = report;
    const contents = JSON.stringify({ configured, browser, unsupported, consistency }, null, 2);
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'azwah-fingerprint-verification.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="form">
    {allowExport && <button type="button" onClick={exportReport}>Export verification JSON</button>}
    <div className="notice">These are observed values from this computer and the live page. A pass means a saved setting matched that observation. Unsupported means this app will not invent the value. Nothing here makes a profile undetectable.</div>
    <Fact label="Chromium" availability={report.chromium?.source === 'executable' ? 'observed' : 'configured'}>{report.chromium?.version || 'Unavailable'} · {report.chromium?.source}</Fact>
    <Fact label="Host processors" availability="observed">{report.host.hardwareConcurrency.value} logical processors</Fact>
    <Fact label="Host memory" availability="observed">{report.host.deviceMemoryGiB.value} GiB · {report.host.deviceMemoryGiB.note}</Fact>
    {browser.availability === 'observed' ? <>
      <Fact label="User agent" availability={browser.userAgent ? 'observed' : 'unavailable'}>{browser.userAgent}</Fact>
      <Fact label="Platform" availability={browser.platform ? 'observed' : 'unavailable'}>{browser.platform}</Fact>
      <Fact label="Browser languages" availability={browser.languages?.length ? 'observed' : 'unavailable'}>{browser.languages?.join(', ')}</Fact>
      <Fact label="Browser timezone" availability={browser.timezone ? 'observed' : 'unavailable'}>{browser.timezone}{browser.timezoneOffset != null && ` · UTC offset ${-browser.timezoneOffset} minutes`}</Fact>
      <Fact label="hardwareConcurrency" availability="observed">{browser.hardwareConcurrency?.value ?? browser.hardwareConcurrency?.reason}</Fact>
      <Fact label="deviceMemory" availability={browser.deviceMemory?.availability || 'unavailable'}>{browser.deviceMemory?.value ?? browser.deviceMemory?.reason} {browser.deviceMemory?.value != null ? 'GiB bucket' : ''}</Fact>
      <Fact label="WebGL" availability={browser.webgl?.availability}>{browser.webgl?.availability === 'observed' ? `${browser.webgl.vendor} · ${browser.webgl.renderer}` : browser.webgl?.reason}</Fact>
      <Fact label="WebGPU" availability={browser.webgpu?.availability || 'unavailable'}>{browser.webgpu?.availability === 'observed' ? `${browser.webgpu.vendor || 'no vendor'} · ${browser.webgpu.device || 'no device'}` : (browser.webgpu?.reason || 'not collected')}</Fact>
      <Fact label="Canvas readback" availability={browser.canvas?.availability || 'unavailable'}>{browser.canvas?.sha256 || browser.canvas?.reason || 'not collected'}</Fact>
      <Fact label="Audio render" availability={browser.audio?.availability || 'unavailable'}>{browser.audio?.sha256 ? `${browser.audio.sha256} · ${browser.audio.sampleRate} Hz` : (browser.audio?.reason || 'not collected')}</Fact>
      <Fact label="Media devices" availability={browser.media?.devices?.availability}>{browser.media?.devices?.availability === 'observed' ? `${browser.media.devices.count} devices (${(browser.media.devices.kinds || []).join(', ') || 'no kind'})` : browser.media?.devices?.reason}</Fact>
      <Fact label="Screen" availability="observed">{browser.screen?.innerWidth}×{browser.screen?.innerHeight} viewport · {browser.screen?.width}×{browser.screen?.height} screen · scale {browser.screen?.devicePixelRatio}</Fact>
    </> : <Fact label="Browser facts" availability="unavailable">{browser.reason === 'not_running' ? 'Launch the profile to observe browser hardware. Nothing is simulated while it is stopped.' : browser.reason}</Fact>}
    {report.consistency?.interpretation && <div className="notice"><strong>{report.consistency.interpretation.headline}</strong> {report.consistency.interpretation.detail}</div>}
    {report.consistency?.byCategory && <section className="fp-verify" aria-label="Verification by category">
      <h4 className="h3">Verification by category</h4>
      <p className="muted hint">Pass needs a live browser observation that matched the saved setting. Partial means some checks could not be observed. Real-only categories have no setting; their values are this computer's.</p>
      {report.consistency.byCategory.map(row => <Fact key={row.id} label={row.label} availability={row.status}>
        {row.findings.length ? row.findings.map(item => item.summary).join(' ') : 'No observation for this category yet.'}
      </Fact>)}
    </section>}
    {report.consistency?.findings?.length > 0 && <details className="proxy-rules"><summary>All {report.consistency.findings.length} individual checks</summary>
      {report.consistency.findings.map((item, index) => <Fact key={item.id + index} label={item.id} availability={item.status}>{item.summary}</Fact>)}
    </details>}
    {report.unsupported.map(item => <Fact key={item.fact} label={item.fact} availability="unsupported">{item.reason}</Fact>)}
  </div>;
}
