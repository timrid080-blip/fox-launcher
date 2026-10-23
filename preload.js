const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('fox', {
  call: async (method, ...args) => {
    const r = await ipcRenderer.invoke('api', method, ...args);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  },
  on: (cb) => ipcRenderer.on('event', (e, type, payload) => cb(type, payload)),
  filePath: (file) => (webUtils && webUtils.getPathForFile ? webUtils.getPathForFile(file) : file.path),
});
