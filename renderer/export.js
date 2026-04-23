// ── Exportar video ────────────────────────────────────────────────────────────
// Orquesta la exportación: un solo clip o múltiples con transiciones.

import * as S from './state.js'
import { setStatus } from './utils.js'

export async function startExport() {
  if (!window.api)    { alert('API no disponible'); return }
  if (!S.clips.length){ setStatus('Agrega clips al timeline primero'); return }

  const outPath = await window.api.saveFile()
  if (!outPath) return

  const overlay = document.getElementById('export-overlay')
  overlay.style.display = 'flex'
  document.getElementById('export-bar').style.width   = '0%'
  document.getElementById('export-pct').textContent   = '0%'

  const ordered    = [...S.clips].sort((a, b) => a.tlStart - b.tlStart)
  const speed      = parseFloat(document.getElementById('speed-sl').value) / 100
  const brightness = parseFloat(document.getElementById('br-sl').value)
  const contrast   = parseFloat(document.getElementById('ct-sl').value)
  const total      = ordered.length

  const setBar = pct => {
    document.getElementById('export-bar').style.width = pct + '%'
    document.getElementById('export-pct').textContent = pct + '%'
  }

  try {
    if (total === 1) {
      const c = ordered[0]
      window.api.onProgress(pct => setBar(pct))
      await window.api.exportVideo({
        input: c.path, output: outPath,
        startTime: c.start, duration: c.tlDuration,
        speed, brightness, contrast
      })
    } else {
      const tmpFiles = []

      for (let i = 0; i < ordered.length; i++) {
        const c      = ordered[i]
        const tmpOut = `/tmp/ve_clip_${Date.now()}_${i}.mp4`
        tmpFiles.push(tmpOut)
        setStatus(`Procesando clip ${i + 1} de ${total}: ${c.name}`)
        window.api.onProgress(pct => {
          const overall = Math.round(((i + pct / 100) / total) * 90)
          setBar(overall)
        })
        await window.api.exportVideo({
          input: c.path, output: tmpOut,
          startTime: c.start, duration: c.tlDuration,
          speed, brightness, contrast
        })
      }

      setStatus('Uniendo clips con transiciones...')
      setBar(92)

      const exportTransitions = ordered.map(c => S.transitions[c.id] || null)
      await window.api.concatVideos({ files: tmpFiles, output: outPath, transitions: exportTransitions })
    }

    overlay.style.display = 'none'
    setStatus('✓ Exportado: ' + outPath.split('/').pop())
  } catch (e) {
    overlay.style.display = 'none'
    setStatus('Error: ' + e)
    alert('Error al exportar:\n' + e)
  }
}
