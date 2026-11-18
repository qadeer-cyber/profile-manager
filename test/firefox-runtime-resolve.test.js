import './_isolated-data.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveFirefoxExecutable } from '../server/browser-runtime/firefox-launch.js';

test('a packaged or no-system process uses the bundled Firefox and ignores a system install', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-resolve-'));
  const bundled = path.join(root, 'bundled');
  const system = path.join(root, 'Program Files', 'Mozilla Firefox');
  fs.mkdirSync(bundled, {recursive: true});
  fs.mkdirSync(system, {recursive: true});
  fs.writeFileSync(path.join(bundled, 'firefox.exe'), '');
  fs.writeFileSync(path.join(system, 'firefox.exe'), '');
  const saved = {
    resources: process.env.PM_FIREFOX_RESOURCES,
    closed: process.env.PM_FIREFOX_NO_SYSTEM,
    packaged: process.env.PM_PACKAGED,
    explicit: process.env.PM_FIREFOX_EXECUTABLE,
    programFiles: process.env.ProgramFiles,
  };
  try {
    delete process.env.PM_FIREFOX_EXECUTABLE;
    process.env.ProgramFiles = path.join(root, 'Program Files');
    process.env.PM_FIREFOX_RESOURCES = bundled;
    process.env.PM_FIREFOX_NO_SYSTEM = '1';
    process.env.PM_PACKAGED = '1';
    assert.equal(resolveFirefoxExecutable(), path.join(bundled, 'firefox.exe'));
    fs.rmSync(path.join(bundled, 'firefox.exe'));
    assert.equal(resolveFirefoxExecutable(), null);
    if (process.platform === 'win32') {
      delete process.env.PM_PACKAGED;
      delete process.env.PM_FIREFOX_NO_SYSTEM;
      delete process.env.PM_FIREFOX_RESOURCES;
      assert.equal(resolveFirefoxExecutable(), path.join(system, 'firefox.exe'));
    }
  } finally {
    for (const [key, value] of Object.entries({
      PM_FIREFOX_RESOURCES: saved.resources,
      PM_FIREFOX_NO_SYSTEM: saved.closed,
      PM_PACKAGED: saved.packaged,
      PM_FIREFOX_EXECUTABLE: saved.explicit,
      ProgramFiles: saved.programFiles,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, {recursive: true, force: true});
  }
});
