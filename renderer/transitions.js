// ── Sistema de Transiciones ───────────────────────────────────────────────────
// Maneja el panel de selección, la aplicación y la animación de transiciones
// entre clips adyacentes en el timeline.

import * as S from './state.js'
import { setStatus } from './utils.js'

// ── Catálogo de transiciones disponibles ─────────────────────────────────────
export const TRANSITION_CATEGORIES = {
  'Básico': [
    { id: 'fade',      name: 'Fade',   icon: '◼' },
    { id: 'fadeblack', name: 'Negro',  icon: '⬛' },
    { id: 'fadewhite', name: 'Blanco', icon: '⬜' },
    { id: 'flash',     name: 'Flash',  icon: '⚡' },
  ],
  'Movimiento': [
    { id: 'slideleft',  name: 'Slide ←', icon: '←' },
    { id: 'slideright', name: 'Slide →', icon: '→' },
    { id: 'slideup',    name: 'Slide ↑', icon: '↑' },
    { id: 'slidedown',  name: 'Slide ↓', icon: '↓' },
    { id: 'wipeleft',   name: 'Wipe ←',  icon: '⬅' },
    { id: 'wiperight',  name: 'Wipe →',  icon: '➡' },
    { id: 'wipeup',     name: 'Wipe ↑',  icon: '⬆' },
    { id: 'wipedown',   name: 'Wipe ↓',  icon: '⬇' },
  ],
  'Zoom': [
    { id: 'zoomin',    name: 'Zoom In',   icon: '🔍' },
    { id: 'zoomout',   name: 'Zoom Out',  icon: '🔎' },
    { id: 'zoomfade',  name: 'Zoom Fade', icon: '💫' },
  ],
  'Distorsión': [
    { id: 'blur',     name: 'Blur',     icon: '🌫' },
    { id: 'glitch',   name: 'Glitch',   icon: '📺' },
    { id: 'pixelize', name: 'Pixelize', icon: '🟦' },
    { id: 'spin',     name: 'Spin',     icon: '🌀' },
  ],
  'Luz': [
    { id: 'dissolve',   name: 'Disolver', icon: '✨' },
    { id: 'radial',     name: 'Radial',   icon: '☀' },
    { id: 'circlecrop', name: 'Círculo',  icon: '⭕' },
  ],
}

// ── Panel de transiciones ─────────────────────────────────────────────────────

/** Abre el panel de transiciones y lo posiciona en el clip indicado */
export function openTransitionPanel(clipId) {
  S.setPanelSelectedTransitionClipId(clipId)

  document.querySelectorAll('.rail-btn').forEach(b => b.classList.remove('active'))
  document.querySelectorAll('.lpanel').forEach(p => (p.style.display = 'none'))

  const railBtn = document.querySelector('.rail-btn[data-panel="transitions"]')
  if (railBtn) railBtn.classList.add('active')

  renderTransitionsPanel(clipId)

  const panel = document.getElementById('lpanel-transitions')
  if (panel) panel.style.display = 'flex'
}

/** Renderiza el contenido del panel de transiciones */
export function renderTransitionsPanel(clipId) {
  const panel = document.getElementById('lpanel-transitions')
  if (!panel) return

  const current = S.transitions[clipId] || null

  let html = `
    <div class="panel-header" style="flex-shrink:0">
      <span class="panel-title">Transiciones</span>
      ${current
        ? `<button id="btn-remove-transition" style="background:var(--red-dim);border:1px solid var(--red);color:var(--red);font-size:10px;padding:2px 8px;border-radius:4px;cursor:pointer;font-family:inherit">✕ Quitar</button>`
        : ''}
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

  // Eventos del panel
  panel.querySelectorAll('.tr-item').forEach(el => {
    el.addEventListener('mouseenter', () => {
      if (!el.classList.contains('tr-active')) el.style.background = 'var(--bg-4)'
    })
    el.addEventListener('mouseleave', () => {
      if (!el.classList.contains('tr-active')) el.style.background = 'var(--bg-3)'
    })
    el.addEventListener('click', () => {
      const trType = el.dataset.tr
      const cId    = parseInt(el.dataset.clip)
      const dur    = S.transitions[cId] ? S.transitions[cId].duration : 0.5
      applyTransition(cId, trType, dur)
    })
  })

  const durSlider = panel.querySelector('#tr-duration-sl')
  if (durSlider) {
    durSlider.addEventListener('input', e => {
      const dur = parseInt(e.target.value) / 10
      if (S.transitions[clipId]) {
        S.transitions[clipId].duration = dur
        const mono = panel.querySelector('span[style*="monospace"]')
        if (mono) mono.textContent = dur.toFixed(1) + 's'
      }
    })
  }

  const removeBtn = panel.querySelector('#btn-remove-transition')
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      delete S.transitions[clipId]
      S.setPanelSelectedTransitionClipId(null)
      // Necesita renderTimeline → se importa al vuelo para evitar circular
      import('./timeline.js').then(tl => tl.renderTimeline())
      renderTransitionsPanel(clipId)
      setStatus('Transición eliminada')
    })
  }
}

/** Aplica una transición a un clip */
export function applyTransition(clipId, type, duration) {
  S.transitions[clipId] = { type, duration: duration || 0.5 }
  import('./timeline.js').then(tl => tl.renderTimeline())
  renderTransitionsPanel(clipId)
  setStatus(`Transición "${type}" aplicada ✓`)
}

// ── Animación de transición en el preview ─────────────────────────────────────

/** Limpia cualquier animación de transición en curso */
function clearTransitionAnim() {
  if (S.activeTransitionAnim) {
    clearInterval(S.activeTransitionAnim)
    S.setActiveTransitionAnim(null)
    S.vid.style.opacity   = '1'
    S.vid.style.transform = S.vid.style.transform
      .replace(/translate[XY]?\([^)]+\)/g, '').trim() || ''
    S.vid.style.filter = S.vid.style.filter
      .replace(/blur\([^)]+\)/g, '').trim() || ''
  }
}

/** Reproduce la animación de una transición en el elemento de video */
export function playTransition(type, duration, onDone) {
  clearTransitionAnim()

  const ms     = (duration || 0.5) * 1000
  const frames = Math.max(15, Math.round(ms / 16))
  let frame    = 0

  const anim = setInterval(() => {
    frame++
    const p    = frame / frames          // 0 → 1
    const ease = 1 - Math.pow(1 - p, 3) // ease-out cúbico

    applyTransitionFrame(type, p, ease)

    if (frame >= frames) {
      clearInterval(anim)
      S.setActiveTransitionAnim(null)
      cleanTransitionStyles()
      onDone && onDone()
    }
  }, 16)

  S.setActiveTransitionAnim(anim)
}

/** Aplica un frame de la animación de transición al elemento de video */
function applyTransitionFrame(type, p, ease) {
  const v = S.vid
  switch (type) {
    case 'fade':
      v.style.opacity = p.toString()
      break
    case 'fadeblack':
      v.style.opacity = p < 0.5 ? (p * 2).toString() : '1'
      if (p < 0.5) setFilter(v, `brightness(${p * 2})`)
      break
    case 'fadewhite':
      v.style.opacity = p.toString()
      setFilter(v, `brightness(${2 - ease})`)
      break
    case 'flash':
      v.style.opacity = p < 0.3 ? '0' : p.toString()
      break
    case 'slideleft':
      setTranslateX(v, (1 - ease) * -100)
      v.style.opacity = p.toString()
      break
    case 'slideright':
      setTranslateX(v, (1 - ease) * 100)
      v.style.opacity = p.toString()
      break
    case 'slideup':
      setTranslateY(v, (1 - ease) * -100)
      v.style.opacity = p.toString()
      break
    case 'slidedown':
      setTranslateY(v, (1 - ease) * 100)
      v.style.opacity = p.toString()
      break
    case 'wipeleft': case 'wiperight': case 'wipeup': case 'wipedown':
      v.style.opacity = ease.toString()
      break
    case 'zoomin':
      setScale(v, 0.7 + ease * 0.3)
      v.style.opacity = p.toString()
      break
    case 'zoomout':
      setScale(v, 1.4 - ease * 0.4)
      v.style.opacity = p.toString()
      break
    case 'zoomfade':
      setScale(v, 0.85 + ease * 0.15)
      v.style.opacity = p.toString()
      break
    case 'blur':
      setFilter(v, `blur(${(1 - ease) * 20}px)`)
      v.style.opacity = p.toString()
      break
    case 'glitch':
      if (frame % 3 === 0) {
        setTranslateX(v, (Math.random() - 0.5) * 20 * (1 - ease))
        setFilter(v, `hue-rotate(${Math.random() * 360 * (1 - ease)}deg)`)
      }
      v.style.opacity = p.toString()
      break
    case 'pixelize':
      v.style.opacity = p.toString()
      break
    case 'spin':
      setRotate(v, (1 - ease) * 180)
      v.style.opacity = p.toString()
      break
    case 'dissolve': case 'radial': case 'circlecrop':
      v.style.opacity = ease.toString()
      break
    default:
      v.style.opacity = p.toString()
  }
}

// Helpers para manipular transform sin pisar otros valores
function setTranslateX(el, px) {
  el.style.transform = (el.style.transform || '')
    .replace(/translateX\([^)]+\)/g, '').trim()
  el.style.transform = `translateX(${px}%) ` + el.style.transform
}
function setTranslateY(el, py) {
  el.style.transform = (el.style.transform || '')
    .replace(/translateY\([^)]+\)/g, '').trim()
  el.style.transform = `translateY(${py}%) ` + el.style.transform
}
function setScale(el, s) {
  el.style.transform = (el.style.transform || '')
    .replace(/scale\([^)]+\)/g, '').trim()
  el.style.transform = `scale(${s}) ` + el.style.transform
}
function setRotate(el, deg) {
  el.style.transform = (el.style.transform || '')
    .replace(/rotate\([^)]+\)/g, '').trim()
  el.style.transform = `rotate(${deg}deg) ` + el.style.transform
}
function setFilter(el, f) {
  // Reemplaza solo el tipo de filtro en cuestión
  const key = f.split('(')[0]
  el.style.filter = (el.style.filter || '')
    .replace(new RegExp(`${key}\\([^)]+\\)`), '').trim()
  el.style.filter = f + ' ' + el.style.filter
}
function cleanTransitionStyles() {
  const v = S.vid
  v.style.opacity   = '1'
  v.style.transform = (v.style.transform || '')
    .replace(/translateX\([^)]+\)/g, '')
    .replace(/translateY\([^)]+\)/g, '')
    .replace(/scale\([^)]+\)/g, '')
    .replace(/rotate\([^)]+\)/g, '')
    .trim()
  v.style.filter = (v.style.filter || '')
    .replace(/blur\([^)]+\)/g, '')
    .replace(/brightness\([^)]+\)/g, '')
    .replace(/hue-rotate\([^)]+\)/g, '')
    .trim()
}
