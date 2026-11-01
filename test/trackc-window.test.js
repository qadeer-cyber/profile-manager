import './_isolated-data.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { userDataDir } from '../server/db.js';
import { writeWindowState, readWindowState, windowStatePath, screenFromRememberedWindow, clampRememberedWindow, captureWindowStateForSession } from '../server/window-state.js';
import { parseWmctrl } from '../server/native-window-state.js';
import { parseXrandr } from '../server/window-placement.js';
import { validateAdvancedSettings } from '../server/advanced-settings.js';
test('observed maximized CDP state is retained without treating configuration as observation', async () => {
  const id = crypto.randomUUID(); let detached = 0;
  const entry = { rememberWindow: true, ctx: { pages: () => [{ context: () => ({ newCDPSession: async () => ({ send: async () => ({ bounds: { width: 1280, height: 900, left: -1280, top: 0, windowState: 'maximized' } }), detach: async () => detached++ }) }) }] } };
  const observed = await captureWindowStateForSession(id, entry); assert.equal(observed.maximized, true); assert.equal(observed.source, 'cdp-browser-window'); assert.equal(detached, 1);
  const plan = screenFromRememberedWindow(id, { preferences: { rememberLastWindow: true }, screen: {} });
  assert.equal(plan.startMaximized, true); assert.equal(plan.windowX, null); assert.doesNotThrow(() => validateAdvancedSettings({ screen: plan }));
  assert.equal(await captureWindowStateForSession(id, { ...entry, diagnosticHeadless: true }), null);
});
test('negative monitor coordinates persist; disconnected monitor falls back without corrupting saved state', () => {
  const id = crypto.randomUUID(), state = { width: 1000, height: 750, left: -1500, top: -100, maximized: false };
  writeWindowState(id, state); assert.equal(readWindowState(id).left, -1500);
  assert.equal(clampRememberedWindow(state, [{ x: -1920, y: -200, width: 1920, height: 1080 }]).left, -1500);
  assert.equal(clampRememberedWindow(state, [{ x: 0, y: 0, width: 1366, height: 768 }]).left, 0);
  assert.equal(readWindowState(id).left, -1500);
  assert.doesNotThrow(() => validateAdvancedSettings({ screen: { preset: 'custom', width: 1000, height: 750, viewportWidth: 1000, viewportHeight: 750, windowX: -1500, windowY: -100 } }));
  assert.equal(parseXrandr('HDMI-1 connected 1920x1080-1920+0').at(0).x, -1920);
});
test('invalid and truncated window state is ignored; rejected writes preserve the previous record', () => {
  const id = crypto.randomUUID(); writeWindowState(id, { width: 900, height: 700, left: 30, top: 40, maximized: false });
  const before = fs.readFileSync(windowStatePath(id));
  assert.throws(() => writeWindowState(id, { width: NaN })); assert.deepEqual(fs.readFileSync(windowStatePath(id)), before);
  assert.equal(fs.readdirSync(userDataDir(id)).filter(n => n.endsWith('.tmp')).length, 0);
  fs.writeFileSync(windowStatePath(id), '{'); assert.equal(readWindowState(id), null);
  assert.throws(() => writeWindowState('../escape', { width: 900, height: 700, left: 0, top: 0, maximized: false }));
});
test('window manager parser requires both maximize states and the correct process owner', () => {
  const listing = '0x04200001 0 321 -1000 10 1000 750 host Browser';
  assert.equal(parseWmctrl(listing, 322), null);
  assert.equal(parseWmctrl(listing, 321, '_NET_WM_STATE_MAXIMIZED_VERT').maximized, false);
  assert.equal(parseWmctrl(listing, 321, '_NET_WM_STATE_MAXIMIZED_VERT, _NET_WM_STATE_MAXIMIZED_HORZ').maximized, true);
});
