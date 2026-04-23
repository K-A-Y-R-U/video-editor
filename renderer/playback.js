// ── Reproducción multi-clip ───────────────────────────────────────────────────
// Construye una cola de reproducción a partir del timeline y gestiona
// la transición entre clips durante la reproducción.

import * as S from './state.js'
import { fmt, setStatus } from './utils.js'
import { playTransition } from './transitions.js'
import { loadMedia, updateTimeDisplay } from './media.js'
import { updatePlayhead, getPlayheadTime } from './timeline.js'
import { checkMarkersAt } from './markers.js'

// ── Cola de reproducción ──────────────────────────────────────────────────────

/**
 * Construye una secuencia no solapada de segmentos a partir del timeline.
 * Prioridad: track 0 > track 1.
 */
export function buildPlayQueue() {
  const sorted = [...S.clips].sort((a, b) =>
    a.tlStart - b.tlStart || (a.track || 0) - (b.track || 0))

  const times = new Set([0])
  sorted.forEach(c => { times.add(c.tlStart); times.add(c.tlStart + c.tlDuration) })
  const boundaries = [...times].sort((a, b) => a - b)

  const queue = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    const t    = boundaries[i]
    const tEnd = boundaries[i + 1]
    if (tEnd - t < 0.01) continue

    const active = sorted.filter(c => c.tlStart <= t && c.tlStart + c.tlDuration > t)
    if (!active.length) continue

    active.sort((a, b) => (a.track || 0) - (b.track || 0))
    const winner   = active[0]
    const segStart = winner.start + (t - winner.tlStart)
    const segDur   = tEnd - t

    const last = queue[queue.length - 1]
    if (last && last._clipId === winner.id &&
        Math.abs((last.tlStart + last.tlDuration) - t) < 0.02) {
      last.tlDuration += segDur
    } else {
      queue.push({ ...winner, tlStart: t, tlDuration: segDur, start: segStart, _clipId: winner.id })
    }
  }
  return queue
}

// ── Controles de reproducción ─────────────────────────────────────────────────

export function togglePlay() {
  if (S.isPlayingQueue) {
    S.vid.pause()
    S.setIsPlayingQueue(false)
    document.getElementById('play-btn').textContent = '▶'
    // Asegurar que el video sea visible si se pausa durante una transición
    S.vid.style.opacity = '1'
    import('./transitions.js').then(tr => tr.clearTransitionAnimPublic())
    return
  }

  if (S.clips.length > 0) {
    S.setPlayQueue(buildPlayQueue())
    const playheadT = getPlayheadTime()
    let idx = S.playQueue.findIndex(c => playheadT < c.tlStart + c.tlDuration)
    if (idx < 0) idx = 0
    S.setPlayQueueIndex(idx)
    S.setIsPlayingQueue(true)
    document.getElementById('play-btn').textContent = '⏸'
    playClipAt(idx)
  } else if (S.vid.src) {
    S.vid.paused ? S.vid.play() : S.vid.pause()
  }
}

export function playClipAt(index) {
  if (index >= S.playQueue.length) {
    S.setIsPlayingQueue(false)
    document.getElementById('play-btn').textContent = '▶'
    // Asegurar visibilidad al terminar
    S.vid.style.opacity = '1'
    setStatus('Reproducción terminada')
    return
  }
  S.setPlayQueueIndex(index)
  const c = S.playQueue[index]
  setStatus(`Reproduciendo: ${c.name} (${index + 1}/${S.playQueue.length})`)

  if (c.isImage) {
    loadMedia(c.path, 0)
    let elapsed = 0
    const interval = setInterval(() => {
      elapsed += 0.1
      const globalT  = c.tlStart + elapsed
      updatePlayhead(globalT)
      const totalDur = S.playQueue.reduce((a, x) => a + x.tlDuration, 0)
      document.getElementById('time-display').textContent = fmt(globalT) + ' / ' + fmt(totalDur)
      if (elapsed >= c.tlDuration || !S.isPlayingQueue) {
        clearInterval(interval)
        if (S.isPlayingQueue) playClipAt(S.playQueueIndex + 1)
      }
    }, 100)
  } else {
    const previewImg = document.getElementById('preview-img')
    if (previewImg) previewImg.style.display = 'none'

    // Cancelar cualquier onloadedmetadata pendiente del clip anterior
    S.vid.onloadedmetadata = null

    S.vid.style.display  = 'block'
    S.vid.style.opacity  = '1'   // Garantizar visibilidad antes de cargar
    S.vid.src = 'file://' + c.path
    document.getElementById('no-video').style.display = 'none'
    S.vid.playbackRate = parseFloat(document.getElementById('speed-sl').value) / 100

    S.vid.onloadedmetadata = () => {
      S.vid.currentTime = c.start
      const tr = S.transitions[c._clipId || c.id]
      if (tr && index > 0) {
        // Iniciar con opacity 0 solo justo antes de la transición
        S.vid.style.opacity = '0'
        S.vid.play().catch(err => console.warn('play error:', err))
        playTransition(tr.type, tr.duration, () => {
          // onDone: garantizar que quede completamente visible al terminar
          S.vid.style.opacity = '1'
        })
      } else {
        S.vid.style.opacity = '1'
        S.vid.play().catch(err => console.warn('play error:', err))
      }
    }
  }
}

// ── Eventos del elemento de video ─────────────────────────────────────────────

export function initVideoEvents() {
  S.vid.addEventListener('timeupdate', () => {
    const dur = S.vid.duration || 1
    document.getElementById('progress-fill').style.width = (S.vid.currentTime / dur * 100) + '%'

    if (S.isPlayingQueue && S.playQueue.length > 0) {
      const c = S.playQueue[S.playQueueIndex]
      if (c && !c.isImage) {
        const globalT  = c.tlStart + (S.vid.currentTime - c.start)
        updatePlayhead(globalT)
        const totalDur = S.playQueue.reduce((a, x) => a + x.tlDuration, 0)
        document.getElementById('time-display').textContent = fmt(globalT) + ' / ' + fmt(totalDur)
        if (S.markers.length > 0 &&
            checkMarkersAt(globalT, S.playQueue, S.playQueueIndex, seekToTimeLocal, togglePlay)) return
        if (S.vid.currentTime >= c.start + c.tlDuration - 0.1) {
          S.vid.pause()
          playClipAt(S.playQueueIndex + 1)
        }
      }
    } else {
      updateTimeDisplay()
      if (S.selectedClip) {
        const c = S.clips.find(x => x.id === S.selectedClip)
        if (c && !c.isImage) updatePlayhead(c.tlStart + (S.vid.currentTime - c.start))
      }
    }
  })

  S.vid.addEventListener('ended', () => {
    if (S.isPlayingQueue) playClipAt(S.playQueueIndex + 1)
    else {
      document.getElementById('play-btn').textContent = '▶'
      S.setIsPlayingQueue(false)
    }
  })

  S.vid.addEventListener('play',  () => { if (!S.isPlayingQueue) document.getElementById('play-btn').textContent = '⏸' })
  S.vid.addEventListener('pause', () => { if (!S.isPlayingQueue) document.getElementById('play-btn').textContent = '▶' })
}

// Función local para evitar importación circular
function seekToTimeLocal(t) {
  import('./timeline.js').then(tl => tl.seekToTime(t))
}

// ── Controles de playback ─────────────────────────────────────────────────────

export function toggleMute() {
  S.vid.muted = !S.vid.muted
  document.getElementById('mute-btn').textContent = S.vid.muted ? '🔇' : '🔊'
}

export function seekClick(e) {
  if (!S.vid.duration) return
  const bar = document.getElementById('progress-bar')
  S.vid.currentTime = ((e.clientX - bar.getBoundingClientRect().left) / bar.offsetWidth) * S.vid.duration
}