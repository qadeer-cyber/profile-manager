// Ultimate 3.0 Track A contracts for M20–M23 and M28–M30.
// Feature-completion and release-qualification are different formulas.
// A blocked custom-engine remainder is not a stock check and is not a pass.

export const ULTIMATE3_CONTRACT_VERSION = '1.0.0';

export const GROK_SCORECARD = Object.freeze({
  id: 'grok-source',
  percent: 80.2,
  formula: 'separate source scorecard; never assigned to release qualification',
  mixWithRelease: false,
});

export const BASELINE_RELEASE = Object.freeze({
  verified: 18,
  partial: 20,
  unsupported: 5,
  cloudExcluded: 2,
  denominator: 43,
});

const gate = Object.freeze.bind(Object);

export const ROW_CONTRACTS = Object.freeze({
  M20: Object.freeze({
    title: 'Timezone, locale, and language',
    releaseGates: gate([
      'm20-config-locale-language',
      'm20-chromium-timezone-id',
      'm20-chromium-timezone-offset',
      'm20-chromium-locale',
      'm20-chromium-languages',
      'm20-chromium-intl-locale',
      'm20-chromium-accept-language',
      'm20-chromium-isolation',
      'm20-firefox-timezone-id',
      'm20-firefox-timezone-offset',
    ]),
    stockChecks: gate([
      'm20-config-locale-language',
      'm20-chromium-timezone-id',
      'm20-chromium-timezone-offset',
      'm20-chromium-locale',
      'm20-chromium-languages',
      'm20-chromium-intl-locale',
      'm20-chromium-accept-language',
      'm20-chromium-isolation',
      'm20-firefox-timezone-id',
      'm20-firefox-timezone-offset',
      'm20-firefox-locale',
    ]),
    remainders: gate([
      Object.freeze({ id: 'm20-undetectable', phase4: false, note: 'Undetectability is not claimed.' }),
      Object.freeze({ id: 'm20-every-locale-api', phase4: true, note: 'Speech voices and other locale-implied surfaces are not aligned. A custom engine would be required for Mimic-class agreement across every API.' }),
      Object.freeze({ id: 'm20-firefox-pref-is-not-the-control', phase4: false, note: 'privacy.timezone.override is not a stock Firefox timezone control. Linux uses TZ.' }),
      Object.freeze({ id: 'm20-windows-tz', phase4: false, note: 'Windows timezone qualification was not run.' }),
    ]),
  }),
  M21: Object.freeze({
    title: 'Geolocation',
    releaseGates: gate([
      'm21-allow-coordinates',
      'm21-deny',
      'm21-persist-restart',
      'm21-isolation',
      'm21-native-coordinates',
    ]),
    stockChecks: gate([
      'm21-allow-coordinates',
      'm21-deny',
      'm21-persist-restart',
      'm21-isolation',
      'm21-native-no-coordinate-flag',
    ]),
    remainders: gate([
      Object.freeze({ id: 'm21-native-coordinates', phase4: true, note: 'Native manual spawn has no stock command-line coordinate override. CDP Emulation.setGeolocationOverride is session-scoped and this app does not leave a debugging port open. A custom engine or an always-on location provider would be required for manual browse.' }),
      Object.freeze({ id: 'm21-hide-os-location', phase4: true, note: 'Coordinates apply inside this browser profile only. They do not hide GPS, Wi-Fi, or IP location from the operating system.' }),
    ]),
  }),
  M22: Object.freeze({
    title: 'Screen resolution and device pixel ratio',
    releaseGates: gate([
      'm22-launch-plan',
      'm22-inner-size',
      'm22-screen-size',
      'm22-device-scale',
    ]),
    stockChecks: gate([
      'm22-launch-plan',
      'm22-inner-size',
      'm22-screen-size',
      'm22-device-scale',
    ]),
    remainders: gate([
      Object.freeze({ id: 'm22-multi-monitor', phase4: true, note: 'screen.availLeft and a second monitor layout are not replaced. Phase 4 custom engine is required for a fake multi-monitor identity.' }),
      Object.freeze({ id: 'm22-native-headed-screen', phase4: false, note: 'Headed native spawn sets window size and device scale flags only. It does not apply Playwright device-metrics emulation.' }),
    ]),
  }),
  M23: Object.freeze({
    title: 'User-Agent and client hints',
    releaseGates: gate([
      'm23-pinned-full',
      'm23-pinned-reduced',
      'm23-client-hints-match-binary',
      'm23-arbitrary-version',
    ]),
    stockChecks: gate([
      'm23-pinned-full',
      'm23-pinned-reduced',
      'm23-client-hints-match-binary',
      'm23-custom-ua-rejected',
      'm23-native-no-debug-port',
    ]),
    remainders: gate([
      Object.freeze({ id: 'm23-arbitrary-version', phase4: true, note: 'A Chrome version the binary does not have is rejected. Lying client hints requires a custom engine.' }),
      Object.freeze({ id: 'm23-firefox-client-hints', phase4: false, note: 'Stock Firefox keeps the Gecko user agent and has no Chromium client hints.' }),
    ]),
  }),
  M28: Object.freeze({
    title: 'Font access',
    releaseGates: gate([
      'm28-launch-flag',
      'm28-permission-or-api-absent',
      'm28-query-local-fonts-unavailable',
      'm28-substitute-font-list',
    ]),
    stockChecks: gate([
      'm28-launch-flag',
      'm28-permission-or-api-absent',
      'm28-query-local-fonts-unavailable',
      'm28-preference-persisted',
      'm28-canvas-measure-still-real',
      'm28-no-invented-font-list',
    ]),
    remainders: gate([
      Object.freeze({ id: 'm28-substitute-font-list', phase4: true, note: 'The installed font list is not replaced. Restricted only denies local font access. Phase 4 custom engine is required for a substitute list.' }),
    ]),
  }),
  M29: Object.freeze({
    title: 'Media devices',
    releaseGates: gate([
      'm29-camera-mic-denied',
      'm29-capture-not-granted',
      'm29-labels-hidden-when-denied',
      'm29-fake-device-labels',
    ]),
    stockChecks: gate([
      'm29-camera-mic-denied',
      'm29-capture-not-granted',
      'm29-labels-hidden-when-denied',
      'm29-allow-capture-rejected',
      'm29-no-invented-device-names',
    ]),
    remainders: gate([
      Object.freeze({ id: 'm29-fake-device-labels', phase4: true, note: 'Device names and counts are not invented. Phase 4 custom engine is required for a substitute device list.' }),
    ]),
  }),
  M30: Object.freeze({
    title: 'Local network and port-scan exposure',
    releaseGates: gate([
      'm30-refuse-weakening-flags',
      'm30-process-has-no-weakening',
      'm30-permission-denied',
      'm30-pref-changes-probe',
    ]),
    stockChecks: gate([
      'm30-refuse-weakening-flags',
      'm30-process-has-no-weakening',
      'm30-permission-denied',
      'm30-treatment-probe-blocked',
      'm30-pref-changes-probe',
      'm30-masked-mode-rejected',
    ]),
    remainders: gate([
      Object.freeze({ id: 'm30-masked-results', phase4: true, note: 'Masked port-scan results and a whitelist that hides other ports are not stock Chromium settings. Phase 4 custom engine would be required to invent those results.' }),
    ]),
  }),
});

export function featureCompletion(checks) {
  const list = Array.isArray(checks) ? checks : [];
  const scored = list.filter(item => item.result === 'pass' || item.result === 'fail');
  const passed = scored.filter(item => item.result === 'pass').length;
  return {
    kind: 'feature-completion',
    formula: 'passed stock checks / (passed + failed stock checks); BLOCKED_CUSTOM_ENGINE and not_run excluded',
    passed,
    failed: scored.length - passed,
    blocked: list.filter(item => item.result === 'blocked').length,
    notRun: list.filter(item => item.result === 'not_run').length,
    denominator: scored.length,
    percent: scored.length ? Number(((passed / scored.length) * 100).toFixed(1)) : null,
  };
}

export function releaseQualification({ verified, partial, unsupported = 5, cloudExcluded = 2, denominator = 43 } = {}) {
  if (denominator !== 43) throw new Error('release qualification denominator is 43');
  const score = (verified + 0.5 * partial) / denominator;
  return {
    kind: 'release-qualification',
    formula: '(VERIFIED + 0.5 × PARTIAL) / 43',
    verified,
    partial,
    unsupported,
    cloudExcluded,
    denominator,
    percent: Number((score * 100).toFixed(1)),
  };
}

export function metricsAreSeparate(feature, release) {
  return !!feature && !!release
    && feature.kind === 'feature-completion'
    && release.kind === 'release-qualification'
    && feature.formula !== release.formula
    && feature.kind !== release.kind;
}

export function decideRelease(id, results = {}) {
  const contract = ROW_CONTRACTS[id];
  if (!contract) throw new Error(`no ultimate3 contract for ${id}`);
  const missing = contract.releaseGates.filter(gateId => results[gateId] !== 'pass');
  return {
    id,
    contractVersion: ULTIMATE3_CONTRACT_VERSION,
    status: missing.length ? 'PARTIAL' : 'VERIFIED',
    missing,
    phase4Required: contract.remainders.filter(item => item.phase4).map(item => item.id),
  };
}

export function stockChecksFor(id, results = {}) {
  const contract = ROW_CONTRACTS[id];
  return contract.stockChecks.map(checkId => ({
    id: checkId,
    result: results[checkId] || 'not_run',
  }));
}
