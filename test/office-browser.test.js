import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {spawnServer,stopServer} from './_ports.mjs';
import {adminAction} from '../scripts/license-admin/admin.mjs';
import {deviceIdentity} from '../server/office/device.js';
import {startLocalHttpFixture} from './_local-http-fixture.mjs';
async function installation(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'azwah-office-browser-')),vault=path.join(root,'admin.vault'),password='disposable-administrator-secret';
 const issuer=adminAction({command:'init',vault,password}),pub=path.join(root,'public.pem');fs.writeFileSync(pub,issuer.publicKey);
 const license=adminAction({command:'issue',vault,password,device:deviceIdentity(),expiresAt:Date.now()+600000,label:'Windows acceptance'});
 const env={...process.env,PM_DATA_DIR:path.join(root,'employee'),PM_API_TOKEN:'office-browser-api',AZWAH_OFFICE_ENFORCE:'1',AZWAH_OFFICE_PACKAGED:'0',AZWAH_ISSUER_PUBLIC_KEY_FILE:pub};delete env.PM_SECRET;let server=await spawnServer(env);
 t.after(async()=>{if(server)assert.equal(await stopServer(server),true);fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
 const headers={Authorization:'Bearer office-browser-api','Content-Type':'application/json'};
 const response=(route,body,extra={})=>fetch(server.url+'/api/v1'+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000),...extra});
 const api=async(route,body)=>{const r=await response(route,body);const text=await r.text();assert.ok(r.ok,text);return JSON.parse(text);};
 return{api,response,headers,token:license.token,url:()=>server.url,restart:async()=>{assert.equal(await stopServer(server),true);server=await spawnServer(env);}};
}
test('actual office activation UI accepts an administrator-issued offline token and exposes the explicit extension workflow',{timeout:60000},async t=>{
 const app=await installation(t),browser=await chromium.launch({headless:true,...(process.platform==='linux'&&process.getuid?.()===0?{args:['--no-sandbox']}: {})});t.after(()=>browser.close());
 const page=await browser.newPage();await page.goto(app.url());await page.getByRole('heading',{name:'Azwah Multi Browser — Office Edition',exact:true}).waitFor();
 assert.equal(await page.title(),'Azwah Multi Browser');assert.equal(await page.getByLabel('Device identity code').inputValue(),deviceIdentity());
 await page.getByLabel('Administrator license',{exact:true}).fill(app.token);await page.getByLabel('I authorize activation on this device.').check();await page.getByRole('button',{name:'Activate offline',exact:true}).click();await page.getByText('This device is activated for offline use.',{exact:true}).waitFor();
 assert.equal((await app.api('/activation')).active,true);
 await app.api('/profiles',{name:'Employee Chromium',browserEngine:'chromium'});await page.locator('[data-nav="extensions"]').click();await page.getByLabel('Cookie-Editor profile').selectOption({label:'Employee Chromium · chromium'});
 assert.equal(await page.getByRole('button',{name:'Open official installation',exact:true}).isDisabled(),true);
 await page.getByLabel('I authorize opening the official store in this profile.').check();assert.equal(await page.getByRole('button',{name:'Open official installation',exact:true}).isDisabled(),false);
});
test('official Mozilla-signed Cookie-Editor persists with cookies, isolation, restart and encrypted profile restore',{timeout:180000},async t=>{
 const file=process.env.PM_COOKIE_EDITOR_XPI;assert.ok(file&&fs.existsSync(file),'Official signed Cookie-Editor fixture is required');
 const app=await installation(t);await app.api('/activation',{token:app.token,confirm:true});const fixture=await startLocalHttpFixture();t.after(()=>fixture.close());
 const p=await app.api('/profiles',{name:'Cookie-Editor employee',browserEngine:'firefox',browserSettings:{firefoxSessionMode:'bidi',timezoneId:'UTC'}}),isolated=await app.api('/profiles',{name:'Other employee',browserEngine:'firefox',browserSettings:{firefoxSessionMode:'bidi',timezoneId:'UTC'}});
 const addon=await app.api('/gecko-extensions/import',{path:file});assert.equal(addon.geckoExtensionId,'{c3c10168-4186-445c-9c5b-63f12b8e2c87}');assert.equal(addon.version,process.env.PM_COOKIE_EDITOR_VERSION);
 const launch=id=>app.api(`/profiles/${id}/launch`,{headless:true,automation:true,url:fixture.origin});
 const read=async(id,seed=false)=>{const tree=await app.api(`/profiles/${id}/firefox/command`,{method:'browsingContext.getTree',params:{}});const result=await app.api(`/profiles/${id}/firefox/command`,{method:'script.evaluate',params:{expression:`JSON.stringify((()=>{${seed?"document.cookie='office=persistent; Max-Age=3600; Path=/; SameSite=Lax';localStorage.setItem('office','isolated');":''}return {cookie:document.cookie,storage:localStorage.getItem('office')};})())`,target:{context:tree.contexts[0].context},awaitPromise:true}});assert.equal(result.type,'success');return JSON.parse(result.result.value);};
 await launch(p.id);const installed=await app.api(`/profiles/${p.id}/gecko-extensions/${addon.id}/install`,{confirm:true});assert.equal(installed.permanent,true);assert.equal(installed.addon.signatureVerified,true);assert.equal((await read(p.id,true)).storage,'isolated');
 await app.api(`/profiles/${p.id}/stop`,{});await app.restart();await launch(p.id);assert.match((await read(p.id)).cookie,/office=persistent/);assert.ok((await app.api(`/profiles/${p.id}/gecko-extensions`)).addons.some(a=>a.id===addon.geckoExtensionId&&a.active));
 await launch(isolated.id);const separate=await read(isolated.id);assert.equal(separate.storage,null);assert.equal(separate.cookie.includes('office='),false);assert.equal((await app.api(`/profiles/${isolated.id}/gecko-extensions`)).addons.some(a=>a.id===addon.geckoExtensionId),false);await app.api(`/profiles/${isolated.id}/stop`,{});await app.api(`/profiles/${p.id}/stop`,{});
 const passphrase='office-backup-disposable-passphrase',exported=await app.response(`/profiles/${p.id}/backup/export-stream`,{passphrase,confirmSensitive:true});assert.equal(exported.status,200);const bytes=Buffer.from(await exported.arrayBuffer());assert.equal(bytes.subarray(0,4).toString(),'PMBE');
 const imported=await app.response('/backup/restore-stream?collision=rename',null,{headers:{...app.headers,'Content-Type':'application/octet-stream','X-Backup-Passphrase':passphrase},body:bytes});const result=await imported.json();assert.equal(imported.status,200,JSON.stringify(result));const copy=result.renamed[0].id;assert.notEqual(copy,p.id);await launch(copy);assert.match((await read(copy)).cookie,/office=persistent/);assert.ok((await app.api(`/profiles/${copy}/gecko-extensions`)).addons.some(a=>a.id===addon.geckoExtensionId&&a.active&&a.signatureVerified));await app.api(`/profiles/${copy}/stop`,{});
 console.log('OFFICIAL_COOKIE_EDITOR_ACCEPTANCE',JSON.stringify({engine:'firefox',version:addon.version,signatureVerified:true,restart:true,cookiePersistence:true,encryptedRestore:true,profileIsolation:true}));
});
