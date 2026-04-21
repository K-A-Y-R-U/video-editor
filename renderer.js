// ── Estado global ─────────────────────────────────────────────────────────────
const vid = document.getElementById('main-video')
let mediaItems = []
let clips = []
let selectedClip = null
let selectedMediaIndex = -1
let tlZoom = 80
let flipH = false, flipV = false
let currentFilter = ''
let trimStart = 0, trimEnd = 0

// Reproducción multi-clip
let playQueue = []
let playQueueIndex = 0
let isPlayingQueue = false

// Drag state
let drag = null


// ── Undo / Redo ───────────────────────────────────────────────────────────────
const undoStack = []
const redoStack = []
const MAX_HISTORY = 50

function saveState(description = '') {
  const snapshot = JSON.stringify(clips)
  // Don't save if identical to last state
  if (undoStack.length > 0 && undoStack[undoStack.length - 1].state === snapshot) return
  undoStack.push({ state: snapshot, description })
  if (undoStack.length > MAX_HISTORY) undoStack.shift()
  redoStack.length = 0  // clear redo on new action
  updateUndoButtons()
}

function undo() {
  if (undoStack.length === 0) return
  const current = JSON.stringify(clips)
  redoStack.push({ state: current, description: '' })
  const entry = undoStack.pop()
  clips = JSON.parse(entry.state)
  renderTimeline()
  updateUndoButtons()
  setStatus('Deshacer: ' + (entry.description || 'acción'))
}

function redo() {
  if (redoStack.length === 0) return
  const current = JSON.stringify(clips)
  undoStack.push({ state: current, description: '' })
  const entry = redoStack.pop()
  clips = JSON.parse(entry.state)
  renderTimeline()
  updateUndoButtons()
  setStatus('Rehacer: ' + (entry.description || 'acción'))
}

function updateUndoButtons() {
  const undoBtn = document.getElementById('btn-undo')
  const redoBtn = document.getElementById('btn-redo')
  if (undoBtn) undoBtn.disabled = undoStack.length === 0
  if (redoBtn) redoBtn.disabled = redoStack.length === 0
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(s) {
  if (!isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60), sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }
function setStatus(msg) { document.getElementById('status').textContent = msg }

const IMAGE_EXTS = ['jpg','jpeg','png','gif','bmp','webp','tiff']
function isImagePath(p) {
  if (!p) return false
  const ext = p.split('.').pop().toLowerCase()
  return IMAGE_EXTS.includes(ext)
}

// ── Importar ──────────────────────────────────────────────────────────────────
async function importFiles() {
  console.log('[renderer] importFiles llamado')
  if (!window.api) {
    console.error('[renderer] window.api no disponible')
    alert('API no disponible — revisa preload.js')
    return
  }
  console.log('[renderer] llamando window.api.openFile()')
  let paths
  try {
    paths = await window.api.openFile()
    console.log('[renderer] paths recibidos:', paths)
  } catch(e) {
    console.error('[renderer] error en openFile:', e)
    setStatus('Error: ' + e)
    return
  }
  if (!paths || paths.length === 0) {
    console.log('[renderer] sin archivos seleccionados')
    return
  }
  setStatus('Leyendo metadatos...')
  for (const p of paths) {
    const name = p.split('/').pop().split('\\').pop()
    if (isImagePath(p)) {
      console.log('[renderer] imagen detectada:', name)
      mediaItems.push({ path: p, name, duration: 5, isImage: true })
    } else {
      try {
        const meta = await window.api.getMetadata(p)
        const vs = meta.streams.find(s => s.codec_type === 'video')
        const dur = parseFloat(meta.format.duration || (vs && vs.duration) || 0)
        mediaItems.push({ path: p, name, duration: dur, isImage: false })
      } catch(e) {
        console.warn('[renderer] metadata error:', e)
        mediaItems.push({ path: p, name, duration: 0, isImage: false })
      }
    }
  }
  renderMediaPanel()
  setStatus('Listo — doble clic para agregar al timeline')
}

function renderMediaPanel() {
  const list = document.getElementById('media-list')
  const countEl = document.getElementById('media-count')
  list.innerHTML = ''

  if (countEl) countEl.textContent = mediaItems.length

  if (!mediaItems.length) {
    const hint = document.createElement('div')
    hint.className = 'empty-hint'
    hint.innerHTML = '<div class="empty-icon">🎬</div>Importa archivos con<br>el botón de arriba.<br>Doble clic para agregar<br>al timeline.'
    list.appendChild(hint)
    return
  }

  mediaItems.forEach((m, i) => {
    const item = document.createElement('div')
    item.className = 'media-item' + (i === selectedMediaIndex ? ' active' : '')

    const thumb = document.createElement('div')
    thumb.className = 'media-thumb'
    thumb.textContent = m.isImage ? '🖼️' : '🎬'

    const info = document.createElement('div')
    info.className = 'media-info'

    const nameDiv = document.createElement('div')
    nameDiv.className = 'media-name'
    nameDiv.title = m.name
    nameDiv.textContent = m.name

    const durDiv = document.createElement('div')
    durDiv.className = 'media-dur'
    durDiv.textContent = m.isImage ? 'imagen' : fmt(m.duration)

    info.appendChild(nameDiv)
    info.appendChild(durDiv)

    const addBtn = document.createElement('button')
    addBtn.className = 'media-add-btn'
    addBtn.textContent = '+'
    addBtn.title = 'Agregar al timeline'
    addBtn.addEventListener('click', e => { e.stopPropagation(); selectMedia(i); addToTimeline() })

    item.appendChild(thumb)
    item.appendChild(info)
    item.appendChild(addBtn)

    item.addEventListener('click', () => selectMedia(i))
    item.addEventListener('dblclick', () => { selectMedia(i); addToTimeline() })

    list.appendChild(item)
  })
}

function selectMedia(i) {
  selectedMediaIndex = i
  renderMediaPanel()
  const m = mediaItems[i]
  loadMedia(m.path, 0)
  if (!m.isImage) {
    vid.onloadedmetadata = () => { updateTimeDisplay(); setupTrimSliders(m.duration) }
  } else {
    setupTrimSliders(m.duration)
    updateTimeDisplay()
  }
}

// ── Cargar video o imagen en el preview ───────────────────────────────────────
function loadMedia(filePath, startAt) {
  let previewImg = document.getElementById('preview-img')

  if (isImagePath(filePath)) {
    vid.pause()
    vid.src = ''
    vid.style.display = 'none'

    if (!previewImg) {
      previewImg = document.createElement('img')
      previewImg.id = 'preview-img'
      previewImg.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;display:block;margin:auto;position:absolute'
      vid.parentNode.appendChild(previewImg)
    }
    previewImg.src = 'file://' + filePath
    previewImg.style.display = 'block'
    document.getElementById('no-video').style.display = 'none'
    updateTimeDisplay()
  } else {
    if (previewImg) previewImg.style.display = 'none'
    vid.style.display = 'block'
    vid.src = 'file://' + filePath
    document.getElementById('no-video').style.display = 'none'
    vid.load()
    vid.onloadedmetadata = () => {
      if (startAt > 0) vid.currentTime = startAt
      updateTimeDisplay()
    }
  }
}

function loadVideo(path, startAt) { loadMedia(path, startAt) }

function setupTrimSliders(dur) {
  const ts = document.getElementById('trim-s')
  const te = document.getElementById('trim-e')
  ts.max = dur; ts.value = 0
  te.max = dur; te.value = dur
  trimStart = 0; trimEnd = dur
  document.getElementById('trim-s-v').textContent = '0s'
  document.getElementById('trim-e-v').textContent = fmt(dur)
  updateProgressMarkers()
}

// ── Estilos drag ──────────────────────────────────────────────────────────────
;(function injectStyles() {
  if (document.getElementById('tl-drag-style')) return
  const s = document.createElement('style')
  s.id = 'tl-drag-style'
  s.textContent = `
    .tl-clip { user-select:none; cursor:grab; display:flex; align-items:center; overflow:hidden; }
    .tl-clip.dragging { opacity:.8; cursor:grabbing; }
    .tl-clip-label { pointer-events:none; font-size:10px; white-space:nowrap; overflow:hidden; flex:1; padding:0 4px; }
    .tl-resize-handle { flex-shrink:0; width:8px; height:100%; background:rgba(255,255,255,0.2); cursor:ew-resize; z-index:5; }
    .tl-resize-handle:hover { background:rgba(255,180,60,0.7); }
    .tl-resize-handle.left  { border-radius:4px 0 0 4px; }
    .tl-resize-handle.right { border-radius:0 4px 4px 0; }
    .tl-clip.selected { border-color:#f7a84f !important; border-width:2px !important; }
  `
  document.head.appendChild(s)
})()

// ── Timeline ──────────────────────────────────────────────────────────────────
function addToTimeline() {
  saveState('agregar clip')
  if (selectedMediaIndex < 0) { setStatus('Selecciona un clip primero'); return }
  const m = mediaItems[selectedMediaIndex]
  const id = Date.now()
  const tlStart = clips.reduce((acc, c) => Math.max(acc, c.tlStart + c.tlDuration), 0)
  const start = trimStart || 0
  const dur = (trimEnd - trimStart) > 0 ? (trimEnd - trimStart) : m.duration
  clips.push({ id, path: m.path, name: m.name, start, duration: m.duration, tlStart, tlDuration: dur, isImage: m.isImage || false })
  renderTimeline()
  setStatus(`Clip agregado: ${m.name}`)
}

function renderTimeline() {
  const totalDur = clips.reduce((a, c) => Math.max(a, c.tlStart + c.tlDuration), 10)
  const scrollEl = document.getElementById('tl-scroll')
  const w = Math.max(totalDur * tlZoom + 200, (scrollEl.clientWidth || 600))

  const ruler = document.getElementById('tl-ruler')
  ruler.style.width = w + 'px'
  const step = tlZoom >= 60 ? 1 : tlZoom >= 30 ? 2 : 5
  let rHtml = ''
  for (let t = 0; t <= totalDur + step; t += step) {
    const x = t * tlZoom
    rHtml += `<div class="tl-tick" style="left:${x}px"></div>
              <div class="tl-tick-label" style="left:${x}px">${fmt(t)}</div>`
  }
  ruler.innerHTML = rHtml

  const vt = document.getElementById('tl-video-track')
  const at = document.getElementById('tl-audio-track')
  vt.style.width = w + 'px'
  at.style.width = w + 'px'
  document.getElementById('tl-inner').style.width = w + 'px'


  // Video track clips
  vt.innerHTML = ''
  clips.forEach(c => {
    const left  = c.tlStart * tlZoom
    const width = Math.max(c.tlDuration * tlZoom, 20)
    const sel   = selectedClip === c.id ? 'selected' : ''
    const icon  = c.isImage ? '🖼' : '🎬'

    const div = document.createElement('div')
    div.className = `tl-clip video ${sel}`
    div.style.cssText = `left:${left}px;width:${width}px`
    div.dataset.id = c.id

    const leftHandle = document.createElement('div')
    leftHandle.className = 'tl-resize-handle left'
    leftHandle.addEventListener('mousedown', e => clipMouseDown(e, c.id, 'resize-left'))

    const label = document.createElement('span')
    label.className = 'tl-clip-label'
    label.textContent = icon + ' ' + c.name

    const rightHandle = document.createElement('div')
    rightHandle.className = 'tl-resize-handle right'
    rightHandle.addEventListener('mousedown', e => clipMouseDown(e, c.id, 'resize-right'))

    div.appendChild(leftHandle)
    div.appendChild(label)
    div.appendChild(rightHandle)
    div.addEventListener('mousedown', e => {
      // Only trigger move if not clicking a resize handle
      if (!e.target.classList.contains('tl-resize-handle')) clipMouseDown(e, c.id, 'move')
    })
    vt.appendChild(div)
  })

  // Audio track clips
  at.innerHTML = ''
  clips.forEach(c => {
    const left  = c.tlStart * tlZoom
    const width = Math.max(c.tlDuration * tlZoom, 20)
    const sel   = selectedClip === c.id ? 'selected' : ''

    const div = document.createElement('div')
    div.className = `tl-clip audio ${sel}`
    div.style.cssText = `left:${left}px;width:${width}px`
    div.dataset.id = c.id
    div.addEventListener('mousedown', e => clipMouseDown(e, c.id, 'move'))
    at.appendChild(div)
  })

  document.getElementById('tl-info').textContent =
    clips.length ? `${clips.length} clip(s) · ${fmt(totalDur)}` : 'Sin clips'
}


// ── Drag ──────────────────────────────────────────────────────────────────────
function clipMouseDown(e, id, type) {
  e.stopPropagation(); e.preventDefault()
  saveState('mover clip')
  selectClip(id)
  const c = clips.find(x => x.id === id)
  if (!c) return
  drag = { type, clipId: id, startX: e.clientX, origTlStart: c.tlStart, origTlDuration: c.tlDuration, origStart: c.start }
}

document.addEventListener('mousemove', e => {
  if (!drag) return
  const c = clips.find(x => x.id === drag.clipId)
  if (!c) return
  const dx = e.clientX - drag.startX
  const dt = dx / tlZoom
  const minDur = 0.1
  if (drag.type === 'move') {
    c.tlStart = Math.max(0, drag.origTlStart + dt)
  } else if (drag.type === 'resize-right') {
    c.tlDuration = clamp(drag.origTlDuration + dt, minDur, c.duration - c.start)
  } else if (drag.type === 'resize-left') {
    const maxShift = drag.origTlDuration - minDur
    const shift = clamp(dt, -drag.origStart, maxShift)
    c.tlStart    = Math.max(0, drag.origTlStart + shift)
    c.tlDuration = drag.origTlDuration - shift
    c.start      = drag.origStart + shift
  }
  renderClipPositions()
})

document.addEventListener('mouseup', () => {
  if (!drag) return
  drag = null
  renderTimeline()
})

function renderClipPositions() {
  clips.forEach(c => {
    const left  = c.tlStart * tlZoom
    const width = Math.max(c.tlDuration * tlZoom, 20)
    ;[document.getElementById('tl-video-track'), document.getElementById('tl-audio-track')]
      .forEach(track => {
        const el = track.querySelector(`[data-id="${c.id}"]`)
        if (el) { el.style.left = left + 'px'; el.style.width = width + 'px' }
      })
  })
}

function selectClip(id) {
  selectedClip = id
  const c = clips.find(x => x.id === id)
  if (!c) return
  renderTimeline()
  loadMedia(c.path, c.start)
  if (!c.isImage) setupTrimSliders(c.duration)
  setStatus(`Seleccionado: ${c.name}`)
}

function splitClip() {
  saveState('dividir clip')
  if (!selectedClip) { setStatus('Selecciona un clip en el timeline'); return }
  const idx = clips.findIndex(c => c.id === selectedClip)
  if (idx < 0) return
  const c = clips[idx]
  const splitAt = vid.currentTime - c.start
  if (splitAt <= 0.05 || splitAt >= c.tlDuration - 0.05) { setStatus('Posiciona el playhead dentro del clip'); return }
  const newId = Date.now()
  const c2 = {
    id: newId, path: c.path, name: c.name + '_B',
    start: c.start + splitAt, duration: c.duration,
    tlStart: c.tlStart + splitAt, tlDuration: c.tlDuration - splitAt,
    isImage: c.isImage || false
  }
  c.tlDuration = splitAt
  clips.splice(idx + 1, 0, c2)
  renderTimeline()
  setStatus('Clip dividido')
}

function deleteClip() {
  saveState('eliminar clip')
  if (!selectedClip) { setStatus('Selecciona un clip'); return }
  clips = clips.filter(c => c.id !== selectedClip)
  selectedClip = null
  renderTimeline()
  setStatus('Clip eliminado')
}

function setTLZoom(v) { tlZoom = parseInt(v); renderTimeline() }

function tlSeek(e) {
  if (drag) return
  const scrollEl = document.getElementById('tl-scroll')
  const rect = scrollEl.getBoundingClientRect()
  const x = e.clientX - rect.left + scrollEl.scrollLeft
  const t = x / tlZoom
  const c = clips.find(cl => t >= cl.tlStart && t <= cl.tlStart + cl.tlDuration)
  if (c) { selectClip(c.id); if (!c.isImage) vid.currentTime = c.start + (t - c.tlStart) }
  updatePlayhead(t)
}

function updatePlayhead(t) {
  document.getElementById('tl-playhead').style.left = (t * tlZoom) + 'px'
}

// ── Reproducción multi-clip ───────────────────────────────────────────────────
function buildPlayQueue() {
  return [...clips].sort((a, b) => a.tlStart - b.tlStart)
}

function togglePlay() {
  if (isPlayingQueue) {
    vid.pause()
    isPlayingQueue = false
    document.getElementById('play-btn').textContent = '▶'
    return
  }
  if (clips.length > 0) {
    playQueue = buildPlayQueue()
    const playheadLeft = parseFloat(document.getElementById('tl-playhead').style.left || '0')
    const playheadT = playheadLeft / tlZoom
    playQueueIndex = playQueue.findIndex(c => playheadT < c.tlStart + c.tlDuration)
    if (playQueueIndex < 0) playQueueIndex = 0
    isPlayingQueue = true
    document.getElementById('play-btn').textContent = '⏸'
    playClipAt(playQueueIndex)
  } else if (vid.src) {
    vid.paused ? vid.play() : vid.pause()
  }
}

function playClipAt(index) {
  if (index >= playQueue.length) {
    isPlayingQueue = false
    document.getElementById('play-btn').textContent = '▶'
    setStatus('Reproducción terminada')
    return
  }
  playQueueIndex = index
  const c = playQueue[index]
  setStatus(`Reproduciendo: ${c.name} (${index + 1}/${playQueue.length})`)

  if (c.isImage) {
    loadMedia(c.path, 0)
    let elapsed = 0
    const interval = setInterval(() => {
      elapsed += 0.1
      const globalT = c.tlStart + elapsed
      updatePlayhead(globalT)
      const totalDur = playQueue.reduce((a, x) => a + x.tlDuration, 0)
      document.getElementById('time-display').textContent = fmt(globalT) + ' / ' + fmt(totalDur)
      if (elapsed >= c.tlDuration || !isPlayingQueue) {
        clearInterval(interval)
        if (isPlayingQueue) playClipAt(playQueueIndex + 1)
      }
    }, 100)
  } else {
    const previewImg = document.getElementById('preview-img')
    if (previewImg) previewImg.style.display = 'none'
    vid.style.display = 'block'
    vid.src = 'file://' + c.path
    document.getElementById('no-video').style.display = 'none'
    vid.playbackRate = parseFloat(document.getElementById('speed-sl').value) / 100
    vid.onloadedmetadata = () => {
      vid.currentTime = c.start
      vid.play().catch(err => console.warn('play error:', err))
    }
  }
}

vid.addEventListener('timeupdate', () => {
  const dur = vid.duration || 1
  document.getElementById('progress-fill').style.width = (vid.currentTime / dur * 100) + '%'
  if (isPlayingQueue && playQueue.length > 0) {
    const c = playQueue[playQueueIndex]
    if (c && !c.isImage) {
      const globalT = c.tlStart + (vid.currentTime - c.start)
      updatePlayhead(globalT)
      const totalDur = playQueue.reduce((a, x) => a + x.tlDuration, 0)
      document.getElementById('time-display').textContent = fmt(globalT) + ' / ' + fmt(totalDur)
      if (vid.currentTime >= c.start + c.tlDuration - 0.1) {
        vid.pause()
        playClipAt(playQueueIndex + 1)
      }
    }
  } else {
    updateTimeDisplay()
    if (selectedClip) {
      const c = clips.find(x => x.id === selectedClip)
      if (c && !c.isImage) updatePlayhead(c.tlStart + (vid.currentTime - c.start))
    }
  }
})

vid.addEventListener('ended', () => {
  if (isPlayingQueue) playClipAt(playQueueIndex + 1)
  else { document.getElementById('play-btn').textContent = '▶'; isPlayingQueue = false }
})

vid.addEventListener('play',  () => { if (!isPlayingQueue) document.getElementById('play-btn').textContent = '⏸' })
vid.addEventListener('pause', () => { if (!isPlayingQueue) document.getElementById('play-btn').textContent = '▶' })

function updateTimeDisplay() {
  document.getElementById('time-display').textContent = `${fmt(vid.currentTime)} / ${fmt(vid.duration || 0)}`
}

function toggleMute() {
  vid.muted = !vid.muted
  document.getElementById('mute-btn').textContent = vid.muted ? '🔇' : '🔊'
}

function seekClick(e) {
  if (!vid.duration) return
  const bar = document.getElementById('progress-bar')
  vid.currentTime = ((e.clientX - bar.getBoundingClientRect().left) / bar.offsetWidth) * vid.duration
}

// ── Trim ──────────────────────────────────────────────────────────────────────
function updateTrim() {
  const ts = parseFloat(document.getElementById('trim-s').value)
  const te = parseFloat(document.getElementById('trim-e').value)
  if (ts >= te) return
  trimStart = ts; trimEnd = te
  document.getElementById('trim-s-v').textContent = fmt(ts)
  document.getElementById('trim-e-v').textContent = fmt(te)
  if (vid.duration) vid.currentTime = ts
  updateProgressMarkers()
}

function updateProgressMarkers() {
  const dur = vid.duration || 100
  document.getElementById('trim-start-marker').style.left = (trimStart / dur * 100) + '%'
  document.getElementById('trim-end-marker').style.left   = (trimEnd  / dur * 100) + '%'
}

// ── Velocidad ─────────────────────────────────────────────────────────────────
function updateSpeed(v) {
  vid.playbackRate = v / 100
  document.getElementById('speed-v').textContent = (v / 100).toFixed(2) + '×'
}
function setSpeed(v) { document.getElementById('speed-sl').value = v; updateSpeed(v) }

// ── Color / Transform / Filtros ───────────────────────────────────────────────
function updateAdj() {
  document.getElementById('br-v').textContent  = document.getElementById('br-sl').value
  document.getElementById('ct-v').textContent  = document.getElementById('ct-sl').value
  document.getElementById('sat-v').textContent = document.getElementById('sat-sl').value
  applyVideoStyle()
}

function updateTransform() {
  document.getElementById('rot-v').textContent  = document.getElementById('rot-sl').value + '°'
  document.getElementById('zoom-v').textContent = document.getElementById('zoom-sl').value + '%'
  applyVideoStyle()
}

function toggleFlip(axis) {
  if (axis === 'h') { flipH = !flipH; document.getElementById('flip-h-btn').classList.toggle('on', flipH) }
  else              { flipV = !flipV; document.getElementById('flip-v-btn').classList.toggle('on', flipV) }
  applyVideoStyle()
}

function applyVideoStyle() {
  const br  = (parseFloat(document.getElementById('br-sl').value)  / 100 + 1).toFixed(2)
  const ct  = (parseFloat(document.getElementById('ct-sl').value)  / 100 + 1).toFixed(2)
  const sat = (parseFloat(document.getElementById('sat-sl').value) / 100 + 1).toFixed(2)
  const rot  = document.getElementById('rot-sl').value
  const zoom = document.getElementById('zoom-sl').value / 100
  const filterStr    = `brightness(${br}) contrast(${ct}) saturate(${sat}) ${currentFilter}`
  const transformStr = `rotate(${rot}deg) scale(${flipH ? -zoom : zoom},${flipV ? -zoom : zoom})`
  vid.style.filter    = filterStr
  vid.style.transform = transformStr
  const previewImg = document.getElementById('preview-img')
  if (previewImg) {
    previewImg.style.filter    = filterStr
    previewImg.style.transform = transformStr
  }
}

function setFilter(btn, filter) {
  currentFilter = filter
  document.querySelectorAll('.prop-btns .pbtn').forEach(b => b.classList.remove('on'))
  btn.classList.add('on')
  applyVideoStyle()
}

// ── Exportar ──────────────────────────────────────────────────────────────────
async function startExport() {
  if (!window.api) { alert('API no disponible'); return }
  if (!clips.length) { setStatus('Agrega clips al timeline primero'); return }

  const outPath = await window.api.saveFile()
  if (!outPath) return

  const overlay = document.getElementById('export-overlay')
  overlay.style.display = 'flex'
  document.getElementById('export-bar').style.width = '0%'
  document.getElementById('export-pct').textContent = '0%'

  const ordered    = [...clips].sort((a, b) => a.tlStart - b.tlStart)
  const speed      = parseFloat(document.getElementById('speed-sl').value) / 100
  const brightness = parseFloat(document.getElementById('br-sl').value)
  const contrast   = parseFloat(document.getElementById('ct-sl').value)
  const total      = ordered.length

  try {
    if (total === 1) {
      const c = ordered[0]
      window.api.onProgress(pct => {
        document.getElementById('export-bar').style.width = pct + '%'
        document.getElementById('export-pct').textContent = pct + '%'
      })
      await window.api.exportVideo({ input: c.path, output: outPath, startTime: c.start, duration: c.tlDuration, speed, brightness, contrast })
    } else {
      const tmpFiles = []
      for (let i = 0; i < ordered.length; i++) {
        const c = ordered[i]
        const tmpOut = `/tmp/ve_clip_${Date.now()}_${i}.mp4`
        tmpFiles.push(tmpOut)
        setStatus(`Procesando clip ${i + 1} de ${total}: ${c.name}`)
        window.api.onProgress(pct => {
          const overall = Math.round(((i + pct / 100) / total) * 90)
          document.getElementById('export-bar').style.width = overall + '%'
          document.getElementById('export-pct').textContent = overall + '%'
        })
        await window.api.exportVideo({ input: c.path, output: tmpOut, startTime: c.start, duration: c.tlDuration, speed, brightness, contrast })
      }
      setStatus('Uniendo clips...')
      document.getElementById('export-bar').style.width = '92%'
      document.getElementById('export-pct').textContent = '92%'
      await window.api.concatVideos({ files: tmpFiles, output: outPath })
    }
    overlay.style.display = 'none'
    setStatus('✓ Exportado: ' + outPath.split('/').pop())
  } catch(e) {
    overlay.style.display = 'none'
    setStatus('Error: ' + e)
    alert('Error al exportar:\n' + e)
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
renderTimeline()
// ── Event Listeners (CSP-safe, no inline handlers) ───────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Undo / Redo keyboard shortcuts
  document.addEventListener('keydown', e => {
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
    if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
  })

  // Undo / Redo buttons
  const btnUndo = document.getElementById('btn-undo')
  const btnRedo = document.getElementById('btn-redo')
  if (btnUndo) btnUndo.addEventListener('click', undo)
  if (btnRedo) btnRedo.addEventListener('click', redo)
  updateUndoButtons()

  // Props panel tab switching
  document.querySelectorAll('.props-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.props-tab').forEach(t => t.classList.remove('active'))
      document.querySelectorAll('.props-body').forEach(b => b.style.display = 'none')
      tab.classList.add('active')
      document.getElementById('tab-' + tab.dataset.tab).style.display = 'block'
    })
  })

  // Topbar
  document.getElementById('btn-import').addEventListener('click', importFiles)
  document.getElementById('btn-add-timeline').addEventListener('click', addToTimeline)
  document.getElementById('btn-split-top').addEventListener('click', splitClip)
  document.getElementById('btn-delete-top').addEventListener('click', deleteClip)
  document.getElementById('btn-export').addEventListener('click', startExport)

  // Controles de video
  document.getElementById('progress-bar').addEventListener('click', seekClick)
  document.getElementById('btn-rewind').addEventListener('click', () => { vid.currentTime = 0 })
  document.getElementById('btn-back1s').addEventListener('click', () => { vid.currentTime = Math.max(0, vid.currentTime - 1) })
  document.getElementById('play-btn').addEventListener('click', togglePlay)
  document.getElementById('btn-fwd1s').addEventListener('click', () => { vid.currentTime = Math.min(vid.duration || 0, vid.currentTime + 1) })
  document.getElementById('mute-btn').addEventListener('click', toggleMute)
  document.getElementById('speed-select').addEventListener('change', e => { vid.playbackRate = parseFloat(e.target.value) })

  // Sliders de propiedades
  document.getElementById('trim-s').addEventListener('input', updateTrim)
  document.getElementById('trim-e').addEventListener('input', updateTrim)
  document.getElementById('speed-sl').addEventListener('input', e => updateSpeed(e.target.value))
  document.getElementById('br-sl').addEventListener('input', updateAdj)
  document.getElementById('ct-sl').addEventListener('input', updateAdj)
  document.getElementById('sat-sl').addEventListener('input', updateAdj)
  document.getElementById('rot-sl').addEventListener('input', updateTransform)
  document.getElementById('zoom-sl').addEventListener('input', updateTransform)
  document.getElementById('tl-zoom-sl').addEventListener('input', e => setTLZoom(e.target.value))

  // Botones de velocidad
  document.getElementById('btn-speed-50').addEventListener('click', () => setSpeed(50))
  document.getElementById('btn-speed-100').addEventListener('click', () => setSpeed(100))
  document.getElementById('btn-speed-200').addEventListener('click', () => setSpeed(200))
  document.getElementById('btn-speed-300').addEventListener('click', () => setSpeed(300))

  // Flip
  document.getElementById('flip-h-btn').addEventListener('click', () => toggleFlip('h'))
  document.getElementById('flip-v-btn').addEventListener('click', () => toggleFlip('v'))

  // Filtros (usando data-filter en lugar de onclick)
  document.querySelectorAll('#filter-btns .pbtn').forEach(btn => {
    btn.addEventListener('click', () => setFilter(btn, btn.dataset.filter))
  })

  // Timeline
  document.getElementById('tl-scroll').addEventListener('click', tlSeek)
  document.getElementById('btn-split-tl').addEventListener('click', splitClip)
  document.getElementById('btn-delete-tl').addEventListener('click', deleteClip)
})