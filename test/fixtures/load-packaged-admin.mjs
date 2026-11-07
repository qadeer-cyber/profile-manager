import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';

const unpacked = process.argv[2];
const vault = path.join(os.tmpdir(), `azwah-packaged-vault-${crypto.randomUUID()}`);
process.env.AZWAH_ADMIN_VAULT = vault;
const admin = await import(pathToFileURL(path.join(unpacked, 'server', 'ultimate-admin.js')).href);
const locked = admin.adminStatus();
let lockedList = null;
try { admin.adminList(); } catch (error) { lockedList = error.code; }
const password = `Packaged vault ${crypto.randomUUID()}`;
const created = admin.adminInit({organization: 'Packaged organization', password, confirm: password});
const opened = admin.adminStatus();
const afterLock = admin.adminLock();
let issuanceWhileLocked = null;
try { admin.adminIssue({reference: 'desk', days: 30}); } catch (error) { issuanceWhileLocked = error.code; }
const vaultText = fs.readFileSync(vault, 'utf8');
fs.rmSync(vault, {force: true});
process.stdout.write(JSON.stringify({
  locked,
  lockedList,
  opened: {unlocked: opened.unlocked, publicKey: created.publicKey, organization: opened.organization},
  serialized: JSON.stringify({created, opened, afterLock}),
  vault: vaultText,
  afterLock,
  issuanceWhileLocked,
}));
