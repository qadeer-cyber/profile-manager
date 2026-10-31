// Compare a page user agent and client hints with the Chromium that actually launched.
// Reduced mode may put major.0.0.0 in the UA string. Client hints must keep the full
// installed version. A different browser version is an inconsistency, not a preset.
const FOUR_PART = /^(\d+)\.\d+\.\d+\.\d+$/;

export function compareEngineIdentity({ engineVersion, userAgent = '', clientHints = null } = {}) {
  const issues = [];
  if (typeof engineVersion !== 'string' || !FOUR_PART.test(engineVersion)) {
    return { status: 'unavailable', issues: ['Installed Chromium version is not a four-part version.'], engineVersion: engineVersion || null };
  }
  const reducedMajor = `${engineVersion.split('.')[0]}.0.0.0`;
  const ua = String(userAgent || '');
  if (ua) {
    const match = ua.match(/(?:HeadlessChrome|Chrome)\/(\d+\.\d+\.\d+\.\d+)/);
    if (!match) issues.push('The user agent does not contain a Chrome or HeadlessChrome version token.');
    else if (match[1] !== engineVersion && match[1] !== reducedMajor) {
      issues.push(`User agent version ${match[1]} is neither the installed Chromium ${engineVersion} nor its reduced major ${reducedMajor}.`);
    }
  }
  if (clientHints && clientHints.availability === 'observed') {
    const full = clientHints.uaFullVersion || clientHints.fullVersion || '';
    if (!full) issues.push('Client hints were observed without a full version.');
    else if (full !== engineVersion) issues.push(`Client hint full version ${full} does not match installed Chromium ${engineVersion}.`);
    if (clientHints.chromiumVersion && clientHints.chromiumVersion !== engineVersion) {
      issues.push(`Client hint Chromium brand ${clientHints.chromiumVersion} does not match installed Chromium ${engineVersion}.`);
    }
  }
  return {
    status: issues.length ? 'inconsistent' : 'coherent',
    issues,
    engineVersion,
    reducedMajor,
  };
}
