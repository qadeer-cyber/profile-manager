import { encryptBackup, decryptBackup, isEncryptedBackup } from '../backup-crypto.js';
import { validateCookie } from '../cookies.js';
const fail=message=>Object.assign(Error(message),{status:400,code:'INVALID_COOKIE_TRANSFER'});
export function encryptCookies({profileId,engine,cookies,passphrase,confirmSensitive}) {
  if(confirmSensitive!==true)throw fail('Explicit sensitive-cookie export confirmation is required');
  if(!Array.isArray(cookies)||cookies.length>500||cookies.some(c=>c.valueState&&c.valueState!=='available'))throw fail('Cookies unavailable or oversized. Use Cookie-Editor in the originating browser for OS-bound cookie data.');
  const body=Buffer.from(JSON.stringify({format:'azwah-cookie-transfer',version:1,profileId,engine,cookies}));
  if(body.length>256*1024)throw fail('Cookie transfer exceeds 256 KiB');
  return encryptBackup(body,passphrase);
}
export function decryptCookies({bytes,passphrase,profileId,engine,confirm,confirmTransfer}) {
  if(confirm!==true||!Buffer.isBuffer(bytes)||bytes.length>300*1024||!isEncryptedBackup(bytes))throw fail('Confirmed authenticated-encrypted cookie transfer required');
  const data=JSON.parse(decryptBackup(bytes,passphrase).toString('utf8'));
  if(data.format!=='azwah-cookie-transfer'||data.version!==1||data.engine!==engine||!Array.isArray(data.cookies)||data.cookies.length>500)throw fail('Incompatible cookie transfer');
  if(data.profileId!==profileId&&confirmTransfer!==true)throw fail('Import into another isolated profile requires explicit transfer confirmation');
  return data.cookies.map((cookie,index)=>validateCookie(cookie,index));
}
