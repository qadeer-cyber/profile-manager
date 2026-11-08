import { db } from './db.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const under = (path, root) => path === root || path.startsWith(root + '/');
const parentOf = path => path.slice(0, Math.max(0, path.lastIndexOf('/')));

function validPath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 240 &&
    !/[\u0000-\u001f\u007f]/u.test(path) &&
    path.split('/').every(part => part && part === part.trim() && !['.', '..', '__all'].includes(part));
}

function requirePath(path) {
  if (!validPath(path)) throw fail(400, 'Use a folder path of up to 240 characters, with / between folder names.');
  return path;
}

function folderPaths(profilePaths) {
  const paths = new Set(db.prepare('SELECT path FROM profile_folders').pluck().all());
  for (const path of profilePaths) if (path) paths.add(path);
  for (const path of paths) {
    if (!validPath(path)) continue; // Preserve older literal folder names as stored.
    const parent = parentOf(path);
    if (parent) paths.add(parent);
  }
  return paths;
}

const storedProfilePaths = () => db.prepare("SELECT DISTINCT folder FROM profiles WHERE folder <> ''").pluck().all();
export const listProfileFolders = profilePaths => [...folderPaths(profilePaths)].sort();

function requireParent(path, paths) {
  const parent = parentOf(path);
  if (parent && !paths.has(parent)) throw fail(404, 'The parent folder does not exist.');
}

const remember = path => db.prepare('INSERT OR IGNORE INTO profile_folders (path) VALUES (?)').run(path);

export const createProfileFolder = db.transaction(path => {
  requirePath(path);
  const paths = folderPaths(storedProfilePaths());
  if (paths.has(path)) throw fail(409, 'That folder already exists.');
  requireParent(path, paths);
  remember(path);
  return { path };
}).immediate;

export const moveProfileFolder = db.transaction((from, to, checkProfile) => {
  requirePath(from);
  requirePath(to);
  const paths = folderPaths(storedProfilePaths());
  if (!paths.has(from)) throw fail(404, 'The folder does not exist.');
  if (under(to, from)) throw fail(409, 'Choose a destination outside this folder.');
  requireParent(to, paths);
  const moving = [...paths].filter(path => under(path, from));
  const destination = path => to + path.slice(from.length);
  for (const path of moving) {
    requirePath(destination(path));
    if (paths.has(destination(path))) throw fail(409, 'A folder already exists at the destination.');
  }
  const profiles = db.prepare("SELECT id, folder, workspace_id FROM profiles WHERE folder = ? OR instr(folder, ? || '/') = 1").all(from, from);
  for (const profile of profiles) checkProfile(profile);

  const oldParent = parentOf(from);
  if (oldParent) remember(oldParent);
  const remove = db.prepare('DELETE FROM profile_folders WHERE path = ?');
  for (const path of moving) {
    remove.run(path);
    remember(destination(path));
  }
  const update = db.prepare('UPDATE profiles SET folder = ?, updated_at = ? WHERE id = ?');
  const now = new Date().toISOString();
  for (const profile of profiles) update.run(destination(profile.folder), now, profile.id);

  const views = db.prepare("SELECT id, query_json FROM saved_views WHERE surface = 'profiles'").all();
  const updateView = db.prepare('UPDATE saved_views SET query_json = ?, updated_at = ? WHERE id = ?');
  for (const view of views) {
    const query = JSON.parse(view.query_json);
    if (typeof query.folder !== 'string' || !under(query.folder, from)) continue;
    query.folder = destination(query.folder);
    updateView.run(JSON.stringify(query), now, view.id);
  }
  return { path: to };
}).immediate;

export const deleteProfileFolder = db.transaction(path => {
  requirePath(path);
  const profilePaths = storedProfilePaths();
  const paths = folderPaths(profilePaths);
  if (!paths.has(path)) throw fail(404, 'The folder does not exist.');
  if (profilePaths.includes(path) || [...paths].some(other => other !== path && under(other, path))) {
    throw fail(409, 'Move any profiles (including profiles in Trash) and subfolders before deleting this folder.');
  }
  const parent = parentOf(path);
  if (parent) remember(parent);
  db.prepare('DELETE FROM profile_folders WHERE path = ?').run(path);
}).immediate;
