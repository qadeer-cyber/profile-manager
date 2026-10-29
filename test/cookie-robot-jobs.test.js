import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cookie-robot-'));
process.env.PM_DATA_DIR = dir;
const { db } = await import('../server/db.js');
const {
  configureCookieRobot, createCookieRobotJob, cancelCookieRobotJob, getCookieRobotJob, cookieRobotReport, retryCookieRobotJob,
} = await import('../server/cookie-robot-jobs.js');

after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.PM_DATA_DIR; });

test('cookie robot rejects invalid and blocked URLs', () => {
  configureCookieRobot({ launchProfile: async () => {} });
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,browser_engine,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, 'Chromium', '[]', '', '', 'chromium', now, now);
  assert.throws(() => createCookieRobotJob({ profileId: id, urls: ['not-a-url'] }), /Invalid URL/);
  assert.throws(() => createCookieRobotJob({ profileId: id, urls: ['https://accounts.google.com/signin'] }), err => err?.code === 'URL_NOT_ALLOWED');
});

test('cookieRobotReport documents Firefox unsupported', () => {
  const r = cookieRobotReport();
  assert.equal(r.firefox.supported, false);
  assert.ok(r.supportedEngines.includes('chromium'));
});

test('cookie robot rejects Firefox profile at create time', () => {
  configureCookieRobot({ launchProfile: async () => {} });
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,browser_engine,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, 'Firefox', '[]', '', '', 'firefox', now, now);
  assert.throws(() => createCookieRobotJob({ profileId: id, urls: ['https://example.com'] }), err => err?.code === 'FIREFOX_UNSUPPORTED');
});

test('retry failedOnly keeps successful tasks', () => {
  const pid = randomUUID();
  const jid = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,browser_engine,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(pid, 'Chromium', '[]', '', '', 'chromium', now, now);
  db.prepare('INSERT INTO cookie_robot_jobs (id,profile_id,status,tasks_json,delay_ms,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(jid, pid, 'failed', JSON.stringify([{ url: 'https://a/', status: 'ok' }, { url: 'https://b/', status: 'failed', error: 'x' }]), 1500, null, now, now);
  const retried = retryCookieRobotJob(jid, { failedOnly: true });
  assert.equal(retried.tasks[0].status, 'ok');
  assert.equal(retried.tasks[1].status, 'pending');
});

test('cookie robot job can be created and cancelled', () => {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,browser_engine,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, 'Chromium', '[]', '', '', 'chromium', now, now);
  const job = createCookieRobotJob({ profileId: id, urls: ['https://example.com'] });
  assert.equal(job.status, 'queued');
  cancelCookieRobotJob(job.id);
  assert.equal(getCookieRobotJob(job.id).status, 'cancelled');
});
