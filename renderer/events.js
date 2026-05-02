// ── Event listeners ───────────────────────────────────────────────────────────
// Centraliza TODOS los addEventListener del editor.
// Se ejecuta una vez en DOMContentLoaded.

import * as S from './state.js'
import { undo, redo, updateUndoButtons } from './history.js'
import { importFiles, renderMediaPanel, removeContextMenu } from './media.js'
import {
  renderTimeline, addToTimeline, splitClip, deleteClip,
  setTLZoom, seekToTime, tlSeek, getPlayheadTime,
  setPlayheadDragging, isPlayheadDragging
} from './timeline.js'
import {
  updateTrim, updateSpeed, setSpeed, updateAdj,
  updateTransform, toggleFlip, setFilter, applyToAll
} from './effects.js'
import {
  addMarkerAtPlayhead, clearAllMarkers, removeMarker
} from './markers.js'
import { togglePlay, toggleMute, seekClick, initVideoEvents } from './playback.js'
import { startExport } from './export.js'
import { initTracks } from './timeline.js'
import {
  initTextOverlay, startTextRender, initTextDragOnPreview,
  renderTextTimeline, addTextClip, deleteTextClip, selectTextClip,
  getSelectedTextClip, showTextPanel, hideTextPanel, updateTextProp,
  moveTextLayer, TEXT_ANIMATIONS, TEXT_PRESETS
} from './text-clips.js'

export function initEvents() {
  // Iniciar pistas dinámicas primero
  initTracks()

  // Iniciar listeners del elemento de video
  initVideoEvents()

  // ── Atajos de teclado ──────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    const ctrl = e.ctrlKey || e.metaKey
    const tag  = document.activeElement.tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return

    if (ctrl && e.key === 'z' && !e.shiftKey)                     { e.preventDefault(); undo(); return }
    if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return }

    const step = e.shiftKey ? 5 : 1

    switch (e.key) {
      case ' ':
        e.preventDefault(); togglePlay(); break

      case 'ArrowLeft':
        e.preventDefault(); seekToTime(getPlayheadTime() - (step / S.tlZoom * 10)); break
      case 'ArrowRight':
        e.preventDefault(); seekToTime(getPlayheadTime() + (step / S.tlZoom * 10)); break

      case 'ArrowUp':
        e.preventDefault(); setTLZoom(S.tlZoom + 10 * step, getPlayheadTime()); break
      case 'ArrowDown':
        e.preventDefault(); setTLZoom(S.tlZoom - 10 * step, getPlayheadTime()); break

      case 'j': seekToTime(getPlayheadTime() - 1); break
      case 'l': seekToTime(getPlayheadTime() + 1); break
      case 'k': S.vid.paused ? S.vid.play() : S.vid.pause(); break

      case 'Delete':
      case 'Backspace':
        if (S.selectedClip || S.selectedAudioClip) { e.preventDefault(); deleteClip() }
        break
    }
  })

  // ── Rueda del ratón sobre el timeline (zoom) ──────────────────────────────
  document.getElementById('tl-scroll').addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const rect    = document.getElementById('tl-scroll').getBoundingClientRect()
      const mouseX  = e.clientX - rect.left + document.getElementById('tl-scroll').scrollLeft
      const anchorT = mouseX / S.tlZoom
      setTLZoom(S.tlZoom + (e.deltaY < 0 ? 15 : -15), anchorT)
    } else if (e.shiftKey) {
      document.getElementById('tl-scroll').scrollLeft += e.deltaY
      e.preventDefault()
    }
  }, { passive: false })

  // ── Drag del playhead en la regla ─────────────────────────────────────────
  const ruler = document.getElementById('tl-ruler')
  ruler.style.cursor = 'col-resize'

  ruler.addEventListener('mousedown', e => {
    setPlayheadDragging(true)
    tlSeek(e)
    e.stopPropagation()
  })
  document.addEventListener('mousemove', e => {
    if (isPlayheadDragging()) tlSeek(e)
  })
  document.addEventListener('mouseup', () => setPlayheadDragging(false))

  // ── Arrastre del playhead en el área vacía del scroll ─────────────────────
  document.getElementById('tl-scroll').addEventListener('mousedown', e => {
    if (['tl-scroll', 'tl-inner', 'tl-ruler'].includes(e.target.id)) {
      setPlayheadDragging(true)
      tlSeek(e)
    }
  })

  // ── Undo / Redo buttons ───────────────────────────────────────────────────
  const btnUndo = document.getElementById('btn-undo')
  const btnRedo = document.getElementById('btn-redo')
  if (btnUndo) btnUndo.addEventListener('click', undo)
  if (btnRedo) btnRedo.addEventListener('click', redo)
  updateUndoButtons()

  // ── Tabs del rail izquierdo ───────────────────────────────────────────────
  document.querySelectorAll('.rail-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rail-btn').forEach(b => b.classList.remove('active'))
      document.querySelectorAll('.lpanel').forEach(p => (p.style.display = 'none'))
      btn.classList.add('active')
      const panel = document.getElementById('lpanel-' + btn.dataset.panel)
      if (panel) panel.style.display = 'flex'
    })
  })

  // ── Tabs del panel de propiedades ─────────────────────────────────────────
  document.querySelectorAll('.props-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.props-tab').forEach(t => t.classList.remove('active'))
      document.querySelectorAll('.props-body').forEach(b => (b.style.display = 'none'))
      tab.classList.add('active')
      document.getElementById('tab-' + tab.dataset.tab).style.display = 'block'
    })
  })

  // ── Topbar ────────────────────────────────────────────────────────────────
  document.getElementById('btn-import').addEventListener('click', importFiles)
  document.getElementById('btn-add-timeline').addEventListener('click', addToTimeline)
  document.getElementById('btn-split-top').addEventListener('click', splitClip)
  document.getElementById('btn-delete-top').addEventListener('click', deleteClip)
  document.getElementById('btn-export').addEventListener('click', startExport)

  // ── Controles de video ────────────────────────────────────────────────────
  document.getElementById('progress-bar').addEventListener('click', seekClick)
  document.getElementById('btn-rewind').addEventListener('click', () => { S.vid.currentTime = 0 })
  document.getElementById('btn-back1s').addEventListener('click', () => {
    S.vid.currentTime = Math.max(0, S.vid.currentTime - 1)
  })
  document.getElementById('play-btn').addEventListener('click', togglePlay)
  document.getElementById('btn-fwd1s').addEventListener('click', () => {
    S.vid.currentTime = Math.min(S.vid.duration || 0, S.vid.currentTime + 1)
  })
  document.getElementById('mute-btn').addEventListener('click', toggleMute)
  document.getElementById('speed-select').addEventListener('change', e => {
    S.vid.playbackRate = parseFloat(e.target.value)
  })

  // ── Sliders de propiedades ────────────────────────────────────────────────
  document.getElementById('trim-s').addEventListener('input', updateTrim)
  document.getElementById('trim-e').addEventListener('input', updateTrim)
  document.getElementById('speed-sl').addEventListener('input', e => updateSpeed(e.target.value))
  document.getElementById('br-sl').addEventListener('input', updateAdj)
  document.getElementById('ct-sl').addEventListener('input', updateAdj)
  document.getElementById('sat-sl').addEventListener('input', updateAdj)
  document.getElementById('rot-sl').addEventListener('input', updateTransform)
  document.getElementById('zoom-sl').addEventListener('input', updateTransform)
  document.getElementById('tl-zoom-sl').addEventListener('input', e => setTLZoom(e.target.value))

  // ── Botones de velocidad rápida ───────────────────────────────────────────
  document.getElementById('btn-speed-50').addEventListener('click',  () => setSpeed(50))
  document.getElementById('btn-speed-100').addEventListener('click', () => setSpeed(100))
  document.getElementById('btn-speed-200').addEventListener('click', () => setSpeed(200))
  document.getElementById('btn-speed-300').addEventListener('click', () => setSpeed(300))

  // ── Flip ──────────────────────────────────────────────────────────────────
  document.getElementById('flip-h-btn').addEventListener('click', () => toggleFlip('h'))
  document.getElementById('flip-v-btn').addEventListener('click', () => toggleFlip('v'))

  // ── Filtros ───────────────────────────────────────────────────────────────
  document.querySelectorAll('#filter-btns .pbtn').forEach(btn => {
    btn.addEventListener('click', () => setFilter(btn, btn.dataset.filter))
  })

  // ── Aplicar a todos ───────────────────────────────────────────────────────
  document.getElementById('btn-apply-all').addEventListener('click', applyToAll)

  // ── Botones del timeline ──────────────────────────────────────────────────
  document.getElementById('btn-split-tl').addEventListener('click', splitClip)
  document.getElementById('btn-delete-tl').addEventListener('click', deleteClip)

  // ── Marcadores ────────────────────────────────────────────────────────────
  document.getElementById('btn-add-marker').addEventListener('click', () => {
    addMarkerAtPlayhead()
    document.getElementById('btn-clear-markers').style.display =
      S.markers.length > 0 ? '' : 'none'
  })
  document.getElementById('btn-clear-markers').addEventListener('click', () => {
    clearAllMarkers()
    document.getElementById('btn-clear-markers').style.display = 'none'
  })

  // Clic derecho en la regla → agregar/quitar marcador
  document.getElementById('tl-ruler').addEventListener('contextmenu', e => {
    e.preventDefault()
    const scrollEl = document.getElementById('tl-scroll')
    const rect     = document.getElementById('tl-ruler').getBoundingClientRect()
    const x        = e.clientX - rect.left + scrollEl.scrollLeft
    const t        = Math.max(0.1, x / S.tlZoom)
    const nearby   = S.markers.find(m => Math.abs(m.time - t) < 0.2)
    if (nearby) {
      removeMarker(nearby.id)
      document.getElementById('btn-clear-markers').style.display =
        S.markers.length > 0 ? '' : 'none'
    } else {
      S.markers.push({ id: Date.now(), time: t })
      S.markers.sort((a, b) => a.time - b.time)
      import('./markers.js').then(M => M.renderMarkers())
      document.getElementById('btn-clear-markers').style.display = ''
      import('./utils.js').then(U => U.setStatus(`Marcador agregado en ${import('./utils.js').then(U2 => U2.fmt(t))} (clic derecho para quitar)`))
    }
  })

  // ── Menú contextual en área vacía de la librería ──────────────────────────
  const mediaList = document.getElementById('media-list')
  if (mediaList) {
    mediaList.addEventListener('contextmenu', e => {
      if (e.target.closest('.media-item')) return
      e.preventDefault()
      removeContextMenu()

      const menu = document.createElement('div')
      menu.id = 'ctx-menu'
      menu.style.cssText = [
        'position:fixed', `left:${e.clientX}px`, `top:${e.clientY}px`,
        'background:#1e1e1e', 'border:1px solid #3a3a3a', 'border-radius:8px',
        'padding:4px 0', 'min-width:190px', 'z-index:9999',
        'box-shadow:0 4px 24px rgba(0,0,0,0.7)', 'font-size:13px'
      ].join(';')

      const generalItems = [
        { icon: '📁', label: 'Importar archivos', action: importFiles },
        { icon: '🗂️', label: 'Nueva carpeta', action: () => {
          import('./media.js').then(M => M.createFolder('Nueva carpeta'))
        }},
        { divider: true },
        { icon: '✕', label: 'Limpiar librería', danger: true, action: () => {
          if (confirm('¿Eliminar todos los archivos de la librería?')) {
            S.setMediaItems([])
            S.setClips([])
            S.setFolders([])
            S.setCurrentFolderId(null)
            S.setFolderStack([])
            S.setSelectedMediaIndex(-1)
            renderMediaPanel()
            renderTimeline()
            import('./utils.js').then(U => U.setStatus('Librería limpiada'))
          }
        }}
      ]

      generalItems.forEach(it => {
        if (it.divider) {
          const sep = document.createElement('div')
          sep.style.cssText = 'height:1px;background:#2a2a2a;margin:4px 0'
          menu.appendChild(sep); return
        }
        const btn = document.createElement('div')
        btn.style.cssText = `padding:7px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;color:${it.danger ? '#ff6b6b' : '#ddd'};border-radius:4px;margin:0 4px`
        btn.innerHTML = `<span style="font-size:13px;width:16px;text-align:center">${it.icon}</span><span>${it.label}</span>`
        btn.addEventListener('mouseenter', () => { btn.style.background = it.danger ? '#3a1a1a' : '#2a2a2a' })
        btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent' })
        btn.addEventListener('click', () => { removeContextMenu(); it.action() })
        menu.appendChild(btn)
      })

      document.body.appendChild(menu)
      setTimeout(() => document.addEventListener('click', removeContextMenu, { once: true }), 50)
    })
  }

  // ── Sistema de texto animado ───────────────────────────────────────────────
  initTextOverlay()
  startTextRender()
  initTextDragOnPreview()

  // Poblar presets
  const presetsGrid = document.getElementById('text-presets-grid')
  if (presetsGrid) {
    TEXT_PRESETS.forEach(preset => {
      const btn = document.createElement('button')
      btn.className = 'text-preset-btn'

      const preview = document.createElement('div')
      preview.className = 'text-preset-preview'
      preview.textContent = preset.label
      preview.style.cssText = [
        `font-size:${Math.round(preset.fontSize / 3.5)}px`,
        `font-weight:${preset.fontWeight}`,
        `color:${preset.color}`,
        preset.id === 'neon'    ? `text-shadow:0 0 8px ${preset.color}` : '',
        preset.id === 'caption' ? 'background:rgba(0,0,0,0.55);padding:2px 6px;border-radius:3px' : '',
        preset.id === 'glitch'  ? `text-shadow:2px 0 #ff0044,-2px 0 #00ffcc` : '',
      ].filter(Boolean).join(';')

      const label = document.createElement('div')
      label.style.cssText = 'font-size:9px;color:var(--text-3);margin-top:3px'
      label.textContent   = TEXT_ANIMATIONS[preset.animation]?.label || preset.animation

      btn.appendChild(preview)
      btn.appendChild(label)
      btn.addEventListener('click', () => addTextClip(preset))
      presetsGrid.appendChild(btn)
    })
  }

  // Poblar animaciones
  const animGrid = document.getElementById('text-anim-grid')
  if (animGrid) {
    Object.entries(TEXT_ANIMATIONS).forEach(([key, val]) => {
      const btn = document.createElement('button')
      btn.className = 'tp-anim-btn'
      btn.dataset.anim = key
      btn.title = val.label
      btn.innerHTML = `<div style="font-size:14px">${val.icon}</div><div>${val.label}</div>`
      btn.addEventListener('click', () => {
        updateTextProp('animation', key)
        document.querySelectorAll('.tp-anim-btn').forEach(b => b.classList.toggle('on', b.dataset.anim === key))
      })
      animGrid.appendChild(btn)
    })
  }

  // Botón volver a presets
  document.getElementById('tp-back')?.addEventListener('click', () => {
    hideTextPanel()
  })

  // Textarea del texto
  document.getElementById('tp-text')?.addEventListener('input', e => {
    updateTextProp('text', e.target.value)
    const label = document.getElementById('tp-title-label')
    if (label) label.textContent = `"${e.target.value.slice(0, 18)}${e.target.value.length > 18 ? '…' : ''}"`
  })

  // Color
  document.getElementById('tp-color')?.addEventListener('input', e => updateTextProp('color', e.target.value))

  // Tamaño de fuente
  document.getElementById('tp-fontsize')?.addEventListener('input', e => {
    const v = parseInt(e.target.value)
    document.getElementById('tp-fontsize-v').textContent = v + 'px'
    updateTextProp('fontSize', v)
  })

  // Posición X e Y con labels
  document.getElementById('tp-x')?.addEventListener('input', e => {
    const v = parseInt(e.target.value)
    const lbl = document.getElementById('tp-x-v'); if (lbl) lbl.textContent = v + '%'
    updateTextProp('x', v)
  })
  document.getElementById('tp-y')?.addEventListener('input', e => {
    const v = parseInt(e.target.value)
    const lbl = document.getElementById('tp-y-v'); if (lbl) lbl.textContent = v + '%'
    updateTextProp('y', v)
  })

  // Negrita
  document.getElementById('tp-bold')?.addEventListener('click', () => {
    const btn = document.getElementById('tp-bold')
    btn.classList.toggle('on')
    updateTextProp('fontWeight', btn.classList.contains('on') ? '700' : '400')
  })

  // Cursiva
  document.getElementById('tp-italic')?.addEventListener('click', () => {
    const btn = document.getElementById('tp-italic')
    btn.classList.toggle('on')
    updateTextProp('fontStyle', btn.classList.contains('on') ? 'italic' : 'normal')
  })

  // Sombra
  document.getElementById('tp-shadow')?.addEventListener('click', () => {
    const btn = document.getElementById('tp-shadow')
    btn.classList.toggle('on')
    updateTextProp('shadow', btn.classList.contains('on'))
  })

  // Fondo
  document.getElementById('tp-bg')?.addEventListener('click', () => {
    const btn = document.getElementById('tp-bg')
    btn.classList.toggle('on')
    updateTextProp('bg', btn.classList.contains('on') ? 'rgba(0,0,0,0.6)' : '')
  })

  // Alineación
  ;['l','c','r'].forEach(a => {
    document.getElementById(`tp-align-${a}`)?.addEventListener('click', () => {
      ;['l','c','r'].forEach(x => document.getElementById(`tp-align-${x}`)?.classList.remove('on'))
      document.getElementById(`tp-align-${a}`)?.classList.add('on')
      updateTextProp('align', a === 'c' ? 'center' : a === 'l' ? 'left' : 'right')
    })
  })

  // Capas
  document.getElementById('tp-layer-up')?.addEventListener('click', () => {
    const tc = getSelectedTextClip(); if (tc) moveTextLayer(tc.id, 'up')
  })
  document.getElementById('tp-layer-down')?.addEventListener('click', () => {
    const tc = getSelectedTextClip(); if (tc) moveTextLayer(tc.id, 'down')
  })

  // Eliminar texto
  document.getElementById('tp-delete')?.addEventListener('click', () => {
    const tc = getSelectedTextClip(); if (tc) deleteTextClip(tc.id)
  })
}