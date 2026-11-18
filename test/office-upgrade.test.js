import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {officeUserDataPath,adoptLegacyData,LEGACY_APP_ID} from '../electron/office-upgrade.js';
test('rebranding adopts the legacy directory without rewriting any profile/secret/backup bytes',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'azwah-upgrade-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const dir=officeUserDataPath(root);assert.equal(dir,path.join(root,'profile-manager'));assert.equal(LEGACY_APP_ID,'local.profilemanager.app');
 const files=['data/profiles.db','data/profiles/one/Default/Cookies','data/profiles/one/gecko/cookies.sqlite','data/secret.key','data/settings.json','data/proxy-secret','backups/encrypted.pmp'];const hashes=new Map();
 for(const name of files){const file=path.join(dir,name);fs.mkdirSync(path.dirname(file),{recursive:true});const bytes=crypto.randomBytes(100);fs.writeFileSync(file,bytes);hashes.set(name,crypto.createHash('sha256').update(bytes).digest('hex'));}
 const first=adoptLegacyData(dir);assert.equal(first.movedFiles,0);assert.deepEqual(adoptLegacyData(dir),first);
 for(const [name,hash]of hashes)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,name))).digest('hex'),hash);
 assert.equal(officeUserDataPath(root,path.join(root,'isolated')),path.join(root,'isolated'));
});
