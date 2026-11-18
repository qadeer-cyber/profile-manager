// One-line proxy syntax shared by import and the profile editor.
// Colon form is literal. URL form percent-decodes user and password.
// An empty password is stored empty. Nothing invents a password.

export const PROXY_TYPES = Object.freeze(['http', 'https', 'socks5']);

export const PROXY_LINE_RULES = Object.freeze([
  'Colon form is copied literally and is not percent-decoded.',
  'host:port has no username and no password.',
  'host:port:username and host:port:username: set the username and an empty password.',
  'host:port:username:password keeps every extra colon inside the password.',
  'A username containing : @ / % or whitespace, or a password containing @ / % or whitespace, must use scheme://user:password@host:port with percent-encoding. A broken % sequence is rejected.',
  'IPv6 hosts must be written in brackets, for example [2001:db8::1]:1080 or socks5://user:pass@[2001:db8::1]:1080.',
  'An explicit http, https, socks5, or socks5h scheme selects that protocol. socks5h is stored as socks5. With no scheme, the protocol already chosen on the control is kept.',
]);

const SCHEME = /^([a-z0-9]+):\/\/(?:([^:@/]*)(?::([^@/]*))?@)?(\[[0-9a-fA-F:.]+\]|[^:@/\s]+):(\d+)\/?$/i;

function decodePart(value) {
  try { return decodeURIComponent(value ?? ''); }
  catch { throw new Error('Invalid URL encoding'); }
}

function colonParts(line) {
  if (/\s/.test(line)) throw new Error('Unrecognized format');
  let host;
  let rest;
  if (line.startsWith('[')) {
    const end = line.indexOf(']');
    if (end < 2 || line[end + 1] !== ':') throw new Error('Unrecognized format');
    host = line.slice(0, end + 1);
    if (!/^\[[0-9a-fA-F:.]+\]$/.test(host)) throw new Error('Unrecognized format');
    rest = line.slice(end + 2);
  } else {
    const split = line.indexOf(':');
    if (split <= 0) throw new Error('Unrecognized format');
    host = line.slice(0, split);
    rest = line.slice(split + 1);
  }
  if (!rest) throw new Error('Unrecognized format');
  const parts = rest.split(':');
  const port = parts[0];
  if (!/^\d+$/.test(port)) throw new Error('Unrecognized format');
  if (parts.length === 1) return { host, port, username: '', password: '' };
  if (parts.length === 2) return { host, port, username: parts[1], password: '' };
  return { host, port, username: parts[1], password: parts.slice(2).join(':') };
}

export function parseProxyLine(line, defaultType = 'http') {
  const text = String(line ?? '').trim();
  if (!text) throw new Error('Unrecognized format');
  const type = PROXY_TYPES.includes(defaultType) ? defaultType : 'http';
  const matched = text.match(SCHEME);
  if (matched) {
    let scheme = matched[1].toLowerCase();
    if (scheme === 'socks5h') scheme = 'socks5';
    if (!PROXY_TYPES.includes(scheme)) throw new Error(`Unsupported scheme "${matched[1]}"`);
    return {
      type: scheme,
      host: matched[4],
      port: matched[5],
      username: decodePart(matched[2]),
      password: decodePart(matched[3]),
      schemeSelected: true,
    };
  }
  if (text.includes('://')) throw new Error('Unrecognized format');
  return { type, ...colonParts(text), schemeSelected: false };
}

function encodePart(value) {
  return encodeURIComponent(value ?? '');
}

export function proxyNeedsUrlForm(username, password) {
  return /[:@/%\s]/.test(String(username || '')) || /[@/%\s]/.test(String(password || ''));
}

export function formatProxyLine(proxy) {
  const host = String(proxy?.host || '');
  const port = proxy?.port == null ? '' : String(proxy.port);
  if (!host && !port) return '';
  const username = String(proxy?.username || '');
  const password = String(proxy?.password || '');
  const type = PROXY_TYPES.includes(proxy?.type) ? proxy.type : 'http';
  if (proxyNeedsUrlForm(username, password)) {
    const auth = username || password ? `${encodePart(username)}${password ? `:${encodePart(password)}` : ''}@` : '';
    return `${type}://${auth}${host}:${port}`;
  }
  if (!username && !password) return `${host}:${port}`;
  if (!password) return `${host}:${port}:${username}`;
  return `${host}:${port}:${username}:${password}`;
}
