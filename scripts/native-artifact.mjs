// Provenance manifest and verifier for the experimental AZWAH native Chromium archive.
//
// buildManifest() records every file (relative path, bytes, SHA-256) plus the source pins, toolchain, CI run and
// smoke result. verifyArtifact() re-reads a directory against a manifest and fails closed: missing runtime files,
// changed or extra files, unsafe paths, a non-experimental label or a missing chrome.exe hash are all errors.
// It cannot prove a browser works; only the Windows smoke test recorded in the manifest does that.
//
//   node scripts/native-artifact.mjs manifest <dir> <inputs.json> > AZWAH-NATIVE-MANIFEST.json
//   node scripts/native-artifact.mjs verify <dir> <AZWAH-NATIVE-MANIFEST.json>
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Files a Windows Chromium build (is_component_build = false) needs to start. Confirm against the first real
// build before relying on this list for anything but refusing obviously incomplete archives.
export const REQUIRED_FILES = Object.freeze([
  'chrome.exe', 'chrome.dll', 'chrome_elf.dll', 'icudtl.dat', 'resources.pak',
  'chrome_100_percent.pak', 'v8_context_snapshot.bin', 'locales/en-US.pak',
]);
export const SCHEMA = 'azwah-native-manifest/1';

const sha256File = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function walk(root, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Symbolic link in archive: ${child}`);
    if (entry.isDirectory()) out.push(...walk(root, child));
    else if (entry.isFile()) out.push(child);
  }
  return out;
}
export function safeRelative(p) {
  return typeof p === 'string' && p.length > 0 && !p.includes('\\') && !p.startsWith('/') && !/^[A-Za-z]:/.test(p) &&
    !p.split('/').some(part => part === '..' || part === '.' || part === '');
}

export function buildManifest(dir, inputs) {
  const required = ['azwahCommit', 'chromiumRevision', 'chromiumVersion', 'patchSha256', 'gnArgsSha256', 'toolchain', 'runId', 'stage'];
  for (const key of required) if (!inputs?.[key]) throw new Error(`Missing manifest input: ${key}`);
  const files = walk(dir).filter(f => f !== 'AZWAH-NATIVE-MANIFEST.json').sort()
    .map(name => ({ name, bytes: fs.statSync(path.join(dir, name)).size, sha256: sha256File(path.join(dir, name)) }));
  const chrome = files.find(f => f.name === 'chrome.exe');
  return {
    schema: SCHEMA,
    experimental: true,
    azwahCommit: inputs.azwahCommit,
    chromium: { revision: inputs.chromiumRevision, version: inputs.chromiumVersion },
    patchSha256: inputs.patchSha256,
    gnArgsSha256: inputs.gnArgsSha256,
    toolchain: inputs.toolchain,
    ci: { runId: String(inputs.runId), stage: String(inputs.stage), runner: inputs.runner ?? null },
    builtAt: inputs.builtAt ?? new Date().toISOString(),
    chromeExeSha256: chrome ? chrome.sha256 : null,
    fileCount: files.length,
    totalBytes: files.reduce((n, f) => n + f.bytes, 0),
    files,
    smoke: inputs.smoke ?? { result: 'not-run' },
  };
}

export function verifyArtifact(dir, manifest) {
  const errors = [];
  if (manifest?.schema !== SCHEMA) errors.push(`Unknown manifest schema: ${manifest?.schema}`);
  if (manifest?.experimental !== true) errors.push('The manifest must be labelled experimental.');
  for (const key of ['azwahCommit', 'patchSha256', 'gnArgsSha256', 'chromeExeSha256']) if (!manifest?.[key]) errors.push(`Manifest field missing: ${key}`);
  if (!manifest?.chromium?.revision || !manifest?.chromium?.version) errors.push('Manifest field missing: chromium revision/version');
  const listed = new Map();
  for (const f of manifest?.files || []) {
    if (!safeRelative(f.name)) { errors.push(`Unsafe path in manifest: ${f.name}`); continue; }
    listed.set(f.name, f);
  }
  let present = [];
  try { present = walk(dir).filter(f => f !== 'AZWAH-NATIVE-MANIFEST.json'); } catch (error) { errors.push(error.message); }
  for (const name of REQUIRED_FILES) {
    if (!present.includes(name)) errors.push(`Required runtime file missing: ${name}`);
  }
  for (const name of present) if (!listed.has(name)) errors.push(`File not in manifest: ${name}`);
  for (const [name, f] of listed) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) { errors.push(`Manifest file missing from archive: ${name}`); continue; }
    if (fs.statSync(file).size !== f.bytes) errors.push(`Size changed: ${name}`);
    else if (sha256File(file) !== f.sha256) errors.push(`SHA-256 changed: ${name}`);
  }
  if (manifest?.chromeExeSha256 && listed.get('chrome.exe')?.sha256 !== manifest.chromeExeSha256) errors.push('chrome.exe hash does not match its file entry.');
  if (manifest?.fileCount !== listed.size) errors.push('fileCount does not match the file list.');
  return { ok: errors.length === 0, errors, smoke: manifest?.smoke?.result ?? 'not-run' };
}

const isMain = process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href;
if (isMain) {
  const [cmd, dir, json] = process.argv.slice(2);
  if (cmd === 'manifest') console.log(JSON.stringify(buildManifest(dir, JSON.parse(fs.readFileSync(json, 'utf8'))), null, 2));
  else if (cmd === 'verify') {
    const r = verifyArtifact(dir, JSON.parse(fs.readFileSync(json, 'utf8')));
    console.log('NATIVE_ARTIFACT ' + JSON.stringify(r));
    process.exit(r.ok ? 0 : 1);
  } else { console.error('usage: manifest <dir> <inputs.json> | verify <dir> <manifest.json>'); process.exit(2); }
}
