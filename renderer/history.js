// ── Historial: Undo / Redo ────────────────────────────────────────────────────
import * as S from './state.js'
import { setStatus } from './utils.js'

const undoStack = []
const redoStack = []
const MAX_HISTORY = 50

// renderTimeline se inyecta desde timeline.js para evitar dependencia circular
let _renderTimeline = null
export function setRenderTimeline(fn) { _renderTimeline = fn }

export function saveState(description = '') {
  const snapshot = JSON.stringify(S.clips)
  if (undoStack.length > 0 && undoStack[undoStack.length - 1].state === snapshot) return
  undoStack.push({ state: snapshot, description })
  if (undoStack.length > MAX_HISTORY) undoStack.shift()
  redoStack.length = 0
  updateUndoButtons()
}

export function undo() {
  if (undoStack.length === 0) return
  const current = JSON.stringify(S.clips)
  redoStack.push({ state: current, description: '' })
  const entry = undoStack.pop()
  S.setClips(JSON.parse(entry.state))
  if (_renderTimeline) _renderTimeline()
  updateUndoButtons()
  setStatus('Deshacer: ' + (entry.description || 'acción'))
}

export function redo() {
  if (redoStack.length === 0) return
  const current = JSON.stringify(S.clips)
  undoStack.push({ state: current, description: '' })
  const entry = redoStack.pop()
  S.setClips(JSON.parse(entry.state))
  if (_renderTimeline) _renderTimeline()
  updateUndoButtons()
  setStatus('Rehacer: ' + (entry.description || 'acción'))
}

export function updateUndoButtons() {
  const undoBtn = document.getElementById('btn-undo')
  const redoBtn = document.getElementById('btn-redo')
  if (undoBtn) undoBtn.disabled = undoStack.length === 0
  if (redoBtn) redoBtn.disabled = redoStack.length === 0
}
