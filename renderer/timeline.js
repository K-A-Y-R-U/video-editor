// ── Timeline ──────────────────────────────────────────────────────────────────
// Renderizado del timeline, clips, drag & drop, playhead, zoom y operaciones
// de edición (agregar, dividir, eliminar, seleccionar).

import * as S from './state.js'
import { fmt, clamp, defaultClipProps, isImagePath, setStatus } from './utils.js'
import { saveState } from './history.js'
import { renderMarkers, updateMarkerPositions } from './markers.js'
import { openTransitionPanel } from './transitions.js'
import { loadMedia, renderMediaPanel, updateTimeDisplay, setupTrimSliders } from './media.js'
import { loadPropsToUI, applyVideoStyle } from './effects.js'

// ── Estilos de arrastre (inyectados una sola vez) ─────────────────────────────
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

// ── Constantes de pistas ──────────────────────────────────────────────────────
const TRACK_IDS = ['tl-video-track', 'tl-video-track-2', 'tl-audio-track', 'tl-audio-track-2']

const LIB_TRACKS = [
  { id: 'tl-video-track',   isVideo: true,  track: 0 },
  { id: 'tl-video-track-2', isVideo: true,  track: 1 },
  { id: 'tl-audio-track',   isVideo: false, track: 0 },
  { id: 'tl-audio-track-2', isVideo: false, track: 1 },
]

// ── Agregar clip al timeline ──────────────────────────────────────────────────

export function addToTimeline() {
  saveState('agregar clip')
  if (S.selectedMediaIndex < 0) { setStatus('Selecciona un clip primero'); return }
  const m  = S.mediaItems[S.selectedMediaIndex]
  const id = Date.now()

  const tlStart      = S.clips.reduce((acc, c) => Math.max(acc, c.tlStart + c.tlDuration), 0)
  const isImg        = m.isImage || false
  const clipDuration = isImg ? 5 : (m.duration || 10)
  const props        = defaultClipProps()
  props.trimEnd      = clipDuration

  S.clips.push({
    id, path: m.path, name: m.name,
    start: 0, duration: isImg ? 5 : (m.duration || 10),
    tlStart, tlDuration: clipDuration,
    isImage: isImg, track: 0, audioTrack: 0, props
  })
  renderTimeline()
  setStatus(`Clip agregado: ${m.name}`)
}

// ── Constructores de elementos de clip ────────────────────────────────────────

function makeVideoClipEl(c) {
  const left  = c.tlStart * S.tlZoom
  const width = Math.max(c.tlDuration * S.tlZoom, 20)
  const sel   = S.selectedClip === c.id ? 'selected' : ''
  const icon  = c.isImage ? '🖼' : '🎬'

  const div = document.createElement('div')
  div.className      = `tl-clip video ${sel}`
  div.style.cssText  = `left:${left}px;width:${width}px`
  div.dataset.id     = c.id

  const lh = document.createElement('div')
  lh.className = 'tl-resize-handle left'
  lh.addEventListener('mousedown', e => clipMouseDown(e, c.id, 'resize-left'))

  const label = document.createElement('span')
  label.className   = 'tl-clip-label'
  label.textContent = icon + ' ' + c.name

  const rh = document.createElement('div')
  rh.className = 'tl-resize-handle right'
  rh.addEventListener('mousedown', e => clipMouseDown(e, c.id, 'resize-right'))

  div.appendChild(lh)
  div.appendChild(label)
  div.appendChild(rh)
  div.addEventListener('mousedown', e => {
    if (!e.target.classList.contains('tl-resize-handle')) clipMouseDown(e, c.id, 'move')
  })
  return div
}

function makeAudioClipEl(c) {
  const left  = c.tlStart * S.tlZoom
  const width = Math.max(c.tlDuration * S.tlZoom, 20)
  const sel   = S.selectedClip === c.id ? 'selected' : ''

  const div = document.createElement('div')
  div.className     = `tl-clip audio ${sel}`
  div.style.cssText = `left:${left}px;width:${width}px`
  div.dataset.id    = c.id
  div.addEventListener('mousedown', e => clipMouseDown(e, c.id, 'move'))
  return div
}

// ── Renderizar timeline ───────────────────────────────────────────────────────

export function renderTimeline() {
  const totalDur = S.clips.reduce((a, c) => Math.max(a, c.tlStart + c.tlDuration), 10)
  const scrollEl = document.getElementById('tl-scroll')
  const w        = Math.max(totalDur * S.tlZoom + 200, (scrollEl.clientWidth || 600))

  // Regla de tiempo
  const ruler = document.getElementById('tl-ruler')
  ruler.style.width = w + 'px'
  const step  = S.tlZoom >= 60 ? 1 : S.tlZoom >= 30 ? 2 : 5
  let rHtml   = ''
  for (let t = 0; t <= totalDur + step; t += step) {
    const x = t * S.tlZoom
    rHtml += `<div class="tl-tick" style="left:${x}px"></div>
              <div class="tl-tick-label" style="left:${x}px">${fmt(t)}</div>`
  }
  ruler.innerHTML = rHtml

  // Pistas
  const vt  = document.getElementById('tl-video-track')
  const at  = document.getElementById('tl-audio-track')
  const vt2 = document.getElementById('tl-video-track-2')
  const at2 = document.getElementById('tl-audio-track-2')
  vt.style.width = w + 'px'
  at.style.width = w + 'px'
  document.getElementById('tl-inner').style.width = w + 'px'

  vt.innerHTML = ''; if (vt2) vt2.innerHTML = ''
  at.innerHTML = ''; if (at2) at2.innerHTML = ''

  const track0Clips = S.clips
    .filter(c => (c.track || 0) === 0)
    .sort((a, b) => a.tlStart - b.tlStart)

  S.clips.forEach(c => {
    const trackIdx      = c.track      || 0
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

  // Botones de transición entre clips adyacentes
  for (let i = 1; i < track0Clips.length; i++) {
    const prev = track0Clips[i - 1]
    const curr = track0Clips[i]
    const gap  = curr.tlStart - (prev.tlStart + prev.tlDuration)
    if (Math.abs(gap) < 0.5) {
      const junctionX = curr.tlStart * S.tlZoom
      const btn       = document.createElement('div')
      btn.className   = 'tl-transition-btn' + (S.transitions[curr.id] ? ' has-transition' : '')
      btn.style.left  = (junctionX - 11) + 'px'
      btn.title       = S.transitions[curr.id] ? `Transición: ${S.transitions[curr.id].type}` : 'Agregar transición'
      btn.dataset.clipId = curr.id
      btn.innerHTML   = S.transitions[curr.id] ? '⇄' : '+'
      btn.addEventListener('click', e => { e.stopPropagation(); openTransitionPanel(curr.id) })
      vt.appendChild(btn)
    }
  }

  document.getElementById('tl-info').textContent =
    S.clips.length ? `${S.clips.length} clip(s) · ${fmt(totalDur)}` : 'Sin clips'

  renderMarkers()
}

// ── Seleccionar clip ──────────────────────────────────────────────────────────

export function selectClip(id) {
  S.setSelectedClip(id)
  const c = S.clips.find(x => x.id === id)
  if (!c) return
  if (!c.props) c.props = defaultClipProps()
  renderTimeline()
  loadMedia(c.path, c.start)
  if (!c.isImage) setupTrimSliders(c.duration)
  loadPropsToUI(c.props, c.duration)

  const ind     = document.getElementById('clip-indicator')
  const indName = document.getElementById('clip-indicator-name')
  if (ind) { ind.style.display = 'flex'; indName.textContent = c.name }
  setStatus(`Seleccionado: ${c.name}`)
}

// ── Operaciones de edición ────────────────────────────────────────────────────

export function splitClip() {
  saveState('dividir clip')
  if (!S.selectedClip) { setStatus('Selecciona un clip en el timeline'); return }
  const idx = S.clips.findIndex(c => c.id === S.selectedClip)
  if (idx < 0) return
  const c = S.clips[idx]

  const playheadLeft = parseFloat(document.getElementById('tl-playhead').style.left) || 0
  const playheadT    = playheadLeft / S.tlZoom
  const splitAt      = playheadT - c.tlStart

  if (splitAt <= 0.05 || splitAt >= c.tlDuration - 0.05) {
    setStatus('Posiciona el playhead dentro del clip para dividir')
    return
  }

  const newId = Date.now()
  const c2    = {
    id: newId, path: c.path, name: c.name + '_B',
    start: c.start + splitAt, duration: c.duration,
    tlStart: c.tlStart + splitAt, tlDuration: c.tlDuration - splitAt,
    isImage: c.isImage || false, track: c.track || 0, audioTrack: c.audioTrack || 0,
    props: JSON.parse(JSON.stringify(c.props || defaultClipProps()))
  }
  c.tlDuration = splitAt
  S.clips.splice(idx + 1, 0, c2)
  renderTimeline()
  setStatus('Clip dividido ✓')
}

export function deleteClip() {
  saveState('eliminar clip')
  if (!S.selectedClip) { setStatus('Selecciona un clip'); return }
  S.setClips(S.clips.filter(c => c.id !== S.selectedClip))
  S.setSelectedClip(null)
  renderTimeline()
  setStatus('Clip eliminado')
}

// ── Zoom del timeline ─────────────────────────────────────────────────────────

export function setTLZoom(v, anchorT) {
  S.setTlZoom(Math.max(20, Math.min(250, parseInt(v))))
  const slider = document.getElementById('tl-zoom-sl')
  if (slider) slider.value = S.tlZoom
  renderTimeline()
  updateMarkerPositions()
  if (anchorT !== undefined) {
    const scrollEl      = document.getElementById('tl-scroll')
    const newX          = anchorT * S.tlZoom
    const visibleWidth  = scrollEl.clientWidth
    scrollEl.scrollLeft = Math.max(0, newX - visibleWidth / 2)
  }
}

// ── Playhead ──────────────────────────────────────────────────────────────────

let playheadDragging = false

export function seekToTime(t) {
  t = Math.max(0, t)
  updatePlayhead(t)
  const c = S.clips.find(cl => t >= cl.tlStart && t <= cl.tlStart + cl.tlDuration)
  if (c) {
    selectClip(c.id)
    if (!c.isImage) S.vid.currentTime = c.start + (t - c.tlStart)
  }
}

export function tlSeek(e) {
  if (S.drag) return
  const scrollEl = document.getElementById('tl-scroll')
  const rect     = scrollEl.getBoundingClientRect()
  const x        = e.clientX - rect.left + scrollEl.scrollLeft
  seekToTime(x / S.tlZoom)
}

export function getPlayheadTime() {
  const left = parseFloat(document.getElementById('tl-playhead').style.left) || 0
  return left / S.tlZoom
}

export function updatePlayhead(t) {
  document.getElementById('tl-playhead').style.left = (t * S.tlZoom) + 'px'
}

export function setPlayheadDragging(v) { playheadDragging = v }
export function isPlayheadDragging()   { return playheadDragging }

// ── Drag & drop de clips ──────────────────────────────────────────────────────

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
  const c = S.clips.find(x => x.id === id)
  if (!c) return
  S.setDrag({
    type, clipId: id,
    startX: e.clientX, startY: e.clientY,
    origTlStart: c.tlStart, origTlDuration: c.tlDuration,
    origStart: c.start, origTrack: c.track || 0,
    origAudioTrack: c.audioTrack || 0, ghostTrack: c.track || 0
  })
  document.querySelectorAll(`[data-id="${id}"]`).forEach(el => el.classList.add('dragging'))
}

document.addEventListener('mousemove', e => {
  // Drag de marcadores
  if (S.markerDrag) {
    const dx      = e.clientX - S.markerDrag.startX
    const dt      = dx / S.tlZoom
    const newTime = Math.max(0.1, S.markerDrag.origTime + dt)
    const marker  = S.markers.find(m => m.id === S.markerDrag.id)
    if (marker) {
      marker.time    = newTime
      const el       = document.querySelector(`.tl-marker[data-id="${marker.id}"]`)
      if (el) {
        el.style.left  = (newTime * S.tlZoom) + 'px'
        const lbl      = el.querySelector('.tl-marker-label')
        if (lbl) lbl.textContent = fmt(newTime)
      }
    }
    return
  }

  if (!S.drag) return
  const c  = S.clips.find(x => x.id === S.drag.clipId)
  if (!c) return
  const dx     = e.clientX - S.drag.startX
  const dt     = dx / S.tlZoom
  const minDur = 0.1

  if (S.drag.type === 'move') {
    c.tlStart = Math.max(0, S.drag.origTlStart + dt)
    const hoveredTrack = getTrackAtY(e.clientY)
    if (hoveredTrack !== null) {
      TRACK_IDS.forEach((tid, i) => {
        const el = document.getElementById(tid)
        if (el) el.classList.toggle('track-hover', i === hoveredTrack)
      })
      S.drag.ghostTrack = hoveredTrack
    }
  } else if (S.drag.type === 'resize-right') {
    c.tlDuration = clamp(S.drag.origTlDuration + dt, minDur, c.duration - c.start)
  } else if (S.drag.type === 'resize-left') {
    const maxShift = S.drag.origTlDuration - minDur
    const shift    = clamp(dt, -S.drag.origStart, maxShift)
    c.tlStart      = Math.max(0, S.drag.origTlStart + shift)
    c.tlDuration   = S.drag.origTlDuration - shift
    c.start        = S.drag.origStart + shift
  }
  renderClipPositions()
})

document.addEventListener('mouseup', e => {
  if (S.markerDrag) {
    const marker = S.markers.find(m => m.id === S.markerDrag.id)
    if (marker) {
      S.markers.sort((a, b) => a.time - b.time)
      setStatus(`Marcador movido a ${fmt(marker.time)}`)
    }
    S.setMarkerDrag(null)
    return
  }
  if (!S.drag) return

  TRACK_IDS.forEach(tid => {
    const el = document.getElementById(tid)
    if (el) el.classList.remove('track-hover')
  })
  document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'))

  if (S.drag.type === 'move') {
    const c = S.clips.find(x => x.id === S.drag.clipId)
    if (c && S.drag.ghostTrack !== null) {
      if (S.drag.ghostTrack <= 1) {
        c.track      = S.drag.ghostTrack
        c.audioTrack = S.drag.ghostTrack
      } else {
        c.audioTrack = S.drag.ghostTrack - 2
      }
    }
  }

  S.setDrag(null)
  renderTimeline()
})

function renderClipPositions() {
  const allTracks = TRACK_IDS.map(id => document.getElementById(id)).filter(Boolean)
  S.clips.forEach(c => {
    const left  = c.tlStart * S.tlZoom
    const width = Math.max(c.tlDuration * S.tlZoom, 20)
    allTracks.forEach(track => {
      const el = track.querySelector(`[data-id="${c.id}"]`)
      if (el) { el.style.left = left + 'px'; el.style.width = width + 'px' }
    })
  })
}

// ── Drag desde la librería al timeline ────────────────────────────────────────

export function startLibraryDrag(e, index) {
  S.setSelectedMediaIndex(index)
  import('./media.js').then(M => M.selectMedia(index))

  let libDragGhost      = null
  let libDragActive     = false
  let libDragHoverTrack = null
  const m      = S.mediaItems[index]
  const startX = e.clientX
  const startY = e.clientY

  function onMove(ev) {
    const dx = ev.clientX - startX
    const dy = ev.clientY - startY
    if (!libDragActive && Math.sqrt(dx * dx + dy * dy) < 5) return

    if (!libDragActive) {
      libDragActive  = true
      libDragGhost   = document.createElement('div')
      libDragGhost.className   = 'lib-drag-ghost'
      libDragGhost.textContent = (m.isImage ? '🖼️ ' : '🎬 ') + m.name
      document.body.appendChild(libDragGhost)
    }

    libDragGhost.style.left = ev.clientX + 14 + 'px'
    libDragGhost.style.top  = ev.clientY - 14 + 'px'

    let found = null
    for (const t of LIB_TRACKS) {
      const el = document.getElementById(t.id)
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (ev.clientY >= r.top && ev.clientY <= r.bottom &&
          ev.clientX >= r.left && ev.clientX <= r.right) { found = t; break }
    }

    LIB_TRACKS.forEach(t => {
      const el = document.getElementById(t.id)
      if (el) el.classList.toggle('track-drop-target', found && found.id === t.id)
    })
    libDragHoverTrack = found
  }

  function onUp(ev) {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)

    if (libDragGhost) { libDragGhost.remove(); libDragGhost = null }
    LIB_TRACKS.forEach(t => {
      const el = document.getElementById(t.id)
      if (el) el.classList.remove('track-drop-target')
    })

    if (!libDragActive || !libDragHoverTrack) return

    const { isVideo, track } = libDragHoverTrack
    const trackEl  = document.getElementById(libDragHoverTrack.id)
    const scrollEl = document.getElementById('tl-scroll')
    const rect     = trackEl.getBoundingClientRect()
    const x        = ev.clientX - rect.left + scrollEl.scrollLeft
    let tlStart    = Math.max(0, x / S.tlZoom)

    const isImg        = m.isImage || false
    const clipDuration = isImg ? 5 : (m.duration || 10)

    const trackClips = S.clips.filter(c => isVideo
      ? (c.track      || 0) === track
      : (c.audioTrack || 0) === track)
    for (const c of trackClips) {
      if (tlStart < c.tlStart + c.tlDuration && tlStart + clipDuration > c.tlStart)
        tlStart = c.tlStart + c.tlDuration
    }

    saveState('agregar clip desde librería')
    const props   = defaultClipProps()
    props.trimEnd = clipDuration

    S.clips.push({
      id: Date.now(), path: m.path, name: m.name,
      start: 0, duration: clipDuration,
      tlStart, tlDuration: clipDuration,
      isImage: isImg,
      track:      isVideo ? track : 0,
      audioTrack: isVideo ? track : track,
      props
    })
    renderTimeline()
    setStatus(`Clip agregado: ${m.name}`)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
