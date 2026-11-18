import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

export function decryptLegacyV10(ciphertext, key) {
  if (ciphertext.length < 31 || ciphertext.subarray(0, 3).toString('ascii') !== 'v10') {
    throw new Error('Unsupported legacy Windows credential format');
  }
  const cipher = crypto.createDecipheriv('aes-256-gcm', key, ciphertext.subarray(3, 15));
  cipher.setAuthTag(ciphertext.subarray(-16));
  return Buffer.concat([cipher.update(ciphertext.subarray(15, -16)), cipher.final()]);
}

function unwrapOwnerKey(ownerDir) {
  const file = path.join(ownerDir, 'Local State');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error('Invalid Owner encryption metadata');
  const value = JSON.parse(fs.readFileSync(file, 'utf8')).os_crypt?.encrypted_key;
  if (typeof value !== 'string' || value.length > 16384) throw new Error('Invalid Owner encryption key');
  const wrapped = Buffer.from(value, 'base64');
  if (wrapped.length <= 5 || wrapped.subarray(0, 5).toString('ascii') !== 'DPAPI' ||
      wrapped.toString('base64') !== value) throw new Error('Unsupported Owner encryption key');
  const executable = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; " +
    "$blob=[Convert]::FromBase64String([Console]::In.ReadToEnd()); " +
    "$key=[Security.Cryptography.ProtectedData]::Unprotect($blob,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); " +
    "try { [Console]::Out.Write([Convert]::ToBase64String($key)) } finally { [Array]::Clear($key,0,$key.Length) }";
  const output = execFileSync(executable, ['-NoProfile','-NonInteractive','-Command',command], {
    input: wrapped.subarray(5).toString('base64'), stdio:['pipe','pipe','ignore'], windowsHide:true, timeout:15000, maxBuffer:4096,
  });
  try {
    const key = Buffer.from(output.toString('ascii').trim(), 'base64');
    if (key.length !== 32) { key.fill(0); throw new Error('Invalid unwrapped Owner key'); }
    return key;
  } finally { output.fill(0); }
}

export function rewrapWindowsOwnerSecrets({source, candidate, encrypt}) {
  const db = new DatabaseSync(path.join(candidate, 'profiles.db'));
  let key;
  const rewrap = value => {
    if (typeof value !== 'string' || !value.startsWith('ss:v1:')) return value;
    key ??= unwrapOwnerKey(path.dirname(source));
    const plaintext = decryptLegacyV10(Buffer.from(value.slice(6), 'base64'), key);
    try {
      const sealed = encrypt(plaintext.toString('utf8'));
      if (!Buffer.isBuffer(sealed) || !sealed.length) throw new Error('Destination encryption unavailable');
      return 'ss:v1:' + sealed.toString('base64');
    } finally { plaintext.fill(0); }
  };
  try {
    db.exec('PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE;');
    const proxies = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='proxies'").get();
    if (proxies) {
      const update = db.prepare('UPDATE proxies SET password=? WHERE id=?');
      for (const row of db.prepare("SELECT id,password FROM proxies WHERE substr(password,1,6)='ss:v1:'").all()) {
        update.run(rewrap(row.password), row.id);
      }
    }
    if (db.prepare('PRAGMA table_info(profiles)').all().some(column => column.name === 'proxy')) {
      const update = db.prepare('UPDATE profiles SET proxy=? WHERE id=?');
      for (const row of db.prepare('SELECT id,proxy FROM profiles WHERE proxy IS NOT NULL').all()) {
        const proxy = JSON.parse(row.proxy);
        if (typeof proxy?.password !== 'string' || !proxy.password.startsWith('ss:v1:')) continue;
        proxy.password = rewrap(proxy.password);
        update.run(JSON.stringify(proxy), row.id);
      }
    }
    db.exec('COMMIT');
  } catch {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw new Error('Legacy Owner credential conversion failed. Original Owner data was preserved.');
  } finally {
    key?.fill(0);
    db.close();
  }
}
