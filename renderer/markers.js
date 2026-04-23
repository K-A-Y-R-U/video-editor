// ── Marcadores de Loop ────────────────────────────────────────────────────────
// Los marcadores hacen que la reproducción vuelva al inicio del clip actual
// al llegar a ese punto en el tiempo global.

import * as S from './state.js'
import { fmt, setStatus } from './utils.js'

/** Devuelve el tiempo actual del playhead en segundos */
function getPlayheadTime() {
  const left = parseFloat(document.getElementById('tl-playhead').style.left) || 0
  return left / S.tlZoom
}

/** Agrega un marcador en la posición actual del playhead */
export function addMarkerAtPlayhead() {
  const t = getPlayheadTime()
  if (t <= 0) { setStatus('Mueve el playhead a donde quieres el marcador'); return }
  const nearby = S.markers.find(m => Math.abs(m.time - t) < 0.2)
  if (nearby) { setStatus('Ya hay un marcador en esa posición'); return }
  S.markers.push({ id: Date.now(), time: t })
  S.markers.sort((a, b) => a.time - b.time)
  renderMarkers()
  setStatus(`Marcador de loop agregado en ${fmt(t)}`)
}

/** Elimina un marcador por id */
export function removeMarker(id) {
  S.setMarkers(S.markers.filter(m => m.id !== id))
  renderMarkers()
  setStatus('Marcador eliminado')
}

/** Elimina todos los marcadores */
export function clearAllMarkers() {
  S.setMarkers([])
  renderMarkers()
  setStatus('Marcadores eliminados')
}

/** Renderiza todos los marcadores en el DOM del timeline */
export function renderMarkers() {
  document.querySelectorAll('.tl-marker').forEach(el => el.remove())
  const inner = document.getElementById('tl-inner')
  if (!inner) return

  S.markers.forEach(m => {
    const x  = m.time * S.tlZoom
    const el = document.createElement('div')
    el.className  = 'tl-marker'
    el.style.left = x + 'px'
    el.dataset.id = m.id
    el.title      = `Loop → 0:00 en ${fmt(m.time)}\nClic derecho para eliminar`

    const line = document.createElement('div')
    line.className = 'tl-marker-line'

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
      S.setMarkerDrag({ id: m.id, startX: e.clientX, origTime: m.time })
    })

    // Clic derecho para eliminar
    el.addEventListener('contextmenu', e => {
      e.preventDefault()
      e.stopPropagation()
      removeMarker(m.id)
    })
  })
}

/** Actualiza posiciones visuales al cambiar el zoom */
export function updateMarkerPositions() {
  S.markers.forEach(m => {
    const el = document.querySelector(`.tl-marker[data-id="${m.id}"]`)
    if (el) el.style.left = (m.time * S.tlZoom) + 'px'
  })
}

/**
 * Verifica si el playhead pasó por un marcador durante la reproducción.
 * @returns {boolean} true si se disparó un loop
 */
export function checkMarkersAt(globalT, playQueue, playQueueIndex, seekToTime, togglePlay) {
  for (const m of S.markers) {
    if (Math.abs(globalT - m.time) < 0.15) {
      const currentClip = playQueue[playQueueIndex]
      if (!currentClip) return false
      S.vid.pause()
      seekToTime(currentClip.tlStart)
      setTimeout(() => togglePlay(), 80)
      return true
    }
  }
  return false
}
