// ── Exportar video ────────────────────────────────────────────────────────────
// Orquesta la exportación: un solo clip o múltiples con transiciones.
// Texto estático/fade → drawtext de ffmpeg.
// Texto animado       → secuencia PNG renderizada en canvas → overlay ffmpeg.

import * as S from './state.js'
import { setStatus } from './utils.js'
import { buildDrawtextFilter, renderTextClipToImageSequence, STATIC_ANIMATIONS } from './text-clips.js'

const EXPORT_W   = 1920
const EXPORT_H   = 1080
const EXPORT_FPS = 30

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
    const textClips = S.textClips || []

    // Separar clips estáticos (drawtext) de animados (canvas → PNG → overlay)
    const staticClips   = textClips.filter(tc => STATIC_ANIMATIONS.has(tc.animation))
    const animatedClips = textClips.filter(tc => !STATIC_ANIMATIONS.has(tc.animation))

    // Filtros drawtext para none/fade
    const textFilters = staticClips.map(tc =>
      buildDrawtextFilter(tc, EXPORT_W, EXPORT_H, 0)
    )

    // Renderizar PNGs para animaciones complejas
    let textOverlays = []
    if (animatedClips.length > 0) {
      setStatus('Renderizando texto animado...')
      setBar(2)
      for (const tc of animatedClips) {
        const result = await renderTextClipToImageSequence(tc, EXPORT_W, EXPORT_H, EXPORT_FPS)
        textOverlays.push({
          frameDir:   result.frameDir,
          fps:        result.fps,
          tlStart:    tc.tlStart,
          tlDuration: tc.tlDuration,
        })
      }
    }

    if (total === 1) {
      const c = ordered[0]
      const noAudio = !!(c.audioNoTrack) || (c.audioLinked === false && c.audioTlStart === undefined)
      window.api.onProgress(pct => setBar(pct))
      await window.api.exportVideo({
        input: c.path, output: outPath,
        startTime: c.start, duration: c.tlDuration,
        speed, brightness, contrast,
        muteAudio: noAudio,
        textFilters,
        textOverlays,
      })
    } else {
      const tmpDir = await window.api.getTmpDir()
      const tmpFiles = []

      for (let i = 0; i < ordered.length; i++) {
        const c      = ordered[i]
        const tmpOut = `${tmpDir}/ve_clip_${Date.now()}_${i}.mp4`
        tmpFiles.push(tmpOut)
        setStatus(`Procesando clip ${i + 1} de ${total}: ${c.name}`)
        window.api.onProgress(pct => {
          const overall = Math.round(((i + pct / 100) / total) * 90)
          setBar(overall)
        })
        const noAudio = !!(c.audioNoTrack) || (c.audioLinked === false && c.audioTlStart === undefined)

        // Filtrar qué texto cae dentro de este clip
        const clipStart = c.tlStart
        const clipEnd   = c.tlStart + c.tlDuration
        const clipStaticFilters = staticClips
          .filter(tc => tc.tlStart < clipEnd && tc.tlStart + tc.tlDuration > clipStart)
          .map(tc => buildDrawtextFilter(tc, EXPORT_W, EXPORT_H, clipStart))
        const clipOverlays = textOverlays
          .filter(ov => ov.tlStart < clipEnd && ov.tlStart + ov.tlDuration > clipStart)
          .map(ov => ({ ...ov, tlStart: ov.tlStart - clipStart }))

        await window.api.exportVideo({
          input: c.path, output: tmpOut,
          startTime: c.start, duration: c.tlDuration,
          speed, brightness, contrast,
          muteAudio: noAudio,
          textFilters: clipStaticFilters,
          textOverlays: clipOverlays,
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