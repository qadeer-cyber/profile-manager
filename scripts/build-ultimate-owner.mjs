// Release-specific installed acceptance for the explicit, fully functional Owner/Personal Edition.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {startLocalHttpFixture} from '../test/_local-http-fixture.mjs';
import {_electron,chromium} from 'playwright';
const require=createRequire(import.meta.url),asar=require('@electron/asar');
if(process.platform!=='win32'||process.env.CI!=='true'||process.env.AZWAH_OWNER_BUILD!=='1')throw Error('An isolated authorized Windows CI worker is required');
const root=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP||os.tmpdir(),'azwah-ultimate-'));
const output=path.resolve('release-ultimate-owner'),install=path.join(root,'installed'),userData=path.join(root,'employee');
const evidence=path.resolve('build-evidence/ultimate-owner');fs.mkdirSync(evidence,{recursive:true});
if(fs.existsSync('server/office/issuer-public.pem'))throw Error('Owner edition must not ship an Office issuer root');
const results=[];let application,fixture,installer,proxyServer,proxyHits=0,browserUrl;
const check=(condition,message)=>{results.push({pass:!!condition,message});console.log(`${condition?'PASS':'FAIL'} ${message}`);if(!condition)throw Error(message);};
const cmd=command=>{const result=spawnSync('cmd.exe',['/d','/s','/c',command],{stdio:'inherit',timeout:900000,env:process.env});if(result.error)throw result.error;if(result.status!==0)throw Error('Build command failed: '+command);};
async function launch(expectActivation=false){
 const env={...process.env,PM_USER_DATA:userData};delete env.ELECTRON_RUN_AS_NODE;delete env.PM_API_TOKEN;delete env.PM_SECRET;
 application=await _electron.launch({executablePath:path.join(install,'Azwah Multi Browser Owner.exe'),env,timeout:60000});
 const page=await application.firstWindow();await page.waitForFunction(()=>!!window.pm,{timeout:60000});if(expectActivation)await page.getByRole('heading',{name:'Azwah Multi Browser — Owner / Personal Edition',exact:true}).waitFor({timeout:60000});return page;
}
async function api(page,route,body){return page.evaluate(async({route,body})=>{const response=await fetch('/api'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-UI-Token':window.pm.uiToken},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,body:await response.json()};},{route,body});}
try{

 cmd('npm run build');cmd('node scripts/fetch-bundled-chromium.mjs win64');
 cmd('npx electron-builder install-app-deps --arch=x64');
 cmd('npx electron-builder --config electron-builder.ultimate-owner.cjs --win nsis --x64 --publish never');
 installer=path.join(output,'Azwah-Multi-Browser-Ultimate-Setup-x64.exe');check(fs.existsSync(installer),'Real NSIS executable produced');
 const bytes=fs.statSync(installer).size,hash=crypto.createHash('sha256');
 for await(const chunk of fs.createReadStream(installer))hash.update(chunk);const sha256=hash.digest('hex');
 check(bytes>1000000,'Installer has nontrivial size');
 fs.writeFileSync(path.join(output,'BUILD-MANIFEST.txt'),`Azwah Multi Browser Ultimate — Owner / Personal experimental build\nSource: ${process.env.GITHUB_SHA}\nInstaller: ${path.basename(installer)}\nBytes: ${bytes}\nSHA256: ${sha256}\nHost: ${os.release()} ${process.arch}\nElectron: ${require('electron/package.json').version}\nNode build host: ${process.version}\nFirefox: system installation required; not bundled\nQualification host is Windows Server 2022, not Windows 10. Unsigned.\nOwner policy: personal evaluation without employee activation. Office licensing remains separate. Existing owner and admin experimental.1 releases are not replaced.\n`);
 fs.writeFileSync(path.join(output,'SHA256SUMS.txt'),sha256+'  '+path.basename(installer)+'\n');
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
 const metadata=JSON.parse(asar.extractFile(archive,'package.json'));check(metadata.azwahEdition==='owner-personal'&&metadata.azwahLicensePolicy==='personal-no-activation'&&metadata.name==='azwah-multi-browser-owner','Owner licensing policy is explicit in installed metadata');check(!files.some(n=>/issuer-public\.pem/.test(n)),'No Office issuer identity is included');
 const setup=spawnSync(installer,['/S','/D='+install],{timeout:180000,stdio:'inherit'});check(setup.status===0,'NSIS clean silent installation succeeds');
 check(fs.existsSync(path.join(install,'Azwah Multi Browser Owner.exe')),'Installed branded Windows executable exists');
 let page=await launch();const info=await page.evaluate(()=>window.pm.appInfo());check(info.packaged&&info.product==='Azwah Multi Browser Owner'&&info.edition==='Owner / Personal'&&info.bundledBrowsers,'Installed Owner application starts with offline Chromium and native backend');
 const shotDir=path.join(evidence,'screenshots');fs.mkdirSync(shotDir,{recursive:true});
 const shot=async(name,width,height)=>{await page.setViewportSize({width,height});await page.screenshot({path:path.join(shotDir,`${name}-${width}x${height}.png`)});};
 for(const [width,height] of [[1366,768],[1600,900]]){
  await page.locator('[data-nav=profiles]').click();
  await shot('dashboard',width,height);
  await page.getByRole('button',{name:'New profile'}).click();
  const dialog=page.getByRole('dialog');
  await shot('general',width,height);
  await dialog.getByRole('tab',{name:'Proxy'}).click();await shot('proxy',width,height);
  await dialog.getByRole('tab',{name:'Fingerprint'}).click();await shot('fingerprint',width,height);
  await dialog.getByRole('tab',{name:'Extra'}).click();await shot('extra',width,height);
  await dialog.getByRole('button',{name:'Cancel'}).click();
  await page.locator('[data-nav=settings]').click();await shot('settings-light',width,height);
  await page.getByRole('radio',{name:'Dark theme'}).click();await shot('settings-dark',width,height);
  await page.getByRole('radio',{name:'Light theme'}).click();
  await page.locator('[data-nav=profiles]').click();
 }
 check(fs.readdirSync(shotDir).length>=12,'Installed UI screenshots captured at 1366x768 and 1600x900');
 const owner=await api(page,'/activation');check(owner.body.active&&owner.body.edition==='owner-personal'&&!owner.body.enforced,'Owner edition intentionally enables full functionality without employee tokens');
 check(!fs.existsSync(path.join(userData,'data','azwah-activation.json')),'Owner build uses no fabricated activation state');
 fixture=await startLocalHttpFixture();
 proxyServer=http.createServer((req,res)=>{let target;try{target=new URL(req.url);}catch{res.writeHead(400).end();return;}if(target.hostname!=='pm-proxy-test.invalid'){res.writeHead(403).end();return;}proxyHits++;const forward=http.request(fixture.origin+target.pathname,{method:req.method,headers:{host:'127.0.0.1'}},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res);});forward.on('error',()=>res.destroy());req.pipe(forward);});proxyServer.on('connect',(_req,socket)=>socket.destroy());await new Promise(resolve=>proxyServer.listen(0,'127.0.0.1',resolve));browserUrl=`http://pm-proxy-test.invalid:${fixture.port}/`;
 const proxy=await api(page,'/proxies',{name:'Installed controlled HTTP proxy',type:'http',host:'127.0.0.1',port:proxyServer.address().port});check(proxy.status===201,'Installed Owner edition configures a real HTTP proxy');
 const created=await api(page,'/profiles',{name:'Installed persistence',automationEnabled:true,proxyId:proxy.body.id,browserSettings:{locale:'de-DE',languages:['de-DE'],timezoneId:'Europe/Berlin'}});check(created.status===201,'Installed native SQLite backend persists a profile');const id=created.body.id;
 const opened=await api(page,`/profiles/${id}/launch`,{headless:true,automation:true,url:browserUrl});check(opened.status===200,'Installed offline Chromium profile launches without development checkout');
 const readChromium=async(profileId,seed=false)=>{
  const profile=await api(page,`/profiles/${profileId}`),browser=await chromium.connectOverCDP(profile.body.cdp.httpEndpoint,{timeout:15000});
  try {const tab=browser.contexts()[0].pages()[0];await tab.goto(browserUrl);return await tab.evaluate(seed=>{if(seed){document.cookie='package=persistent; Max-Age=3600; Path=/; SameSite=Lax';localStorage.setItem('package','isolated');}return {cookie:document.cookie,storage:localStorage.getItem('package'),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,language:navigator.language};},seed);}finally{await browser.close();}
 };
 const first=await readChromium(id,true);check(first.storage==='isolated','Installed Chromium writes actual persistent browser data');check(first.timezone==='Europe/Berlin'&&first.language==='de-DE','Installed Chromium reads back configured timezone and language');check(proxyHits>0,'Real Chromium traffic passed through the configured controlled proxy');
 check((await api(page,`/profiles/${id}/stop`,{})).status===200,'Installed browser shuts down through application Stop');
 await application.close();application=null;page=await launch();
 check((await api(page,`/profiles/${id}/launch`,{headless:true,automation:true,url:browserUrl})).status===200,'Profile reopens after installed application restart');
 const persisted=await readChromium(id);check(persisted.cookie.includes('package=persistent')&&persisted.storage==='isolated','Installed Chromium cookies and localStorage survive genuine shutdown and application restart');
 await api(page,`/profiles/${id}/stop`,{});
 const transfer=await page.evaluate(async({id})=>{const headers={'Content-Type':'application/json','X-UI-Token':window.pm.uiToken},passphrase='isolated-package-backup-passphrase';const exported=await fetch(`/api/profiles/${id}/backup/export-stream`,{method:'POST',headers,body:JSON.stringify({passphrase,confirmSensitive:true})});if(!exported.ok)return {status:exported.status};const bytes=await exported.arrayBuffer();const restored=await fetch('/api/backup/restore-stream?collision=rename',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-UI-Token':window.pm.uiToken,'X-Backup-Passphrase':passphrase},body:bytes});return {status:restored.status,magic:String.fromCharCode(...new Uint8Array(bytes).slice(0,4)),body:await restored.json()};},{id});
 check(transfer.status===200&&transfer.magic==='PMBE','Installed application performs encrypted profile export and collision-safe restore');
 const copy=transfer.body.renamed[0].id;check(copy!==id,'Restored installed profile receives an isolated identity');
 await api(page,`/profiles/${copy}/launch`,{headless:true,automation:true,url:browserUrl});const restoredData=await readChromium(copy);check(restoredData.cookie.includes('package=persistent')&&restoredData.storage==='isolated','Installed encrypted restore preserves supported Chromium cookies and localStorage');await api(page,`/profiles/${copy}/stop`,{});
 const storeProfile=await api(page,'/profiles',{name:'Owner official-store setup'});check(storeProfile.status===201,'Owner creates independent extension-setup profile');const editorSetup=await api(page,`/profiles/${storeProfile.body.id}/cookie-editor/setup`,{confirm:true});check(editorSetup.status===200&&editorSetup.body.manualActionRequired===true&&editorSetup.body.installed===false,'Installed Cookie-Editor setup honestly requires official-store user confirmation');await api(page,`/profiles/${storeProfile.body.id}/stop`,{});
 const firefox=await api(page,'/profiles',{name:'Installed system Firefox',browserEngine:'firefox',browserSettings:{firefoxSessionMode:'bidi',timezoneId:'UTC'}});check(firefox.status===201,'Installed application creates a separate Firefox profile');
 const firefoxId=firefox.body.id;check((await api(page,`/profiles/${firefoxId}/launch`,{headless:true,automation:true,url:fixture.origin})).status===200,'Installed application launches supported system Firefox');
 const tree=await api(page,`/profiles/${firefoxId}/firefox/command`,{method:'browsingContext.getTree',params:{}});
 const observed=await api(page,`/profiles/${firefoxId}/firefox/command`,{method:'script.evaluate',params:{expression:'Intl.DateTimeFormat().resolvedOptions().timeZone',target:{context:tree.body.contexts[0].context},awaitPromise:true}});
 check(observed.status===200&&observed.body.result.value==='UTC','Installed Firefox executes real BiDi readback with configured timezone');
 const addon=await api(page,'/gecko-extensions/import',{path:process.env.PM_COOKIE_EDITOR_XPI});check(addon.status===201||addon.status===200,'Installed application imports official signed Cookie-Editor');check(addon.body.geckoExtensionId==='{c3c10168-4186-445c-9c5b-63f12b8e2c87}','Imported Cookie-Editor identity matches official Firefox extension');
 const installedAddon=await api(page,`/profiles/${firefoxId}/gecko-extensions/${addon.body.id}/install`,{confirm:true});check(installedAddon.status===200&&installedAddon.body.permanent&&installedAddon.body.addon.signatureVerified,'Actual Firefox validates and permanently installs signed Cookie-Editor');await api(page,`/profiles/${firefoxId}/stop`,{});await api(page,`/profiles/${firefoxId}/launch`,{headless:true,automation:true,url:fixture.origin});const addons=await api(page,`/profiles/${firefoxId}/gecko-extensions`);check(addons.body.addons.some(a=>a.id===addon.body.geckoExtensionId&&a.active),'Installed Firefox retains signed Cookie-Editor after restart');await api(page,`/profiles/${firefoxId}/stop`,{});
 await application.close();application=null;
 const reinstall=spawnSync(installer,['/S','/D='+install],{timeout:180000,stdio:'inherit'});check(reinstall.status===0,'Owner installer in-place reinstall succeeds');
 page=await launch();check((await api(page,`/profiles/${id}`)).status===200,'Owner in-place reinstall preserves SQLite profile data');
 await application.close();application=null;
 const uninstaller=fs.readdirSync(install).find(name=>/^Uninstall.*\.exe$/i.test(name));check(!!uninstaller,'Branded uninstaller exists');
 const removed=spawnSync(path.join(install,uninstaller),['/S'],{timeout:180000,stdio:'inherit'});check(removed.status===0,'Silent uninstaller starts successfully');
 const uninstallDeadline=Date.now()+60000;while(fs.existsSync(path.join(install,'Azwah Multi Browser Owner.exe'))&&Date.now()<uninstallDeadline)await new Promise(resolve=>setTimeout(resolve,250));
 check(!fs.existsSync(path.join(install,'Azwah Multi Browser Owner.exe')),'Silent uninstall actually removes the installed executable');
 check(fs.existsSync(path.join(userData,'data','profiles.db')),'Uninstall retains user profile database');

 const signature=spawnSync(path.join(process.env.ProgramFiles,'PowerShell/7/pwsh.exe'),['-NoProfile','-NonInteractive','-Command',"(Get-AuthenticodeSignature -LiteralPath $env:OWNER_INSTALLER).Status.ToString()"],{encoding:'utf8',timeout:15000,env:{...process.env,OWNER_INSTALLER:installer}});if(signature.status!==0)throw Error('Authenticode inspection failed: '+(signature.error?.message||signature.stderr));
 fs.appendFileSync(path.join(output,'BUILD-MANIFEST.txt'),'Authenticode: '+signature.stdout.trim()+'\n');
 fs.writeFileSync(path.join(output,'RELEASE-NOTES.md'),`# Azwah Multi Browser Ultimate — experimental\n\nOwner/Personal installer with the compact profile shell, one-line proxy entry, and the same local browser-management behavior as the verified office branch. No employee activation and no license signing key. This file does not replace azwah-multi-browser-owner-experimental.1.\n\nSource: ${process.env.GITHUB_SHA}\nInstalled Windows acceptance: https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}\n\nQualified on the Windows Server 2022 runner only. Windows 10 on the stated i5-7300U / 8 GB / HD 620 machine was not available, so this is not a Windows 10 or final-production qualification. Legacy installed-product upgrade was not run in this job. The installer is unsigned.\n\nChromium is bundled. Firefox is the copy installed on the runner, not bundled. Installed checks cover profile persistence, a controlled local HTTP proxy, timezone and language readback, cookies and localStorage across restart, encrypted restore, signed Firefox Cookie-Editor, reinstall, and uninstall that keeps the database. Screenshot files are in the job artifacts. Fingerprint controls remain limited to what stock Chromium and Firefox actually apply. No anonymity or CAPTCHA claim.\n\nAuthenticode status: ${signature.stdout.trim()}.\n`);
 fs.writeFileSync(path.join(evidence,'release-candidate.json'),JSON.stringify({source:process.env.GITHUB_SHA,filename:path.basename(installer),bytes,sha256,signature:signature.stdout.trim(),pass:results.length,fail:0,skip:0},null,2));
}catch(error){console.error('OWNER_QUALIFICATION_FAILURE',error.message);results.push({pass:false,message:error.message});process.exitCode=1;}
finally{
 if(application)await application.close().catch(()=>{});if(proxyServer){proxyServer.closeAllConnections();await new Promise(resolve=>proxyServer.close(resolve));}if(fixture)await fixture.close();
 fs.writeFileSync(path.join(evidence,'qualification.json'),JSON.stringify({sourceCommit:process.env.GITHUB_SHA,platform:process.platform,host:os.release(),edition:'Owner / Personal',results,pass:results.filter(r=>r.pass).length,fail:results.filter(r=>!r.pass).length,unverified:['Windows 10','Original Profile Manager installed upgrade','Organization-specific activation','Release artifact signing and publication']},null,2));
 fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
