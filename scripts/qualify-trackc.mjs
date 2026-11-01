// Source qualification only. No installer, publication, external credentials or user profiles.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
const root = path.resolve('build-evidence/trackc'); fs.mkdirSync(root, { recursive: true });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const suites = ['test:unit','test:stabilization','test:data-recovery','test:browser-runtime','test:m4','test:trackc','test:api','test:security','test:ui','test:trackc:acceptance'];
const results = [];
for (const suite of suites) {
  const log = path.join(root, suite.replaceAll(':','-') + '.log'), fd = fs.openSync(log, 'w');
  const start = new Date().toISOString();
  // npm.cmd requires cmd on Windows; suite names are fixed, never user input.
  const child = spawn(npm, ['run', suite], { shell: process.platform === 'win32', stdio: ['ignore', fd, fd], windowsHide: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
  }, 240000);
  const code = await new Promise(resolve => { child.once('error', e => { fs.writeSync(fd, e.message); resolve(1); }); child.once('close', resolve); });
  clearTimeout(timer); fs.closeSync(fd);
  const text = fs.readFileSync(log, 'utf8');
  const totals = {};
  for (const key of ['tests','pass','fail','skipped','cancelled']) {
    const matches = [...text.matchAll(new RegExp(`(?:#|ℹ) ${key} (\\d+)`, 'g'))];
    if (matches.length) totals[key] = matches.reduce((n, match) => n + Number(match[1]), 0);
  }
  if (!Object.keys(totals).length) {
    const matches = [...text.matchAll(/^(\d+) passed, (\d+) failed\s*$/gm)];
    if (matches.length) {
      totals.pass = matches.reduce((n, match) => n + Number(match[1]), 0);
      totals.fail = matches.reduce((n, match) => n + Number(match[2]), 0);
      totals.tests = totals.pass + totals.fail;
    }
  }
  const result = { suite, start, finished: new Date().toISOString(), exitCode: code, timedOut, totals, log: path.basename(log), logSHA256: crypto.createHash('sha256').update(fs.readFileSync(log)).digest('hex') };
  results.push(result); console.log(JSON.stringify(result));
  fs.writeFileSync(path.join(root, 'qualification.json'), JSON.stringify({ sourceCommit: process.env.GITHUB_SHA || null, platform: process.platform, node: process.version, results }, null, 2));
}
process.exitCode = results.some(r => r.exitCode !== 0 || r.timedOut) ? 1 : 0;
