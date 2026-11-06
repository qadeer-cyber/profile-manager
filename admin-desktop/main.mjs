import {app,BrowserWindow,ipcMain,dialog,clipboard} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {adminAction,open,save} from '../scripts/license-admin/admin.mjs';

let password, window;
const vault = () => path.join(app.getPath('userData'),'organization.vault');
const locked = () => { password = undefined; };
const records = () => {
  if (!password) throw Error('Unlock the vault first.');
  return open(vault(),password);
};
const backup = async () => {
  records();
  const result = await dialog.showSaveDialog(window,{defaultPath:'organization.vault'});
  if (!result.canceled) fs.copyFileSync(vault(),result.filePath,fs.constants.COPYFILE_EXCL);
};
ipcMain.handle('admin',async (event,action,input={}) => {
  if(event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw Error('Unauthorized window');
  if(action==='status') return {exists:fs.existsSync(vault()),unlocked:!!password};
  if(action==='lock') return locked();
  if(action==='restore') {
    if(fs.existsSync(vault())) throw Error('Restore is available on an empty Admin installation.');
    const result=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'Encrypted vault',extensions:['vault']}]});
    if(result.canceled)return;
    const data=open(result.filePaths[0],input.password);
    if(!data.organization)throw Error('This backup does not contain an organization.');
    save(vault(),data,input.password,true);
    password=input.password;
    return;
  }
  if(action==='setup') {
    if(!input.organization?.trim()||input.organization.length>120||input.password!==input.confirm)throw Error('Enter an organization and matching passwords.');
    const result=await dialog.showSaveDialog(window,{title:'Choose encrypted vault backup',defaultPath:'organization.vault'});
    if(result.canceled)return;
    adminAction({command:'init',vault:vault(),password:input.password});
    try {
      const data=open(vault(),input.password);
      data.organization=input.organization.trim();
      save(vault(),data,input.password);
      fs.copyFileSync(vault(),result.filePath,fs.constants.COPYFILE_EXCL);
      password=input.password;
    } catch(error) { fs.rmSync(vault()); throw error; }
    return;
  }
  if(action==='unlock') {
    try {open(vault(),input.password);} catch {throw Error('Incorrect password or damaged vault.');}
    password=input.password;
    return;
  }
  const data=records();
  if(action==='list') return {organization:data.organization,records:data.records,audit:data.audit,employees:data.employees||[]};
  if(action==='employee') {
    if(!input.reference?.trim()||!input.name?.trim()||!/^AZD1-[a-f0-9]{64}$/.test(input.device)) throw Error('Enter a name, reference and valid device code.');
    data.employees=(data.employees||[]).filter(e=>e.reference!==input.reference);
    data.employees.push({reference:input.reference,name:input.name,device:input.device,notes:input.notes});
    return save(vault(),data,password);
  }
  if(action==='issue') {
    const employee=(data.employees||[]).find(e=>e.reference===input.reference);
    if(!employee)throw Error('Save the employee first.');
    const days=Number(input.days);
    if(!Number.isInteger(days)||days<1||days>3650)throw Error('Validity must be 1–3650 days.');
    const {license}=adminAction({command:input.licenseId?'reissue':'issue',vault:vault(),password,device:employee.device,label:employee.reference,expiresAt:Date.now()+days*86400000,licenseId:input.licenseId});
    return {license};
  }
  if(action==='copy'||action==='export') {
    const {token}=adminAction({command:'export',vault:vault(),password,licenseId:input.id});
    if(action==='copy')return clipboard.writeText(token);
    const result=await dialog.showSaveDialog(window,{defaultPath:'employee.azwah'});
    if(!result.canceled) fs.writeFileSync(result.filePath,token,{flag:'wx',mode:0o600});
    return;
  }
  if(action==='backup') return backup();
  if(action==='installer') {
    const result=await dialog.showOpenDialog(window,{properties:['openDirectory']});
    if(result.canceled)return;
    if(!/^\d+\.\d+\.\d+$/.test(input.version))throw Error('Enter a version such as 1.0.0.');
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'azwah-office-'));
    try {
      const output=path.join(result.filePaths[0],'Azwah-Multi-Browser-Office-Setup-x64.exe');
      const assets=process.resourcesPath;
      fs.writeFileSync(path.join(root,'office-trust.json'),JSON.stringify({organization:data.organization,publicKey:data.publicKey}));
      await promisify(execFile)(path.join(assets,'nsis','makensis.exe'),[
        '/V2','/DPAYLOAD='+path.join(assets,'office-payload'),'/DTRUST='+path.join(root,'office-trust.json'),
        '/DOUTPUT='+path.join(root,'setup.exe'),'/DVERSION='+input.version,path.join(assets,'office.nsi')
      ],{windowsHide:true,timeout:600000});
      fs.copyFileSync(path.join(root,'setup.exe'),output,fs.constants.COPYFILE_EXCL);
      return output;
    } finally {fs.rmSync(root,{recursive:true,force:true});}
  }
  throw Error('Unknown operation');
});
if(!app.requestSingleInstanceLock())app.quit();
else app.whenReady().then(()=>{
  window=new BrowserWindow({width:1100,height:800,title:'Azwah License Admin',webPreferences:{preload:path.join(import.meta.dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.on('closed',()=>{locked();app.quit();});
  window.loadFile(path.join(import.meta.dirname,'index.html'));
});
