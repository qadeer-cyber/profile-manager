// Fail-closed source and binary provenance gate for the genuine Azwah native browser.
// A stock Chromium or Electron executable is NOT accepted as a substitute.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, '..');
const pin = JSON.parse(fs.readFileSync(path.join(repo, 'native-chromium/upstream.json'), 'utf8'));

function reject(message) { throw new Error('AZWAH_NATIVE_RELEASE_BLOCKED: ' + message); }
function assertRegular(name) {
  const stat = fs.lstatSync(name, {throwIfNoEntry: false});
  if (!stat?.isFile() || stat.isSymbolicLink()) reject('missing or unsafe regular file: ' + name);
  return stat;
}
function sha256(name) { return crypto.createHash('sha256').update(fs.readFileSync(name)).digest('hex'); }
function assertPe64(name) {
  const buffer = Buffer.alloc(512);
  const fd = fs.openSync(name, 'r');
  try {
    const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (count < 128 || buffer.toString('ascii', 0, 2) !== 'MZ') reject('not a Windows executable: ' + name);
    const offset = buffer.readUInt32LE(0x3c);
    if (offset > 450 || offset + 26 > count || buffer.toString('ascii', offset, offset + 4) !== 'PE\0\0' ||
      buffer.readUInt16LE(offset + 4) !== 0x8664 || buffer.readUInt16LE(offset + 24) !== 0x20b) {
      reject('not a Windows x64 PE32+ binary: ' + name);
    }
  } finally { fs.closeSync(fd); }
}
export function qualifyNativeReleaseStage(stage, {repository = repo} = {}) {
  if (!stage || !path.isAbsolute(stage)) reject('a prebuilt absolute native runtime directory is required');
  const stageStat = fs.lstatSync(stage, {throwIfNoEntry: false});
  if (!stageStat?.isDirectory() || stageStat.isSymbolicLink()) reject('runtime directory is unavailable or is a link');
  const manifestPath = path.join(stage, 'BASELINE-MANIFEST.json');
  assertRegular(manifestPath);
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch { reject('native build manifest is unreadable'); }
  const referencePin = JSON.parse(fs.readFileSync(path.join(repository, 'native-chromium/upstream.json'), 'utf8'));
  const patchFile = path.join(repository, 'native-chromium/windows-source.patch');
  const expectedPatch = sha256(patchFile);
  if (manifest.kind !== 'azwah-native-source-development' ||
      manifest.chromiumCommit !== referencePin.revision ||
      manifest.depotToolsCommit !== '96a7c1418eedaa6bea333a8941e8a0078681b4d0' ||
      String(manifest.sourcePatchSha256 || '').toLowerCase() !== expectedPatch) {
    reject('native Chromium revision, exact Azwah source patch or pinned toolchain provenance differs');
  }
  if (!Array.isArray(manifest.files)) reject('native manifest has no verified file list');
  const verified = [];
  for (const name of ['chrome.exe', 'chrome.dll']) {
    const matches = manifest.files.filter(f => f?.name === name);
    if (matches.length !== 1 || !/^[a-f0-9]{64}$/i.test(matches[0].sha256 || '')) reject('invalid or duplicate binary manifest record: ' + name);
    const file = path.join(stage, name);
    const stat = assertRegular(file);
    if (stat.size !== matches[0].bytes || sha256(file) !== matches[0].sha256.toLowerCase()) {
      reject('native compiled binary size or SHA-256 does not match: ' + name);
    }
    assertPe64(file);
    verified.push({name, bytes: stat.size, sha256: matches[0].sha256.toLowerCase()});
  }
  for (const name of ['icudtl.dat', 'resources.pak']) assertRegular(path.join(stage, name));
  const locales = path.join(stage, 'locales');
  const localeStat = fs.lstatSync(locales, {throwIfNoEntry: false});
  if (!localeStat?.isDirectory() || localeStat.isSymbolicLink() ||
      !fs.readdirSync(locales).some(name => name.endsWith('.pak'))) reject('native Chromium locale resources are missing');
  return {chromiumCommit: manifest.chromiumCommit, depotToolsCommit: manifest.depotToolsCommit,
    sourcePatchSha256: expectedPatch, files: verified, stage, kind: manifest.kind};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = qualifyNativeReleaseStage(process.argv[2]);
  console.log(JSON.stringify({...report, status: 'native-binaries-integrity-pass; windows-launch-not-yet-tested'}, null, 2));
}
