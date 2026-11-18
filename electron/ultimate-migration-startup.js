import fs from 'node:fs';
import path from 'node:path';
import { migrateUltimateData, legacyOwnerDatabase, hasMigrationReceipt } from './ultimate-migrate.js';

export async function prepareUltimateStartup({appData, ultimateDir, platform, encrypt, prompt, showLogs, log}) {
  const choice = path.join(ultimateDir,'legacy-migration-choice');
  const fresh = path.join(ultimateDir,'fresh-start');
  const freshDirectory = () => {
    const entry = fs.lstatSync(fresh, {throwIfNoEntry:false});
    if (entry && !entry.isDirectory()) throw new Error('Unsafe Ultimate fresh-start directory.');
    fs.mkdirSync(fresh,{recursive:true});
    return fresh;
  };
  const saved = fs.lstatSync(choice,{throwIfNoEntry:false});
  if (saved) {
    if (!saved.isFile() || saved.size !== 6 || fs.readFileSync(choice,'utf8') !== 'fresh\n') throw new Error('Invalid legacy migration preference.');
    return freshDirectory();
  }
  const options = {appData,ultimateDir};
  const ownerDb = legacyOwnerDatabase(appData);
  for (;;) {
    try {
      if (platform === 'win32' && fs.existsSync(ownerDb) && !hasMigrationReceipt(ultimateDir)) {
        const {withStoppedWindowsOwner,recoverOwnerSnapshot} = await import('./windows-owner-snapshot.js');
        const {rewrapWindowsOwnerSecrets} = await import('./windows-owner-secrets.js');
        await withStoppedWindowsOwner(ownerDb, assertOwnerLocked => migrateUltimateData({
          ...options,assertOwnerLocked,recoverOwnerSnapshot,
          prepareOwnerData: paths => rewrapWindowsOwnerSecrets({...paths,encrypt}),
        }));
      } else migrateUltimateData(options);
      return ultimateDir;
    } catch (error) {
      log(error);
      const action = await prompt(error.message);
      if (action === 'retry') continue;
      if (action === 'logs') { await showLogs(); continue; }
      if (action !== 'fresh') return null;
      const directory = freshDirectory();
      const temporary = choice + '.' + process.pid + '.tmp';
      try {
        fs.writeFileSync(temporary,'fresh\n',{flag:'wx'});
        fs.linkSync(temporary,choice);
      } finally { fs.rmSync(temporary,{force:true}); }
      return directory;
    }
  }
}
