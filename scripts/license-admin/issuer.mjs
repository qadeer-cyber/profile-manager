import crypto from 'node:crypto';
import {validateLicenseClaims,OFFICE_PRODUCT} from '../../server/office/license.js';
const fail=(message,code)=>Object.assign(Error(message),{code,status:400});
export function issueLicense(privateKey, input) {
  const claims = validateLicenseClaims({ version: 1, product: OFFICE_PRODUCT, id: crypto.randomUUID(), status: 'active', ...input });
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const key = crypto.createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519') throw fail('An Ed25519 signing key is required', 'LICENSE_KEY_INVALID');
  return `AZW1.${body}.${crypto.sign(null, Buffer.from('AZW1.' + body), key).toString('base64url')}`;
}
