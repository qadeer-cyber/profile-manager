import test from 'node:test';
import assert from 'node:assert/strict';
import { formatProxyLine, parseProxyLine } from '../server/proxy-line.js';

test('colon form keeps the selected protocol and an explicit empty password', () => {
  assert.deepEqual(parseProxyLine('203.0.113.10:8080', 'socks5'), {
    type: 'socks5', host: '203.0.113.10', port: '8080', username: '', password: '', schemeSelected: false,
  });
  assert.deepEqual(parseProxyLine('203.0.113.10:8080:alice', 'https'), {
    type: 'https', host: '203.0.113.10', port: '8080', username: 'alice', password: '', schemeSelected: false,
  });
  assert.deepEqual(parseProxyLine('203.0.113.10:8080:alice:', 'http'), {
    type: 'http', host: '203.0.113.10', port: '8080', username: 'alice', password: '', schemeSelected: false,
  });
  assert.equal(parseProxyLine('h:1:u:pa:ss').password, 'pa:ss');
});

test('URL form percent-decodes and selects the scheme', () => {
  assert.deepEqual(parseProxyLine('socks5://u:p%40@h:9', 'http'), {
    type: 'socks5', host: 'h', port: '9', username: 'u', password: 'p@', schemeSelected: true,
  });
  assert.equal(parseProxyLine('socks5h://h:9').type, 'socks5');
  assert.deepEqual(parseProxyLine('https://[2001:db8::1]:443'), {
    type: 'https', host: '[2001:db8::1]', port: '443', username: '', password: '', schemeSelected: true,
  });
  assert.equal(parseProxyLine('http://user%3Aname:p%40ss@h:1').username, 'user:name');
  assert.throws(() => parseProxyLine('http://bad%zz@h:1'), /Invalid URL encoding/);
  assert.throws(() => parseProxyLine('ftp://h:1'), /Unsupported scheme/);
});

test('bracketed IPv6 colon form is literal and unbracketed text is rejected', () => {
  assert.deepEqual(parseProxyLine('[2001:db8::1]:1080:alice:s:ec', 'socks5'), {
    type: 'socks5', host: '[2001:db8::1]', port: '1080', username: 'alice', password: 's:ec', schemeSelected: false,
  });
  assert.throws(() => parseProxyLine('just-a-host'), /Unrecognized/);
  assert.throws(() => parseProxyLine('2001:db8::1:1080'), /Unrecognized/);
  assert.throws(() => parseProxyLine('h:1:u p'), /Unrecognized/);
});

test('formatting round-trips without inventing a password', () => {
  const plain = { type: 'http', host: '203.0.113.10', port: '8080', username: 'alice', password: '' };
  assert.equal(formatProxyLine(plain), '203.0.113.10:8080:alice');
  assert.deepEqual(parseProxyLine(formatProxyLine(plain)), { ...plain, schemeSelected: false });
  const special = { type: 'socks5', host: '203.0.113.10', port: '1080', username: 'a:b', password: 'p@ss' };
  const line = formatProxyLine(special);
  assert.equal(line, 'socks5://a%3Ab:p%40ss@203.0.113.10:1080');
  const parsed = parseProxyLine(line, 'http');
  assert.equal(parsed.type, 'socks5');
  assert.equal(parsed.username, 'a:b');
  assert.equal(parsed.password, 'p@ss');
  assert.equal(parsed.schemeSelected, true);
});
