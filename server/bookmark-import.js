// Bookmarks import and HTML export for stopped Chromium profiles.
//
// Accepted input (auto-detected):
//   - Chromium's own "Bookmarks" JSON ({ roots: { bookmark_bar, other, synced } })
//   - AZWAH's bookmarks export JSON ({ bookmarks: [{ name, url, folder: "Bookmarks bar / A / B" }] })
//   - Netscape bookmark HTML, the standard browser export format (<DL><DT><H3>/<A HREF>)
//
// Policy (documented in docs/bookmarks-import.md):
//   - Only http(s) URLs are imported; javascript:, data:, file: and others are rejected per item.
//   - Duplicate = same URL already present in the same folder path (in the profile or earlier in
//     the same file). Duplicates are skipped and counted, never overwritten.
//   - Existing bookmarks are kept. Imported items are appended into matching folders.
//   - The Bookmarks file is replaced atomically (temp file + rename). A failed import leaves the
//     previous file untouched; an unreadable existing file stops the import.
//   - Names and folders are data only. They never become file paths.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromiumProfileDefaultDir, readProfileBookmarks } from './profile-browser-export.js';
import { acquireLock, releaseLock } from './lock.js';

export const LIMITS = Object.freeze({ bytes: 5 * 1024 * 1024, items: 5000, depth: 20, title: 1024, url: 8192 });
const ROOTS = { 'bookmarks bar': 'bookmark_bar', 'bookmarks toolbar': 'bookmark_bar', other: 'other', 'other bookmarks': 'other', mobile: 'synced', 'mobile bookmarks': 'synced' };
const TOP_HEADINGS = { 'other bookmarks': 'other', 'mobile bookmarks': 'synced' };
const ROOT_LABEL = { bookmark_bar: 'Bookmarks bar', other: 'Other bookmarks', synced: 'Mobile bookmarks' };
const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, LIMITS.title);
// Chrome stores times as microseconds since 1601-01-01.
const chromeNow = () => String((BigInt(Date.now()) + 11644473600000n) * 1000n);

function checkUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text || text.length > LIMITS.url) return { error: 'URL is empty or too long' };
  let url;
  try { url = new URL(text); } catch { return { error: 'URL is not valid' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: `${url.protocol.replace(':', '')} URLs are not imported` };
  return { url: url.href };
}

// ---------- parsing into { root, folders[], name, url } ----------
function fromChromiumJson(data) {
  const items = [];
  const walk = (node, root, folders, depth) => {
    if (!node || typeof node !== 'object') return;
    if (depth > LIMITS.depth) throw fail(400, `Bookmark folders are nested more than ${LIMITS.depth} levels`, 'BOOKMARKS_TOO_DEEP');
    if (node.type === 'url') items.push({ root, folders, name: node.name, url: node.url });
    else if (Array.isArray(node.children)) for (const child of node.children) walk(child, root, child?.type === 'folder' ? [...folders, clean(child.name)] : folders, depth + 1);
  };
  for (const [key, root] of [['bookmark_bar', 'bookmark_bar'], ['other', 'other'], ['synced', 'synced']]) {
    const node = data.roots?.[key];
    if (!node) continue;
    for (const child of Array.isArray(node.children) ? node.children : []) walk(child, root, child?.type === 'folder' ? [clean(child.name)] : [], 1);
  }
  return items;
}

function fromAzwahJson(data) {
  return data.bookmarks.map(b => {
    if (!b || typeof b !== 'object') return { root: 'other', folders: [], name: '', url: '' };
    const parts = String(b.folder ?? '').split(' / ').map(clean).filter(Boolean);
    const root = ROOTS[(parts[0] || '').toLowerCase()] || 'other';
    const folders = ROOTS[(parts[0] || '').toLowerCase()] ? parts.slice(1) : parts;
    if (folders.length > LIMITS.depth) throw fail(400, `Bookmark folders are nested more than ${LIMITS.depth} levels`, 'BOOKMARKS_TOO_DEEP');
    return { root, folders, name: b.name, url: b.url };
  });
}

// Browser exports write UTF-8 text and escape only the XML characters; numeric references and
// &nbsp; also appear. Other named entities are left as written rather than guessed.
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
const decodeEntities = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e) => {
  const k = e.toLowerCase();
  if (!k.startsWith('#')) return NAMED[k] ?? whole;
  const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
  return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
});
const attr = (tag, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag); return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : null; };

// A small tokenizer for the Netscape format: it only understands <H3>, <A>, <DL> and </DL>.
function fromNetscapeHtml(html) {
  if (!/<dl[\s>]/i.test(html)) throw fail(400, 'The HTML file is not a bookmarks export (no <DL> list found)', 'INVALID_BOOKMARKS');
  const items = [];
  const stack = [];
  let pending = null; // folder heading waiting for its <DL>
  const re = /<(h3|a)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<(\/?)dl\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) {
      const tag = m[1].toLowerCase(), text = clean(decodeEntities(m[3].replace(/<[^>]*>/g, '')));
      if (tag === 'h3') pending = { name: text, toolbar: /personal_toolbar_folder\s*=\s*"?true/i.test(m[2]) };
      else {
        // Chrome writes the bookmarks bar as a PERSONAL_TOOLBAR_FOLDER heading, "Other bookmarks"
        // children at the top level and mobile ones under a "Mobile bookmarks" heading.
        const where = stack.filter(Boolean);
        const toolbar = where.findIndex(f => f.toolbar);
        const topRoot = toolbar < 0 && where.length && TOP_HEADINGS[where[0].name.toLowerCase()];
        const root = toolbar >= 0 ? 'bookmark_bar' : topRoot || 'other';
        const folders = (toolbar >= 0 ? where.slice(toolbar + 1) : topRoot ? where.slice(1) : where).map(f => f.name);
        items.push({ root, folders, name: text, url: attr(m[2], 'href') });
      }
    } else if (m[4] === '/') stack.pop();
    else {
      stack.push(pending); // null for the outer list
      pending = null;
      if (stack.filter(Boolean).length > LIMITS.depth) throw fail(400, `Bookmark folders are nested more than ${LIMITS.depth} levels`, 'BOOKMARKS_TOO_DEEP');
    }
  }
  return items;
}

export function parseBookmarkFile(content) {
  if (typeof content !== 'string') throw fail(400, 'Bookmarks content must be text', 'INVALID_BOOKMARKS');
  if (Buffer.byteLength(content) > LIMITS.bytes) throw fail(413, 'Bookmarks file is larger than 5 MB', 'BOOKMARKS_TOO_LARGE');
  const text = content.replace(/^﻿/, '').trim();
  if (!text) throw fail(400, 'Bookmarks file is empty', 'INVALID_BOOKMARKS');
  let items, format;
  if (text.startsWith('{') || text.startsWith('[')) {
    let data;
    try { data = JSON.parse(text); } catch { throw fail(400, 'Bookmarks JSON is not valid JSON', 'INVALID_BOOKMARKS'); }
    if (data && typeof data === 'object' && data.roots && typeof data.roots === 'object') { items = fromChromiumJson(data); format = 'chromium-json'; }
    else if (data && Array.isArray(data.bookmarks)) { items = fromAzwahJson(data); format = 'azwah-json'; }
    else throw fail(400, 'JSON is neither a Chromium Bookmarks file nor an AZWAH bookmarks export', 'INVALID_BOOKMARKS');
  } else if (/<!doctype netscape-bookmark-file|<dl[\s>]/i.test(text)) { items = fromNetscapeHtml(text); format = 'netscape-html'; }
  else throw fail(400, 'Unrecognized bookmarks format. Use Chromium Bookmarks JSON, an AZWAH export, or browser-export HTML.', 'INVALID_BOOKMARKS');
  if (items.length > LIMITS.items) throw fail(413, `More than ${LIMITS.items} bookmarks`, 'BOOKMARKS_TOO_LARGE');
  return { format, items };
}

// ---------- merging into a Chromium Bookmarks tree ----------
function emptyTree() {
  const root = (id, name) => ({ children: [], date_added: chromeNow(), date_modified: '0', guid: randomUUID(), id: String(id), name, type: 'folder' });
  return { roots: { bookmark_bar: root(1, 'Bookmarks bar'), other: root(2, 'Other bookmarks'), synced: root(3, 'Mobile bookmarks') }, version: 1 };
}
function maxId(node) { let max = Number(node?.id) || 0; for (const c of node?.children || []) max = Math.max(max, maxId(c)); return max; }

export function mergeBookmarks(existingTree, items) {
  const tree = existingTree ? structuredClone(existingTree) : emptyTree();
  const base = emptyTree();
  tree.roots ||= {};
  for (const key of ['bookmark_bar', 'other', 'synced']) {
    if (!tree.roots[key] || typeof tree.roots[key] !== 'object') tree.roots[key] = base.roots[key];
    tree.roots[key].children ||= [];
  }
  let nextId = Math.max(...Object.values(tree.roots).map(maxId), 3) + 1;
  const result = { imported: 0, duplicates: 0, rejected: [], foldersCreated: 0 };
  const urlsIn = folder => new Set((folder.children || []).filter(c => c.type === 'url').map(c => c.url));
  items.forEach((item, index) => {
    const checked = checkUrl(item.url);
    if (checked.error) { result.rejected.push({ index, reason: checked.error }); return; }
    let folder = tree.roots[item.root] || tree.roots.other;
    for (const name of item.folders.filter(Boolean)) {
      let next = folder.children.find(c => c.type === 'folder' && c.name === name);
      if (!next) {
        next = { children: [], date_added: chromeNow(), date_modified: '0', guid: randomUUID(), id: String(nextId++), name, type: 'folder' };
        folder.children.push(next);
        result.foldersCreated++;
      }
      folder = next;
    }
    if (urlsIn(folder).has(checked.url)) { result.duplicates++; return; }
    folder.children.push({ date_added: chromeNow(), guid: randomUUID(), id: String(nextId++), name: clean(item.name) || checked.url, type: 'url', url: checked.url });
    result.imported++;
  });
  // Chrome recomputes the checksum; a stale one would make it distrust the file.
  delete tree.checksum;
  return { tree, result };
}

// Imports into a stopped profile's on-disk Bookmarks, holding the profile lock so a launch cannot
// start halfway through. `rename` is injectable so tests can simulate an interrupted write.
export function importBookmarksIntoProfile(userDataRoot, content, { rename = fs.renameSync } = {}) {
  const parsed = parseBookmarkFile(content);
  fs.mkdirSync(userDataRoot, { recursive: true });
  acquireLock(userDataRoot);
  try { return writeImport(userDataRoot, parsed, rename); } finally { releaseLock(userDataRoot); }
}

function writeImport(userDataRoot, parsed, rename) {
  const dir = chromiumProfileDefaultDir(userDataRoot);
  const file = path.join(dir, 'Bookmarks');
  let existing = null;
  if (fs.existsSync(file)) {
    try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { throw fail(409, 'The profile’s existing Bookmarks file is unreadable, so nothing was imported. Open the profile once to let Chrome repair it, then try again.', 'BOOKMARKS_EXISTING_INVALID'); }
  }
  const { tree, result } = mergeBookmarks(existing, parsed.items);
  if (result.imported || result.foldersCreated) {
    fs.mkdirSync(dir, { recursive: true });
    const temp = path.join(dir, `Bookmarks.azwah-import-${process.pid}.tmp`);
    try { fs.writeFileSync(temp, JSON.stringify(tree, null, 3)); rename(temp, file); }
    catch (error) { fs.rmSync(temp, { force: true }); throw fail(500, `Bookmarks were not changed: ${error.code || error.message}`, 'BOOKMARKS_WRITE_FAILED'); }
  }
  return { format: parsed.format, total: parsed.items.length, ...result };
}

// ---------- Netscape HTML export ----------
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function bookmarksToNetscapeHtml(userDataRoot) {
  const file = path.join(chromiumProfileDefaultDir(userDataRoot), 'Bookmarks');
  if (!fs.existsSync(file)) return renderHtml(emptyTree());
  let tree;
  try { tree = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw fail(409, 'The profile’s Bookmarks file is unreadable', 'BOOKMARKS_EXISTING_INVALID'); }
  return renderHtml(tree);
}
function renderHtml(tree) {
  const out = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<!-- Exported by AZWAH. -->', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>', '<DL><p>'];
  const node = (n, indent, toolbar = false) => {
    if (n.type === 'url') { out.push(`${indent}<DT><A HREF="${esc(n.url)}">${esc(n.name)}</A>`); return; }
    out.push(`${indent}<DT><H3${toolbar ? ' PERSONAL_TOOLBAR_FOLDER="true"' : ''}>${esc(n.name)}</H3>`, `${indent}<DL><p>`);
    for (const c of n.children || []) node(c, indent + '    ');
    out.push(`${indent}</DL><p>`);
  };
  const roots = tree.roots || {};
  if (roots.bookmark_bar?.children?.length) node({ ...roots.bookmark_bar, name: ROOT_LABEL.bookmark_bar }, '    ', true);
  for (const child of roots.other?.children || []) node(child, '    ');
  if (roots.synced?.children?.length) node({ ...roots.synced, name: ROOT_LABEL.synced }, '    ');
  out.push('</DL><p>');
  return out.join('\n') + '\n';
}

export { readProfileBookmarks };
