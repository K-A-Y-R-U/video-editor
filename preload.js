const { contextBridge, ipcRenderer } = require('electron')
const os = require('os')

contextBridge.exposeInMainWorld('api', {
  openFile:     ()      => ipcRenderer.invoke('open-file'),
  saveFile:     ()      => ipcRenderer.invoke('save-file'),
  getMetadata:  (path)  => ipcRenderer.invoke('get-metadata', path),
  exportVideo:  (opts)  => ipcRenderer.invoke('export-video', opts),
  concatVideos: (opts)  => ipcRenderer.invoke('concat-videos', opts),
  onProgress:   (cb)    => ipcRenderer.on('export-progress', (_, v) => cb(v)),
  getTmpDir:    ()      => os.tmpdir(),   // ← FIX: expone la carpeta temporal del sistema (Win/Linux/Mac)
})