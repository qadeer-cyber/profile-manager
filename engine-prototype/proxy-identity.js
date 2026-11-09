import { isIP } from 'node:net';

const endpoint = 'https://api64.ipify.org/?format=json';

export async function observeBrowserProxyExit(browserSession) {
  // This uses Chromium's network service and the same fixed proxy session as
  // the tabs. Never replace it with Node fetch or the default system session.
  const response = await browserSession.fetch(endpoint, {
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Browser could not verify the proxy exit.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Proxy exit service returned no data.');
  const decoder = new TextDecoder();
  let body = '', bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 1024) throw new Error('Proxy exit response was too large.');
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const observed = JSON.parse(body + decoder.decode())?.ip;
  if (typeof observed !== 'string' || !isIP(observed)) throw new Error('Browser exit service returned an invalid address.');
  return observed;
}

export async function verifyBrowserProxyExit(browserSession, expected) {
  if (!expected) throw new Error('Missing expected proxy exit.');
  const observed = await observeBrowserProxyExit(browserSession);
  // WHATWG URL canonicalizes compressed IPv6 forms. The parent has already
  // rejected nonpublic addresses, and an exact match is required.
  const canonical = value => typeof value === 'string' && value.includes(':') && /^[a-f0-9:]+$/i.test(value)
    ? new URL('https://[' + value + ']/').hostname.slice(1, -1) : value;
  if (canonical(observed) !== canonical(expected)) throw new Error('Browser proxy exit no longer matches the resolved location.');
  return observed;
}

export const PROXY_IDENTITY_EXIT = 24;
