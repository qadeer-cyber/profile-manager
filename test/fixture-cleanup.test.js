import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startLocalHttpFixture } from './_local-http-fixture.mjs';

test('HTTP fixture closes active keep-alive sockets and repeated cleanup is safe', { timeout: 3000 }, async () => {
  const fixture = await startLocalHttpFixture();
  const agent = new http.Agent({ keepAlive: true });
  try {
    await new Promise((resolve, reject) => http.get(fixture.origin, { agent }, res => {
      res.resume(); res.on('end', resolve);
    }).on('error', reject));
    await fixture.close();
    await fixture.close();
    await assert.rejects(fetch(fixture.origin));
  } finally { agent.destroy(); await fixture.close(); }
});
