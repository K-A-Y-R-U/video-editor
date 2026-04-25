// ── Estado global ─────────────────────────────────────────────────────────────
// Este módulo exporta y centraliza TODO el estado mutable del editor.
// Los demás módulos importan desde aquí en lugar de tener variables sueltas.

export const vid = document.getElementById('main-video')

export let mediaItems = []
export let clips      = []
export let selectedClip       = null
export let selectedMediaIndex = -1
export let tlZoom  = 80
export let flipH   = false
export let flipV   = false
export let currentFilter = ''
export let trimStart = 0
export let trimEnd   = 0

// Reproducción multi-clip
export let playQueue      = []
export let playQueueIndex = 0
export let isPlayingQueue = false

// Drag state
export let drag        = null
export let libraryDrag = null

// Marcadores de loop
export let markers    = []
export let markerDrag = null

// Transiciones
export let transitions = {}
export let activeTransitionAnim = null
export let panelSelectedTransitionClipId = null

// ── Carpetas de librería ──────────────────────────────────────────────────────
// folders: [{ id, name, open }]
// mediaItems[i].folderId = id de la carpeta (null = raíz)
export let folders          = []
export let currentFolderId  = null   // null = vista raíz
export let folderStack      = []     // historial de navegación: [{ id, name }, ...]

// ── Setters (para que los módulos puedan mutar el estado compartido) ──────────

export function setMediaItems(v)  { mediaItems = v }
export function setClips(v)       { clips = v }
export function setSelectedClip(v){ selectedClip = v }
export function setSelectedMediaIndex(v) { selectedMediaIndex = v }
export function setTlZoom(v)      { tlZoom = v }
export function setFlipH(v)       { flipH = v }
export function setFlipV(v)       { flipV = v }
export function setCurrentFilter(v){ currentFilter = v }
export function setTrimStart(v)   { trimStart = v }
export function setTrimEnd(v)     { trimEnd   = v }

export function setPlayQueue(v)       { playQueue = v }
export function setPlayQueueIndex(v)  { playQueueIndex = v }
export function setIsPlayingQueue(v)  { isPlayingQueue = v }

export function setDrag(v)        { drag = v }
export function setLibraryDrag(v) { libraryDrag = v }

export function setMarkers(v)     { markers = v }
export function setMarkerDrag(v)  { markerDrag = v }

export function setTransitions(v) { transitions = v }
export function setActiveTransitionAnim(v) { activeTransitionAnim = v }
export function setPanelSelectedTransitionClipId(v) { panelSelectedTransitionClipId = v }

export function setFolders(v)         { folders = v }
export function setCurrentFolderId(v) { currentFolderId = v }
export function setFolderStack(v)     { folderStack = v }