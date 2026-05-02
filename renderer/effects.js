// ── Efectos: color, filtros, transformación, trim y velocidad ─────────────────
// Todo lo relacionado con el panel de propiedades del clip seleccionado.

import * as S from './state.js'
import { fmt, defaultClipProps, setStatus } from './utils.js'
import { renderTimeline } from './timeline.js'

// ── Aplicar estilos al preview ────────────────────────────────────────────────

/** Aplica al elemento de video/imagen todos los ajustes del clip seleccionado */
export function applyVideoStyle() {
  const c      = getSelectedClip()
  const p      = c ? (c.props || defaultClipProps()) : null
  const brVal  = p ? p.brightness  : parseFloat(document.getElementById('br-sl').value)
  const ctVal  = p ? p.contrast    : parseFloat(document.getElementById('ct-sl').value)
  const satVal = p ? p.saturation  : parseFloat(document.getElementById('sat-sl').value)
  const rotVal = p ? p.rotation    : parseFloat(document.getElementById('rot-sl').value)
  const zoomVal= p ? p.zoom        : parseFloat(document.getElementById('zoom-sl').value)
  const fH     = p ? p.flipH       : S.flipH
  const fV     = p ? p.flipV       : S.flipV
  const filt   = p ? p.filter      : S.currentFilter

  const br  = (brVal  / 100 + 1).toFixed(2)
  const ct  = (ctVal  / 100 + 1).toFixed(2)
  const sat = (satVal / 100 + 1).toFixed(2)
  const zoom = zoomVal / 100

  const filterStr    = `brightness(${br}) contrast(${ct}) saturate(${sat}) ${filt}`
  const transformStr = `rotate(${rotVal}deg) scale(${fH ? -zoom : zoom},${fV ? -zoom : zoom})`

  S.vid.style.filter    = filterStr
  S.vid.style.transform = transformStr

  const previewImg = document.getElementById('preview-img')
  if (previewImg) {
    previewImg.style.filter    = filterStr
    previewImg.style.transform = transformStr
  }
}

// ── Leer / escribir propiedades desde la UI ───────────────────────────────────

/** Carga las propiedades de un clip en todos los controles del panel */
export function loadPropsToUI(p, duration) {
  const maxDur = duration || 100

  // Trim
  document.getElementById('trim-s').max   = maxDur
  document.getElementById('trim-e').max   = maxDur
  document.getElementById('trim-s').value = p.trimStart || 0
  document.getElementById('trim-e').value = p.trimEnd   || maxDur
  document.getElementById('trim-s-v').textContent = fmt(p.trimStart || 0)
  document.getElementById('trim-e-v').textContent = fmt(p.trimEnd   || maxDur)

  // Velocidad
  document.getElementById('speed-sl').value       = p.speed || 100
  document.getElementById('speed-v').textContent  = ((p.speed || 100) / 100).toFixed(2) + '×'

  // Color
  document.getElementById('br-sl').value          = p.brightness  || 0
  document.getElementById('ct-sl').value          = p.contrast    || 0
  document.getElementById('sat-sl').value         = p.saturation  || 0
  document.getElementById('br-v').textContent     = p.brightness  || 0
  document.getElementById('ct-v').textContent     = p.contrast    || 0
  document.getElementById('sat-v').textContent    = p.saturation  || 0

  // Transformación
  document.getElementById('rot-sl').value         = p.rotation || 0
  document.getElementById('zoom-sl').value        = p.zoom     || 100
  document.getElementById('rot-v').textContent    = (p.rotation || 0) + '°'
  document.getElementById('zoom-v').textContent   = (p.zoom || 100) + '%'

  // Flip
  document.getElementById('flip-h-btn').classList.toggle('on', !!p.flipH)
  document.getElementById('flip-v-btn').classList.toggle('on', !!p.flipV)

  // Filtros
  document.querySelectorAll('#filter-btns .filter-btn').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.filter === (p.filter || ''))
  })

  applyVideoStyle()
}

/** Lee los valores actuales de la UI y los guarda en el clip seleccionado */
export function savePropsFromUI() {
  const c = getSelectedClip()
  if (!c) return
  if (!c.props) c.props = defaultClipProps()

  c.props.trimStart  = parseFloat(document.getElementById('trim-s').value)  || 0
  c.props.trimEnd    = parseFloat(document.getElementById('trim-e').value)   || 0
  c.props.speed      = parseInt(document.getElementById('speed-sl').value)   || 100
  c.props.brightness = parseInt(document.getElementById('br-sl').value)      || 0
  c.props.contrast   = parseInt(document.getElementById('ct-sl').value)      || 0
  c.props.saturation = parseInt(document.getElementById('sat-sl').value)     || 0
  c.props.rotation   = parseInt(document.getElementById('rot-sl').value)     || 0
  c.props.zoom       = parseInt(document.getElementById('zoom-sl').value)    || 100
  c.props.flipH      = document.getElementById('flip-h-btn').classList.contains('on')
  c.props.flipV      = document.getElementById('flip-v-btn').classList.contains('on')
  c.props.filter     = S.currentFilter
}

// ── Handlers de controles ─────────────────────────────────────────────────────

/** Actualiza los marcadores de trim en el preview y guarda */
export function updateTrim() {
  const ts = parseFloat(document.getElementById('trim-s').value)
  const te = parseFloat(document.getElementById('trim-e').value)
  if (ts >= te) return

  S.setTrimStart(ts)
  S.setTrimEnd(te)
  document.getElementById('trim-s-v').textContent = fmt(ts)
  document.getElementById('trim-e-v').textContent = fmt(te)
  if (S.vid.duration) S.vid.currentTime = ts
  updateProgressMarkers()
  savePropsFromUI()
}

/** Actualiza las marcas visuales de trim sobre la barra de progreso */
export function updateProgressMarkers() {
  const dur = S.vid.duration || 100
  document.getElementById('trim-start-marker').style.left = (S.trimStart / dur * 100) + '%'
  document.getElementById('trim-end-marker').style.left   = (S.trimEnd   / dur * 100) + '%'
}

/** Actualiza la velocidad de reproducción */
export function updateSpeed(v) {
  S.vid.playbackRate = v / 100
  document.getElementById('speed-v').textContent = (v / 100).toFixed(2) + '×'
  savePropsFromUI()

  // Recalcular tlDuration en tiempo real → la barra del timeline se ajusta
  const c = S.clips.find(x => x.id === S.selectedClip)
  if (c && c.duration) {
    const speed     = (v / 100) || 1
    const trimStart = c.props?.trimStart || 0
    const trimEnd   = c.props?.trimEnd   || c.duration
    c.tlDuration    = Math.max(0.1, (trimEnd - trimStart) / speed)
    renderTimeline()
  }
}

/** Establece la velocidad y actualiza el slider */
export function setSpeed(v) {
  document.getElementById('speed-sl').value = v
  updateSpeed(v)
}

/** Actualiza los ajustes de color */
export function updateAdj() {
  document.getElementById('br-v').textContent  = document.getElementById('br-sl').value
  document.getElementById('ct-v').textContent  = document.getElementById('ct-sl').value
  document.getElementById('sat-v').textContent = document.getElementById('sat-sl').value
  applyVideoStyle()
  savePropsFromUI()
}

/** Actualiza rotación y zoom */
export function updateTransform() {
  document.getElementById('rot-v').textContent  = document.getElementById('rot-sl').value + '°'
  document.getElementById('zoom-v').textContent = document.getElementById('zoom-sl').value + '%'
  applyVideoStyle()
  savePropsFromUI()
}

/** Alterna flip horizontal o vertical */
export function toggleFlip(axis) {
  if (axis === 'h') {
    S.setFlipH(!S.flipH)
    document.getElementById('flip-h-btn').classList.toggle('on', S.flipH)
  } else {
    S.setFlipV(!S.flipV)
    document.getElementById('flip-v-btn').classList.toggle('on', S.flipV)
  }
  applyVideoStyle()
  savePropsFromUI()
}

/** Aplica un filtro de color al clip */
export function setFilter(btn, filter) {
  S.setCurrentFilter(filter)
  document.querySelectorAll('#filter-btns .filter-btn').forEach(b => b.classList.remove('on'))
  btn.classList.add('on')
  applyVideoStyle()
  savePropsFromUI()
}

/** Copia las propiedades del clip seleccionado a todos los demás */
export function applyToAll() {
  const c = getSelectedClip()
  if (!c || !c.props) { setStatus('Selecciona un clip primero'); return }
  import('./history.js').then(H => H.saveState('aplicar a todos'))
  const propsCopy = JSON.parse(JSON.stringify(c.props))
  S.clips.forEach(clip => {
    if (clip.id !== c.id) {
      clip.props = JSON.parse(JSON.stringify(propsCopy))
    }
  })
  setStatus('Propiedades aplicadas a todos los clips ✓')
}

// ── Helpers internos ──────────────────────────────────────────────────────────

function getSelectedClip() {
  return S.clips.find(c => c.id === S.selectedClip) || null
}