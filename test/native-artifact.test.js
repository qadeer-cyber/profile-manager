// Native browser archive provenance and verification. SYNTHETIC files only: these tests prove the verifier
// refuses incomplete or altered archives; they do not show that any real browser works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildManifest, verifyArtifact, REQUIRED_FILES, safeRelative } from '../scripts/native-artifact.mjs';

const inputs = { azwahCommit: 'a'.repeat(40), chromiumRevision: 'b'.repeat(40), chromiumVersion: '159.0.8153.0',
  patchSha256: 'c'.repeat(64), gnArgsSha256: 'd'.repeat(64), toolchain: { clang: 'synthetic' }, runId: 1, stage: 'stage-3',
  smoke: { result: 'synthetic-not-run' } };
function archive(files = REQUIRED_FILES) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-native-artifact-'));
  for (const f of files) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), 'synthetic ' + f); }
  return dir;
}

test('a complete synthetic archive and its manifest verify', () => {
  const dir = archive();
  const m = buildManifest(dir, inputs);
  assert.equal(m.experimental, true);
  assert.equal(m.fileCount, REQUIRED_FILES.length);
  assert.match(m.chromeExeSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(verifyArtifact(dir, m), { ok: true, errors: [], smoke: 'synthetic-not-run' });
});

test('an archive with only chrome.exe is refused', () => {
  const dir = archive(['chrome.exe']);
  const r = verifyArtifact(dir, buildManifest(dir, inputs));
  assert.equal(r.ok, false);
  for (const name of REQUIRED_FILES.filter(f => f !== 'chrome.exe')) assert.ok(r.errors.includes(`Required runtime file missing: ${name}`), name);
});

test('a changed, added or removed file is detected', () => {
  const dir = archive();
  const m = buildManifest(dir, inputs);
  fs.writeFileSync(path.join(dir, 'resources.pak'), 'tampered contents of same len'.slice(0, 'synthetic resources.pak'.length));
  fs.writeFileSync(path.join(dir, 'extra.dll'), 'x');
  fs.rmSync(path.join(dir, 'locales/en-US.pak'));
  const r = verifyArtifact(dir, m);
  assert.ok(r.errors.includes('SHA-256 changed: resources.pak'), r.errors.join('; '));
  assert.ok(r.errors.includes('File not in manifest: extra.dll'));
  assert.ok(r.errors.includes('Manifest file missing from archive: locales/en-US.pak'));
});

test('unsafe manifest paths and a non-experimental label are refused', () => {
  const dir = archive();
  const m = buildManifest(dir, inputs);
  m.files.push({ name: '../outside.dll', bytes: 1, sha256: 'e'.repeat(64) });
  m.experimental = false;
  const r = verifyArtifact(dir, m);
  assert.ok(r.errors.includes('Unsafe path in manifest: ../outside.dll'));
  assert.ok(r.errors.includes('The manifest must be labelled experimental.'));
  for (const bad of ['../a', '/a', 'C:/a', 'a\\b', 'a//b', './a', '']) assert.equal(safeRelative(bad), false, bad);
  assert.equal(safeRelative('locales/en-US.pak'), true);
});

test('manifest inputs are required', () => {
  const dir = archive();
  assert.throws(() => buildManifest(dir, { ...inputs, patchSha256: undefined }), /patchSha256/);
});
