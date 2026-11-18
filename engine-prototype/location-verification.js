import { WebContentsView } from 'electron';

// The reserved origin is fulfilled by this target's debugger. It never
// receives an upstream request or grants permissions to ordinary tabs.
export const identityProbeUrl = 'https://azwah-identity.invalid/';

export async function verifyBrowserLocation(session, webPreferences, timezone, location) {
  const { webContents: contents } = new WebContentsView({ webPreferences: { ...webPreferences, session } });
  const debuggerClient = contents.debugger;
  const canRead = (source, permission, details) =>
    source === contents && permission === 'geolocation' && details.isMainFrame &&
    contents.getURL() === identityProbeUrl;
  session.setPermissionCheckHandler((source, permission, _, details) => canRead(source, permission, details));
  session.setPermissionRequestHandler((source, permission, callback, details) => callback(canRead(source, permission, details)));
  try {
    await contents.loadURL('about:blank');
    debuggerClient.attach('1.3');
    debuggerClient.on('message', (_, method, params) => {
      if (method !== 'Fetch.requestPaused') return;
      debuggerClient.sendCommand('Fetch.fulfillRequest', {
        requestId: params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        body: Buffer.from('<!doctype html><title>Azwah identity check</title>').toString('base64'),
      }).catch(() => contents.stop());
    });
    await debuggerClient.sendCommand('Fetch.enable', { patterns: [{ urlPattern: identityProbeUrl, resourceType: 'Document' }] });
    await contents.loadURL(identityProbeUrl);
    await debuggerClient.sendCommand('Emulation.setTimezoneOverride', { timezoneId: timezone });
    await debuggerClient.sendCommand('Emulation.setGeolocationOverride', location);
    const observed = await contents.executeJavaScript(`(async () => ({
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      position: await new Promise(resolve => navigator.geolocation.getCurrentPosition(
        ({ coords }) => resolve([coords.latitude, coords.longitude, coords.accuracy]),
        () => resolve(null), { timeout: 5000, maximumAge: 0 })),
    }))()`);
    const canonical = value => new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
    const expected = [location.latitude, location.longitude, location.accuracy];
    if (!Array.isArray(observed.position) || canonical(observed.timezone) !== canonical(timezone) ||
        expected.some((value, i) => !Number.isFinite(observed.position[i]) || Math.abs(value - observed.position[i]) > 0.000001)) {
      throw new Error('Chromium did not observe the configured proxy location and timezone.');
    }
  } finally {
    session.setPermissionCheckHandler(() => false);
    session.setPermissionRequestHandler((_, __, callback) => callback(false));
    contents.close();
  }
}
