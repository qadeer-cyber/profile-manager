import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

test('installed prototype isolates two sandboxed browser profiles, including after forced termination', { timeout: 180000 }, async () => {
  assert.equal(process.platform, 'win32');
  const executable = path.resolve(process.env.AZWAH_ENGINE_EXE);
  const fixture = createServer((req, res) => res.end('<title>Azwah test fixture</title>'));
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${fixture.address().port}`;
  const live = new Set();
  const first = { id: randomUUID(), timezone: 'America/Los_Angeles', location: { latitude: 37.4, longitude: -122.1, accuracy: 65000 } };
  const second = { id: randomUUID(), timezone: 'Asia/Tokyo', location: { latitude: 35.7, longitude: 139.7, accuracy: 50000 } };
  const root = id => path.join(process.env.APPDATA, 'Azwah Privacy Prototype', id);
  const kill = pid => spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8', timeout: 15000 });

  async function run(profile, { marker, hold, host = origin } = {}) {
    const dir = root(profile.id);
    const report = path.join(dir, 'evidence.json');
    fs.rmSync(report, { force: true });
    fs.rmSync(path.join(dir, 'evidence.pending'), { force: true });
    const args = [`--azwah-profile=${profile.id}`, `--azwah-url=${host}`, '--azwah-verify'];
    if (marker) args.push(`--azwah-fixture-marker=${marker}`);
    if (hold) args.push('--azwah-fixture-hold');
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    live.add(child);
    let stderr = '';
    child.stdout.resume();
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-3000); });
    const exited = once(child, 'exit');
    exited.catch(() => {});
    child.on('exit', () => live.delete(child));
    for (let i = 0; i < 160 && !fs.existsSync(report) && child.exitCode === null; i++) await delay(200);
    assert.ok(fs.existsSync(report), `No installed browser evidence. Exit: ${child.exitCode}. ${stderr}`);
    const result = JSON.parse(fs.readFileSync(report, 'utf8'));
    assert.equal(result.executable.toLowerCase(), executable.toLowerCase());
    assert.equal(result.packaged, true);
    assert.equal(result.sandboxed, true);
    assert.equal(result.nodeExposed, false);
    assert.equal(result.camera, 'denied');
    assert.match(result.chromium, /^\d+\./);
    assert.equal(result.timezone, profile.timezone);
    assert.deepEqual(result.position, profile.location);
    console.log(JSON.stringify({ executable: result.executable, chromium: result.chromium, sandboxed: result.sandboxed,
      position: result.position, timezone: result.timezone, camera: result.camera }));
    if (hold) {
      assert.equal(kill(child.pid).status, 0);
      await exited;
    } else {
      assert.equal((await exited)[0], 0, stderr);
    }
    return result;
  }

  try {
    for (const profile of [first, second]) {
      fs.mkdirSync(root(profile.id), { recursive: true });
      fs.writeFileSync(path.join(root(profile.id), 'profile.json'), JSON.stringify({
        version: 1, timezone: profile.timezone, location: profile.location, geolocationOrigin: origin,
      }));
    }
    const seedA = await run(first, { marker: 'profile_a' });
    const seedB = await run(second, { marker: 'profile_b' });
    for (const result of [seedA, seedB]) {
      assert.equal(result.stored, null);
      assert.equal(result.cookie, '');
    }
    const readA = await run(first, { hold: true });
    const readB = await run(second);
    assert.equal(readA.stored, 'profile_a');
    assert.equal(readA.cookie, 'azwah_fixture=profile_a');
    assert.equal(readB.stored, 'profile_b');
    assert.equal(readB.cookie, 'azwah_fixture=profile_b');
    const recovered = await run(first);
    assert.equal(recovered.stored, 'profile_a');
    assert.equal(recovered.cookie, 'azwah_fixture=profile_a');
  } finally {
    for (const child of live) if (child.pid) kill(child.pid);
    fixture.close();
    fixture.closeAllConnections();
    for (const { id } of [first, second]) fs.rmSync(root(id), { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
  }
});
