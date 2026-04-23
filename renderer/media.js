// ── Librería de medios ────────────────────────────────────────────────────────
// Importar archivos, renderizar la lista de medios, cargar en el preview,
// y menú contextual de la librería.

import * as S from './state.js'
import { fmt, isImagePath, defaultClipProps, setStatus } from './utils.js'
import { saveState } from './history.js'
import { loadPropsToUI, updateProgressMarkers } from './effects.js'

// ── Importar archivos ─────────────────────────────────────────────────────────

export async function importFiles() {
  if (!window.api) { alert('API no disponible — revisa preload.js'); return }

  let paths
  try {
    paths = await window.api.openFile()
  } catch (e) {
    setStatus('Error: ' + e)
    return
  }
  if (!paths || paths.length === 0) return

  setStatus('Leyendo metadatos...')
  for (const p of paths) {
    const name = p.split('/').pop().split('\\').pop()
    if (isImagePath(p)) {
      S.mediaItems.push({ path: p, name, duration: 5, isImage: true })
    } else {
      try {
        const meta = await window.api.getMetadata(p)
        const vs   = meta.streams.find(s => s.codec_type === 'video')
        const dur  = parseFloat(meta.format.duration || (vs && vs.duration) || 0)
        S.mediaItems.push({ path: p, name, duration: dur, isImage: false })
      } catch (e) {
        S.mediaItems.push({ path: p, name, duration: 0, isImage: false })
      }
    }
  }
  renderMediaPanel()
  setStatus('Listo — doble clic para agregar al timeline')
}

// ── Renderizar panel de librería ──────────────────────────────────────────────

export function renderMediaPanel() {
  const list    = document.getElementById('media-list')
  const countEl = document.getElementById('media-count')
  list.innerHTML = ''
  if (countEl) countEl.textContent = S.mediaItems.length

  if (!S.mediaItems.length) {
    const hint = document.createElement('div')
    hint.className = 'empty-hint'
    hint.innerHTML = '<div class="empty-icon">🎬</div>Importa archivos con<br>el botón de arriba.<br>Arrastra al timeline<br>o doble clic para agregar.'
    list.appendChild(hint)
    return
  }

  S.mediaItems.forEach((m, i) => {
    const item = document.createElement('div')
    item.className = 'media-item' + (i === S.selectedMediaIndex ? ' active' : '')

    const thumb = document.createElement('div')
    thumb.className  = 'media-thumb'
    thumb.textContent = m.isImage ? '🖼️' : '🎬'

    const info    = document.createElement('div')
    info.className = 'media-info'

    const nameDiv = document.createElement('div')
    nameDiv.className = 'media-name'
    nameDiv.title     = m.name
    nameDiv.textContent = m.name

    const durDiv = document.createElement('div')
    durDiv.className   = 'media-dur'
    durDiv.textContent = m.isImage ? 'imagen' : fmt(m.duration)

    info.appendChild(nameDiv)
    info.appendChild(durDiv)

    const addBtn = document.createElement('button')
    addBtn.className  = 'media-add-btn'
    addBtn.textContent = '+'
    addBtn.title       = 'Agregar al timeline'
    addBtn.addEventListener('click', e => {
      e.stopPropagation()
      selectMedia(i)
      // Importar addToTimeline localmente para evitar circular
      import('./timeline.js').then(tl => tl.addToTimeline())
    })

    item.appendChild(thumb)
    item.appendChild(info)
    item.appendChild(addBtn)

    item.addEventListener('click',   () => selectMedia(i))
    item.addEventListener('dblclick', () => {
      selectMedia(i)
      import('./timeline.js').then(tl => tl.addToTimeline())
    })

    item.addEventListener('mousedown', e => {
      if (e.button !== 0) return
      if (e.target.classList.contains('media-add-btn')) return
      import('./timeline.js').then(tl => tl.startLibraryDrag(e, i))
    })

    item.addEventListener('contextmenu', e => {
      e.preventDefault()
      e.stopPropagation()
      showLibraryContextMenu(e.clientX, e.clientY, i)
    })

    list.appendChild(item)
  })
}

/** Selecciona un ítem de la librería y lo carga en el preview */
export function selectMedia(i) {
  S.setSelectedMediaIndex(i)
  renderMediaPanel()
  const m = S.mediaItems[i]
  loadMedia(m.path, 0)
  if (!m.isImage) {
    S.vid.onloadedmetadata = () => {
      updateTimeDisplay()
      setupTrimSliders(m.duration)
    }
  } else {
    setupTrimSliders(m.duration)
    updateTimeDisplay()
  }
}

// ── Cargar media en el preview ────────────────────────────────────────────────

export function loadMedia(filePath, startAt) {
  let previewImg = document.getElementById('preview-img')

  if (isImagePath(filePath)) {
    S.vid.pause()
    S.vid.src = ''
    S.vid.style.display = 'none'

    if (!previewImg) {
      previewImg = document.createElement('img')
      previewImg.id = 'preview-img'
      previewImg.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;display:block;margin:auto;position:absolute'
      S.vid.parentNode.appendChild(previewImg)
    }
    previewImg.src   = 'file://' + filePath
    previewImg.style.display = 'block'
    document.getElementById('no-video').style.display = 'none'
    updateTimeDisplay()
  } else {
    if (previewImg) previewImg.style.display = 'none'
    S.vid.style.display = 'block'
    S.vid.src = 'file://' + filePath
    document.getElementById('no-video').style.display = 'none'
    S.vid.load()
    S.vid.onloadedmetadata = () => {
      if (startAt > 0) S.vid.currentTime = startAt
      updateTimeDisplay()
    }
  }
}

// Alias para compatibilidad
export const loadVideo = loadMedia

export function setupTrimSliders(dur) {
  const ts = document.getElementById('trim-s')
  const te = document.getElementById('trim-e')
  ts.max = dur; ts.value = 0
  te.max = dur; te.value = dur
  S.setTrimStart(0)
  S.setTrimEnd(dur)
  document.getElementById('trim-s-v').textContent = '0s'
  document.getElementById('trim-e-v').textContent = fmt(dur)
  updateProgressMarkers()
}

export function updateTimeDisplay() {
  document.getElementById('time-display').textContent =
    `${fmt(S.vid.currentTime)} / ${fmt(S.vid.duration || 0)}`
}

// ── Menú contextual de la librería ───────────────────────────────────────────

export function showLibraryContextMenu(x, y, index) {
  removeContextMenu()
  const menu = document.createElement('div')
  menu.id = 'ctx-menu'
  menu.style.cssText = [
    'position:fixed', `left:${x}px`, `top:${y}px`,
    'background:#1e1e1e', 'border:1px solid #3a3a3a', 'border-radius:8px',
    'padding:4px 0', 'min-width:190px', 'z-index:9999',
    'box-shadow:0 4px 24px rgba(0,0,0,0.7)', 'font-size:13px',
    'font-family:system-ui,sans-serif'
  ].join(';')

  const items = [
    { icon: '▶', label: 'Previsualizar',       action: () => selectMedia(index) },
    { icon: '+', label: 'Agregar al timeline',  action: () => { selectMedia(index); import('./timeline.js').then(tl => tl.addToTimeline()) } },
    { divider: true },
    { icon: '✏', label: 'Renombrar',            action: () => renameMediaItem(index) },
    { icon: '⧉', label: 'Duplicar',             action: () => duplicateMediaItem(index) },
    { divider: true },
    { icon: '✕', label: 'Eliminar de librería', action: () => deleteMediaItem(index), danger: true },
  ]

  items.forEach(it => {
    if (it.divider) {
      const sep = document.createElement('div')
      sep.style.cssText = 'height:1px;background:#2a2a2a;margin:4px 0'
      menu.appendChild(sep)
      return
    }
    const btn = document.createElement('div')
    btn.style.cssText = [
      'padding:7px 14px', 'cursor:pointer', 'display:flex', 'align-items:center',
      'gap:10px', `color:${it.danger ? '#ff6b6b' : '#ddd'}`,
      'border-radius:4px', 'margin:0 4px', 'transition:background 0.1s'
    ].join(';')
    const iconSpan  = document.createElement('span')
    iconSpan.style.cssText = 'font-size:13px;width:16px;text-align:center;flex-shrink:0'
    iconSpan.textContent   = it.icon
    const labelSpan = document.createElement('span')
    labelSpan.textContent  = it.label
    btn.appendChild(iconSpan)
    btn.appendChild(labelSpan)
    btn.addEventListener('mouseenter', () => { btn.style.background = it.danger ? '#3a1a1a' : '#2a2a2a' })
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent' })
    btn.addEventListener('click', () => { removeContextMenu(); it.action() })
    menu.appendChild(btn)
  })

  document.body.appendChild(menu)

  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect()
    if (r.right  > window.innerWidth)  menu.style.left = (x - r.width)  + 'px'
    if (r.bottom > window.innerHeight) menu.style.top  = (y - r.height) + 'px'
  })

  setTimeout(() => document.addEventListener('click', removeContextMenu, { once: true }), 50)
}

export function removeContextMenu() {
  const m = document.getElementById('ctx-menu')
  if (m) m.remove()
}

// ── Acciones del menú contextual ──────────────────────────────────────────────

function renameMediaItem(index) {
  const m      = S.mediaItems[index]
  const list   = document.getElementById('media-list')
  const itemEl = list.querySelectorAll('.media-item')[index]
  if (!itemEl) return
  const nameEl = itemEl.querySelector('.media-name')
  if (!nameEl) return
  const oldName = m.name
  const input   = document.createElement('input')
  input.type  = 'text'
  input.value = oldName
  input.style.cssText = [
    'background:#111', 'border:1px solid #4f6ef7', 'border-radius:4px',
    'color:#fff', 'font-size:12px', 'padding:2px 6px', 'width:100%',
    'outline:none', 'font-family:system-ui,sans-serif'
  ].join(';')
  nameEl.replaceWith(input)
  input.focus()
  input.select()
  const confirm = () => {
    m.name = input.value.trim() || oldName
    S.clips.forEach(c => { if (c.path === m.path && c.name === oldName) c.name = m.name })
    renderMediaPanel()
    import('./timeline.js').then(tl => tl.renderTimeline())
    setStatus('Renombrado: ' + m.name)
  }
  input.addEventListener('blur', confirm)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); confirm() }
    if (e.key === 'Escape') { input.value = oldName; confirm() }
  })
}

function duplicateMediaItem(index) {
  const m    = S.mediaItems[index]
  const copy = { ...m, name: m.name.replace(/(\.\w+)$/, '_copia$1') }
  S.mediaItems.splice(index + 1, 0, copy)
  renderMediaPanel()
  setStatus('Duplicado: ' + copy.name)
}

function deleteMediaItem(index) {
  const m         = S.mediaItems[index]
  const clipsAntes = S.clips.length
  S.setClips(S.clips.filter(c => c.path !== m.path))
  S.mediaItems.splice(index, 1)
  if (S.selectedMediaIndex >= S.mediaItems.length)
    S.setSelectedMediaIndex(S.mediaItems.length - 1)
  renderMediaPanel()
  import('./timeline.js').then(tl => tl.renderTimeline())
  const removed = clipsAntes - S.clips.length
  setStatus('Eliminado: ' + m.name + (removed > 0 ? ` (y ${removed} clip(s) del timeline)` : ''))
}
