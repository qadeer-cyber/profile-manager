// Controlled action synchronization with real Chromium profiles launched by the app.
// Leader input reaches exactly the selected followers; password typing, bystanders and stopped
// sessions are never affected.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-action-sync-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'action-sync';
process.env.HEADLESS = '1';
const { startServer } = await import('../server/app.js');
const engine = await import('../server/browsers.js');

const PAGE = `<!doctype html><title>sync</title><body style="margin:0">
<button id="btn" style="position:absolute;left:40px;top:40px;width:160px;height:60px" onclick="this.dataset.n=(+this.dataset.n||0)+1">Count</button>
<input id="text" style="position:absolute;left:40px;top:140px;width:200px">
<input id="pw" type="password" style="position:absolute;left:40px;top:200px;width:200px">
</body>`;
const site = http.createServer((req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end(PAGE.replace('<title>sync</title>', `<title>${req.url}</title>`)));
let server, origin;
const call = async (method, route, body) => {
  const r = await fetch(server.url + '/api' + route, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const page = id => engine.liveContext(id).pages()[0];
const count = id => page(id).$eval('#btn', b => +b.dataset.n || 0);
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };

before(async () => {
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${site.address().port}`;
  server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' });
  // Four live profiles: raise the user-adjustable running-profile guard (default 4) for this test.
  const { setSetting } = await import('../server/db.js');
  setSetting('maxRunningProfiles', 6);
});
after(async () => {
  for (const p of (await call('GET', '/profiles')).body || []) if (p.running) await call('POST', `/profiles/${p.id}/stop`);
  await server?.close();
  site.close();
  try { const { db } = await import('../server/db.js'); db.close(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

test('leader input is mirrored only to selected followers and stops on request', { timeout: 180000 }, async () => {
  const ids = {};
  for (const name of ['Leader', 'Follower A', 'Follower B', 'Bystander']) {
    const created = await call('POST', '/profiles', { name });
    assert.equal(created.status, 201);
    ids[name] = created.body.id;
    const launched = await call('POST', `/profiles/${created.body.id}/launch`, { headless: true });
    assert.equal(launched.status, 200, JSON.stringify(launched.body));
    assert.ok(engine.liveContext(created.body.id), 'profile has an app-controlled browser context');
    await page(created.body.id).goto(origin + '/start');
  }
  const leader = ids.Leader, followers = [ids['Follower A'], ids['Follower B']], bystander = ids.Bystander;

  assert.equal((await call('POST', '/sync/start', { leaderId: leader, followerIds: [leader] })).status, 400, 'leader cannot follow itself');
  assert.equal((await call('POST', '/sync/start', { leaderId: leader, followerIds: [] })).status, 400);

  const started = await call('POST', '/sync/start', { leaderId: leader, followerIds: followers });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  const sessionId = started.body.id;
  assert.equal((await call('POST', '/sync/start', { leaderId: bystander, followerIds: [followers[0]] })).status, 409, 'a follower cannot join a second session');
  assert.equal((await call('GET', '/sync')).body.sessions.length, 1);

  // Click: reaches both followers, not the bystander.
  await page(leader).click('#btn');
  assert.ok(await until(async () => (await count(followers[0])) === 1 && (await count(followers[1])) === 1), 'followers received the click');
  assert.equal(await count(bystander), 0, 'bystander untouched');

  // Typing in a normal field is mirrored.
  await page(leader).click('#text');
  await page(leader).keyboard.type('abc');
  assert.ok(await until(async () => (await page(followers[0]).inputValue('#text')) === 'abc' && (await page(followers[1]).inputValue('#text')) === 'abc'), 'typing mirrored');

  // Typing into a password field is never mirrored (the click that focuses it is).
  await page(leader).click('#pw');
  await page(leader).keyboard.type('s3cret');
  await new Promise(r => setTimeout(r, 800));
  assert.equal(await page(leader).inputValue('#pw'), 's3cret');
  for (const f of followers) assert.equal(await page(f).inputValue('#pw'), '', 'password not mirrored');

  // Navigation typed into the leader's address bar reaches followers.
  await page(leader).goto(origin + '/second');
  assert.ok(await until(async () => followers.every(f => page(f).url() === origin + '/second')), 'navigation mirrored');
  assert.equal(page(bystander).url(), origin + '/start');

  // Stop: further input is not mirrored.
  const stopped = await call('POST', `/sync/${sessionId}/stop`);
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.state, 'stopped');
  assert.ok(stopped.body.mirrored.click >= 3 && stopped.body.mirrored.key >= 3);
  const before = await count(followers[0]);
  await page(leader).click('#btn');
  await new Promise(r => setTimeout(r, 800));
  assert.equal(await count(followers[0]), before, 'nothing mirrored after stop');
  assert.equal((await call('GET', '/sync')).body.sessions.length, 0);

  // A new session on the same leader works (the binding is per context, the routing per session).
  const again = await call('POST', '/sync/start', { leaderId: leader, followerIds: [followers[1]] });
  assert.equal(again.status, 201);
  const b0 = await count(followers[1]), a0 = await count(followers[0]);
  await page(leader).click('#btn');
  assert.ok(await until(async () => (await count(followers[1])) === b0 + 1), 'second session mirrors');
  assert.equal(await count(followers[0]), a0, 'previous follower no longer receives input');

  // Stopping a participant ends its session.
  assert.equal((await call('POST', `/profiles/${followers[1]}/stop`)).status, 200);
  assert.ok(await until(async () => (await call('GET', '/sync')).body.sessions.length === 0), 'session ended when a follower stopped');
  assert.equal((await call('POST', '/sync/start', { leaderId: leader, followerIds: [followers[1]] })).status, 409, 'stopped profiles cannot be synchronized');
});
