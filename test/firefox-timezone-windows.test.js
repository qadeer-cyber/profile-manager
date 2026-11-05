import './_isolated-data.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { userDataDir } from '../server/db.js';
import { buildFirefoxLaunchPlan, launchFirefoxNative } from '../server/browser-runtime/firefox-launch.js';
import { connectFirefoxBidi, setFirefoxTimezone } from '../server/firefox-bidi.js';
import { connectMarionette } from '../server/marionette-client.js';
import { killTree } from '../server/proc.js';
import { startLocalHttpFixture } from './_local-http-fixture.mjs';
const freePort = () => new Promise(resolve => { const server = net.createServer().listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
const surface = `({timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,jan:new Date('2026-01-15T12:00:00Z').getTimezoneOffset(),jul:new Date('2026-07-15T12:00:00Z').getTimezoneOffset(),formatted:new Intl.DateTimeFormat('de-DE',{dateStyle:'full',timeStyle:'long'}).format(new Date('2026-01-15T12:00:00Z'))})`;
test('supported Firefox BiDi timezone overrides isolate Date/Intl, frames, workers, restart and Marionette', { timeout: 180000 }, async t => {
  const page = await startLocalHttpFixture(); t.after(() => page.close());
  const otherOrigin = await startLocalHttpFixture(); t.after(() => otherOrigin.close());
  const profiles = ['Europe/Berlin','Asia/Tokyo','UTC'].map(zone => ({ id: crypto.randomUUID(), zone }));
  for (let restart = 0; restart < 2; restart++) {
    const browsers = [];
    try {
      for (const profile of profiles) {
        const port = await freePort();
        const plan = await buildFirefoxLaunchPlan({ id: profile.id, browserSettings: { timezoneId: profile.zone, locale: 'de-DE', languages: ['de-DE'] } }, { userDataDirFn: userDataDir, opts: { headless: true, automation: true } });
        plan.args.push('--remote-debugging-port', String(port));
        const native = await launchFirefoxNative(plan);
        const record = { native, plan }; browsers.push(record);
        const client = await connectFirefoxBidi(port); record.client = client;
        await client.command('session.new', { capabilities: {} });
        await setFirefoxTimezone(client, profile.zone);
        const tree = await client.command('browsingContext.getTree');
        const context = tree.contexts[0].context;
        await client.command('browsingContext.navigate', { context, url: page.origin, wait: 'complete' });
        const read = async (expression, target = context) => {
          const result = await client.command('script.evaluate', { expression, target: { context: target }, awaitPromise: true });
          assert.equal(result.type, 'success', JSON.stringify(result)); return JSON.parse(result.result.value);
        };
        record.read = read; record.profile = profile;
        const result = await read(`JSON.stringify(${surface})`);
        const offsets = profile.zone === 'Europe/Berlin' ? [-60,-120] : profile.zone === 'Asia/Tokyo' ? [-540,-540] : [0,0];
        assert.equal(result.timezone, profile.zone); assert.deepEqual([result.jan,result.jul], offsets);
        assert.equal(result.formatted, new Intl.DateTimeFormat('de-DE', { dateStyle: 'full', timeStyle: 'long', timeZone: profile.zone }).format(new Date('2026-01-15T12:00:00Z')));
        console.log('FIREFOX_TIMEZONE_OBSERVATION', JSON.stringify({ restart, zone: profile.zone, ...result }));
        for (const origin of [page.origin, otherOrigin.origin]) {
          await read(`new Promise(resolve=>{const f=document.createElement('iframe'); f.src=${JSON.stringify(origin)};f.onload=()=>resolve(JSON.stringify(true));document.body.append(f);})`);
        }
        const children = (await client.command('browsingContext.getTree', { root: context })).contexts[0].children;
        for (const frame of children) assert.equal((await read(`JSON.stringify(${surface})`, frame.context)).timezone, profile.zone);
        const worker = await read(`new Promise((resolve,reject)=>{const w=new Worker(URL.createObjectURL(new Blob(['postMessage(${surface})'],{type:'text/javascript'})));w.onmessage=e=>{w.terminate();resolve(JSON.stringify(e.data));};w.onerror=reject;})`);
        assert.equal(worker.timezone, profile.zone); assert.deepEqual([worker.jan,worker.jul], offsets);
        const marionette = await connectMarionette(plan.marionettePort);
        try {
          await marionette.command('WebDriver:NewSession', {});
          await marionette.command('Marionette:SetContext', { value: 'content' });
          await marionette.command('WebDriver:Navigate', { url: page.origin });
          const observed = await marionette.command('WebDriver:ExecuteScript', { script: 'return Intl.DateTimeFormat().resolvedOptions().timeZone;', args: [] });
          assert.equal(observed?.value ?? observed, profile.zone);
          await marionette.command('WebDriver:DeleteSession');
        } finally { marionette.close(); }
      }
      for (const browser of browsers) assert.equal((await browser.read(`JSON.stringify(${surface})`)).timezone, browser.profile.zone);
    } finally {
      for (const browser of browsers) {
        browser.client?.close();
        await killTree(browser.native.spawnPid, { expect: browser.plan.profileDir });
        await killTree(browser.native.browserPid, { expect: browser.plan.profileDir });
      }
    }
  }
});
