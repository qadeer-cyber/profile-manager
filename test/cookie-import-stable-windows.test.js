// Cookie import into a stopped Chrome Stable profile must survive Chrome itself.
//
// Chrome Stable on Windows encrypts cookie values with its own per-user key (the os_crypt key in
// "Local State", DPAPI-protected, and on newer versions an app-bound key). A value written with
// Chromium's fixed basic key cannot be decrypted by it and is dropped on the first run. This test
// imports a JSON cookie (the same endpoint Netscape cookies.txt and encrypted-archive import use)
// into a stopped profile, runs Chrome Stable, and checks the cookie in the browser: in the CDP
// cookie store and in document.cookie on a matching origin. Values are never printed; the log
// shows only the os_crypt key names in Local State and the prefixes of the stored blobs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';

function osCryptKeys(dir) {
  try { return Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'Local State'), 'utf8')).os_crypt || {}).sort(); }
  catch { return null; }
}
async function blobPrefixes(dir, name) {
  const { cookieDbPath } = await import('../server/cookies.js');
  const Database = (await import('better-sqlite3')).default;
  const file = cookieDbPath(dir);
  if (!fs.existsSync(file)) return [];
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return db.prepare('SELECT encrypted_value FROM cookies WHERE name=?').all(name)
      .map(row => row.encrypted_value?.length ? row.encrypted_value.subarray(0, 3).toString('latin1') : 'plain');
  } finally { db.close(); }
}

test('real Chrome Stable: cookies imported into a stopped profile are readable by Chrome', { timeout: 300000 }, async t => {
  if (process.platform !== 'win32') { t.skip('Chrome Stable runtime is Windows-only'); return; }
  const { resolveWindowsChromeStable } = await import('../server/browser-runtime/chrome-stable.js');
  let stable;
  try { stable = await resolveWindowsChromeStable(); } catch (error) { t.skip(`Chrome Stable not available: ${error.code || error.message}`); return; }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-cookie-stable-'));
  process.env.PM_DATA_DIR = dir;
  process.env.PM_API_TOKEN = 'cookie-stable-token';
  const { startServer } = await import('../server/app.js');
  const { liveContext } = await import('../server/browsers.js');
  const { userDataDir } = await import('../server/db.js');
  const site = http.createServer((req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end('<title>cookie</title>'));
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${site.address().port}`;
  const server = await startServer({ port: 0, staticDir: null });
  const api = async (method, route, body, expected = 200) => {
    const r = await fetch(server.url + '/api/v1' + route, { method, body: body && JSON.stringify(body), signal: AbortSignal.timeout(120000),
      headers: { Authorization: 'Bearer cookie-stable-token', 'Content-Type': 'application/json' } });
    const data = await r.json().catch(() => null);
    assert.equal(r.status, expected, `${method} ${route}: ${JSON.stringify(data)}`);
    return data;
  };
  // What the running browser holds for this origin, without values: names and flags, plus whether
  // document.cookie on the page shows each expected name=value pair.
  async function inBrowser(id, expected) {
    const ctx = liveContext(id);
    assert.ok(ctx, 'Chrome Stable profile runs with a browser context this test can observe');
    const page = await ctx.newPage();
    try {
      await page.goto(origin + '/');
      const visible = await page.evaluate(pairs => pairs.map(pair => document.cookie.split('; ').includes(pair)), expected.map(([n, v]) => `${n}=${v}`));
      const session = await ctx.newCDPSession(page);
      const { cookies } = await session.send('Network.getAllCookies');
      await session.detach().catch(() => {});
      const names = new Map(cookies.filter(c => expected.some(([n]) => n === c.name)).map(c => [c.name, c]));
      return expected.map(([name, value], i) => ({ name, inStore: names.has(name), valueMatches: names.get(name)?.value === value,
        domain: names.get(name)?.domain ?? null, httpOnly: names.get(name)?.httpOnly ?? null, inDocument: visible[i] }));
    } finally { await page.close().catch(() => {}); }
  }

  let id = null;
  try {
    // This test reads the running browser's cookie store, so it uses the controlled (automation) path.
    const profile = await api('POST', '/profiles', { name: 'Cookie import (Chrome Stable)', automationEnabled: true, advancedSettings: { runtime: 'stable-chrome' } }, 201);
    id = profile.id;
    const dataDir = userDataDir(id);
    console.log(`# Chrome Stable ${stable.version}`);

    // First run creates Chrome's own Local State and cookie store, like a profile a user has opened.
    await api('POST', `/profiles/${id}/launch`, { headless: false });
    await api('POST', `/profiles/${id}/stop`);
    console.log(`# Local State os_crypt keys after Chrome ran: ${JSON.stringify(osCryptKeys(dataDir))}`);

    const future = Math.floor(Date.now() / 1000) + 864000;
    const imported = [
      { name: 'imported_host', value: 'synthetic-host-1', domain: '127.0.0.1', path: '/', secure: false, httpOnly: false, sameSite: 'Lax', expires: future },
      { name: 'imported_session', value: 'synthetic-session-2', domain: '127.0.0.1', path: '/', secure: false, httpOnly: false, sameSite: 'Unspecified' },
      { name: 'imported_httponly', value: 'synthetic-httponly-3', domain: '127.0.0.1', path: '/', secure: false, httpOnly: true, sameSite: 'Strict', expires: future },
    ];
    const result = await api('POST', `/profiles/${id}/cookies/import`, { cookies: imported });
    assert.equal(result.imported, imported.length);
    console.log(`# stored blob prefixes after import: ${JSON.stringify(await blobPrefixes(dataDir, 'imported_host'))}`);

    // The app's own listing of the stopped profile shows the imported cookies with their flags.
    // (A session cookie follows Chrome's own rule: it is kept only when the profile restores its
    // previous session, so only persistent cookies are compared.)
    const persistent = imported.filter(c => c.expires != null);
    const listed = (await api('GET', `/profiles/${id}/cookies`)).cookies.filter(c => persistent.some(p => p.name === c.name));
    assert.deepEqual(listed.map(c => [c.name, c.domain, c.path, c.httpOnly, c.hostOnly, c.session]).sort(),
      persistent.map(c => [c.name, c.domain, c.path, c.httpOnly, true, false]).sort(), 'listing after import');

    await api('POST', `/profiles/${id}/launch`, { headless: false });
    const seen = await inBrowser(id, [['imported_host', 'synthetic-host-1'], ['imported_httponly', 'synthetic-httponly-3']]);
    console.log(`# Chrome view of imported cookies: ${JSON.stringify(seen.map(({ name, inStore, valueMatches, inDocument, domain, httpOnly }) => ({ name, inStore, valueMatches, inDocument, domain, httpOnly })))}`);
    for (const row of seen) {
      assert.equal(row.inStore, true, `${row.name}: Chrome dropped the imported cookie`);
      assert.equal(row.valueMatches, true, `${row.name}: Chrome reads a different value`);
      assert.equal(row.domain, '127.0.0.1', `${row.name}: host-only cookie kept host-only`);
    }
    assert.equal(seen.find(r => r.name === 'imported_host').inDocument, true, 'document.cookie shows the imported cookie');
    assert.equal(seen.find(r => r.name === 'imported_httponly').inDocument, false, 'an HttpOnly cookie stays hidden from document.cookie');
    assert.equal(seen.find(r => r.name === 'imported_httponly').httpOnly, true);
    await api('POST', `/profiles/${id}/stop`);
    console.log(`# stored blob prefixes after Chrome ran: ${JSON.stringify(await blobPrefixes(dataDir, 'imported_host'))}`);

    // Still there on the next run, and still listed while stopped.
    assert.ok((await api('GET', `/profiles/${id}/cookies`)).cookies.some(c => c.name === 'imported_host'), 'listed after Chrome ran');

    // Clearing one cookie while stopped removes it from Chrome too; the other survives.
    const cleared = await api('POST', `/profiles/${id}/cookies/clear`, { confirm: 'clear-selected', cookies: [{ name: 'imported_host', domain: '127.0.0.1', path: '/' }] });
    assert.equal(cleared.cleared, 1);
    await api('POST', `/profiles/${id}/launch`, { headless: false });
    const afterClear = await inBrowser(id, [['imported_host', 'synthetic-host-1'], ['imported_httponly', 'synthetic-httponly-3']]);
    assert.deepEqual(afterClear.map(r => [r.name, r.inStore]), [['imported_host', false], ['imported_httponly', true]], 'clear removed exactly the selected cookie');
    await api('POST', `/profiles/${id}/stop`);
  } finally {
    if (id) await fetch(server.url + `/api/v1/profiles/${id}/stop`, { method: 'POST', headers: { Authorization: 'Bearer cookie-stable-token' } }).catch(() => {});
    await server.close();
    site.close();
  }
});
