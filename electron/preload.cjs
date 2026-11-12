// Preload (sandboxed, context-isolated): exposes a minimal, read-mostly bridge. No Node APIs leak.
const { contextBridge, ipcRenderer } = require('electron');
const uiToken = ipcRenderer.sendSync('pm:get-ui-token');
contextBridge.exposeInMainWorld('pm', {
  desktop: true,
  uiToken,
  platform: process.platform,
  openDataDir: () => ipcRenderer.invoke('pm:open-data-dir'),
  updateStatus: () => ipcRenderer.invoke('pm:update-status'),
  checkUpdate: () => ipcRenderer.invoke('pm:update-check'),
  openUpdateRelease: () => ipcRenderer.invoke('pm:update-open'),
  appInfo: () => ipcRenderer.invoke('pm:app-info'),
  copyDeviceCode: () => ipcRenderer.invoke('pm:copy-device-code'),
  onEvent: cb => { const h = (_e, ev) => cb(ev); ipcRenderer.on('pm:event', h); return () => ipcRenderer.off('pm:event', h); },
});
