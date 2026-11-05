import crypto from 'node:crypto';
export const OFFICE_PRODUCT = 'azwah-multi-browser-office';
const fail = (message, code) => Object.assign(Error(message), { code, status: 400 });
export function validateLicenseClaims(claims) {
  if (!claims || claims.version !== 1 || claims.product !== OFFICE_PRODUCT || !/^[0-9a-f-]{36}$/i.test(claims.id || '') || !/^AZD1-[0-9a-f]{64}$/.test(claims.device || '') || typeof claims.label !== 'string' || claims.label.length > 120 || !['active','revoked'].includes(claims.status)) throw fail('Invalid office license claims', 'LICENSE_INVALID');
  if (!Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt) || claims.issuedAt < 0 || claims.expiresAt <= claims.issuedAt) throw fail('Invalid license dates', 'LICENSE_INVALID');
  return claims;
}
export function verifyLicense(token, { publicKey, device, now = Date.now(), lastSeen = 0 } = {}) {
  if (typeof token !== 'string' || token.length > 8192 || !/^AZW1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw fail('Invalid activation token', 'LICENSE_INVALID');
  const [, body, signature] = token.split('.');
  const key = crypto.createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519' || Buffer.from(signature,'base64url').length !== 64 || !crypto.verify(null, Buffer.from('AZW1.' + body), key, Buffer.from(signature,'base64url'))) throw fail('License signature is invalid', 'LICENSE_SIGNATURE_INVALID');
  let claims;
  try { claims = validateLicenseClaims(JSON.parse(Buffer.from(body,'base64url').toString('utf8'))); } catch { throw fail('Invalid license payload', 'LICENSE_INVALID'); }
  if (claims.device !== device) throw fail('License belongs to a different device. Request administrator reissue after a machine change.', 'LICENSE_DEVICE_MISMATCH');
  if (now < lastSeen - 300000) throw fail('Clock moved backwards. Correct the clock before using licensed features.', 'LICENSE_CLOCK_ROLLBACK');
  if (now < claims.issuedAt - 300000) throw fail('License issue date is in the future', 'LICENSE_NOT_YET_VALID');
  if (claims.status !== 'active') throw fail('License is revoked', 'LICENSE_REVOKED');
  if (now >= claims.expiresAt) throw fail('License expired. Data and backup export remain available.', 'LICENSE_EXPIRED');
  return claims;
}
