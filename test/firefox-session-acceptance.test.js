import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnServer, stopServer } from './_ports.mjs';
import { startLocalHttpFixture } from './_local-http-fixture.mjs';
import { validateXpiArchive } from '../server/gecko-xpi.js';
import { buildXpi } from './_xpi-fixture.mjs';
import { observeNativeWindow } from '../server/native-window-state.js';
const zones = { 'Europe/Berlin': [-60, -120], 'Asia/Tokyo': [-540,-540], UTC: [0,0] };
const expression = `({timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,jan:new Date('2026-01-15T12:00:00Z').getTimezoneOffset(),jul:new Date('2026-07-15T12:00:00Z').getTimezoneOffset(),before:new Date('2026-03-29T00:59:59Z').getTimezoneOffset(),after:new Date('2026-03-29T01:00:00Z').getTimezoneOffset(),formatted:new Intl.DateTimeFormat('de-DE',{dateStyle:'full',timeStyle:'long'}).format(new Date('2026-01-15T12:00:00Z'))})`;
async function installation(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-firefox-owner-')), token = crypto.randomBytes(24).toString('hex'); let app;
  const start = async () => { const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: token }; delete env.PM_SECRET; app = await spawnServer(env); };
  const headers = { Authorization: 'Bearer '+token, 'Content-Type': 'application/json' };
  const response = (route, body, extra = {}) => fetch(app.url+'/api/v1'+route, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000), ...extra });
  const api = async (route, body) => { const r = await response(route, body); const text = await r.text(); assert.ok(r.ok, text); return JSON.parse(text); };
  t.after(async () => { if (app) assert.equal(await stopServer(app), true); fs.rmSync(dir, { recursive:true, force:true, maxRetries:5, retryDelay:200 }); });
  await start();
  return { api, response, headers, url: () => app.url, restart: async () => { assert.equal(await stopServer(app), true); await start(); } };
}
async function evaluate(app, id, context, code) {
  const r = await app.api(`/profiles/${id}/firefox/command`, { method:'script.evaluate', params:{ expression:code, target:{context}, awaitPromise:true } });
  assert.equal(r.type, 'success', JSON.stringify(r)); return JSON.parse(r.result.value);
}
for (const manual of [false,true]) test(`Firefox owned timezone lifecycle, real frames/workers, restart and manual=${manual}`, { timeout:180000 }, async t => {
  const app = await installation(t), fixture = await startLocalHttpFixture(), cross = await startLocalHttpFixture();
  t.after(() => fixture.close()); t.after(() => cross.close());
  const profiles = [];
  for (const zone of Object.keys(zones)) profiles.push({ zone, ...(await app.api('/profiles', { name:zone, browserEngine:'firefox', browserSettings:{ timezoneId:zone, locale:'de-DE', languages:['de-DE'], firefoxSessionMode:'bidi' } })) });
  for (let restart=0; restart<2; restart++) {
    const running = [];
    for (const profile of profiles) {
      const p = await app.api(`/profiles/${profile.id}/launch`, { headless:!manual, automation:!manual, url:fixture.origin });
      assert.equal(p.firefoxSession.state, 'ready'); assert.equal(p.firefoxSession.timezone, profile.zone);
      if (manual) assert.ok(await observeNativeWindow(p.pid), 'Actual Firefox desktop window must exist');
      const command = (method, params={}) => app.api(`/profiles/${profile.id}/firefox/command`, {method,params});
      const tree = await command('browsingContext.getTree'); const context = tree.contexts[0].context;
      const read = (code, target=context) => evaluate(app,profile.id,target,code);
      const observed = await read(`JSON.stringify(${expression})`);
      assert.equal(observed.timezone,profile.zone); assert.deepEqual([observed.jan,observed.jul],zones[profile.zone]);
      assert.deepEqual([observed.before,observed.after], profile.zone==='Europe/Berlin' ? [-60,-120] : zones[profile.zone]);
      assert.equal(observed.formatted,new Intl.DateTimeFormat('de-DE',{dateStyle:'full',timeStyle:'long',timeZone:profile.zone}).format(new Date('2026-01-15T12:00:00Z')));
      for (const origin of [fixture.origin,cross.origin]) await read(`new Promise(resolve=>{const frame=document.createElement('iframe');frame.src=${JSON.stringify(origin)};frame.onload=()=>resolve(JSON.stringify(true));document.body.append(frame);})`);
      const children=(await command('browsingContext.getTree',{root:context})).contexts[0].children;
      assert.equal(children.length,2);
      for (const frame of children) assert.equal((await read(`JSON.stringify(${expression})`,frame.context)).timezone,profile.zone);
      const worker=await read(`new Promise((resolve,reject)=>{const worker=new Worker(URL.createObjectURL(new Blob([${JSON.stringify('postMessage('+expression+')')}],{type:'text/javascript'})));worker.onmessage=e=>{worker.terminate();resolve(JSON.stringify(e.data));};worker.onerror=reject;})`);
      assert.equal(worker.timezone,profile.zone); assert.deepEqual([worker.jan,worker.jul],zones[profile.zone]);
      const shared=await read(`new Promise((resolve,reject)=>{const url=URL.createObjectURL(new Blob([${JSON.stringify('onconnect=e=>e.ports[0].postMessage('+expression+')')}],{type:'text/javascript'}));const w=new SharedWorker(url);w.port.onmessage=e=>{w.port.close();resolve(JSON.stringify(e.data));};w.onerror=reject;w.port.start();})`);
      assert.equal(shared.timezone,profile.zone);
      const user=await command('browser.createUserContext');const tab=await command('browsingContext.create',{type:'tab',userContext:user.userContext});
      await command('browsingContext.navigate',{context:tab.context,url:fixture.origin,wait:'complete'});
      assert.equal((await read(`JSON.stringify(${expression})`,tab.context)).timezone,profile.zone);
      await command('browser.removeUserContext',{userContext:user.userContext});
      console.log('OWNED_FIREFOX_TIMEZONE', JSON.stringify({manual,restart,zone:profile.zone,...observed,worker,shared}));
      running.push({profile,read});
    }
    for (const {profile,read} of running) assert.equal((await read(`JSON.stringify(${expression})`)).timezone,profile.zone);
    for (const profile of profiles) await app.api(`/profiles/${profile.id}/stop`,{});
    await app.restart();
  }
});
test('owned Firefox signed extensions, busy automation, encrypted restore and shutdown', {timeout:180000}, async t=>{
  const app=await installation(t), fixture=await startLocalHttpFixture(); t.after(()=>fixture.close());
  const p=await app.api('/profiles',{name:'Owned signed Firefox',browserEngine:'firefox',browserSettings:{timezoneId:'Asia/Tokyo',locale:'de-DE',languages:['de-DE'],firefoxSessionMode:'bidi'}});
  const file=process.env.PM_SIGNED_XPI;assert.ok(file&&fs.existsSync(file),'Genuine signed XPI fixture required');
  const bytes=fs.readFileSync(file); assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),process.env.PM_SIGNED_XPI_SHA256);
  const archive=validateXpiArchive(bytes);
  const manifest=JSON.parse(archive.get('manifest.json').toString());manifest.name += ' modified';
  const modified=buildXpi(Object.fromEntries([...archive].map(([name,data])=>[name,name==='manifest.json'?JSON.stringify(manifest):data])),{deflate:true});
  const modifiedFile=path.join(os.tmpdir(),crypto.randomUUID()+'.xpi');fs.writeFileSync(modifiedFile,modified);t.after(()=>fs.rmSync(modifiedFile,{force:true}));
  const damaged=await app.api('/gecko-extensions/import',{path:modifiedFile});
  const imported=await app.api('/gecko-extensions/import',{path:file});
  const addon=imported.extension||imported;
  assert.ok(addon.id,JSON.stringify(imported));
  const launch=()=>app.api(`/profiles/${p.id}/launch`,{headless:true,automation:true,url:fixture.origin});
  await launch();
  const tree=await app.api(`/profiles/${p.id}/firefox/command`,{method:'browsingContext.getTree',params:{}});const context=tree.contexts[0].context;
  const pending=app.api(`/profiles/${p.id}/firefox/command`,{method:'script.evaluate',params:{expression:'new Promise(r=>setTimeout(()=>r(1),2000))',target:{context},awaitPromise:true}});
  await new Promise(r=>setTimeout(r,250));
  const busy=await app.response(`/profiles/${p.id}/gecko-extensions/${addon.id}/install`,{confirm:true});assert.equal(busy.status,409);assert.match(await busy.text(),/busy/i);
  await pending;
  assert.equal((await evaluate(app,p.id,context,`JSON.stringify(${expression})`)).timezone,'Asia/Tokyo');
  const rejected=await app.response(`/profiles/${p.id}/gecko-extensions/${damaged.id}/install`,{confirm:true});assert.equal(rejected.ok,false);assert.match(await rejected.text(),/sign|corrupt|invalid|install/i);
  const installed=await app.api(`/profiles/${p.id}/gecko-extensions/${addon.id}/install`,{confirm:true});assert.equal(installed.permanent,true);assert.equal(installed.addon.signatureVerified,true);
  await app.api(`/profiles/${p.id}/stop`,{});await app.restart();await launch();
  assert.ok((await app.api(`/profiles/${p.id}/gecko-extensions`)).addons.some(a=>a.id===installed.addon.id&&a.active&&a.signatureVerified));
  const passphrase='owned-profile-portable-passphrase';
  await app.api(`/profiles/${p.id}/stop`,{});
  const exported=await app.response(`/profiles/${p.id}/backup/export-stream`,{passphrase,confirmSensitive:true});assert.equal(exported.status,200);const backup=Buffer.from(await exported.arrayBuffer());
  const fresh=await installation(t);
  const restored=await fresh.response('/backup/restore-stream',null,{headers:{...fresh.headers,'Content-Type':'application/octet-stream','X-Backup-Passphrase':passphrase},body:backup});assert.equal(restored.status,200,await restored.text());
  await fresh.api(`/profiles/${p.id}/launch`,{headless:true,automation:true,url:fixture.origin});
  assert.ok((await fresh.api(`/profiles/${p.id}/gecko-extensions`)).addons.some(a=>a.id===installed.addon.id&&a.active&&a.signatureVerified));
  const freshTree=await fresh.api(`/profiles/${p.id}/firefox/command`,{method:'browsingContext.getTree',params:{}});
  assert.equal((await evaluate(fresh,p.id,freshTree.contexts[0].context,`JSON.stringify(${expression})`)).timezone,'Asia/Tokyo');
  await fresh.api(`/profiles/${p.id}/stop`,{});
  await launch();
  await app.api(`/profiles/${p.id}/gecko-extensions/${addon.id}/remove`,{confirm:true});
  await app.api(`/profiles/${p.id}/stop`,{});await launch();
  assert.equal((await app.api(`/profiles/${p.id}/gecko-extensions`)).addons.some(a=>a.id===installed.addon.id),false);
  await app.api(`/profiles/${p.id}/stop`,{});
});
