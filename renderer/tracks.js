// ── Sistema de pistas dinámicas ───────────────────────────────────────────────
// Reemplaza las pistas hardcodeadas (Video 1, Video 2, Audio 1, Audio 2)
// por un sistema donde el usuario puede agregar, eliminar y reordenar pistas.

import * as S from './state.js'
import { saveState } from './history.js'

// ── Tipos de pista ────────────────────────────────────────────────────────────
export const TRACK_TYPES = {
  video: { label: 'Video',  color: '#1a2040', border: '#2a3060', icon: '🎬', acceptsClip: c => !c.isAudio },
  audio: { label: 'Audio',  color: '#0a0d0a', border: '#1a2d1a', icon: '🎵', acceptsClip: c => true       },
  text:  { label: 'Texto',  color: '#0d0a1a', border: '#2a1a5a', icon: 'Tt', acceptsClip: () => false      },
}

// ── Inicializar pistas por defecto ────────────────────────────────────────────
export function initDefaultTracks() {
  if (S.tracks && S.tracks.length > 0) return
  S.setTracks([
    { id: 'track-v1', type: 'video', label: 'Video',  locked: false, muted: false, solo: false },
    { id: 'track-t1', type: 'text',  label: 'Texto',  locked: false, muted: false, solo: false },
    { id: 'track-a1', type: 'audio', label: 'Audio',  locked: false, muted: false, solo: false },
  ])
}

// ── Agregar pista ─────────────────────────────────────────────────────────────
export function addTrack(type, afterId = null) {
  saveState('agregar pista')
  const def    = TRACK_TYPES[type]
  const count  = S.tracks.filter(t => t.type === type).length + 1
  const newTrack = {
    id:     `track-${type}-${Date.now()}`,
    type,
    label:  `${def.label} ${count}`,
    locked: false, muted: false, solo: false
  }

  const tracks = [...S.tracks]
  if (afterId) {
    const idx = tracks.findIndex(t => t.id === afterId)
    tracks.splice(idx + 1, 0, newTrack)
  } else {
    // Insertar antes del primer audio si es video, al final si es audio
    if (type === 'video') {
      const firstAudio = tracks.findIndex(t => t.type === 'audio')
      tracks.splice(firstAudio === -1 ? tracks.length : firstAudio, 0, newTrack)
    } else {
      tracks.push(newTrack)
    }
  }
  S.setTracks(tracks)
  renderTracks()
  return newTrack.id
}

// ── Eliminar pista ────────────────────────────────────────────────────────────
export function removeTrack(id) {
  const track = S.tracks.find(t => t.id === id)
  if (!track) return
  // No eliminar si es la última de su tipo
  if (S.tracks.filter(t => t.type === track.type).length <= 1 && track.type !== 'text') {
    showTrackMsg('Necesitas al menos una pista de este tipo', id); return
  }
  saveState('eliminar pista')
  // Mover clips de esta pista a la primera pista del mismo tipo
  const firstSameType = S.tracks.find(t => t.type === track.type && t.id !== id)
  if (firstSameType) {
    S.clips.forEach(c => {
      if (c.trackId === id)      c.trackId      = firstSameType.id
      if (c.audioTrackId === id) c.audioTrackId = firstSameType.id
    })
  }
  S.setTracks(S.tracks.filter(t => t.id !== id))
  renderTracks()
  import('./timeline.js').then(tl => tl.renderTimeline())
}

// ── Renombrar pista ───────────────────────────────────────────────────────────
export function renameTrack(id, name) {
  const track = S.tracks.find(t => t.id === id)
  if (track) { track.label = name; renderTrackLabel(id) }
}

// ── Mover pista (reordenar) ───────────────────────────────────────────────────
export function moveTrack(id, dir) {
  saveState('reordenar pista')
  const tracks = [...S.tracks]
  const idx    = tracks.findIndex(t => t.id === id)
  if (idx === -1) return
  if (dir === 'up'   && idx > 0)                    { [tracks[idx], tracks[idx-1]] = [tracks[idx-1], tracks[idx]] }
  else if (dir === 'down' && idx < tracks.length-1) { [tracks[idx], tracks[idx+1]] = [tracks[idx+1], tracks[idx]] }
  S.setTracks(tracks)
  renderTracks()
  import('./timeline.js').then(tl => tl.renderTimeline())
}

// ── Toggle mute / lock / solo ────────────────────────────────────────────────
export function toggleTrackMute(id) {
  const t = S.tracks.find(t => t.id === id)
  if (t) { t.muted = !t.muted; renderTrackLabel(id) }
}
export function toggleTrackLock(id) {
  const t = S.tracks.find(t => t.id === id)
  if (t) { t.locked = !t.locked; renderTrackLabel(id) }
}

// ── Render completo de pistas ─────────────────────────────────────────────────
export function renderTracks() {
  const labelsEl = document.getElementById('tl-labels')
  const innerEl  = document.getElementById('tl-inner')
  if (!labelsEl || !innerEl) return

  // Guardar ancho actual de tl-inner
  const curW = innerEl.style.width

  // Reconstruir labels
  labelsEl.innerHTML = `<div class="ruler-label" style="height:20px;display:flex;align-items:center;padding:0 6px">
    <button id="btn-add-track" title="Agregar pista" style="background:var(--bg-3);border:1px solid var(--border);color:var(--text-2);border-radius:4px;padding:0 5px;height:16px;cursor:pointer;font-size:10px;line-height:1">+</button>
  </div>`

  // Reconstruir track divs en tl-inner
  // Primero quitar los track divs viejos (no el ruler ni el playhead)
  innerEl.querySelectorAll('.tl-track').forEach(el => el.remove())

  const ruler    = innerEl.querySelector('#tl-ruler')
  const playhead = innerEl.querySelector('#tl-playhead')

  S.tracks.forEach(track => {
    const def = TRACK_TYPES[track.type] || TRACK_TYPES.video

    // Label
    const labelDiv = buildLabelDiv(track, def)
    labelsEl.appendChild(labelDiv)

    // Track div
    const trackDiv = document.createElement('div')
    trackDiv.id           = `track-${track.id}`
    trackDiv.className    = 'tl-track'
    trackDiv.dataset.trackId   = track.id
    trackDiv.dataset.trackType = track.type
    trackDiv.style.cssText = [
      'position:relative',
      'border-bottom:1px solid var(--border)',
      `background:${def.color}`,
      'height:28px',
      track.muted  ? 'opacity:0.45' : '',
      track.locked ? 'pointer-events:none;opacity:0.6' : '',
    ].filter(Boolean).join(';')

    if (curW) trackDiv.style.width = curW

    // Insertar antes del playhead si existe
    if (playhead) innerEl.insertBefore(trackDiv, playhead)
    else innerEl.appendChild(trackDiv)
  })

  // Botón agregar pista
  document.getElementById('btn-add-track')?.addEventListener('click', e => {
    showAddTrackMenu(e.clientX, e.clientY)
  })
}

function buildLabelDiv(track, def) {
  const div = document.createElement('div')
  div.id = `label-${track.id}`
  div.style.cssText = [
    'display:flex', 'align-items:center', 'gap:4px',
    'padding:0 4px', 'border-bottom:1px solid var(--border)',
    'height:28px',
    'font-size:9px', 'color:var(--text-3)', 'user-select:none',
    'position:relative', 'overflow:visible'
  ].join(';')

  // Icono de tipo
  const icon = document.createElement('span')
  icon.textContent = def.icon
  icon.style.cssText = 'font-size:10px;flex-shrink:0;opacity:0.7'

  // Nombre editable
  const name = document.createElement('span')
  name.textContent  = track.label
  name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text;font-size:9px'
  name.title = 'Doble clic para renombrar'
  name.addEventListener('dblclick', () => {
    name.contentEditable = 'true'
    name.style.outline = '1px solid var(--accent)'
    name.style.background = 'var(--bg-3)'
    name.focus()
    const sel = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(name)
    sel.removeAllRanges()
    sel.addRange(range)
    name.addEventListener('blur',    () => finishRename(name, track.id), { once: true })
    name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); name.blur() } }, { once: true })
  })

  // Botones de control
  const muteBtn = makeTrackBtn(track.muted ? '🔇' : 'M', track.muted ? '#ff6b6b' : '', () => {
    toggleTrackMute(track.id)
  }, 'Silenciar')
  muteBtn.id = `mute-${track.id}`

  const lockBtn = makeTrackBtn('🔒', track.locked ? '#f7a84f' : '', () => {
    toggleTrackLock(track.id)
  }, 'Bloquear')
  lockBtn.id = `lock-${track.id}`

  // Menú contextual de pista
  div.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation()
    showTrackContextMenu(e.clientX, e.clientY, track.id)
  })

  div.appendChild(icon)
  div.appendChild(name)
  div.appendChild(muteBtn)
  div.appendChild(lockBtn)

  return div
}

function makeTrackBtn(text, activeColor, onClick, title) {
  const btn = document.createElement('button')
  btn.textContent = text
  btn.title       = title
  btn.style.cssText = [
    'background:transparent', 'border:none',
    'color:' + (activeColor || 'var(--text-3)'),
    'cursor:pointer', 'font-size:9px', 'padding:1px 3px',
    'border-radius:3px', 'flex-shrink:0',
    'transition:background 0.1s'
  ].join(';')
  btn.addEventListener('mouseenter', () => btn.style.background = 'var(--bg-3)')
  btn.addEventListener('mouseleave', () => btn.style.background = 'transparent')
  btn.addEventListener('click',      e => { e.stopPropagation(); onClick() })
  return btn
}

function finishRename(el, id) {
  el.contentEditable = 'false'
  el.style.outline   = ''
  el.style.background = ''
  renameTrack(id, el.textContent.trim() || 'Pista')
}

function renderTrackLabel(id) {
  const track = S.tracks.find(t => t.id === id)
  if (!track) return
  const def = TRACK_TYPES[track.type] || TRACK_TYPES.video
  const old = document.getElementById(`label-${id}`)
  if (!old) return
  const newEl = buildLabelDiv(track, def)
  old.replaceWith(newEl)
  // Actualizar estilo del track div
  const trackDiv = document.getElementById(`track-${id}`)
  if (trackDiv) {
    trackDiv.style.opacity        = track.muted  ? '0.45' : '1'
    trackDiv.style.pointerEvents  = track.locked ? 'none'  : ''
  }
}

// ── Menú contextual de pista ──────────────────────────────────────────────────
function showTrackContextMenu(x, y, id) {
  document.getElementById('track-ctx-menu')?.remove()
  const track = S.tracks.find(t => t.id === id)
  if (!track) return

  const menu = document.createElement('div')
  menu.id = 'track-ctx-menu'
  menu.style.cssText = [
    'position:fixed', 'left:0', 'top:0',   // posición temporal para medir
    'background:#1e1e1e', 'border:1px solid #3a3a3a',
    'border-radius:8px', 'padding:4px 0', 'min-width:200px',
    'z-index:9999', 'box-shadow:0 4px 24px rgba(0,0,0,0.75)',
    'font-size:12px', 'visibility:hidden'   // invisible hasta posicionar
  ].join(';')

  const items = [
    { icon: '➕', label: `Agregar ${TRACK_TYPES[track.type].label} abajo`,
      action: () => { addTrack(track.type, id); import('./timeline.js').then(tl => tl.renderTimeline()) } },
    { divider: true },
    { icon: '↑',  label: 'Mover arriba',   action: () => moveTrack(id, 'up') },
    { icon: '↓',  label: 'Mover abajo',    action: () => moveTrack(id, 'down') },
    { divider: true },
    { icon: track.muted  ? '🔊' : '🔇', label: track.muted  ? 'Activar audio' : 'Silenciar',
      action: () => toggleTrackMute(id) },
    { icon: track.locked ? '🔓' : '🔒', label: track.locked ? 'Desbloquear'   : 'Bloquear',
      action: () => toggleTrackLock(id) },
    { divider: true },
    { icon: '✏️', label: 'Renombrar',
      action: () => {
        const nameEl = document.querySelector(`#label-${id} span[title]`)
        if (nameEl) nameEl.dispatchEvent(new MouseEvent('dblclick'))
      }
    },
    { icon: '🗑️', label: 'Eliminar pista', danger: true,
      action: () => removeTrack(id) },
  ]

  items.forEach(it => {
    if (it.divider) {
      const sep = document.createElement('div')
      sep.style.cssText = 'height:1px;background:#2a2a2a;margin:3px 0'
      menu.appendChild(sep); return
    }
    const btn = document.createElement('div')
    btn.style.cssText = `padding:7px 12px;cursor:pointer;display:flex;align-items:center;gap:9px;color:${it.danger?'#ff6b6b':'#ddd'};border-radius:4px;margin:0 3px`
    btn.innerHTML = `<span style="width:16px;text-align:center">${it.icon}</span><span>${it.label}</span>`
    btn.addEventListener('mouseenter', () => btn.style.background = it.danger ? '#3a1a1a' : '#2a2a2a')
    btn.addEventListener('mouseleave', () => btn.style.background = 'transparent')
    btn.addEventListener('click', () => { menu.remove(); it.action() })
    menu.appendChild(btn)
  })

  document.body.appendChild(menu)

  // Posicionar inteligentemente — evitar que se salga de pantalla
  const mw = menu.offsetWidth
  const mh = menu.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight
  const finalX = x + mw > vw ? vw - mw - 8 : x
  const finalY = y + mh > vh ? y - mh        : y
  menu.style.left       = finalX + 'px'
  menu.style.top        = finalY + 'px'
  menu.style.visibility = 'visible'

  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 50)
}

// ── Menú agregar pista ────────────────────────────────────────────────────────
function showAddTrackMenu(x, y) {
  document.getElementById('add-track-menu')?.remove()
  const menu = document.createElement('div')
  menu.id = 'add-track-menu'
  menu.style.cssText = [
    'position:fixed', 'left:0', 'top:0',
    'background:#1e1e1e', 'border:1px solid #3a3a3a',
    'border-radius:8px', 'padding:4px 0', 'min-width:180px',
    'z-index:9999', 'box-shadow:0 4px 24px rgba(0,0,0,0.75)',
    'font-size:12px', 'visibility:hidden'
  ].join(';')

  ;[
    { icon: '🎬', label: 'Pista de Video', type: 'video' },
    { icon: '🎵', label: 'Pista de Audio', type: 'audio' },
    { icon: 'Tt', label: 'Pista de Texto', type: 'text'  },
  ].forEach(it => {
    const btn = document.createElement('div')
    btn.style.cssText = 'padding:9px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;color:#ddd;border-radius:4px;margin:0 3px'
    btn.innerHTML = `<span style="width:18px;text-align:center;font-size:13px">${it.icon}</span><span>${it.label}</span>`
    btn.addEventListener('mouseenter', () => btn.style.background = '#2a2a2a')
    btn.addEventListener('mouseleave', () => btn.style.background = 'transparent')
    btn.addEventListener('click', () => {
      menu.remove()
      addTrack(it.type)
      import('./timeline.js').then(tl => tl.renderTimeline())
    })
    menu.appendChild(btn)
  })

  document.body.appendChild(menu)
  const mw = menu.offsetWidth, mh = menu.offsetHeight
  const finalX = x + mw > window.innerWidth  ? window.innerWidth  - mw - 8 : x
  const finalY = y + mh > window.innerHeight  ? y - mh                       : y
  menu.style.left = finalX + 'px'
  menu.style.top  = finalY + 'px'
  menu.style.visibility = 'visible'
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 50)
}

// ── Helper mensajes ───────────────────────────────────────────────────────────
function showTrackMsg(msg, trackId) {
  const label = document.getElementById(`label-${trackId}`)
  if (!label) return
  const tip = document.createElement('div')
  tip.textContent = msg
  tip.style.cssText = 'position:absolute;left:0;bottom:-24px;background:#222;color:#ff6b6b;font-size:10px;padding:3px 7px;border-radius:4px;white-space:nowrap;z-index:999;pointer-events:none'
  label.appendChild(tip)
  setTimeout(() => tip.remove(), 2500)
}

// ── Obtener trackId por posición Y del mouse ──────────────────────────────────
export function getTrackIdAtY(y) {
  const trackEls = document.querySelectorAll('.tl-track')
  for (const el of trackEls) {
    const rect = el.getBoundingClientRect()
    if (y >= rect.top && y <= rect.bottom) {
      return el.dataset.trackId || null
    }
  }
  return null
}

// ── Compatibilidad: mapear trackId a índice numérico (para drag) ──────────────
export function trackIdToIndex(trackId) {
  return S.tracks.findIndex(t => t.id === trackId)
}
export function indexToTrackId(idx) {
  return S.tracks[idx]?.id || null
}