// ── Librería de medios ────────────────────────────────────────────────────────
// Importar archivos, carpetas, renderizar la lista de medios, cargar preview,
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
    const folderId = S.currentFolderId || null
    if (isImagePath(p)) {
      S.mediaItems.push({ path: p, name, duration: 5, isImage: true, folderId })
    } else {
      try {
        const meta = await window.api.getMetadata(p)
        const vs   = meta.streams.find(s => s.codec_type === 'video')
        const dur  = parseFloat(meta.format.duration || (vs && vs.duration) || 0)
        S.mediaItems.push({ path: p, name, duration: dur, isImage: false, folderId })
      } catch (e) {
        S.mediaItems.push({ path: p, name, duration: 0, isImage: false, folderId })
      }
    }
  }
  renderMediaPanel()
  setStatus('Listo — doble clic para agregar al timeline')
}

// ── Gestión de carpetas ───────────────────────────────────────────────────────

export function createFolder(name) {
  // La subcarpeta se crea DENTRO de la carpeta actual (o en raíz si no hay ninguna)
  const folder = {
    id:       Date.now(),
    name:     name || 'Nueva carpeta',
    parentId: S.currentFolderId || null   // ← clave para subcarpetas
  }
  S.folders.push(folder)
  renderMediaPanel()
  setTimeout(() => renameFolder(folder.id), 50)
  return folder
}

export function renameFolder(folderId) {
  const folder = S.folders.find(f => f.id === folderId)
  if (!folder) return
  const el = document.querySelector(`.folder-item[data-folder-id="${folderId}"] .folder-name`)
  if (!el) return
  const old = folder.name
  const input = document.createElement('input')
  input.type  = 'text'
  input.value = old
  input.style.cssText = 'background:#111;border:1px solid #4f6ef7;border-radius:4px;color:#fff;font-size:12px;padding:1px 5px;width:100%;outline:none;font-family:system-ui,sans-serif'
  el.replaceWith(input)
  input.focus(); input.select()
  const confirm = () => {
    folder.name = input.value.trim() || old
    renderMediaPanel()
    setStatus('Carpeta: ' + folder.name)
  }
  input.addEventListener('blur', confirm)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); confirm() }
    if (e.key === 'Escape') { input.value = old; confirm() }
  })
}

export function deleteFolder(folderId) {
  const folder = S.folders.find(f => f.id === folderId)
  if (!folder) return

  // Recopilar recursivamente todos los IDs de esta carpeta y subcarpetas
  function collectIds(pid) {
    const ids = [pid]
    S.folders.filter(f => f.parentId === pid).forEach(f => ids.push(...collectIds(f.id)))
    return ids
  }
  const allIds = collectIds(folderId)
  const count  = S.mediaItems.filter(m => allIds.includes(m.folderId)).length

  const msg = count > 0
    ? `¿Eliminar "${folder.name}" y ${count} archivo(s) dentro?`
    : `¿Eliminar carpeta "${folder.name}"?`
  if (!confirm(msg)) return

  // Mover archivos a raíz y borrar carpetas
  S.mediaItems.forEach(m => { if (allIds.includes(m.folderId)) m.folderId = null })
  S.setFolders(S.folders.filter(f => !allIds.includes(f.id)))

  // Si estábamos dentro de la carpeta borrada, subir al padre
  if (allIds.includes(S.currentFolderId)) {
    S.setCurrentFolderId(folder.parentId || null)
    S.setFolderStack(S.folderStack.filter(f => !allIds.includes(f.id)))
  }
  renderMediaPanel()
  setStatus(`Carpeta "${folder.name}" eliminada`)
}

export function enterFolder(folderId) {
  const folder = S.folders.find(f => f.id === folderId)
  if (!folder) return
  S.setFolderStack([...S.folderStack, { id: folderId, name: folder.name }])
  S.setCurrentFolderId(folderId)
  renderMediaPanel()
}

export function goToStack(index) {
  // Navegar a un nivel específico del breadcrumb
  if (index < 0) {
    // Ir a raíz
    S.setFolderStack([])
    S.setCurrentFolderId(null)
  } else {
    const target = S.folderStack[index]
    S.setFolderStack(S.folderStack.slice(0, index + 1))
    S.setCurrentFolderId(target.id)
  }
  renderMediaPanel()
}

export function exitFolder() {
  if (S.folderStack.length <= 1) {
    S.setFolderStack([])
    S.setCurrentFolderId(null)
  } else {
    const newStack = S.folderStack.slice(0, -1)
    S.setFolderStack(newStack)
    S.setCurrentFolderId(newStack[newStack.length - 1].id)
  }
  renderMediaPanel()
}

// ── Renderizar panel de librería ──────────────────────────────────────────────

export function renderMediaPanel() {
  const list    = document.getElementById('media-list')
  const countEl = document.getElementById('media-count')
  list.innerHTML = ''

  const inFolder = S.currentFolderId !== null
  const currentFolder = inFolder ? S.folders.find(f => f.id === S.currentFolderId) : null

  // Carpetas hijas de la ubicación actual
  const childFolders = S.folders.filter(f => (f.parentId || null) === (S.currentFolderId || null))
  // Archivos en la ubicación actual
  const currentItems = S.mediaItems.map((m, i) => ({ m, i }))
    .filter(({ m }) => (m.folderId || null) === (S.currentFolderId || null))

  if (countEl) countEl.textContent = childFolders.length + currentItems.length

  // ── Breadcrumb multinivel ─────────────────────────────────────────────────
  if (S.folderStack.length > 0) {
    const bc = document.createElement('div')
    bc.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:2px;padding:5px 8px;background:var(--bg-2);border-bottom:1px solid var(--border);flex-shrink:0;font-size:10px'

    // Raíz siempre clickeable
    const rootBtn = document.createElement('span')
    rootBtn.textContent = '🏠 Librería'
    rootBtn.style.cssText = 'cursor:pointer;color:var(--text-3);padding:2px 4px;border-radius:3px;transition:color 0.12s'
    rootBtn.addEventListener('click', () => goToStack(-1))
    rootBtn.addEventListener('mouseenter', () => { rootBtn.style.color = 'var(--accent)' })
    rootBtn.addEventListener('mouseleave', () => { rootBtn.style.color = 'var(--text-3)' })
    bc.appendChild(rootBtn)

    // Cada nivel del stack
    S.folderStack.forEach((f, idx) => {
      const sep = document.createElement('span')
      sep.textContent = ' ›'
      sep.style.color = 'var(--text-3)'
      bc.appendChild(sep)

      const isLast = idx === S.folderStack.length - 1
      const btn = document.createElement('span')
      btn.textContent = `📁 ${f.name}`
      btn.style.cssText = `cursor:${isLast ? 'default' : 'pointer'};color:${isLast ? 'var(--accent)' : 'var(--text-3)'};font-weight:${isLast ? '600' : '400'};padding:2px 4px;border-radius:3px;transition:color 0.12s`
      if (!isLast) {
        btn.addEventListener('click', () => goToStack(idx))
        btn.addEventListener('mouseenter', () => { btn.style.color = 'var(--accent)' })
        btn.addEventListener('mouseleave', () => { btn.style.color = 'var(--text-3)' })
      }
      bc.appendChild(btn)
    })

    list.appendChild(bc)
  }

  // ── Contenido vacío ───────────────────────────────────────────────────────
  if (childFolders.length === 0 && currentItems.length === 0) {
    const hint = document.createElement('div')
    hint.className = 'empty-hint'
    hint.innerHTML = inFolder
      ? '<div class="empty-icon">📁</div>Carpeta vacía.<br>Clic derecho para<br>importar o crear subcarpeta.'
      : '<div class="empty-icon">🎬</div>Importa archivos con<br>el botón de arriba.<br>Arrastra al timeline<br>o doble clic para agregar.'
    list.appendChild(hint)
    return
  }

  // ── Subcarpetas ───────────────────────────────────────────────────────────
  childFolders.forEach(f => {
    const countF = S.mediaItems.filter(m => m.folderId === f.id).length
    const countSub = S.folders.filter(sf => sf.parentId === f.id).length
    const total = countF + countSub
    const item  = document.createElement('div')
    item.className = 'folder-item media-item'
    item.dataset.folderId = f.id
    item.style.cssText = 'display:flex;align-items:center;gap:9px;padding:9px 10px;background:var(--bg-2);border-radius:var(--radius-md);margin-bottom:3px;cursor:pointer;border:1.5px solid transparent;transition:all 0.12s'
    item.innerHTML = `
      <div class="media-thumb" style="font-size:18px;display:flex;align-items:center;justify-content:center">📁</div>
      <div class="media-info" style="flex:1;min-width:0">
        <div class="folder-name media-name" style="font-size:12px;color:var(--text-1);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.name}</div>
        <div class="media-dur">${total} elemento${total !== 1 ? 's' : ''}</div>
      </div>
      <button class="media-add-btn" title="Abrir" style="font-size:11px">→</button>
    `
    item.addEventListener('click',    () => enterFolder(f.id))
    item.addEventListener('dblclick', () => enterFolder(f.id))
    item.querySelector('.media-add-btn').addEventListener('click', e => { e.stopPropagation(); enterFolder(f.id) })
    item.addEventListener('mouseenter', () => { item.style.borderColor = 'var(--border-light)'; item.style.background = 'var(--bg-3)' })
    item.addEventListener('mouseleave', () => { item.style.borderColor = 'transparent'; item.style.background = 'var(--bg-2)' })
    item.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); showFolderContextMenu(e.clientX, e.clientY, f.id) })
    list.appendChild(item)
  })

  // ── Archivos ──────────────────────────────────────────────────────────────
  currentItems.forEach(({ m, i }) => renderMediaItem(list, m, i))
}

function renderMediaItem(list, m, i) {
  const item = document.createElement('div')
  item.className = 'media-item' + (i === S.selectedMediaIndex ? ' active' : '')

  const thumb = document.createElement('div')
  thumb.className   = 'media-thumb'
  thumb.textContent = m.isImage ? '🖼️' : '🎬'

  const info    = document.createElement('div')
  info.className = 'media-info'

  const nameDiv = document.createElement('div')
  nameDiv.className   = 'media-name'
  nameDiv.title       = m.name
  nameDiv.textContent = m.name

  const durDiv = document.createElement('div')
  durDiv.className   = 'media-dur'
  durDiv.textContent = m.isImage ? 'imagen' : fmt(m.duration)

  info.appendChild(nameDiv)
  info.appendChild(durDiv)

  const addBtn = document.createElement('button')
  addBtn.className   = 'media-add-btn'
  addBtn.textContent = '+'
  addBtn.title       = 'Agregar al timeline'
  addBtn.addEventListener('click', e => {
    e.stopPropagation()
    selectMedia(i)
    import('./timeline.js').then(tl => tl.addToTimeline())
  })

  item.appendChild(thumb)
  item.appendChild(info)
  item.appendChild(addBtn)

  item.addEventListener('click',    () => selectMedia(i))
  item.addEventListener('dblclick', () => { selectMedia(i); import('./timeline.js').then(tl => tl.addToTimeline()) })
  item.addEventListener('mousedown', e => {
    if (e.button !== 0) return
    if (e.target.classList.contains('media-add-btn')) return
    import('./timeline.js').then(tl => tl.startLibraryDrag(e, i))
  })
  item.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); showLibraryContextMenu(e.clientX, e.clientY, i) })

  list.appendChild(item)
}

export function selectMedia(i) {
  S.setSelectedMediaIndex(i)
  renderMediaPanel()
  const m = S.mediaItems[i]
  loadMedia(m.path, 0)
  if (!m.isImage) {
    S.vid.onloadedmetadata = () => { updateTimeDisplay(); setupTrimSliders(m.duration) }
  } else {
    setupTrimSliders(m.duration)
    updateTimeDisplay()
  }
}

// ── Cargar media en el preview ────────────────────────────────────────────────

export function loadMedia(filePath, startAt) {
  let previewImg = document.getElementById('preview-img')
  if (isImagePath(filePath)) {
    S.vid.pause(); S.vid.src = ''; S.vid.style.display = 'none'
    if (!previewImg) {
      previewImg = document.createElement('img')
      previewImg.id = 'preview-img'
      previewImg.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;display:block;margin:auto;position:absolute'
      S.vid.parentNode.appendChild(previewImg)
    }
    previewImg.src = 'file://' + filePath
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

export const loadVideo = loadMedia

export function setupTrimSliders(dur) {
  const ts = document.getElementById('trim-s')
  const te = document.getElementById('trim-e')
  ts.max = dur; ts.value = 0
  te.max = dur; te.value = dur
  S.setTrimStart(0); S.setTrimEnd(dur)
  document.getElementById('trim-s-v').textContent = '0s'
  document.getElementById('trim-e-v').textContent = fmt(dur)
  updateProgressMarkers()
}

export function updateTimeDisplay() {
  document.getElementById('time-display').textContent =
    `${fmt(S.vid.currentTime)} / ${fmt(S.vid.duration || 0)}`
}

// ── Menú contextual de CARPETA ────────────────────────────────────────────────

function showFolderContextMenu(x, y, folderId) {
  buildContextMenu(x, y, [
    { icon: '📂', label: 'Abrir carpeta', action: () => enterFolder(folderId) },
    { icon: '✏',  label: 'Renombrar',    action: () => renameFolder(folderId) },
    { divider: true },
    { icon: '✕',  label: 'Eliminar carpeta', action: () => deleteFolder(folderId), danger: true },
  ])
}

// ── Menú contextual de ARCHIVO ────────────────────────────────────────────────

export function showLibraryContextMenu(x, y, index) {
  const m = S.mediaItems[index]
  const moveItems = S.folders
    .filter(f => f.id !== m.folderId)
    .map(f => ({
      icon: '📁', label: f.name,
      action: () => { m.folderId = f.id; renderMediaPanel(); setStatus(`Movido a "${f.name}"`) }
    }))

  if (m.folderId) {
    moveItems.unshift({
      icon: '🏠', label: 'Sacar a raíz',
      action: () => { m.folderId = null; renderMediaPanel(); setStatus('Movido a librería raíz') }
    })
  }

  buildContextMenu(x, y, [
    { icon: '▶', label: 'Previsualizar',       action: () => selectMedia(index) },
    { icon: '+', label: 'Agregar al timeline',  action: () => { selectMedia(index); import('./timeline.js').then(tl => tl.addToTimeline()) } },
    { divider: true },
    { icon: '✏', label: 'Renombrar',            action: () => renameMediaItem(index) },
    { icon: '⧉', label: 'Duplicar',             action: () => duplicateMediaItem(index) },
    ...(moveItems.length > 0 ? [{ divider: true }, { icon: '📁', label: 'Mover a carpeta ›', submenu: moveItems }] : []),
    { divider: true },
    { icon: '✕', label: 'Eliminar de librería', action: () => deleteMediaItem(index), danger: true },
  ])
}

function buildContextMenu(x, y, items) {
  removeContextMenu()
  const menu = document.createElement('div')
  menu.id = 'ctx-menu'
  menu.style.cssText = 'position:fixed;background:#1e1e1e;border:1px solid #3a3a3a;border-radius:8px;padding:4px 0;min-width:200px;z-index:9999;box-shadow:0 4px 24px rgba(0,0,0,0.7);font-size:13px;font-family:system-ui,sans-serif'
  menu.style.left = x + 'px'
  menu.style.top  = y + 'px'

  items.forEach(it => {
    if (it.divider) {
      const sep = document.createElement('div')
      sep.style.cssText = 'height:1px;background:#2a2a2a;margin:4px 0'
      menu.appendChild(sep)
      return
    }
    const btn = document.createElement('div')
    btn.style.cssText = `padding:7px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;color:${it.danger ? '#ff6b6b' : '#ddd'};border-radius:4px;margin:0 4px;transition:background 0.1s;position:relative`

    btn.innerHTML = `
      <span style="font-size:13px;width:16px;text-align:center;flex-shrink:0">${it.icon}</span>
      <span style="flex:1">${it.label}</span>
      ${it.submenu ? '<span style="font-size:14px;color:#606070">›</span>' : ''}
    `

    if (it.submenu) {
      const sub = document.createElement('div')
      sub.style.cssText = 'position:fixed;display:none;background:#1e1e1e;border:1px solid #3a3a3a;border-radius:8px;padding:4px 0;min-width:180px;z-index:10000;box-shadow:0 4px 24px rgba(0,0,0,0.7);font-size:13px'
      document.body.appendChild(sub)

      it.submenu.forEach(si => {
        const sb = document.createElement('div')
        sb.style.cssText = 'padding:7px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;color:#ddd;border-radius:4px;margin:0 4px;transition:background 0.1s'
        sb.innerHTML = `<span style="font-size:13px;width:16px;text-align:center">${si.icon}</span><span>${si.label}</span>`
        sb.addEventListener('mouseenter', () => { sb.style.background = '#2a2a2a' })
        sb.addEventListener('mouseleave', () => { sb.style.background = 'transparent' })
        sb.addEventListener('click', () => { removeContextMenu(); si.action() })
        sub.appendChild(sb)
      })

      btn.addEventListener('mouseenter', () => {
        btn.style.background = '#2a2a2a'
        const r = btn.getBoundingClientRect()
        sub.style.left = r.right + 'px'; sub.style.top = r.top + 'px'
        sub.style.display = 'block'
        requestAnimationFrame(() => {
          const sr = sub.getBoundingClientRect()
          if (sr.right  > window.innerWidth)  sub.style.left = (r.left - sr.width) + 'px'
          if (sr.bottom > window.innerHeight) sub.style.top  = (r.bottom - sr.height) + 'px'
        })
      })
      btn.addEventListener('mouseleave', e => {
        if (!sub.contains(e.relatedTarget)) { btn.style.background = 'transparent'; sub.style.display = 'none' }
      })
      sub.addEventListener('mouseleave', e => {
        if (!btn.contains(e.relatedTarget)) sub.style.display = 'none'
      })
    } else {
      btn.addEventListener('mouseenter', () => { btn.style.background = it.danger ? '#3a1a1a' : '#2a2a2a' })
      btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent' })
      btn.addEventListener('click', () => { removeContextMenu(); it.action() })
    }

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
  document.getElementById('ctx-menu')?.remove()
}

// ── Acciones del menú contextual ──────────────────────────────────────────────

function renameMediaItem(index) {
  const m = S.mediaItems[index]
  const list = document.getElementById('media-list')
  const items = list.querySelectorAll('.media-item:not(.folder-item)')
  const visibleIdx = S.mediaItems
    .slice(0, index + 1)
    .filter(x => S.currentFolderId ? x.folderId === S.currentFolderId : !x.folderId)
    .length - 1
  const itemEl = items[visibleIdx]
  if (!itemEl) return
  const nameEl = itemEl.querySelector('.media-name')
  if (!nameEl) return
  const oldName = m.name
  const input = document.createElement('input')
  input.type = 'text'; input.value = oldName
  input.style.cssText = 'background:#111;border:1px solid #4f6ef7;border-radius:4px;color:#fff;font-size:12px;padding:2px 6px;width:100%;outline:none;font-family:system-ui,sans-serif'
  nameEl.replaceWith(input)
  input.focus(); input.select()
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
  const m = S.mediaItems[index]
  const clipsAntes = S.clips.length
  S.setClips(S.clips.filter(c => c.path !== m.path))
  S.mediaItems.splice(index, 1)
  if (S.selectedMediaIndex >= S.mediaItems.length) S.setSelectedMediaIndex(S.mediaItems.length - 1)
  renderMediaPanel()
  import('./timeline.js').then(tl => tl.renderTimeline())
  const removed = clipsAntes - S.clips.length
  setStatus('Eliminado: ' + m.name + (removed > 0 ? ` (y ${removed} clip(s) del timeline)` : ''))
}