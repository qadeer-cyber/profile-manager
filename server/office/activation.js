import { isOwnerEdition, isUltimateEdition, isProvisionedOffice } from './edition.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from '../db.js';
import { encrypt, decrypt, encryptionStatus } from '../secrets.js';
import { verifyLicense } from './license.js';
import { deviceIdentity } from './device.js';
const file = path.join(DATA_DIR, 'azwah-activation.json');
let device;
const identity = () => device ||= deviceIdentity();
function organizationTrust() {
  const source=path.join(process.resourcesPath,'office-trust.json');
  const stat=fs.lstatSync(source);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)throw Error('Invalid organization trust root.');
  const trust=JSON.parse(fs.readFileSync(source,'utf8'));
  if(typeof trust.organization!=='string'||!trust.organization.trim()||crypto.createPublicKey(trust.publicKey).asymmetricKeyType!=='ed25519'||!trust.publicKey.startsWith('-----BEGIN PUBLIC KEY-----'))throw Error('Invalid organization trust root.');
  return trust;
}
function publicKey() {
  if(isProvisionedOffice)return organizationTrust().publicKey;
  const source = process.env.AZWAH_OFFICE_PACKAGED === '1' ? fileURLToPath(new URL('./issuer-public.pem',import.meta.url)) : process.env.AZWAH_ISSUER_PUBLIC_KEY_FILE || fileURLToPath(new URL('./issuer-public.pem',import.meta.url));
  const stat = fs.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw Error('Invalid issuer public key');
  const key = fs.readFileSync(source,'utf8');
  if (!key.trim().startsWith('-----BEGIN PUBLIC KEY-----') || !key.trim().endsWith('-----END PUBLIC KEY-----') || key.includes('PRIVATE KEY')) throw Error('Employee trust store accepts a verification public key only');
  if (crypto.createPublicKey(key).asymmetricKeyType !== 'ed25519') throw Error('Issuer key must be Ed25519');
  return key;
}
function read() {
  if (!fs.existsSync(file)) return null;
  const stat=fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768) throw Error('Activation storage needs administrator review');
  const record=JSON.parse(decrypt(fs.readFileSync(file,'utf8')));
  if(!Number.isSafeInteger(record.lastSeen)||record.lastSeen<0||typeof record.token!=='string')throw Error('Invalid activation state');
  return record;
}
function write(value) {
  const temp=file+'.'+crypto.randomUUID()+'.tmp';
  try {
    const fd=fs.openSync(temp,'wx',0o600);
    try { fs.writeFileSync(fd,encrypt(JSON.stringify(value))); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp,file);
  } finally { fs.rmSync(temp,{force:true}); }
}
export function activationStatus() {
  if(isOwnerEdition||isUltimateEdition)return {enforced:false,active:true,edition:isUltimateEdition?'ultimate':'owner-personal',code:isUltimateEdition?'ULTIMATE_EDITION':'OWNER_PERSONAL_EDITION',licensePolicy:isUltimateEdition?'Browser management is available without employee activation. License issuance stays in the locked administrator vault.':'Personal evaluation: all implemented local browser-management features enabled without employee activation. No administrator license issuance.'};
  const enforced=process.env.AZWAH_OFFICE_ENFORCE === '1';
  try {
    const deviceCode=identity(), organization=isProvisionedOffice?organizationTrust().organization:undefined, record=read();
    if (!record) return {enforced,active:false,deviceCode,organization,code:'ACTIVATION_REQUIRED'};
    const now=Date.now();
    const claims=verifyLicense(record.token,{publicKey:publicKey(),device:deviceCode,now,lastSeen:record.lastSeen});
    if (now-record.lastSeen>=60000) write({...record,lastSeen:now});
    return {enforced,active:true,deviceCode,organization,label:claims.label,expiresAt:claims.expiresAt,licenseId:claims.id,offline:true};
  } catch (error) { return {enforced,active:false,deviceCode:device||null,code:error.code||'ACTIVATION_STORAGE_UNAVAILABLE',error:error.message}; }
}
export function activateOffice(token) {
  if(isOwnerEdition||isUltimateEdition)throw Object.assign(Error('This edition does not use employee licenses. Office activation remains available only in an administrator-provisioned Office build.'),{code:'OWNER_NO_ACTIVATION',status:403});
  if (process.env.AZWAH_OFFICE_PACKAGED === '1' && encryptionStatus().backend === 'aes-256-gcm-keyfile') throw Object.assign(Error('OS-backed activation storage is unavailable. Restore Windows secure storage before activation.'), { code: 'ACTIVATION_OS_STORAGE_REQUIRED', status: 503 });
  const prior=read(), now=Date.now();
  verifyLicense(token,{publicKey:publicKey(),device:identity(),now,lastSeen:prior?.lastSeen||0});
  write({token,lastSeen:Math.max(now,prior?.lastSeen||0)});
  return activationStatus();
}
export function officeGate(req,res,next) {
  if(isOwnerEdition||isUltimateEdition)return next();
  if (process.env.AZWAH_OFFICE_ENFORCE !== '1') return next();
  const safe = ['GET','HEAD'].includes(req.method) || req.path.startsWith('/activation') || /\/(?:stop|backup\/export(?:-stream)?|cookies\/export-encrypted)$/.test(req.path) || req.path.startsWith('/diagnostics/recovery');
  if (safe) return next();
  const state=activationStatus();
  if (state.active) return next();
  res.status(402).json({error:state.error||'Activate Azwah Multi Browser to use licensed features. Existing data and backup exports remain accessible.',code:state.code});
}
