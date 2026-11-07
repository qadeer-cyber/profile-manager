import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {_electron} from 'playwright';
const {DatabaseSync} = await import('node:sqlite');
assert.equal(process.env.CI,'true');
assert.equal(process.platform,'win32');
const root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(),'azwah-secret-probe-'));
const appData=process.env.APPDATA;
const ownerData=path.join(appData,'azwah-multi-browser-owner');
const ultimateData=path.join(root,'ultimate-context');
const staged=path.join(root,'staged-ultimate');
assert.ok(!fs.existsSync(ownerData) && !fs.existsSync(ultimateData),'Clean Windows user required');
const legacy=path.join(root,'legacy'), ultimate=path.join(root,'ultimate');
let app,page,baselineDir;
const pass='Synthetic-'+crypto.randomUUID();
const marker='Legacy secret fixture';
const readState = dir => {
  try {const o=JSON.parse(fs.readFileSync(path.join(dir,'Local State'),'utf8')); return o.os_crypt?.encrypted_key || null;}
  catch{return null;}
};
async function launch(file, userData) {
  const env={...process.env};delete env.PM_USER_DATA; if(userData)env.PM_USER_DATA=userData;
  app=await _electron.launch({executablePath:file,env,timeout:90000});
  page=await app.firstWindow();
  await page.waitForFunction(()=>!!window.pm?.uiToken,undefined,{timeout:90000});
}
async function api(route, body) {
 return page.evaluate(async ({route,body})=>{const r=await fetch('/api'+route,{method:body===undefined?'GET':'POST',headers:{'X-UI-Token':window.pm.uiToken,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};},{route,body});
}
const stop=async()=>{await app.close();app=undefined;};
const state = p => ({hasPassword:p?.proxy?.hasPassword===true,redacted:p?.proxy?.password==='••••',error:p?.secretError || null});
try {
  execFileSync(path.resolve('prior-installers/Azwah-Multi-Browser-Full-Setup-x64.exe'),['/S','/D='+legacy],{timeout:240000});
  execFileSync(path.resolve('release-ultimate/Azwah-Multi-Browser-Ultimate-Setup-x64.exe'),['/S','/D='+ultimate],{timeout:240000});
  await launch(path.join(legacy,'Azwah Multi Browser Owner.exe'));
  const created=await api('/profiles',{name:marker,proxy:{type:'http',host:'127.0.0.1',port:18080,username:'qa',password:pass}});
  assert.equal(created.status,201);
  const legacyResult=state((await api('/profiles/'+created.body.id)).body);
  assert.equal(legacyResult.hasPassword,true,'Source proxy must actually contain a readable password');
  await stop();
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const legacyDb = path.join(ownerData,'data','profiles.db');
  const before = hash(legacyDb);
  const executable = path.join(ultimate,'Azwah Multi Browser Ultimate.exe');
  await launch(executable,ultimateData);
  const result = await app.evaluate(({safeStorage}, args) => {
    const require = process.getBuiltinModule('node:module').createRequire(args.migrate);
    const {migrateUltimateData} = require(args.migrate);
    const {rewrapWindowsOwnerSecrets} = require(args.rewrap);
    const receipt = migrateUltimateData({appData:args.appData,ultimateDir:args.staged,
      prepareOwnerData: paths => rewrapWindowsOwnerSecrets({...paths,encrypt: value => safeStorage.encryptString(value)})});
    return {copied:receipt.copied.map(x=>x.kind),conflicts:receipt.conflicts};
  },{appData,staged,migrate:path.resolve('electron/ultimate-migrate.js'),rewrap:path.resolve('electron/windows-owner-secrets.js')});
  assert.deepEqual(result,{copied:['owner-data'],conflicts:[]});
  await stop();
  const savedData=path.join(ultimateData,'empty-fixture-data');
  fs.renameSync(path.join(ultimateData,'data'),savedData);
  fs.renameSync(path.join(staged,'data'),path.join(ultimateData,'data'));
  for (let i=0;i<2;i++) {
    await launch(executable,ultimateData);
    const profile=(await api('/profiles/'+created.body.id)).body;
    assert.deepEqual(state(profile),{hasPassword:true,redacted:true,error:null});
    const dbCopy=path.join(root,'sealed-'+i+'.db');
    if(i===0) {
      await stop();
      fs.copyFileSync(path.join(ultimateData,'data','profiles.db'),dbCopy);
      const db=new DatabaseSync(dbCopy,{readOnly:true});
      let sealed;
      try {sealed=db.prepare('SELECT password FROM proxies WHERE username=?').get('qa').password;}
      finally {db.close();}
      assert.ok(sealed.startsWith('ss:v1:'));
      await launch(executable,ultimateData);
      const matches=await app.evaluate(({safeStorage},{sealed,pass})=>safeStorage.decryptString(Buffer.from(sealed.slice(6),'base64'))===pass,{sealed,pass});
      assert.equal(matches,true,'Destination safeStorage decrypts the exact synthetic credential');
    }
    await stop();
  }
  assert.equal(hash(legacyDb),before);
  console.log('PASS installed Electron staged DPAPI conversion, exact destination decrypt, masked API, restart and source hash preservation');

} finally {
  if(app)await app.close().catch(()=>{});
  if(baselineDir)fs.rmSync(baselineDir,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
