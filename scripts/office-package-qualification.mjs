// Builds and installs a NON-DISTRIBUTABLE test-identity installer on an isolated
// Windows worker. Private fixtures and binaries are never uploaded by this job.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {adminAction} from './license-admin/admin.mjs';
import {deviceIdentity} from '../server/office/device.js';
import {startLocalHttpFixture} from '../test/_local-http-fixture.mjs';
import {_electron,chromium} from 'playwright';
const require=createRequire(import.meta.url),asar=require('@electron/asar');
if(process.platform!=='win32'||process.env.CI!=='true'||process.env.AZWAH_ISOLATED_PACKAGE_TEST!=='1')throw Error('An isolated authorized Windows CI worker is required');
const root=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP||os.tmpdir(),'azwah-package-'));
const output=path.join(root,'output'),install=path.join(root,'installed'),userData=path.join(root,'employee');
const evidence=path.resolve('build-evidence/office-package');fs.mkdirSync(evidence,{recursive:true});
const pubFile=path.resolve('server/office/issuer-public.pem'),vault=path.join(root,'admin.vault'),password=crypto.randomBytes(32).toString('base64url');
if(fs.existsSync(pubFile))throw Error('Packaging test refuses to overwrite an organization trust root');
process.env.AZWAH_PACKAGE_TEST_OUTPUT=output;
const results=[];let application,fixture,installer;
const check=(condition,message)=>{results.push({pass:!!condition,message});console.log(`${condition?'PASS':'FAIL'} ${message}`);if(!condition)throw Error(message);};
const cmd=command=>{const result=spawnSync('cmd.exe',['/d','/s','/c',command],{stdio:'inherit',timeout:900000,env:process.env});if(result.error)throw result.error;if(result.status!==0)throw Error('Build command failed: '+command);};
async function launch(expectActivation=false){
 const env={...process.env,PM_USER_DATA:userData};delete env.ELECTRON_RUN_AS_NODE;delete env.PM_API_TOKEN;delete env.PM_SECRET;
 application=await _electron.launch({executablePath:path.join(install,'Azwah Multi Browser.exe'),env,timeout:60000});
 const page=await application.firstWindow();await page.waitForFunction(()=>!!window.pm,{timeout:60000});if(expectActivation)await page.getByRole('heading',{name:'Azwah Multi Browser — Office Edition',exact:true}).waitFor({timeout:60000});return page;
}
async function api(page,route,body){return page.evaluate(async({route,body})=>{const response=await fetch('/api'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-UI-Token':window.pm.uiToken},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,body:await response.json()};},{route,body});}
try{
 const issuer=adminAction({command:'init',vault,password});fs.writeFileSync(pubFile,issuer.publicKey,{flag:'wx',mode:0o600});
 cmd('npm run build');cmd('node scripts/fetch-bundled-chromium.mjs win64');
 cmd('npx electron-builder install-app-deps --arch=x64');
 cmd('npx electron-builder --config electron-builder.office-test.cjs --win nsis --x64 --publish never');
 installer=path.join(output,'Azwah-Multi-Browser-Office-Experimental-Setup-x64.exe');check(fs.existsSync(installer),'Real NSIS executable produced');
 const bytes=fs.statSync(installer).size,hash=crypto.createHash('sha256');
 for await(const chunk of fs.createReadStream(installer))hash.update(chunk);const sha256=hash.digest('hex');
 check(bytes>1000000,'Installer has nontrivial size');
 fs.writeFileSync(path.join(evidence,'BUILD-MANIFEST.txt'),`NON-DISTRIBUTABLE ISOLATED TEST IDENTITY\nSource: ${process.env.GITHUB_SHA}\nInstaller: ${path.basename(installer)}\nBytes: ${bytes}\nSHA256: ${sha256}\nHost: ${os.release()} ${process.arch}\nFirefox: system installation required; not bundled\nProduction activation: BLOCKED — ORGANIZATION KEY REQUIRED\n`);
 fs.writeFileSync(path.join(evidence,'SHA256SUMS.txt'),sha256+'  '+path.basename(installer)+'\n');
 const archive=path.join(output,'win-unpacked','resources','app.asar'),files=asar.listPackage(archive);
 check(!files.some(name=>/scripts[\\/]license-admin|admin\.vault|azwah-activation\.json|test[\\/]office-/.test(name)),'Packaged ASAR excludes admin utility, vault, activation state and office test fixtures');
 let privateMaterial=false,fixtureToken=false;
 for(const name of files){const clean=name.replace(/^[/\\]/,'');let stat;try{stat=asar.statFile(archive,clean);}catch{continue;}if(!stat.size||stat.size>4*1024*1024)continue;
  let text;try{text=asar.extractFile(archive,clean).toString('utf8');}catch{continue;}
  privateMaterial ||= /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{32,}-----END/.test(text);
  fixtureToken ||= /AZW1\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{80,}/.test(text);
 }
 check(!privateMaterial&&!fixtureToken,'Packaged content has no PEM private key blocks or serialized office activation fixtures');
 const verifier=asar.extractFile(archive,path.join('server','office','license.js')).toString();check(!/createPrivateKey|crypto\.sign|function issueLicense/.test(verifier),'Installed employee license module is verification-only');
 check(asar.extractFile(archive,path.join('server','office','issuer-public.pem')).toString()===issuer.publicKey,'Isolated test public verification root matches intended fixture');
 const setup=spawnSync(installer,['/S','/D='+install],{timeout:180000,stdio:'inherit'});check(setup.status===0,'NSIS clean silent installation succeeds');
 check(fs.existsSync(path.join(install,'Azwah Multi Browser.exe')),'Installed branded Windows executable exists');
 let page=await launch(true);const info=await page.evaluate(()=>window.pm.appInfo());check(info.packaged&&info.product==='Azwah Multi Browser'&&info.bundledBrowsers,'Installed application starts packaged with offline Chromium');
 check(await page.title()==='Azwah Multi Browser','Installed window title and UI branding match');
 check(await page.getByLabel('Device identity code').inputValue()===deviceIdentity(),'Installed activation displays actual machine-bound identity');
 const issued=adminAction({command:'issue',vault,password,device:deviceIdentity(),label:'ISOLATED PACKAGING TEST',expiresAt:Date.now()+600000});
 const foreign=adminAction({command:'issue',vault,password,device:'AZD1-'+'a'.repeat(64),label:'ISOLATED FOREIGN TEST',expiresAt:Date.now()+600000});
 check((await api(page,'/activation',{token:foreign.token,confirm:true})).status===400,'Installed application rejects foreign-device license');
 const parts=issued.token.split('.');parts[1]=Buffer.from(JSON.stringify({...issued.license,label:'Tampered'})).toString('base64url');
 check((await api(page,'/activation',{token:parts.join('.'),confirm:true})).status===400,'Installed application rejects tampered signed claims');
 await page.getByLabel('Administrator license',{exact:true}).fill(issued.token);await page.getByLabel('I authorize activation on this device.').check();await page.getByRole('button',{name:'Activate offline',exact:true}).click();await page.getByText('This device is activated for offline use.',{exact:true}).waitFor();
 check((await api(page,'/activation')).body.active,'Installed application activates offline using OS-backed storage');
 check(fs.readFileSync(path.join(userData,'data','azwah-activation.json'),'utf8').startsWith('ss:v1:'),'Activation is encrypted by Electron safeStorage on actual Windows');
 fixture=await startLocalHttpFixture();const created=await api(page,'/profiles',{name:'Installed persistence',automationEnabled:true});check(created.status===201,'Installed native SQLite backend persists a profile');const id=created.body.id;
 const opened=await api(page,`/profiles/${id}/launch`,{headless:true,automation:true,url:fixture.origin});check(opened.status===200,'Installed offline Chromium profile launches without development checkout');
 const readChromium=async(profileId,seed=false)=>{
  const profile=await api(page,`/profiles/${profileId}`),browser=await chromium.connectOverCDP(profile.body.cdp.httpEndpoint,{timeout:15000});
  try {const tab=browser.contexts()[0].pages()[0];await tab.goto(fixture.origin);return await tab.evaluate(seed=>{if(seed){document.cookie='package=persistent; Max-Age=3600; Path=/; SameSite=Lax';localStorage.setItem('package','isolated');}return {cookie:document.cookie,storage:localStorage.getItem('package')};},seed);}finally{await browser.close();}
 };
 check((await readChromium(id,true)).storage==='isolated','Installed Chromium writes actual persistent browser data');
 check((await api(page,`/profiles/${id}/stop`,{})).status===200,'Installed browser shuts down through application Stop');
 await application.close();application=null;page=await launch();
 check((await api(page,`/profiles/${id}/launch`,{headless:true,automation:true,url:fixture.origin})).status===200,'Profile reopens after installed application restart');
 const persisted=await readChromium(id);check(persisted.cookie.includes('package=persistent')&&persisted.storage==='isolated','Installed Chromium cookies and localStorage survive genuine shutdown and application restart');
 await api(page,`/profiles/${id}/stop`,{});
 const transfer=await page.evaluate(async({id})=>{const headers={'Content-Type':'application/json','X-UI-Token':window.pm.uiToken},passphrase='isolated-package-backup-passphrase';const exported=await fetch(`/api/profiles/${id}/backup/export-stream`,{method:'POST',headers,body:JSON.stringify({passphrase,confirmSensitive:true})});if(!exported.ok)return {status:exported.status};const bytes=await exported.arrayBuffer();const restored=await fetch('/api/backup/restore-stream?collision=rename',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-UI-Token':window.pm.uiToken,'X-Backup-Passphrase':passphrase},body:bytes});return {status:restored.status,magic:String.fromCharCode(...new Uint8Array(bytes).slice(0,4)),body:await restored.json()};},{id});
 check(transfer.status===200&&transfer.magic==='PMBE','Installed application performs encrypted profile export and collision-safe restore');
 const copy=transfer.body.renamed[0].id;check(copy!==id,'Restored installed profile receives an isolated identity');
 await api(page,`/profiles/${copy}/launch`,{headless:true,automation:true,url:fixture.origin});const restoredData=await readChromium(copy);check(restoredData.cookie.includes('package=persistent')&&restoredData.storage==='isolated','Installed encrypted restore preserves supported Chromium cookies and localStorage');await api(page,`/profiles/${copy}/stop`,{});
 const editorSetup=await api(page,`/profiles/${id}/cookie-editor/setup`,{confirm:true});check(editorSetup.status===200&&editorSetup.body.manualActionRequired===true&&editorSetup.body.installed===false,'Installed Cookie-Editor setup honestly requires official-store user confirmation');await api(page,`/profiles/${id}/stop`,{});
 const firefox=await api(page,'/profiles',{name:'Installed system Firefox',browserEngine:'firefox',browserSettings:{firefoxSessionMode:'bidi',timezoneId:'UTC'}});check(firefox.status===201,'Installed application creates a separate Firefox profile');
 const firefoxId=firefox.body.id;check((await api(page,`/profiles/${firefoxId}/launch`,{headless:true,automation:true,url:fixture.origin})).status===200,'Installed application launches supported system Firefox');
 const tree=await api(page,`/profiles/${firefoxId}/firefox/command`,{method:'browsingContext.getTree',params:{}});
 const observed=await api(page,`/profiles/${firefoxId}/firefox/command`,{method:'script.evaluate',params:{expression:'Intl.DateTimeFormat().resolvedOptions().timeZone',target:{context:tree.body.contexts[0].context},awaitPromise:true}});
 check(observed.status===200&&observed.body.result.value==='UTC','Installed Firefox executes real BiDi readback with configured timezone');await api(page,`/profiles/${firefoxId}/stop`,{});
 await application.close();application=null;
 const reinstall=spawnSync(installer,['/S','/D='+install],{timeout:180000,stdio:'inherit'});check(reinstall.status===0,'Office installer in-place reinstall succeeds');
 page=await launch();check((await api(page,`/profiles/${id}`)).status===200,'Office in-place reinstall preserves SQLite profile data');
 await application.close();application=null;
 const uninstaller=fs.readdirSync(install).find(name=>/^Uninstall.*\.exe$/i.test(name));check(!!uninstaller,'Branded uninstaller exists');
 const removed=spawnSync(path.join(install,uninstaller),['/S'],{timeout:180000,stdio:'inherit'});check(removed.status===0,'Silent uninstaller starts successfully');
 const uninstallDeadline=Date.now()+60000;while(fs.existsSync(path.join(install,'Azwah Multi Browser.exe'))&&Date.now()<uninstallDeadline)await new Promise(resolve=>setTimeout(resolve,250));
 check(!fs.existsSync(path.join(install,'Azwah Multi Browser.exe')),'Silent uninstall actually removes the installed executable');
 check(fs.existsSync(path.join(userData,'data','profiles.db')),'Uninstall retains user profile database');
 check(fs.existsSync(path.join(userData,'data','azwah-activation.json')),'Uninstall retains encrypted activation state');
}catch(error){console.error('PACKAGING_QUALIFICATION_FAILURE',error.message);results.push({pass:false,message:error.message});process.exitCode=1;}
finally{
 if(application)await application.close().catch(()=>{});if(fixture)await fixture.close();
 fs.writeFileSync(path.join(evidence,'qualification.json'),JSON.stringify({sourceCommit:process.env.GITHUB_SHA,platform:process.platform,host:os.release(),testIdentityOnly:true,results,pass:results.filter(r=>r.pass).length,fail:results.filter(r=>!r.pass).length,unverified:['Windows 10','Original Profile Manager installed upgrade','Organization-specific activation','Release artifact signing and publication']},null,2));
 fs.rmSync(pubFile,{force:true});fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
