// Geolocation coordinate override on stock Chromium requires CDP
// (Emulation.setGeolocationOverride). Native manual spawn omits the debugging port.
export const NATIVE_GEO_COORDINATE_OVERRIDE = Object.freeze({
  status: 'BLOCKED_SPAWN',
  stockFlagAvailable: false,
  appliesOn: Object.freeze(['playwright_automation_launch']),
  doesNotApplyOn: Object.freeze(['native_chromium_spawn']),
  reason: 'Saved coordinates are applied through Playwright geolocation on the automation launch path and through CDP permission state for each origin. Native spawn has no supported command-line coordinate override on pinned CfT. This is not GPS or IP concealment outside the browser.',
});

export function geolocationLaunchFacts({ runtime, geolocation, headless, automation }) {
  const allow = geolocation?.permission === 'allow';
  const hasCoords = allow && geolocation.latitude != null && geolocation.longitude != null;
  if (!hasCoords) {
    return { coordinateOverride: 'none', nativeBlocked: false, note: 'No allow+coordinates are configured.' };
  }
  if (runtime === 'native') {
    return {
      coordinateOverride: NATIVE_GEO_COORDINATE_OVERRIDE.status,
      nativeBlocked: true,
      note: NATIVE_GEO_COORDINATE_OVERRIDE.reason,
    };
  }
  return {
    coordinateOverride: 'playwright_context',
    nativeBlocked: false,
    note: `Coordinates are injected on the ${automation ? 'automation' : 'playwright'} launch path only.`,
  };
}
