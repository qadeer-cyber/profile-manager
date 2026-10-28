// Server-side profile table: filter, sort, and page the same profile objects the
// UI already lists. Saved views persist that query in SQLite.
import crypto from 'crypto';
import { db } from './db.js';

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const SORTS = new Set(['name', 'folder', 'updated_at', 'created_at', 'status', 'last_launched_at', 'tags', 'proxy']);
const QUERY_KEYS = ['q', 'tag', 'folder', 'status', 'proxy', 'sort', 'dir', 'page', 'pageSize'];

function statusRank(profile) {
  if (profile.running) return 0;
  if (profile.last_error) return 1;
  return 2;
}

export function queryProfiles(rows, query = {}) {
  const q = String(query.q || '').trim().toLowerCase();
  const tag = String(query.tag || '');
  const folder = query.folder;
  const status = String(query.status || '');
  const proxy = query.proxy == null ? '' : String(query.proxy);
  const sort = String(query.sort || 'updated_at');
  const dir = String(query.dir || 'desc') === 'asc' ? 1 : -1;
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 50) || 50));
  const page = Math.max(1, Number(query.page || 1) || 1);
  if (!SORTS.has(sort)) throw fail(400, 'sort is not supported', 'INVALID_QUERY');
  if (status && !['running', 'stopped', 'error'].includes(status)) throw fail(400, 'status filter is invalid', 'INVALID_QUERY');
  let items = rows;
  if (q) items = items.filter(profile => `${profile.name} ${profile.notes} ${profile.tags.join(' ')} ${profile.folder}`.toLowerCase().includes(q));
  if (tag) items = items.filter(profile => profile.tags.includes(tag));
  if (folder !== undefined && folder !== '__all' && folder !== '') items = items.filter(profile => profile.folder === folder);
  if (folder === '') items = items.filter(profile => profile.folder === '');
  if (status === 'running') items = items.filter(profile => profile.running);
  if (status === 'stopped') items = items.filter(profile => !profile.running && !profile.last_error);
  if (status === 'error') items = items.filter(profile => !profile.running && profile.last_error);
  if (proxy === 'none') items = items.filter(profile => !profile.proxyId && !profile.proxy_id);
  else if (proxy && proxy !== 'any') items = items.filter(profile => (profile.proxyId || profile.proxy_id) === proxy);
  const value = profile => {
    if (sort === 'status') return statusRank(profile);
    if (sort === 'tags') return profile.tags.join(',').toLowerCase();
    if (sort === 'proxy') return (profile.proxy?.host || '').toLowerCase();
    if (sort === 'name' || sort === 'folder') return String(profile[sort] || '').toLowerCase();
    return profile[sort] || '';
  };
  items = [...items].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === right) return String(a.id).localeCompare(String(b.id));
    if (left === '' || left == null) return 1;
    if (right === '' || right == null) return -1;
    return (left < right ? -1 : 1) * dir;
  });
  const total = items.length;
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total, page, pageSize, sort, dir: dir === 1 ? 'asc' : 'desc' };
}

function cleanQuery(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'query must be an object', 'INVALID_VIEW');
  const query = {};
  for (const key of QUERY_KEYS) if (key in input) query[key] = input[key];
  queryProfiles([], query);
  return query;
}

function publicView(row) {
  return { id: row.id, name: row.name, surface: row.surface, query: JSON.parse(row.query_json), createdAt: row.created_at, updatedAt: row.updated_at };
}

export function listViews(surface = 'profiles') {
  return db.prepare('SELECT * FROM saved_views WHERE surface=? ORDER BY name, rowid').all(String(surface || 'profiles')).map(publicView);
}

export function createView({ name, surface = 'profiles', query }) {
  const label = String(name || '').trim();
  if (!label || label.length > 80) throw fail(400, 'view name must be 1 to 80 characters', 'INVALID_VIEW');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO saved_views (id,name,surface,query_json,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(id, label, String(surface || 'profiles'), JSON.stringify(cleanQuery(query)), now, now);
  return publicView(db.prepare('SELECT * FROM saved_views WHERE id=?').get(id));
}

export function updateView(id, body) {
  const row = db.prepare('SELECT * FROM saved_views WHERE id=?').get(id);
  if (!row) throw fail(404, 'saved view not found', 'NOT_FOUND');
  const label = 'name' in body ? String(body.name || '').trim() : row.name;
  if (!label || label.length > 80) throw fail(400, 'view name must be 1 to 80 characters', 'INVALID_VIEW');
  const query = 'query' in body ? cleanQuery(body.query) : JSON.parse(row.query_json);
  const now = new Date().toISOString();
  db.prepare('UPDATE saved_views SET name=?, query_json=?, updated_at=? WHERE id=?').run(label, JSON.stringify(query), now, id);
  return publicView(db.prepare('SELECT * FROM saved_views WHERE id=?').get(id));
}

export function deleteView(id) {
  const result = db.prepare('DELETE FROM saved_views WHERE id=?').run(id);
  if (!result.changes) throw fail(404, 'saved view not found', 'NOT_FOUND');
}
