import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const LEGACY_APP_ID = 'local.profilemanager.app';
export const LEGACY_DIRECTORY = 'profile-manager';
export function officeUserDataPath(appData, override) {
  return override || path.join(appData, LEGACY_DIRECTORY);
}
// This upgrade deliberately reuses the established directory and schema. It
// records an adoption receipt without moving or rewriting any existing data.
export function adoptLegacyData(directory) {
  fs.mkdirSync(directory,{recursive:true});
  if(fs.lstatSync(directory).isSymbolicLink())throw Error('Refusing a symlink application data directory');
  const marker=path.join(directory,'azwah-office-upgrade.json');
  if(fs.existsSync(marker)) {
    const stat=fs.lstatSync(marker);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)throw Error('Unsafe upgrade receipt');
    const receipt=JSON.parse(fs.readFileSync(marker,'utf8'));if(receipt.version!==1||receipt.directory!==LEGACY_DIRECTORY)throw Error('Upgrade receipt needs review');return receipt;
  }
  const receipt={version:1,directory:LEGACY_DIRECTORY,applicationId:LEGACY_APP_ID,product:'Azwah Multi Browser',adoptedAt:new Date().toISOString(),movedFiles:0};
  const temporary=marker+'.'+crypto.randomUUID()+'.tmp';
  try {
    const fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(receipt));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    try{fs.linkSync(temporary,marker);}catch(error){if(error.code!=='EEXIST')throw error;}
  }finally{fs.rmSync(temporary,{force:true});}
  return receipt;
}
