// Secret storage for proxy passwords.
// Preferred: an OS-backed cipher registered by the host (Electron safeStorage) -> "ss:v1:<base64>".
// Fallback: AES-256-GCM with a key from PM_SECRET or <data>/secret.key -> "enc:v1:iv:tag:ct".
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './db.js';

let KEY;
function key() {
  if (KEY) return KEY;
  if (process.env.PM_SECRET) return (KEY = crypto.createHash('sha256').update(process.env.PM_SECRET).digest());
  const f = path.join(DATA_DIR, 'secret.key');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  return (KEY = Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'base64'));
}

let strict = false;
export class UnprefixedSecretError extends Error { constructor() { super('Stored secret is not encrypted (missing enc:/ss: prefix); re-enter it'); this.code = 'UNPREFIXED_SECRET'; } }
// Called after the startup re-encryption migration.
export function setStrictPrefixes(v) { strict = !!v; }
let external = null; // { name, encrypt(str)->Buffer, decrypt(Buffer)->str }
let warning = null;
export function setExternalCipher(c) { external = c; }
export function setEncryptionWarning(w) { warning = w; }
export const encryptionStatus = () => ({ backend: external ? external.name : 'aes-256-gcm-keyfile', warning });

function aesEncrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return `enc:v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}
export function encrypt(text) {
  if (!text) return '';
  if (external) return 'ss:v1:' + external.encrypt(text).toString('base64');
  return aesEncrypt(text);
}
export function decrypt(s) {
  if (!s) return '';
  if (s.startsWith('ss:v1:')) {
    if (!external) throw new Error('This secret was encrypted with OS secure storage, which is not available in this process');
    return external.decrypt(Buffer.from(s.slice(6), 'base64'));
  }
  if (!s.startsWith('enc:v1:')) {
    // Legacy plaintext is only accepted until the startup migration has re-encrypted everything.
    if (strict) { console.warn('[secrets] rejected a stored secret without an enc:/ss: prefix (value not logged)'); throw new UnprefixedSecretError(); }
    return s;
  }
  const [, , iv, tag, ct] = s.split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}
// true if the stored value should be re-encrypted with the current preferred backend
export const needsReencrypt = s => !!s && (external ? !s.startsWith('ss:v1:') : !s.startsWith('enc:v1:'));

export function loadApiToken() {
  if (process.env.PM_API_TOKEN) return process.env.PM_API_TOKEN;
  const f = path.join(DATA_DIR, 'api-token');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(24).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
}
