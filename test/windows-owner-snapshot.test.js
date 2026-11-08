import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {recoverOwnerSnapshot} from '../electron/windows-owner-snapshot.js';
import {prepareUltimateStartup} from '../electron/ultimate-migration-startup.js';

test('disposable recovery imports committed WAL and rejects checksum damage', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'azwah-wal-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'profiles.db');
  const db=new DatabaseSync(file);
  t.after(()=>db.close());
  db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE proof(v TEXT); INSERT INTO proof VALUES ('committed');");
  for (const name of ['valid','corrupt']) {
    const dir=path.join(root,name);
    fs.mkdirSync(dir);
    for (const suffix of ['','-wal']) fs.copyFileSync(file+suffix,path.join(dir,'profiles.db')+suffix);
  }
  const invalid=path.join(root,'corrupt','profiles.db-wal');
  const bytes=fs.readFileSync(invalid);
  bytes[bytes.length-1] ^= 1;
  fs.writeFileSync(invalid,bytes);
  assert.throws(()=>recoverOwnerSnapshot(path.join(root,'corrupt')),/checksum/);
  recoverOwnerSnapshot(path.join(root,'valid'));
  const result=new DatabaseSync(path.join(root,'valid','profiles.db'),{readOnly:true});
  try {assert.equal(result.prepare('SELECT v FROM proof').get().v,'committed');}
  finally {result.close();}
});

test('Start Fresh is explicit and persists without touching legacy or existing Ultimate data',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'azwah-fresh-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const ultimateDir=path.join(root,'ultimate');
  const owner=path.join(root,'azwah-multi-browser-owner','data');
  fs.mkdirSync(owner,{recursive:true});
  fs.mkdirSync(path.join(ultimateDir,'data'),{recursive:true});
  fs.writeFileSync(path.join(owner,'profiles.db'),'legacy');
  fs.writeFileSync(path.join(owner,'profiles.db-wal'),'synthetic');
  fs.writeFileSync(path.join(ultimateDir,'data','profiles.db'),'existing');
  const choices=['retry','logs','fresh'];
  let logs=0;
  const selected=await prepareUltimateStartup({appData:root,ultimateDir,platform:'linux',prompt:()=>choices.shift(),showLogs:()=>logs++,log:()=>{}});
  assert.equal(selected,path.join(ultimateDir,'fresh-start'));
  assert.equal(logs,1);
  assert.equal(await prepareUltimateStartup({appData:root,ultimateDir,platform:'linux',prompt:()=>assert.fail()}),selected);
  assert.equal(fs.readFileSync(path.join(owner,'profiles.db'),'utf8'),'legacy');
  assert.equal(fs.readFileSync(path.join(ultimateDir,'data','profiles.db'),'utf8'),'existing');
});
