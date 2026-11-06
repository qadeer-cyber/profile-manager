import { _electron,chromium } from 'playwright';
import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { open } from './license-admin/admin.mjs';
import { windowsEmployeeIdentity } from './windows-employee-identity.mjs';
const asar=createRequire(import.meta.url)('@electron/asar');
import { startLocalHttpFixture } from '../test/_local-http-fixture.mjs';

if (process.platform !== 'win32' || process.env.CI !== 'true') throw Error('Isolated Windows CI required');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'azwah-license-gui-'));
const adminDir=path.join(root,'admin'), officeDir=path.join(root,'office'), adminData=path.join(root,'admin-data');
const backup=path.join(root,'backup.vault'), tokenFile=path.join(root,'employee.azwah');
const password='Disposable Windows acceptance '+crypto.randomUUID();
let admin, office, fixture, identity, proxy;
const separate=process.env.AZWAH_QA_SEPARATE_IDENTITY==='1';
const install=(file,dir)=>execFileSync(file,['/S','/D='+dir],{timeout:240000});
const launch=(executablePath,args=[],env=process.env)=>_electron.launch({executablePath,args,env,timeout:60000});
const press=(page,name)=>page.getByRole('button',{name,exact:true}).click();
const fill=(page,label,value)=>page.getByLabel(label,{exact:true}).fill(value);
const shown=(page,value)=>page.getByText(value,{exact:false}).first().waitFor({timeout:240000});
try {
  install(path.resolve('release-license-admin/Azwah-License-Admin-Setup-x64.exe'),adminDir);
  admin=await launch(path.join(adminDir,'Azwah License Admin.exe'),['--user-data-dir='+adminData]);
  const a=await admin.firstWindow();
  await shown(a,'Welcome to Azwah License Admin');
  // Replace native picker responses only. All setup, signing and provisioning execute in the installed app.
  await admin.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},backup);
  await fill(a,'Organization','Disposable GUI qualification');
  await fill(a,'Master password (14 characters minimum)',password);
  await fill(a,'Confirm password',password);
  await press(a,'Create identity and choose backup');
  await shown(a,'Issued: 0');
  assert.equal(JSON.parse(fs.readFileSync(backup,'utf8')).version,1);
  assert.ok(!fs.readFileSync(backup,'utf8').includes('PRIVATE KEY'));
  console.log('PASS installed Admin setup and encrypted backup');
  await press(a,'Lock Admin Session');
  await fill(a,'Master password','Incorrect password');
  await press(a,'Unlock');
  await shown(a,'Incorrect password');
  await fill(a,'Master password',password);
  await press(a,'Unlock');
  await shown(a,'Issued: 0');
  console.log('PASS wrong-password rejection and unlock');
  await admin.evaluate(({dialog},dir)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[dir]});},root);
  await press(a,'Office Installer');
  await press(a,'Generate Office Installer');
  await shown(a,'Created ');
  install(path.join(root,'Azwah-Multi-Browser-Office-Setup-x64.exe'),officeDir);
  const resources=path.join(officeDir,'resources');
  const trust=JSON.parse(fs.readFileSync(path.join(resources,'office-trust.json'),'utf8'));
  assert.deepEqual(trust,{organization:'Disposable GUI qualification',publicKey:open(backup,password).publicKey});
  const archive=path.join(resources,'app.asar');
  assert.ok(!asar.listPackage(archive).some(name=>/license-admin|admin-desktop|issuer-public\.pem|\.vault$/i.test(name)));
  console.log('PASS installed Office trust matches Admin public key and excludes Admin code');

  const env={...process.env,PM_USER_DATA:path.join(root,'employee-data')};
  const officeExe=path.join(officeDir,'Azwah Multi Browser Office.exe');
  const xpi=path.join(officeDir,'qualification-cookie-editor.xpi');
  if(separate)fs.copyFileSync(process.env.PM_COOKIE_EDITOR_XPI,xpi);
  if(separate)identity=windowsEmployeeIdentity(officeDir,officeExe);
  const startOffice=async()=>{
    if(identity)return identity.launch();
    office=await launch(officeExe,[],env);
    return office.firstWindow();
  };
  const stopOffice=async()=>{
    if(identity)return identity.close();
    await office.close();
    office=undefined;
  };
  let e=await startOffice();
  if(separate)console.log('PASS installed Office runs under a separate standard Windows user account');
  await e.waitForFunction(()=>!!window.pm?.uiToken);
  const employeeData=(await e.evaluate(()=>window.pm.appInfo())).userData;

  await shown(e,'Activate Azwah Multi Browser Office');
  const device=await e.getByLabel('Device identity code').inputValue();
  assert.match(device,/^AZD1-[a-f0-9]{64}$/);
  const api=(route,body)=>e.evaluate(async ({route,body})=>{
    const r=await fetch('/api'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-UI-Token':window.pm.uiToken},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,body:await r.json()};
  },{route,body});
  assert.equal((await api('/profiles',{name:'Blocked'})).status,402);
  await press(a,'Employees');
  await fill(a,'Employee reference','test-employee');
  await fill(a,'Name','Disposable employee');
  await fill(a,'Device code',device);
  await press(a,'Save employee');
  await shown(a,'Devices: 1');
  await press(a,'Generate License');
  await fill(a,'Employee reference','test-employee');
  await a.locator('section').getByRole('button',{name:'Generate License',exact:true}).click();
  await shown(a,'Issued: 1');
  await press(a,'Active Licenses');
  await admin.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},tokenFile);
  await press(a,'Save License File');
  await a.waitForFunction(()=>!document.querySelector('article button:nth-of-type(2)')?.disabled);
  const token=fs.readFileSync(tokenFile,'utf8');
  await press(a,'Copy Activation Key');
  await a.waitForFunction(()=>!document.querySelector('article button')?.disabled);
  assert.ok((await admin.evaluate(({clipboard})=>clipboard.readText()))===token,'Clipboard did not receive the issued license');
  const parts=token.split('.');
  parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);
  const rejected=await api('/activation',{token:parts.join('.'),confirm:true});
  assert.equal(rejected.status,400);
  assert.equal(rejected.body.code,'LICENSE_SIGNATURE_INVALID');
  console.log('PASS installed Office rejects tampered signature');
  await e.getByLabel('License file').setInputFiles(tokenFile);
  await e.getByLabel('I authorize activation on this device.').check();
  await press(e,'Activate offline');
  await shown(e,'This device is activated');
  console.log('PASS Admin GUI provisioning, issuance, copy, export and employee GUI activation');
  await press(a,'Reissue');
  await fill(a,'Employee reference','test-employee');
  await a.locator('section').getByRole('button',{name:'Generate License',exact:true}).click();
  await shown(a,'Issued: 2');
  await press(a,'License History');
  await shown(a,'Replaced by ');
  console.log('PASS installed Admin GUI reissues and preserves replacement history');
  let issuedCount=2;
  if(separate){
    const issueNegative=async(reference,code,expired)=>{
      await press(a,'Employees');
      await fill(a,'Employee reference',reference);
      await fill(a,'Name',reference);
      await fill(a,'Device code',code);
      await press(a,'Save employee');
      await shown(a,'Issued: '+issuedCount);
      await press(a,'Generate License');
      await fill(a,'Employee reference',reference);
      await fill(a,'Validity in days (7, 30, 90, 180, 365 or custom)','1');
      if(expired)await admin.evaluate(()=>{globalThis.qaRealNow=Date.now;Date.now=()=>globalThis.qaRealNow()-2*86400000;});
      try {
        await a.locator('section').getByRole('button',{name:'Generate License',exact:true}).click();
        await shown(a,'Issued: '+(++issuedCount));
      } finally {
        if(expired)await admin.evaluate(()=>{Date.now=globalThis.qaRealNow;delete globalThis.qaRealNow;});
      }
      await press(a,expired?'Expired Licenses':'Active Licenses');
      const record=a.locator('article').filter({hasText:reference});
      await record.getByRole('button',{name:'Copy Activation Key',exact:true}).click();
      await record.getByRole('button',{name:'Copy Activation Key',exact:true}).waitFor();
      await a.waitForFunction(ref=>![...document.querySelectorAll('article')].find(row=>row.textContent.includes(ref))?.querySelector('button')?.disabled,reference);
      const signed=await admin.evaluate(({clipboard})=>clipboard.readText());
      return api('/activation',{token:signed,confirm:true});
    };
    const wrongDevice=await issueNegative('wrong-device-case','AZD1-'+(device.endsWith('a')?'b':'a').repeat(64),false);
    assert.equal(wrongDevice.body.code,'LICENSE_DEVICE_MISMATCH');
    const expired=await issueNegative('expired-case',device,true);
    assert.equal(expired.body.code,'LICENSE_EXPIRED');
    console.log('PASS installed Office rejects validly signed wrong-device and expired licenses');
  }


  await stopOffice();
  e=await startOffice();
  await e.waitForFunction(()=>!!window.pm?.uiToken);
  assert.equal((await api('/activation')).body.active,true);
  assert.ok(fs.readFileSync(path.join(employeeData,'data','azwah-activation.json'),'utf8').startsWith('ss:v1:'));
  console.log('PASS installed Office persists OS-encrypted activation after restart');
  fixture=await startLocalHttpFixture();
  for(const engine of ['chromium','firefox']){
    const created=await api('/profiles',{name:'GUI qualification '+engine,browserEngine:engine,automationEnabled:true,browserSettings:engine==='firefox'?{firefoxSessionMode:'bidi',timezoneId:'UTC'}:{}});
    assert.equal(created.status,201);
    assert.equal((await api('/profiles/'+created.body.id+'/launch',{headless:true,automation:true,url:fixture.origin})).status,200);
    assert.equal((await api('/profiles/'+created.body.id+'/stop',{})).status,200);
    console.log('PASS installed activated Office '+engine+' launch and stop');
  }
  if(separate){
    let proxyHits=0;
    proxy=http.createServer((req,res)=>{
      let target;
      try{target=new URL(req.url);}catch{res.writeHead(400).end();return;}
      if(target.hostname!=='azwah-qualification.invalid'){res.writeHead(403).end();return;}
      proxyHits++;
      const forward=http.request(fixture.origin+target.pathname,{method:req.method},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res);});
      forward.on('error',()=>res.destroy());
      req.pipe(forward);
    });
    proxy.on('connect',(_req,socket)=>socket.destroy());
    await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
    const proxyRecord=await api('/proxies',{name:'Office test proxy',type:'http',host:'127.0.0.1',port:proxy.address().port});
    assert.equal(proxyRecord.status,201);
    const profile=await api('/profiles',{name:'Office persistence',automationEnabled:true,proxyId:proxyRecord.body.id,browserSettings:{timezoneId:'Europe/Berlin',locale:'de-DE',languages:['de-DE']}});
    assert.equal(profile.status,201);
    const url='http://azwah-qualification.invalid/';
    const browse=async(id,write=false)=>{
      assert.equal((await api('/profiles/'+id+'/launch',{headless:true,automation:true,url})).status,200);
      const profileInfo=(await api('/profiles/'+id)).body;
      const client=await chromium.connectOverCDP(profileInfo.cdp.httpEndpoint,{timeout:15000});
      try {
        const tab=client.contexts()[0].pages()[0];
        await tab.goto(url);
        const observed=await tab.evaluate(write=>{
          if(write){document.cookie='azwah=persisted; Max-Age=3600; Path=/';localStorage.setItem('azwah','persisted');}
          return {cookie:document.cookie,storage:localStorage.getItem('azwah'),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone};
        },write);
        assert.match(observed.cookie,/azwah=persisted/);
        assert.equal(observed.storage,'persisted');
        assert.equal(observed.timezone,'Europe/Berlin');
      } finally {await client.close();}
      assert.equal((await api('/profiles/'+id+'/stop',{})).status,200);
    };
    await browse(profile.body.id,true);
    await browse(profile.body.id);
    assert.ok(proxyHits>0);
    console.log('PASS installed Office Chromium proxy routing, timezone, cookies and localStorage persist');
    const restore=await e.evaluate(async id=>{
      const common={'X-UI-Token':window.pm.uiToken},passphrase='Disposable encrypted qualification backup';
      const response=await fetch('/api/profiles/'+id+'/backup/export-stream',{method:'POST',headers:{...common,'Content-Type':'application/json'},body:JSON.stringify({passphrase,confirmSensitive:true})});
      if(!response.ok)throw Error('Office encrypted export failed');
      const bytes=await response.arrayBuffer();
      const imported=await fetch('/api/backup/restore-stream?collision=rename',{method:'POST',headers:{...common,'Content-Type':'application/octet-stream','X-Backup-Passphrase':passphrase},body:bytes});
      return {status:imported.status,body:await imported.json(),magic:String.fromCharCode(...new Uint8Array(bytes).slice(0,4))};
    },profile.body.id);
    assert.equal(restore.status,200);
    assert.equal(restore.magic,'PMBE');
    const restored=restore.body.renamed[0].id;
    assert.notEqual(restored,profile.body.id);
    await browse(restored);
    console.log('PASS installed Office encrypted restore and browser data readback');
    const firefox=await api('/profiles',{name:'Office signed extension',browserEngine:'firefox',automationEnabled:true,browserSettings:{firefoxSessionMode:'bidi',timezoneId:'UTC'}});
    assert.equal(firefox.status,201);
    const id=firefox.body.id;
    assert.equal((await api('/profiles/'+id+'/launch',{headless:true,automation:true,url:fixture.origin})).status,200);
    const addon=await api('/gecko-extensions/import',{path:xpi});
    assert.equal(addon.body.geckoExtensionId,'{c3c10168-4186-445c-9c5b-63f12b8e2c87}');
    const installed=await api('/profiles/'+id+'/gecko-extensions/'+addon.body.id+'/install',{confirm:true});
    assert.equal(installed.body.addon?.signatureVerified,true);
    assert.equal((await api('/profiles/'+id+'/stop',{})).status,200);
    console.log('PASS real installed Office Firefox accepts permanent Mozilla-signed Cookie-Editor');
  }
  await stopOffice();
  const uninstaller=path.join(officeDir,'Uninstall Azwah Multi Browser Office.exe');
  execFileSync(uninstaller,['/S'],{timeout:180000});
  const deadline=Date.now()+60000;
  while(fs.existsSync(path.join(officeDir,'Azwah Multi Browser Office.exe'))&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,250));
  assert.ok(!fs.existsSync(path.join(officeDir,'Azwah Multi Browser Office.exe')));
  assert.ok(fs.existsSync(path.join(employeeData,'data','profiles.db')));
  assert.ok(fs.existsSync(path.join(employeeData,'data','azwah-activation.json')));
  console.log('PASS Office uninstall retains employee profiles and activation');
  const vaultPath=await admin.evaluate(({app})=>app.getPath('userData'));
  const latestBackup=path.join(root,'latest.vault');
  await admin.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},latestBackup);
  await press(a,'Backup & Restore');
  await press(a,'Save encrypted backup');
  await a.waitForFunction(()=>![...document.querySelectorAll('button')].find(button=>button.textContent==='Save encrypted backup')?.disabled);
  assert.equal(open(latestBackup,password).records.length,issuedCount);
  await admin.close();
  admin=undefined;
  const original=path.join(vaultPath,'organization.vault');
  fs.renameSync(original,path.join(root,'pre-restore.vault'));
  admin=await launch(path.join(adminDir,'Azwah License Admin.exe'),['--user-data-dir='+adminData]);
  const restored=await admin.firstWindow();
  await shown(restored,'Welcome to Azwah License Admin');
  await admin.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},latestBackup);
  await fill(restored,'Backup password',password);
  await press(restored,'Choose encrypted backup');
  await shown(restored,'Issued: '+issuedCount);
  console.log('PASS installed Admin restores the encrypted vault and persisted records');
} finally {
  if(identity)await identity.dispose();
  if(office)await office.close().catch(()=>{});
  if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}
  if(admin)await admin.close().catch(()=>{});
  if(fixture)await fixture.close();
  fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
