// Separate Azwah License Admin utility. This directory is excluded from the employee package.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { issueLicense } from './issuer.mjs';
const derive = (password,salt) => crypto.scryptSync(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
function seal(data,password) {
  const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',derive(password,salt),iv);
  const body=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);
  return JSON.stringify({version:1,salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),body:body.toString('base64')});
}
export function open(file,password) {
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw Error('Unsafe admin vault');
  const value=JSON.parse(fs.readFileSync(file,'utf8'));if(value.version!==1)throw Error('Unsupported vault format');
  const decipher=crypto.createDecipheriv('aes-256-gcm',derive(password,Buffer.from(value.salt,'base64')),Buffer.from(value.iv,'base64'));decipher.setAuthTag(Buffer.from(value.tag,'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.body,'base64')),decipher.final()]).toString('utf8'));
}
export function save(file,data,password,create=false) {
  const tmp=file+'.'+crypto.randomUUID()+'.tmp';
  try {
    const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,seal(data,password));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    if(create)fs.linkSync(tmp,file);else fs.renameSync(tmp,file);
  } finally {fs.rmSync(tmp,{force:true});}
}
export function adminAction({command,vault,password,device,label='',expiresAt,licenseId}) {
  if(typeof password!=='string'||password.length<14)throw Error('Admin authentication requires a passphrase of at least 14 characters');
  if(command==='init') {
    const keys=crypto.generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
    save(vault,{...keys,records:[],audit:[{at:Date.now(),action:'init'}]},password,true);return {publicKey:keys.publicKey};
  }
  // Exclude concurrent administrators with a separate exclusive file lock.
  const lock=vault+'.lock',fd=fs.openSync(lock,'wx',0o600);
  try {
    const data=open(vault,password);
    if(command==='list')return {records:data.records,audit:data.audit};
    if(command==='export') {
      const record=data.records.find(row=>row.id===licenseId);if(!record)throw Error('License record not found');
      const token=issueLicense(data.privateKey,record);data.audit.push({at:Date.now(),action:'export',licenseId});save(vault,data,password);return {token,license:record};
    }
    if(!['issue','reissue'].includes(command))throw Error('Use init, issue, reissue, export or list');
    const old=command==='reissue'?data.records.find(r=>r.id===licenseId):null;
    if(command==='reissue'&&!old)throw Error('Previous license record not found');
    const issuedAt=Date.now(),token=issueLicense(data.privateKey,{device,label,issuedAt,expiresAt:Number(expiresAt)});
    const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
    if(old)old.replacedBy=claims.id;
    data.records.push({...claims});data.audit.push({at:issuedAt,action:command,licenseId:claims.id,replaces:old?.id||null});
    save(vault,data,password);return {token,license:claims,offlineRevocation:'Previously issued offline licenses remain usable until expiry unless replaced on that device.'};
  } finally {fs.closeSync(fd);fs.rmSync(lock,{force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [command,vault,device,expiresAt,label,licenseId]=process.argv.slice(2);
    if(!vault)throw Error('Azwah License Admin: init|list|issue|reissue <vault-file> [device-code expiry-epoch-ms label previous-license-id]. Set AZWAH_ADMIN_PASSPHRASE in the administrator process environment.');
    const result=adminAction({command,vault,password:process.env.AZWAH_ADMIN_PASSPHRASE,device,expiresAt,label,licenseId});
    const outputIndex=process.argv.indexOf('--output');
    if(outputIndex>=0) {
      const output=process.argv[outputIndex+1];if(!output)throw Error('--output requires a new destination file');
      fs.writeFileSync(output,result.token||result.publicKey,{flag:'wx',mode:0o600});
      console.log(JSON.stringify({exported:true,licenseId:result.license?.id||null}));
    } else console.log(JSON.stringify(result));
  } catch(error){console.error(JSON.stringify({error:error.message}));process.exitCode=1;}
}
