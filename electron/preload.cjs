// Preload (sandboxed, context-isolated): exposes a minimal, read-mostly bridge. No Node APIs leak.
const { contextBridge, ipcRenderer } = require('electron');
const uiToken = ipcRenderer.sendSync('pm:get-ui-token');
contextBridge.exposeInMainWorld('pm', {
  desktop: true,
  uiToken,
  platform: process.platform,
  openDataDir: () => ipcRenderer.invoke('pm:open-data-dir'),
  appInfo: () => ipcRenderer.invoke('pm:app-info'),
  onEvent: cb => { const h = (_e, ev) => cb(ev); ipcRenderer.on('pm:event', h); return () => ipcRenderer.off('pm:event', h); },
});
