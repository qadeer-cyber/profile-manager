const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('azwahControls', {
  action: (action, value) => ipcRenderer.invoke('azwah-toolbar', action, value),
  onState: handler => { ipcRenderer.on('azwah-toolbar-state', (_, state) => handler(state)); },
});
