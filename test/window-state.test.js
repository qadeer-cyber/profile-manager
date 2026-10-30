import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { writeWindowState, readWindowState, screenFromRememberedWindow } from '../server/window-state.js';
import { validateAdvancedSettings } from '../server/advanced-settings.js';

test('rememberLastWindow applies saved bounds to screen plan', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-win-state-'));
  process.env.PM_DATA_DIR = dataDir;
  const id = randomUUID();
  writeWindowState(id, { width: 1024, height: 768, left: 40, top: 60, maximized: false });
  const advanced = validateAdvancedSettings({ preferences: { rememberLastWindow: true }, screen: { preset: 'native' } });
  const screen = screenFromRememberedWindow(id, advanced);
  assert.equal(screen.width, 1024);
  assert.equal(screen.windowX, 40);
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.PM_DATA_DIR;
});

test('readWindowState returns null when missing', () => {
  assert.equal(readWindowState(randomUUID()), null);
});
