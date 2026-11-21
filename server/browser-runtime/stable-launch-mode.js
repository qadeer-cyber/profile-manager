// Chrome Stable launch mode (owner-approved Option A).
//
// manual: chrome.exe is started like a person starts it. No automation pipe, no remote debugging port,
//         no automation switch and no switch that hides automation. navigator.webdriver is Chrome's own.
// controlled: AZWAH keeps a Playwright connection, because the profile needs something only that
//         connection provides on stock Chrome (proxy exit and timezone verification, a timezone or
//         coordinates override, screen or user-agent emulation, automation, headless). This is said
//         plainly in the UI; it is not concealed.
export const MANUAL_FORBIDDEN_SWITCHES = Object.freeze([
  '--remote-debugging-pipe', '--remote-debugging-port', '--remote-debugging-address',
  '--enable-automation', '--headless', '--disable-blink-features',
]);

const REASONS = Object.freeze({
  proxy: 'A proxy profile verifies the proxy exit and follows its timezone through the controlled connection.',
  timezone: 'Stock Chrome on Windows has no startup setting for another timezone.',
  coordinates: 'Custom coordinates are applied through the controlled connection.',
  screen: 'Screen, viewport and pixel-ratio emulation are applied through the controlled connection.',
  userAgent: 'A user-agent preset is applied through the controlled connection so client hints match.',
  automation: 'Automation (API, Cookie Robot, Action Synchronizer) needs the controlled connection.',
  headless: 'Headless launches are controlled.',
});
export const launchModeReason = id => REASONS[id] || id;

// proxyManual: the owner chose "Manual" for this proxy profile. Traffic still goes through the proxy,
// but the page shows this computer's timezone and location instead of the proxy's.
export function stableLaunchMode({ proxy, proxyManual = false, timezoneId, coordinates, launch = {}, automation, headless }) {
  const reasons = [];
  if (proxy && !proxyManual) reasons.push('proxy');
  if (timezoneId) reasons.push('timezone');
  if (coordinates) reasons.push('coordinates');
  if (launch.viewport || launch.screen || launch.deviceScaleFactor) reasons.push('screen');
  if (launch.userAgent) reasons.push('userAgent');
  if (automation) reasons.push('automation');
  if (headless) reasons.push('headless');
  return { mode: reasons.length ? 'controlled' : 'manual', reasons };
}

// The mode a saved profile will get at launch, for display before it runs (the launch plan makes the
// final decision with the same rules). Not a Chrome profile -> null.
export function predictStableLaunchMode(profile) {
  if (!profile || profile.browserEngine === 'firefox') return null;
  const runtime = profile.advancedSettings?.runtime;
  if (runtime === 'privacy' || runtime === 'azwah-native' || runtime === 'custom-native-chromium') return null;
  const adv = profile.advancedSettings || {};
  const geo = adv.geolocation || {};
  const screen = adv.screen || {};
  const ua = adv.userAgent?.mode;
  return stableLaunchMode({
    proxy: profile.proxy || null,
    proxyManual: adv.proxyLaunch === 'manual',
    timezoneId: profile.browserSettings?.timezoneId || '',
    coordinates: geo.latitude != null && geo.longitude != null ? geo : null,
    launch: {
      viewport: screen.viewportWidth != null && screen.viewportHeight != null,
      screen: screen.width != null && screen.height != null,
      deviceScaleFactor: screen.deviceScaleFactor || null,
      userAgent: ua === 'reduced' || ua === 'full',
    },
    automation: !!profile.automationEnabled,
    headless: false,
  });
}
