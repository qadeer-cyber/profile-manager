// Durable status for bulk work. Item payloads are stored after secret-bearing
// fields are removed. The passphrase and proxy passwords are not part of this record.
import crypto from 'crypto';
import { db } from './db.js';

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const SECRET_KEY = /password|passphrase|secret|token|authorization|api[-_]?key/i;

export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) continue;
      out[key] = redactSecrets(item);
    }
    return out;
  }
  return value;
}

function rowToJob(row) {
  if (!row) return null;
  let items = [];
  try { items = JSON.parse(row.summary || '[]'); } catch { items = []; }
  return {
    id: row.id,
    action: row.action,
    status: row.status,
    total: row.total,
    done: row.done,
    items,
    error: row.error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createJob(action, total) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO bulk_jobs (id,action,status,total,done,summary,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, action, 'running', total, 0, '[]', now, now);
  return id;
}

export function appendJobItem(id, item) {
  const row = db.prepare('SELECT summary, done FROM bulk_jobs WHERE id=?').get(id);
  if (!row) return;
  const items = JSON.parse(row.summary || '[]');
  items.push(redactSecrets(item));
  db.prepare('UPDATE bulk_jobs SET summary=?, done=?, updated_at=? WHERE id=?').run(JSON.stringify(items), items.length, new Date().toISOString(), id);
}

export function finishJob(id, error = null) {
  db.prepare("UPDATE bulk_jobs SET status=?, error=?, updated_at=? WHERE id=?").run(error ? 'failed' : 'done', error, new Date().toISOString(), id);
}

export function getJob(id) {
  const job = rowToJob(db.prepare('SELECT * FROM bulk_jobs WHERE id=?').get(id));
  if (!job) throw fail(404, 'job not found', 'NOT_FOUND');
  return job;
}

export function listJobs(limit = 20) {
  const n = Math.min(100, Math.max(1, Number(limit) || 20));
  return db.prepare('SELECT * FROM bulk_jobs ORDER BY created_at DESC, rowid DESC LIMIT ?').all(n).map(rowToJob);
}
