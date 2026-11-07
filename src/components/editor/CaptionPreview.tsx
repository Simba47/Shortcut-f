'use client'

import { useEffect, useRef } from 'react'
import type { CaptionStyle, TranscriptWord } from '@chai-cut/shared'
import { buildCaptionChunks, captionWordsPerLine, drawCaptions } from './VideoPreview'
import type { TextCase } from './CaptionStyler'

/**
 * The top of the Captions panel (user, 2026-11-06): a sample line in the captions' style as the
 * video preview draws it — its font, colours, capitals, size and animation — playing on a loop.
 * Over every sub-tab, so a change on any of them shows here at once; dimmed while captions are off.
 */

const SAMPLE = 'shortcut to shortform'
/** When each sample word is said (ms), as a short spoken line */
const TIMES: Array<[number, number]> = [[0, 520], [520, 760], [760, 1400]]
const WORDS: TranscriptWord[] = SAMPLE.split(' ').map((word, i) => ({
  id: `sample-${i}`, transcript_id: 'sample', word, word_roman: null,
  start_ms: TIMES[i][0], end_ms: TIMES[i][1], speaker_id: null, confidence: null,
}))
/** The line plays, holds its last picture, then starts again */
const LOOP_MS = 2400
const HOLD_AT_MS = 1550
/** Width : height (room for the styles that stack a word a line) */
const ASPECT = 3

export function CaptionPreview({ style, textCase, dim }: {
  style: Partial<CaptionStyle>
  textCase: TextCase
  dim: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const styleRef = useRef(style)
  const caseRef = useRef(textCase)
  styleRef.current = style
  caseRef.current = textCase

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // (drawn at the screen's own pixels: the caption sizes follow the canvas width, as on the video)
    const fit = () => {
      const dpr = window.devicePixelRatio || 1
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(w / ASPECT))
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(canvas)
    let raf = 0, perLine = -1, chunks: ReturnType<typeof buildCaptionChunks> = []
    const t0 = performance.now()
    const frame = (now: number) => {
      const st = styleRef.current
      const n = captionWordsPerLine(st)
      if (n !== perLine) { perLine = n; chunks = buildCaptionChunks(WORDS, n) }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      // (centred in the box wherever the captions sit on the video)
      drawCaptions(ctx, chunks, Math.min((now - t0) % LOOP_MS, HOLD_AT_MS), { ...st, position_x: 0.5, position_y: 0.5 }, caseRef.current, null, undefined, false)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  return (
    <div className="cap-preview" data-dim={dim || undefined} title={dim ? 'Captions are off: turn on Show captions to put them on the video' : undefined}>
      <canvas ref={ref} role="img" aria-label={`Caption preview: “${SAMPLE}” in the captions’ style`} />
    </div>
  )
}
