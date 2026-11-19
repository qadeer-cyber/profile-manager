// Port-scan protection must survive relaunch. Chromium split Local Network Access into
// local_network and loopback_network and migrates the legacy local_network_access default once
// (has_migrated_local_network_access). The migrated value was not persisted under the new keys,
// so from the second launch on the legacy key alone was ignored: local-network permissions fell
// back to "ask" and a public page could probe loopback ports. Even on the first launch
// loopback-network stayed "prompt". Found by the live Windows test on 30f79b5.
//
// These tests launch real Chromium with the app's own preference writer and launch arguments,
// relaunch the same profile directory several times, and check both the permission states and a
// real cross-space fetch from a public page to a loopback port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import { applyAdvancedPreferences, advancedLaunchPlan } from '../server/advanced-launch.js';
import { validateAdvancedSettings } from '../server/advanced-settings.js';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const NAMES = ['local-network-access', 'local-network', 'loopback-network'];

async function launchAndProbe(dir, settings) {
  applyAdvancedPreferences(dir, settings); // what every launch does before Chromium starts
  const target = http.createServer((req, res) => { res.setHeader('access-control-allow-origin', '*'); res.end('local-ok'); });
  const page = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>p</title>'); });
  const targetPort = await listen(target), pagePort = await listen(page);
  const plan = advancedLaunchPlan(settings, { headless: true, version: '1.0.0.0' });
  // The page origin is declared public, so a loopback fetch from it is a cross-space request.
  // Full Chromium (the build the app runs): chrome-headless-shell ignores profile content settings.
  const ctx = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true, args: [...plan.args, `--ip-address-space-overrides=127.0.0.1:${pagePort}=public`] });
  try {
    const tab = ctx.pages()[0] || await ctx.newPage();
    await tab.goto(`http://127.0.0.1:${pagePort}/`);
    return await tab.evaluate(async ({ port, names }) => {
      const states = {};
      for (const name of names) { try { states[name] = (await navigator.permissions.query({ name })).state; } catch { states[name] = 'unsupported'; } }
      let reached = false;
      try { reached = (await (await fetch(`http://127.0.0.1:${port}/probe`, { cache: 'no-store' })).text()) === 'local-ok'; } catch { reached = false; }
      return { states, reached };
    }, { port: targetPort, names: NAMES });
  } finally {
    await ctx.close();
    target.close(); page.close();
  }
}

test('port-scan protection holds on the first launch and after repeated relaunches', { timeout: 180000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-portscan-restart-'));
  const settings = validateAdvancedSettings({}); // default portScan is "real" (deny local network access)
  try {
    for (const run of [1, 2, 3, 4]) {
      const result = await launchAndProbe(dir, settings);
      for (const [name, state] of Object.entries(result.states)) {
        if (state !== 'unsupported') assert.equal(state, 'denied', `run ${run}: ${name} is ${state}`);
      }
      assert.equal(result.states['local-network-access'], 'denied', `run ${run}: legacy permission observed`);
      assert.equal(result.reached, false, `run ${run}: a public page reached a loopback port`);
    }
    const prefs = JSON.parse(fs.readFileSync(path.join(dir, 'Default', 'Preferences'), 'utf8')).profile.default_content_setting_values;
    assert.deepEqual([prefs.local_network_access, prefs.local_network, prefs.loopback_network], [2, 2, 2]);
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); }
});

test('two simultaneous profiles are each protected across relaunches', { timeout: 180000 }, async () => {
  const dirs = [fs.mkdtempSync(path.join(os.tmpdir(), 'pm-portscan-a-')), fs.mkdtempSync(path.join(os.tmpdir(), 'pm-portscan-b-'))];
  const settings = validateAdvancedSettings({});
  try {
    for (const run of [1, 2, 3]) {
      const results = await Promise.all(dirs.map(dir => launchAndProbe(dir, settings)));
      results.forEach((r, i) => {
        assert.equal(r.reached, false, `run ${run} profile ${i}: reached loopback`);
        for (const [name, state] of Object.entries(r.states)) if (state !== 'unsupported') assert.equal(state, 'denied', `run ${run} profile ${i}: ${name} is ${state}`);
      });
    }
  } finally { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 }); }
});
