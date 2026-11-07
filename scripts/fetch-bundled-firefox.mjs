// Download the pinned official Firefox ESR installer, verify it, and stage an unmodified runtime.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {FIREFOX_RUNTIME} from './firefox-runtime-pin.mjs';

const root = path.resolve('build/bundled-firefox');
const runtime = path.join(root, 'firefox');
const marker = path.join(root, 'firefox-runtime.json');
if (fs.existsSync(path.join(runtime, 'firefox.exe')) && fs.existsSync(marker)) {
  const saved = JSON.parse(fs.readFileSync(marker, 'utf8'));
  if (saved.sha256 === FIREFOX_RUNTIME.sha256 && saved.version === FIREFOX_RUNTIME.version) {
    console.log('bundled Firefox already verified:', runtime);
    process.exit(0);
  }
}
const licensePath = path.resolve(FIREFOX_RUNTIME.licenseFile);
const licenseHash = crypto.createHash('sha256').update(fs.readFileSync(licensePath).toString('utf8').replace(/\r\n/g, '\n')).digest('hex');
if (licenseHash !== FIREFOX_RUNTIME.licenseSha256) throw new Error('Vendored MPL-2.0 text does not match the pinned hash');
fs.rmSync(root, {recursive: true, force: true});
fs.mkdirSync(root, {recursive: true});
const setup = path.join(root, FIREFOX_RUNTIME.artifact);
const response = await fetch(FIREFOX_RUNTIME.url);
if (!response.ok) throw new Error(`Firefox download failed: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
if (sha256 !== FIREFOX_RUNTIME.sha256) throw new Error(`Firefox installer hash mismatch: ${sha256}`);
fs.writeFileSync(setup, bytes);
const seven = process.platform === 'win32'
  ? (fs.existsSync('C:\\Program Files\\7-Zip\\7z.exe') ? 'C:\\Program Files\\7-Zip\\7z.exe' : '7z')
  : '7z';
const extracted = path.join(root, 'extracted');
const unpack = spawnSync(seven, ['x', '-y', `-o${extracted}`, setup], {encoding: 'utf8'});
const unpackLog = `${unpack.stdout || ''}\n${unpack.stderr || ''}`;
process.stdout.write(unpackLog);
if (unpack.status !== 0 || !unpackLog.includes('Everything is Ok')) throw new Error('7-Zip could not extract the official Firefox installer');
// 7-Zip reports "Checksum error" for the PE stub's optional-header checksum. The download is accepted only when the full-file SHA-256 matches Mozilla's published sum, and the inner archive still reports Everything is Ok.
const unexpected = unpackLog.split(/\r?\n/).filter(line => /error/i.test(line) && !/Checksum error/.test(line) && !/WARNING = Checksum error/.test(line));
if (unexpected.length) throw new Error(`7-Zip reported an extraction error after the SHA-256 check: ${unexpected[0]}`);
const core = path.join(extracted, 'core');
const required = ['firefox.exe', 'xul.dll', 'omni.ja', 'mozglue.dll', 'nss3.dll', 'application.ini', 'dependentlibs.list'];
for (const name of required) if (!fs.existsSync(path.join(core, name))) throw new Error(`Extracted Firefox runtime is missing ${name}`);
if (fs.statSync(path.join(core, 'xul.dll')).size < 50_000_000 || fs.statSync(path.join(core, 'omni.ja')).size < 10_000_000) throw new Error('Extracted Firefox runtime is incomplete');
const ini = fs.readFileSync(path.join(core, 'application.ini'), 'utf8');
if (!ini.includes('Name=Firefox') || !ini.includes('Version=140.17.0')) throw new Error('Extracted Firefox version does not match the pin');
fs.cpSync(core, runtime, {recursive: true});
fs.rmSync(extracted, {recursive: true, force: true});
fs.rmSync(setup, {force: true});
const record = {...FIREFOX_RUNTIME, extractedFrom: 'core/', unmodified: true};
fs.writeFileSync(marker, JSON.stringify(record, null, 2));
fs.copyFileSync(licensePath, path.join(root, 'MPL-2.0.txt'));
fs.writeFileSync(path.join(root, 'FIREFOX-REDISTRIBUTION.txt'), `Mozilla Firefox ${FIREFOX_RUNTIME.version} (${FIREFOX_RUNTIME.arch}, ${FIREFOX_RUNTIME.locale})

This directory is an unmodified extract of the official installer
"${FIREFOX_RUNTIME.artifact}".
SHA-256: ${FIREFOX_RUNTIME.sha256}
Download: ${decodeURIComponent(FIREFOX_RUNTIME.url)}

Source code for this version:
${FIREFOX_RUNTIME.source}
SHA-256: ${FIREFOX_RUNTIME.sourceSha256}

The runtime is licensed under the Mozilla Public License 2.0. The license text is MPL-2.0.txt.
${FIREFOX_RUNTIME.trademark}
Azwah does not modify firefox.exe and does not present this runtime as a stealth or anti-detect browser.
`);
console.log('staged', runtime);
