// Chromium CDP attach plan for Playwright and Puppeteer. Firefox has no CDP attach.

export function buildAttachDescriptor({ profileId, engine, cdpPort, wsEndpoint, running }) {
  const firefox = engine === 'firefox';
  const port = Number(cdpPort);
  const hasPort = Number.isInteger(port) && port > 0 && port <= 65535;
  const endpoint = !firefox && hasPort ? `http://127.0.0.1:${port}` : null;
  const ws = typeof wsEndpoint === 'string' && /^wss?:\/\//.test(wsEndpoint) ? wsEndpoint : null;
  return {
    profileId,
    running: !!running,
    engine: firefox ? 'firefox' : 'chromium',
    attachable: !!(running && endpoint),
    playwright: endpoint ? {
      method: 'chromium.connectOverCDP',
      endpoint,
      disconnectClosesBrowser: false,
    } : null,
    puppeteer: endpoint ? {
      method: 'puppeteer.connect',
      browserURL: endpoint,
      disconnectClosesBrowser: false,
    } : null,
    webSocketEndpoint: ws,
    firefox: {
      cdpAttach: false,
      note: 'Firefox profiles use Marionette and geckodriver. Playwright connectOverCDP and puppeteer.connect do not attach to Firefox.',
    },
    reconnect: {
      supported: !!(running && endpoint),
      procedure: 'Disconnect the client without stopping the profile, then connect a new Playwright or Puppeteer client to the same HTTP endpoint. The browser process stays up until the profile is stopped.',
    },
  };
}
