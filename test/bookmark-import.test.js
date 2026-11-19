// Bookmarks import into stopped Chromium profiles: parsing, merge policy, safety and round trips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseBookmarkFile, mergeBookmarks, importBookmarksIntoProfile, bookmarksToNetscapeHtml, LIMITS } from '../server/bookmark-import.js';
import { readProfileBookmarks } from '../server/profile-browser-export.js';
import { acquireLock, releaseLock, LOCK_NAME } from '../server/lock.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pm-bmi-'));
const bookmarksFile = dir => path.join(dir, 'Default', 'Bookmarks');
const readTree = dir => JSON.parse(fs.readFileSync(bookmarksFile(dir), 'utf8'));
const flat = dir => readProfileBookmarks(dir).bookmarks.map(b => `${b.folder} | ${b.name} | ${b.url}`);
const writeTree = (dir, tree) => { fs.mkdirSync(path.join(dir, 'Default'), { recursive: true }); fs.writeFileSync(bookmarksFile(dir), JSON.stringify(tree)); };

const folder = (name, children, id = '0') => ({ type: 'folder', name, id, children });
const url = (name, href, id = '0') => ({ type: 'url', name, url: href, id });
const chromium = (bar = [], other = []) => ({ roots: { bookmark_bar: folder('Bookmarks bar', bar, '1'), other: folder('Other bookmarks', other, '2'), synced: folder('Mobile bookmarks', [], '3') }, version: 1 });

const NESTED = chromium([
  url('Top', 'https://top.test/'),
  folder('Work', [url('Docs', 'https://docs.test/a?x=1&y=2'), folder('Deep', [folder('Deeper', [url('Leaf', 'https://leaf.test/')])])]),
], [url('Elsewhere', 'https://other.test/')]);

const HTML = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://bar.test/" ADD_DATE="1">On the bar</A>
        <DT><H3>Shop &amp; Co</H3>
        <DL><p>
            <DT><A HREF="https://shop.test/?a=1&amp;b=2">Caf&#233;&nbsp;&#x1F600; &lt;b&gt; &copy;</A>
        </DL><p>
    </DL><p>
    <DT><H3>Imported from Firefox</H3>
    <DL><p>
        <DT><A HREF='https://ff.test/'>Firefox site</A>
    </DL><p>
    <DT><H3>Mobile bookmarks</H3>
    <DL><p>
        <DT><A HREF="https://phone.test/">Phone</A>
    </DL><p>
    <DT><A HREF="https://loose.test/">Loose</A>
</DL><p>`;

test('Chromium JSON: nested folders, titles and URLs are preserved', () => {
  const dir = tmp();
  const result = importBookmarksIntoProfile(dir, JSON.stringify(NESTED));
  assert.deepEqual([result.format, result.imported, result.duplicates, result.rejected.length], ['chromium-json', 4, 0, 0]);
  assert.deepEqual(flat(dir), [
    'Bookmarks bar | Top | https://top.test/',
    'Bookmarks bar / Work | Docs | https://docs.test/a?x=1&y=2',
    'Bookmarks bar / Work / Deep / Deeper | Leaf | https://leaf.test/',
    'Other | Elsewhere | https://other.test/',
  ]);
  const tree = readTree(dir);
  const ids = [];
  const walk = n => { ids.push(n.id); for (const c of n.children || []) walk(c); };
  Object.values(tree.roots).forEach(walk);
  assert.equal(new Set(ids).size, ids.length, 'every node gets a unique id');
  assert.equal('checksum' in tree, false, 'no stale checksum');
  assert.equal(fs.existsSync(path.join(dir, LOCK_NAME)), false, 'lock released');
});

test('Netscape HTML: toolbar folder maps to the bookmarks bar; entities and Unicode decode', () => {
  const dir = tmp();
  const result = importBookmarksIntoProfile(dir, HTML);
  assert.equal(result.format, 'netscape-html');
  assert.equal(result.imported, 5);
  assert.deepEqual(flat(dir), [
    'Bookmarks bar | On the bar | https://bar.test/',
    'Bookmarks bar / Shop & Co | Café\u00a0😀 <b> &copy; | https://shop.test/?a=1&b=2',
    'Other / Imported from Firefox | Firefox site | https://ff.test/',
    'Other | Loose | https://loose.test/',
    'Mobile | Phone | https://phone.test/',
  ]);
});

test('existing bookmarks are kept; duplicates (same URL in the same folder) are skipped', () => {
  const dir = tmp();
  writeTree(dir, chromium([url('Mine', 'https://mine.test/', '5'), folder('Work', [url('Docs', 'https://docs.test/a?x=1&y=2', '7')], '6')]));
  const first = importBookmarksIntoProfile(dir, JSON.stringify(NESTED));
  assert.equal(first.duplicates, 1, 'Work/Docs already present');
  assert.equal(first.imported, 3);
  assert.ok(flat(dir).includes('Bookmarks bar | Mine | https://mine.test/'));
  assert.equal(readTree(dir).roots.bookmark_bar.children.filter(c => c.name === 'Work').length, 1, 'folders merge by name');
  const again = importBookmarksIntoProfile(dir, JSON.stringify(NESTED));
  assert.deepEqual([again.imported, again.duplicates], [0, 4], 'importing the same file twice adds nothing');
  // Same URL in a different folder is a different bookmark.
  const elsewhere = importBookmarksIntoProfile(dir, JSON.stringify(chromium([], [url('Mine again', 'https://mine.test/')])));
  assert.equal(elsewhere.imported, 1);
  // Duplicates inside one file collapse too.
  const dupFile = importBookmarksIntoProfile(tmp(), JSON.stringify(chromium([url('a', 'https://x.test/'), url('b', 'https://x.test/')])));
  assert.deepEqual([dupFile.imported, dupFile.duplicates], [1, 1]);
});

test('unsafe URLs are rejected per item; names never become paths', () => {
  const dir = tmp();
  const result = importBookmarksIntoProfile(dir, JSON.stringify(chromium([
    url('js', 'javascript:alert(1)'), url('data', 'data:text/html,x'), url('file', 'file:///C:/Windows/win.ini'), url('empty', ''),
    folder('../../../escape', [url('ok', 'https://ok.test/')]), folder('C:\\Windows\\System32', [url('ok2', 'https://ok2.test/')]),
  ])));
  assert.equal(result.imported, 2);
  assert.equal(result.rejected.length, 4);
  assert.ok(result.rejected.every(r => typeof r.reason === 'string' && Number.isInteger(r.index)));
  assert.deepEqual(fs.readdirSync(dir).sort(), ['Default'], 'nothing written outside Default/Bookmarks');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'Default')), ['Bookmarks']);
  assert.ok(flat(dir).includes('Bookmarks bar / ../../../escape | ok | https://ok.test/'), 'kept as a plain folder name');
});

test('malformed, empty, oversized and unknown files are refused and change nothing', () => {
  const dir = tmp();
  writeTree(dir, chromium([url('Mine', 'https://mine.test/', '5')]));
  const before = fs.readFileSync(bookmarksFile(dir), 'utf8');
  const cases = [
    ['', /empty/], ['   \n', /empty/], ['\uFEFF', /empty/], ['{"roots":', /not valid JSON/], ['{"hello":1}', /neither/], ['[1,2]', /neither/],
    ['plain text', /Unrecognized/], ['<html><body>hi</body></html>', /Unrecognized/],
    ['x'.repeat(LIMITS.bytes + 1), /larger than 5 MB/],
    [JSON.stringify({ bookmarks: Array.from({ length: LIMITS.items + 1 }, (_, i) => ({ url: `https://a.test/${i}` })) }), /More than/],
  ];
  for (const [content, message] of cases) {
    assert.throws(() => importBookmarksIntoProfile(dir, content), e => message.test(e.message) && e.status >= 400 && e.status < 500, String(content).slice(0, 30));
  }
  let deep = url('d', 'https://deep.test/');
  for (let i = 0; i < LIMITS.depth + 2; i++) deep = folder(`f${i}`, [deep]);
  assert.throws(() => importBookmarksIntoProfile(dir, JSON.stringify(chromium([deep]))), /nested more than/);
  assert.throws(() => parseBookmarkFile(42), /must be text/);
  assert.equal(fs.readFileSync(bookmarksFile(dir), 'utf8'), before, 'existing bookmarks untouched');
  assert.equal(fs.existsSync(path.join(dir, LOCK_NAME)), false);
});

test('an unreadable existing Bookmarks file stops the import instead of being replaced', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
  fs.writeFileSync(bookmarksFile(dir), '{ truncated');
  assert.throws(() => importBookmarksIntoProfile(dir, JSON.stringify(NESTED)), e => e.code === 'BOOKMARKS_EXISTING_INVALID' && e.status === 409);
  assert.equal(fs.readFileSync(bookmarksFile(dir), 'utf8'), '{ truncated');
});

test('an interrupted write leaves the previous bookmarks and no temp file', () => {
  const dir = tmp();
  writeTree(dir, chromium([url('Mine', 'https://mine.test/', '5')]));
  const before = fs.readFileSync(bookmarksFile(dir), 'utf8');
  const rename = () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
  assert.throws(() => importBookmarksIntoProfile(dir, JSON.stringify(NESTED), { rename }), e => e.code === 'BOOKMARKS_WRITE_FAILED' && /ENOSPC/.test(e.message));
  assert.equal(fs.readFileSync(bookmarksFile(dir), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'Default')), ['Bookmarks']);
  assert.equal(fs.existsSync(path.join(dir, LOCK_NAME)), false, 'lock released after failure');
});

test('a profile held by another live process is refused', () => {
  const dir = tmp();
  acquireLock(dir, { ownerPid: process.ppid });
  try {
    assert.throws(() => importBookmarksIntoProfile(dir, JSON.stringify(NESTED)), e => e.status === 409);
    assert.equal(fs.existsSync(bookmarksFile(dir)), false);
  } finally { releaseLock(dir, process.ppid); }
});

test('round trips: JSON export -> import, HTML export -> import, Chromium file -> import', () => {
  const source = tmp();
  importBookmarksIntoProfile(source, JSON.stringify(NESTED));
  importBookmarksIntoProfile(source, HTML);
  const expected = flat(source);

  const viaJson = tmp();
  const exported = { bookmarks: readProfileBookmarks(source).bookmarks };
  const r1 = importBookmarksIntoProfile(viaJson, JSON.stringify(exported));
  assert.equal(r1.format, 'azwah-json');
  assert.deepEqual(flat(viaJson), expected);

  const viaHtml = tmp();
  const html = bookmarksToNetscapeHtml(source);
  assert.match(html, /^<!DOCTYPE NETSCAPE-Bookmark-file-1>/);
  assert.match(html, /PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</);
  assert.equal(importBookmarksIntoProfile(viaHtml, html).format, 'netscape-html');
  assert.deepEqual(flat(viaHtml), expected);

  const viaFile = tmp();
  importBookmarksIntoProfile(viaFile, fs.readFileSync(bookmarksFile(source), 'utf8'));
  assert.deepEqual(flat(viaFile), expected);
  assert.equal(bookmarksToNetscapeHtml(tmp()).includes('<A '), false, 'empty profile exports an empty list');
});

test('merge is pure and repairs missing roots', () => {
  const existing = { roots: { bookmark_bar: folder('Bookmarks bar', [], '1') } };
  const { tree, result } = mergeBookmarks(existing, [{ root: 'synced', folders: [], name: 'm', url: 'https://m.test/' }]);
  assert.equal(existing.roots.synced, undefined, 'input not mutated');
  assert.equal(tree.roots.synced.children[0].url, 'https://m.test/');
  assert.ok(tree.roots.other);
  assert.equal(result.imported, 1);
});
