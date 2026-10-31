// Acceptance contracts for advanced privacy.
// The strict denominator stays 43. A row is VERIFIED only when its recorded
// release gates pass. Stock-feasible PASS rows are not added to that denominator.
import fs from 'node:fs';
import { NATIVE_GEO_COORDINATE_OVERRIDE } from './geolocation-launch.js';

export const HISTORICAL_MATRIX = Object.freeze({
  id: 'A',
  denominator: 43,
  verified: 20,
  partial: 18,
  unsupported: 5,
  cloudExcluded: 2,
  formula: '(VERIFIED + 0.5 × PARTIAL) / 43',
  partialIds: Object.freeze(["M2","M3","M8","M12","M14","M17","M18","M21","M23","M28","M29","M30","M33","M35","M36","M37","M38","M40"]),
  unsupportedIds: Object.freeze(['M24', 'M25', 'M26', 'M27', 'M42']),
  cloudIds: Object.freeze(['M16', 'M39']),
});

export const STOCK_FEASIBLE_BASELINE = Object.freeze({
  id: 'B',
  label: 'Stock-feasible M20–M30',
  frozen: true,
  recalculatedHere: false,
  ownerPass: 23,
  ownerBlockedExcluded: 7,
  publishedNamedPassRows: 23,
  note: 'Stock-feasible scorecard stays 23/23 PASS with 7 BLOCKED_CUSTOM_ENGINE criteria excluded. It is not the strict matrix. Strict release-qualification is 20 VERIFIED / 18 PARTIAL / 5 UNSUPPORTED / 2 cloud-excluded after Track A. Grok 80.2% belongs to its separate source branch.',
});

export const PARTIAL_REQUIREMENTS = Object.freeze({
  M20: Object.freeze({
    matrixStatus: 'VERIFIED',
    satisfied: Object.freeze([
      'Per-profile locale, IANA timezone, and language list are validated and stored.',
      'The first preferred language must match locale when both are set.',
      'Chromium launch adds --lang and --accept-lang when languages are set.',
      'Chromium Playwright context receives timezoneId.',
      'Firefox user.js sets intl.accept_languages and intl.locale.requested.',
      'Firefox Unix launch sets the TZ environment variable from the profile timezone.',
    ]),
    engineRequired: Object.freeze([
      'Mimic-class agreement across every locale-sensitive API.',
      'A documented stock Firefox preference that overrides timezone on Windows. privacy.timezone.override is written for visibility and is not a stock Gecko timezone control. TZ is the Unix mechanism.',
    ]),
  }),
  M21: Object.freeze({
    matrixStatus: 'PARTIAL',
    satisfied: Object.freeze([
      'Permission default, ask, allow, and deny are stored per profile.',
      'Allow can store explicit latitude, longitude, and accuracy. Deny and ask cannot.',
      'Out-of-range coordinates are rejected.',
      'Playwright launch reapplies saved coordinates. Allow without coordinates does not invent a position.',
      'The geolocation content setting is written into the profile preferences.',
      'Native manual spawn is labeled BLOCKED_SPAWN for coordinate override (no stock CLI; CDP only).',
    ]),
    engineRequired: Object.freeze([
      'Concealing GPS, Wi-Fi, or IP location outside this browser.',
      NATIVE_GEO_COORDINATE_OVERRIDE.reason,
    ]),
  }),
  M22: Object.freeze({
    matrixStatus: 'VERIFIED',
    satisfied: Object.freeze([
      'Window presets, custom size, viewport, and device scale factor are validated and reapplied on launch.',
      'Viewport cannot exceed the configured screen size.',
      'An explicit position that lies fully outside known host displays is moved to the primary origin.',
      'When displays are unknown, the saved position is left unchanged and reported unverified.',
    ]),
    engineRequired: Object.freeze([
      'Replacing screen.width, screen.height, or a multi-monitor layout with another identity.',
      'Firefox device-scale and window-position parity. Firefox receives width and height only.',
    ]),
  }),
  M23: Object.freeze({
    matrixStatus: 'PARTIAL',
    satisfied: Object.freeze([
      'User-agent presets are default, reduced, or full, derived from the installed Chromium version.',
      'Reduced mode puts major.0.0.0 in the UA string and keeps the full version in client hints.',
      'A UA or client-hint version that is neither the installed build nor that reduced major is reported inconsistent.',
      'Free-form and custom user agents are rejected.',
    ]),
    engineRequired: Object.freeze([
      'Inventing a Chrome version the binary does not have.',
      'Client hints on stock Firefox. Firefox keeps the Gecko user agent.',
    ]),
  }),
  M28: Object.freeze({
    matrixStatus: 'PARTIAL',
    satisfied: Object.freeze([
      'Restricted denies the local-fonts permission query for opened pages.',
      'The same deny is written to the profile content setting local_fonts (underscore key).',
      'Launch adds --disable-features=FontAccess so queryLocalFonts is not exposed on pinned CfT.',
      'Canvas measureText is still the browser’s own measurement.',
    ]),
    engineRequired: Object.freeze([
      'Substituting the installed font list.',
      'Blocking canvas font measurement.',
    ]),
    stockQuirk: Object.freeze([
      'Before FontAccess disable, queryLocalFonts could resolve with count 0 while permission was denied. FontAccess disable is the stock alignment path.',
    ]),
  }),
  M29: Object.freeze({
    matrixStatus: 'PARTIAL',
    satisfied: Object.freeze([
      'Restricted denies camera and microphone in the launch permission set.',
      'Restricted also writes media_stream_camera and media_stream_mic deny into profile preferences.',
      'Allow capture cannot be combined with restricted media devices.',
      'getUserMedia does not return a stream. classifyMediaCaptureError separates permission_denied from no_device (NotFoundError on hosts without hardware).',
      'Device names and counts are not invented.',
    ]),
    engineRequired: Object.freeze([
      'Fake camera or microphone labels and counts.',
    ]),
  }),
  M30: Object.freeze({
    matrixStatus: 'PARTIAL',
    satisfied: Object.freeze([
      'Launch arguments this app builds are refused when they disable private-network checks.',
      'A normal process command line is reported as not weakening those checks.',
      'portScan real writes local_network_access deny in profile preferences; local-network-access permission query is denied in the browser.',
      'portScan masked and custom whitelist modes are rejected.',
    ]),
    engineRequired: Object.freeze([
      'Masked port-scan results or a whitelist that hides other local ports.',
      'Proof that every local port probe fails. Absence of weakening flags is not that proof.',
    ]),
  }),
});

export const CUSTOM_ENGINE = Object.freeze({
  id: 'C',
  rows: Object.freeze([
    Object.freeze({
      id: 'M24',
      matrixStatus: 'UNSUPPORTED',
      qualification: 'BLOCKED',
      missing: 'Persistent canvas readback noise inside the rendering engine.',
      stockApiEnough: false,
      sourceChangeRequired: true,
      prototype: 'opt-in page-world getImageData/toDataURL hook',
      prototypeQualification: 'EXPERIMENTAL_NOT_ENGINE',
      limits: Object.freeze([
        'Off unless experimental.canvasReadback is prototype.',
        'Detectable: window.__pmCanvasPrototype.customEngine is false.',
        'Does not cover OffscreenCanvas, workers, or WebGL readPixels.',
        'Not installed on native Chromium launch.',
        'Not a CAPTCHA bypass.',
      ]),
    }),
    Object.freeze({
      id: 'M25',
      matrixStatus: 'UNSUPPORTED',
      qualification: 'BLOCKED',
      missing: 'AudioContext render noise inside the audio engine.',
      stockApiEnough: false,
      sourceChangeRequired: true,
      prototype: null,
      prototypeQualification: 'NOT_BUILT',
      limits: Object.freeze(['No stock noise API. A page hook would not be an engine qualification.']),
    }),
    Object.freeze({
      id: 'M26',
      matrixStatus: 'UNSUPPORTED',
      qualification: 'BLOCKED',
      missing: 'WebGL vendor and renderer replacement.',
      stockApiEnough: false,
      sourceChangeRequired: true,
      prototype: 'opt-in page-world WebGL readPixels XOR hook',
      prototypeQualification: 'EXPERIMENTAL_NOT_ENGINE',
      limits: Object.freeze([
        'Off unless experimental.webglReadback is prototype.',
        'Detectable: window.__pmWebglReadPrototype.customEngine is false.',
        'Does not change UNMASKED_VENDOR/RENDERER. --disable-webgl remains the only stock restriction.',
        'Not installed on native Chromium launch.',
      ]),
    }),
    Object.freeze({
      id: 'M27',
      matrixStatus: 'UNSUPPORTED',
      qualification: 'BLOCKED',
      missing: 'WebGPU adapter vendor and device replacement.',
      stockApiEnough: false,
      sourceChangeRequired: true,
      prototype: null,
      prototypeQualification: 'NOT_BUILT',
      limits: Object.freeze(['A disable flag did not remove navigator.gpu on the tested Linux host. No mask switch is offered.']),
    }),
  ]),
});

export const M42_ACCEPTANCE = Object.freeze({
  id: 'M42',
  matrixStatus: 'UNSUPPORTED',
  guarantee: 'UNSUPPORTED',
  bypass: false,
  satisfied: Object.freeze([
    'Normal browsing can still be launched.',
    'Google compatibility diagnostics remain local and do not report a solved CAPTCHA.',
    'CookieRobot rejects Google account and reCAPTCHA URLs.',
  ]),
  refused: Object.freeze([
    'CAPTCHA bypass, circumvention, or a fake success result.',
    'Changing the historical denominator to treat this row as verified.',
  ]),
});

export const WINDOWS_QUALIFICATION = Object.freeze({
  id: 'D',
  status: 'NOT_RUN',
  realTests: false,
  reason: 'This branch is qualified on Linux with the pinned Chromium when it is installed. Windows browser qualification was not executed and no Windows workflow was dispatched.',
});

export function historicalCoverage(matrix = HISTORICAL_MATRIX) {
  return (matrix.verified + 0.5 * matrix.partial) / matrix.denominator;
}

export function parseMatrixStatuses(markdown) {
  const rows = [];
  for (const line of String(markdown).split('\n')) {
    const match = line.match(/^\|\s*(M\d+)\s*\|[^|]*\|\s*(VERIFIED|PARTIAL|UNSUPPORTED|BLOCKED|MISSING|NOT_APPLICABLE_CLOUD)\s*\|/);
    if (match) rows.push({ id: match[1], status: match[2] });
  }
  return rows;
}

export function scoreHistoricalMarkdown(markdown) {
  const rows = parseMatrixStatuses(markdown);
  const cloud = rows.filter(row => row.status === 'NOT_APPLICABLE_CLOUD');
  const scored = rows.filter(row => row.status !== 'NOT_APPLICABLE_CLOUD');
  const count = status => scored.filter(row => row.status === status).length;
  return {
    rows: rows.length,
    denominator: scored.length,
    verified: count('VERIFIED'),
    partial: count('PARTIAL'),
    unsupported: count('UNSUPPORTED'),
    cloudExcluded: cloud.length,
    partialIds: scored.filter(row => row.status === 'PARTIAL').map(row => row.id),
    unsupportedIds: scored.filter(row => row.status === 'UNSUPPORTED').map(row => row.id),
  };
}

export function advancedPrivacyScorecards(markdown = null) {
  let historicalFile = null;
  if (markdown == null) {
    try {
      markdown = fs.readFileSync(new URL('../docs/handoff/multilogin-platform/MULTILOGIN_COMPLETE_TECHNOLOGY_MATRIX.md', import.meta.url), 'utf8');
    } catch {
      markdown = null;
    }
  }
  if (markdown) historicalFile = scoreHistoricalMarkdown(markdown);
  return {
    A: { ...HISTORICAL_MATRIX, coverage: historicalCoverage(), file: historicalFile },
    B: STOCK_FEASIBLE_BASELINE,
    C: CUSTOM_ENGINE,
    D: WINDOWS_QUALIFICATION,
    partial: PARTIAL_REQUIREMENTS,
    m42: M42_ACCEPTANCE,
    geolocationNative: NATIVE_GEO_COORDINATE_OVERRIDE,
    policy: 'BLOCKED is reported instead of a fabricated PASS. Denominator 43 is unchanged. A strict-matrix promotion requires every Ultimate 3 release gate for that row to pass. Feature-completion percent is not release-qualification percent.',
  };
}
