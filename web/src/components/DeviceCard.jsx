import React, { useState } from 'react';
import { copyText } from '../lib/clipboard.js';
import '../get-started.css';

const SOURCE_NOTE = {
  profile: 'What this profile reports to websites (its protection settings give it this hardware). It is not a separate physical device.',
  declared: 'A declared device identity, checked against the live browser. The browser still runs on this computer.',
  host: 'This profile shows this computer’s real hardware.',
};

// Which device this profile stands for: the owner's name for it, what it reports as, its MAC label and a short code.
export function DeviceCard({ device }) {
  const [copied, setCopied] = useState('');
  if (!device) return null;
  const copy = async (what, text) => { setCopied((await copyText(text)) ? what : 'failed'); setTimeout(() => setCopied(''), 1800); };
  return <section className="device-card" aria-label="Device">
    <h4>Device</h4>
    <div className="device-rows">
      <div><span>Device name</span><strong>{device.name || <span className="muted">Not named</span>}</strong></div>
      <div><span>Reports as</span><strong>{device.reportsAs}</strong></div>
      <div><span>MAC address</span><strong className="mono-sm">{device.mac || '—'}</strong>
        {device.mac && <button type="button" className="ghost" onClick={() => copy('mac', device.mac)} aria-label="Copy MAC address">{copied === 'mac' ? 'Copied' : copied === 'failed' ? 'Could not copy' : 'Copy'}</button>}</div>
      <div><span>Device code</span><strong className="mono-sm">{device.code}</strong></div>
    </div>
    <p className="muted small">{SOURCE_NOTE[device.source] || ''} The MAC is a label saved with the profile: websites cannot read it, and AZWAH does not change your network adapter.</p>
  </section>;
}
