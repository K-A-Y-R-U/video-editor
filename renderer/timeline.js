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
import { initDefaultTracks, renderTracks, getTrackIdAtY } from './tracks.js'
import { renderTextTimeline } from './text-clips.js'

const TRACK_IDS_COMPAT = ['tl-video-track', 'tl-video-track-2', 'tl-audio-track', 'tl-audio-track-2']

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

// ── Inicializar sistema de pistas ─────────────────────────────────────────────
export function initTracks() {
  initDefaultTracks()
  renderTracks()
}

// Helper: primer trackId de tipo 'video'
function firstVideoTrackId() {
  return S.tracks.find(t => t.type === 'video')?.id || 'track-v1'
}
// Helper: primer trackId de tipo 'audio'
function firstAudioTrackId() {
  return S.tracks.find(t => t.type === 'audio')?.id || 'track-a1'
}

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
    isImage: isImg,
    trackId:      firstVideoTrackId(),
    audioTrackId: firstAudioTrackId(),
    // compatibilidad legacy
    track: 0, audioTrack: 0, audioLinked: true, props
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
  // Indicador visual de desvinculación
  const linkIcon = c.audioNoTrack ? ' 🔇' : (c.audioLinked === false) ? ' 🔓' : ''

  const div = document.createElement('div')
  div.className      = `tl-clip video ${sel}`
  div.style.cssText  = `left:${left}px;width:${width}px`
  div.dataset.id     = c.id

  const lh = document.createElement('div')
  lh.className = 'tl-resize-handle left'
  lh.addEventListener('mousedown', e => clipMouseDown(e, c.id, 'resize-left'))

  const label = document.createElement('span')
  label.className   = 'tl-clip-label'
  label.textContent = icon + ' ' + c.name + linkIcon

  const rh = document.createElement('div')
  rh.className = 'tl-resize-handle right'
  rh.addEventListener('mousedown', e => clipMouseDown(e, c.id, 'resize-right'))

  div.appendChild(lh)
  div.appendChild(label)
  div.appendChild(rh)
  div.addEventListener('mousedown', e => {
    if (!e.target.classList.contains('tl-resize-handle')) clipMouseDown(e, c.id, 'move')
  })
  div.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); showClipContextMenu(e.clientX, e.clientY, c.id) })
  return div
}

function makeAudioClipEl(c) {
  const unlinked = c.audioLinked === false
  // Posición y tamaño independientes si está desvinculado
  const audioStart = (unlinked && c.audioTlStart    !== undefined) ? c.audioTlStart    : c.tlStart
  const audioDur   = (unlinked && c.audioTlDuration !== undefined) ? c.audioTlDuration : c.tlDuration
  const left  = audioStart * S.tlZoom
  const width = Math.max(audioDur * S.tlZoom, 20)

  // Selección independiente: si está desvinculado, solo se resalta si selectedAudioClip === c.id
  // Si está vinculado, sigue selectedClip normal
  const sel = unlinked
    ? (S.selectedAudioClip === c.id ? 'selected' : '')
    : (S.selectedClip === c.id ? 'selected' : '')

  const div = document.createElement('div')
  div.className     = `tl-clip audio ${sel}`
  div.style.cssText = `left:${left}px;width:${width}px`
  div.dataset.id    = c.id
  div.dataset.audioid = c.id   // identificador para queries de audio
  div.dataset.isAudio = 'true'

  if (unlinked) {
    // Audio desvinculado: clic selecciona SOLO el audio, no el video
    div.addEventListener('mousedown', e => audioClipMouseDown(e, c.id))
  } else {
    div.addEventListener('mousedown', e => clipMouseDown(e, c.id, 'move'))
  }
  div.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); showClipContextMenu(e.clientX, e.clientY, c.id, true) })
  return div
}

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

  // Pistas dinámicas — renderizar clips en cada pista
  const innerEl = document.getElementById('tl-inner')
  if (!innerEl) return

  innerEl.style.width = w + 'px'
  innerEl.querySelectorAll('.tl-track').forEach(el => {
    el.style.width = w + 'px'
    el.innerHTML = ''
  })

  // Agrupar clips por pista
  S.clips.forEach(c => {
    const vTrackId = c.trackId || firstVideoTrackId()
    const aTrackId = c.audioTrackId || firstAudioTrackId()

    const vTrackEl = document.getElementById(`track-${vTrackId}`)
    if (vTrackEl) vTrackEl.appendChild(makeVideoClipEl(c))

    if (!c.isImage && !c.audioNoTrack) {
      const aTrackEl = document.getElementById(`track-${aTrackId}`)
      if (aTrackEl) aTrackEl.appendChild(makeAudioClipEl(c))
    }
  })

  // Pista de texto
  const textTrack = document.querySelector('.tl-track[data-track-type="text"]')
  if (textTrack) {
    textTrack.style.width = w + 'px'
    textTrack.innerHTML = ''
    renderTextTimeline()
  }

  // Botones de transición entre clips adyacentes en pista principal
  const mainVideoTrackId = firstVideoTrackId()
  const mainTrackEl = document.getElementById(`track-${mainVideoTrackId}`)
  const track0Clips = S.clips
    .filter(c => (c.trackId || firstVideoTrackId()) === mainVideoTrackId)
    .sort((a, b) => a.tlStart - b.tlStart)

  for (let i = 1; i < track0Clips.length; i++) {
    const prev = track0Clips[i - 1]
    const curr = track0Clips[i]
    const gap  = curr.tlStart - (prev.tlStart + prev.tlDuration)
    if (Math.abs(gap) < 0.5 && mainTrackEl) {
      const junctionX = curr.tlStart * S.tlZoom
      const btn       = document.createElement('div')
      btn.className   = 'tl-transition-btn' + (S.transitions[curr.id] ? ' has-transition' : '')
      btn.style.left  = (junctionX - 11) + 'px'
      btn.title       = S.transitions[curr.id] ? `Transición: ${S.transitions[curr.id].type}` : 'Agregar transición'
      btn.dataset.clipId = curr.id
      btn.innerHTML   = S.transitions[curr.id] ? '⇄' : '+'
      btn.addEventListener('click', e => { e.stopPropagation(); openTransitionPanel(curr.id) })
      mainTrackEl.appendChild(btn)
    }
  }

  document.getElementById('tl-info').textContent =
    S.clips.length ? `${S.clips.length} clip(s) · ${fmt(totalDur)}` : 'Sin clips'

  renderMarkers()
}

// ── Seleccionar clip ──────────────────────────────────────────────────────────

export function selectClip(id) {
  S.setSelectedClip(id)
  S.setSelectedAudioClip(null)   // limpiar selección de audio independiente
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

  // Mostrar badge de transición en el preview si este clip tiene una asignada
  updateTransitionBadge(c.id)

  setStatus(`Seleccionado: ${c.name}`)
}

/** Muestra/oculta el badge de transición en la esquina del preview */
export function updateTransitionBadge(clipId) {
  let badge = document.getElementById('preview-transition-badge')

  const tr = clipId ? S.transitions[clipId] : null

  if (!tr) {
    if (badge) badge.style.display = 'none'
    return
  }

  // Crear el badge si no existe
  if (!badge) {
    badge = document.createElement('div')
    badge.id = 'preview-transition-badge'
    badge.style.cssText = [
      'position:absolute', 'top:8px', 'left:8px', 'z-index:20',
      'background:rgba(0,0,0,0.72)', 'border:1.5px solid var(--accent,#f7a84f)',
      'color:var(--accent,#f7a84f)', 'font-size:11px', 'font-weight:600',
      'padding:3px 9px', 'border-radius:20px', 'pointer-events:none',
      'display:flex', 'align-items:center', 'gap:5px', 'letter-spacing:0.3px'
    ].join(';')
    // Buscar el contenedor del preview
    const container = S.vid.parentNode
    if (container) container.appendChild(badge)
  }

  badge.innerHTML = `<span style="font-size:13px">⇄</span> ${tr.type} <span style="opacity:0.7;font-weight:400">${tr.duration.toFixed(1)}s</span>`
  badge.style.display = 'flex'
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
  const fileDuration  = c.duration + c.start   // duración total real del archivo (invariante)
  const c2StartInFile = c.start + splitAt       // offset en el archivo donde empieza clip B
  const audioWasUnlinked = c.audioLinked === false

  const c2 = {
    id: newId, path: c.path, name: c.name + '_B',
    start: c2StartInFile,
    duration: fileDuration,           // misma duración total del archivo — el resize lo limita con duration - start
    tlStart: c.tlStart + splitAt,
    tlDuration: c.tlDuration - splitAt,
    isImage: c.isImage || false,
    track: c.track || 0,
    audioTrack: c.audioTrack || 0,
    audioLinked: audioWasUnlinked ? false : true,
    audioNoTrack: audioWasUnlinked,
    props: JSON.parse(JSON.stringify(c.props || defaultClipProps()))
  }

  // Clip A: duration sigue siendo fileDuration (puede expandirse hasta el fin del archivo)
  // Solo reducimos tlDuration (lo que ocupa en el timeline)
  c.duration   = fileDuration   // NO cambiar — el archivo tiene la misma duración total
  c.tlDuration = splitAt

  S.clips.splice(idx + 1, 0, c2)
  renderTimeline()
  setStatus(audioWasUnlinked ? 'Video dividido ✓ (audio desvinculado no se dividió)' : 'Clip dividido ✓')
}

export function deleteClip() {
  saveState('eliminar')

  // Caso 1: hay un audio desvinculado seleccionado independientemente → eliminar solo el audio del clip
  if (S.selectedAudioClip && !S.selectedClip) {
    const c = S.clips.find(x => x.id === S.selectedAudioClip)
    if (c) {
      c.audioNoTrack    = true     // ocultar bloque de audio en el timeline
      c.audioLinked     = false
      c.audioTlStart    = undefined
      c.audioTlDuration = undefined
    }
    S.setSelectedAudioClip(null)
    renderTimeline()
    setStatus('Audio eliminado del timeline')
    return
  }

  // Caso 2: hay un clip de video seleccionado → eliminar el clip completo (video + audio)
  if (S.selectedClip) {
    S.setClips(S.clips.filter(c => c.id !== S.selectedClip))
    S.setSelectedClip(null)
    S.setSelectedAudioClip(null)
    renderTimeline()
    setStatus('Clip eliminado')
    return
  }

  setStatus('Selecciona un clip o pista de audio primero')
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

// ── Menú contextual de clips en el timeline ───────────────────────────────────

function removeClipCtxMenu() {
  document.getElementById('clip-ctx-menu')?.remove()
}

function showClipContextMenu(x, y, clipId, fromAudio = false) {
  removeClipCtxMenu()
  const c = S.clips.find(cl => cl.id === clipId)
  if (!c) return

  const unlinked = c.audioLinked === false

  if (fromAudio && unlinked) {
    // Clic derecho en audio desvinculado → seleccionar solo audio
    S.setSelectedAudioClip(clipId)
    S.setSelectedClip(null)
    renderTimeline()
  } else {
    selectClip(clipId)
  }

  const linked = c.audioLinked !== false
  const isImg  = c.isImage

  const menu = document.createElement('div')
  menu.id = 'clip-ctx-menu'
  menu.style.cssText = [
    'position:fixed', `left:${x}px`, `top:${y}px`,
    'background:#1e1e1e', 'border:1px solid #3a3a3a', 'border-radius:8px',
    'padding:4px 0', 'min-width:210px', 'z-index:9999',
    'box-shadow:0 4px 24px rgba(0,0,0,0.75)', 'font-size:13px'
  ].join(';')

  const items = [
    ...(isImg ? [] : [
      {
        icon: linked ? '🔓' : '🔗',
        label: linked ? 'Desvincular audio' : 'Vincular audio',
        action: () => {
          saveState('vincular/desvincular audio')
          c.audioLinked = !linked
          if (!c.audioLinked) {
            if (c.audioTlStart    === undefined) c.audioTlStart    = c.tlStart
            if (c.audioTlDuration === undefined) c.audioTlDuration = c.tlDuration
          } else {
            c.audioTlStart    = c.tlStart
            c.audioTlDuration = c.tlDuration
          }
          renderTimeline()
          setStatus(c.audioLinked ? `Audio vinculado: ${c.name}` : `Audio desvinculado: ${c.name} — arrastra el bloque verde independientemente`)
        }
      },
      // Opción rápida para silenciar/restaurar audio sin necesidad de desvincular
      {
        icon: c.audioNoTrack ? '🔊' : '🔇',
        label: c.audioNoTrack ? 'Restaurar audio' : 'Eliminar solo audio',
        action: () => {
          saveState('eliminar/restaurar audio')
          if (c.audioNoTrack) {
            // Restaurar
            c.audioNoTrack    = false
            c.audioLinked     = true
            c.audioTlStart    = undefined
            c.audioTlDuration = undefined
            setStatus(`Audio restaurado: ${c.name}`)
          } else {
            // Eliminar audio del clip sin tocar el video
            c.audioNoTrack    = true
            c.audioLinked     = false
            c.audioTlStart    = undefined
            c.audioTlDuration = undefined
            setStatus(`Audio eliminado: ${c.name} — no se exportará`)
          }
          renderTimeline()
        }
      },
      { divider: true }
    ]),
    {
      icon: '✂️', label: 'Dividir aquí',
      action: () => splitClip()
    },
    {
      icon: '🗑️',
      label: (fromAudio && unlinked) ? 'Eliminar pista de audio' : 'Eliminar clip',
      danger: true,
      action: () => deleteClip()
    }
  ]

  items.forEach(it => {
    if (it.divider) {
      const sep = document.createElement('div')
      sep.style.cssText = 'height:1px;background:#2a2a2a;margin:4px 0'
      menu.appendChild(sep); return
    }
    const btn = document.createElement('div')
    btn.style.cssText = `padding:8px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;color:${it.danger ? '#ff6b6b' : '#ddd'};border-radius:4px;margin:0 4px`
    btn.innerHTML = `<span style="font-size:14px;width:18px;text-align:center">${it.icon}</span><span>${it.label}</span>`
    btn.addEventListener('mouseenter', () => { btn.style.background = it.danger ? '#3a1a1a' : '#2a2a2a' })
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent' })
    btn.addEventListener('click', () => { removeClipCtxMenu(); it.action() })
    menu.appendChild(btn)
  })

  document.body.appendChild(menu)
  setTimeout(() => document.addEventListener('click', removeClipCtxMenu, { once: true }), 50)
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

function audioClipMouseDown(e, id) {
  e.stopPropagation(); e.preventDefault()

  // Seleccionar SOLO el audio — siempre limpiar selectedClip
  S.setSelectedAudioClip(id)
  S.setSelectedClip(null)
  renderTimeline()

  const c = S.clips.find(x => x.id === id)
  if (!c) return

  const audioStart = (c.audioTlStart !== undefined) ? c.audioTlStart : c.tlStart

  S.setDrag({
    type: 'move-audio', clipId: id,
    startX: e.clientX, startY: e.clientY,
    origTlStart: c.tlStart, origTlDuration: c.tlDuration,
    origAudioTlStart: audioStart,
    origStart: c.start, origTrack: c.track || 0,
    origAudioTrack: c.audioTrack || 0, ghostTrack: c.track || 0,
    origTlStartForAudio: audioStart
  })

  // Solo resaltar el elemento de audio, no el de video
  const audioEl = document.querySelector(`[data-audioid="${id}"][data-is-audio="true"]`)
  if (audioEl) audioEl.classList.add('dragging')
}

function clipMouseDown(e, id, type) {
  e.stopPropagation(); e.preventDefault()
  saveState('mover clip')
  // Al seleccionar el video, limpiar selección de audio independiente
  S.setSelectedAudioClip(null)
  selectClip(id)
  const c = S.clips.find(x => x.id === id)
  if (!c) return

  // effectiveType: move-audio solo aplica si audio desvinculado
  const effectiveType = (type === 'move-audio' && c.audioLinked !== false) ? 'move' : type

  // Para audio desvinculado, la posición de referencia es audioTlStart
  const audioStart = (c.audioLinked === false && c.audioTlStart !== undefined)
    ? c.audioTlStart
    : c.tlStart

  S.setDrag({
    type: effectiveType, clipId: id,
    startX: e.clientX, startY: e.clientY,
    origTlStart: c.tlStart, origTlDuration: c.tlDuration,
    origAudioTlStart: audioStart,
    origStart: c.start, origTrack: c.track || 0,
    origAudioTrack: c.audioTrack || 0, ghostTrack: c.track || 0,
    origTlStartForAudio: audioStart
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
    const hoveredTrackId = getTrackIdAtY(e.clientY)
    if (hoveredTrackId) {
      document.querySelectorAll('.tl-track').forEach(el => {
        el.classList.toggle('track-hover', el.dataset.trackId === hoveredTrackId)
      })
      S.drag.ghostTrackId = hoveredTrackId
    }
  } else if (S.drag.type === 'move-audio') {
    // Solo mover el audio (desvinculado)
    c.audioTlStart = Math.max(0, S.drag.origAudioTlStart + dt)
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

  TRACK_IDS_COMPAT.forEach(tid => {
    const el = document.getElementById(tid)
    if (el) el.classList.remove('track-hover')
  })
  document.querySelectorAll('.tl-track').forEach(el => el.classList.remove('track-hover'))
  document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'))

  if (S.drag.type === 'move') {
    const c = S.clips.find(x => x.id === S.drag.clipId)
    if (c && S.drag.ghostTrackId) {
      const targetTrack = S.tracks.find(t => t.id === S.drag.ghostTrackId)
      if (targetTrack) {
        if (targetTrack.type === 'video') {
          c.trackId = S.drag.ghostTrackId
          if (c.audioLinked !== false) {
            const videoTracks = S.tracks.filter(t => t.type === 'video')
            const audioTracks = S.tracks.filter(t => t.type === 'audio')
            const vIdx = videoTracks.findIndex(t => t.id === S.drag.ghostTrackId)
            if (audioTracks[vIdx]) c.audioTrackId = audioTracks[vIdx].id
          }
        } else if (targetTrack.type === 'audio') {
          c.audioTrackId = S.drag.ghostTrackId
        }
      }
    }
  } else if (S.drag.type === 'move-audio') {
    // audioTlStart ya fue actualizado en mousemove
  }

  S.setDrag(null)
  renderTimeline()
})

function renderClipPositions() {
  S.clips.forEach(c => {
    const videoLeft  = c.tlStart * S.tlZoom
    const videoWidth = Math.max(c.tlDuration * S.tlZoom, 20)
    const unlinked   = c.audioLinked === false
    const audioStart = (unlinked && c.audioTlStart    !== undefined) ? c.audioTlStart    : c.tlStart
    const audioDur   = (unlinked && c.audioTlDuration !== undefined) ? c.audioTlDuration : c.tlDuration
    const audioLeft  = audioStart * S.tlZoom
    const audioWidth = Math.max(audioDur * S.tlZoom, 20)

    // Elemento de video
    const vTrackId = c.trackId || firstVideoTrackId()
    const vEl = document.querySelector(`#track-${vTrackId} [data-id="${c.id}"]`)
    if (vEl) { vEl.style.left = videoLeft + 'px'; vEl.style.width = videoWidth + 'px' }

    // Elemento de audio
    const aTrackId = c.audioTrackId || firstAudioTrackId()
    const aEl = document.querySelector(`#track-${aTrackId} [data-id="${c.id}"]`)
    if (aEl) { aEl.style.left = audioLeft + 'px'; aEl.style.width = audioWidth + 'px' }
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
      start: 0, duration: isImg ? clipDuration : (m.duration || clipDuration),
      tlStart, tlDuration: clipDuration,
      isImage: isImg,
      trackId:      firstVideoTrackId(),
      audioTrackId: firstAudioTrackId(),
      track: 0, audioTrack: 0, audioLinked: true,
      props
    })
    renderTimeline()
    setStatus(`Clip agregado: ${m.name}`)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}