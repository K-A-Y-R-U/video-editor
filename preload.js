const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  openFile:     ()      => ipcRenderer.invoke('open-file'),
  saveFile:     ()      => ipcRenderer.invoke('save-file'),
  getMetadata:  (path)  => ipcRenderer.invoke('get-metadata', path),
  exportVideo:  (opts)  => ipcRenderer.invoke('export-video', opts),
  concatVideos: (opts)  => ipcRenderer.invoke('concat-videos', opts),
  onProgress:   (cb)    => ipcRenderer.on('export-progress', (_, v) => cb(v)),
  getTmpDir:    ()      => ipcRenderer.invoke('get-tmpdir'),
  saveFrames:   (opts)  => ipcRenderer.invoke('save-frames', opts),   // ← frames de texto animado
})