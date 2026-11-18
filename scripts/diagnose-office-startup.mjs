import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {windowsEmployeeIdentity} from './windows-employee-identity.mjs';

if(process.platform!=='win32'||process.env.CI!=='true')throw Error('Windows CI required');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'azwah-startup-probe-'));
const admin=path.join(root,'admin');
const destination=path.join(process.env.ProgramFiles,'Azwah Office Startup Probe');
let identity;
try {
  if(fs.existsSync(destination))throw Error('Probe requires a clean disposable target');
  execFileSync(path.resolve('release-license-admin/Azwah-License-Admin-Setup-x64.exe'),['/S','/D='+admin],{timeout:180000});
  const source=path.join(admin,'resources','office-payload');
  fs.cpSync(source,destination,{recursive:true,errorOnExist:true,force:false});
  const {publicKey}=crypto.generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'}});
  // Disposable public trust fixture, never a production signing identity or release artifact.
  fs.writeFileSync(path.join(destination,'resources','office-trust.json'),JSON.stringify({organization:'Disposable startup probe',publicKey}));
  const executable=path.join(destination,'Azwah Multi Browser Office.exe');
  const digest=filename=>crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
  if(digest(executable)!==digest(path.join(source,'Azwah Multi Browser Office.exe')))throw Error('Office executable changed during probe installation');
  console.log('STARTUP_PROBE_BINARY '+digest(executable));
  identity=windowsEmployeeIdentity(destination,executable);
  const page=await identity.launch();
  const state=await page.evaluate(async()=>{const r=await fetch('/api/activation',{headers:{'X-UI-Token':window.pm.uiToken}});return r.json();});
  if(state.active||!/^AZD1-[a-f0-9]{64}$/.test(state.deviceCode))throw Error('Invalid real Office activation readback');
  console.log('PASS focused Office startup, real renderer and device identity');
} finally {
  if(identity)await identity.dispose();
  fs.rmSync(destination,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
