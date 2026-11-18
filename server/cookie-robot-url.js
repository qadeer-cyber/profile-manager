// CookieRobot URL policy: separate protocol/host/path checks (no CAPTCHA/account flows).
const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

const BLOCKED_HOSTS = new Set([
  'accounts.google.com',
  'google.com',
  'www.google.com',
]);

const BLOCKED_PATH_PREFIXES = [
  '/recaptcha',
  '/signin',
  '/ServiceLogin',
  '/account',
];

export function validateCookieRobotUrl(raw, { afterRedirect = false } = {}) {
  const text = String(raw || '').trim();
  if (!text || text.length > 2048) throw fail(400, 'Invalid URL', 'INVALID_URLS');
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw fail(400, `Invalid URL: ${text.slice(0, 80)}`, 'INVALID_URLS');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw fail(400, 'Only http and https URLs are allowed', 'INVALID_URLS');
  }
  if (parsed.username || parsed.password) throw fail(400, 'URLs with credentials are not allowed', 'INVALID_URLS');
  const host = parsed.hostname.toLowerCase();
  if (!host) throw fail(400, 'Invalid URL host', 'INVALID_URLS');
  if (BLOCKED_HOSTS.has(host)) {
    throw fail(400, 'This job runner does not target Google CAPTCHA or account flows', 'URL_NOT_ALLOWED');
  }
  if (host.endsWith('.google.com') && (host.startsWith('accounts.') || host.includes('recaptcha'))) {
    throw fail(400, 'This job runner does not target Google CAPTCHA or account flows', 'URL_NOT_ALLOWED');
  }
  const pathLower = (parsed.pathname || '/').toLowerCase();
  for (const prefix of BLOCKED_PATH_PREFIXES) {
    if (pathLower === prefix || pathLower.startsWith(prefix + '/')) {
      throw fail(400, 'This job runner does not target Google CAPTCHA or account flows', 'URL_NOT_ALLOWED');
    }
  }
  if (afterRedirect) {
    // Same rules apply to final navigation targets (caller passes resolved URL).
    return parsed.href;
  }
  return parsed.href;
}

export function validateCookieRobotUrlList(urls) {
  if (!Array.isArray(urls) || !urls.length || urls.length > 30) {
    throw fail(400, 'urls must be an array of 1-30 http(s) URLs', 'INVALID_URLS');
  }
  return urls.map(u => validateCookieRobotUrl(u));
}
