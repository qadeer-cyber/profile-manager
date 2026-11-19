// Cookie import for Chrome Stable profiles, written by Chrome itself.
//
// Chrome Stable on Windows encrypts cookie values with a per-user key kept in the profile's
// "Local State" (os_crypt.encrypted_key, DPAPI-protected; newer versions add an app-bound key).
// A value written to the SQLite store with Chromium's fixed basic key (what server/cookies.js
// does for the bundled Chromium) cannot be decrypted by it, so Chrome discards the cookie on its
// next run. Here the stopped profile is opened briefly in headless Chrome Stable with all network
// access sent to a closed local port, the cookies are set through CDP so Chrome encrypts them
// with its own key, read back from Chrome, and Chrome is closed so it flushes them to disk.
// Cookie values are never logged or included in errors.
import { chromium } from 'playwright';
import { acquireLock, releaseLock } from '../lock.js';
import { isPackaged } from '../testflags.js';
import { assertProfileVersion, resolveWindowsChromeStable } from './chrome-stable.js';

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

// Chrome Stable profiles are the ones the launch plan runs on the installed Chrome (Windows only).
export function usesChromeStableCookieStore(profile, { platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32' || (profile?.browserEngine || 'chromium') !== 'chromium') return false;
  return profile?.advancedSettings?.runtime === 'stable-chrome' || env.AZWAH_STABLE_CHROME_EDITION === '1';
}

// Validated cookie (server/cookies.js validateCookie) -> CDP Network.CookieParam. A host-only
// cookie is given by url alone; a domain cookie by its dotted domain (CDP makes a cookie
// host-only exactly when no domain is passed).
export function toCdpCookie(cookie) {
  const host = cookie.domain.replace(/^\./, '');
  const param = {
    name: cookie.name,
    value: cookie.value,
    url: `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path}`,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
  };
  if (!cookie.hostOnly) param.domain = cookie.domain;
  if (cookie.sameSite !== 'Unspecified') param.sameSite = cookie.sameSite;
  if (cookie.expires != null) param.expires = cookie.expires;
  return param;
}

const key = c => `${c.domain}\n${c.name}\n${c.path}`;
const label = (c, i) => `cookie ${i + 1} (${c.name.slice(0, 80)}, ${c.domain.slice(0, 120)})`;

// Every network request goes to a closed loopback port, so the short headless run cannot reach
// the internet directly (the profile's proxy is not involved in writing cookies).
export const OFFLINE_ARGS = [
  '--proxy-server=socks5://127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--no-first-run', '--no-default-browser-check', '--disable-quic', '--dns-prefetch-disable',
];

export async function writeCookiesWithChromeStable(dir, cookies, {
  resolve = resolveWindowsChromeStable,
  launch = (userDataDir, options) => chromium.launchPersistentContext(userDataDir, options),
  lock = acquireLock, unlock = releaseLock,
} = {}) {
  if (!cookies.length) return { imported: 0, writtenBy: 'chrome-stable' };
  const stable = await resolve();
  assertProfileVersion(dir, stable.version);
  lock(dir);
  try {
    let ctx;
    try {
      ctx = await launch(dir, { executablePath: stable.path, headless: true, args: OFFLINE_ARGS,
        ...(process.platform === 'win32' && isPackaged() ? { chromiumSandbox: true } : {}) });
    } catch (error) {
      const first = String(error?.message || '').split('\n').find(line => line.trim()) || 'unknown error';
      throw fail(503, `Chrome Stable could not open this profile to import cookies: ${first.replace(/^browserType\.launchPersistentContext:\s*/, '').slice(0, 200)}`, 'CHROME_STABLE_COOKIE_WRITE_FAILED');
    }
    try {
      const page = ctx.pages()[0] || await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      const before = new Map((await cdp.send('Network.getAllCookies')).cookies.map(c => [key(c), c]));
      const rejected = [];
      for (const [index, cookie] of cookies.entries()) {
        try { await cdp.send('Network.setCookie', toCdpCookie(cookie)); }
        catch { rejected.push(index); }
      }
      const after = new Map((await cdp.send('Network.getAllCookies')).cookies.map(c => [key(c), c]));
      // Chrome must hold each cookie exactly as given: right value, scope and flags.
      for (const [index, cookie] of cookies.entries()) {
        if (rejected.includes(index)) continue;
        const seen = after.get(key(cookie));
        if (!seen || seen.value !== cookie.value || seen.httpOnly !== cookie.httpOnly || seen.secure !== cookie.secure) rejected.push(index);
      }
      if (rejected.length) {
        // All or nothing, like the SQLite import: remove what this request added and put back
        // what it replaced.
        for (const cookie of cookies) {
          await cdp.send('Network.deleteCookies', { name: cookie.name, domain: cookie.domain, path: cookie.path }).catch(() => {});
          const previous = before.get(key(cookie));
          if (previous) {
            const { name, value, domain, path, secure, httpOnly, sameSite, expires, session } = previous;
            await cdp.send('Network.setCookie', { name, value, path, secure, httpOnly, ...(domain.startsWith('.') ? { domain } : {}), ...(sameSite ? { sameSite } : {}), ...(session ? {} : { expires }),
              url: `${secure ? 'https' : 'http'}://${domain.replace(/^\./, '')}${path}` }).catch(() => {});
          }
        }
        const list = rejected.sort((a, b) => a - b).slice(0, 5).map(i => label(cookies[i], i)).join('; ');
        throw fail(422, `Chrome Stable did not accept ${rejected.length === 1 ? 'a cookie' : `${rejected.length} cookies`}: ${list}. Nothing was imported.`, 'COOKIE_REJECTED_BY_CHROME');
      }
      await cdp.detach().catch(() => {});
    } finally {
      // A graceful close makes Chrome flush its cookie store to disk.
      await ctx.close();
    }
  } finally { unlock(dir); }
  return { imported: cookies.length, writtenBy: 'chrome-stable' };
}
