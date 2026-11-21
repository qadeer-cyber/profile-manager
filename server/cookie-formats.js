// Netscape cookies.txt <-> AZWAH cookie objects. Pure, so the editor and tests share it.
//
// Import never trusts this parser alone: every converted cookie is sent through the server's
// validateCookie(), which rejects bad names, domains, paths, SameSite, __Host-/__Secure- rules and
// expiry. Values are never logged; parse errors report only the line number.
//
// Line format: domain <TAB> includeSubdomains <TAB> path <TAB> secure <TAB> expiry <TAB> name <TAB> value
// A "#HttpOnly_" prefix on the domain marks an HttpOnly cookie (curl/browser-extension convention).

const BOOL = { TRUE: true, FALSE: false };
export const MAX_NETSCAPE_LINES = 2000;

export function looksLikeNetscape(text) {
  if (typeof text !== 'string') return false;
  const head = text.replace(/^﻿/, '').trimStart();
  if (/^#\s*(Netscape )?HTTP Cookie File/i.test(head)) return true;
  if (head.startsWith('[') || head.startsWith('{')) return false;
  return head.split(/\r?\n/).some(line => line && (!line.startsWith('#') || line.startsWith('#HttpOnly_')) && line.split('\t').length === 7);
}

// Returns { cookies, errors: [{ line, reason }] }. Malformed lines are reported, not guessed.
export function parseNetscapeCookies(text) {
  if (typeof text !== 'string') throw Object.assign(new Error('cookies.txt must be text'), { status: 400 });
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines.length > MAX_NETSCAPE_LINES) throw Object.assign(new Error(`cookies.txt has more than ${MAX_NETSCAPE_LINES} lines`), { status: 400 });
  const cookies = [], errors = [];
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    if (!line) return;
    let httpOnly = false, body = line;
    if (body.startsWith('#HttpOnly_')) { httpOnly = true; body = body.slice('#HttpOnly_'.length); }
    else if (body.startsWith('#')) return;
    const fields = body.split('\t');
    if (fields.length !== 7) { errors.push({ line: i + 1, reason: `expected 7 tab-separated fields, found ${fields.length}` }); return; }
    const [domainField, sub, path, secure, expiry, name, value] = fields;
    if (!(sub in BOOL) || !(secure in BOOL)) { errors.push({ line: i + 1, reason: 'includeSubdomains and secure must be TRUE or FALSE' }); return; }
    if (!/^\d{1,11}$/.test(expiry)) { errors.push({ line: i + 1, reason: 'expiry must be a Unix timestamp in seconds' }); return; }
    const bare = domainField.replace(/^\./, '');
    if (!bare) { errors.push({ line: i + 1, reason: 'domain is empty' }); return; }
    const includeSubdomains = BOOL[sub];
    const seconds = Number(expiry);
    cookies.push({
      name, value, path, secure: BOOL[secure], httpOnly,
      domain: includeSubdomains ? '.' + bare : bare,
      hostOnly: !includeSubdomains,
      sameSite: 'Unspecified',
      ...(seconds > 0 ? { expires: seconds } : {}),
    });
  });
  return { cookies, errors };
}

// Returns { text, exported, skipped }. Cookies whose value the app could not read (OS-bound
// encryption) are skipped and counted, never written with an empty value.
export function toNetscapeCookies(cookies) {
  const out = ['# Netscape HTTP Cookie File', '# Exported by AZWAH. Cookie values are credentials: store this file securely.', ''];
  let exported = 0, skipped = 0;
  for (const c of cookies || []) {
    if (typeof c?.value !== 'string' || c.valueState === 'unavailable') { skipped++; continue; }
    const sub = typeof c.domain === 'string' && c.domain.startsWith('.') && c.hostOnly !== true;
    const domain = (c.httpOnly ? '#HttpOnly_' : '') + (sub ? c.domain : String(c.domain || '').replace(/^\./, ''));
    const expires = Number.isFinite(c.expires) && c.expires > 0 ? Math.floor(c.expires) : 0;
    out.push([domain, sub ? 'TRUE' : 'FALSE', c.path || '/', c.secure ? 'TRUE' : 'FALSE', expires, c.name, c.value].join('\t'));
    exported++;
  }
  return { text: out.join('\n') + '\n', exported, skipped };
}
