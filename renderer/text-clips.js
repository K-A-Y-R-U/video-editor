// ── Texto animado en el timeline ──────────────────────────────────────────────
// Gestiona clips de texto con animaciones sobre el video (como CapCut).
// Renderiza en canvas overlay y exporta quemado con FFmpeg.

import * as S from './state.js'
import { setStatus } from './utils.js'
import { saveState } from './history.js'
import { renderTimeline } from './timeline.js'

// ── Helper: obtener el elemento DOM de la pista de texto ─────────────────────
// La pista de texto ya no tiene ID fijo "tl-text-track" — usa el ID dinámico
// generado por tracks.js (ej. "track-track-t1"). Lo buscamos desde S.tracks.
function getTextTrackEl() {
  const textTrack = S.tracks.find(t => t.type === 'text')
  if (!textTrack) return null
  return document.getElementById(`track-${textTrack.id}`)
}

// ── Animaciones disponibles ───────────────────────────────────────────────────

export const TEXT_ANIMATIONS = {
  none:       { label: 'Sin animación',  icon: '—'  },
  fade:       { label: 'Fade',           icon: '✦'  },
  slideUp:    { label: 'Slide Up',       icon: '↑'  },
  slideDown:  { label: 'Slide Down',     icon: '↓'  },
  slideLeft:  { label: 'Slide Left',     icon: '←'  },
  slideRight: { label: 'Slide Right',    icon: '→'  },
  typewriter: { label: 'Máquina',        icon: '⌨'  },
  bounce:     { label: 'Bounce',         icon: '⤴'  },
  zoom:       { label: 'Zoom In',        icon: '⊕'  },
  zoomOut:    { label: 'Zoom Out',       icon: '⊖'  },
  glitch:     { label: 'Glitch',         icon: '▓'  },
  wave:       { label: 'Ola',            icon: '〜' },
  spin:       { label: 'Spin',           icon: '↻'  },
  neon:       { label: 'Neón',           icon: '◈'  },
  cinematic:  { label: 'Cinemático',     icon: '▬'  },
}

// Presets de estilo rápido
export const TEXT_PRESETS = [
  { id: 'titulo',    label: 'Título',      fontSize: 64, fontWeight: '900', color: '#ffffff', shadow: true,  animation: 'fade',       bg: '' },
  { id: 'subtitulo', label: 'Subtítulo',   fontSize: 36, fontWeight: '400', color: '#e0e0e0', shadow: true,  animation: 'slideUp',    bg: '' },
  { id: 'neon',      label: 'Neón',        fontSize: 48, fontWeight: '700', color: '#00ffcc', shadow: false, animation: 'neon',       bg: '' },
  { id: 'caption',   label: 'Caption',     fontSize: 28, fontWeight: '600', color: '#ffffff', shadow: false, animation: 'fade',       bg: 'rgba(0,0,0,0.55)' },
  { id: 'cinematic', label: 'Cinemático',  fontSize: 32, fontWeight: '300', color: '#ffffff', shadow: false, animation: 'cinematic',  bg: '' },
  { id: 'glitch',    label: 'Glitch',      fontSize: 52, fontWeight: '900', color: '#ff2255', shadow: false, animation: 'glitch',     bg: '' },
  { id: 'wave',      label: 'Wave',        fontSize: 44, fontWeight: '700', color: '#ffcc00', shadow: true,  animation: 'wave',       bg: '' },
  { id: 'typewriter',label: 'Máquina',     fontSize: 30, fontWeight: '400', color: '#00ff88', shadow: false, animation: 'typewriter', bg: '' },
]

// ── Canvas overlay ────────────────────────────────────────────────────────────

let overlayCanvas  = null
let overlayCtx     = null
let animFrameId    = null
let selectedTextId = null

export function initTextOverlay() {
  const playerWrap = document.getElementById('player-wrap')
  if (!playerWrap || document.getElementById('text-overlay-canvas')) return

  overlayCanvas = document.createElement('canvas')
  overlayCanvas.id = 'text-overlay-canvas'
  overlayCanvas.style.cssText = [
    'position:absolute', 'top:0', 'left:0', 'width:100%', 'height:100%',
    'pointer-events:none', 'z-index:10'
  ].join(';')
  playerWrap.appendChild(overlayCanvas)
  overlayCtx = overlayCanvas.getContext('2d')   // ← FALTABA ESTO

  // Resize observer para mantener canvas sincronizado con el player
  new ResizeObserver(() => resizeCanvas()).observe(playerWrap)
  resizeCanvas()
}

function resizeCanvas() {
  if (!overlayCanvas) return
  const pw = document.getElementById('player-wrap')
  if (!pw) return
  overlayCanvas.width  = pw.offsetWidth
  overlayCanvas.height = pw.offsetHeight
  overlayCtx = overlayCanvas.getContext('2d')   // reasignar tras resize
}

// ── Bucle de render del canvas ────────────────────────────────────────────────

export function startTextRender() {
  if (animFrameId) return
  function loop() {
    renderTextFrame()
    animFrameId = requestAnimationFrame(loop)
  }
  animFrameId = requestAnimationFrame(loop)
}

export function stopTextRender() {
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null }
}

function renderTextFrame() {
  if (!overlayCtx || !overlayCanvas) return
  const W = overlayCanvas.width
  const H = overlayCanvas.height
  overlayCtx.clearRect(0, 0, W, H)

  if (!S.textClips || !S.textClips.length) return

  // Tiempo actual en el timeline
  const ph   = document.getElementById('tl-playhead')
  const t    = ph ? (parseFloat(ph.style.left) || 0) / S.tlZoom : 0

  S.textClips.forEach(tc => {
    if (t < tc.tlStart || t > tc.tlStart + tc.tlDuration) return
    const localT = t - tc.tlStart
    const prog   = localT / tc.tlDuration   // 0→1

    drawTextClip(overlayCtx, tc, localT, prog, W, H,
      tc.id === selectedTextId)
  })
}

// ── Dibujado de un clip de texto ──────────────────────────────────────────────

function drawTextClip(ctx, tc, localT, prog, W, H, isSelected) {
  ctx.save()

  const x = (tc.x / 100) * W
  const y = (tc.y / 100) * H
  const fs = Math.round((tc.fontSize / 100) * H * 0.18)   // fontSize relativo al alto del player

  ctx.font = `${tc.fontWeight || '700'} ${fs}px "${tc.fontFamily || 'Arial'}", sans-serif`
  ctx.textAlign  = tc.align  || 'center'
  ctx.textBaseline = 'middle'

  const { alpha, offsetX, offsetY, scale, chars } = getAnimState(tc, localT, prog, W, H, fs)

  ctx.globalAlpha = Math.max(0, Math.min(1, alpha))
  ctx.translate(x + offsetX, y + offsetY)
  ctx.scale(scale, scale)

  // Fondo del texto
  if (tc.bg) {
    const metrics = ctx.measureText(tc.text)
    const tw = metrics.width
    const pad = fs * 0.3
    const bx  = tc.align === 'center' ? -tw/2 - pad : -pad
    ctx.fillStyle = tc.bg
    roundRect(ctx, bx, -fs/2 - pad*0.5, tw + pad*2, fs + pad, fs * 0.2)
    ctx.fill()
  }

  // Sombra
  if (tc.shadow) {
    ctx.shadowColor   = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur    = fs * 0.15
    ctx.shadowOffsetX = fs * 0.03
    ctx.shadowOffsetY = fs * 0.03
  }

  // Neón especial
  if (tc.animation === 'neon') {
    drawNeonText(ctx, tc.text, 0, 0, fs, tc.color, localT)
  } else if (tc.animation === 'glitch') {
    drawGlitchText(ctx, tc.text, 0, 0, fs, tc.color, localT)
  } else if (tc.animation === 'wave') {
    drawWaveText(ctx, tc.text, 0, 0, fs, tc.color, localT, ctx.font)
  } else if (tc.animation === 'typewriter') {
    const visible = Math.floor(prog * tc.text.length)
    ctx.fillStyle = tc.color || '#ffffff'
    ctx.fillText(tc.text.slice(0, visible) + (Math.floor(localT * 2) % 2 === 0 ? '|' : ''), 0, 0)
  } else {
    ctx.fillStyle = tc.color || '#ffffff'
    ctx.fillText(tc.text, 0, 0)
  }

  // Borde de selección
  if (isSelected) {
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'
    ctx.globalAlpha = 0.8
    ctx.strokeStyle = '#f7a84f'
    ctx.lineWidth = 2 / (scale || 1)
    const m = ctx.measureText(tc.text)
    const tw = m.width
    const bx = tc.align === 'center' ? -tw/2 - 6 : -6
    ctx.strokeRect(bx, -fs/2 - 6, tw + 12, fs + 12)
  }

  ctx.restore()
}

function getAnimState(tc, localT, prog, W, H, fs) {
  const dur     = tc.tlDuration
  const fadeIn  = Math.min(0.3, dur * 0.2)
  const fadeOut = Math.min(0.3, dur * 0.2)
  const inProg  = Math.min(1, localT / fadeIn)
  const outProg = Math.max(0, 1 - (dur - localT) / fadeOut)
  const alpha   = Math.min(inProg, 1 - outProg)
  const ease    = t => t < 0.5 ? 2*t*t : -1+(4-2*t)*t

  let offsetX = 0, offsetY = 0, scale = 1

  switch (tc.animation) {
    case 'slideUp':
      offsetY = (1 - ease(inProg)) * H * 0.08 + outProg * H * 0.08; break
    case 'slideDown':
      offsetY = -(1 - ease(inProg)) * H * 0.08 - outProg * H * 0.08; break
    case 'slideLeft':
      offsetX = (1 - ease(inProg)) * W * 0.1 + outProg * W * 0.1; break
    case 'slideRight':
      offsetX = -(1 - ease(inProg)) * W * 0.1 - outProg * W * 0.1; break
    case 'zoom':
      scale = 0.3 + ease(inProg) * 0.7; break
    case 'zoomOut':
      scale = 1 + (1 - ease(inProg)) * 0.5; break
    case 'bounce':
      const b = ease(Math.min(1, localT / (fadeIn * 1.5)))
      offsetY = (1 - b) * H * 0.1 - Math.abs(Math.sin(localT * 8)) * H * 0.02 * (1 - Math.min(1, localT)); break
    case 'spin':
      scale = ease(inProg) * 0.8 + 0.2; break
    case 'cinematic':
      offsetX = (1 - ease(inProg)) * W * 0.15; break
  }

  return { alpha, offsetX, offsetY, scale }
}

function drawNeonText(ctx, text, x, y, fs, color, t) {
  const pulse = 0.7 + 0.3 * Math.sin(t * 4)
  ;[20, 12, 6].forEach((blur, i) => {
    ctx.shadowBlur    = blur * pulse
    ctx.shadowColor   = color
    ctx.strokeStyle   = color
    ctx.lineWidth     = [3, 2, 1][i]
    ctx.globalAlpha   = [0.3, 0.6, 1][i] * pulse
    ctx.strokeText(text, x, y)
  })
  ctx.globalAlpha = 1
  ctx.shadowBlur  = 0
  ctx.fillStyle   = '#ffffff'
  ctx.fillText(text, x, y)
}

function drawGlitchText(ctx, text, x, y, fs, color, t) {
  if (Math.random() < 0.3) {
    const shift = (Math.random() - 0.5) * fs * 0.3
    ctx.fillStyle = '#ff0044'; ctx.fillText(text, x + shift, y)
    ctx.fillStyle = '#00ffcc'; ctx.fillText(text, x - shift, y)
    ctx.globalAlpha *= 0.7
  }
  ctx.fillStyle = color || '#ff2255'
  ctx.fillText(text, x, y)
}

function drawWaveText(ctx, text, x, y, fs, color, t, font) {
  ctx.font = font
  ctx.fillStyle = color || '#ffcc00'
  const chars = text.split('')
  const totalW = ctx.measureText(text).width
  let cx = x - totalW / 2
  chars.forEach((ch, i) => {
    const wy = Math.sin(t * 3 + i * 0.5) * fs * 0.2
    ctx.fillText(ch, cx, y + wy)
    cx += ctx.measureText(ch).width
  })
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

// ── CRUD de texto clips ───────────────────────────────────────────────────────

export function addTextClip(preset) {
  saveState('agregar texto')
  const ph     = document.getElementById('tl-playhead')
  const tlStart = ph ? (parseFloat(ph.style.left) || 0) / S.tlZoom : 0

  const tc = {
    id:         Date.now(),
    text:       preset?.id === 'titulo' ? 'MI TÍTULO' :
                preset?.id === 'subtitulo' ? 'Subtítulo aquí' :
                preset?.id === 'neon' ? 'NEÓN' :
                preset?.id === 'caption' ? 'Caption de ejemplo' :
                preset?.id === 'glitch' ? 'GLITCH' :
                preset?.id === 'wave' ? 'WAVE ✦' :
                preset?.id === 'typewriter' ? 'Escribiendo...' :
                'Texto nuevo',
    tlStart,
    tlDuration: 3,
    x:          50,    // % del ancho del player
    y:          80,    // % del alto del player
    fontSize:   preset?.fontSize   || 48,
    fontWeight: preset?.fontWeight || '700',
    fontFamily: 'Arial',
    color:      preset?.color      || '#ffffff',
    bg:         preset?.bg         || '',
    shadow:     preset?.shadow     ?? true,
    align:      'center',
    animation:  preset?.animation  || 'fade',
  }

  S.textClips.push(tc)
  selectedTextId = tc.id
  renderTextTimeline()
  showTextPanel(tc)
  setStatus(`Texto agregado: "${tc.text}"`)
}

export function deleteTextClip(id) {
  saveState('eliminar texto')
  S.setTextClips(S.textClips.filter(t => t.id !== id))
  if (selectedTextId === id) { selectedTextId = null; hideTextPanel() }
  renderTextTimeline()
  setStatus('Texto eliminado')
}

export function selectTextClip(id) {
  selectedTextId = id
  const tc = S.textClips.find(t => t.id === id)
  if (tc) showTextPanel(tc)
  renderTextTimeline()
}

export function getSelectedTextClip() {
  return S.textClips.find(t => t.id === selectedTextId) || null
}

// ── Render pista de texto en el timeline ──────────────────────────────────────

export function renderTextTimeline() {
  const track = getTextTrackEl()
  if (!track) return

  const totalDur = Math.max(10, ...S.textClips.map(tc => tc.tlStart + tc.tlDuration),
    ...S.clips.map(c => c.tlStart + c.tlDuration))
  const w = Math.max(totalDur * S.tlZoom + 200, 600)
  track.style.width = w + 'px'
  track.innerHTML = ''

  S.textClips.forEach(tc => {
    const left  = tc.tlStart   * S.tlZoom
    const width = Math.max(tc.tlDuration * S.tlZoom, 30)
    const sel   = tc.id === selectedTextId ? 'selected' : ''

    const el = document.createElement('div')
    el.className     = `tl-clip text-clip ${sel}`
    el.style.cssText = `left:${left}px;width:${width}px;background:linear-gradient(135deg,#5b6ef8,#8b5cf6);color:#fff`
    el.dataset.id    = tc.id
    el.title         = tc.text

    const lh = document.createElement('div')
    lh.className = 'tl-resize-handle left'
    lh.addEventListener('mousedown', e => textResizeDown(e, tc.id, 'left'))

    const label = document.createElement('span')
    label.className   = 'tl-clip-label'
    label.textContent = `Tt ${tc.text}`

    const rh = document.createElement('div')
    rh.className = 'tl-resize-handle right'
    rh.addEventListener('mousedown', e => textResizeDown(e, tc.id, 'right'))

    el.appendChild(lh)
    el.appendChild(label)
    el.appendChild(rh)

    el.addEventListener('mousedown', e => {
      if (e.target.classList.contains('tl-resize-handle')) return
      textClipMouseDown(e, tc.id)
    })
    el.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation()
      showTextContextMenu(e.clientX, e.clientY, tc.id)
    })
    track.appendChild(el)
  })
}

// ── Drag & Resize de texto clips ──────────────────────────────────────────────

let textDrag = null

function textClipMouseDown(e, id) {
  e.stopPropagation(); e.preventDefault()
  selectTextClip(id)
  const tc = S.textClips.find(t => t.id === id)
  if (!tc) return
  textDrag = { type: 'move', id, startX: e.clientX, origStart: tc.tlStart }
  document.querySelector(`[data-id="${id}"]`)?.classList.add('dragging')
}

function textResizeDown(e, id, side) {
  e.stopPropagation(); e.preventDefault()
  const tc = S.textClips.find(t => t.id === id)
  if (!tc) return
  textDrag = { type: 'resize-' + side, id, startX: e.clientX,
    origStart: tc.tlStart, origDur: tc.tlDuration }
}

document.addEventListener('mousemove', e => {
  if (!textDrag) return
  const tc = S.textClips.find(t => t.id === textDrag.id)
  if (!tc) return
  const dx = e.clientX - textDrag.startX
  const dt = dx / S.tlZoom

  if (textDrag.type === 'move') {
    tc.tlStart = Math.max(0, textDrag.origStart + dt)
  } else if (textDrag.type === 'resize-right') {
    tc.tlDuration = Math.max(0.5, textDrag.origDur + dt)
  } else if (textDrag.type === 'resize-left') {
    const shift = Math.min(dt, textDrag.origDur - 0.5)
    tc.tlStart    = Math.max(0, textDrag.origStart + shift)
    tc.tlDuration = textDrag.origDur - shift
  }

  // Actualizar posición en DOM directamente (sin renderizar todo)
  const trackEl = getTextTrackEl()
  const el = trackEl ? trackEl.querySelector(`[data-id="${tc.id}"]`) : null
  if (el) {
    el.style.left  = (tc.tlStart * S.tlZoom) + 'px'
    el.style.width = Math.max(tc.tlDuration * S.tlZoom, 30) + 'px'
  }
})

document.addEventListener('mouseup', () => {
  if (textDrag) {
    saveState('mover texto')
    textDrag = null
    document.querySelectorAll('.text-clip.dragging').forEach(el => el.classList.remove('dragging'))
  }
})

// ── Panel de propiedades de texto ─────────────────────────────────────────────

export function showTextPanel(tc) {
  // Cambiar a vista editor
  const viewPresets = document.getElementById('text-view-presets')
  const viewEditor  = document.getElementById('text-view-editor')
  if (viewPresets) viewPresets.style.display = 'none'
  if (viewEditor)  viewEditor.style.display  = 'flex'

  // Actualizar label del header
  const titleLabel = document.getElementById('tp-title-label')
  if (titleLabel) titleLabel.textContent = `"${tc.text.slice(0, 18)}${tc.text.length > 18 ? '…' : ''}"`

  // Texto
  const tpText = document.getElementById('tp-text')
  if (tpText) tpText.value = tc.text

  // Color
  const tpColor = document.getElementById('tp-color')
  if (tpColor) tpColor.value = tc.color || '#ffffff'

  // Tamaño
  const tpFs = document.getElementById('tp-fontsize')
  const tpFsV = document.getElementById('tp-fontsize-v')
  if (tpFs) tpFs.value = tc.fontSize || 48
  if (tpFsV) tpFsV.textContent = (tc.fontSize || 48) + 'px'

  // Estilo
  document.getElementById('tp-bold')?.classList.toggle('on',   tc.fontWeight === '700' || tc.fontWeight === '900')
  document.getElementById('tp-italic')?.classList.toggle('on', tc.fontStyle === 'italic')
  document.getElementById('tp-shadow')?.classList.toggle('on', !!tc.shadow)
  document.getElementById('tp-bg')?.classList.toggle('on',     !!tc.bg)

  // Alineación
  ;['l','c','r'].forEach(a => {
    const match = a === 'l' ? 'left' : a === 'r' ? 'right' : 'center'
    document.getElementById(`tp-align-${a}`)?.classList.toggle('on', (tc.align || 'center') === match)
  })

  // Animación
  document.querySelectorAll('.tp-anim-btn').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.anim === tc.animation)
  })

  // Posición
  const tpX = document.getElementById('tp-x')
  const tpY = document.getElementById('tp-y')
  if (tpX) { tpX.value = tc.x; const v = document.getElementById('tp-x-v'); if (v) v.textContent = Math.round(tc.x) + '%' }
  if (tpY) { tpY.value = tc.y; const v = document.getElementById('tp-y-v'); if (v) v.textContent = Math.round(tc.y) + '%' }
}

export function hideTextPanel() {
  // Volver a vista presets
  const viewPresets = document.getElementById('text-view-presets')
  const viewEditor  = document.getElementById('text-view-editor')
  if (viewPresets) viewPresets.style.display = 'flex'
  if (viewEditor)  viewEditor.style.display  = 'none'
}

export function moveTextLayer(id, dir) {
  const idx = S.textClips.findIndex(t => t.id === id)
  if (idx === -1) return
  if (dir === 'up'   && idx < S.textClips.length - 1) {
    ;[S.textClips[idx], S.textClips[idx + 1]] = [S.textClips[idx + 1], S.textClips[idx]]
  } else if (dir === 'down' && idx > 0) {
    ;[S.textClips[idx], S.textClips[idx - 1]] = [S.textClips[idx - 1], S.textClips[idx]]
  }
  renderTextTimeline()
  setStatus(dir === 'up' ? 'Texto al frente' : 'Texto atrás')
}

export function updateTextProp(key, value) {
  const tc = getSelectedTextClip()
  if (!tc) return
  tc[key] = value
  if (key === 'text' || key === 'fontSize') {
    const trackEl = getTextTrackEl()
    const el = trackEl ? trackEl.querySelector(`[data-id="${tc.id}"] .tl-clip-label`) : null
    if (el) el.textContent = `Tt ${tc.text}`
  }
}

// ── Menú contextual ───────────────────────────────────────────────────────────

function showTextContextMenu(x, y, id) {
  document.getElementById('text-ctx-menu')?.remove()
  const menu = document.createElement('div')
  menu.id = 'text-ctx-menu'
  menu.style.cssText = [
    'position:fixed', `left:${x}px`, `top:${y}px`,
    'background:#1e1e1e', 'border:1px solid #3a3a3a', 'border-radius:8px',
    'padding:4px 0', 'min-width:180px', 'z-index:9999',
    'box-shadow:0 4px 24px rgba(0,0,0,0.75)', 'font-size:13px'
  ].join(';')

  ;[
    { icon: '✏️', label: 'Editar texto',   action: () => {
        selectTextClip(id)
        document.getElementById('tp-text')?.focus()
    }},
    { icon: '📋', label: 'Duplicar',       action: () => {
        const tc = S.textClips.find(t => t.id === id)
        if (tc) { const dup = { ...JSON.parse(JSON.stringify(tc)), id: Date.now(), tlStart: tc.tlStart + tc.tlDuration }
          S.textClips.push(dup); renderTextTimeline() }
    }},
    { divider: true },
    { icon: '🗑️', label: 'Eliminar texto', danger: true, action: () => deleteTextClip(id) },
  ].forEach(it => {
    if (it.divider) {
      const sep = document.createElement('div')
      sep.style.cssText = 'height:1px;background:#2a2a2a;margin:4px 0'
      menu.appendChild(sep); return
    }
    const btn = document.createElement('div')
    btn.style.cssText = `padding:8px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;color:${it.danger?'#ff6b6b':'#ddd'};border-radius:4px;margin:0 4px`
    btn.innerHTML = `<span style="font-size:14px;width:18px;text-align:center">${it.icon}</span><span>${it.label}</span>`
    btn.addEventListener('mouseenter', () => btn.style.background = it.danger ? '#3a1a1a' : '#2a2a2a')
    btn.addEventListener('mouseleave', () => btn.style.background = 'transparent')
    btn.addEventListener('click', () => { menu.remove(); it.action() })
    menu.appendChild(btn)
  })

  document.body.appendChild(menu)
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 50)
}

// ── Arrastrar texto en el preview con el ratón ────────────────────────────────

export function initTextDragOnPreview() {
  if (!overlayCanvas) return
  overlayCanvas.style.pointerEvents = 'auto'

  let dragging = null

  overlayCanvas.addEventListener('mousedown', e => {
    const rect = overlayCanvas.getBoundingClientRect()
    const mx   = ((e.clientX - rect.left) / rect.width)  * 100
    const my   = ((e.clientY - rect.top)  / rect.height) * 100

    // Buscar qué texto está bajo el cursor
    const ph = document.getElementById('tl-playhead')
    const t  = ph ? (parseFloat(ph.style.left) || 0) / S.tlZoom : 0

    const hit = S.textClips.find(tc => {
      if (t < tc.tlStart || t > tc.tlStart + tc.tlDuration) return false
      return Math.abs(mx - tc.x) < 15 && Math.abs(my - tc.y) < 8
    })

    if (hit) {
      dragging = { tc: hit, startMX: mx, startMY: my, origX: hit.x, origY: hit.y }
      selectTextClip(hit.id)
      overlayCanvas.style.cursor = 'grabbing'
      e.stopPropagation()
    }
  })

  overlayCanvas.addEventListener('mousemove', e => {
    if (!dragging) return
    const rect = overlayCanvas.getBoundingClientRect()
    const mx   = ((e.clientX - rect.left) / rect.width)  * 100
    const my   = ((e.clientY - rect.top)  / rect.height) * 100
    dragging.tc.x = Math.max(5, Math.min(95, dragging.origX + (mx - dragging.startMX)))
    dragging.tc.y = Math.max(5, Math.min(95, dragging.origY + (my - dragging.startMY)))
    if (document.getElementById('tp-x')) document.getElementById('tp-x').value = Math.round(dragging.tc.x)
    if (document.getElementById('tp-y')) document.getElementById('tp-y').value = Math.round(dragging.tc.y)
  })

  overlayCanvas.addEventListener('mouseup', () => {
    if (dragging) { saveState('mover texto en preview'); dragging = null }
    overlayCanvas.style.cursor = 'default'
  })

  overlayCanvas.addEventListener('mouseleave', () => { dragging = null })
}

// ── Exportar frames de texto para FFmpeg ──────────────────────────────────────
// Genera un video con fondo transparente (RGBA) del texto animado
// para luego overlayearlo sobre el video con FFmpeg.

export async function renderTextToFrames(tc, videoW, videoH, fps = 30) {
  const offscreen = document.createElement('canvas')
  offscreen.width  = videoW
  offscreen.height = videoH
  const ctx = offscreen.getContext('2d')
  const frames = []
  const totalFrames = Math.ceil(tc.tlDuration * fps)

  for (let f = 0; f < totalFrames; f++) {
    ctx.clearRect(0, 0, videoW, videoH)
    const localT = f / fps
    const prog   = localT / tc.tlDuration
    drawTextClip(ctx, tc, localT, prog, videoW, videoH, false)
    frames.push(offscreen.toDataURL('image/png'))
  }
  return frames
}

// ── Generar filtro drawtext para FFmpeg (modo simple, sin animación) ──────────
// Para animaciones complejas se usa el overlay de canvas frames.
// Para clips sin animación o fade simple usamos drawtext directo.

export function buildDrawtextFilter(tc, videoW, videoH, timeOffset = 0) {
  const text     = tc.text.replace(/'/g, "\\'").replace(/:/g, '\\:')
  const fontSize = Math.round((tc.fontSize / 100) * videoH * 0.18)
  const x        = tc.align === 'center' ? `(w-text_w)/2+(${Math.round((tc.x-50)/100*videoW)})` :
                   tc.align === 'left'   ? `${Math.round(tc.x/100*videoW)}` :
                   `w-text_w-${Math.round((100-tc.x)/100*videoW)}`
  const y        = `${Math.round(tc.y / 100 * videoH)}`
  const color    = tc.color?.replace('#', '') || 'ffffff'
  const enable   = `between(t,${tc.tlStart - timeOffset},${tc.tlStart + tc.tlDuration - timeOffset})`

  let filter = `drawtext=text='${text}':x=${x}:y=${y}:fontsize=${fontSize}:fontcolor=0x${color}:enable='${enable}'`
  if (tc.shadow) filter += `:shadowcolor=0x000000AA:shadowx=2:shadowy=2`
  if (tc.bg)     filter += `:box=1:boxcolor=0x00000088:boxborderw=${Math.round(fontSize*0.3)}`

  return filter
}