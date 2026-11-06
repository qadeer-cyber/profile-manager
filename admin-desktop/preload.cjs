const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('admin',{call:(action,input)=>ipcRenderer.invoke('admin',action,input)});
