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
let libraryDrag = null  // drag from library to timeline

// ── Marcadores de Loop ─────────────────────────────────────────────────────────
// markers = array de { id, time } — al llegar a ese tiempo vuelve al segundo 0
let markers = []
let markerDrag = null  // drag state para mover marcadores

// ── Sistema de Transiciones ────────────────────────────────────────────────────
// transitions[clipId] = { type, duration } → transición ANTES de ese clip
let transitions = {}
let activeTransitionAnim = null  // animación en curso

const TRANSITION_CATEGORIES = {
  'Básico': [
    { id: 'fade',       name: 'Fade',        icon: '◼' },
    { id: 'fadeblack',  name: 'Negro',       icon: '⬛' },
    { id: 'fadewhite',  name: 'Blanco',      icon: '⬜' },
    { id: 'flash',      name: 'Flash',       icon: '⚡' },
  ],
  'Movimiento': [
    { id: 'slideleft',  name: 'Slide ←',     icon: '←' },
    { id: 'slideright', name: 'Slide →',     icon: '→' },
    { id: 'slideup',    name: 'Slide ↑',     icon: '↑' },
    { id: 'slidedown',  name: 'Slide ↓',     icon: '↓' },
    { id: 'wipeleft',   name: 'Wipe ←',      icon: '⬅' },
    { id: 'wiperight',  name: 'Wipe →',      icon: '➡' },
    { id: 'wipeup',     name: 'Wipe ↑',      icon: '⬆' },
    { id: 'wipedown',   name: 'Wipe ↓',      icon: '⬇' },
  ],
  'Zoom': [
    { id: 'zoomin',     name: 'Zoom In',     icon: '🔍' },
    { id: 'zoomout',    name: 'Zoom Out',    icon: '🔎' },
    { id: 'zoomfade',   name: 'Zoom Fade',   icon: '💫' },
  ],
  'Distorsión': [
    { id: 'blur',       name: 'Blur',        icon: '🌫' },
    { id: 'glitch',     name: 'Glitch',      icon: '📺' },
    { id: 'pixelize',   name: 'Pixelize',    icon: '🟦' },
    { id: 'spin',       name: 'Spin',        icon: '🌀' },
  ],
  'Luz': [
    { id: 'dissolve',   name: 'Disolver',    icon: '✨' },
    { id: 'radial',     name: 'Radial',      icon: '☀' },
    { id: 'circlecrop', name: 'Círculo',     icon: '⭕' },
  ],
}

// Transición actualmente seleccionada en el panel
let panelSelectedTransitionClipId = null


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
  document.getElementById('btn-apply-all').addEventListener('click', applyToAll)
}

function undo() {
  if (undoStack.length === 0) return
  const current = JSON.stringify(clips)
  redoStack.push({ state: current, description: '' })
  const entry = undoStack.pop()
  clips = JSON.parse(entry.state)
  renderTimeline()
  updateUndoButtons()
  document.getElementById('btn-apply-all').addEventListener('click', applyToAll)
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
  document.getElementById('btn-apply-all').addEventListener('click', applyToAll)
  setStatus('Rehacer: ' + (entry.description || 'acción'))
}

function updateUndoButtons() {
  const undoBtn = document.getElementById('btn-undo')
  const redoBtn = document.getElementById('btn-redo')
  if (undoBtn) undoBtn.disabled = undoStack.length === 0
  if (redoBtn) redoBtn.disabled = redoStack.length === 0
}


// ── Propiedades por clip ──────────────────────────────────────────────────────
function defaultClipProps() {
  return {
    trimStart: 0, trimEnd: 0,
    speed: 100,
    brightness: 0, contrast: 0, saturation: 0,
    rotation: 0, zoom: 100,
    flipH: false, flipV: false,
    filter: ''
  }
}

function getSelectedClip() {
  return clips.find(c => c.id === selectedClip) || null
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
    hint.innerHTML = '<div class="empty-icon">🎬</div>Importa archivos con<br>el botón de arriba.<br>Arrastra al timeline<br>o doble clic para agregar.'
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

    // Native mousedown drag (works in Electron, no HTML5 drag API needed)
    item.addEventListener('mousedown', e => {
      if (e.button !== 0) return
      if (e.target.classList.contains('media-add-btn')) return
      startLibraryDrag(e, i)
    })

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

  // tlStart = end of the last clip in the timeline
  const tlStart = clips.reduce((acc, c) => Math.max(acc, c.tlStart + c.tlDuration), 0)

  // For images use fixed 5s duration; for video use full duration ignoring stale trimStart/trimEnd
  const isImg = m.isImage || false
  const clipDuration = isImg ? 5 : (m.duration || 10)
  const clipStart = 0  // always start from beginning of the source file

  const props = defaultClipProps()
  props.trimStart = 0
  props.trimEnd   = clipDuration

  clips.push({
    id,
    path: m.path,
    name: m.name,
    start: clipStart,
    duration: isImg ? 5 : (m.duration || 10),
    tlStart,
    tlDuration: clipDuration,
    isImage: isImg,
    track: 0,
    audioTrack: 0,
    props
  })
  renderTimeline()
  setStatus(`Clip agregado: ${m.name}`)
}

// ── Clip element builders ─────────────────────────────────────────────────────
function makeVideoClipEl(c) {
  const left  = c.tlStart * tlZoom
  const width = Math.max(c.tlDuration * tlZoom, 20)
  const sel   = selectedClip === c.id ? 'selected' : ''
  const icon  = c.isImage ? '🖼' : '🎬'
  const div = document.createElement('div')
  div.className = `tl-clip video ${sel}`
  div.style.cssText = `left:${left}px;width:${width}px`
  div.dataset.id = c.id
  const lh = document.createElement('div')
  lh.className = 'tl-resize-handle left'
  lh.addEventListener('mousedown', e => clipMouseDown(e, c.id, 'resize-left'))
  const label = document.createElement('span')
  label.className = 'tl-clip-label'
  label.textContent = icon + ' ' + c.name
  const rh = document.createElement('div')
  rh.className = 'tl-resize-handle right'
  rh.addEventListener('mousedown', e => clipMouseDown(e, c.id, 'resize-right'))
  div.appendChild(lh); div.appendChild(label); div.appendChild(rh)
  div.addEventListener('mousedown', e => {
    if (!e.target.classList.contains('tl-resize-handle')) clipMouseDown(e, c.id, 'move')
  })
  return div
}

function makeAudioClipEl(c) {
  const left  = c.tlStart * tlZoom
  const width = Math.max(c.tlDuration * tlZoom, 20)
  const sel   = selectedClip === c.id ? 'selected' : ''
  const div = document.createElement('div')
  div.className = `tl-clip audio ${sel}`
  div.style.cssText = `left:${left}px;width:${width}px`
  div.dataset.id = c.id
  div.addEventListener('mousedown', e => clipMouseDown(e, c.id, 'move'))
  return div
}

// ── Marcadores ────────────────────────────────────────────────────────────────
function addMarkerAtPlayhead() {
  const t = getPlayheadTime()
  if (t <= 0) { setStatus('Mueve el playhead a donde quieres el marcador'); return }
  // Evitar duplicados muy cercanos
  const nearby = markers.find(m => Math.abs(m.time - t) < 0.2)
  if (nearby) { setStatus('Ya hay un marcador en esa posición'); return }
  markers.push({ id: Date.now(), time: t })
  markers.sort((a, b) => a.time - b.time)
  renderMarkers()
  setStatus(`Marcador de loop agregado en ${fmt(t)}`)
}

function removeMarker(id) {
  markers = markers.filter(m => m.id !== id)
  renderMarkers()
  setStatus('Marcador eliminado')
}

function clearAllMarkers() {
  markers = []
  renderMarkers()
  setStatus('Marcadores eliminados')
}

function renderMarkers() {
  // Eliminar marcadores anteriores del DOM
  document.querySelectorAll('.tl-marker').forEach(el => el.remove())

  const inner = document.getElementById('tl-inner')
  if (!inner) return

  markers.forEach(m => {
    const x = m.time * tlZoom
    const el = document.createElement('div')
    el.className = 'tl-marker'
    el.style.left = x + 'px'
    el.dataset.id = m.id
    el.title = `Loop → 0:00 en ${fmt(m.time)}\nClic derecho para eliminar`

    // Línea vertical
    const line = document.createElement('div')
    line.className = 'tl-marker-line'

    // Cabeza del marcador (triángulo + etiqueta)
    const head = document.createElement('div')
    head.className = 'tl-marker-head'
    head.innerHTML = `<span class="tl-marker-icon">↺</span><span class="tl-marker-label">${fmt(m.time)}</span>`

    el.appendChild(head)
    el.appendChild(line)
    inner.appendChild(el)

    // Drag para mover el marcador
    head.addEventListener('mousedown', e => {
      if (e.button !== 0) return
      e.stopPropagation()
      markerDrag = { id: m.id, startX: e.clientX, origTime: m.time }
    })

    // Clic derecho para eliminar
    el.addEventListener('contextmenu', e => {
      e.preventDefault()
      e.stopPropagation()
      removeMarker(m.id)
    })
  })
}

// Actualizar posición visual de marcadores cuando cambia el zoom
function updateMarkerPositions() {
  markers.forEach(m => {
    const el = document.querySelector(`.tl-marker[data-id="${m.id}"]`)
    if (el) el.style.left = (m.time * tlZoom) + 'px'
  })
}

// Checar si el playhead pasó por un marcador durante la reproducción
function checkMarkersAt(globalT) {
  for (const m of markers) {
    if (Math.abs(globalT - m.time) < 0.15) {
      // Volver al inicio del clip que se está reproduciendo ahora
      const currentClip = playQueue[playQueueIndex]
      if (!currentClip) return false
      console.log(`[markers] loop en ${fmt(m.time)} → inicio de "${currentClip.name}"`)
      vid.pause()
      seekToTime(currentClip.tlStart)
      setTimeout(() => togglePlay(), 80)
      return true
    }
  }
  return false
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

  // Clear all tracks
  const vt2 = document.getElementById('tl-video-track-2')
  const at2 = document.getElementById('tl-audio-track-2')
  vt.innerHTML = ''; if (vt2) vt2.innerHTML = ''
  at.innerHTML = ''; if (at2) at2.innerHTML = ''

  // Sort track-0 clips by tlStart to insert transition buttons between consecutive ones
  const track0Clips = clips
    .filter(c => (c.track || 0) === 0)
    .sort((a, b) => a.tlStart - b.tlStart)

  clips.forEach(c => {
    const trackIdx = c.track || 0
    const audioTrackIdx = c.audioTrack || 0

    const vEl = makeVideoClipEl(c)
    if (trackIdx === 1 && vt2) vt2.appendChild(vEl)
    else vt.appendChild(vEl)

    if (!c.isImage) {
      const aEl = makeAudioClipEl(c)
      if (audioTrackIdx === 1 && at2) at2.appendChild(aEl)
      else at.appendChild(aEl)
    }
  })

  // Add transition buttons between consecutive track-0 clips
  for (let i = 1; i < track0Clips.length; i++) {
    const prev = track0Clips[i - 1]
    const curr = track0Clips[i]
    const gap = curr.tlStart - (prev.tlStart + prev.tlDuration)
    // Only add button if clips are adjacent (gap < 0.5s)
    if (Math.abs(gap) < 0.5) {
      const junctionX = curr.tlStart * tlZoom
      const btn = document.createElement('div')
      btn.className = 'tl-transition-btn' + (transitions[curr.id] ? ' has-transition' : '')
      btn.style.left = (junctionX - 11) + 'px'
      btn.title = transitions[curr.id] ? `Transición: ${transitions[curr.id].type}` : 'Agregar transición'
      btn.dataset.clipId = curr.id
      btn.innerHTML = transitions[curr.id] ? '⇄' : '+'
      btn.addEventListener('click', e => {
        e.stopPropagation()
        openTransitionPanel(curr.id)
      })
      vt.appendChild(btn)
    }
  }

  document.getElementById('tl-info').textContent =
    clips.length ? `${clips.length} clip(s) · ${fmt(totalDur)}` : 'Sin clips'

  renderMarkers()
}

// ── Panel de transiciones ──────────────────────────────────────────────────────
function openTransitionPanel(clipId) {
  panelSelectedTransitionClipId = clipId

  // Switch left rail to transitions panel
  document.querySelectorAll('.rail-btn').forEach(b => b.classList.remove('active'))
  document.querySelectorAll('.lpanel').forEach(p => p.style.display = 'none')
  const railBtn = document.querySelector('.rail-btn[data-panel="transitions"]')
  if (railBtn) railBtn.classList.add('active')

  renderTransitionsPanel(clipId)
  const panel = document.getElementById('lpanel-transitions')
  if (panel) panel.style.display = 'flex'
}

function renderTransitionsPanel(clipId) {
  const panel = document.getElementById('lpanel-transitions')
  if (!panel) return

  const current = transitions[clipId] || null

  let html = `
    <div class="panel-header" style="flex-shrink:0">
      <span class="panel-title">Transiciones</span>
      ${current ? `<button id="btn-remove-transition" style="background:var(--red-dim);border:1px solid var(--red);color:var(--red);font-size:10px;padding:2px 8px;border-radius:4px;cursor:pointer;font-family:inherit">✕ Quitar</button>` : ''}
    </div>
  `

  if (current) {
    html += `
      <div style="padding:10px 12px;background:var(--bg-2);border-bottom:1px solid var(--border);flex-shrink:0">
        <div style="font-size:10px;color:var(--text-3);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.8px">Transición activa</div>
        <div style="font-size:12px;color:var(--accent);font-weight:600;margin-bottom:10px">${current.type}</div>
        <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">Duración: <span style="color:var(--text-2);font-family:monospace">${current.duration.toFixed(1)}s</span></div>
        <input type="range" id="tr-duration-sl" min="1" max="15" value="${Math.round(current.duration * 10)}" step="1"
          style="width:100%;accent-color:var(--accent);cursor:pointer">
      </div>
    `
  }

  html += `<div style="flex:1;overflow-y:auto;padding:8px">`

  for (const [cat, items] of Object.entries(TRANSITION_CATEGORIES)) {
    html += `<div style="font-size:10px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:0.8px;margin:8px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--border)">${cat}</div>`
    html += `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:5px;margin-bottom:4px">`
    for (const tr of items) {
      const isActive = current && current.type === tr.id
      html += `
        <div class="tr-item${isActive ? ' tr-active' : ''}" data-tr="${tr.id}" data-clip="${clipId}"
          style="background:var(--bg-3);border:1.5px solid ${isActive ? 'var(--accent)' : 'var(--border)'};border-radius:6px;padding:8px 6px;cursor:pointer;text-align:center;transition:all 0.12s">
          <div style="font-size:18px;margin-bottom:3px">${tr.icon}</div>
          <div style="font-size:10px;color:${isActive ? 'var(--accent)' : 'var(--text-2)'};font-weight:500">${tr.name}</div>
        </div>
      `
    }
    html += `</div>`
  }

  html += `</div>`

  if (!current) {
    html += `<div style="padding:8px 12px;border-top:1px solid var(--border);flex-shrink:0;font-size:10px;color:var(--text-3);text-align:center">Haz clic en una transición para aplicarla</div>`
  }

  panel.innerHTML = html

  // Events
  panel.querySelectorAll('.tr-item').forEach(el => {
    el.addEventListener('mouseenter', () => {
      if (!el.classList.contains('tr-active')) el.style.background = 'var(--bg-4)'
    })
    el.addEventListener('mouseleave', () => {
      if (!el.classList.contains('tr-active')) el.style.background = 'var(--bg-3)'
    })
    el.addEventListener('click', () => {
      const trType = el.dataset.tr
      const cId = parseInt(el.dataset.clip)
      const dur = transitions[cId] ? transitions[cId].duration : 0.5
      applyTransition(cId, trType, dur)
    })
  })

  const durSlider = panel.querySelector('#tr-duration-sl')
  if (durSlider) {
    durSlider.addEventListener('input', e => {
      const dur = parseInt(e.target.value) / 10
      if (transitions[clipId]) {
        transitions[clipId].duration = dur
        panel.querySelector('span[style*="monospace"]').textContent = dur.toFixed(1) + 's'
      }
    })
  }

  const removeBtn = panel.querySelector('#btn-remove-transition')
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      delete transitions[clipId]
      panelSelectedTransitionClipId = null
      renderTimeline()
      renderTransitionsPanel(clipId)
      setStatus('Transición eliminada')
    })
  }
}

function applyTransition(clipId, type, duration) {
  transitions[clipId] = { type, duration: duration || 0.5 }
  renderTimeline()
  renderTransitionsPanel(clipId)
  setStatus(`Transición "${type}" aplicada ✓`)
}

// ── Animación de transición en el preview ─────────────────────────────────────
function playTransition(type, duration, onDone) {
  if (activeTransitionAnim) {
    clearInterval(activeTransitionAnim)
    activeTransitionAnim = null
    // Reset styles
    vid.style.opacity = '1'
    vid.style.transform = vid.style.transform.replace(/translate[XY]?\([^)]+\)/g, '').trim() || ''
    vid.style.filter = vid.style.filter.replace(/blur\([^)]+\)/g, '').trim() || ''
  }

  const ms = (duration || 0.5) * 1000
  const frames = Math.max(15, Math.round(ms / 16))
  let frame = 0

  activeTransitionAnim = setInterval(() => {
    frame++
    const p = frame / frames  // 0 → 1
    const ease = 1 - Math.pow(1 - p, 3)  // ease-out cubic

    switch (type) {
      case 'fade':
        vid.style.opacity = p.toString()
        break
      case 'fadeblack':
        vid.style.opacity = p < 0.5 ? (p * 2).toString() : '1'
        vid.style.filter = (vid.style.filter || '').replace(/brightness\([^)]+\)/g, '').trim()
        if (p < 0.5) vid.style.filter = `brightness(${p * 2}) ` + (vid.style.filter || '')
        break
      case 'fadewhite':
        vid.style.opacity = p.toString()
        vid.style.filter = (vid.style.filter || '').replace(/brightness\([^)]+\)/g, '').trim()
        vid.style.filter = `brightness(${2 - ease}) ` + (vid.style.filter || '')
        break
      case 'flash':
        vid.style.opacity = p < 0.3 ? '0' : p.toString()
        break
      case 'slideleft': {
        const tx = (1 - ease) * -100
        vid.style.transform = (vid.style.transform || '').replace(/translateX\([^)]+\)/g, '').trim()
        vid.style.transform = `translateX(${tx}%) ` + (vid.style.transform || '')
        vid.style.opacity = p.toString()
        break
      }
      case 'slideright': {
        const tx = (1 - ease) * 100
        vid.style.transform = (vid.style.transform || '').replace(/translateX\([^)]+\)/g, '').trim()
        vid.style.transform = `translateX(${tx}%) ` + (vid.style.transform || '')
        vid.style.opacity = p.toString()
        break
      }
      case 'slideup': {
        const ty = (1 - ease) * -100
        vid.style.transform = (vid.style.transform || '').replace(/translateY\([^)]+\)/g, '').trim()
        vid.style.transform = `translateY(${ty}%) ` + (vid.style.transform || '')
        vid.style.opacity = p.toString()
        break
      }
      case 'slidedown': {
        const ty = (1 - ease) * 100
        vid.style.transform = (vid.style.transform || '').replace(/translateY\([^)]+\)/g, '').trim()
        vid.style.transform = `translateY(${ty}%) ` + (vid.style.transform || '')
        vid.style.opacity = p.toString()
        break
      }
      case 'wipeleft':
      case 'wiperight':
      case 'wipeup':
      case 'wipedown':
        vid.style.opacity = ease.toString()
        break
      case 'zoomin': {
        const sc = 0.7 + ease * 0.3
        vid.style.transform = (vid.style.transform || '').replace(/scale\([^)]+\)/g, '').trim()
        vid.style.transform = `scale(${sc}) ` + (vid.style.transform || '')
        vid.style.opacity = p.toString()
        break
      }
      case 'zoomout': {
        const sc = 1.4 - ease * 0.4
        vid.style.transform = (vid.style.transform || '').replace(/scale\([^)]+\)/g, '').trim()
        vid.style.transform = `scale(${sc}) ` + (vid.style.transform || '')
        vid.style.opacity = p.toString()
        break
      }
      case 'zoomfade':
        vid.style.transform = (vid.style.transform || '').replace(/scale\([^)]+\)/g, '').trim()
        vid.style.transform = `scale(${0.85 + ease * 0.15}) ` + (vid.style.transform || '')
        vid.style.opacity = p.toString()
        break
      case 'blur':
        vid.style.filter = (vid.style.filter || '').replace(/blur\([^)]+\)/g, '').trim()
        vid.style.filter = `blur(${(1 - ease) * 20}px) ` + (vid.style.filter || '')
        vid.style.opacity = p.toString()
        break
      case 'glitch':
        if (frame % 3 === 0) {
          const glitchX = (Math.random() - 0.5) * 20 * (1 - ease)
          vid.style.transform = (vid.style.transform || '').replace(/translateX\([^)]+\)/g, '').trim()
          vid.style.transform = `translateX(${glitchX}px) ` + (vid.style.transform || '')
          vid.style.filter = (vid.style.filter || '').replace(/hue-rotate\([^)]+\)/g, '').trim()
          vid.style.filter = `hue-rotate(${Math.random() * 360 * (1 - ease)}deg) ` + (vid.style.filter || '')
        }
        vid.style.opacity = p.toString()
        break
      case 'pixelize':
        vid.style.opacity = p.toString()
        break
      case 'spin': {
        const deg = (1 - ease) * 180
        vid.style.transform = (vid.style.transform || '').replace(/rotate\([^)]+\)/g, '').trim()
        vid.style.transform = `rotate(${deg}deg) ` + (vid.style.transform || '')
        vid.style.opacity = p.toString()
        break
      }
      case 'dissolve':
        vid.style.opacity = ease.toString()
        break
      case 'radial':
      case 'circlecrop':
        vid.style.opacity = ease.toString()
        break
      default:
        vid.style.opacity = p.toString()
    }

    if (frame >= frames) {
      clearInterval(activeTransitionAnim)
      activeTransitionAnim = null
      // Clean up transition styles
      vid.style.opacity = '1'
      vid.style.transform = (vid.style.transform || '')
        .replace(/translateX\([^)]+\)/g, '')
        .replace(/translateY\([^)]+\)/g, '')
        .replace(/scale\([^)]+\)/g, '')
        .replace(/rotate\([^)]+\)/g, '')
        .trim()
      vid.style.filter = (vid.style.filter || '')
        .replace(/blur\([^)]+\)/g, '')
        .replace(/brightness\([^)]+\)/g, '')
        .replace(/hue-rotate\([^)]+\)/g, '')
        .trim()
      onDone && onDone()
    }
  }, 16)
}


// ── Drag & Drop (con cambio de pista) ────────────────────────────────────────
// Track IDs in order: videoTrack0, videoTrack1, audioTrack0, audioTrack1
const TRACK_IDS = ['tl-video-track', 'tl-video-track-2', 'tl-audio-track', 'tl-audio-track-2']

function getTrackAtY(clientY) {
  for (let i = 0; i < TRACK_IDS.length; i++) {
    const el = document.getElementById(TRACK_IDS[i])
    if (!el) continue
    const r = el.getBoundingClientRect()
    if (clientY >= r.top && clientY <= r.bottom) return i
  }
  return null
}

function clipMouseDown(e, id, type) {
  e.stopPropagation(); e.preventDefault()
  saveState('mover clip')
  selectClip(id)
  const c = clips.find(x => x.id === id)
  if (!c) return
  drag = {
    type,
    clipId: id,
    startX: e.clientX,
    startY: e.clientY,
    origTlStart: c.tlStart,
    origTlDuration: c.tlDuration,
    origStart: c.start,
    origTrack: c.track || 0,
    origAudioTrack: c.audioTrack || 0,
    ghostTrack: c.track || 0
  }
  // Add dragging class
  document.querySelectorAll(`[data-id="${id}"]`).forEach(el => el.classList.add('dragging'))
}

document.addEventListener('mousemove', e => {
  // Marker drag
  if (markerDrag) {
    const scrollEl = document.getElementById('tl-scroll')
    const dx = e.clientX - markerDrag.startX
    const dt = dx / tlZoom
    const newTime = Math.max(0.1, markerDrag.origTime + dt)
    const marker = markers.find(m => m.id === markerDrag.id)
    if (marker) {
      marker.time = newTime
      const el = document.querySelector(`.tl-marker[data-id="${marker.id}"]`)
      if (el) {
        el.style.left = (newTime * tlZoom) + 'px'
        const lbl = el.querySelector('.tl-marker-label')
        if (lbl) lbl.textContent = fmt(newTime)
      }
    }
    return
  }
  if (!drag) return
  const c = clips.find(x => x.id === drag.clipId)
  if (!c) return
  const dx = e.clientX - drag.startX
  const dt = dx / tlZoom
  const minDur = 0.1

  if (drag.type === 'move') {
    c.tlStart = Math.max(0, drag.origTlStart + dt)

    // Detect which track the mouse is hovering
    const hoveredTrack = getTrackAtY(e.clientY)
    if (hoveredTrack !== null) {
      // Highlight hovered track
      TRACK_IDS.forEach((tid, i) => {
        const el = document.getElementById(tid)
        if (el) el.classList.toggle('track-hover', i === hoveredTrack)
      })
      drag.ghostTrack = hoveredTrack
    }
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

document.addEventListener('mouseup', e => {
  if (markerDrag) {
    const marker = markers.find(m => m.id === markerDrag.id)
    if (marker) {
      markers.sort((a, b) => a.time - b.time)
      setStatus(`Marcador movido a ${fmt(marker.time)}`)
    }
    markerDrag = null
    return
  }
  if (!drag) return

  // Clear track highlights
  TRACK_IDS.forEach(tid => {
    const el = document.getElementById(tid)
    if (el) el.classList.remove('track-hover')
  })
  document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'))

  if (drag.type === 'move') {
    const c = clips.find(x => x.id === drag.clipId)
    if (c && drag.ghostTrack !== null) {
      // Map track index to video/audio track numbers
      // 0 = video track 0, 1 = video track 1, 2 = audio track 0, 3 = audio track 1
      if (drag.ghostTrack <= 1) {
        c.track = drag.ghostTrack
        c.audioTrack = drag.ghostTrack  // keep audio in sync
      } else {
        c.audioTrack = drag.ghostTrack - 2
      }
    }
  }

  drag = null
  renderTimeline()
})

function renderClipPositions() {
  const allTracks = ['tl-video-track','tl-video-track-2','tl-audio-track','tl-audio-track-2']
    .map(id => document.getElementById(id)).filter(Boolean)
  clips.forEach(c => {
    const left  = c.tlStart * tlZoom
    const width = Math.max(c.tlDuration * tlZoom, 20)
    allTracks.forEach(track => {
      const el = track.querySelector(`[data-id="${c.id}"]`)
      if (el) { el.style.left = left + 'px'; el.style.width = width + 'px' }
    })
  })
}

function selectClip(id) {
  selectedClip = id
  const c = clips.find(x => x.id === id)
  if (!c) return
  if (!c.props) c.props = defaultClipProps()
  renderTimeline()
  loadMedia(c.path, c.start)
  if (!c.isImage) setupTrimSliders(c.duration)
  loadPropsToUI(c.props, c.duration)
  // Show clip indicator in props panel
  const ind = document.getElementById('clip-indicator')
  const indName = document.getElementById('clip-indicator-name')
  if (ind) { ind.style.display = 'flex'; indName.textContent = c.name }
  setStatus(`Seleccionado: ${c.name}`)
}

function loadPropsToUI(p, duration) {
  // Trim
  const maxDur = duration || 100
  document.getElementById('trim-s').max   = maxDur
  document.getElementById('trim-e').max   = maxDur
  document.getElementById('trim-s').value = p.trimStart || 0
  document.getElementById('trim-e').value = p.trimEnd   || maxDur
  document.getElementById('trim-s-v').textContent = fmt(p.trimStart || 0)
  document.getElementById('trim-e-v').textContent = fmt(p.trimEnd   || maxDur)
  // Speed
  document.getElementById('speed-sl').value = p.speed || 100
  document.getElementById('speed-v').textContent = ((p.speed || 100) / 100).toFixed(2) + '×'
  // Color
  document.getElementById('br-sl').value  = p.brightness  || 0
  document.getElementById('ct-sl').value  = p.contrast    || 0
  document.getElementById('sat-sl').value = p.saturation  || 0
  document.getElementById('br-v').textContent  = p.brightness  || 0
  document.getElementById('ct-v').textContent  = p.contrast    || 0
  document.getElementById('sat-v').textContent = p.saturation  || 0
  // Transform
  document.getElementById('rot-sl').value  = p.rotation || 0
  document.getElementById('zoom-sl').value = p.zoom     || 100
  document.getElementById('rot-v').textContent  = (p.rotation || 0) + '°'
  document.getElementById('zoom-v').textContent = (p.zoom || 100) + '%'
  // Flip buttons
  document.getElementById('flip-h-btn').classList.toggle('on', !!p.flipH)
  document.getElementById('flip-v-btn').classList.toggle('on', !!p.flipV)
  // Filter buttons
  document.querySelectorAll('#filter-btns .filter-btn').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.filter === (p.filter || ''))
  })
  // Apply to preview
  applyVideoStyle()
}

function savePropsFromUI() {
  const c = getSelectedClip()
  if (!c) return
  if (!c.props) c.props = defaultClipProps()
  c.props.trimStart   = parseFloat(document.getElementById('trim-s').value) || 0
  c.props.trimEnd     = parseFloat(document.getElementById('trim-e').value) || 0
  c.props.speed       = parseInt(document.getElementById('speed-sl').value)  || 100
  c.props.brightness  = parseInt(document.getElementById('br-sl').value)     || 0
  c.props.contrast    = parseInt(document.getElementById('ct-sl').value)     || 0
  c.props.saturation  = parseInt(document.getElementById('sat-sl').value)    || 0
  c.props.rotation    = parseInt(document.getElementById('rot-sl').value)    || 0
  c.props.zoom        = parseInt(document.getElementById('zoom-sl').value)   || 100
  c.props.flipH       = !!document.getElementById('flip-h-btn').classList.contains('on')
  c.props.flipV       = !!document.getElementById('flip-v-btn').classList.contains('on')
  c.props.filter      = currentFilter
}

function splitClip() {
  saveState('dividir clip')
  if (!selectedClip) { setStatus('Selecciona un clip en el timeline'); return }
  const idx = clips.findIndex(c => c.id === selectedClip)
  if (idx < 0) return
  const c = clips[idx]

  // Use playhead global time to find split point relative to clip
  const playheadEl = document.getElementById('tl-playhead')
  const playheadLeft = parseFloat(playheadEl.style.left) || 0
  const playheadT = playheadLeft / tlZoom  // global timeline seconds

  // splitAt = how far into the clip the playhead is
  const splitAt = playheadT - c.tlStart
  if (splitAt <= 0.05 || splitAt >= c.tlDuration - 0.05) {
    setStatus('Posiciona el playhead dentro del clip para dividir'); return
  }

  const newId = Date.now()
  const c2 = {
    id: newId,
    path: c.path,
    name: c.name + '_B',
    start: c.start + splitAt,
    duration: c.duration,
    tlStart: c.tlStart + splitAt,
    tlDuration: c.tlDuration - splitAt,
    isImage: c.isImage || false,
    track: c.track || 0,
    audioTrack: c.audioTrack || 0,
    props: JSON.parse(JSON.stringify(c.props || defaultClipProps()))
  }
  c.tlDuration = splitAt
  clips.splice(idx + 1, 0, c2)
  renderTimeline()
  setStatus('Clip dividido ✓')
}

function deleteClip() {
  saveState('eliminar clip')
  if (!selectedClip) { setStatus('Selecciona un clip'); return }
  clips = clips.filter(c => c.id !== selectedClip)
  selectedClip = null
  renderTimeline()
  setStatus('Clip eliminado')
}

function setTLZoom(v, anchorT) {
  const prevZoom = tlZoom
  tlZoom = Math.max(20, Math.min(250, parseInt(v)))
  const slider = document.getElementById('tl-zoom-sl')
  if (slider) slider.value = tlZoom
  renderTimeline()
  updateMarkerPositions()
  // Keep anchor point (e.g. mouse position) stable after zoom
  if (anchorT !== undefined) {
    const scrollEl = document.getElementById('tl-scroll')
    const newX = anchorT * tlZoom
    const visibleWidth = scrollEl.clientWidth
    scrollEl.scrollLeft = Math.max(0, newX - visibleWidth / 2)
  }
}

// ── Playhead drag scrubbing ───────────────────────────────────────────────────
let playheadDragging = false

function seekToTime(t) {
  t = Math.max(0, t)
  updatePlayhead(t)
  const c = clips.find(cl => t >= cl.tlStart && t <= cl.tlStart + cl.tlDuration)
  if (c) {
    selectClip(c.id)
    if (!c.isImage) vid.currentTime = c.start + (t - c.tlStart)
  }
}

function tlSeek(e) {
  if (drag) return
  const scrollEl = document.getElementById('tl-scroll')
  const rect = scrollEl.getBoundingClientRect()
  const x = e.clientX - rect.left + scrollEl.scrollLeft
  seekToTime(x / tlZoom)
}

function getPlayheadTime() {
  const left = parseFloat(document.getElementById('tl-playhead').style.left) || 0
  return left / tlZoom
}

function updatePlayhead(t) {
  document.getElementById('tl-playhead').style.left = (t * tlZoom) + 'px'
}

// ── Reproducción multi-clip ───────────────────────────────────────────────────
function buildPlayQueue() {
  // Build a flat timeline: for each moment in time, pick the clip with highest priority
  // Priority: track 0 (Video 1) > track 1 (Video 2)
  // Strategy: collect all clips sorted by tlStart, then resolve overlaps by track priority.
  // Result: a non-overlapping sequence of clips representing what the viewer sees.
  
  const sorted = [...clips].sort((a, b) => a.tlStart - b.tlStart || (a.track || 0) - (b.track || 0))
  
  // Find all unique time boundaries
  const times = new Set([0])
  sorted.forEach(c => { times.add(c.tlStart); times.add(c.tlStart + c.tlDuration) })
  const boundaries = [...times].sort((a, b) => a - b)
  
  const queue = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    const t = boundaries[i]
    const tEnd = boundaries[i + 1]
    if (tEnd - t < 0.01) continue  // skip tiny gaps
    
    // Find highest priority clip active at time t
    // track 0 = highest priority, then track 1
    const active = sorted.filter(c => c.tlStart <= t && c.tlStart + c.tlDuration > t)
    if (!active.length) continue
    
    // Pick lowest track number (Video 1 over Video 2)
    active.sort((a, b) => (a.track || 0) - (b.track || 0))
    const winner = active[0]
    
    // Create a segment referencing this clip for this time slice
    const segStart = winner.start + (t - winner.tlStart)
    const segDur = tEnd - t
    
    // Merge with previous segment if same clip
    const last = queue[queue.length - 1]
    if (last && last._clipId === winner.id && Math.abs((last.tlStart + last.tlDuration) - t) < 0.02) {
      last.tlDuration += segDur
    } else {
      queue.push({
        ...winner,
        tlStart: t,
        tlDuration: segDur,
        start: segStart,
        _clipId: winner.id
      })
    }
  }
  
  return queue
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
      // Check if there's a transition for this clip
      const tr = transitions[c._clipId || c.id]
      if (tr && index > 0) {
        vid.style.opacity = '0'
        vid.play().catch(err => console.warn('play error:', err))
        playTransition(tr.type, tr.duration)
      } else {
        vid.play().catch(err => console.warn('play error:', err))
      }
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
      // Chequear marcadores de loop
      if (markers.length > 0 && checkMarkersAt(globalT)) return
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
  savePropsFromUI()
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
  savePropsFromUI()
}
function setSpeed(v) { document.getElementById('speed-sl').value = v; updateSpeed(v) }

// ── Color / Transform / Filtros ───────────────────────────────────────────────
function updateAdj() {
  document.getElementById('br-v').textContent  = document.getElementById('br-sl').value
  document.getElementById('ct-v').textContent  = document.getElementById('ct-sl').value
  document.getElementById('sat-v').textContent = document.getElementById('sat-sl').value
  applyVideoStyle()
  savePropsFromUI()
}

function updateTransform() {
  document.getElementById('rot-v').textContent  = document.getElementById('rot-sl').value + '°'
  document.getElementById('zoom-v').textContent = document.getElementById('zoom-sl').value + '%'
  applyVideoStyle()
  savePropsFromUI()
}

function toggleFlip(axis) {
  const hBtn = document.getElementById('flip-h-btn')
  const vBtn = document.getElementById('flip-v-btn')
  if (axis === 'h') { flipH = !flipH; hBtn.classList.toggle('on', flipH) }
  else              { flipV = !flipV; vBtn.classList.toggle('on', flipV) }
  applyVideoStyle()
  savePropsFromUI()
}

function applyVideoStyle() {
  const c = getSelectedClip()
  const p = c ? (c.props || defaultClipProps()) : null
  const brVal  = p ? p.brightness  : parseFloat(document.getElementById('br-sl').value)
  const ctVal  = p ? p.contrast    : parseFloat(document.getElementById('ct-sl').value)
  const satVal = p ? p.saturation  : parseFloat(document.getElementById('sat-sl').value)
  const rotVal = p ? p.rotation    : parseFloat(document.getElementById('rot-sl').value)
  const zoomVal= p ? p.zoom        : parseFloat(document.getElementById('zoom-sl').value)
  const fH     = p ? p.flipH       : flipH
  const fV     = p ? p.flipV       : flipV
  const filt   = p ? p.filter      : currentFilter
  const br  = (brVal  / 100 + 1).toFixed(2)
  const ct  = (ctVal  / 100 + 1).toFixed(2)
  const sat = (satVal / 100 + 1).toFixed(2)
  const zoom = zoomVal / 100
  const filterStr    = `brightness(${br}) contrast(${ct}) saturate(${sat}) ${filt}`
  const transformStr = `rotate(${rotVal}deg) scale(${fH ? -zoom : zoom},${fV ? -zoom : zoom})`
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
  document.querySelectorAll('#filter-btns .filter-btn').forEach(b => b.classList.remove('on'))
  btn.classList.add('on')
  applyVideoStyle()
  savePropsFromUI()
}


// ── Aplicar propiedades a todos los clips ─────────────────────────────────────
function applyToAll() {
  const c = getSelectedClip()
  if (!c || !c.props) { setStatus('Selecciona un clip primero'); return }
  saveState('aplicar a todos')
  const propsCopy = JSON.parse(JSON.stringify(c.props))
  clips.forEach(clip => {
    if (clip.id !== c.id) {
      clip.props = JSON.parse(JSON.stringify(propsCopy))
    }
  })
  setStatus('Propiedades aplicadas a todos los clips ✓')
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
      setStatus('Uniendo clips con transiciones...')
      document.getElementById('export-bar').style.width = '92%'
      document.getElementById('export-pct').textContent = '92%'
      // Pass transitions aligned to ordered clips array
      const exportTransitions = ordered.map(c => transitions[c.id] || null)
      await window.api.concatVideos({ files: tmpFiles, output: outPath, transitions: exportTransitions })
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

// ── Library → Timeline native drag ───────────────────────────────────────────
let libDragGhost = null     // floating ghost element
let libDragIndex = null     // mediaItems index being dragged
let libDragActive = false
let libDragHoverTrack = null  // { el, isVideo, track }

const LIB_TRACKS = [
  { id: 'tl-video-track',   isVideo: true,  track: 0 },
  { id: 'tl-video-track-2', isVideo: true,  track: 1 },
  { id: 'tl-audio-track',   isVideo: false, track: 0 },
  { id: 'tl-audio-track-2', isVideo: false, track: 1 },
]

function startLibraryDrag(e, index) {
  libDragIndex = index
  libDragActive = false
  selectMedia(index)

  const m = mediaItems[index]
  const startX = e.clientX
  const startY = e.clientY

  function onMove(ev) {
    const dx = ev.clientX - startX
    const dy = ev.clientY - startY

    // Start drag only after moving 5px
    if (!libDragActive && Math.sqrt(dx*dx + dy*dy) < 5) return
    if (!libDragActive) {
      libDragActive = true
      // Create ghost
      libDragGhost = document.createElement('div')
      libDragGhost.className = 'lib-drag-ghost'
      libDragGhost.textContent = (m.isImage ? '🖼️ ' : '🎬 ') + m.name
      document.body.appendChild(libDragGhost)
    }

    // Move ghost with cursor
    libDragGhost.style.left = ev.clientX + 14 + 'px'
    libDragGhost.style.top  = ev.clientY - 14 + 'px'

    // Detect which track the cursor is over
    let found = null
    for (const t of LIB_TRACKS) {
      const el = document.getElementById(t.id)
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (ev.clientY >= r.top && ev.clientY <= r.bottom &&
          ev.clientX >= r.left && ev.clientX <= r.right) {
        found = t
        break
      }
    }

    // Update highlights
    LIB_TRACKS.forEach(t => {
      const el = document.getElementById(t.id)
      if (el) el.classList.toggle('track-drop-target', found && found.id === t.id)
    })
    libDragHoverTrack = found
  }

  function onUp(ev) {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)

    // Cleanup ghost
    if (libDragGhost) { libDragGhost.remove(); libDragGhost = null }
    LIB_TRACKS.forEach(t => {
      const el = document.getElementById(t.id)
      if (el) el.classList.remove('track-drop-target')
    })

    if (!libDragActive || !libDragHoverTrack) {
      libDragActive = false
      libDragIndex = null
      libDragHoverTrack = null
      return
    }

    // Drop: add clip at cursor position on the hovered track
    const { isVideo, track } = libDragHoverTrack
    const trackEl = document.getElementById(libDragHoverTrack.id)
    const scrollEl = document.getElementById('tl-scroll')
    const rect = trackEl.getBoundingClientRect()
    const x = ev.clientX - rect.left + scrollEl.scrollLeft
    let tlStart = Math.max(0, x / tlZoom)

    const m = mediaItems[libDragIndex]
    const isImg = m.isImage || false
    const clipDuration = isImg ? 5 : (m.duration || 10)

    // Avoid overlap on same track
    const trackClips = clips.filter(c => isVideo
      ? (c.track || 0) === track
      : (c.audioTrack || 0) === track)
    for (const c of trackClips) {
      if (tlStart < c.tlStart + c.tlDuration && tlStart + clipDuration > c.tlStart) {
        tlStart = c.tlStart + c.tlDuration
      }
    }

    saveState('agregar clip desde librería')
    const props = defaultClipProps()
    props.trimEnd = clipDuration

    clips.push({
      id: Date.now(),
      path: m.path,
      name: m.name,
      start: 0,
      duration: clipDuration,
      tlStart,
      tlDuration: clipDuration,
      isImage: isImg,
      track: isVideo ? track : 0,
      audioTrack: isVideo ? track : track,
      props
    })
    renderTimeline()
    setStatus(`Clip agregado: ${m.name}`)

    libDragActive = false
    libDragIndex = null
    libDragHoverTrack = null
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

document.addEventListener('DOMContentLoaded', () => {

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    const ctrl = e.ctrlKey || e.metaKey
    const tag  = document.activeElement.tagName

    // Don't hijack input fields
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return

    // Undo / Redo
    if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
    if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return }

    const step = e.shiftKey ? 5 : 1  // hold Shift for bigger jumps

    switch (e.key) {
      // Space = play/pause
      case ' ':
        e.preventDefault()
        togglePlay()
        break

      // Arrow Left/Right = move playhead
      case 'ArrowLeft':
        e.preventDefault()
        seekToTime(getPlayheadTime() - (step / tlZoom * 10))
        break
      case 'ArrowRight':
        e.preventDefault()
        seekToTime(getPlayheadTime() + (step / tlZoom * 10))
        break

      // Arrow Up/Down = zoom in/out
      case 'ArrowUp':
        e.preventDefault()
        setTLZoom(tlZoom + 10 * step, getPlayheadTime())
        break
      case 'ArrowDown':
        e.preventDefault()
        setTLZoom(tlZoom - 10 * step, getPlayheadTime())
        break

      // J K L = classic video editor shortcuts
      case 'j': seekToTime(getPlayheadTime() - 1); break  // back 1s
      case 'l': seekToTime(getPlayheadTime() + 1); break  // fwd 1s
      case 'k': vid.paused ? vid.play() : vid.pause(); break

      // Delete = remove selected clip
      case 'Delete':
      case 'Backspace':
        if (selectedClip) { e.preventDefault(); deleteClip() }
        break
    }
  })

  // ── Mouse wheel zoom on timeline ─────────────────────────────────────────────
  document.getElementById('tl-scroll').addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      // Zoom centered on mouse position
      const rect = document.getElementById('tl-scroll').getBoundingClientRect()
      const mouseX = e.clientX - rect.left + document.getElementById('tl-scroll').scrollLeft
      const anchorT = mouseX / tlZoom
      const delta = e.deltaY < 0 ? 15 : -15
      setTLZoom(tlZoom + delta, anchorT)
    } else if (e.shiftKey) {
      // Shift+scroll = horizontal scroll (already default on many systems)
      document.getElementById('tl-scroll').scrollLeft += e.deltaY
      e.preventDefault()
    }
  }, { passive: false })

  // ── Playhead drag on ruler ────────────────────────────────────────────────────
  const ruler = document.getElementById('tl-ruler')
  ruler.style.cursor = 'col-resize'

  ruler.addEventListener('mousedown', e => {
    playheadDragging = true
    tlSeek(e)
    e.stopPropagation()
  })

  document.addEventListener('mousemove', e => {
    if (!playheadDragging) return
    tlSeek(e)
  })

  document.addEventListener('mouseup', e => {
    playheadDragging = false
  })

  // Undo / Redo buttons
  const btnUndo = document.getElementById('btn-undo')
  const btnRedo = document.getElementById('btn-redo')
  if (btnUndo) btnUndo.addEventListener('click', undo)
  if (btnRedo) btnRedo.addEventListener('click', redo)
  updateUndoButtons()
  document.getElementById('btn-apply-all').addEventListener('click', applyToAll)


  // ── Left rail tab switching ───────────────────────────────────────────────
  document.querySelectorAll('.rail-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rail-btn').forEach(b => b.classList.remove('active'))
      document.querySelectorAll('.lpanel').forEach(p => p.style.display = 'none')
      btn.classList.add('active')
      const panel = document.getElementById('lpanel-' + btn.dataset.panel)
      if (panel) panel.style.display = 'flex'
      // If opening transitions panel without a clip selected, show hint
      if (btn.dataset.panel === 'transitions' && !panelSelectedTransitionClipId) {
        // panel already shows hint by default
      }
    })
  })

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
  // Scrub playhead by dragging on the scroll area (not on clips)
  document.getElementById('tl-scroll').addEventListener('mousedown', e => {
    if (e.target.id === 'tl-scroll' || e.target.id === 'tl-inner' || e.target.id === 'tl-ruler') {
      playheadDragging = true
      tlSeek(e)
    }
  })
  document.getElementById('btn-split-tl').addEventListener('click', splitClip)
  document.getElementById('btn-delete-tl').addEventListener('click', deleteClip)

  // Marcadores
  document.getElementById('btn-add-marker').addEventListener('click', () => {
    addMarkerAtPlayhead()
    document.getElementById('btn-clear-markers').style.display = markers.length > 0 ? '' : 'none'
  })
  document.getElementById('btn-clear-markers').addEventListener('click', () => {
    clearAllMarkers()
    document.getElementById('btn-clear-markers').style.display = 'none'
  })

  // Clic derecho en el ruler → agregar marcador en esa posición
  document.getElementById('tl-ruler').addEventListener('contextmenu', e => {
    e.preventDefault()
    const scrollEl = document.getElementById('tl-scroll')
    const rect = document.getElementById('tl-ruler').getBoundingClientRect()
    const x = e.clientX - rect.left + scrollEl.scrollLeft
    const t = Math.max(0.1, x / tlZoom)
    const nearby = markers.find(m => Math.abs(m.time - t) < 0.2)
    if (nearby) {
      removeMarker(nearby.id)
      document.getElementById('btn-clear-markers').style.display = markers.length > 0 ? '' : 'none'
    } else {
      markers.push({ id: Date.now(), time: t })
      markers.sort((a, b) => a.time - b.time)
      renderMarkers()
      document.getElementById('btn-clear-markers').style.display = ''
      setStatus(`Marcador agregado en ${fmt(t)} (clic derecho para quitar)`)
    }
  })
})