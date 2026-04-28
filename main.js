const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path   = require('path')
const os     = require('os')
const ffmpeg = require('fluent-ffmpeg')
const { execSync, spawn } = require('child_process')
const fs     = require('fs')

// Solo aplicar en Linux (en Windows/Mac causa problemas)
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform', 'x11')
}

// ── Binarios empaquetados dentro de la app ───────────────────────────────────
function findBin(name) {
  const platform = process.platform  // 'win32' | 'linux' | 'darwin'
  const ext      = platform === 'win32' ? '.exe' : ''
  const binName  = name + ext

  // 1. Dentro del paquete (electron-builder extraFiles → resources/bin/)
  const appBin = path.join(process.resourcesPath || __dirname, 'bin', binName)
  try { fs.accessSync(appBin, fs.constants.X_OK); return appBin } catch(e) {}

  // 2. Carpeta bin/ del proyecto (desarrollo)
  const devBin = path.join(__dirname, 'bin', platform === 'win32' ? 'win' : 'linux', binName)
  try { fs.accessSync(devBin, fs.constants.X_OK); return devBin } catch(e) {}

  // 3. PATH del sistema (fallback)
  try {
    const cmd = platform === 'win32' ? `where ${name}` : `which ${name}`
    return execSync(cmd).toString().trim().split('\n')[0]
  } catch(e) {}

  // 4. Rutas fijas Linux/Mac
  for (const p of [`/usr/bin/${name}`, `/usr/local/bin/${name}`, `/bin/${name}`]) {
    try { fs.accessSync(p); return p } catch(e) {}
  }
  return null
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
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'VideoEdit',
    backgroundColor: '#1a1a1a'
  })
  mainWindow.loadFile('index.html')

  // DevTools solo en desarrollo
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.webContents.openDevTools()
  }
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())

// FIX: expone os.tmpdir() al renderer de forma segura via IPC (el sandbox no permite require('os'))
ipcMain.handle('get-tmpdir', () => os.tmpdir())

ipcMain.handle('open-file', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Video e Imagen', extensions: ['mp4','mov','avi','mkv','webm','flv','wmv','m4v','jpg','jpeg','png','gif','bmp','webp','tiff'] },
        { name: 'Video',  extensions: ['mp4','mov','avi','mkv','webm','flv','wmv','m4v'] },
        { name: 'Imagen', extensions: ['jpg','jpeg','png','gif','bmp','webp','tiff'] }
      ]
    })
    if (result.canceled) return []
    return result.filePaths
  } catch(e) { return [] }
})

ipcMain.handle('save-file', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'Video MP4', extensions: ['mp4'] }],
    defaultPath: 'exportado.mp4'
  })
  if (result.canceled) return null
  return result.filePath
})

ipcMain.handle('get-metadata', async (event, filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) return reject(err.message)
      resolve(meta)
    })
  })
})

ipcMain.handle('export-video', async (event, { input, output, startTime, duration, speed, brightness, contrast, muteAudio }) => {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject('FFmpeg no encontrado.')

    console.log(`[export-video] muteAudio=${muteAudio} input=${path.basename(input)}`)
    const args = ['-y']
    if (startTime > 0) { args.push('-ss', String(startTime)) }
    args.push('-i', input)
    if (duration > 0) { args.push('-t', String(duration)) }

    const vf = []
    if (speed && speed !== 1) vf.push(`setpts=${(1/speed).toFixed(4)}*PTS`)
    if (brightness || contrast) {
      vf.push(`eq=brightness=${((brightness||0)/100).toFixed(3)}:contrast=${(1+(contrast||0)/100).toFixed(3)}`)
    }
    if (vf.length) { args.push('-vf', vf.join(',')) }

    args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-profile:v', 'baseline', '-level', '3.1', '-pix_fmt', 'yuv420p')

    if (muteAudio) {
      args.push('-map', '0:v:0', '-an')
    } else {
      args.push('-map', '0:v:0', '-map', '0:a?')
      if (speed && speed !== 1) {
        const at = Math.min(Math.max(speed, 0.5), 2.0).toFixed(3)
        args.push('-af', `atempo=${at}`)
      }
      args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2')
    }

    args.push(output)

    let stderr = ''
    const proc = spawn(ffmpegPath, args)
    proc.stderr.on('data', d => {
      stderr += d.toString()
      const m = stderr.match(/time=(\d+):(\d+):([\d.]+)/)
      if (m && duration > 0) {
        const secs = parseInt(m[1])*3600 + parseInt(m[2])*60 + parseFloat(m[3])
        const pct  = Math.min(99, Math.round((secs / duration) * 100))
        event.sender.send('export-progress', pct)
      }
    })
    proc.on('close', code => {
      if (code === 0) { event.sender.send('export-progress', 100); resolve({ ok: true }) }
      else reject('FFmpeg error:\n' + stderr.slice(-1000))
    })
  })
})

// ── CONCAT CON TRANSICIONES ───────────────────────────────────────────────────

const XFADE_MAP = {
  fade:'fade', fadeblack:'fadeblack', fadewhite:'fadewhite', flash:'fadewhite',
  slideleft:'slideleft', slideright:'slideright', slideup:'slideup', slidedown:'slidedown',
  wipeleft:'wipeleft', wiperight:'wiperight', wipeup:'wipeup', wipedown:'wipedown',
  zoomin:'zoomin', zoomout:'fadeblack', zoomfade:'fade', blur:'fade',
  glitch:'pixelize', pixelize:'pixelize', spin:'radial',
  dissolve:'dissolve', radial:'radial', circlecrop:'circlecrop',
}

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    let stderr = ''
    const proc = spawn(ffmpegPath, args)
    proc.stderr.on('data', d => { stderr += d.toString() })
    proc.on('close', code => {
      if (code === 0) resolve()
      else {
        console.error('[ffmpeg]\n' + args.join(' ') + '\n' + stderr.slice(-1500))
        reject(new Error(stderr.slice(-600)))
      }
    })
    proc.on('error', err => reject(new Error('spawn: ' + err.message)))
  })
}

function probeFile(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) return reject(err)
      const vs = meta.streams.find(s => s.codec_type === 'video')
      resolve({
        duration: parseFloat(meta.format.duration) || 0,
        hasAudio: meta.streams.some(s => s.codec_type === 'audio'),
        width:  vs ? (vs.width  || 1920) : 1920,
        height: vs ? (vs.height || 1080) : 1080,
      })
    })
  })
}

// ── os.tmpdir() funciona en Windows, Linux y Mac ──────────────────────────────
function tmpPath(tag) {
  return path.join(os.tmpdir(), `ve_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`)
}

async function normalizeClip(inputFile, hasAudio, targetW, targetH) {
  const out = tmpPath('norm')
  const vf = [
    `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease`,
    `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=black`,
    `fps=30`,
    `format=yuv420p`
  ].join(',')

  const args = ['-i', inputFile]
  if (!hasAudio) {
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100')
  }
  args.push(
    '-vf', vf,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-profile:v', 'baseline', '-level', '3.1', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
    '-map', '0:v:0',
    '-map', hasAudio ? '0:a:0' : '1:a:0',
    '-shortest', '-y', out
  )
  await runFFmpeg(args)
  return out
}

async function applyXfade(clipA, clipB, xfadeType, trDur, durA) {
  const out    = tmpPath('xf')
  const offset = Math.max(0.01, durA - trDur)
  const fc = [
    `[0:v][1:v]xfade=transition=${xfadeType}:duration=${trDur.toFixed(3)}:offset=${offset.toFixed(3)}[vout]`,
    `[0:a][1:a]acrossfade=d=${trDur.toFixed(3)}:c1=tri:c2=tri[aout]`
  ].join(';')
  await runFFmpeg([
    '-i', clipA, '-i', clipB,
    '-filter_complex', fc,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-profile:v', 'baseline', '-level', '3.1', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
    '-y', out
  ])
  return out
}

async function concatTwo(clipA, clipB) {
  const out      = tmpPath('cat')
  const listPath = out + '.txt'
  // Usar rutas con forward slashes para el concat de ffmpeg (funciona en Win también)
  const pathA = clipA.replace(/\\/g, '/')
  const pathB = clipB.replace(/\\/g, '/')
  fs.writeFileSync(listPath, `file '${pathA}'\nfile '${pathB}'`)
  try {
    await runFFmpeg([
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-c', 'copy', '-y', out
    ])
  } finally {
    try { fs.unlinkSync(listPath) } catch(e) {}
  }
  return out
}

ipcMain.handle('concat-videos', async (event, { files, output, transitions }) => {
  const allTmp = []
  const cleanup = () => {
    files.forEach(f  => { try { fs.unlinkSync(f) } catch(e) {} })
    allTmp.forEach(f => { try { fs.unlinkSync(f) } catch(e) {} })
  }

  try {
    if (!ffmpegPath) throw new Error('FFmpeg no encontrado.')
    if (!files || files.length === 0) throw new Error('Sin archivos.')

    if (files.length === 1) {
      fs.copyFileSync(files[0], output)
      try { fs.unlinkSync(files[0]) } catch(e) {}
      return { ok: true }
    }

    const send  = pct => event.sender.send('export-progress', Math.min(99, Math.round(pct)))
    const total = files.length

    send(2)
    const infos   = await Promise.all(files.map(f => probeFile(f)))
    const targetW = infos[0].width  || 1920
    const targetH = infos[0].height || 1080
    console.log(`[main] target: ${targetW}x${targetH}, clips: ${total}`)

    // Normalizar todos los clips al mismo formato
    const normalized = []
    for (let i = 0; i < files.length; i++) {
      send(5 + (i / total) * 40)
      console.log(`[main] normalizando ${i+1}/${total}`)
      const normed = await normalizeClip(files[i], infos[i].hasAudio, targetW, targetH)
      allTmp.push(normed)
      const ni = await probeFile(normed)
      normalized.push({ path: normed, duration: ni.duration })
    }

    // Encadenar pares con o sin transición
    let running = normalized[0].path
    let runDur  = normalized[0].duration

    for (let i = 1; i < normalized.length; i++) {
      send(45 + (i / total) * 50)
      const next = normalized[i]
      const tr   = transitions && transitions[i]
      let result

      if (tr && tr.type) {
        const xtype = XFADE_MAP[tr.type] || 'fade'
        const maxTr = Math.min(runDur - 0.1, next.duration - 0.1, 3.0)
        const trDur = Math.max(0.1, Math.min(tr.duration || 0.5, maxTr))
        console.log(`[main] xfade ${i-1}→${i}: ${xtype} ${trDur}s`)
        result = await applyXfade(running, next.path, xtype, trDur, runDur)
        runDur = runDur + next.duration - trDur
      } else {
        console.log(`[main] concat ${i-1}→${i}`)
        result = await concatTwo(running, next.path)
        runDur = runDur + next.duration
      }

      allTmp.push(result)
      if (i > 1) {
        try { fs.unlinkSync(running) } catch(e) {}
        const idx = allTmp.indexOf(running)
        if (idx > -1) allTmp.splice(idx, 1)
      }
      running = result
    }

    fs.copyFileSync(running, output)
    try { fs.unlinkSync(running) } catch(e) {}
    const idx = allTmp.indexOf(running)
    if (idx > -1) allTmp.splice(idx, 1)

    send(100)
    console.log('[main] exportado:', output)
    return { ok: true }

  } catch(err) {
    const msg = err.message || String(err)
    console.error('[main] concat error:', msg)
    throw msg
  } finally {
    cleanup()
  }
})