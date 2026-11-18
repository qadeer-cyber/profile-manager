// Assemble snapshots in the disposable CI checkout. Never merge or update refs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = process.cwd();
const baseline = 'd7a000eeadd4f4645a608a1e0cc2b8ad154a75d9';
const sources = [
  ['backend', 'd41eb1c6c5d65fa2f2a3ba861c1a8c509ac50838'],
  ['ui', '14beab8ea27905c6a8fdd387babe6de83ad41c51'],
];
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
const m1tests = new Set(git(root, 'ls-tree', '-r', '--name-only', baseline, 'test').split('\n'));
const qa = git(root, 'rev-parse', 'HEAD');
const owned = new Set();
const manifest = { qa, baseline, sources: [], contracts: {}, platform: process.platform, node: process.version };
for (const [name, sha] of sources) {
  const dir = path.join(root, '.m2', name);
  if (git(dir, 'rev-parse', 'HEAD') !== sha) throw new Error('Source checkpoint changed');
  git(dir, 'merge-base', '--is-ancestor', baseline, sha);
  const files = git(dir, 'diff', '--name-only', baseline, sha).split('\n').filter(Boolean);
  for (const file of files) {
    if (file.startsWith('/') || file.split('/').includes('..') || owned.has(file) || m1tests.has(file)) throw new Error('Unsafe path or ownership collision');
    owned.add(file);
    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(dir, file), destination);
  }
  manifest.sources.push({ name, sha, files });
}
const workflow = '.github/workflows/windows-native-validation.yml';
if (owned.has(workflow)) throw new Error('Unsafe path or ownership collision');
fs.writeFileSync(path.join(root, workflow), execFileSync('git', ['-C', root, 'show', `${baseline}:${workflow}`]));
manifest.restoredFromBaseline = baseline;
const contractLf = (file) => fs.readFileSync(file).toString('utf8').replace(/\r\n/g, '\n');
for (const [name, expected] of [
  ['DiagnosticsV1.original.md', 'cd1ce49f379566efa0fa65ed81f5402f21259191cbdb6aa6088eb8413b8059d8'],
  ['DiagnosticsV1.process-command-line.md', 'e80ce2d513e610a18c703b775fb0fd5520e3eb1ca5dce6f4ad43a1eecf08bdf4'],
]) {
  const actual = crypto.createHash('sha256').update(contractLf(path.join(root, 'docs/handoff/m2/contracts', name))).digest('hex');
  if (actual !== expected) throw new Error('Contract checksum mismatch');
  manifest.contracts[name] = actual;
}
fs.mkdirSync('.m2/evidence', { recursive: true });
fs.writeFileSync('.m2/evidence/source-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
