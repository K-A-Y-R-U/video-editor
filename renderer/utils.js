// ── Utilidades generales ──────────────────────────────────────────────────────

/** Formatea segundos como "m:ss" */
export function fmt(s) {
  if (!isFinite(s) || s < 0) return '0:00'
  const m   = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

/** Limita un valor entre min y max */
export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

/** Escribe un mensaje en la barra de estado inferior */
export function setStatus(msg) {
  document.getElementById('status').textContent = msg
}

/** Extensiones de imagen soportadas */
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff']

/** Devuelve true si la ruta corresponde a una imagen */
export function isImagePath(p) {
  if (!p) return false
  const ext = p.split('.').pop().toLowerCase()
  return IMAGE_EXTS.includes(ext)
}

/** Propiedades por defecto para un nuevo clip */
export function defaultClipProps() {
  return {
    trimStart:  0,
    trimEnd:    0,
    speed:      100,
    brightness: 0,
    contrast:   0,
    saturation: 0,
    rotation:   0,
    zoom:       100,
    flipH:      false,
    flipV:      false,
    filter:     ''
  }
}
