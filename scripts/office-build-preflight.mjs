// Refuse employee packaging without an explicit public verification root.
import fs from 'node:fs';
import crypto from 'node:crypto';
const file=new URL('../server/office/issuer-public.pem',import.meta.url);
try {
 const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)throw Error('Invalid issuer public-key file');
 const value=fs.readFileSync(file,'utf8').trim();
 if(!value.startsWith('-----BEGIN PUBLIC KEY-----')||!value.endsWith('-----END PUBLIC KEY-----')||value.includes('PRIVATE KEY'))throw Error('Employee build must contain only a public verification key');
 if(crypto.createPublicKey(value).asymmetricKeyType!=='ed25519')throw Error('Office activation requires an Ed25519 public key');
 console.log('Office verification root validated. Administrator vaults are excluded by the employee package file allowlist.');
} catch(error) {
 console.error('Office employee packaging blocked: '+error.message+'. Provision issuer-public.pem from the separate administrator utility.');process.exitCode=1;
}
