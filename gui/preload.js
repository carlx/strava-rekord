const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // żądanie/odpowiedź
  status: () => ipcRenderer.invoke('status'),
  list: () => ipcRenderer.invoke('list'),
  // start zadań długich (wynik leci przez onLog/onDone/onError)
  runImport: () => ipcRenderer.send('import'),
  runLogin: () => ipcRenderer.send('login'),
  runSubmit: (opts) => ipcRenderer.send('submit', opts),
  cancel: () => ipcRenderer.send('cancel'),
  openDir: () => ipcRenderer.send('open-dir'),
  // strumienie zdarzeń
  onLog: (cb) => ipcRenderer.on('log', (_e, line) => cb(line)),
  onBusy: (cb) => ipcRenderer.on('busy', (_e, b) => cb(b)),
  onDone: (cb) => ipcRenderer.on('done', (_e, r) => cb(r)),
  onError: (cb) => ipcRenderer.on('error', (_e, m) => cb(m)),
});
