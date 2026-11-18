import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import {decryptLegacyV10} from '../electron/windows-owner-secrets.js';

test('legacy Windows v10 decoding authenticates the ciphertext before conversion', () => {
  const key = crypto.randomBytes(32);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm',key,nonce);
  const fixture = 'synthetic-proxy-password';
  const encrypted = Buffer.concat([cipher.update(fixture,'utf8'),cipher.final()]);
  const envelope = Buffer.concat([Buffer.from('v10'),nonce,encrypted,cipher.getAuthTag()]);
  assert.equal(decryptLegacyV10(envelope,key).toString(),fixture);
  envelope[envelope.length-1] ^= 1;
  assert.throws(() => decryptLegacyV10(envelope,key));
  assert.throws(() => decryptLegacyV10(Buffer.from('v20unsupported'),key),/Unsupported/);
});
