import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

function Pill({ availability }) {
  const label = availability || 'observed';
  return <span className={'pill ' + label}>{label}</span>;
}
function Fact({ label, availability, children }) {
  return <div className="fact"><div><strong>{label}</strong><div className="muted">{children}</div></div><Pill availability={availability} /></div>;
}

export function HardwarePanel({ profileId }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const url = profileId ? `/api/profiles/${profileId}/hardware` : '/api/hardware';
    api(url).then(setReport).catch(e => setError(e.message));
  }, [profileId]);
  if (error) return <p className="err-text">{error}</p>;
  if (!report) return <p className="muted">Reading hardware…</p>;
  const browser = report.browser || {};
  return <div className="form">
    <div className="notice">These are observed values from this computer and the live page. A pass means a saved setting matched that observation. Unsupported means this app will not invent the value. Nothing here makes a profile undetectable.</div>
    <Fact label="Chromium" availability={report.chromium?.source === 'executable' ? 'observed' : 'configured'}>{report.chromium?.version || 'Unavailable'} · {report.chromium?.source}</Fact>
    <Fact label="Host processors" availability="observed">{report.host.hardwareConcurrency.value} logical processors</Fact>
    <Fact label="Host memory" availability="observed">{report.host.deviceMemoryGiB.value} GiB · {report.host.deviceMemoryGiB.note}</Fact>
    {browser.availability === 'observed' ? <>
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
    {report.consistency?.findings?.map(item => <Fact key={item.id} label={item.id} availability={item.status}>{item.summary}</Fact>)}
    {report.unsupported.map(item => <Fact key={item.fact} label={item.fact} availability="unsupported">{item.reason}</Fact>)}
  </div>;
}
