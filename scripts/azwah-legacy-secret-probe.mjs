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
const ultimateData=path.join(appData,'azwah-multi-browser-ultimate');
assert.ok(!fs.existsSync(ownerData) && !fs.existsSync(ultimateData),'Clean Windows user required');
const legacy=path.join(root,'legacy'), ultimate=path.join(root,'ultimate');
let app,page,baselineDir;
const pass='Synthetic-'+crypto.randomUUID();
const marker='Legacy secret fixture';
const readState = dir => {
  try {const o=JSON.parse(fs.readFileSync(path.join(dir,'Local State'),'utf8')); return o.os_crypt?.encrypted_key || null;}
  catch{return null;}
};
async function launch(file) {
  const env={...process.env};delete env.PM_USER_DATA;
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
  const dbCopy=path.join(root,'inspection.db');
  fs.copyFileSync(path.join(ownerData,'data','profiles.db'),dbCopy);
  const db=new DatabaseSync(dbCopy,{readOnly:true});
  let secret;
  try {secret=db.prepare('SELECT password FROM proxies WHERE username=?').get('qa').password;}
  finally {db.close();}
  const sourceKey=readState(ownerData);
  await launch(path.join(ultimate,'Azwah Multi Browser Ultimate.exe'));
  const baseline=state((await api('/profiles/'+created.body.id)).body);
  await stop();
  const ultimateKey=readState(ultimateData);
  console.log('LEGACY_SECRET_BASELINE '+JSON.stringify({legacyResult,baseline,format:secret.split(':').slice(0,2).join(':'),sourceKeyPresent:!!sourceKey,ultimateKeyPresent:!!ultimateKey,sameKey:!!sourceKey&&sourceKey===ultimateKey}));
  if(!baseline.hasPassword && sourceKey) {
    baselineDir=fs.mkdtempSync(path.join(appData,'azwah-qa-baseline-'));
    fs.renameSync(ultimateData,path.join(baselineDir,'ultimate'));
    fs.mkdirSync(ultimateData);
    fs.writeFileSync(path.join(ultimateData,'Local State'),JSON.stringify({os_crypt:{encrypted_key:sourceKey}}),{flag:'wx'});
    await launch(path.join(ultimate,'Azwah Multi Browser Ultimate.exe'));
    const seeded=state((await api('/profiles/'+created.body.id)).body);
    console.log('LEGACY_SECRET_KEY_SEED '+JSON.stringify(seeded));
    assert.equal(seeded.hasPassword,true,'Seeded DPAPI-wrapped source key should recover the legacy credential');
    assert.equal(seeded.redacted,true);
    await stop();
  }
} finally {
  if(app)await app.close().catch(()=>{});
  if(baselineDir)fs.rmSync(baselineDir,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
