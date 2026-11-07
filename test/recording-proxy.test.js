import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {createRecordingProxy} from '../scripts/recording-proxy.mjs';

const require = createRequire(import.meta.url);
const {HttpsProxyAgent} = require('https-proxy-agent');

test('the recording proxy answers the CONNECT request used by Test Proxy', async () => {
  const hits = [];
  const proxy = createRecordingProxy(hits);
  const port = await new Promise(resolve => proxy.listen(0, '127.0.0.1', () => resolve(proxy.address().port)));
  try {
    const agent = new HttpsProxyAgent(`http://azwah:secret@127.0.0.1:${port}`);
    const body = await new Promise((resolve, reject) => {
      http.get('http://203.0.113.10/ip', {agent}, response => {
        let text = '';
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => resolve(text));
      }).on('error', reject);
    });
    assert.equal(JSON.parse(body).ip, '203.0.113.50');
    assert.equal(hits.some(item => item.includes('/ip')), true);
  } finally {
    proxy.close();
  }
});
