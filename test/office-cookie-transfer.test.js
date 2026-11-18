import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encryptCookies,decryptCookies} from '../server/office/cookie-transfer.js';
const cookie={name:'test',value:'disposable',domain:'example.test',path:'/',secure:true,httpOnly:false,sameSite:'Lax',expires:2000000000};
const options={profileId:'one',engine:'chromium',passphrase:'sensitive-cookie-passphrase',confirmSensitive:true};
test('cookie encryption authenticates values and requires explicit cross-profile authorization',()=>{
 const bytes=encryptCookies({...options,cookies:[cookie]});assert.equal(bytes.includes(Buffer.from('disposable')),false);
 assert.equal(decryptCookies({...options,bytes,confirm:true})[0].value,'disposable');
 assert.throws(()=>decryptCookies({...options,bytes,confirm:true,profileId:'another'}),/confirmation/);
 assert.equal(decryptCookies({...options,bytes,confirm:true,profileId:'another',confirmTransfer:true}).length,1);
 const bad=Buffer.from(bytes);bad[bad.length-1]^=1;assert.throws(()=>decryptCookies({...options,bytes:bad,confirm:true}));
 assert.throws(()=>encryptCookies({...options,cookies:[{...cookie,valueState:'unavailable'}]}));
 assert.throws(()=>encryptCookies({...options,cookies:[cookie],confirmSensitive:false}));
});
