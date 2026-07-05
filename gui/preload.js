const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // żądanie/odpowiedź
  status: () => ipcRenderer.invoke('status'),
  getVersion: () => ipcRenderer.invoke('app-version'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  list: () => ipcRenderer.invoke('list'),
  // start zadań długich (wynik leci przez onLog/onDone/onError)
  runImport: () => ipcRenderer.send('import'),
  runLogin: () => ipcRenderer.send('login'),
  runSubmit: (opts) => ipcRenderer.send('submit', opts),
  cancel: () => ipcRenderer.send('cancel'),
  openDir: () => ipcRenderer.send('open-dir'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  chooseCsv: () => ipcRenderer.invoke('choose-csv'),
  clearSession: () => ipcRenderer.invoke('logout'),
  listShots: (mode) => ipcRenderer.invoke('list-shots', mode),
  readShot: (filePath) => ipcRenderer.invoke('read-shot', filePath),
  openShot: (filePath) => ipcRenderer.send('open-shot', filePath),
  // strumienie zdarzeń
  onLog: (cb) => ipcRenderer.on('log', (_e, line) => cb(line)),
  onBusy: (cb) => ipcRenderer.on('busy', (_e, b) => cb(b)),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, p) => cb(p)),
  onDone: (cb) => ipcRenderer.on('done', (_e, r) => cb(r)),
  onError: (cb) => ipcRenderer.on('error', (_e, m) => cb(m)),
});
