const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  openFile:        ()      => ipcRenderer.invoke('open-file'),
  saveFile:        ()      => ipcRenderer.invoke('save-file'),
  getMetadata:     (path)  => ipcRenderer.invoke('get-metadata', path),
  exportVideo:     (opts)  => ipcRenderer.invoke('export-video', opts),
  concatVideos:    (opts)  => ipcRenderer.invoke('concat-videos', opts),
  downloadVideo:   (opts)  => ipcRenderer.invoke('download-video', opts),
  getDownloadsDir: ()      => ipcRenderer.invoke('get-downloads-dir'),
  onProgress:      (cb)    => ipcRenderer.on('export-progress',   (_, v) => cb(v)),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_, v) => cb(v)),
})