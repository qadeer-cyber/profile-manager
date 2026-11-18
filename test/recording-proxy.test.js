import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {FIXTURE_ADDRESS, createRecordingProxy, proxyEvidence} from '../scripts/recording-proxy.mjs';

const require = createRequire(import.meta.url);
const {HttpsProxyAgent} = require('https-proxy-agent');

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
function get(url, agent) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, {agent}, response => {
      let text = '';
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({status: response.statusCode, text}));
    });
    req.on('error', reject);
  });
}

test('authenticated CONNECT is correlated and an anonymous tunnel is refused', async () => {
  const events = [];
  const proxy = createRecordingProxy(events, {username: 'azwah', password: 'secret'});
  const port = await listen(proxy);
  try {
    const authed = new HttpsProxyAgent(`http://azwah:secret@127.0.0.1:${port}`);
    const body = await get('http://203.0.113.10/ip', authed);
    assert.equal(body.status, 200);
    const parsed = JSON.parse(body.text);
    assert.equal(parsed.ip, FIXTURE_ADDRESS);
    assert.equal(parsed.observedPublicEgress, false);
    const anon = new HttpsProxyAgent(`http://127.0.0.1:${port}`);
    const refused = await get('http://203.0.113.10/ip', anon).catch(error => ({status: 0, text: error.message}));
    assert.notEqual(refused.status, 200);
    const evidence = proxyEvidence(events);
    assert.equal(evidence.observedPublicEgress, false);
    assert.equal(evidence.authenticatedConnectCount, 1);
    assert.deepEqual(evidence.connectDestinations, ['203.0.113.10:80']);
    assert.equal(evidence.requestPaths.some(item => item.includes('/ip')), true);
    assert.equal(events.some(item => item.kind === 'connect' && item.authenticated === false), true);
  } finally {
    proxy.close();
  }
});

test('an ordinary proxy request is recorded only when it is authenticated and routed', async () => {
  const events = [];
  const proxy = createRecordingProxy(events, {username: 'azwah', password: 'secret'});
  const port = await listen(proxy);
  try {
    const denied = await new Promise(resolve => {
      const req = http.request({host: '127.0.0.1', port, path: 'http://203.0.113.10/azwah-route', method: 'GET'});
      req.on('response', response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
      req.end();
    });
    assert.equal(denied, 407);
    const allowed = await new Promise(resolve => {
      const req = http.request({host: '127.0.0.1', port, path: 'http://203.0.113.10/azwah-route', method: 'GET', headers: { 'proxy-authorization': `Basic ${Buffer.from('azwah:secret').toString('base64')}` }});
      let text = '';
      req.on('response', response => {
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => resolve({status: response.statusCode, text}));
      });
      req.end();
    });
    assert.equal(allowed.status, 200);
    assert.match(allowed.text, /azwah-route/);
    const evidence = proxyEvidence(events);
    assert.equal(evidence.requestPaths.filter(item => item.includes('azwah-route')).length, 1);
  } finally {
    proxy.close();
  }
});

test('the essential harness labels the fixture address and does not treat it as public egress', () => {
  const source = fs.readFileSync(new URL('../scripts/ultimate-essential-followup.mjs', import.meta.url), 'utf8');
  assert.match(source, /observedPublicEgress: false/);
  assert.match(source, /not an observed public IP/);
  assert.match(source, /name: 'HTTP', exact: true/);
  assert.doesNotMatch(source, /unified\.bringToFront/);
});
