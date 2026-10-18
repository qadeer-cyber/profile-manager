// Desktop-engine unit tests (owner: Windows Desktop Engineer): proc.js PID-reuse guard and Windows
// kill verification (mocked exec), verified Chromium install (tampered archive rejected), CHROMIUM_MISSING.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { yazl } = require('playwright-core/lib/utilsBundle');
const proc = await import('../server/proc.js');
const cr = await import('../server/chromium.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-desk-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- proc.js ----------
test('processCommandLine (linux): reads /proc cmdline of a live process', async () => {
  const p = spawn('sleep', ['31']); await sleep(100);
  assert.match(await proc.processCommandLine(p.pid), /sleep 31/); p.kill();
});
test('pidMatches: true only when the command line contains the needle', async () => {
  const dir = path.join(tmp, 'ud-A');
  const p = spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)', '--', `--user-data-dir=${dir}`]); await sleep(400);
  assert.equal(await proc.pidMatches(p.pid, dir), true);
  assert.equal(await proc.pidMatches(p.pid, dir.slice(0, -1)), false, 'prefix of the dir is not a match');
  assert.equal(await proc.pidMatches(p.pid, path.join(tmp, 'ud-B')), false, 'reused pid with other cmdline is not matched');
  assert.equal(await proc.pidMatches(2 ** 22 + 77, dir), false, 'dead pid never matches'); p.kill();
});
test('killTree with expect: refuses to kill a process whose cmdline does not match (PID reuse guard)', async () => {
  const p = spawn('sleep', ['32']); await sleep(100);
  assert.equal(await proc.killTree(p.pid, { expect: '/some/profile/dir' }), false);
  assert.ok(proc.isAlive(p.pid), 'unrelated process survived'); p.kill();
});
test('killTree (win32 mock): verifies the tree is gone after taskkill, retries, reports failure honestly', async () => {
  let alive = true, calls = [];
  const exec = (cmd, args, o, cb) => { calls.push(args.join(' ')); setTimeout(() => { alive = false; cb(null); }, 10); };
  assert.equal(await proc.killTree(4242, { platform: 'win32', exec, alive: () => alive, waitMs: 500 }), true);
  assert.deepEqual(calls, ['/PID 4242 /T /F']);
  calls = []; const stubborn = (cmd, args, o, cb) => { calls.push(args.join(' ')); cb(null); };
  assert.equal(await proc.killTree(4243, { platform: 'win32', exec: stubborn, alive: () => true, waitMs: 300 }), false, 'still alive -> false');
  assert.deepEqual(calls, ['/PID 4243 /T /F', '/PID 4243 /F']);
});
test('processCommandLine (win32 mock): uses Get-CimInstance, falls back to wmic', async () => {
  const seen = [];
  const exec = (cmd, args, o, cb) => { seen.push(cmd); cmd === 'powershell.exe' ? cb(new Error('x')) : cb(null, 'CommandLine="C:\\chrome.exe" --user-data-dir=C:\\Data\\P1\r\n'); };
  assert.match(await proc.processCommandLine(7, { platform: 'win32', exec }), /user-data-dir=C:\\Data\\P1/);
  assert.deepEqual(seen, ['powershell.exe', 'wmic']);
  const ok = await proc.pidMatches(7, 'c:/data/p1', { platform: 'win32', exec, alive: () => true });
  assert.equal(ok, true, 'Windows match is case/slash-insensitive');
});

// ---------- chromium.js ----------
function makeZip(file, files) {
  return new Promise(res => { const z = new yazl.ZipFile(); for (const [n, c] of Object.entries(files)) z.addBuffer(Buffer.from(c), n, { mode: 0o100755 }); z.outputStream.pipe(fs.createWriteStream(file)).on('close', res); z.end(); });
}
const sha = f => cr.sha256File(f);
async function fakeManifest(zip) {
  return { revision: '9999', browserVersion: '1.0', baseUrl: 'https://cdn.playwright.dev/builds/cft/1.0/',
    builds: { chromium: { linux64: { path: 'linux64/chrome-linux64.zip', sha256: await sha(zip), size: fs.statSync(zip).size } } } };
}
test('manifest: pinned revision matches the bundled playwright-core, URLs are official HTTPS', () => {
  assert.equal(cr.manifestMatchesPlaywright(), true);
  for (const b of Object.values(cr.MANIFEST.builds)) for (const e of Object.values(b)) {
    assert.match(e.sha256, /^[0-9a-f]{64}$/); cr.assertOfficialUrl(new URL(e.path, cr.MANIFEST.baseUrl).href);
  }
});
test('assertOfficialUrl: rejects http and non-official hosts', () => {
  assert.throws(() => cr.assertOfficialUrl('http://cdn.playwright.dev/x.zip'), e => e.code === 'UNTRUSTED_SOURCE');
  assert.throws(() => cr.assertOfficialUrl('https://evil.example/x.zip'), e => e.code === 'UNTRUSTED_SOURCE');
});
test('installOne: good archive is verified, extracted and marked complete', async () => {
  const good = path.join(tmp, 'good.zip'); await makeZip(good, { 'chrome-linux64/chrome': '#!/bin/sh\necho hi\n' });
  const manifest = await fakeManifest(good), root = path.join(tmp, 'root-good'); let fetched;
  const r = await cr.installOne('chromium', { root, manifest, key: 'linux64', download: async (u, d) => { fetched = u; fs.copyFileSync(good, d); } });
  assert.equal(fetched, 'https://cdn.playwright.dev/builds/cft/1.0/linux64/chrome-linux64.zip');
  assert.ok(fs.existsSync(path.join(r.dir, 'chrome-linux64/chrome')));
  assert.ok(fs.statSync(path.join(r.dir, 'chrome-linux64/chrome')).mode & 0o100, 'exec bit kept');
  assert.ok(fs.existsSync(path.join(r.dir, 'INSTALLATION_COMPLETE')));
  assert.equal(cr.chromiumStatus({ root, manifest, key: 'linux64' }).chromium.verified, true);
});
test('installOne: TAMPERED archive is rejected, nothing installed, temp file removed', async () => {
  const good = path.join(tmp, 'good2.zip'); await makeZip(good, { 'chrome-linux64/chrome': 'real' });
  const bad = path.join(tmp, 'bad.zip'); await makeZip(bad, { 'chrome-linux64/chrome': 'evil' });
  const manifest = await fakeManifest(good); manifest.builds.chromium.linux64.size = fs.statSync(bad).size; // same size, different bytes
  const root = path.join(tmp, 'root-bad');
  await assert.rejects(cr.installOne('chromium', { root, manifest, key: 'linux64', download: async (u, d) => fs.copyFileSync(bad, d) }), e => e.code === 'CHECKSUM_MISMATCH');
  assert.ok(!fs.existsSync(cr.installDir('chromium', { root, manifest })), 'no install dir');
  assert.deepEqual(fs.readdirSync(root), [], 'temp download deleted');
  assert.equal(cr.chromiumMissingError(false, false, { root, manifest, key: 'linux64' })?.code, 'CHROMIUM_MISSING');
});
test('extractZip: zip-slip entries are refused', async () => {
  const z = path.join(tmp, 'slip.zip'); await makeZip(z, { 'ok.txt': 'a' });
  // yazl refuses '..' names, so craft one by patching the name bytes of a same-length entry
  const z2 = path.join(tmp, 'slip2.zip'); await makeZip(z2, { 'aa/evil.txt': 'x' });
  const buf = fs.readFileSync(z2); let s = buf.toString('latin1').split('aa/evil.txt').join('../evil.txt'); fs.writeFileSync(z2, Buffer.from(s, 'latin1'));
  await assert.rejects(cr.extractZip(z2, path.join(tmp, 'slipdest')), /Unsafe path|invalid relative path/);
  assert.ok(!fs.existsSync(path.join(tmp, 'evil.txt')));
});
test('chromiumMissingError: structured CHROMIUM_MISSING for an empty browsers dir, null when present', () => {
  const e = cr.chromiumMissingError(true, false, { root: path.join(tmp, 'empty'), key: 'linux64' });
  assert.equal(e.code, 'CHROMIUM_MISSING'); assert.equal(e.status, 503); assert.equal(e.browser, 'chromium-headless-shell');
  assert.equal(cr.chromiumMissingError(false, false, { root: cr.browsersRoot(), key: 'linux64' }), null);
});
