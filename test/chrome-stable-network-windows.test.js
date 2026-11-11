import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { connect } from 'node:net';
import fs from 'node:fs';
import { createServer, get } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { applyWebRtcPreference } from '../server/webrtc-settings.js';
import { resolveWindowsChromeStable, stableProxyNetworkArgs } from '../server/browser-runtime/chrome-stable.js';

const listen = (server, host = '127.0.0.1') => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, host, () => resolve(server.address().port));
});
const close = server => new Promise((resolve, reject) => {
  if (!server.listening) return resolve();
  server.close(error => error ? reject(error) : resolve());
  server.closeAllConnections();
});

function createTlsFixture(dir) {
  const gitOpenSsl = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'usr', 'bin', 'openssl.exe');
  const openssl = fs.existsSync(gitOpenSsl) ? gitOpenSsl : 'openssl.exe';
  const keyFile = path.join(dir, 'test-key.pem');
  const certFile = path.join(dir, 'test-cert.pem');
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-keyout', keyFile, '-out', certFile],
    { stdio: ['ignore', 'ignore', 'pipe'], timeout: 20000 });
  const key = fs.readFileSync(keyFile);
  const cert = fs.readFileSync(certFile);
  fs.unlinkSync(keyFile);
  fs.unlinkSync(certFile);
  const spki = new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' });
  return { key, cert, pin: createHash('sha256').update(spki).digest('base64') };
}

test('signed Chrome uses the explicit proxy for loopback HTTP, WS and WSS and refuses direct fallback after outage', { timeout: 75000 }, async () => {
  assert.equal(process.platform, 'win32');
  const stable = await resolveWindowsChromeStable();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-proxy-route-'));
  let context, tlsTarget;
  const netLog = path.join(dir, 'fixture-netlog.json');
  const domain = 'azwah-routing.invalid';
  let ipv6Hits = 0;
  let directHits = 0;
  const routed = new Set();
  const tunnels = new Set();
  const sockets = new Set();
  let webSocketPeer;
  const trap = createServer((_, res) => { directHits++; res.end('direct connection'); });
  const upgrade = (req, socket) => {
    sockets.add(socket);
    webSocketPeer = socket.remotePort;
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  };
  trap.on('upgrade', upgrade);
  const stun = createSocket('udp4');
  let stunPackets = 0;
  stun.on('message', data => {
    if (data.length >= 20 && data.readUInt32BE(4) === 0x2112a442) stunPackets++;
  });
  const ipv6 = createServer((req, res) => { ipv6Hits++; res.end(req.socket.remoteFamily + ' via relay'); });
  let ipv6Target;
  const relay = createServer((req, res) => {
    routed.add(req.url);
    if (req.url === 'http://' + domain + '/redirect') {
      res.writeHead(302, { Location: 'http://' + domain + '/page' });
      res.end();
      return;
    }
    if (req.url === 'http://' + domain + '/page') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<script src="/subresource"></script>');
      return;
    }
    if (req.url === 'http://' + domain + '/subresource') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end('window.proxySubresourceLoaded = true;');
      return;
    }
    if (req.url === ipv6Target) {
      get({ hostname: '::1', port: ipv6.address().port, path: '/azwah-v6' }, upstream => {
        res.writeHead(upstream.statusCode);
        upstream.pipe(res);
      }).on('error', () => { res.writeHead(502); res.end(); });
      return;
    }
    res.setHeader('Connection', 'close');
    res.end('proxy connection');
  });
  try {
    const targetPort = await listen(trap);
    const { pin, ...tlsOptions } = createTlsFixture(dir);
    tlsTarget = createTlsServer(tlsOptions, (_, res) => { directHits++; res.end('unexpected HTTPS request'); });
    tlsTarget.on('upgrade', upgrade);
    const tlsPort = await listen(tlsTarget);
    ipv6Target = 'http://[::1]:' + await listen(ipv6, '::1') + '/azwah-v6';
    await new Promise((resolve, reject) => {
      stun.once('error', reject);
      stun.bind(0, '127.0.0.1', resolve);
    });
    const stunPort = stun.address().port;
    const control = createSocket('udp4');
    try {
      const packet = Buffer.alloc(20);
      packet.writeUInt16BE(1);
      packet.writeUInt32BE(0x2112a442, 4);
      const received = new Promise(resolve => stun.once('message', resolve));
      control.send(packet, stunPort, '127.0.0.1');
      await received;
      assert.equal(stunPackets, 1, 'STUN observer can see local UDP traffic');
    } finally { control.close(); }
    stunPackets = 0;
    relay.on('connect', (req, client, head) => {
      sockets.add(client);
      const destination = req.url === '127.0.0.1:' + targetPort ? targetPort :
        req.url === 'localhost:' + tlsPort ? tlsPort : null;
      if (!destination) return client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      const upstream = connect(destination, '127.0.0.1', () => {
        tunnels.add(upstream.localPort);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        client.pipe(upstream).pipe(client);
      });
      sockets.add(upstream);
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
    });
    const proxyPort = await listen(relay);
    const proxy = 'http://127.0.0.1:' + proxyPort;
    assert.equal(applyWebRtcPreference(dir, 'disable_non_proxied_udp'), true);
    context = await chromium.launchPersistentContext(dir, {
      executablePath: stable.path, chromiumSandbox: true, ignoreDefaultArgs: true,
      headless: false, viewport: null,
      args: ['--remote-debugging-pipe', '--user-data-dir=' + dir, '--no-first-run',
        '--log-net-log=' + netLog, '--proxy-server=' + proxy, '--proxy-bypass-list=<-loopback>',
        '--ignore-certificate-errors-spki-list=' + pin,
        ...stableProxyNetworkArgs('127.0.0.1', false), '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', 'about:blank'],
    });
    const page = context.pages()[0] || await context.newPage();
    const url = 'http://127.0.0.1:' + targetPort + '/azwah-route';
    const response = await page.goto(url, { timeout: 10000 });
    assert.equal(await response.text(), 'proxy connection');
    assert.ok(routed.has(url));
    assert.equal(directHits, 0);
    const tab = await context.newPage();
    await tab.goto('http://' + domain + '/redirect', { timeout: 10000 });
    assert.equal(await tab.evaluate(() => window.proxySubresourceLoaded), true);
    for (const route of ['/redirect', '/page', '/subresource']) {
      assert.ok(routed.has('http://' + domain + route), 'Proxy receives the destination hostname');
    }
    await tab.close();
    const v6 = await page.goto(ipv6Target, { timeout: 10000 });
    assert.equal(await v6.text(), 'IPv6 via relay');
    assert.ok(routed.has(ipv6Target));
    await page.goto(url, { timeout: 10000 });
    const candidates = await page.evaluate(async port => {
      const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:' + port }] });
      const records = [];
      peer.onicecandidate = event => {
        if (event.candidate) records.push({ protocol: event.candidate.protocol, type: event.candidate.type });
      };
      try {
        peer.createDataChannel('azwah-ice');
        await peer.setLocalDescription(await peer.createOffer());
        await new Promise(resolve => setTimeout(resolve, 3500));
        return records;
      } finally { peer.close(); }
    }, stunPort);
    console.log(JSON.stringify({ iceCandidates: candidates, localStunPackets: stunPackets }));
    assert.ok(!candidates.some(candidate => candidate.protocol === 'udp'), 'No UDP ICE candidates under the restricted policy');
    assert.equal(stunPackets, 0, 'Restricted browser did not reach the local UDP STUN observer');
    console.log('Controlled IPv6 relay request passed; restricted Chrome emitted no UDP ICE or local STUN traffic during observation.');
    const wsUrl = 'ws://127.0.0.1:' + targetPort + '/websocket';
    const openSocket = url => page.evaluate(address => new Promise(resolve => {
      const socket = new WebSocket(address);
      const timer = setTimeout(() => { socket.close(); resolve(false); }, 5000);
      socket.onopen = () => { clearTimeout(timer); socket.close(); resolve(true); };
      socket.onerror = () => { clearTimeout(timer); resolve(false); };
    }), url);
    assert.equal(await openSocket(wsUrl), true);
    assert.ok(tunnels.has(webSocketPeer), 'WebSocket target peer is the relay tunnel, not Chrome');
    const wssUrl = 'wss://localhost:' + tlsPort + '/secure-websocket';
    webSocketPeer = undefined;
    assert.equal(await openSocket(wssUrl), true);
    assert.ok(tunnels.has(webSocketPeer), 'TLS WebSocket reached the target through a CONNECT tunnel');
    const peerBeforeOutage = webSocketPeer;
    for (const socket of sockets) socket.destroy();
    await close(relay);
    assert.equal(await openSocket(wsUrl + '-outage'), false);
    assert.equal(await openSocket(wssUrl + '-outage'), false);
    assert.equal(webSocketPeer, peerBeforeOutage);
    await assert.rejects(page.goto(url + '-outage', { timeout: 10000 }),
      /ERR_PROXY_CONNECTION_FAILED|ERR_CONNECTION_REFUSED/);
    assert.equal(directHits, 0);
    await assert.rejects(page.goto(ipv6Target + '-outage', { timeout: 10000 }),
      /ERR_PROXY_CONNECTION_FAILED|ERR_CONNECTION_REFUSED/);
    assert.equal(ipv6Hits, 1, 'Browser must not contact the reachable IPv6 target directly after outage');
    await context.close();
    context = undefined;
    const log = JSON.parse(fs.readFileSync(netLog, 'utf8'));
    const dnsEvents = new Set(Object.entries(log.constants.logEventTypes)
      .filter(([name]) => name.startsWith('DNS_TRANSACTION') || name === 'HOST_RESOLVER_SYSTEM_TASK')
      .map(([, id]) => id));
    assert.ok(dnsEvents.size > 0, 'Chrome exposes DNS and resolver NetLog event types');
    assert.equal(log.events.filter(event => dnsEvents.has(event.type) &&
      JSON.stringify(event.params || {}).includes(domain)).length, 0,
    'Chrome NetLog recorded no DNS transaction or system resolver task for the controlled hostname');
  } finally {
    for (const socket of sockets) socket.destroy();
    try { await context?.close(); } finally {
      try { stun.close(); } catch { /* socket was not bound */ }
      await Promise.all([close(relay), close(trap), close(ipv6), ...(tlsTarget ? [close(tlsTarget)] : [])]);
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
});
