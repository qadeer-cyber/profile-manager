import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {verifyLicense,OFFICE_PRODUCT} from '../server/office/license.js';
import {issueLicense} from '../scripts/license-admin/issuer.mjs';
import {deviceIdentity} from '../server/office/device.js';
import {adminAction} from '../scripts/license-admin/admin.mjs';
const keys=crypto.generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const device=deviceIdentity(),now=Date.now();
const make=overrides=>issueLicense(keys.privateKey,{device,label:'Office desk',issuedAt:now,expiresAt:now+86400000,...overrides});
test('valid signed license activates offline on the actual host identity',()=>{
 const token=make();const result=verifyLicense(token,{publicKey:keys.publicKey,device,now});assert.equal(result.product,OFFICE_PRODUCT);assert.match(device,/^AZD1-[a-f0-9]{64}$/);assert.equal(deviceIdentity(),device);
});
for(const [name,overrides,options,code] of [
 ['expired',{issuedAt:now-20000,expiresAt:now-10000},{},'LICENSE_EXPIRED'],
 ['another device',{}, {device:'AZD1-'+'a'.repeat(64)},'LICENSE_DEVICE_MISMATCH'],
 ['future issue',{issuedAt:now+600000,expiresAt:now+900000},{},'LICENSE_NOT_YET_VALID'],
 ['revoked',{status:'revoked'},{},'LICENSE_REVOKED'],
 ['clock rollback',{}, {lastSeen:now+600000},'LICENSE_CLOCK_ROLLBACK'],
])test('reject '+name,()=>assert.throws(()=>verifyLicense(make(overrides),{publicKey:keys.publicKey,device,now,...options}),{code}));
test('modified payload and signatures from an employee key cannot activate',()=>{
 const token=make(),parts=token.split('.');const payload=JSON.parse(Buffer.from(parts[1],'base64url'));payload.label='Modified';parts[1]=Buffer.from(JSON.stringify(payload)).toString('base64url');
 assert.throws(()=>verifyLicense(parts.join('.'),{publicKey:keys.publicKey,device}),{code:'LICENSE_SIGNATURE_INVALID'});
 const employee=crypto.generateKeyPairSync('ed25519');const forged=issueLicense(employee.privateKey.export({type:'pkcs8',format:'pem'}),{device,label:'Employee',issuedAt:now,expiresAt:now+10000});
 assert.throws(()=>verifyLicense(forged,{publicKey:keys.publicKey,device}),{code:'LICENSE_SIGNATURE_INVALID'});
});
test('administrator vault authenticates, encrypts the private key, records issue/reissue audit and rejects overwrite',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'azwah-admin-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const vault=path.join(root,'admin.vault'),password='administrator-long-passphrase';
 const init=adminAction({command:'init',vault,password});assert.match(init.publicKey,/BEGIN PUBLIC KEY/);assert.doesNotMatch(fs.readFileSync(vault,'utf8'),/PRIVATE KEY|Office desk/);
 assert.throws(()=>adminAction({command:'init',vault,password}));assert.throws(()=>adminAction({command:'list',vault,password:'wrong-but-long-enough'}));
 const one=adminAction({command:'issue',vault,password,device,label:'Office desk',expiresAt:Date.now()+100000});assert.equal(verifyLicense(one.token,{publicKey:init.publicKey,device}).label,'Office desk');
 const replacement='AZD1-'+'b'.repeat(64),two=adminAction({command:'reissue',vault,password,device:replacement,label:'Replacement desk',expiresAt:Date.now()+100000,licenseId:one.license.id});
 assert.equal(verifyLicense(two.token,{publicKey:init.publicKey,device:replacement}).device,replacement);
 const list=adminAction({command:'list',vault,password});assert.equal(list.records.length,2);assert.equal(list.records[0].replacedBy,two.license.id);assert.deepEqual(list.audit.map(r=>r.action),['init','issue','reissue']);
});

test('separate administrator CLI exports public roots and license files without exposing its private key',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'azwah-admin-cli-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const vault=path.join(root,'admin.vault'),publicFile=path.join(root,'public.pem'),licenseFile=path.join(root,'device.azwah'),env={...process.env,AZWAH_ADMIN_PASSPHRASE:'administrator-cli-disposable-passphrase'};
 const call=args=>JSON.parse(execFileSync(process.execPath,['scripts/license-admin/admin.mjs',...args],{encoding:'utf8',env,timeout:10000}));
 assert.equal(call(['init',vault,'--output',publicFile]).exported,true);
 assert.equal(call(['issue',vault,device,String(Date.now()+60000),'Office CLI','--output',licenseFile]).exported,true);
 const token=fs.readFileSync(licenseFile,'utf8');assert.equal(verifyLicense(token,{publicKey:fs.readFileSync(publicFile,'utf8'),device}).label,'Office CLI');
 assert.doesNotMatch(fs.readFileSync(vault,'utf8'),/BEGIN PRIVATE KEY/);
});

test('employee payload excludes administrative signing code and refuses packaging without an organization public root',()=>{
 const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 assert.deepEqual(pkg.build.files.filter(pattern=>!pattern.startsWith('!')),['electron/**','server/**','web/dist/**','package.json']);
 const verifier=fs.readFileSync(new URL('../server/office/license.js',import.meta.url),'utf8');assert.doesNotMatch(verifier,/createPrivateKey|crypto\.sign|generateKeyPair/);
 assert.equal(fs.existsSync(new URL('../server/office/issuer-public.pem',import.meta.url)),false,'A disposable CI root must never be installed into the employee source');
 let result;try{execFileSync(process.execPath,['scripts/office-build-preflight.mjs'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch(error){result=error;}
 assert.equal(result?.status,1);assert.match(result.stderr,/Office employee packaging blocked/);
});
