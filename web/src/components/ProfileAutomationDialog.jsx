import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from './Toasts.jsx';
import { Dialog } from './Dialog.jsx';

/** CDP + optional WebDriver/geckodriver bridge controls for a running automation profile. */
export function ProfileAutomationDialog({ profile, onClose }) {
  const toast = useToast();
  const [bridge, setBridge] = useState(null);
  const [bridgeUrl, setBridgeUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const ff = (profile.browserEngine || 'chromium') === 'firefox';
  const canBridge = profile.running && profile.automationEnabled && profile.cdp;
  useEffect(() => {
    if (!canBridge) return;
    const path = ff ? '/api/geckodriver' : '/api/webdriver';
    api(path).then(setBridge).catch(() => setBridge(null));
  }, [canBridge, ff]);
  const startBridge = async () => {
    setBusy(true);
    try {
      const path = ff ? `/api/profiles/${profile.id}/geckodriver/start` : `/api/profiles/${profile.id}/webdriver/start`;
      const r = await api(path, { method: 'POST', body: {} });
      toast(ff ? 'Geckodriver bridge started' : 'WebDriver bridge started', 'success');
      setBridgeUrl(r.webdriverUrl || '');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const stopBridge = async () => {
    setBusy(true);
    try {
      const path = ff ? `/api/profiles/${profile.id}/geckodriver/stop` : `/api/profiles/${profile.id}/webdriver/stop`;
      await api(path, { method: 'POST', body: {} });
      toast('Bridge stopped', 'success');
      setBridgeUrl('');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const copy = text => {
    navigator.clipboard?.writeText(text).then(() => toast('Copied', 'success')).catch(() => toast('Copy failed', 'error'));
  };
  return <Dialog title={`Automation · ${profile.name}`} onClose={onClose} wide footer={<button onClick={onClose}>Close</button>}>
    {!profile.automationEnabled && <p className="notice warn">Automation is off for this profile. Enable it in the profile editor and launch again.</p>}
    {profile.automationEnabled && !profile.running && <p className="muted">Launch the profile with automation to expose a local CDP endpoint.</p>}
    {profile.cdp && <>
      <p className="muted">Playwright and Puppeteer attach to the HTTP CDP URL below. Only processes on this computer can reach it.</p>
      <label>CDP HTTP endpoint<input className="mono-sm" readOnly value={profile.cdp.httpEndpoint || ''} onFocus={e => e.target.select()} /></label>
      <div className="row"><button type="button" disabled={!profile.cdp.httpEndpoint} onClick={() => copy(profile.cdp.httpEndpoint)}>Copy HTTP</button>
        <button type="button" disabled={!profile.cdp.wsEndpoint} onClick={() => copy(profile.cdp.wsEndpoint)}>Copy WebSocket</button></div>
    </>}
    {canBridge && <>
      <p className="muted">{ff ? 'Geckodriver' : 'ChromeDriver'} bridge (Selenium JSON wire): {bridge?.note || 'Requires a cached driver or PATH binary — see Settings → WebDriver helpers.'}</p>
      <div className="row">
        <button type="button" disabled={busy} onClick={startBridge}>{busy ? 'Working…' : `Start ${ff ? 'geckodriver' : 'WebDriver'} bridge`}</button>
        <button type="button" className="ghost" disabled={busy} onClick={stopBridge}>Stop bridge</button>
      </div>
      {bridgeUrl && <p className="mono-sm">Bridge URL: {bridgeUrl}</p>}
    </>}
  </Dialog>;
}
