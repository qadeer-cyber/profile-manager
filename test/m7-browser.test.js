// Real Chromium cookie round-trip, live-profile refusal, and backup of stored cookies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
import { spawnServer, stopServer } from './_ports.mjs';

test('cookies survive Chromium, live copies are refused, and backup restores them', { timeout: 180000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m7-browser-'));
  const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm7-browser' };
  const secret = 'browser-secret-value';
  let proc;
  const connections = [];
  const api = async (method, url, body) => {
    const response = await fetch(proc.url + '/api/v1' + url, { method, headers: { Authorization: 'Bearer m7-browser', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let value = {};
    try { value = text ? JSON.parse(text) : {}; } catch { value = { raw: text }; }
    return { status: response.status, body: value, text };
  };
  try {
    proc = await spawnServer(env);
    const profile = (await api('POST', '/profiles', { name: 'Cookie source', advancedSettings: { userAgent: { mode: 'full' } } })).body;
    const cookie = { name: 'sid', value: secret, domain: 'example.test', path: '/', secure: true, httpOnly: true, sameSite: 'None', expires: Math.floor(Date.now() / 1000) + 86400 };
    assert.equal((await api('POST', `/profiles/${profile.id}/cookies/import`, { cookies: [cookie] })).status, 200);
    const launched = await api('POST', `/profiles/${profile.id}/launch`, { headless: true, automation: true });
    assert.equal(launched.status, 200);
    const browser = await chromium.connectOverCDP(launched.body.cdp.httpEndpoint);
    connections.push(browser);
    const context = browser.contexts()[0];
    const seen = await context.cookies('https://example.test/');
    const sid = seen.find(item => item.name === 'sid');
    assert.equal(sid.value, secret);
    assert.equal(sid.httpOnly, true);
    assert.equal(sid.secure, true);
    assert.equal(sid.sameSite, 'None');
    await context.addCookies([{ name: 'frombrowser', value: 'written-by-chromium', domain: 'example.test', path: '/', secure: true, httpOnly: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 86400 }]);
    assert.equal((await api('POST', `/profiles/${profile.id}/cookies/import`, { cookies: [cookie] })).status, 409);
    assert.equal((await api('POST', `/profiles/${profile.id}/clone`, { copyData: true })).status, 409);
    const backupWhileRunning = await fetch(proc.url + '/api/v1/backup', { method: 'POST', headers: { Authorization: 'Bearer m7-browser' } });
    assert.equal(backupWhileRunning.status, 409);
    const settings = await api('POST', `/profiles/${profile.id}/clone`, { mode: 'settings' });
    assert.equal(settings.status, 201);
    assert.equal(settings.body.advancedSettings.userAgent.mode, 'full');
    assert.deepEqual((await api('GET', `/profiles/${settings.body.id}/cookies`)).body.cookies, []);
    await api('POST', `/profiles/${profile.id}/stop`, {});
    const stored = (await api('GET', `/profiles/${profile.id}/cookies`)).body.cookies;
    assert.equal(stored.find(item => item.name === 'sid').value, secret);
    assert.equal(stored.find(item => item.name === 'frombrowser').value, 'written-by-chromium');
    assert.equal(stored.find(item => item.name === 'frombrowser').sameSite, 'Lax');
    const copy = await api('POST', `/profiles/${profile.id}/clone`, { mode: 'data' });
    assert.equal(copy.status, 201);
    assert.equal((await api('GET', `/profiles/${copy.body.id}/cookies`)).body.cookies.find(item => item.name === 'sid').httpOnly, true);
    assert.equal((await api('DELETE', `/profiles/${settings.body.id}`)).status, 204);
    assert.equal((await api('DELETE', `/profiles/${copy.body.id}`)).status, 204);
    assert.equal((await api('POST', `/profiles/${profile.id}/cookies/clear`, { confirm: 'clear-selected', cookies: [{ name: 'sid', domain: 'example.test', path: '/' }] })).body.cleared, 1);
    const archive = await fetch(proc.url + '/api/v1/backup', { method: 'POST', headers: { Authorization: 'Bearer m7-browser' } });
    assert.equal(archive.status, 200);
    const bytes = Buffer.from(await archive.arrayBuffer());
    assert.equal((await api('DELETE', `/profiles/${profile.id}`)).status, 204);
    const restored = await fetch(proc.url + '/api/v1/backup/restore?collision=abort', { method: 'POST', headers: { Authorization: 'Bearer m7-browser', 'Content-Type': 'application/octet-stream' }, body: bytes });
    const restoredBody = await restored.json();
    assert.equal(restored.status, 200, JSON.stringify(restoredBody));
    const back = restoredBody.added.find(item => item.name === 'Cookie source');
    const cookies = (await api('GET', `/profiles/${back.id}/cookies`)).body.cookies;
    assert.equal(cookies.some(item => item.name === 'sid'), false);
    assert.equal(cookies.find(item => item.name === 'frombrowser').value, 'written-by-chromium');
    const alpha = (await api('POST', '/profiles', { name: 'Bulk A' })).body;
    const beta = (await api('POST', '/profiles', { name: 'Bulk B' })).body;
    const bulk = await api('POST', '/bulk/launch', { ids: [alpha.id, beta.id], concurrency: 2, headless: true });
    assert.deepEqual(bulk.body.map(item => item.ok), [true, true]);
    const stopped = await api('POST', '/bulk/stop', { ids: [alpha.id, beta.id], concurrency: 2 });
    assert.equal(stopped.body.stopped.length, 2);
    assert.equal(proc.out.includes(secret), false);
    assert.equal(proc.out.includes('written-by-chromium'), false);
  } finally {
    for (const browser of connections) await browser.close().catch(() => {});
    if (proc) await stopServer(proc);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
