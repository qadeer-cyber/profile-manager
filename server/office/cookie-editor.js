import fs from 'node:fs';
import path from 'node:path';
import { readGeckoProfileExtensions } from '../gecko-extensions.js';
export const COOKIE_EDITOR = Object.freeze({
  name:'Cookie-Editor',license:'GPL-3.0',source:'https://github.com/Moustachauve/cookie-editor',website:'https://cookie-editor.com/',
  chromium:{id:'hlkenndednhfkekhgcdicdfddnkalmdm',url:'https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm'},
  firefox:{id:'{c3c10168-4186-445c-9c5b-63f12b8e2c87}',url:'https://addons.mozilla.org/firefox/addon/cookie-editor/'},
  distribution:'Official-store, explicit user-assisted installation. No extension payload is bundled.',
});
export function cookieEditorStatus(directory,engine) {
  if(engine==='firefox') {
    const report=readGeckoProfileExtensions(path.join(directory,'gecko'));
    const addon=report.addons.find(a=>a.id===COOKIE_EDITOR.firefox.id);
    return {engine,installed:!!addon,version:addon?.version||null,active:addon?.active||false,signatureMetadataObserved:addon?.signatureVerified||false,verification:'Firefox enforces Mozilla signing at installation. On-disk signature metadata is an observation, not independent certificate-chain verification.'};
  }
  const file=path.join(directory,'Default','Preferences');
  if(!fs.existsSync(file))return {engine,installed:false,version:null,verification:'Chrome Web Store installation must be completed in this profile.'};
  const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>16*1024*1024)throw Error('Unsafe Chromium preferences');
  const data=JSON.parse(fs.readFileSync(file,'utf8')),addon=data.extensions?.settings?.[COOKIE_EDITOR.chromium.id];
  return {engine,installed:!!addon,version:addon?.manifest?.version||null,verification:'Browser-managed Web Store installation state; no independent CRX signature claim.'};
}
