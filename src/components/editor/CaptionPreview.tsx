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
/** The box, width : height (half the height it had, user 2026-11-10) */
const ASPECT = 6
/** How tall the box may grow for a big caption (user, 2026-11-12: a bigger Size has to look bigger — a line
 *  on to two lines no longer fitted the strip, so it was drawn smaller) */
const MIN_ASPECT = 2.4
/** The line is drawn on a taller canvas (room for the styles that stack a word a line), then placed in the box */
const DRAW_ASPECT = 1.2
/** How the line is measured: on a small canvas of this width, at this many moments of its loop (a pop's peak is short) */
const MEASURE_W = 360
const MEASURE_MOMENTS = 27
/** The caption size every style is fitted at (the Size slider's starting point): sizes above and below it show as bigger and smaller */
const FIT_AT_SIZE = 52
/** At that size a line fills this much of the box's width, or of its height, whichever comes first (so all styles look alike in size) */
const FIT_W = 0.62
const FIT_H = 0.7
/** Whatever the size, a line never goes past this much of the box */
const LIMIT_W = 0.92
const LIMIT_H = 0.86
/** A line is never drawn more than this many times larger */
const MAX_ZOOM = 3

/** Where a line reaches over its whole loop, as shares of the canvas */
interface Ink { left: number; right: number; top: number; bottom: number }
/** The zoom that makes a line fill that share of the box's width or height */
const zoomToFill = (ink: Ink, w: number, h: number, aspect = ASPECT) =>
  Math.min(w / (ink.right - ink.left), (h * DRAW_ASPECT) / (aspect * (ink.bottom - ink.top)))
/** The box's width : height that lets a line be drawn at `zoom` (no flatter than ASPECT, no taller than MIN_ASPECT) */
const aspectFor = (ink: Ink, zoom: number) =>
  Math.max(MIN_ASPECT, Math.min(ASPECT, (LIMIT_H * DRAW_ASPECT) / (zoom * (ink.bottom - ink.top))))

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
    const drawn = document.createElement('canvas')
    const d = drawn.getContext('2d')
    const measuring = document.createElement('canvas')
    measuring.width = MEASURE_W
    measuring.height = Math.round(MEASURE_W / DRAW_ASPECT)
    const m = measuring.getContext('2d', { willReadFrequently: true })
    if (!ctx || !d || !m) return
    let placedFor = '', fittedFor = '', fitZoom = 1, aspect = ASPECT
    // (drawn at the screen's own pixels: the caption sizes follow the canvas width, as on the video)
    const fit = () => {
      const dpr = window.devicePixelRatio || 1
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(w / aspect))
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; placedFor = '' }
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(canvas)
    let raf = 0, perLine = -1, chunks: ReturnType<typeof buildCaptionChunks> = []
    let lastStyle: Partial<CaptionStyle> | null = null, lastCase: TextCase | null = null, styleKey = '', fitKey = ''
    let centreX = 0.5, centreY = 0.5, fontCount = -1
    /** One word at a time (a perLine-1 style): each word placed on its own — when it starts, its zoom and centre.
     *  Fitted together, a short word made huge by a bigger Size shrank the long ones (user, 2026-11-12:
     *  at 100 "SHORTCUT" was smaller than at 54) */
    let perWord: Array<{ from: number; zoom: number; cx: number; cy: number }> = [], shownWord = -1
    const paint = (on: CanvasRenderingContext2D, st: Partial<CaptionStyle>, ms: number) => {
      on.setTransform(1, 0, 0, 1, 0, 0)
      on.clearRect(0, 0, on.canvas.width, on.canvas.height)
      // (centred wherever the captions sit on the video)
      drawCaptions(on, chunks, ms, { ...st, position_x: 0.5, position_y: 0.5 }, caseRef.current, null, undefined, false)
    }
    /** Where the line reaches over its whole loop (or from `from` to `to`); null: nothing is drawn */
    const inkOf = (st: Partial<CaptionStyle>, from = 0, to = HOLD_AT_MS): Ink | null => {
      const W = measuring.width, H = measuring.height
      let left = W, right = -1, top = H, bottom = -1
      for (let i = 0; i < MEASURE_MOMENTS; i++) {
        paint(m, st, from + ((to - from) * i) / (MEASURE_MOMENTS - 1))
        const px = m.getImageData(0, 0, W, H).data
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (px[(y * W + x) * 4 + 3] <= 24) continue
          if (x < left) left = x
          if (x > right) right = x
          if (y < top) top = y
          if (y > bottom) bottom = y
        }
      }
      return bottom < 0 ? null : { left: left / W, right: (right + 1) / W, top: top / H, bottom: (bottom + 1) / H }
    }
    // Each style gets one zoom, from its line at the starting size, so the styles look alike in the
    // box and the Size slider still shows; the line as it is now is what's kept off the edges and centred
    const place = (st: Partial<CaptionStyle>) => {
      if (fittedFor !== fitKey) {
        fittedFor = fitKey
        const ink = inkOf({ ...st, size: FIT_AT_SIZE })
        fitZoom = ink ? Math.min(MAX_ZOOM, zoomToFill(ink, FIT_W, FIT_H)) : 1
      }
      // (one word at a time: each word from its start to the next one's; the last held to the loop's hold)
      const oneByOne = perLine === 1 && chunks.length > 1
      const inks = oneByOne
        ? chunks.map((c, j) => ({ from: c[0].start_ms, ink: inkOf(st, c[0].start_ms, j + 1 < chunks.length ? chunks[j + 1][0].start_ms - 1 : HOLD_AT_MS) }))
        : [{ from: 0, ink: inkOf(st) }]
      // The box as tall as the biggest of them needs at its zoom (kept the same while the words change)
      const want = (ink: Ink) => Math.min(fitZoom, LIMIT_W / (ink.right - ink.left))
      const tall = Math.min(ASPECT, ...inks.map(({ ink }) => (ink ? aspectFor(ink, want(ink)) : ASPECT)))
      if (Math.abs(tall - aspect) > 0.01) {
        aspect = tall
        canvas.style.aspectRatio = `${aspect} / 1`
        fit()
      }
      const placeOf = (ink: Ink | null) => ({
        zoom: ink ? Math.min(fitZoom, zoomToFill(ink, LIMIT_W, LIMIT_H, aspect)) : 1,
        cx: ink ? (ink.left + ink.right) / 2 : 0.5, cy: ink ? (ink.top + ink.bottom) / 2 : 0.5,
      })
      perWord = []
      shownWord = -1
      if (oneByOne) {
        perWord = inks.map(({ from, ink }) => ({ from, ...placeOf(ink) }))
        return
      }
      const one = placeOf(inks[0].ink)
      centreX = one.cx
      centreY = one.cy
      size(one.zoom)
    }
    // (drawn at that zoom, not stretched afterwards: the text stays sharp)
    const size = (zoom: number) => {
      drawn.width = Math.max(1, Math.round(canvas.width * zoom))
      drawn.height = Math.max(1, Math.round(drawn.width / DRAW_ASPECT))
    }
    const t0 = performance.now()
    const frame = (now: number) => {
      const st = styleRef.current
      // (a font arriving changes how big the line is; they're added by hand, so no event says so)
      if (document.fonts.size !== fontCount) { fontCount = document.fonts.size; placedFor = ''; fittedFor = '' }
      const n = captionWordsPerLine(st)
      if (n !== perLine) { perLine = n; chunks = buildCaptionChunks(WORDS, n) }
      if (st !== lastStyle || caseRef.current !== lastCase) {
        lastStyle = st
        lastCase = caseRef.current
        styleKey = JSON.stringify([st, lastCase])
        fitKey = JSON.stringify([{ ...st, size: null }, lastCase])
      }
      if (placedFor !== styleKey) { placedFor = styleKey; place(st) }
      const ms = Math.min((now - t0) % LOOP_MS, HOLD_AT_MS)
      if (perWord.length) {
        let j = 0
        while (j + 1 < perWord.length && perWord[j + 1].from <= ms) j++
        if (j !== shownWord) { shownWord = j; centreX = perWord[j].cx; centreY = perWord[j].cy; size(perWord[j].zoom) }
      }
      paint(d, st, ms)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(drawn, Math.round(canvas.width / 2 - centreX * drawn.width), Math.round(canvas.height / 2 - centreY * drawn.height))
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
