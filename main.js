const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const ffmpeg = require('fluent-ffmpeg')
const { execSync } = require('child_process')
const fs = require('fs')

app.commandLine.appendSwitch('ozone-platform', 'x11')

function findBin(name) {
  try {
    return execSync(`which ${name}`).toString().trim()
  } catch(e) {
    const fallbacks = [`/usr/bin/${name}`, `/usr/local/bin/${name}`, `/bin/${name}`]
    for (const p of fallbacks) {
      try { fs.accessSync(p); return p } catch(e) {}
    }
    return null
  }
}

const ffmpegPath  = findBin('ffmpeg')
const ffprobePath = findBin('ffprobe')

if (ffmpegPath)  ffmpeg.setFfmpegPath(ffmpegPath)
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath)

console.log('ffmpeg :', ffmpegPath)
console.log('ffprobe:', ffprobePath)

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'Video Editor',
    backgroundColor: '#1a1a1a'
  })
  mainWindow.loadFile('index.html')
  mainWindow.webContents.openDevTools()  // <-- DevTools abierto para debug
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())

// ── Abrir archivos ────────────────────────────────────────────────────────────
ipcMain.handle('open-file', async () => {
  console.log('[main] open-file invocado')
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Video e Imagen', extensions: ['mp4','mov','avi','mkv','webm','flv','wmv','m4v','jpg','jpeg','png','gif','bmp','webp','tiff'] },
        { name: 'Video',  extensions: ['mp4','mov','avi','mkv','webm','flv','wmv','m4v'] },
        { name: 'Imagen', extensions: ['jpg','jpeg','png','gif','bmp','webp','tiff'] }
      ]
    })
    console.log('[main] resultado dialog:', result)
    if (result.canceled) return []
    return result.filePaths
  } catch(e) {
    console.error('[main] ERROR open-file:', e)
    return []
  }
})

// ── Guardar archivo ───────────────────────────────────────────────────────────
ipcMain.handle('save-file', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'Video MP4', extensions: ['mp4'] }],
    defaultPath: 'exportado.mp4'
  })
  if (result.canceled) return null
  return result.filePath
})

// ── Metadata ──────────────────────────────────────────────────────────────────
ipcMain.handle('get-metadata', async (event, filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) return reject(err.message)
      resolve(meta)
    })
  })
})

// ── Exportar un clip ──────────────────────────────────────────────────────────
ipcMain.handle('export-video', async (event, { input, output, startTime, duration, speed, brightness, contrast }) => {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject('FFmpeg no encontrado.')
    let cmd = ffmpeg(input)
    if (startTime > 0) cmd = cmd.seekInput(startTime)
    if (duration > 0)  cmd = cmd.duration(duration)
    const vf = []
    if (speed && speed !== 1) vf.push(`setpts=${(1/speed).toFixed(4)}*PTS`)
    if (brightness || contrast) {
      vf.push(`eq=brightness=${((brightness||0)/100).toFixed(3)}:contrast=${(1+(contrast||0)/100).toFixed(3)}`)
    }
    if (vf.length) cmd = cmd.videoFilters(vf)
    if (speed && speed !== 1) {
      const at = Math.min(Math.max(speed, 0.5), 2.0).toFixed(3)
      cmd = cmd.audioFilters(`atempo=${at}`)
    }
    cmd
      .output(output)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions(['-preset', 'fast', '-crf', '23'])
      .on('progress', p => event.sender.send('export-progress', Math.round(p.percent || 0)))
      .on('end', () => resolve({ ok: true }))
      .on('error', e => reject(e.message))
      .run()
  })
})

// ── Concatenar múltiples clips ────────────────────────────────────────────────
ipcMain.handle('concat-videos', async (event, { files, output }) => {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject('FFmpeg no encontrado.')
    const listPath = `/tmp/ve_concat_${Date.now()}.txt`
    const listContent = files.map(f => `file '${f}'`).join('\n')
    fs.writeFileSync(listPath, listContent)
    ffmpeg()
      .input(listPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy'])
      .output(output)
      .on('end', () => {
        try { fs.unlinkSync(listPath) } catch(e) {}
        files.forEach(f => { try { fs.unlinkSync(f) } catch(e) {} })
        resolve({ ok: true })
      })
      .on('error', e => {
        try { fs.unlinkSync(listPath) } catch(e) {}
        reject(e.message)
      })
      .run()
  })
})