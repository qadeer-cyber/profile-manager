// Bookmarks import/export over the HTTP API: stopped-only, per-profile isolation, large files,
// HTML export, and survival through a backup and restore.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-bm-api-'));
process.env.PM_DATA_DIR = dataDir;
process.env.PM_API_TOKEN = 'bm-api';
const { startServer } = await import('../server/app.js');
const { userDataDir, db } = await import('../server/db.js');
let server;

const call = async (method, route, body, { raw = false } = {}) => {
  const r = await fetch(server.url + '/api/v1' + route, { method, signal: AbortSignal.timeout(90000),
    headers: { Authorization: 'Bearer bm-api', ...(body !== undefined && { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' }) },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const type = r.headers.get('content-type') || '';
  return { status: r.status, type, body: type.includes('json') ? await r.json() : type.includes('octet') ? Buffer.from(await r.arrayBuffer()) : await r.text() };
};
const chromium = bar => JSON.stringify({ roots: { bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: bar }, other: { type: 'folder', name: 'Other bookmarks', children: [] } }, version: 1 });
const flat = async id => (await call('GET', `/profiles/${id}/bookmarks/export`)).body.bookmarks.map(b => `${b.folder} | ${b.name} | ${b.url}`);

before(async () => { server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' }); });
after(async () => {
  await server.close();
  try { db.close(); } catch {}
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

test('import into one stopped profile leaves the other untouched; HTML export round-trips', async () => {
  const a = (await call('POST', '/profiles', { name: 'BM A' })).body.id;
  const b = (await call('POST', '/profiles', { name: 'BM B' })).body.id;
  const file = chromium([{ type: 'url', name: 'Ünïcødé ✓', url: 'https://a.test/' }, { type: 'folder', name: 'Work', children: [{ type: 'url', name: 'Docs', url: 'https://docs.test/' }] }]);
  const imported = await call('POST', `/profiles/${a}/bookmarks/import`, { content: file });
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.deepEqual([imported.body.format, imported.body.imported, imported.body.duplicates], ['chromium-json', 2, 0]);
  assert.deepEqual(await flat(a), ['Bookmarks bar | Ünïcødé ✓ | https://a.test/', 'Bookmarks bar / Work | Docs | https://docs.test/']);
  assert.deepEqual(await flat(b), [], 'profile B is not affected');

  const html = await call('GET', `/profiles/${a}/bookmarks/export.html`);
  assert.equal(html.status, 200);
  assert.match(html.type, /text\/html/);
  assert.match(html.body, /<A HREF="https:\/\/docs.test\/">Docs<\/A>/);
  const intoB = await call('POST', `/profiles/${b}/bookmarks/import`, { content: html.body });
  assert.equal(intoB.body.format, 'netscape-html');
  assert.deepEqual(await flat(b), await flat(a));
  const twice = await call('POST', `/profiles/${b}/bookmarks/import`, { content: html.body });
  assert.deepEqual([twice.body.imported, twice.body.duplicates], [0, 2]);
});

test('bad requests are refused with a reason and change nothing', async () => {
  const id = (await call('POST', '/profiles', { name: 'BM bad' })).body.id;
  await call('POST', `/profiles/${id}/bookmarks/import`, { content: chromium([{ type: 'url', name: 'Keep', url: 'https://keep.test/' }]) });
  for (const body of [{}, { content: 42 }, { content: '' }, { content: '{"roots":' }, { content: 'hello' }]) {
    const r = await call('POST', `/profiles/${id}/bookmarks/import`, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(typeof r.body.error, 'string');
  }
  assert.deepEqual(await flat(id), ['Bookmarks bar | Keep | https://keep.test/']);
  assert.equal((await call('POST', '/profiles/does-not-exist/bookmarks/import', { content: chromium([]) })).status, 404);
  const ff = (await call('POST', '/profiles', { name: 'BM firefox', browserEngine: 'firefox' })).body;
  if (ff?.browserEngine === 'firefox') {
    const r = await call('POST', `/profiles/${ff.id}/bookmarks/import`, { content: chromium([]) });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /Chromium-based/);
  }
});

test('files over the 1 MB JSON body limit are accepted up to the 5 MB cap', async () => {
  const id = (await call('POST', '/profiles', { name: 'BM large' })).body.id;
  const many = Array.from({ length: 4000 }, (_, i) => ({ type: 'url', name: `Bookmark ${i} ${'x'.repeat(250)}`, url: `https://many.test/${i}` }));
  const content = chromium(many);
  assert.ok(Buffer.byteLength(content) > 1024 * 1024);
  const r = await call('POST', `/profiles/${id}/bookmarks/import`, { content });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
  assert.equal(r.body.imported, 4000);
  const tooBig = await call('POST', `/profiles/${id}/bookmarks/import`, { content: 'x'.repeat(5 * 1024 * 1024 + 10) });
  assert.equal(tooBig.status, 413);
});

test('imported bookmarks survive a backup and restore', async () => {
  const id = (await call('POST', '/profiles', { name: 'BM backup' })).body.id;
  await call('POST', `/profiles/${id}/bookmarks/import`, { content: chromium([{ type: 'url', name: 'Saved', url: 'https://saved.test/' }]) });
  const backup = await call('POST', '/backup', {});
  assert.equal(backup.status, 200);
  db.prepare('DELETE FROM profiles WHERE id=?').run(id);
  fs.rmSync(userDataDir(id), { recursive: true, force: true });
  const restored = await call('POST', `/backup/restore?collision=rename&profileIds=${id}`, backup.body, { raw: true });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  const newId = restored.body.added[0].id;
  assert.deepEqual(await flat(newId), ['Bookmarks bar | Saved | https://saved.test/']);
});

test('a running profile is refused for import and HTML export', async () => {
  const id = (await call('POST', '/profiles', { name: 'BM running' })).body.id;
  await call('POST', `/profiles/${id}/bookmarks/import`, { content: chromium([{ type: 'url', name: 'Before', url: 'https://before.test/' }, { type: 'folder', name: 'Arbeit ✓', children: [{ type: 'folder', name: '深い', children: [{ type: 'url', name: 'Café', url: 'https://cafe.test/' }] }] }]) });
  const launched = await call('POST', `/profiles/${id}/launch`, { headless: true });
  assert.equal(launched.status, 200, JSON.stringify(launched.body));
  try {
    // The browser itself loaded the imported file: ask Chromium's bookmarks API, not our parser.
    const { liveContext } = await import('../server/browsers.js');
    const page = await liveContext(id).newPage();
    await page.goto('chrome://bookmarks/');
    const titles = await page.evaluate(() => new Promise(resolve => chrome.bookmarks.getTree(tree => {
      const out = []; const walk = (n, trail) => { if (n.url) out.push(`${trail.join('/')}|${n.title}|${n.url}`); (n.children || []).forEach(c => walk(c, n.url || !n.parentId ? trail : [...trail, n.title])); };
      tree.forEach(n => walk(n, [])); resolve(out);
    })));
    assert.deepEqual(titles, ['Bookmarks bar|Before|https://before.test/', 'Bookmarks bar/Arbeit ✓/深い|Café|https://cafe.test/']);
    await page.close();
    const r = await call('POST', `/profiles/${id}/bookmarks/import`, { content: chromium([{ type: 'url', name: 'During', url: 'https://during.test/' }]) });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /Stop the profile/);
    assert.equal((await call('GET', `/profiles/${id}/bookmarks/export.html`)).status, 409);
  } finally { await call('POST', `/profiles/${id}/stop`); }
  assert.ok((await flat(id)).every(line => !line.includes('during.test')), 'nothing imported while running');
});
