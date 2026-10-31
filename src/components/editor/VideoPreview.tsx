'use client'

import { TEMPLATE_FONTS, templateFontFamily, templateOf, isLatinText } from '@/modules/captions/templates'
import { drawCreatorCaptions, CREATOR_DEFAULT_Y } from '@/modules/captions/creator'
import { personMask } from '@/modules/captions/personMask'
import { useCaptionStore } from '@/modules/captions/store'
import type { PlayedPart } from '@/modules/captions/parts'
import { useRef, useEffect, useCallback, useState, useMemo, useId, createContext, useContext } from 'react'
import { emojiFamily, captionEmojiFamily } from '@/modules/editor/emojiFont'
import { LAYOUT_COLORS } from './SegmentTimeline'
import type { RefObject } from 'react'
import type { FrameLayout, SegmentLocal, Overlay, TextOverlay as TextOverlayType, CaptionStyle, TranscriptWord, FrameItem, FrameLane, CornerStyle } from '@chai-cut/shared'
import { BG_PAD, shownText, textCss, textReplayElapsed, withAlpha, wrapTextLines, TEXT_LINE_EM, MIN_TEXT_W, MIN_TEXT_H } from '@/modules/editor/textStyle'
import type { BoxPosition } from '@/lib/interpolation'
import type { TextCase } from './CaptionStyler'
import { applyCase } from './CaptionStyler'
import { normalizedSlotAspect, fitToAspect } from '@/modules/editor/utils'
import { backgroundPixels, frameBackgroundOf, type FrameBackground } from '@/lib/shared/brandCard'
import { isFrameLayout, frameSlotLabels, frameLanesFor, frameBandShown, frameOf, itemAt, captionBandAt, cornerGeometry, MIN_ROW_H, mainRect, boxRect, MIN_BOX as MIN_MAIN_BOX, frameAreas, frameBase, areaRadius, frameSlotSize, isTextLane, frameRows, validRowOrder, slotOffers, BLUR_SOURCE_SLOT, FRAME_TEMPLATES, barAt, barFlipped, MIN_MOVABLE_W } from '@/modules/editor/frames'
import type { FrameMediaPool } from '@/modules/editor/frameMedia'
import { useLiveTimeMs, liveTime, usePlayerStore, LIVE_REDRAW_MS } from '@/modules/player/store'
import { addedVideoBox, isGapPart } from '@/modules/editor/visibility'
import { trackPresentedFrame } from '@/modules/player/presentedFrame'
import { drawWatermark } from './watermark'
import { isBrandFont, type ProgressBar } from '@/lib/shared/brandKit'
import { VIDEO_FONTS } from '@/lib/shared/videoFonts'
import { ensureBrandFont } from './brandFonts'

const BOX_COLORS = ['#22c55e', '#3b82f6', '#f59e0b']
/** The layout's name on its frames' tag (user, 2026-10-31: the corners in the layout's colour, as on the timeline, so it's plain which format it is) */
const LAYOUT_NAMES: Partial<Record<string, string>> = {
  vertical: 'Vertical', split: 'Split', trio: 'Trio', horizontal: 'Horizontal', spotlight: 'Spotlight', centered: 'Centered',
}
// What each slot becomes in the 9:16 output, top to bottom
const SLOT_LABELS: Record<string, string[]> = {
  vertical: ['9:16'], split: ['Top', 'Bottom'], trio: ['Top', 'Middle', 'Bottom'], horizontal: ['Full frame'],
}

const HANDLES: { cursor: string; pos: React.CSSProperties; dir: string }[] = [
  { cursor: 'nw-resize', pos: { top: -5, left: -5 },                                       dir: 'nw' },
  { cursor: 'n-resize',  pos: { top: -5, left: '50%', transform: 'translateX(-50%)' },     dir: 'n'  },
  { cursor: 'ne-resize', pos: { top: -5, right: -5 },                                      dir: 'ne' },
  { cursor: 'e-resize',  pos: { top: '50%', right: -5, transform: 'translateY(-50%)' },    dir: 'e'  },
  { cursor: 'se-resize', pos: { bottom: -5, right: -5 },                                   dir: 'se' },
  { cursor: 's-resize',  pos: { bottom: -5, left: '50%', transform: 'translateX(-50%)' },  dir: 's'  },
  { cursor: 'sw-resize', pos: { bottom: -5, left: -5 },                                    dir: 'sw' },
  { cursor: 'w-resize',  pos: { top: '50%', left: -5, transform: 'translateY(-50%)' },     dir: 'w'  },
]

// ── Source video with crop box overlay ───────────────────────────────────────

interface VideoPreviewProps {
  videoRef: RefObject<HTMLVideoElement | null>
  videoUrl: string
  currentTimeMs: number
  /** Follow the playhead's exact time every frame (the player store's live feed) instead of `currentTimeMs` */
  live?: boolean
  activeSegment: SegmentLocal | null
  /** With `live`: the format at a clip time, so the crop boxes change exactly where the format does */
  segmentAt?: (clipMs: number) => SegmentLocal | null
  /**
   * A video on top (B-roll, one of the user's videos): the element playing it, kept in step with
   * the main video (useBrollSources). While one shows, this view shows it, with its crop box on it.
   */
  overlaySource?: (seg: SegmentLocal | null) => HTMLVideoElement | null
  /** The clip's own video (a part showing another video is a video on top) */
  mainVideoId?: string | null
  getPositionAt: (boxId: string, t_ms: number) => BoxPosition
  activeBoxId: string | null
  onSelectBox: (segmentId: string, boxId: string) => void
  onBoxChange: (boxId: string, pos: BoxPosition) => void
  /** Subjects tool: clicks on the video mark a person (x, y: fractions of the frame) instead of moving views */
  marking?: boolean
  onMark?: (x: number, y: number) => void
  /** Subjects tool: where each tracked person's face is at the playhead (fractions of the frame) */
  subjectsAt?: (clipMs: number) => Array<{ id: string; label: string; color: string; box: BoxPosition }>
}

export function VideoPreview({
  videoRef, videoUrl, currentTimeMs: timeProp, live = false, activeSegment: segmentProp, segmentAt,
  overlaySource, mainVideoId, getPositionAt, activeBoxId, onSelectBox, onBoxChange,
  marking = false, onMark, subjectsAt,
}: VideoPreviewProps) {
  // (redrawn at most ~30 times a second: the picture itself is drawn every frame, from the live time)
  const liveMs = useLiveTimeMs(live, LIVE_REDRAW_MS)
  const currentTimeMs = live ? liveMs : timeProp
  const activeSegment = live && segmentAt ? segmentAt(liveMs) : segmentProp
  const [mainAR, setVideoAR] = useState<number | null>(null)
  // (a video already loaded before the page was ready — a cached one — had its size known before
  // onLoadedMetadata could hear it: read it here then)
  useEffect(() => {
    const v = videoRef.current
    if (!mainAR && v?.videoWidth && v.videoHeight) setVideoAR(v.videoWidth / v.videoHeight)
  }) // eslint-disable-line react-hooks/exhaustive-deps
  const maskId = `crop-mask-${useId().replace(/:/g, '')}`

  // ── A video on top playing here: this view shows it (and its crop box is framed on it) ──
  // (a hidden one isn't here: shownSegment puts the main video in its place)
  const overlayBox = activeSegment && overlaySource ? addedVideoBox(activeSegment, mainVideoId) : null
  const showsOverlay = !!overlayBox
  const [overlayAR, setOverlayAR] = useState<number | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlaySegRef = useRef(activeSegment)
  overlaySegRef.current = activeSegment
  const overlaySourceRef = useRef(overlaySource)
  overlaySourceRef.current = overlaySource
  useEffect(() => {
    if (!showsOverlay) return
    let raf = 0
    // Every frame: the overlay video's picture (the same element the preview draws, kept in step)
    const draw = () => {
      const el = overlaySourceRef.current?.(overlaySegRef.current)
      const c = overlayCanvasRef.current
      if (el && c && el.readyState >= 2 && el.videoWidth && el.videoHeight) {
        const ar = el.videoWidth / el.videoHeight
        setOverlayAR(prev => (prev && Math.abs(prev - ar) < 0.001 ? prev : ar))
        const w = Math.min(1280, el.videoWidth), h = Math.round(w / ar)
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
        c.getContext('2d')?.drawImage(el, 0, 0, w, h)
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [showsOverlay])
  // A gap left by a deleted part, with nothing on top: nothing to show or frame here (black)
  const gapHere = !!activeSegment && !showsOverlay && isGapPart(activeSegment, mainVideoId)
  // The shape of what this view shows: the overlay video's while it shows, else the main video's
  const videoAR = showsOverlay ? overlayAR ?? mainAR : mainAR

  const isHorizontal = activeSegment?.layout === 'horizontal'

  return (
    <div
      className="ed-vp flex-1 flex items-center justify-center overflow-hidden"
      style={{ background: '#0a0a0a' }}
    >
      {/* For horizontal layout: fill full width so any source AR looks as large as possible.
          The AR prop still controls height, and maxHeight prevents overflow. */}
      <div
        className="ed-vp-frame relative overflow-hidden"
        style={
          isHorizontal
            ? { width: '100%', ...(videoAR ? { aspectRatio: String(videoAR) } : { height: '100%' }), maxHeight: '100%', background: '#000', flexShrink: 0 }
            : { ...(videoAR ? { aspectRatio: String(videoAR) } : { width: '100%', height: '100%' }), maxWidth: '100%', maxHeight: '100%', background: '#000', flexShrink: 0 }
        }
      >
        <video
          ref={videoRef}
          src={videoUrl || undefined}
          crossOrigin="anonymous"
          preload="auto"
          // (still playing under a video on top: it keeps the time for everything)
          style={{ width: '100%', height: '100%', display: 'block', ...(showsOverlay || gapHere ? { opacity: 0 } : {}) }}
          onLoadedMetadata={e => {
            const v = e.currentTarget
            if (v.videoWidth && v.videoHeight) setVideoAR(v.videoWidth / v.videoHeight)
          }}
        />
        {showsOverlay && (
          <canvas ref={overlayCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" style={{ display: 'block', background: '#000' }} aria-hidden="true" />
        )}

        {/* Crop boxes — each is locked to the shape of its slot in the output, so what's
            inside the box is exactly what gets exported */}
        {activeSegment && !gapHere && (() => {
          const layout = activeSegment.layout
          const aspect = normalizedSlotAspect(layout, videoAR ?? undefined, frameBandShown(activeSegment))
          const frame = isFrameLayout(layout)
          const count = frame ? activeSegment.crop_boxes.length : layout === 'trio' ? 3 : layout === 'split' ? 2 : 1
          const labels = frame ? frameSlotLabels(layout, activeSegment.frame) : SLOT_LABELS[layout]
          const mainSlots = frame ? frameOf(activeSegment).main_slots ?? [0] : null
          const boxes = activeSegment.crop_boxes.slice(0, count)
            // In a frame only the slots showing the main video are framed on it (and not one that
            // shows it whole: nothing is cropped there)
            .filter(box => !mainSlots || (mainSlots.includes(box.slot_index)
              && frameSlotSize(layout as FrameLayout, frameBandShown(activeSegment), box.slot_index, activeSegment.frame) !== null))
            .map(box => {
              // Slots can differ in shape (Big + Small): each box is locked to its own slot's
              const slotA = frame ? normalizedSlotAspect(layout, videoAR ?? undefined, frameBandShown(activeSegment), box.slot_index, activeSegment.frame) : aspect
              // A resized video box changes the shape that's cut from the source
              const mr = frame ? mainRect(frameOf(activeSegment), box.slot_index) : null
              const a = slotA && mr ? slotA * (mr.w / mr.h) : slotA
              return { box, aspect: a, label: labels?.[box.slot_index] ?? String(box.slot_index + 1), pos: fitToAspect(getPositionAt(box.id, currentTimeMs), a) }
            })
          return (
            <div className="absolute inset-0" style={{ pointerEvents: 'none', zIndex: 10 }}>
              {/* One shared dim layer with a hole per box, so boxes never darken each other */}
              <svg className="absolute inset-0" width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <mask id={maskId}>
                    <rect x="0" y="0" width="1" height="1" fill="white" />
                    {boxes.map(({ box, pos }) => <rect key={box.id} x={pos.x} y={pos.y} width={pos.w} height={pos.h} fill="black" />)}
                  </mask>
                </defs>
                <rect x="0" y="0" width="1" height="1" fill="rgba(0,0,0,0.55)" mask={`url(#${maskId})`} />
              </svg>
              {boxes.map(({ box, pos, label, aspect }, slotIdx) => (
                <DraggableBox
                  key={box.id}
                  pos={pos}
                  aspect={aspect}
                  color={LAYOUT_COLORS[layout] ?? BOX_COLORS[slotIdx % BOX_COLORS.length]}
                  isActive={box.id === activeBoxId || boxes.length === 1}
                  kind={frame ? 'Frame' : LAYOUT_NAMES[layout]}
                  label={label}
                  onSelect={() => onSelectBox(activeSegment.id, box.id)}
                  onChange={newPos => onBoxChange(box.id, newPos)}
                />
              ))}
            </div>
          )
        })()}

        {/* Subjects: each tracked person's face at this moment (on the main video only) */}
        {subjectsAt && !showsOverlay && !gapHere && subjectsAt(currentTimeMs).map(s => (
          <div key={s.id} aria-hidden="true" className="absolute pointer-events-none" style={{
            zIndex: 15, left: `${s.box.x * 100}%`, top: `${s.box.y * 100}%`, width: `${s.box.w * 100}%`, height: `${s.box.h * 100}%`,
            border: `2px solid ${s.color}`, borderRadius: 6, boxShadow: '0 0 0 1px rgba(0,0,0,0.45)',
          }}>
            <span style={{
              position: 'absolute', left: -2, bottom: '100%', marginBottom: 3, whiteSpace: 'nowrap',
              fontSize: 10, fontWeight: 700, lineHeight: 1.4, padding: '1px 6px', borderRadius: 4, background: s.color, color: '#111',
            }}>{s.label}</span>
          </div>
        ))}

        {/* Subjects: marking a person — a click anywhere on the picture, nothing else reacts */}
        {marking && onMark && !showsOverlay && (
          <div role="button" tabIndex={0} aria-label="Click on a person to mark them"
            className="absolute inset-0" style={{ zIndex: 30, cursor: 'crosshair', boxShadow: 'inset 0 0 0 2px rgba(200,255,0,0.75)' }}
            onClick={e => {
              const r = e.currentTarget.getBoundingClientRect()
              onMark(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)))
            }}>
            <span className="absolute left-1/2 -translate-x-1/2 top-2 px-2.5 py-1 rounded-md text-[11px] font-semibold pointer-events-none"
              style={{ background: 'rgba(0,0,0,0.75)', color: '#c8ff00' }}>Click on a person to mark them</span>
          </div>
        )}
        {marking && showsOverlay && (
          <span className="absolute left-1/2 -translate-x-1/2 top-2 px-2.5 py-1 rounded-md text-[11px] font-semibold pointer-events-none"
            style={{ zIndex: 30, background: 'rgba(0,0,0,0.75)', color: '#fbbf24' }}>A video on top is showing here — move to the main video to mark</span>
        )}
      </div>
    </div>
  )
}

// ── Cover-crop helper: scale src region to fill dst rect without stretching ──

function coverCrop(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  sx: number, sy: number, sw: number, sh: number,
  dx: number, dy: number, dw: number, dh: number,
) {
  const srcAR = sw / (sh || 1)
  const dstAR = dw / (dh || 1)
  if (srcAR > dstAR) {
    const fitW = sh * dstAR
    ctx.drawImage(video, sx + (sw - fitW) / 2, sy, fitW, sh, dx, dy, dw, dh)
  } else if (srcAR < dstAR) {
    const fitH = sw / dstAR
    ctx.drawImage(video, sx, sy + (sh - fitH) / 2, sw, fitH, dx, dy, dw, dh)
  } else {
    ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh)
  }
}

// ── Segment rendering — pure function so RAF callbacks can call it without stale closures ──

const CROSSFADE_MS = 250

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

/** Cover-fit any image/video source into a rect, with an optional zoom and horizontal pan */
function coverSource(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource, sw: number, sh: number,
  dx: number, dy: number, dw: number, dh: number,
  zoom = 1, panX = 0,
) {
  if (!sw || !sh) return
  const scale = Math.max(dw / sw, dh / sh) * zoom
  const w = dw / scale, h = dh / scale
  const spareX = sw - w
  const sx = Math.max(0, Math.min(spareX, spareX / 2 + panX * spareX / 2))
  const sy = (sh - h) / 2
  ctx.drawImage(src, sx, sy, w, h, dx, dy, dw, dh)
}

/** Zoom and pan of a photo slot at progress p (0–1) through its format */
function photoMotion(motion: string | null | undefined, p: number): { zoom: number; panX: number } {
  const e = Math.max(0, Math.min(1, p))
  switch (motion) {
    case 'zoom_in': return { zoom: 1 + 0.15 * e, panX: 0 }
    case 'zoom_out': return { zoom: 1.15 - 0.15 * e, panX: 0 }
    case 'pan_left': return { zoom: 1.15, panX: 1 - 2 * e }
    case 'pan_right': return { zoom: 1.15, panX: -1 + 2 * e }
    default: return { zoom: 1, panX: 0 }
  }
}

// Frame text: the text box's width when its sides were never dragged (shares of the frame's width),
// and its line height (em). render.py _frame_text_chain uses the same.
const FRAME_TEXT_W = 0.88
const FRAME_TEXT_LINE = 1.2

/** The Indian scripts frame text is drawn in their Noto font (render.py _frame_text_font, the same list) */
const FRAME_SCRIPTS: [string, string, string][] = [
  ['\u0c00', '\u0c7f', 'noto-sans-telugu'], ['\u0900', '\u097f', 'noto-sans-devanagari'], ['\u0b80', '\u0bff', 'noto-sans-tamil'],
  ['\u0c80', '\u0cff', 'noto-sans-kannada'], ['\u0d00', '\u0d7f', 'noto-sans-malayalam'], ['\u0980', '\u09ff', 'noto-sans-bengali'],
]
/** Editor fonts the export has only at their regular weight (render.py _FAMILY_FILES): drawn at 400 here too, not a made-up bold */
const REGULAR_ONLY = new Set(['Bebas Neue', 'Anton', 'Fjalla One', 'Archivo Black', 'Righteous', 'Fredoka One', 'Pacifico'])
/**
 * The export's font for frame text (render.py _frame_text_font): the text's own font — an editor
 * font, or a brand kit's own (brand kit Phase 3: a kit puts its title font on frame text) — for
 * Latin text, at the weight the export's file has; else Montserrat Bold; text in an Indian script,
 * that script's Noto font
 */
function frameTextFont(text: string, family?: string | null): { family: string; weight: number } {
  const hit = FRAME_SCRIPTS.find(([lo, hi]) => [...text].some(c => c >= lo && c <= hi))
  if (family && !hit) {
    if (isBrandFont(family)) { ensureBrandFont(family); return { family, weight: 400 } }
    if (family !== 'sans-serif' && VIDEO_FONTS.some(f => f.family === family)) return { family, weight: REGULAR_ONLY.has(family) ? 400 : 700 }
  }
  return { family: exportFont(hit ? hit[2] : 'montserrat-bold').family, weight: 400 }
}

/**
 * Frame text's lines: wrapped inside its box's width (a word too long for the box broken across
 * lines), measured at the export's 1080-wide scale with the export's own font file — render.py
 * wraps by the same rule (_wrap_text_lines), so lines break in the same places in the video.
 */
function frameTextLines(it: Pick<FrameItem, 'text' | 'size' | 'w' | 'font'>, areaW = 1, ticker = false): string[] {
  const text = (it.text ?? '').trim()
  if (!text) return []
  // A ticker is one line that scrolls by
  if (ticker) return [text.replace(/\s*\n\s*/g, '   ')]
  const ctx = measurer()
  if (!ctx) return text.split('\n')
  ctx.save()
  const f = frameTextFont(text, it.font)
  ctx.font = `${f.weight} ${it.size ?? 64}px ${emojiFamily()}, "${f.family}", sans-serif`
  const lines = wrapTextLines(text, (it.w ?? FRAME_TEXT_W * areaW) * 1080, s => ctx.measureText(s).width)
  ctx.restore()
  while (lines.length && !lines[lines.length - 1]) lines.pop()
  return lines
}

/** A ticker's speed: px a second at 1080 wide (render.py uses the same) */
const TICKER_PX_S = 160

/** The frame text being typed in on the preview: the canvas leaves its words out (its text field shows them) */
let frameTextEditing: string | null = null

/** An area of the frame in canvas px, with its corner radius in px */
type AreaPx = { x: number; y: number; w: number; h: number; r: number }

/** Clip to an area (rounded when it has a radius) */
function clipArea(ctx: CanvasRenderingContext2D, a: AreaPx) {
  ctx.beginPath()
  if (a.r > 0) ctx.roundRect(a.x, a.y, a.w, a.h, a.r); else ctx.rect(a.x, a.y, a.w, a.h)
  ctx.clip()
}

/**
 * A text item: its background filling its area ('none': see-through), its text centred on its
 * spot (turned, when rotated). A ticker's one line scrolls in from the right, over and over.
 */
function paintFrameText(ctx: CanvasRenderingContext2D, it: FrameItem, fallbackBg: string, a: AreaPx, ticker = false, elapsedMs = 0) {
  const W = ctx.canvas.width
  ctx.save()
  clipArea(ctx, a)
  const bg = it.bg || fallbackBg
  if (bg && bg !== 'none') { ctx.fillStyle = bg; ctx.fillRect(a.x, a.y, a.w, a.h) }
  const lines = it.id === frameTextEditing ? [] : frameTextLines(it, a.w / W, ticker)
  if (lines.length) {
    const size = Math.round(((it.size ?? 64) / 1080) * W)
    const lh = size * FRAME_TEXT_LINE
    const f = frameTextFont(it.text ?? '', it.font)
    ctx.font = `${f.weight} ${size}px ${emojiFamily()}, "${f.family}", sans-serif`
    ctx.fillStyle = it.color || '#ffffff'
    ctx.textBaseline = 'middle'
    if (ticker) {
      const tw = ctx.measureText(lines[0]).width
      const run = a.w + tw
      const x = a.x + a.w - (((elapsedMs / 1000) * TICKER_PX_S * (W / 1080)) % run)
      ctx.textAlign = 'left'
      ctx.fillText(lines[0], x, a.y + a.h / 2)
    } else {
      ctx.textAlign = 'center'
      ctx.translate(a.x + (it.x ?? 0.5) * a.w, a.y + (it.y ?? 0.5) * a.h)
      if (it.rotation) ctx.rotate((it.rotation * Math.PI) / 180)
      lines.forEach((ln, i) => ctx.fillText(ln, 0, (i - (lines.length - 1) / 2) * lh))
    }
  }
  ctx.restore()
}

/**
 * The sound wave (Audiogram): bars across its area. The export draws the clip's real sound
 * (render.py: showwaves); the preview moves the bars while the video plays.
 */
function paintWave(ctx: CanvasRenderingContext2D, a: AreaPx, color: string, tMs: number, playing: boolean) {
  const n = 36, gap = a.w / n
  const bw = Math.max(2, gap * 0.55)
  ctx.save()
  ctx.fillStyle = color
  for (let i = 0; i < n; i++) {
    const t = tMs / 1000
    const v = playing
      ? 0.18 + 0.82 * Math.abs(Math.sin(t * (2.1 + (i % 5) * 0.7) + i * 1.7)) * Math.abs(Math.sin(t * (1.3 + (i % 3) * 0.9) + i * 0.6))
      : 0.12
    const h = Math.max(bw, a.h * v)
    ctx.beginPath()
    ctx.roundRect(a.x + i * gap + (gap - bw) / 2, a.y + (a.h - h) / 2, bw, h, bw / 2)
    ctx.fill()
  }
  ctx.restore()
}

/**
 * A frame's text in the preview — the same text field as a positioned text: drag it to move it
 * round its band (or slot), its sides to make the box wider or narrower (the text wraps inside
 * it), the corner to make the text bigger or smaller; turn it, delete it, double-click to type.
 * Everything is saved on the text, and the export uses it.
 */
function FrameTextBox({ row, item, selected, editing, onSelect, onChange, onDelete, onStartEdit, onEndEdit }: {
  /** Its area of the frame (shares of the frame) */
  row: { x: number; y: number; w: number; h: number }
  item: FrameItem
  selected: boolean
  editing: boolean
  onSelect: () => void
  onChange: (patch: Partial<Pick<FrameItem, 'x' | 'y' | 'size' | 'w' | 'h' | 'rotation' | 'text'>>) => void
  onDelete?: () => void
  onStartEdit: () => void
  onEndEdit: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const setGuides = useContext(GuideContext)
  const size = item.size ?? 64
  const empty = !item.text?.trim()
  const lines = frameTextLines(item, row.w)
  // The box's width as a share of the frame; its place (x, y) is a share of its area
  const boxW = item.w ?? FRAME_TEXT_W * row.w
  const bw = boxW / row.w
  // The text's height, as a share of the frame's (1080×1920); the box is at least that tall (taller
  // when its top or bottom was dragged: the text stays in its middle)
  const textH = (Math.max(1, lines.length) * size * FRAME_TEXT_LINE) / 1920
  const boxH = Math.max(textH, item.h ?? 0)
  const x = item.x ?? 0.5, y = item.y ?? 0.5
  const cx = row.x + row.w * x, cy = row.y + row.h * y
  const accent = '#c8ff00'
  const fontSize = `${size / 10.8}cqw`
  const face = frameTextFont(item.text ?? '', item.font)
  const fontFamily = `${emojiFamily()}, "${face.family}", sans-serif`
  const r3 = (v: number) => Math.round(v * 1000) / 1000
  // The whole box stays inside its area
  const clampX = (v: number) => bw >= 1 ? 0.5 : Math.max(bw / 2, Math.min(1 - bw / 2, v))
  const halfH = boxH / 2 / row.h
  const clampY = (v: number) => halfH >= 0.5 ? 0.5 : Math.max(halfH, Math.min(1 - halfH, v))

  // Typing on the preview: the cursor goes in with the words selected; Enter makes a new line
  useEffect(() => {
    if (!editing) return
    areaRef.current?.focus()
    areaRef.current?.select()
  }, [editing])

  function frameRect() {
    const r = ref.current?.parentElement?.getBoundingClientRect()
    return r ? { w: r.width, h: r.height } : { w: 1, h: 1 }
  }
  function drag(e: React.MouseEvent, move: (dx: number, dy: number, ev: MouseEvent) => void) {
    e.stopPropagation(); e.preventDefault()
    onSelect()
    const sx = e.clientX, sy = e.clientY
    const mv = (ev: MouseEvent) => { const { w, h } = frameRect(); move((ev.clientX - sx) / w, (ev.clientY - sy) / h, ev) }
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); setGuides(null) }
    window.addEventListener('mousemove', mv)
    window.addEventListener('mouseup', up)
  }
  function startMove(e: React.MouseEvent) {
    if (editing) return
    const x0 = clampX(x), y0 = clampY(y)
    drag(e, (dx, dy) => {
      // Centre guides: its area's middle, each way
      const [nx, onV] = snapTo(clampX(x0 + dx / row.w), 0.5, GUIDE_SNAP / row.w)
      const [ny, onH] = snapTo(clampY(y0 + dy / row.h), 0.5, GUIDE_SNAP / row.h)
      setGuides(onV || onH ? { ...(onV ? { v: row.x + row.w / 2 } : {}), ...(onH ? { h: row.y + row.h / 2 } : {}) } : null)
      onChange({ x: r3(nx), y: r3(ny) })
    })
  }
  /** Drag a side: the box's width (the text wraps inside it). The other side stays where it is. */
  function startWidth(e: React.MouseEvent, side: 'left' | 'right') {
    // In frame shares; the box stays inside its area
    const lo = row.x, hi = row.x + row.w
    const left0 = Math.max(lo, cx - boxW / 2), right0 = Math.min(hi, cx + boxW / 2)
    drag(e, dx => {
      const left = side === 'left' ? Math.max(lo, Math.min(right0 - MIN_TEXT_W, left0 + dx)) : left0
      const right = side === 'right' ? Math.min(hi, Math.max(left0 + MIN_TEXT_W, right0 + dx)) : right0
      onChange({ w: r3(right - left), x: r3(((left + right) / 2 - row.x) / row.w) })
    })
  }
  /** Drag the top or bottom: the box's height (the text stays its size, in the middle of the box). The other side stays where it is. */
  function startHeight(e: React.MouseEvent, side: 'top' | 'bottom') {
    // In frame shares; the box stays inside its area and never gets shorter than its text
    const lo = row.y, hi = row.y + row.h
    const top0 = Math.max(lo, cy - boxH / 2), bottom0 = Math.min(hi, cy + boxH / 2)
    const least = Math.max(textH, MIN_TEXT_H / 2)
    drag(e, (_dx, dy) => {
      const top = side === 'top' ? Math.max(lo, Math.min(bottom0 - least, top0 + dy)) : top0
      const bottom = side === 'bottom' ? Math.min(hi, Math.max(top0 + least, bottom0 + dy)) : bottom0
      onChange({ h: r3(bottom - top), y: r3(((top + bottom) / 2 - row.y) / row.h) })
    })
  }
  /** Drag the corner: the text's size */
  function startSize(e: React.MouseEvent) {
    const size0 = size
    drag(e, dx => onChange({ size: Math.max(24, Math.min(200, Math.round(size0 + dx * 270))) }))
  }

  const handle = (extra: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute', background: accent, border: '2px solid #111', borderRadius: 4, pointerEvents: 'auto', ...extra,
  })
  const tools = selected && !editing

  return (
    <div ref={ref}
      onMouseDown={startMove}
      onClick={e => { e.stopPropagation(); if (!editing) onSelect() }}
      onDoubleClick={e => { e.stopPropagation(); onStartEdit() }}
      title={editing ? undefined : 'Double-click to edit the text'}
      aria-label="Text in the frame: drag to move, double-click to edit"
      style={{
        position: 'absolute',
        left: `${(cx - boxW / 2) * 100}%`, top: `${(cy - boxH / 2) * 100}%`, width: `${boxW * 100}%`, height: `${boxH * 100}%`,
        transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined,
        cursor: editing ? 'text' : 'move', userSelect: 'none', touchAction: 'none',
        // (an outline, not a border: the box's inside stays exactly the width the text wraps in)
        outline: `1.5px solid ${selected || editing ? accent : 'transparent'}`,
        borderRadius: 3,
        background: editing ? 'rgba(0,0,0,0.25)' : selected ? 'rgba(200,255,0,0.12)' : 'transparent',
        boxShadow: selected ? `0 0 0 2.5px ${accent}44` : 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      {editing ? (
        <textarea
          ref={areaRef}
          value={item.text ?? ''}
          onChange={e => onChange({ text: e.target.value })}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          onBlur={onEndEdit}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); onEndEdit() } }}
          aria-label="Edit the text"
          spellCheck={false}
          style={{
            fontFamily, fontWeight: face.weight, fontSize, lineHeight: FRAME_TEXT_LINE, color: item.color || '#ffffff', textAlign: 'center',
            display: 'block', width: '100%', height: `${(textH / boxH) * 100}%`,
            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', overflow: 'hidden', resize: 'none',
            background: 'transparent', border: 'none', outline: 'none', padding: 0, margin: 0,
            caretColor: accent, userSelect: 'text',
          }}
        />
      ) : empty && (
        <span className="pointer-events-none" style={{ fontFamily, fontSize, lineHeight: FRAME_TEXT_LINE, color: 'rgba(255,255,255,0.35)' }}>Your text</span>
      )}
      {tools && (['left', 'right'] as const).map(side => (
        <div key={side} onMouseDown={e => startWidth(e, side)}
          title="Drag to make the text box wider or narrower (the text wraps inside it)"
          aria-label={`Text box width (${side} side)`}
          style={handle({ top: '50%', [side]: -5, transform: 'translateY(-50%)', width: 8, height: 22, cursor: 'ew-resize' })} />
      ))}
      {tools && (['top', 'bottom'] as const).map(side => (
        <div key={side} onMouseDown={e => startHeight(e, side)}
          title="Drag to make the text box taller or shorter (the text stays in its middle)"
          aria-label={`Text box height (${side} side)`}
          style={handle({ left: '50%', [side]: -5, transform: 'translateX(-50%)', width: 22, height: 8, cursor: 'ns-resize' })} />
      ))}
      {tools && <RotateHandle boxRef={ref} size={18} rotation={item.rotation ?? 0} onRotate={deg => onChange({ rotation: deg })} />}
      {tools && onDelete && (
        <button type="button" aria-label="Delete the text" title="Delete the text"
          onMouseDown={e => { e.stopPropagation(); onDelete() }}
          style={{
            position: 'absolute', top: -9, right: -9, width: 18, height: 18, borderRadius: '50%',
            background: '#ef4444', border: '2px solid #111', cursor: 'pointer', pointerEvents: 'auto',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          <svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1 1l6 6M7 1L1 7" stroke="white" strokeWidth="1.4" strokeLinecap="round"/></svg>
        </button>
      )}
      {tools && (
        <div onMouseDown={startSize} title="Drag to make the text bigger or smaller"
          style={{
            position: 'absolute', bottom: -6, right: -6, width: 14, height: 14, borderRadius: 3,
            background: accent, border: '2px solid #111', cursor: 'nwse-resize', pointerEvents: 'auto',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          <svg width="6" height="6" viewBox="0 0 8 8" fill="none">
            <path d="M1 4h6M5 2l2 2-2 2" stroke="black" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      )}
    </div>
  )
}

/**
 * Draw media into a slot area. With rounded corners (the Corners slider) the area is black and the
 * media sits inset in a rounded box (the same look render.py builds with its corner mask); without,
 * it fills the area. The area itself may be rounded or a circle (`a.r`), and `fill` is what shows
 * round media that doesn't cover the area ('none': see-through).
 */
function inSlot(ctx: CanvasRenderingContext2D, corners: CornerStyle | undefined, a: AreaPx,
  draw: (dx: number, dy: number, dw: number, dh: number) => void,
  /** The media's box inside the slot (shares of the slot) when it was resized / moved; absent = the whole slot */
  rect?: { x: number; y: number; w: number; h: number } | null, fill = '#000',
  /**
   * Round the box's corners. Media shown whole (contain) gives its own size instead: its rounded
   * corners sit on the picture's own edges where it's fitted (render.py shown_whole does the same)
   */
  round: boolean | { w: number; h: number } = true) {
  const W = ctx.canvas.width
  const g = cornerGeometry(corners)
  ctx.save()
  clipArea(ctx, a)
  if (!g && !rect) { draw(a.x, a.y, a.w, a.h); ctx.restore(); return }
  const k = W / 1080, m = g ? g.inset * k : 0, r = g && round ? g.radius * k : 0
  const bx = a.x + (rect?.x ?? 0) * a.w, by = a.y + (rect?.y ?? 0) * a.h, bw = (rect?.w ?? 1) * a.w, bh = (rect?.h ?? 1) * a.h
  if (fill !== 'none') { ctx.fillStyle = fill; ctx.fillRect(a.x, a.y, a.w, a.h) }
  ctx.beginPath()
  const ix = bx + m, iy = by + m, iw = Math.max(1, bw - 2 * m), ih = Math.max(1, bh - 2 * m)
  if (typeof round === 'object' && round.w > 0 && round.h > 0) {
    const f = Math.min(iw / round.w, ih / round.h), fw = round.w * f, fh = round.h * f
    ctx.roundRect(ix + (iw - fw) / 2, iy + (ih - fh) / 2, fw, fh, r)
  } else ctx.roundRect(ix, iy, iw, ih, r)
  ctx.clip()
  draw(bx + m, by + m, Math.max(1, bw - 2 * m), Math.max(1, bh - 2 * m))
  ctx.restore()
}

/** A picture drawn whole inside a box (contain), centred: what doesn't cover the box stays as it was */
function containSource(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) {
  if (!sw || !sh) return
  const k = Math.min(dw / sw, dh / sh)
  const w = sw * k, h = sh * k
  ctx.drawImage(src, 0, 0, sw, sh, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h)
}

// A frame's own gradient / pattern background, drawn once per look and size (lib/shared/brandCard.ts)
const cardBgCache = new Map<string, HTMLCanvasElement>()
function frameBackground(bg: FrameBackground, W: number, H: number): HTMLCanvasElement | null {
  if (bg.style === 'solid' || W < 2 || H < 2 || typeof document === 'undefined') return null
  const key = `${W}x${H}:${JSON.stringify(bg)}`
  let c = cardBgCache.get(key)
  if (!c) {
    c = document.createElement('canvas')
    c.width = W; c.height = H
    c.getContext('2d')!.putImageData(new ImageData(backgroundPixels(bg, W, H), W, H), 0, 0)
    if (cardBgCache.size > 12) cardBgCache.delete(cardBgCache.keys().next().value!)
    cardBgCache.set(key, c)
  }
  return c
}

function paintFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  seg: SegmentLocal,
  tMs: number,
  getPositionAt: (id: string, t: number) => BoxPosition,
  pool: FrameMediaPool | null | undefined,
) {
  const W = ctx.canvas.width, H = ctx.canvas.height
  const vW = video.videoWidth, vH = video.videoHeight
  const layout = seg.layout as FrameLayout
  const frame = frameOf(seg)
  const main = new Set(frame.main_slots ?? [0])
  const bandBg = frame.band?.bg || '#000000'
  const px = (a: { x: number; y: number; w: number; h: number; radius?: number | 'circle' }): AreaPx => {
    const x = Math.round(a.x * W), y = Math.round(a.y * H)
    return { x, y, w: Math.round((a.x + a.w) * W) - x, h: Math.round((a.y + a.h) * H) - y, r: areaRadius(a) * (W / 1080) }
  }
  // Underneath everything: a blurred copy of the main video (Blur fill), the band's colour, or black
  const base = frameBase(layout)
  // The frame's own background (frame.bg, or a Branded card's look): a colour, gradient or pattern
  // behind and around its videos — as the export draws it
  const ownBg = frameBackgroundOf(layout, frame)
  ctx.fillStyle = ownBg ? ownBg.color : base === 'band' ? bandBg : '#000'
  ctx.fillRect(0, 0, W, H)
  if (ownBg) {
    const bgImg = frameBackground(ownBg, W, H)
    if (bgImg) ctx.drawImage(bgImg, 0, 0)
  }
  if (base === 'blur') {
    // The blurred picture follows what its slot shows: a photo or video put there, else the main video
    const over = itemAt(frame, BLUR_SOURCE_SLOT, tMs, seg)
    let src: CanvasImageSource | null = null, sw = 0, sh = 0
    if (over && !over.hidden && over.kind === 'photo') {
      const img = over.image_url ? pool?.image(over.image_url) : null
      if (img && img.complete && img.naturalWidth) { src = img; sw = img.naturalWidth; sh = img.naturalHeight }
    } else if (over && !over.hidden && over.kind === 'video') {
      const v = pool?.video(over)
      if (v && v.readyState >= 2) { src = v; sw = v.videoWidth; sh = v.videoHeight }
    }
    if (!src && vW && vH) { src = video; sw = vW; sh = vH }
    if (src) {
      ctx.save()
      ctx.filter = `blur(${Math.round(W / 22)}px) brightness(0.65)`
      coverSource(ctx, src, sw, sh, -W * 0.05, -H * 0.05, W * 1.1, H * 1.1)
      ctx.restore()
    }
  }
  for (const area of frameAreas(layout, frameBandShown(seg), seg.frame)) {
    const a = px(area)
    if (area.kind === 'caption') {
      // A plain strip the captions are drawn on
      const bg = area.bg ?? bandBg
      if (bg !== 'none') { ctx.fillStyle = bg; ctx.fillRect(a.x, a.y, a.w, a.h) }
      continue
    }
    if (area.kind === 'wave') { paintWave(ctx, a, area.color ?? '#c8ff00', tMs, !video.paused); continue }
    const lane = area.kind === 'band' ? area.lane : area.slot
    // A hidden item (kept only for its sound) isn't drawn: what's under it shows
    const at = itemAt(frame, lane, tMs, seg)
    const it = at?.hidden ? null : at
    if (area.kind === 'band') {
      const bg = area.bg ?? bandBg
      const elapsed = it ? tMs - Math.max(it.start_ms, seg.start_ms) : 0
      // Captions on the band are drawn with the other captions, positioned here
      if (it?.kind === 'text' && !it.captions) paintFrameText(ctx, it, bg, a, !!area.ticker, elapsed)
      else if (bg !== 'none') { ctx.save(); clipArea(ctx, a); ctx.fillStyle = bg; ctx.fillRect(a.x, a.y, a.w, a.h); ctx.restore() }
      continue
    }
    const contain = area.fit === 'contain'
    const fill = area.fill ?? (contain ? '#000' : '#111')
    // A photo or video put in a shown-whole slot replaces the main video while it shows (shown whole
    // too, it wouldn't cover it: the main video would peek around it)
    const coveredHere = contain && !!it && (it.kind === 'photo' || it.kind === 'video')
    // With its own background, a slot showing a video or photo leaves the ring around a rounded
    // one see-through: the background shows there, not black (render.py: the slot's alpha mask)
    const showsMedia = (main.has(area.slot) && !frame.main_hidden?.[String(area.slot)]) || (!!it && (it.kind === 'photo' || it.kind === 'video'))
    const ring = ownBg && !contain && showsMedia ? 'none' : '#000'
    // Underneath: the main video if this slot shows it, otherwise an empty (dark) slot
    if (fill !== 'none' && ring !== 'none') { ctx.save(); clipArea(ctx, a); ctx.fillStyle = fill; ctx.fillRect(a.x, a.y, a.w, a.h); ctx.restore() }
    if (main.has(area.slot) && !frame.main_hidden?.[String(area.slot)] && vW && vH && !coveredHere) {
      const box = seg.crop_boxes.find(b => b.slot_index === area.slot)
      // Shown whole: the video isn't cropped here — unless the slot crops the main video to its own
      // view (mainCrop: Screen + face cam's Screen, with Same video)
      if (contain && !(area.kind === 'slot' && area.mainCrop)) {
        inSlot(ctx, frame.main_corners?.[String(area.slot)], a, (dx, dy, dw, dh) => containSource(ctx, video, vW, vH, dx, dy, dw, dh), mainRect(frame, area.slot), 'none', { w: vW, h: vH })
      } else if (box) {
        const p = getPositionAt(box.id, tMs)
        inSlot(ctx, frame.main_corners?.[String(area.slot)], a,
          (dx, dy, dw, dh) => coverCrop(ctx, video, p.x * vW, p.y * vH, p.w * vW, p.h * vH, dx, dy, dw, dh),
          mainRect(frame, area.slot), ring)
      }
    }
    if (!it) continue
    if (it.kind === 'text') { paintFrameText(ctx, it, '#000000', a); continue }
    const put = (src: CanvasImageSource, sw: number, sh: number, zoom = 1, panX = 0) => (dx: number, dy: number, dw: number, dh: number) =>
      contain ? containSource(ctx, src, sw, sh, dx, dy, dw, dh) : coverSource(ctx, src, sw, sh, dx, dy, dw, dh, zoom, panX)
    if (it.kind === 'photo') {
      const img = it.image_url ? pool?.image(it.image_url) : null
      if (img && img.complete && img.naturalWidth) {
        const from = Math.max(it.start_ms, seg.start_ms), to = Math.min(it.end_ms, seg.end_ms)
        const m = photoMotion(it.motion, (tMs - from) / Math.max(1, to - from))
        inSlot(ctx, it.corners, a, put(img, img.naturalWidth, img.naturalHeight, m.zoom, m.panX), boxRect(it.rect), contain ? fill : ring, contain ? { w: img.naturalWidth, h: img.naturalHeight } : true)
      }
      continue
    }
    const v = pool?.video(it)
    if (v && v.readyState >= 2) inSlot(ctx, it.corners, a, put(v, v.videoWidth, v.videoHeight), boxRect(it.rect), contain ? fill : ring, contain ? { w: v.videoWidth, h: v.videoHeight } : true)
  }
}

/** A small canvas for Pixelate, kept between frames (only resized) */
let pixelTmp: HTMLCanvasElement | null = null
function pixelCanvas(w: number, h: number) {
  if (!pixelTmp) pixelTmp = document.createElement('canvas')
  if (pixelTmp.width !== w) pixelTmp.width = w
  if (pixelTmp.height !== h) pixelTmp.height = h
  return pixelTmp
}

/** Canvases for the sideways smear (Blur, Whip), kept between frames */
const smearTmp: HTMLCanvasElement[] = []
/**
 * `src` smeared sideways over about `box` pixels (a horizontal box blur, as ffmpeg's hblur and
 * avgblur=sizeY=1 make), onto `ctx`: squeezed narrow in halves (each halving averages, so wide
 * smears don't shimmer), then stretched back. A few small draws — far cheaper than ctx.filter.
 */
function drawSmeared(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, box: number) {
  const W = ctx.canvas.width, H = ctx.canvas.height
  const target = Math.max(2, Math.round(W / Math.max(1, box)))
  if (target >= W) { ctx.drawImage(src, 0, 0, W, H); return }
  // (at half height: a sideways smear hides it, and it halves the work)
  const h = Math.max(1, Math.ceil(H / 2))
  let cur: CanvasImageSource = src, curW = W, curH = H, i = 0
  while (curW > target) {
    const w = Math.max(target, Math.ceil(curW / 2))
    if (!smearTmp[i]) smearTmp[i] = document.createElement('canvas')
    const c = smearTmp[i++]
    if (c.width !== w) c.width = w
    if (c.height !== h) c.height = h
    const cx = c.getContext('2d')!
    cx.imageSmoothingEnabled = true
    cx.drawImage(cur, 0, 0, curW, curH, 0, 0, w, h)
    cur = c; curW = w; curH = h
  }
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(cur, 0, 0, curW, curH, 0, 0, W, H)
}
/** As drawSmeared, up and down (Swipe up: the export's avgblur=sizeY=40) */
function drawSmearedV(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, box: number) {
  const W = ctx.canvas.width, H = ctx.canvas.height
  const target = Math.max(2, Math.round(H / Math.max(1, box)))
  if (target >= H) { ctx.drawImage(src, 0, 0, W, H); return }
  const w = Math.max(1, Math.ceil(W / 2))
  let cur: CanvasImageSource = src, curW = W, curH = H, i = 8
  while (curH > target) {
    const h = Math.max(target, Math.ceil(curH / 2))
    if (!smearTmp[i]) smearTmp[i] = document.createElement('canvas')
    const c = smearTmp[i++]
    if (c.width !== w) c.width = w
    if (c.height !== h) c.height = h
    const cx = c.getContext('2d')!
    cx.imageSmoothingEnabled = true
    cx.drawImage(cur, 0, 0, curW, curH, 0, 0, w, h)
    cur = c; curW = w; curH = h
  }
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(cur, 0, 0, curW, curH, 0, 0, W, H)
}

/** A full-size canvas to put a transition frame together before smearing it */
let mixTmp: HTMLCanvasElement | null = null
function mixCanvas(W: number, H: number) {
  if (!mixTmp) mixTmp = document.createElement('canvas')
  if (mixTmp.width !== W) mixTmp.width = W
  if (mixTmp.height !== H) mixTmp.height = H
  return mixTmp
}

/** A transition the preview plays: centred on the join at `at` (clip ms), `ms` long */
export type TransitionCut = { at: number; ms: number; type: string }

/**
 * One frame of a transition: `a` (the outgoing section) giving way to `b` (the incoming one),
 * `p` from 0 to 1 — drawn the way the export's ffmpeg xfade draws that kind (render.py), so the
 * preview shows what will be made.
 */
/** Slides, Whip and Wipe move eased, as the export moves them (render.py _eased_join): a cubic ease in-out */
const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(2 - 2 * x, 3) / 2)

function drawTransition(ctx: CanvasRenderingContext2D, a: HTMLCanvasElement, b: HTMLCanvasElement, p: number, type: string) {
  const W = ctx.canvas.width, H = ctx.canvas.height
  // (the dissolves and dips run straight through, as ffmpeg's xfade does; the moves are eased below)
  const lin = Math.max(0, Math.min(1, p))
  const moves = type === 'slideleft' || type === 'slideright' || type === 'slideup' || type === 'slidedown' || type === 'smoothleft' || type === 'wipe' || type === 'wipeleft'
  const e = moves ? easeInOutCubic(lin) : lin
  ctx.save()
  switch (type) {
    case 'fadeblack': case 'fadewhite': {
      // Into the colour over the first half, out of it over the second
      ctx.fillStyle = type === 'fadeblack' ? '#000' : '#fff'
      ctx.fillRect(0, 0, W, H)
      ctx.globalAlpha = e < 0.5 ? 1 - e * 2 : e * 2 - 1
      ctx.drawImage(e < 0.5 ? a : b, 0, 0, W, H)
      break
    }
    case 'slideleft':
      ctx.drawImage(a, -e * W, 0, W, H)
      ctx.drawImage(b, (1 - e) * W, 0, W, H)
      break
    case 'slideup':
      ctx.drawImage(a, 0, -e * H, W, H)
      ctx.drawImage(b, 0, (1 - e) * H, W, H)
      break
    case 'slideright':
      ctx.drawImage(a, e * W, 0, W, H)
      ctx.drawImage(b, (e - 1) * W, 0, W, H)
      break
    case 'slidedown':
      ctx.drawImage(a, 0, e * H, W, H)
      ctx.drawImage(b, 0, (e - 1) * H, W, H)
      break
    case 'smoothleft': {
      // Whip: a push to the left, smeared sideways over its middle (the export: slideleft, then
      // avgblur=sizeX=28 over the middle 60% of a 1080-wide picture, render.py)
      // (the smear runs over the middle 60% of its time, as the export's blur)
      const smear = lin > 0.2 && lin < 0.8
      const m = smear ? mixCanvas(W, H) : null
      const t = m ? m.getContext('2d')! : ctx
      t.drawImage(a, -e * W, 0, W, H)
      t.drawImage(b, (1 - e) * W, 0, W, H)
      if (m) drawSmeared(ctx, m, W * 57 / 1080)
      break
    }
    case 'hblur': {
      // Blur: smeared sideways ever wider (half the width at the middle), the new picture
      // dissolving in under it, then sharp again — ffmpeg's hblur
      const m = mixCanvas(W, H), t = m.getContext('2d')!
      t.globalAlpha = 1
      t.drawImage(a, 0, 0, W, H)
      t.globalAlpha = e
      t.drawImage(b, 0, 0, W, H)
      t.globalAlpha = 1
      drawSmeared(ctx, m, 1 + (W / 2) * (e <= 0.5 ? e * 2 : (1 - e) * 2))
      break
    }
    case 'radial': {
      // Clock: a hand sweeps round from 12 o'clock, uncovering the new picture behind it
      ctx.drawImage(a, 0, 0, W, H)
      const r = Math.hypot(W, H)
      ctx.beginPath(); ctx.moveTo(W / 2, H / 2)
      ctx.arc(W / 2, H / 2, r, -Math.PI / 2, -Math.PI / 2 + e * Math.PI * 2); ctx.closePath(); ctx.clip()
      ctx.drawImage(b, 0, 0, W, H)
      break
    }
    case 'pixelize': {
      // Pixelate: the picture breaks into ever bigger blocks, swaps at the blockiest, then sharpens
      const q = Math.sin(Math.PI * e)
      // (blocks up to a 16th of the width at the peak, whatever the preview's size)
      const cells = Math.max(1, Math.round(W / Math.max(1, q * W / 16)))
      const tmp = pixelCanvas(cells, Math.max(1, Math.round(cells * H / W)))
      const t = tmp.getContext('2d')
      if (!t) { ctx.drawImage(e < 0.5 ? a : b, 0, 0, W, H); break }
      t.imageSmoothingEnabled = true
      t.globalAlpha = 1
      t.drawImage(a, 0, 0, tmp.width, tmp.height)
      t.globalAlpha = e
      t.drawImage(b, 0, 0, tmp.width, tmp.height)
      ctx.imageSmoothingEnabled = q < 0.05
      ctx.drawImage(tmp, 0, 0, W, H)
      break
    }
    // ── The trending ones (render.py _CUSTOM_TRANSITIONS: the same moves, so the preview matches) ──
    case 'swipeup': {
      // Swipe up: a slide up, smeared up and down over its middle 60%
      const smear = e > 0.2 && e < 0.8
      const m = smear ? mixCanvas(W, H) : null
      const t = m ? m.getContext('2d')! : ctx
      t.drawImage(a, 0, -e * H, W, H)
      t.drawImage(b, 0, (1 - e) * H, W, H)
      if (m) drawSmearedV(ctx, m, H * 40 / 1920)
      break
    }
    case 'velocity': case 'zoomout': case 'spin': case 'warp': case 'shake': {
      // Each changes the first picture up to the middle, then lands the second (on black)
      const ss = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t) }
      const first = e < 0.5
      const u = first ? e / 0.5 : (e - 0.5) / 0.5
      const img = first ? a : b
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, W, H)
      ctx.translate(W / 2, H / 2)
      if (type === 'velocity') {
        const s = first ? 1 + 1.2 * u * u * u : 0.55 + 0.45 * (1 - (1 - u) ** 3)
        ctx.scale(s, s)
      } else if (type === 'zoomout') {
        const s = first ? 1 - 0.65 * ss(u) : 1.9 - 0.9 * ss(u)
        ctx.scale(s, s)
      } else if (type === 'spin') {
        const k = ss(u)
        ctx.rotate(first ? 3.4907 * k : -2.7925 * (1 - k))
        const s = first ? 1 + 0.6 * k : 1.6 - 0.6 * k
        ctx.scale(s, s)
      } else if (type === 'warp') {
        const k = first ? ss(u) : 1 - ss(u)
        const sx = 1 + 2.2 * k, sy = 1 - 0.2 * k, sk = (first ? -0.25 : 0.25) * k
        ctx.transform(sx, 0, sk * sy, sy, 0, 0)
      } else {
        // shake: a jolt of up to 5% of the width, framed 12% in so no edge shows
        const amp = Math.sin(Math.PI * e) * 0.05 * W
        ctx.scale(1.12, 1.12)
        ctx.translate(-amp * Math.sin(e * 61), -amp * 0.6 * Math.cos(e * 47))
      }
      ctx.drawImage(img, -W / 2, -H / 2, W, H)
      if (type === 'warp') {
        // (brighter while stretched)
        const k = first ? ss(u) : 1 - ss(u)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = 0.2 * k
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, W, H)
      }
      break
    }
    case 'glitch': {
      // Ten bands torn sideways by a changing amount, between 30% and 70% of the way
      const img = e < 0.5 ? a : b
      const on = e >= 0.3 && e <= 0.7 ? Math.sin(Math.PI * Math.max(0, Math.min(1, (e - 0.3) / 0.4))) : 0
      if (!on) { ctx.drawImage(img, 0, 0, W, H); break }
      const step = Math.floor(e * 24)
      const bandH = H / 10, sw = img.width, sh = img.height
      for (let i = 0; i < 10; i++) {
        const r = Math.sin(i * 12.9898 + step * 78.233) * 43758.5453
        const off = on * (r - Math.floor(r) - 0.5) * 0.16 * W
        const y = i * bandH
        ctx.drawImage(img, 0, (y / H) * sh, sw, (bandH / H) * sh, -off, y, W, bandH + 1)
      }
      break
    }
    case 'flare': {
      // Light leak: the cut at the middle, under a warm band of light sweeping across
      ctx.drawImage(e < 0.5 ? a : b, 0, 0, W, H)
      const c = W * (1.3 - 1.6 * e), sig = 0.14 * W, k = Math.sin(Math.PI * e)
      const g = ctx.createLinearGradient(c - 2.2 * sig, 0, c + 2.2 * sig, 0)
      g.addColorStop(0, 'rgba(255,170,90,0)')
      g.addColorStop(0.35, 'rgba(255,170,90,0.55)')
      g.addColorStop(0.5, 'rgba(255,236,200,1)')
      g.addColorStop(0.65, 'rgba(255,150,80,0.55)')
      g.addColorStop(1, 'rgba(255,150,80,0)')
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 0.85 * k
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
      break
    }
    case 'wipe': case 'wipeleft':
      // The new picture comes in from the right edge, moving left
      ctx.drawImage(a, 0, 0, W, H)
      ctx.beginPath(); ctx.rect(W * (1 - e), 0, W * e + 1, H); ctx.clip()
      ctx.drawImage(b, 0, 0, W, H)
      break
    case 'zoomin': {
      // Zoom: the old picture rushes in to its centre over the first half, then the new one
      // dissolves in over it — ffmpeg's zoomin (the export): the old picture sampled at
      // smoothstep(0.5, 1, 1 - p) of its size, mixed with the new by smoothstep(0, 0.5, 1 - p)
      const ss = (lo: number, hi: number, x: number) => { const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t) }
      const q = 1 - e
      const zf = ss(0.5, 1, q)
      const sw = Math.max(1, a.width * zf), sh = Math.max(1, a.height * zf)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(a, (a.width - sw) / 2, (a.height - sh) / 2, sw, sh, 0, 0, W, H)
      const mixB = 1 - ss(0, 0.5, q)
      if (mixB > 0) { ctx.globalAlpha = mixB; ctx.drawImage(b, 0, 0, W, H) }
      break
    }
    case 'circleopen':
      ctx.drawImage(a, 0, 0, W, H)
      ctx.beginPath(); ctx.arc(W / 2, H / 2, e * Math.hypot(W, H) / 2, 0, Math.PI * 2); ctx.clip()
      ctx.drawImage(b, 0, 0, W, H)
      break
    default:   // 'fade': a dissolve
      ctx.drawImage(a, 0, 0, W, H)
      ctx.globalAlpha = e
      ctx.drawImage(b, 0, 0, W, H)
  }
  ctx.restore()
}

function paintSegment(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  seg: SegmentLocal | null,
  tMs: number,
  getPositionAt: (id: string, t: number) => BoxPosition,
  pool?: FrameMediaPool | null,
  /** A split/trio slot's own picture (a borrowed reaction from another moment): null = draw `video`,
   *  false = it has its own picture but it isn't ready (stays dark for that moment, never the wrong one) */
  slotSource?: ((seg: SegmentLocal, box: SegmentLocal['crop_boxes'][number]) => HTMLVideoElement | null | false) | null,
) {
  if (seg && isFrameLayout(seg.layout)) { paintFrame(ctx, video, seg, tMs, getPositionAt, pool); return }
  const W = ctx.canvas.width, H = ctx.canvas.height
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  const vW = video.videoWidth, vH = video.videoHeight
  if (!vW || !vH) return

  if (!seg) {
    const scale = Math.min(W / vW, H / vH)
    ctx.drawImage(video, (W - vW * scale) / 2, (H - vH * scale) / 2, vW * scale, vH * scale)
    return
  }

  const { layout, crop_boxes } = seg
  if (layout === 'vertical' || layout === 'spotlight' || layout === 'centered') {
    const box = crop_boxes[0]; if (!box) return
    const p = getPositionAt(box.id, tMs)
    const srcW = p.w * vW, srcH = p.h * vH
    const srcAR = srcW / (srcH || 1), dstAR = W / H
    if (srcAR > dstAR) {
      const fitW = srcH * dstAR
      ctx.drawImage(video, p.x * vW + (srcW - fitW) / 2, p.y * vH, fitW, srcH, 0, 0, W, H)
    } else if (srcAR < dstAR) {
      const fitH = srcW / dstAR
      ctx.drawImage(video, p.x * vW, p.y * vH + (srcH - fitH) / 2, srcW, fitH, 0, 0, W, H)
    } else {
      ctx.drawImage(video, p.x * vW, p.y * vH, srcW, srcH, 0, 0, W, H)
    }
  } else if (layout === 'split' || layout === 'trio') {
    const n = layout === 'split' ? 2 : 3
    const slotH = H / n
    crop_boxes.slice(0, n).forEach((box, i) => {
      const p = getPositionAt(box.id, tMs)
      const own = slotSource?.(seg, box)
      // A borrowed slot still loading stays dark for a moment rather than showing the wrong moment
      if (own === false || (own && own.readyState < 2)) return
      const src = own ?? video
      const sW = own ? own.videoWidth || vW : vW, sH = own ? own.videoHeight || vH : vH
      // A slot framing the whole picture (a related visual) shows it whole, fitted with bars,
      // as the export does (render.py _is_full_frame)
      if (p.x < 0.005 && p.y < 0.005 && p.w > 0.995 && p.h > 0.995) {
        const k = Math.min(W / sW, slotH / sH)
        ctx.drawImage(src, 0, 0, sW, sH, (W - sW * k) / 2, i * slotH + (slotH - sH * k) / 2, sW * k, sH * k)
        return
      }
      coverCrop(ctx, src, p.x * sW, p.y * sH, p.w * sW, p.h * sH, 0, i * slotH, W, slotH)
    })
  } else if (layout === 'horizontal') {
    const box = crop_boxes[0]; if (!box) return
    const p = getPositionAt(box.id, tMs)
    const srcAR = (p.w * vW) / (p.h * vH || 1)
    const dH = W / (srcAR || 1)
    ctx.drawImage(video, p.x * vW, p.y * vH, p.w * vW, p.h * vH, 0, (H - dH) / 2, W, dH)
  }
}

// ── Caption rendering ────────────────────────────────────────────────────────

const CAPTION_MAX_WORDS = 5
const CAPTION_GAP_MS = 300

// Tag words whose timestamps were estimated from a phrase-level Sarvam token.
type FlatWord = TranscriptWord & { _est?: true }

export function buildCaptionChunks(words: TranscriptWord[], maxWords = CAPTION_MAX_WORDS): FlatWord[][] {
  if (words.length === 0) return []
  const sorted = [...words].sort((a, b) => a.start_ms - b.start_ms)
  const chunks: FlatWord[][] = []
  let wordChunk: FlatWord[] = []   // accumulator for genuine single-word tokens

  const flushWordChunk = () => {
    if (wordChunk.length > 0) { chunks.push(wordChunk); wordChunk = [] }
  }

  for (const w of sorted) {
    const parts = w.word.trim().split(/\s+/).filter(Boolean)
    // Line rules use the original word (romanizing can turn one word into two, e.g. "opium ni"),
    // matching render.py _group_sentences so the preview and the download break lines alike
    const source = (w as TranscriptWord & { source_word?: string }).source_word ?? w.word

    if (source.trim().split(/\s+/).length <= 1) {
      // Real word-level token — group up to CAPTION_MAX_WORDS together.
      const prev = wordChunk[wordChunk.length - 1]
      const gap = prev ? w.start_ms - prev.end_ms : 0
      // A different speaker always starts a new line (never mix two people's words)
      const speakerChange = !!prev && prev.speaker_id != null && w.speaker_id != null && prev.speaker_id !== w.speaker_id
      if (wordChunk.length >= maxWords || (prev && gap > CAPTION_GAP_MS) || speakerChange) {
        flushWordChunk()
      }
      wordChunk.push(w)
      // End the line at a sentence end — same rule as the renderer (render.py _group_sentences),
      // so the preview doesn't carry the next sentence's first words on the current line
      if (/[.!?।]$/.test(source.trim())) flushWordChunk()
    } else {
      // Phrase-level token (Sarvam returned a multi-word "word").
      // Split into display chunks and divide the phrase's actual time evenly
      // across those chunks — so chunk boundaries stay anchored to the real
      // phrase start/end instead of drifting with character-count estimates.
      flushWordChunk()

      const numDisplayChunks = Math.ceil(parts.length / maxWords)
      const phraseDurMs = w.end_ms - w.start_ms
      const chunkDurMs = phraseDurMs / numDisplayChunks

      for (let ci = 0; ci < numDisplayChunks; ci++) {
        const chunkWords = parts.slice(ci * maxWords, (ci + 1) * maxWords)
        const chunkStartMs = Math.round(w.start_ms + ci * chunkDurMs)
        const chunkEndMs = ci === numDisplayChunks - 1
          ? w.end_ms
          : Math.round(w.start_ms + (ci + 1) * chunkDurMs)
        const wordDurMs = (chunkEndMs - chunkStartMs) / chunkWords.length

        chunks.push(
          chunkWords.map((word, wi) => ({
            ...w,
            word,
            start_ms: Math.round(chunkStartMs + wi * wordDurMs),
            end_ms: wi === chunkWords.length - 1
              ? chunkEndMs
              : Math.round(chunkStartMs + (wi + 1) * wordDurMs),
            _est: true,
          } as FlatWord))
        )
      }
    }
  }
  flushWordChunk()

  // Line end — same rule as render.py _write_ass: hold 200 ms after the last word, bridge
  // gaps under 500 ms to the next line, never overlap it. Larger gaps are real pauses and
  // stay empty. Copies the word (never mutate: words are shared with editor state).
  for (let i = 0; i < chunks.length; i++) {
    const last = chunks[i][chunks[i].length - 1]
    const nextStart = chunks[i + 1]?.[0].start_ms
    let end = last.end_ms + 200
    if (nextStart !== undefined) {
      if (nextStart - last.end_ms < 500) end = nextStart
      end = Math.min(end, nextStart)
    }
    // (cut short too: a word whose end runs on past the next line — a leftover from an earlier
    // reading — would hold its line on screen over the next ones)
    if (end !== last.end_ms) chunks[i][chunks[i].length - 1] = { ...last, end_ms: Math.max(last.start_ms, end) }
  }

  return chunks
}

/** The line on screen at `tMs`: of the lines covering it, the one that started last */
function findCaptionChunk(chunks: FlatWord[][], tMs: number) {
  let found: FlatWord[] | null = null
  for (const c of chunks) {
    if (c[0].start_ms > tMs) break
    if (tMs <= c[c.length - 1].end_ms) found = c
  }
  return found
}

// ── Animated caption presets ──────────────────────────────────────────────────
// Mirrors render.py _preset_events: same lines, timing and colours as the export.
//   pop       — each word appears when spoken, scaling 80% → 110% → 100% in 150 ms
//   highlight — 3 words a line; a highlight_color box behind the spoken word
//   bounce    — the line slides up into place and fades in; the spoken word in highlight_color
//   word      — one big word at a time, centre screen
//   hormozi   — 3 capitalised words a line, thick outline; the spoken word in highlight_color, 115%
//   box       — the line on a dark box, no outline; the spoken word in highlight_color
//   glow      — words glow in highlight_color; the spoken word bright, the others dimmed
// Emphasised words (style.emphasis, keyed by the word's start_ms) are highlight_color and 15% larger.

export const PRESET_ANIMATIONS = ['pop', 'highlight', 'bounce', 'word', 'hormozi', 'box', 'glow'] as const
const isPreset = (a?: string | null) => (PRESET_ANIMATIONS as readonly string[]).includes(a ?? '')
const POP_MS = 150
const BOUNCE_MS = 180
const BOX_PAD = 14
const WORD_SCALE = 1.5
const EMPHASIS_SCALE = 1.15
const HORMOZI_SCALE = 1.15      // the spoken word
const HORMOZI_STROKE = 2        // added to the outline
const LINE_BOX = 'rgba(0,0,0,0.62)'   // box preset (render.py &H60000000)
const GLOW_BLUR = 6             // px at 1080 wide
const GLOW_DIM = 0.65           // the words not being spoken

/** The karaoke colour of the spoken word: the highlight colour, unless it is the text's own */
export function karaokeLive(color: string, hl: string) {
  if (hl.toLowerCase() !== color.toLowerCase()) return hl
  return color.toLowerCase() === '#ffffff' ? '#FFE700' : '#FFFFFF'
}

// The export draws captions with these bundled fonts (render.py _FONT_FILES; anything else falls
// back to Roboto) through libass, which sizes a font so its full height (OS/2 winAscent +
// winDescent) equals the caption size. The preview loads the same files (public/caption-fonts)
// and applies the same factor (unitsPerEm / (winAscent + winDescent)), so preset captions come
// out the size they will be in the download.
const EXPORT_FONTS: Record<string, { family: string; file: string; em: number }> = {
  'noto-sans-telugu':     { family: 'CC Noto Sans Telugu', file: 'NotoSansTelugu-Regular.ttf', em: 0.677 },
  'noto-sans-devanagari': { family: 'CC Noto Sans Devanagari', file: 'NotoSansDevanagari-Regular.ttf', em: 0.525 },
  'roboto':               { family: 'CC Roboto', file: 'Roboto-Regular.ttf', em: 0.758 },
  'montserrat-bold':      { family: 'CC Montserrat Bold', file: 'Montserrat-Bold.ttf', em: 0.640 },
}
const loadedExportFonts = new Set<string>()
function exportFont(id?: string | null) {
  const f = EXPORT_FONTS[id ?? ''] ?? EXPORT_FONTS.roboto
  if (!loadedExportFonts.has(f.family) && typeof FontFace !== 'undefined') {
    loadedExportFonts.add(f.family)
    new FontFace(f.family, `url(/caption-fonts/${f.file})`).load()
      .then(face => document.fonts.add(face))
      .catch(() => loadedExportFonts.delete(f.family))
  }
  return f
}

/**
 * Where captions sit when they haven't been moved (position_y unset), as each look draws them: a
 * Creator style's own place (Behind near the top…), "One word" in the middle, the rest near the
 * bottom. The box that moves them starts from here, so they stay under the pointer.
 */
export function captionDefaultY(style: Partial<CaptionStyle>): number {
  const tpl = templateOf(style)
  if (tpl?.look) return CREATOR_DEFAULT_Y[tpl.look]
  return (tpl ? tpl.base : style.animation) === 'word' ? 0.5 : 0.84
}

/** Words per caption line for a style (render.py _preset_events uses the same rule) */
export function captionWordsPerLine(style: Partial<CaptionStyle>) {
  const tpl = templateOf(style)
  if (!tpl && style.animation === 'word') return 1
  if (style.words_per_line) return Math.max(1, Math.min(8, style.words_per_line))
  if (tpl) return tpl.perLine
  return style.animation === 'highlight' || style.animation === 'hormozi' ? 3 : CAPTION_MAX_WORDS
}

/** Black or white, whichever reads on a box of this colour (render.py _text_on) */
function textOn(hex: string) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000000' : '#FFFFFF'
}

/** How a caption font is drawn on the canvas: its family, the size factor, and its weight / slant */
type DrawFont = { family: string; em: number; weight: number; italic: boolean }
/**
 * A caption style's font (modules/captions/templates.ts), loaded from the same file the export
 * uses. Registered at the weight and slant the file already is, so the browser draws it as it is
 * (libass does the same: render.py _TEMPLATE_FONTS).
 */
function templateFont(key: string): DrawFont | null {
  const f = TEMPLATE_FONTS[key]
  if (!f) return null
  const family = templateFontFamily(key)
  if (!loadedExportFonts.has(family) && typeof FontFace !== 'undefined') {
    loadedExportFonts.add(family)
    new FontFace(family, `url(/caption-fonts/${f.file})`, { weight: String(f.weight), style: f.italic ? 'italic' : 'normal' }).load()
      .then(face => document.fonts.add(face))
      .catch(() => loadedExportFonts.delete(family))
  }
  return { family, em: f.em, weight: f.weight, italic: !!f.italic }
}

/** Where the captions were drawn (shares of the canvas): for the box that moves and resizes them on the preview */
type CaptionRect = { x: number; y: number; w: number; h: number }
type CaptionRectOut = { rect: CaptionRect | null }

function drawPresetCaptions(
  ctx: CanvasRenderingContext2D,
  chunk: FlatWord[],
  tMs: number,
  style: Partial<CaptionStyle>,
  band?: { y: number; h: number } | null,
  out?: CaptionRectOut,
) {
  const W = ctx.canvas.width, H = ctx.canvas.height
  const k = W / 1080                                   // export is laid out at 1080 wide
  // A caption style (template) is drawn as its base preset, with its own settings (render.py _TEMPLATES)
  const tpl = templateOf(style)
  const anim: string = tpl ? tpl.base : style.animation!
  const color = style.color ?? '#FFFFFF'
  const hl = style.highlight_color ?? '#FFE700'
  const stroke = ((tpl?.stroke ?? style.stroke_width ?? 4) + (anim === 'hormozi' && !tpl ? HORMOZI_STROKE : 0)) * k * (anim === 'box' ? 0 : 1)
  const shadow = (tpl?.shadow ?? 2) * k
  const upper = style.uppercase || (tpl ? !!tpl.upper : anim === 'hormozi')
  const emphasis = style.emphasis ?? {}
  const baseScale = anim === 'word' ? WORD_SCALE : 1
  const spokenScale = tpl?.scale ? tpl.scale / 100 : HORMOZI_SCALE
  // A template's own fonts, for text they can draw (Latin letters). Otherwise, as before: the Noto
  // Indic fonts have no Latin letters, so Roman-letter captions use Roboto (as render.py), and
  // these are drawn bold (libass thickens them: the style asks for bold)
  const latin = style.language === 'roman' || isLatinText(chunk.map(w => w.word).join(' '))
  const plain = exportFont(style.language === 'roman' ? 'roboto' : style.font)
  const baseFont: DrawFont = (tpl && latin ? templateFont(tpl.font) : null) ?? { family: plain.family, em: plain.em, weight: 700, italic: false }
  const liveFont = tpl?.liveFont && latin ? templateFont(tpl.liveFont) : null
  // The caption size as libass takes it: every font is sized so its full height is this
  const lineH = (style.size ?? 52) * (tpl && latin ? tpl.size / 100 : 1) * k
  const fontOf = (f: DrawFont, scale: number) =>
    `${f.italic ? 'italic ' : ''}${f.weight} ${lineH * f.em * scale}px ${captionEmojiFamily(f.em)}, "${f.family}", sans-serif`
  const lineStart = chunk[0].start_ms
  const lineEnd = chunk[chunk.length - 1].end_ms

  const posY = style.position_y ?? (anim === 'word' ? 0.5 : 0.84)
  let y = band ? (band.y + band.h / 2) * H : posY * H
  let alpha = 1
  if (anim === 'bounce') {
    const p = Math.min(1, Math.max(0, (tMs - lineStart) / BOUNCE_MS))
    y += (1 - p) * H * 0.02
    alpha = Math.min(1, Math.max(0, (tMs - lineStart) / 80))
  }

  // Per word: text, scale, colour, visibility, spoken, font
  const items = chunk.map((w, j) => {
    const text = upper ? w.word.toUpperCase() : w.word
    const on = w.start_ms, off = chunk[j + 1]?.start_ms ?? lineEnd
    const emph = !!emphasis[String(w.start_ms)]
    let scale = baseScale * (emph ? EMPHASIS_SCALE : 1)
    let visible = true
    if (anim === 'pop' || anim === 'word') {
      const dt = tMs - on
      if (dt < 0) { visible = false; scale *= 0.8 }
      else if (dt < POP_MS / 2) scale *= 0.8 + 0.3 * (dt / (POP_MS / 2))
      else if (dt < POP_MS) scale *= 1.1 - 0.1 * ((dt - POP_MS / 2) / (POP_MS / 2))
    }
    const spoken = tMs >= on && tMs < off
    if (anim === 'hormozi' && spoken) scale *= spokenScale
    // (on a box an emphasised word stays the text colour: only bigger)
    const rest = emph && !tpl?.box ? hl : color
    const fill = anim === 'word' || anim === 'glow' || tpl?.liveText ? rest : spoken ? (anim === 'highlight' ? textOn(hl) : hl) : rest
    return { text, scale, visible, spoken, fill, font: spoken && liveFont ? liveFont : baseFont }
  })

  ctx.save()
  ctx.globalAlpha = alpha
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.lineJoin = 'round'
  const widths = items.map(it => { ctx.font = fontOf(it.font, it.scale); return ctx.measureText(it.text).width })
  ctx.font = fontOf(baseFont, 1)
  const space = ctx.measureText(' ').width
  // Where each word goes: along one line, or (stack) one word a line, the block centred on y
  const total = widths.reduce((a, b) => a + b, 0) + space * (items.length - 1)
  const at: { x: number; y: number }[] = []
  if (tpl?.stack) {
    const heights = items.map(it => lineH * it.scale)
    let top = y - heights.reduce((a, b) => a + b, 0) / 2
    items.forEach((_, j) => { at.push({ x: (W - widths[j]) / 2, y: top + heights[j] / 2 }); top += heights[j] })
  } else {
    let x = (W - total) / 2
    items.forEach((_, j) => { at.push({ x, y }); x += widths[j] + space })
  }
  if (out) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    items.forEach((it, j) => {
      const h = lineH * it.scale
      x0 = Math.min(x0, at[j].x); x1 = Math.max(x1, at[j].x + widths[j])
      y0 = Math.min(y0, at[j].y - h / 2); y1 = Math.max(y1, at[j].y + h / 2)
    })
    if (isFinite(x0)) out.rect = { x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H }
  }
  if (anim === 'box' || (tpl?.box && !tpl.stack)) {
    // One box round the whole line (libass BorderStyle 3: the text's full height plus the padding):
    // dark glass, or a template's colour
    const pad = BOX_PAD * k, x0 = (W - total) / 2
    ctx.fillStyle = tpl?.box === 'hl' ? hl : tpl?.box ?? LINE_BOX
    ctx.fillRect(x0 - pad, y - lineH / 2 - pad, total + pad * 2, lineH + pad * 2)
  }
  items.forEach((it, j) => {
    const w = widths[j], { x, y: wy } = at[j]
    ctx.font = fontOf(it.font, it.scale)
    if (it.visible && anim === 'glow') {
      // libass blurs the 3 px outline: a soft halo, not a solid ring
      const a = alpha * (it.spoken ? 1 : GLOW_DIM)
      ctx.globalAlpha = a * 0.45
      ctx.shadowColor = hl
      ctx.shadowBlur = GLOW_BLUR * 2 * k
      ctx.lineWidth = 3 * 2 * k
      ctx.strokeStyle = hl
      ctx.strokeText(it.text, x, wy)
      ctx.shadowBlur = 0
      ctx.shadowColor = 'transparent'
      ctx.globalAlpha = a
      ctx.fillStyle = it.fill
      ctx.fillText(it.text, x, wy)
      ctx.globalAlpha = alpha
    } else if (it.visible) {
      if (anim === 'highlight' && it.spoken) {
        // libass boxes the font's full height (the caption size) plus the padding
        const pad = BOX_PAD * k, hPx = lineH * it.scale
        ctx.fillStyle = hl
        ctx.fillRect(x - pad, wy - hPx / 2 - pad, w + pad * 2, hPx + pad * 2)
      } else if (anim !== 'box') {
        // The outline with its drop shadow; with no outline the letters cast the shadow themselves
        ctx.shadowColor = 'rgba(0,0,0,0.5)'
        ctx.shadowOffsetX = ctx.shadowOffsetY = shadow
        if (stroke > 0) {
          ctx.lineWidth = stroke * 2
          ctx.strokeStyle = '#000000'
          ctx.strokeText(it.text, x, wy)
        } else if (shadow > 0) {
          ctx.fillStyle = it.fill
          ctx.fillText(it.text, x, wy)
        }
        ctx.shadowColor = 'transparent'
        ctx.shadowOffsetX = ctx.shadowOffsetY = 0
      }
      ctx.fillStyle = it.fill
      ctx.fillText(it.text, x, wy)
    }
  })
  ctx.restore()
}

function drawCaptions(
  ctx: CanvasRenderingContext2D,
  chunks: FlatWord[][],
  tMs: number,
  style: Partial<CaptionStyle>,
  textCase: TextCase,
  /** A frame's text band showing the captions: centre them in it instead of at position_y */
  band?: { y: number; h: number } | null,
  /** Filled in with where the captions were drawn */
  out?: CaptionRectOut,
) {
  // Moved left or right (position_x): drawn centred there, as the export does (render.py
  // _caption_x); in a frame's text band they stay in its middle
  const dx = band ? 0 : (Math.min(1, Math.max(0, style.position_x ?? 0.5)) - 0.5) * ctx.canvas.width
  if (!dx) { drawCaptionsCentred(ctx, chunks, tMs, style, textCase, band, out); return }
  ctx.save()
  ctx.translate(dx, 0)
  try { drawCaptionsCentred(ctx, chunks, tMs, style, textCase, band, out) } finally { ctx.restore() }
  if (out?.rect) out.rect = { ...out.rect, x: out.rect.x + dx / ctx.canvas.width }
}

/** The captions drawn centred left to right (drawCaptions moves them where they were dragged) */
function drawCaptionsCentred(
  ctx: CanvasRenderingContext2D,
  chunks: FlatWord[][],
  tMs: number,
  style: Partial<CaptionStyle>,
  textCase: TextCase,
  band?: { y: number; h: number } | null,
  out?: CaptionRectOut,
) {
  const W = ctx.canvas.width, H = ctx.canvas.height
  const chunk = findCaptionChunk(chunks, tMs)
  if (!chunk) return
  // A Creator style (a template with a look) is laid out its own way: modules/captions/creator.ts
  // (any script: a line in Telugu, Hindi… in its Noto font, as the export does)
  const tpl = templateOf(style)
  if (tpl?.look) {
    const person = tpl.look === 'behind' ? personMask(ctx.canvas, tMs) : null
    const rect = drawCreatorCaptions(ctx, chunk, chunks.indexOf(chunk), chunk[chunk.length - 1].end_ms, tMs, style, tpl, person)
    if (out) out.rect = rect
    return
  }
  // (a caption style — style.template — is a preset in its own look)
  if (isPreset(style.animation) || tpl) { drawPresetCaptions(ctx, chunk, tMs, style, band, out); return }

  const color     = style.color    ?? '#FFFFFF'
  const animation = style.animation ?? 'karaoke'

  // As the export draws these (render.py _write_ass, Default style): the bundled font (Roboto for
  // Roman letters or any other font), sized the way libass sizes it, regular weight, a 3 px black
  // outline and a 2 px half-black shadow (px at 1080 wide)
  const k          = W / 1080
  const font       = exportFont(style.language === 'roman' ? 'roboto' : style.font)
  const fontSize   = Math.round((style.size ?? 52) * k * font.em)
  const lineHeight = Math.round(fontSize * 1.4)
  const PAD_X      = Math.round(W * 0.05)
  const maxLineW   = W - PAD_X * 2
  const fontFamily = `${captionEmojiFamily(font.em)}, "${font.family}", sans-serif`

  ctx.save()
  ctx.font         = `400 ${fontSize}px ${fontFamily}`
  ctx.textBaseline = 'middle'
  ctx.lineJoin     = 'round'
  ctx.lineWidth    = 2 * 3 * k
  ctx.strokeStyle  = '#000000'
  ctx.shadowColor  = 'rgba(0,0,0,0.5)'
  ctx.shadowOffsetX = ctx.shadowOffsetY = 2 * k

  // Words are already single-token after buildCaptionChunks explodes phrases.
  const wordTexts = chunk.map(w => applyCase(w.word, textCase))

  // Wrap into screen lines.
  const lines: string[][] = []
  let cur: string[] = []
  for (const wt of wordTexts) {
    const probe = [...cur, wt]
    if (cur.length > 0 && ctx.measureText(probe.join(' ')).width > maxLineW) {
      lines.push(cur)
      cur = [wt]
    } else {
      cur = probe
    }
  }
  if (cur.length > 0) lines.push(cur)

  const totalH = lines.length * lineHeight
  const yBase  = band
    ? (band.y + band.h / 2) * H - totalH / 2 + lineHeight / 2
    // centred on position_y, as libass centres the line there (\pos with alignment 5)
    : (style.position_y ?? 0.84) * H - totalH / 2 + lineHeight / 2
  if (out) {
    const maxW = Math.max(...lines.map(ln => ctx.measureText(ln.join(' ')).width))
    out.rect = { x: (W - maxW) / 2 / W, y: (yBase - lineHeight / 2) / H, w: maxW / W, h: totalH / H }
  }

  // Only do per-word karaoke when timestamps are real (not evenly distributed from a phrase split).
  // Estimated words (_est=true) have proportional-but-approximate timestamps that look wrong when highlighted.
  const hasEstimated = chunk.some(w => w._est)
  // A word stays lit until the next one starts (render.py _write_ass does the same)
  const activeWIdx = (animation === 'karaoke' && !hasEstimated)
    ? chunk.findIndex((w, j) => tMs >= w.start_ms && tMs < (chunk[j + 1]?.start_ms ?? w.end_ms + 1))
    : -1
  const live = karaokeLive(color, style.highlight_color ?? '#FFE700')

  // Track cumulative word index so each token maps to its chunk position.
  let wordOffset = 0
  lines.forEach((ln, li) => {
    const y = yBase + li * lineHeight
    const lineStart = wordOffset
    wordOffset += ln.length

    const activeInLine = activeWIdx >= lineStart && activeWIdx < wordOffset

    if (!activeInLine) {
      ctx.fillStyle = color
      ctx.textAlign = 'center'
      ctx.strokeText(ln.join(' '), W / 2, y)
      ctx.fillText(ln.join(' '), W / 2, y)
    } else {
      const spW    = ctx.measureText(' ').width
      const widths = ln.map(w => ctx.measureText(w).width)
      const rowW   = widths.reduce((s, w) => s + w, 0) + spW * (ln.length - 1)
      let x        = (W - rowW) / 2
      ln.forEach((word, i) => {
        ctx.textAlign = 'left'
        ctx.fillStyle = lineStart + i === activeWIdx ? live : color
        ctx.strokeText(word, x, y)
        ctx.fillText(word, x, y)
        x += widths[i] + (i < ln.length - 1 ? spW : 0)
      })
    }
  })

  ctx.restore()
}

// ── Text overlay rendering ────────────────────────────────────────────────────

function drawTextOverlays(
  ctx: CanvasRenderingContext2D,
  overlays: TextOverlayType[],
  tMs: number,
  paused = false,
) {
  for (const o of overlays) {
    // A text whose animation was just picked replays it now, even outside its time or while paused
    const replay = textReplayElapsed(o.id)
    if (replay == null && (tMs < o.start_ms || tMs >= o.end_ms)) continue
    if (o.x == null) { drawCenteredText(ctx, o); continue }
    // Time into the entrance: the replay's; paused = finished (never stuck invisible on its first
    // frame); playing = from when the text starts
    const elapsed = replay ?? (paused ? Infinity : tMs - o.start_ms)
    drawStyledText(ctx, o, elapsed)
  }
}

/** A canvas for measuring text off screen (the drag box needs the same lines as the canvas) */
let wrapCtx: CanvasRenderingContext2D | null = null
function measurer(): CanvasRenderingContext2D | null {
  if (!wrapCtx && typeof document !== 'undefined') wrapCtx = document.createElement('canvas').getContext('2d')
  return wrapCtx
}

/**
 * The lines a positioned text is shown in, for a frame `frameW` px wide. Line breaks are measured
 * with the export's own font file at its own weight (render.py draws text with it), so the lines
 * break where the exported video breaks them — whatever font the preview draws with.
 */
export function textOverlayLines(o: Pick<TextOverlayType, 'text' | 'uppercase' | 'font' | 'size' | 'w'>, frameW: number): string[] {
  const full = shownText(o)
  if (!o.w || !(o.w > 0)) return full.split('\n')
  const ctx = measurer()
  if (!ctx) return full.split('\n')
  const f = exportFont(o.font)
  ctx.save()
  ctx.font = `400 ${(o.size ?? 72) * frameW / 1080}px ${emojiFamily()}, "${f.family}", sans-serif`
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px'
  const lines = wrapTextLines(full, o.w * frameW, s => ctx.measureText(s).width)
  ctx.restore()
  return lines
}

/**
 * One positioned text with its Text-tool styling: weight, italic, capitals, letter spacing,
 * opacity, rotation, outline, background box, shadow / glow, and its entrance animation
 * (`elapsed` = ms since the text came in). Sizes are px at 1080 wide, like the export.
 * (The panel's tiles show the same look in CSS: modules/editor/textStyle.ts)
 */
function drawStyledText(ctx: CanvasRenderingContext2D, o: TextOverlayType, elapsed: number) {
  const W = ctx.canvas.width, H = ctx.canvas.height
  const k = W / 1080
  const fontSize = Math.max(8, Math.round((o.size ?? 72) * k))
  // A bundled font id (e.g. 'roboto') draws with the export's own file, as drawtext does
  const bundled = EXPORT_FONTS[o.font ?? ''] ? exportFont(o.font) : null
  const fontFamily = `${emojiFamily()}, ${bundled ? `"${bundled.family}", sans-serif` : (o.font ?? 'sans-serif')}`
  const weight = o.weight ?? (bundled ? 400 : 700)
  const full = shownText(o)

  // Entrance animation over the first moments the text is on screen
  const dt = elapsed
  const anim = o.animation ?? 'none'
  const long = anim === 'drop' || anim === 'bounce' || anim === 'spin' || anim === 'glitch' || anim === 'flicker'
  const p = Math.max(0, Math.min(1, dt / (long ? 620 : 400)))
  const ease = 1 - Math.pow(1 - p, 3)
  const back = (q: number) => { const c = 2.2; return 1 + (c + 1) * Math.pow(q - 1, 3) + c * Math.pow(q - 1, 2) }
  const bounceOut = (q: number) => {
    const n = 7.5625, d = 2.75
    if (q < 1 / d) return n * q * q
    if (q < 2 / d) return n * (q -= 1.5 / d) * q + 0.75
    if (q < 2.5 / d) return n * (q -= 2.25 / d) * q + 0.9375
    return n * (q -= 2.625 / d) * q + 0.984375
  }
  const elastic = (q: number) => q <= 0 ? 0 : q >= 1 ? 1 : Math.pow(2, -10 * q) * Math.sin((q * 10 - 0.75) * (2 * Math.PI) / 3) + 1
  let alpha = Math.max(0, Math.min(1, o.opacity ?? 1))
  let scale = 1, dx = 0, dy = 0, spin = 0, blur = 0, wipe = 1, glitch = 0, text = full
  switch (anim) {
    case 'fade': alpha *= ease; break
    case 'pop': scale = p >= 1 ? 1 : 0.6 + 0.4 * back(p); alpha *= Math.min(1, p * 2.5); break
    case 'zoom-in': scale = 0.3 + 0.7 * ease; alpha *= ease; break
    case 'zoom-out': scale = 1.8 - 0.8 * ease; alpha *= ease; break
    case 'blur': blur = (1 - ease) * 14; alpha *= ease; break
    case 'slide': dy = (1 - ease) * 0.05 * H; alpha *= ease; break
    case 'slide-down': dy = -(1 - ease) * 0.05 * H; alpha *= ease; break
    case 'slide-left': dx = (1 - ease) * 0.08 * W; alpha *= ease; break
    case 'slide-right': dx = -(1 - ease) * 0.08 * W; alpha *= ease; break
    case 'drop': dy = -(1 - bounceOut(p)) * 0.14 * H; alpha *= Math.min(1, p * 4); break
    case 'bounce': scale = p >= 1 ? 1 : Math.max(0.05, elastic(p)); break
    case 'spin': spin = (1 - ease) * -200; scale = 0.4 + 0.6 * ease; alpha *= ease; break
    case 'wipe': wipe = ease; break
    case 'flicker': if (p < 1) alpha *= [1, 0.15, 0.9, 0.1, 1, 0.4, 1][Math.floor(p * 7)] ?? 1; break
    case 'glitch': if (p < 1) { glitch = 1 - p; dx = Math.sin(dt * 0.9) * 10 * (W / 1080) * glitch } break
    case 'typewriter': {
      const span = Math.max(400, full.length * 45)
      text = full.slice(0, Math.ceil(full.length * Math.max(0, Math.min(1, dt / span))))
      break
    }
  }
  if (alpha <= 0) return

  ctx.save()
  ctx.font = `${o.italic ? 'italic ' : ''}${weight} ${fontSize}px ${fontFamily}`
  ctx.textBaseline = 'top'
  const spacing = (o.letter_spacing ?? 0) * k
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${spacing}px`
  // The lines it is shown in (Enter, and wrapping inside its box width). Size from the whole
  // text, so the box doesn't grow while typing in
  const lines = textOverlayLines(o, W)
  const textW = Math.max(0, ...lines.map(l => ctx.measureText(l).width))
  const lineH = fontSize * TEXT_LINE_EM
  const padX = o.bg_color ? fontSize * BG_PAD.x : 0
  const padY = o.bg_color ? fontSize * BG_PAD.y : 0
  const textBoxH = lineH * lines.length + padY * 2
  // A box with a width / height set: the background fills it, the text sits in its middle (up and down)
  const boxW = Math.max(textW + padX * 2, o.w ? o.w * W : 0), boxH = Math.max(textBoxH, o.h ? o.h * H : 0)
  const shiftY = (boxH - textBoxH) / 2
  // Typewriter: the first characters of the text, line by line
  let left = text.length
  const shown = lines.map(l => { const part = l.slice(0, Math.max(0, left)); left -= l.length + 1; return part })
  const x = (o.x ?? 0.1) * W, y = (o.y ?? 0.4) * H + dy

  ctx.globalAlpha = alpha
  if (blur > 0.2) ctx.filter = `blur(${blur * k}px)`
  // Move, rotate, spin and scale around the middle of the text
  const cx = x + dx + boxW / 2, cy = y + boxH / 2
  ctx.translate(cx, cy)
  const turn = (o.rotation ?? 0) + spin
  if (turn) ctx.rotate((turn * Math.PI) / 180)
  if (scale !== 1) ctx.scale(scale, scale)
  ctx.translate(-cx + dx, -cy)
  // Wipe: reveal from left to right
  if (wipe < 1) { ctx.beginPath(); ctx.rect(x - 4 * k, y - boxH, (boxW + 8 * k) * wipe, boxH * 3); ctx.clip() }

  // Background box
  if (o.bg_color) {
    ctx.fillStyle = withAlpha(o.bg_color, o.bg_opacity ?? 1)
    const r = Math.min((o.bg_radius ?? 12) * k, boxH / 2)
    ctx.beginPath()
    ctx.roundRect(x, y, boxW, boxH, r)
    ctx.fill()
  }

  // Shadow (none · soft · hard · glow); the default keeps the original soft 2 px shadow
  const shadow = o.shadow ?? 'soft'
  if (shadow === 'soft') { ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 8 * k; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 2 * k }
  else if (shadow === 'hard') { ctx.shadowColor = o.shadow_color ?? '#000000'; ctx.shadowBlur = 0; ctx.shadowOffsetX = ctx.shadowOffsetY = 6 * k }
  else if (shadow === 'glow') { ctx.shadowColor = o.shadow_color ?? o.color ?? '#ffffff'; ctx.shadowBlur = 24 * k; ctx.shadowOffsetX = ctx.shadowOffsetY = 0 }
  if (o.bg_color) { ctx.shadowColor = 'transparent' }

  const tx = x + padX, ty0 = y + shiftY + padY + (lineH - fontSize) / 2
  const each = (draw: (line: string, ty: number) => void) => shown.forEach((l, i) => { if (l) draw(l, ty0 + i * lineH) })
  // Outline first (it carries the shadow), then the fill on top
  if (o.stroke_color && (o.stroke_width ?? 0) > 0) {
    ctx.lineJoin = 'round'
    ctx.lineWidth = 2 * (o.stroke_width ?? 0) * k
    ctx.strokeStyle = o.stroke_color
    each((l, ty) => ctx.strokeText(l, tx, ty))
    if (shadow !== 'glow') ctx.shadowColor = 'transparent'
  }
  ctx.fillStyle = o.color ?? '#ffffff'
  each((l, ty) => ctx.fillText(l, tx, ty))
  // A glow reads stronger with a second pass
  if (shadow === 'glow' && !o.bg_color) each((l, ty) => ctx.fillText(l, tx, ty))
  // Glitch: red and cyan copies split off either side for a moment
  if (glitch > 0) {
    ctx.shadowColor = 'transparent'
    ctx.globalAlpha = alpha * 0.7 * glitch
    const off = 8 * k * glitch
    ctx.fillStyle = '#ff2a55'; each((l, ty) => ctx.fillText(l, tx - off, ty))
    ctx.fillStyle = '#22e5ff'; each((l, ty) => ctx.fillText(l, tx + off, ty))
  }
  ctx.restore()
}

/**
 * A text overlay with no x (the AI hook): centred, in the export's font and size, shrunk to fit
 * 90% of the width — as render.py draws it (drawtext x=(w-text_w)/2, _fit_font_size).
 */
function drawCenteredText(ctx: CanvasRenderingContext2D, o: TextOverlayType) {
  const W = ctx.canvas.width, H = ctx.canvas.height
  const font = EXPORT_FONTS[o.font ?? ''] ? exportFont(o.font) : null
  const family = `${emojiFamily()}, ${font ? `"${font.family}", sans-serif` : (o.font ?? 'sans-serif')}`
  const weight = font ? 400 : 700                      // drawtext uses the font file as it is
  let px = (o.size ?? 48) * W / 1080
  ctx.save()
  ctx.font = `${weight} ${px}px ${family}`
  const width = ctx.measureText(o.text).width
  if (width > W * 0.9) px = Math.max(28 * W / 1080, px * (W * 0.9) / width)
  ctx.font = `${weight} ${px}px ${family}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.shadowColor = 'rgba(0,0,0,0.7)'
  ctx.shadowOffsetX = ctx.shadowOffsetY = 2 * W / 1080
  // Black outline, as drawtext borderw=4 (px at 1080 wide)
  ctx.lineJoin = 'round'
  ctx.lineWidth = 2 * Math.max(2, 4 * W / 1080)
  ctx.strokeStyle = '#000000'
  ctx.strokeText(o.text, W / 2, (o.y ?? 0.15) * H)
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = o.color ?? '#ffffff'
  ctx.fillText(o.text, W / 2, (o.y ?? 0.15) * H)
  ctx.restore()
}

// ── 9:16 output canvas ────────────────────────────────────────────────────────

interface OutputCanvasProps {
  videoRef: RefObject<HTMLVideoElement | null>
  /** The format at a clip time, read on every frame (instead of activeSegment, which follows React renders) */
  segmentAt?: (clipMs: number) => SegmentLocal | null
  /** Cut straight to the next format, as the export does (no crossfade) */
  hardCuts?: boolean
  /** The video a format shows, when it isn't the main one (B-roll) */
  sourceFor?: ((seg: SegmentLocal | null) => HTMLVideoElement | null) & {
    /** A part's picture held at a moment, for a transition's still (useBrollSources hold) */
    hold?: (seg: SegmentLocal, clipMs: number) => HTMLVideoElement | null | undefined
  }
  /** Split/trio slots that show their own picture (borrowed reactions): see useBorrowedSlots */
  slotSourceFor?: (seg: SegmentLocal | null, box: SegmentLocal['crop_boxes'][number]) => HTMLVideoElement | null | false
  currentTimeMs: number
  /** Follow the playhead's exact time every frame (the player store's live feed) instead of `currentTimeMs` */
  live?: boolean
  clipStartMs?: number
  /**
   * Parts of the clip were removed (lib/trims.ts): the main video's time (ms) → clip time. Without
   * it clip time is the video's time minus clipStartMs.
   */
  videoToTimeline?: (videoMs: number) => number
  activeSegment: SegmentLocal | null
  getPositionAt: (boxId: string, t_ms: number) => BoxPosition
  overlays?: Overlay[]
  activeOverlayId?: string | null
  onOverlayChange?: (id: string, updates: Partial<Overlay>) => void
  onSelectOverlay?: (id: string) => void
  onDeleteOverlay?: (id: string) => void
  className?: string
  style?: React.CSSProperties
  // Set .current = true before a manual layout change to suppress the crossfade animation
  skipTransitionRef?: RefObject<boolean>
  // Caption rendering
  words?: TranscriptWord[]
  captionStyle?: Partial<CaptionStyle>
  /**
   * The captions in parts, each in its own look (captions/parts.ts playedParts: clip ms, each part's
   * style over captionStyle): a line never runs from one part into the next. None: one look throughout.
   */
  captionParts?: PlayedPart[]
  captionTextCase?: TextCase
  showCaptions?: boolean
  /** No captions at this clip time (a gap left by a deleted part: its words aren't shown) */
  captionsOffAt?: (clipMs: number) => boolean
  // Text overlays
  textOverlays?: TextOverlayType[]
  activeTextOverlayId?: string | null
  /** A text to start typing in on the preview (e.g. one just added); onEditTextDone when typing ends */
  editTextOverlayId?: string | null
  onEditTextDone?: () => void
  onTextOverlayChange?: (id: string, updates: Partial<TextOverlayType>) => void
  onSelectTextOverlay?: (id: string | null) => void
  onDeleteTextOverlay?: (id: string) => void
  /** The captions dragged on the preview: where they're centred now (shares of the frame) */
  onCaptionPositionChange?: (y: number, x: number) => void
  /** The captions' corner handles dragged on the preview: their new size (as the Size slider) */
  onCaptionSizeChange?: (size: number) => void
  /**
   * The clip's transitions, where each join of sections has one. Given (the editor), a change of
   * section with none is a hard cut, as in the export — not the soft blend shown otherwise.
   */
  transitionCuts?: TransitionCut[]
  /** The Free plan's watermark: drawn last, over everything, where the export puts it (watermark.ts) */
  watermark?: boolean
  /** The clip's progress bar (a brand kit's) and the clip's length it fills over; null = none */
  progressBar?: (ProgressBar & { lengthMs: number }) | null
  /** Clip time → the main video's own time (ms), when parts of the clip were removed or videos put in (else clipStartMs + t) */
  timelineToVideo?: (t: number) => number
  /**
   * The clip's time now, when it doesn't follow the main video: with videos put in between
   * (inserts.ts) the main video waits while one plays, and the clip's own clock runs on
   */
  clock?: () => number
  /** Other videos and photos shown in frame slots */
  frameMedia?: FrameMediaPool | null
  /** "+" on an empty frame slot or band: takes the user to that lane on the timeline */
  onFrameLaneClick?: (lane: FrameLane) => void
  /** Clicking a photo, video or text in a frame selects it */
  onFrameItemClick?: (id: string | null) => void
  activeFrameItemId?: string | null
  /** A frame text dragged, resized, turned or typed in on the preview */
  onFrameItemChange?: (id: string, patch: Partial<Pick<FrameItem, 'x' | 'y' | 'size' | 'rect' | 'w' | 'rotation' | 'text'>>) => void
  /** A frame text's delete button on the preview */
  onDeleteFrameItem?: (id: string) => void
  /** The line between two rows of a resizable frame dragged: the frame's new row heights (null = back to the template's) */
  onFrameRowsChange?: (heights: number[] | null) => void
  /** The bar's swap: the rows' new order top to bottom (template row numbers) */
  onFrameRowsSwap?: (order: number[]) => void
  /**
   * A free frame's bar dragged (Side by side, Screen + face cam, Trio with main) or swapped: split /
   * split2 where a bar is (null back to the template's), flip / flip2 its swap
   */
  onFrameBarChange?: (patch: FreeBarPatch) => void
  /** The face cam's circle moved or resized: its top-left and width, or null back to where the template has it */
  onFrameFaceChange?: (box: { x: number; y: number; w: number } | null) => void
  /** The main video's box in a slot resized or moved (shares of the slot; null = fill the slot again) */
  onFrameMainRectChange?: (slot: number, rect: { x: number; y: number; w: number; h: number } | null) => void
}

export function OutputCanvas({
  videoRef, currentTimeMs: timeProp, live = false, clipStartMs = 0, videoToTimeline, activeSegment: segmentProp, getPositionAt, segmentAt, hardCuts = false, sourceFor, slotSourceFor,
  overlays = [], activeOverlayId, onOverlayChange, onSelectOverlay, onDeleteOverlay,
  className, style, skipTransitionRef,
  words, captionStyle, captionParts, captionTextCase = 'title', showCaptions = false, captionsOffAt,
  textOverlays = [], activeTextOverlayId, onTextOverlayChange, onSelectTextOverlay, onDeleteTextOverlay, editTextOverlayId, onEditTextDone,
  onCaptionPositionChange, onCaptionSizeChange, transitionCuts, watermark, progressBar, timelineToVideo, clock, frameMedia, onFrameLaneClick, onFrameItemClick, activeFrameItemId, onFrameItemChange, onDeleteFrameItem, onFrameRowsChange, onFrameRowsSwap, onFrameBarChange, onFrameFaceChange, onFrameMainRectChange,
}: OutputCanvasProps) {
  // Where the captions are drawn right now (from the canvas, each frame), for their box on the
  // preview: kept in state only when it moves noticeably, at most ~10 times a second
  const capOut = useRef<CaptionRectOut>({ rect: null })
  const [capRect, setCapRect] = useState<CaptionRect | null>(null)
  const capSent = useRef<{ rect: CaptionRect | null; at: number }>({ rect: null, at: 0 })
  // (redrawn at most ~30 times a second: the picture itself is drawn every frame, from the live time)
  const liveMs = useLiveTimeMs(live, LIVE_REDRAW_MS)
  const currentTimeMs = live ? liveMs : timeProp
  // With the live time, the format here too (what's drawn on the canvas already follows segmentAt every frame)
  const activeSegment = live && segmentAt ? segmentAt(liveMs) : segmentProp
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Centre guides shown while something is dragged (see GuideContext)
  const [guides, setGuides] = useState<Guides>(null)
  const frameMediaRef = useRef(frameMedia)
  frameMediaRef.current = frameMedia

  // Updated synchronously during render so the RAF loop always reads fresh values
  // without needing to be recreated or scheduled via useEffect.
  const activeSegmentRef = useRef(activeSegment)
  const currentTimeMsRef = useRef(currentTimeMs)
  const clipStartMsRef   = useRef(clipStartMs)
  const toTimelineRef    = useRef(videoToTimeline)
  const getPositionAtRef = useRef(getPositionAt)
  activeSegmentRef.current = activeSegment
  const segmentAtRef = useRef(segmentAt)
  segmentAtRef.current = segmentAt
  const sourceForRef = useRef(sourceFor)
  sourceForRef.current = sourceFor
  const slotSourceForRef = useRef(slotSourceFor)
  slotSourceForRef.current = slotSourceFor
  const hardCutsRef = useRef(hardCuts)
  hardCutsRef.current = hardCuts
  currentTimeMsRef.current = currentTimeMs
  clipStartMsRef.current   = clipStartMs
  toTimelineRef.current    = videoToTimeline
  getPositionAtRef.current = getPositionAt

  const prevSegIdRef    = useRef<string | null>(null)
  const snapshotRef     = useRef<HTMLCanvasElement | null>(null)
  const transitionStart = useRef<number | null>(null)
  const transitionCutsRef = useRef(transitionCuts)
  const watermarkRef = useRef(!!watermark)
  watermarkRef.current = !!watermark
  const progressBarRef = useRef(progressBar)
  progressBarRef.current = progressBar
  const timelineToVideoRef = useRef(timelineToVideo)
  timelineToVideoRef.current = timelineToVideo
  const clockRef = useRef(clock)
  clockRef.current = clock
  transitionCutsRef.current = transitionCuts
  // The two sections of a transition, each drawn whole off screen, then blended onto the canvas
  const trCanvases = useRef<[HTMLCanvasElement, HTMLCanvasElement] | null>(null)

  // Caption refs — updated synchronously at render time (same pattern as above)
  const captionStyleRef  = useRef(captionStyle)
  const captionCaseRef   = useRef(captionTextCase)
  const showCaptionsRef  = useRef(showCaptions)
  const captionsOffAtRef = useRef(captionsOffAt)
  captionsOffAtRef.current = captionsOffAt
  captionStyleRef.current = captionStyle
  captionCaseRef.current  = captionTextCase
  showCaptionsRef.current = showCaptions

  // The text being typed in on the preview: the canvas leaves it out (its text field shows it)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  useEffect(() => { if (editTextOverlayId) setEditingTextId(editTextOverlayId) }, [editTextOverlayId])
  const editingTextRef = useRef(editingTextId)
  editingTextRef.current = editingTextId
  const textOverlaysRef = useRef(textOverlays)
  textOverlaysRef.current = textOverlays
  // The frame text being typed in on the preview (the canvas leaves its words out the same way)
  const [editingFrameTextId, setEditingFrameTextId] = useState<string | null>(null)

  // Pre-build caption chunks so the RAF loop doesn't re-sort on every frame.
  // Rebuild only when the words array identity changes.
  const captionChunksRef  = useRef<FlatWord[][]>([])
  const liveLineRef       = useRef<FlatWord[] | null>(null)
  const prevWordsRef      = useRef<typeof words>(undefined)
  // Presets change how many words a line holds
  const wordsPerLine = captionWordsPerLine(captionStyle ?? {})
  const prevPerLineRef    = useRef(wordsPerLine)
  const prevPartsRef      = useRef<PlayedPart[] | undefined>(undefined)
  /** In parts (captionParts): each part's lines, from its own words, in its own look (video ms) */
  const captionPartChunksRef = useRef<{ start: number; end: number; chunks: FlatWord[][]; style: Partial<CaptionStyle> }[] | null>(null)
  if (words !== prevWordsRef.current || wordsPerLine !== prevPerLineRef.current || captionParts !== prevPartsRef.current) {
    prevWordsRef.current   = words
    prevPerLineRef.current = wordsPerLine
    prevPartsRef.current   = captionParts
    captionChunksRef.current = buildCaptionChunks(words ?? [], wordsPerLine)
    captionPartChunksRef.current = captionParts && captionParts.length > 1
      ? captionParts.map((part, i) => {
        // (a word belongs to the part it starts in; the last part takes everything after its start)
        const start = clipStartMs + part.start_ms, end = i + 1 < captionParts.length ? clipStartMs + part.end_ms : Infinity
        const own = (words ?? []).filter(w => w.start_ms >= (i === 0 ? -Infinity : start) && w.start_ms < end)
        return { start: i === 0 ? -Infinity : start, end, chunks: buildCaptionChunks(own, captionWordsPerLine(part.style)), style: part.style }
      })
      : null
  }
  /** The lines and the look of the part playing at `ms` (video ms) */
  const captionsAt = (ms: number) => {
    const parts = captionPartChunksRef.current
    const part = parts?.find(p => ms >= p.start && ms < p.end)
    return part ? { chunks: part.chunks, style: part.style } : { chunks: captionChunksRef.current, style: captionStyleRef.current ?? {} }
  }
  /** The look of the part under the playhead (clip ms): the captions' box is that size */
  const captionStyleNow = captionParts && captionParts.length > 1
    ? [...captionParts].reverse().find(p => timeProp >= p.start_ms)?.style ?? captionParts[0].style
    : captionStyle

  useEffect(() => {
    let rafId: number

    // The frame on screen has its own time: each frame is drawn with the view of that time (not the
    // player's clock, which can be a little off the frame), so a view change at a camera cut is a
    // clean cut — never one frame of the new shot with the old view
    let shownMs: number | null = null
    const stopShown = videoRef.current ? trackPresentedFrame(videoRef.current, ms => { shownMs = ms }) : () => {}

    // Held frames for transitions. The two sides of a join are usually the same continuous video,
    // so drawing both from the player at one moment gives two copies of one picture (a dissolve
    // shows nothing). The export holds frames instead (render.py): before the join the incoming
    // part's first frame, after it the outgoing part's last frame. Two hidden copies of the video
    // are parked on those two frames ahead of time (from 2.5 s before a transition).
    let peek: { a: HTMLVideoElement; b: HTMLVideoElement; at: number | null; src: string } | null = null
    const peekReady = (v: HTMLVideoElement) => v.readyState >= 2 && !v.seeking
    const toVideoMs = (t: number) => (timelineToVideoRef.current ? timelineToVideoRef.current(t) : clipStartMsRef.current + t)
    function parkPeek(main: HTMLVideoElement, at: number) {
      const src = main.currentSrc || main.src
      if (!src) return
      if (!peek || peek.src !== src) {
        disposePeek()
        const make = () => {
          const v = document.createElement('video')
          v.crossOrigin = main.crossOrigin
          v.muted = true; v.playsInline = true; v.preload = 'auto'
          v.src = src
          return v
        }
        peek = { a: make(), b: make(), at: null, src }
      }
      if (peek.at === at) return
      peek.at = at
      // (a frame and a half before the join: inside the outgoing part)
      peek.a.currentTime = Math.max(0, toVideoMs(Math.max(0, at - 50))) / 1000
      peek.b.currentTime = Math.max(0, toVideoMs(at)) / 1000
    }
    function disposePeek() {
      if (!peek) return
      for (const v of [peek.a, peek.b]) { v.removeAttribute('src'); v.load() }
      peek = null
    }

    // ── Transitions: both pictures keep moving (as the export does, render.py ext_head / ext_tail) ──
    // Across a transition the side the main player isn't showing plays on a hidden player of its
    // own: before the cut the incoming part from before its start ('b'), after the cut the outgoing
    // part past its end ('a'), each at its own speed and kept in step with the clip's clock. Where
    // the sound jumps (the main video from another moment, or at another speed) its sound fades in
    // as the main player's fades out, on the export's curve (audio.py: equal power). The held stills
    // above stay the fallback while a player isn't on its frame yet.
    type Side = { el: HTMLVideoElement; src: string }
    const sides: Record<'a' | 'b', Side | null> = { a: null, b: null }
    let sideCanvas: HTMLCanvasElement | null = null
    // The main player's own volume while its sound is being faded (restored after)
    let fadeBase: number | null = null
    function sideEl(role: 'a' | 'b', src: string, like: HTMLVideoElement) {
      let s = sides[role]
      if (!s || s.src !== src) {
        if (s) { s.el.pause(); s.el.removeAttribute('src'); s.el.load() }
        const v = document.createElement('video')
        v.crossOrigin = like.crossOrigin
        v.muted = true; v.playsInline = true; v.preload = 'auto'
        v.src = src
        s = sides[role] = { el: v, src }
      }
      return s.el
    }
    function quietSides() {
      for (const r of ['a', 'b'] as const) { const s = sides[r]; if (s) { if (!s.el.paused) s.el.pause(); s.el.muted = true } }
      if (fadeBase !== null) { const v = videoRef.current; if (v) v.volume = fadeBase; fadeBase = null }
    }
    function disposeSides() {
      quietSides()
      for (const r of ['a', 'b'] as const) { const s = sides[r]; if (s) { s.el.removeAttribute('src'); s.el.load(); sides[r] = null } }
    }
    /**
     * Where a part's own video is at clip time `t`, past its edges too (`side` 'b': the incoming part,
     * before its start; 'a': the outgoing part, after its end; `at`: the cut): its file, the moment in
     * it (ms) and how fast it plays. Null when it can't play there (a frame layout, a photo, slots
     * from more than one video): the held still is shown instead.
     */
    function sideSource(sg: SegmentLocal, t: number, side: 'a' | 'b', at: number, main: HTMLVideoElement): { src: string; ms: number; rate: number; own: boolean } | null {
      if (isFrameLayout(sg.layout)) return null
      const box = sg.crop_boxes[0]
      if (!box || box.image_path) return null
      if (sg.crop_boxes.some(b => (b.source_video_id ?? null) !== (box.source_video_id ?? null) || b.image_path)) return null
      const own = sourceForRef.current?.(sg)
      if (own) {
        // Another video (put in between, or a B-roll part): from its own moment, at its own pace
        const src = own.currentSrc || own.src
        if (!src) return null
        const len = isFinite(own.duration) ? own.duration * 1000 : Infinity
        const ms = (box.source_offset_ms ?? 0) + (t - sg.start_ms)
        return { src, ms: Math.max(0, Math.min(len - 1, ms)), rate: 1, own: true }
      }
      const src = main.currentSrc || main.src
      if (!src) return null
      const rate = sg.speed && sg.speed > 0 ? sg.speed : 1
      const ms = side === 'b' ? toVideoMs(at) + (t - at) * rate : toVideoMs(at - 1) + (t - at + 1) * rate
      // (not before the clip's own start, as the export; not past the video's end)
      const len = isFinite(main.duration) ? main.duration * 1000 : Infinity
      return { src, ms: Math.max(clipStartMsRef.current, Math.min(len - 1, ms)), rate, own: false }
    }
    /**
     * The video carries straight on across the cut at `at`, from part `a` into part `b`: the same
     * video, the same speed, `b` starting in it where `a` ends. The footage past either edge is then
     * the other part's own: there each side holds its edge frame (the stills), as the export does
     * (render.py _carries_on) — moving footage would blend the picture with itself and show nothing.
     */
    function carriesOnAt(a: SegmentLocal, b: SegmentLocal, at: number) {
      const rate = (sg: SegmentLocal) => (sg.speed && sg.speed > 0 ? sg.speed : 1)
      if (isFrameLayout(a.layout) || isFrameLayout(b.layout) || Math.abs(rate(a) - rate(b)) > 1e-3) return false
      const ownA = sourceForRef.current?.(a), ownB = sourceForRef.current?.(b)
      if (!ownA !== !ownB) return false
      if (ownA && ownB) {
        const ba = a.crop_boxes[0], bb = b.crop_boxes[0]
        return (ownA.currentSrc || ownA.src) === (ownB.currentSrc || ownB.src)
          && Math.abs((ba?.source_offset_ms ?? 0) + (a.end_ms - a.start_ms) - (bb?.source_offset_ms ?? 0)) <= 30
      }
      return Math.abs(toVideoMs(at - 1) + rate(a) - toVideoMs(at)) <= 30
    }
    /** A side player kept on its moment: playing with the clip (corrected when it drifts), or parked on the frame */
    function syncSide(el: HTMLVideoElement, ms: number, rate: number, playing: boolean) {
      const cur = el.currentTime * 1000
      if (playing) {
        if (Math.abs(el.playbackRate - rate) > 1e-3) el.playbackRate = rate
        if (Math.abs(cur - ms) > 150 && !el.seeking) el.currentTime = ms / 1000
        if (el.paused) el.play().catch(() => {})
      } else {
        if (!el.paused) el.pause()
        if (Math.abs(cur - ms) > 30 && !el.seeking) el.currentTime = ms / 1000
      }
    }
    // The stills of the transition coming up: started again for another join, when either part
    // changes (an edit) or when the preview changes size
    type Stills = { at: number; segA: SegmentLocal | null; segB: SegmentLocal | null; a: HTMLCanvasElement; b: HTMLCanvasElement; aOk: boolean; bOk: boolean; liveA: boolean }
    let stills: Stills | null = null
    function stillsFor(at: number, segA: SegmentLocal | null, segB: SegmentLocal | null, canvas: HTMLCanvasElement) {
      if (!stills) stills = { at: -1, segA: null, segB: null, a: document.createElement('canvas'), b: document.createElement('canvas'), aOk: false, bOk: false, liveA: false }
      const s = stills
      if (s.at !== at || s.segA !== segA || s.segB !== segB || s.a.width !== canvas.width || s.a.height !== canvas.height) {
        for (const c of [s.a, s.b]) { c.width = canvas.width; c.height = canvas.height }
        Object.assign(s, { at, segA, segB, aOk: false, bOk: false, liveA: false })
      }
      return s
    }

    // ── Slow motion, smooth: a slowed part shows each of its video's frames for longer (a 30 fps
    // video at 0.25x: a new one every 133 ms), so it would step. As each new frame comes, the one
    // before fades out over the time until the next is due: motion flows on from frame to frame.
    let blendPrev: HTMLCanvasElement | null = null, blendCur: HTMLCanvasElement | null = null
    let blendVT = -1, blendWall = 0, blendGap = 100, blendOk = false
    function blendSlow(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, video: HTMLVideoElement, seg: SegmentLocal | null) {
      const sp = seg?.speed && seg.speed > 0 ? seg.speed : 1
      if (video.paused || sp >= 0.99 || !seg || seg.hidden || isFrameLayout(seg.layout)) { blendVT = -1; blendOk = false; return }
      // (the frame on screen's own time: currentTime runs on between frames)
      if (shownMs == null) { blendOk = false; return }
      const now = performance.now(), vt = shownMs / 1000
      if (vt !== blendVT) {
        // A new frame: the last one becomes the one fading out
        const step = vt - blendVT
        if (!blendPrev) blendPrev = document.createElement('canvas')
        if (!blendCur) blendCur = document.createElement('canvas')
        for (const c of [blendPrev, blendCur]) if (c.width !== canvas.width || c.height !== canvas.height) { c.width = canvas.width; c.height = canvas.height; blendOk = false }
        blendOk = blendVT >= 0 && step > 0 && step < 0.25
        if (blendOk) { blendGap = step * 1000 / sp; const t = blendPrev; blendPrev = blendCur; blendCur = t }
        blendCur.getContext('2d')!.drawImage(canvas, 0, 0)
        blendVT = vt; blendWall = now
      }
      if (!blendOk || !blendPrev) return
      const fade = 1 - Math.min(1, (now - blendWall) / blendGap)
      if (fade <= 0.01) return
      ctx.save(); ctx.globalAlpha = fade; ctx.drawImage(blendPrev, 0, 0); ctx.restore()
    }

    const loop = () => {
      const canvas = canvasRef.current
      const video  = videoRef.current

      if (canvas && video && video.readyState >= 2) {
        const ctx    = canvas.getContext('2d')
        // Clip time of the frame on screen (removed parts closed up, when there are any)
        const toTimeline = toTimelineRef.current
        const clockMs = video.currentTime * 1000
        // Playing: the frame on screen's own time (a view change at a camera cut is a clean cut).
        // Paused: the editor's playhead itself — what the editor shows on top (the slots' buttons,
        // the bars, the boxes) is of that moment, and so is the format or frame just put there. The
        // player's own time isn't: a seek lands on the video frame just before the playhead, which
        // at a section's edge is in the section before (its picture showed under the next one's buttons)
        const videoMs = !video.paused && shownMs != null && Math.abs(shownMs - clockMs) < 300 ? shownMs : clockMs
        const clipMsNow = video.paused && currentTimeMsRef.current != null
          ? Math.max(0, currentTimeMsRef.current)
          : Math.max(0, clockRef.current ? clockRef.current() : toTimeline ? toTimeline(videoMs) : videoMs - clipStartMsRef.current)
        const seg    = segmentAtRef.current
          ? segmentAtRef.current(clipMsNow)
          : activeSegmentRef.current
        const newId  = seg?.id ?? null

        if (ctx) {
          // Detect segment boundary — snapshot MUST be captured before paintSegment
          // overwrites the canvas with new-segment content.
          if (newId !== prevSegIdRef.current && prevSegIdRef.current !== null) {
            // (with the clip's own transitions known, a section change is a cut unless it has one)
            const skip = hardCutsRef.current || transitionCutsRef.current !== undefined || (skipTransitionRef?.current ?? false)
            if (skipTransitionRef) skipTransitionRef.current = false
            if (!skip) {
              if (!snapshotRef.current) snapshotRef.current = document.createElement('canvas')
              const snap = snapshotRef.current
              snap.width  = canvas.width
              snap.height = canvas.height
              snap.getContext('2d')!.drawImage(canvas, 0, 0)
              transitionStart.current = performance.now()
            } else {
              transitionStart.current = null
            }
          }
          prevSegIdRef.current = newId

          // Read current time directly from the video element — this is always
          // frame-accurate and never lags behind the React state update cycle.
          // Keyframes are stored with clip-relative t_ms (0 = clip start).
          // Caption words use absolute timestamps matching liveMs directly (with removed parts,
          // the words were moved onto the clip's own time: its start + clip time).
          const clipRelativeMs = clipMsNow
          const liveMs = toTimeline ? clipStartMsRef.current + clipRelativeMs : videoMs

          // Keep frame slots' own videos in step with the main player, then draw
          frameMediaRef.current?.sync(seg, clipRelativeMs, !video.paused, video)
          // A B-roll shot whose video is still seeking keeps the last frame (never flashes the main video)
          const other = sourceForRef.current?.(seg)
          // Inside a transition: the section before the join and the one after it, both drawn,
          // blended by how far through it is
          const cuts = transitionCutsRef.current
          // Coming up to a transition (or in it): its held frames parked in good time
          const soon = cuts?.find(c => c.ms > 0 && clipMsNow >= c.at - c.ms / 2 - 2500 && clipMsNow < c.at + c.ms / 2 + 300)
          const slots = slotSourceForRef.current ? (sg: SegmentLocal, box: SegmentLocal['crop_boxes'][number]) => slotSourceForRef.current!(sg, box) : null
          // Coming up to a transition: its two held frames painted once into stills (each with its
          // own part's view), as soon as they can be — so the transition itself only paints the
          // part that plays, and never waits on a second decoder
          const st = soon && segmentAtRef.current ? stillsFor(soon.at, segmentAtRef.current(Math.max(0, soon.at - 1)), segmentAtRef.current(soon.at), canvas) : null
          if (soon && st && st.segA && st.segB && st.segA.id !== st.segB.id) {
            const hold = sourceForRef.current?.hold
            const held = (sg: SegmentLocal, t: number, side: 'a' | 'b') => {
              const own = hold?.(sg, t)
              if (own !== undefined) return own
              parkPeek(video, soon.at)
              const pk = peek && peek.at === soon.at ? peek : null
              return pk && peekReady(pk[side]) ? pk[side] : null
            }
            const still = (c: HTMLCanvasElement, sg: SegmentLocal, t: number, side: 'a' | 'b') => {
              const cx = c.getContext('2d')!
              if (sg.hidden) { cx.fillStyle = '#000'; cx.fillRect(0, 0, c.width, c.height); return true }
              const el = held(sg, t, side)
              if (!el) return false
              paintSegment(cx, el, sg, t, getPositionAtRef.current, frameMediaRef.current, slots)
              return true
            }
            if (!st.bOk) st.bOk = still(st.b, st.segB, soon.at, 'b')
            if (!st.aOk && clipMsNow < soon.at) st.aOk = still(st.a, st.segA, soon.at - 1, 'a')
            // (and the side players parked where they start: the incoming part's at the transition's
            // start, the outgoing part's at the cut)
            const moves = !carriesOnAt(st.segA, st.segB, soon.at)
            if (moves && clipMsNow < soon.at - soon.ms / 2) {
              const pb = sideSource(st.segB, soon.at - soon.ms / 2, 'b', soon.at, video)
              if (pb) syncSide(sideEl('b', pb.src, video), pb.ms, pb.rate, false)
            }
            if (moves && clipMsNow < soon.at) {
              const pa = sideSource(st.segA, soon.at, 'a', soon.at, video)
              if (pa) syncSide(sideEl('a', pa.src, video), pa.ms, pa.rate, false)
            }
          }
          const tc = cuts?.find(c => c.ms > 0 && clipMsNow >= c.at - c.ms / 2 && clipMsNow < c.at + c.ms / 2)
          // (outside a transition the side players are still and quiet, the main sound at its own level)
          if (!(tc && st && st.at === tc.at && st.segA && st.segB && st.segA.id !== st.segB.id)) quietSides()
          if (tc && st && st.at === tc.at && st.segA && st.segB && st.segA.id !== st.segB.id) {
            if (!trCanvases.current) trCanvases.current = [document.createElement('canvas'), document.createElement('canvas')]
            const [ca, cb] = trCanvases.current
            for (const c of [ca, cb]) if (c.width !== canvas.width || c.height !== canvas.height) { c.width = canvas.width; c.height = canvas.height }
            // Before the join: the outgoing part plays, the incoming one holds its first frame;
            // after it, the other way round (the same as the export, render.py)
            const before = clipMsNow < tc.at
            const live = before ? ca : cb
            const lx = live.getContext('2d')!
            if (seg?.hidden) { lx.fillStyle = '#000'; lx.fillRect(0, 0, live.width, live.height) }
            else if (!other || other.readyState >= 2) paintSegment(lx, other ?? video, seg, clipRelativeMs, getPositionAtRef.current, frameMediaRef.current, slots)
            if (before) st.liveA = true
            // (played into the join with no still of the outgoing part: its last frame played is it)
            else if (!st.aOk && st.liveA) { st.a.getContext('2d')!.drawImage(ca, 0, 0); st.aOk = true }
            // The other side: moving on its own player once that is on its frame, else the held still
            const otherSeg = before ? st.segB : st.segA
            const role: 'a' | 'b' = before ? 'b' : 'a'
            let moving: HTMLCanvasElement | null = null
            // (only where the video jumps: where it carries straight on — the same video, the same
            // speed, the incoming part starting where the outgoing one ends — the footage past each
            // edge is the other side's own, and blending it with itself shows nothing. There each
            // side holds its edge frame (the stills), as the export does: render.py _carries_on)
            const carriesOn = carriesOnAt(st.segA, st.segB, tc.at)
            const want = otherSeg.hidden || carriesOn ? null : sideSource(otherSeg, clipMsNow, role, tc.at, video)
            const playing = !video.paused
            if (want) {
              const el = sideEl(role, want.src, video)
              syncSide(el, want.ms, want.rate, playing)
              // (the other side player is quiet; only this one plays, and only during the transition)
              const off = sides[before ? 'a' : 'b']
              if (off && !off.el.paused) { off.el.pause(); off.el.muted = true }
              if (el.readyState >= 2 && !el.seeking && Math.abs(el.currentTime * 1000 - want.ms) < (playing ? 200 : 60)) {
                if (!sideCanvas) sideCanvas = document.createElement('canvas')
                if (sideCanvas.width !== canvas.width || sideCanvas.height !== canvas.height) { sideCanvas.width = canvas.width; sideCanvas.height = canvas.height }
                // (framed as at its edge: the export holds a part's first / last view past its edges)
                paintSegment(sideCanvas.getContext('2d')!, el, otherSeg, before ? otherSeg.start_ms : otherSeg.end_ms - 1, getPositionAtRef.current, frameMediaRef.current, slots)
                moving = sideCanvas
              }
              // Sound: where it jumps (both sides the main video, another moment or speed), the
              // outgoing sound fades out as the incoming fades in across the transition (equal power)
              const liveSeg = before ? st.segA : st.segB
              const liveOwn = !!sourceForRef.current?.(liveSeg)
              const rateOf = (sg: SegmentLocal) => (sg.speed && sg.speed > 0 ? sg.speed : 1)
              const jumps = !want.own && !liveOwn && (Math.abs(toVideoMs(tc.at - 1) + rateOf(st.segA) - toVideoMs(tc.at)) > 30 || Math.abs(rateOf(st.segA) - rateOf(st.segB)) > 1e-3)
              if (jumps && playing) {
                if (fadeBase === null) fadeBase = video.volume
                const x = Math.max(0, Math.min(1, (clipMsNow - (tc.at - tc.ms / 2)) / tc.ms))
                const gOut = Math.cos(Math.PI / 2 * x), gIn = Math.sin(Math.PI / 2 * x)
                video.volume = Math.max(0, Math.min(1, fadeBase * (before ? gOut : gIn)))
                el.muted = video.muted || !!otherSeg.muted
                el.volume = Math.max(0, Math.min(1, fadeBase * (before ? gIn : gOut)))
              } else {
                el.muted = true
                if (fadeBase !== null) { video.volume = fadeBase; fadeBase = null }
              }
            }
            const heldSide = moving ?? (before ? (st.bOk ? st.b : null) : (st.aOk ? st.a : null))
            // A held frame not ready yet: a plain cut for now, never a picture blended with itself
            if (heldSide) drawTransition(ctx, before ? ca : heldSide, before ? heldSide : cb, (clipMsNow - (tc.at - tc.ms / 2)) / tc.ms, tc.type)
            else ctx.drawImage(live, 0, 0)
          } else if (seg?.hidden) {
            // The main video hidden here (shownSegment): black, as in the export; captions and text still go on top
            ctx.fillStyle = '#000'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
          } else if (!other || other.readyState >= 2) {
            paintSegment(ctx, other ?? video, seg, clipRelativeMs, getPositionAtRef.current, frameMediaRef.current,
              slotSourceForRef.current ? (sg, box) => slotSourceForRef.current!(sg, box) : null)
            if (!other) blendSlow(ctx, canvas, video, seg)
          }

          // Composite the outgoing snapshot on top with decreasing alpha
          if (transitionStart.current !== null && snapshotRef.current) {
            const elapsed = performance.now() - transitionStart.current
            if (elapsed < CROSSFADE_MS) {
              const alpha = 1 - easeInOut(elapsed / CROSSFADE_MS)
              ctx.save()
              ctx.globalAlpha = alpha
              ctx.drawImage(snapshotRef.current, 0, 0, canvas.width, canvas.height)
              ctx.restore()
            } else {
              transitionStart.current = null
            }
          }

          // Draw captions on top of the video frame
          if (showCaptionsRef.current && captionChunksRef.current.length > 0 && !captionsOffAtRef.current?.(clipRelativeMs)) {
            const captionLookupMs = liveMs - (captionStyleRef.current?.timing_offset_ms ?? 0)
            capOut.current.rect = null
            // (in parts: the part playing now, its own lines and look)
            const cap = captionsAt(captionLookupMs)
            drawCaptions(ctx, cap.chunks, captionLookupMs, cap.style, captionCaseRef.current, captionBandAt(seg, clipRelativeMs), capOut.current)
            // The line on screen, for the Captions panel's key words (only when it changes)
            const onScreen = findCaptionChunk(cap.chunks, captionLookupMs)
            if (onScreen !== liveLineRef.current) {
              liveLineRef.current = onScreen
              useCaptionStore.getState().setLiveLine(onScreen ? onScreen.map(w => ({ word: w.word, start_ms: w.start_ms, end_ms: w.end_ms })) : null)
            }
            const r = capOut.current.rect as CaptionRect | null, last = capSent.current, now = performance.now()
            if (r && now - last.at > 100 && (!last.rect || Math.abs(r.x - last.rect.x) + Math.abs(r.y - last.rect.y) + Math.abs(r.w - last.rect.w) + Math.abs(r.h - last.rect.h) > 0.006)) {
              capSent.current = { rect: r, at: now }
              setCapRect(r)
            }
          }

          // Draw text overlays (clip-relative time)
          if (textOverlaysRef.current.length > 0) {
            drawTextOverlays(ctx, editingTextRef.current ? textOverlaysRef.current.filter(t => t.id !== editingTextRef.current) : textOverlaysRef.current, clipRelativeMs, video.paused)
          }

          // The progress bar, filling from the left as the clip plays (as the export: render.py)
          const pb = progressBarRef.current
          if (pb && pb.lengthMs > 0) {
            const h = Math.max(2, Math.round((pb.height * canvas.height) / 1920))
            ctx.save()
            ctx.globalAlpha = 1
            ctx.fillStyle = pb.color
            ctx.fillRect(0, pb.position === 'top' ? 0 : canvas.height - h, canvas.width * Math.min(1, Math.max(0, clipRelativeMs / pb.lengthMs)), h)
            ctx.restore()
          }

          // The Free plan's watermark, over everything (as the export does)
          if (watermarkRef.current) drawWatermark(ctx, canvas.width, canvas.height, clipRelativeMs)
        }
      }

      rafId = requestAnimationFrame(loop)
    }

    rafId = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(rafId); stopShown(); disposePeek(); disposeSides() }
  }, [videoRef])

  // Active overlays at current time
  // A photo on a higher track is drawn over one on a lower track (as the export does: z_index)
  const activeOverlays = overlays.filter(o => o.start_ms <= currentTimeMs && currentTimeMs < o.end_ms)
    .sort((a, b) => (a.track ?? 0) - (b.track ?? 0) || a.z_index - b.z_index)
  const activeTextOverlays = textOverlays.filter(o => currentTimeMs >= o.start_ms && currentTimeMs < o.end_ms)

  // Frame rows with nothing in them right now get a "+" that leads to their timeline lane
  const emptyLanes = useMemo(() => {
    if (!onFrameLaneClick || !activeSegment || !isFrameLayout(activeSegment.layout)) return []
    const frame = frameOf(activeSegment)
    const main = frame.main_slots ?? [0]
    return frameLanesFor(activeSegment).filter(r =>
      !itemAt(frame, r.lane, currentTimeMs, activeSegment) && (isTextLane(r.lane) || !main.includes(r.lane)))
  }, [activeSegment, currentTimeMs, onFrameLaneClick])

  // Frame rows showing an item right now: click to select it (text opens in the Text tool).
  // No z-index on these or the "+" tiles: overlay boxes come later in the DOM and stay clickable above them.
  const itemRows = useMemo(() => {
    if (!onFrameItemClick || !activeSegment || !isFrameLayout(activeSegment.layout)) return []
    const frame = frameOf(activeSegment)
    const tickers = new Set<FrameLane>(frameAreas(activeSegment.layout as FrameLayout).flatMap(a => a.kind === 'band' && a.ticker ? [a.lane] : []))
    return frameLanesFor(activeSegment).flatMap(r => {
      const it = itemAt(frame, r.lane, currentTimeMs, activeSegment)
      return it ? [{ ...r, item: it, ticker: tickers.has(r.lane) }] : []
    })
  }, [activeSegment, currentTimeMs, onFrameItemClick])

  // (only while that text is on screen)
  const editingFrameText = itemRows.some(r => r.item.id === editingFrameTextId) ? editingFrameTextId : null
  useEffect(() => {
    frameTextEditing = editingFrameText
    return () => { if (frameTextEditing === editingFrameText) frameTextEditing = null }
  }, [editingFrameText])

  return (
    <GuideContext.Provider value={setGuides}>
    <div className={className} style={{ ...style, position: 'relative', containerType: 'inline-size' }}
      onClick={() => {
        // A click on an empty part of the preview unselects (a text, and anything picked in a frame)
        onSelectTextOverlay?.(null)
        if (activeFrameItemId) onFrameItemClick?.(null)
      }}>
      {guides?.v !== undefined && (
        <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `calc(${guides.v * 100}% - 0.5px)`, width: 1, background: '#c8ff00', boxShadow: '0 0 6px rgba(200,255,0,0.8)', zIndex: 60 }} />
      )}
      {guides?.h !== undefined && (
        <div className="absolute left-0 right-0 pointer-events-none" style={{ top: `calc(${guides.h * 100}% - 0.5px)`, height: 1, background: '#c8ff00', boxShadow: '0 0 6px rgba(200,255,0,0.8)', zIndex: 60 }} />
      )}
      <canvas
        ref={canvasRef}
        width={540}
        height={960}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      />
      {itemRows.filter(r => !(r.item.kind === 'text' && !r.item.captions && !r.ticker && onFrameItemChange)).map(r => {
        const on = r.item.id === activeFrameItemId
        return (
          <button key={r.item.id}
            onClick={e => { e.stopPropagation(); onFrameItemClick?.(r.item.id) }}
            aria-label={`Select the ${r.item.kind === 'text' ? 'text' : r.item.kind} in the ${r.label.toLowerCase()} ${isTextLane(r.lane) ? 'area' : 'slot'}`}
            className="absolute transition-shadow hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]"
            style={{ left: `${r.x * 100}%`, width: `${r.w * 100}%`, top: `${r.y * 100}%`, height: `${r.h * 100}%`, boxShadow: on && (r.item.kind !== 'text' || r.ticker) ? 'inset 0 0 0 2px #c8ff00' : undefined }} />
        )
      })}
      {itemRows.filter(r => r.item.kind === 'text' && !r.item.captions && !r.ticker && onFrameItemChange).map(r => (
        <FrameTextBox key={`box-${r.item.id}`} row={r} item={r.item} selected={r.item.id === activeFrameItemId}
          editing={r.item.id === editingFrameText}
          onSelect={() => onFrameItemClick?.(r.item.id)}
          onChange={patch => onFrameItemChange?.(r.item.id, patch)}
          onDelete={onDeleteFrameItem ? () => onDeleteFrameItem(r.item.id) : undefined}
          onStartEdit={() => { onFrameItemClick?.(r.item.id); setEditingFrameTextId(r.item.id) }}
          onEndEdit={() => setEditingFrameTextId(null)} />
      ))}
      {emptyLanes.map(r => (
        <button key={String(r.lane)}
          onClick={e => { e.stopPropagation(); onFrameLaneClick?.(r.lane) }}
          aria-label={`Add to the ${r.label.toLowerCase()} ${isTextLane(r.lane) ? 'area' : 'slot'} on the timeline`}
          // (what this slot takes, as its lane's "+" says — slotOffers)
          title={isTextLane(r.lane) || !activeSegment || !isFrameLayout(activeSegment.layout) ? 'Add text on the timeline' : (() => {
            const o = slotOffers(activeSegment.layout, r.lane)
            const what = [o.photo && 'a photo', o.video && 'a video', o.text && 'text'].filter(Boolean) as string[]
            return `Add ${what.length > 1 ? `${what.slice(0, -1).join(', ')} or ${what[what.length - 1]}` : what[0] ?? 'something'} on the timeline`
          })()}
          className="group absolute flex items-center justify-center"
          style={{ left: `${r.x * 100}%`, width: `${r.w * 100}%`, top: `${r.y * 100}%`, height: `${r.h * 100}%` }}>
          <span className="flex items-center gap-1.5 rounded-full transition-transform group-hover:scale-105"
            style={{ padding: '5px 11px 5px 7px', background: 'rgba(255,255,255,0.1)', border: '1px dashed rgba(255,255,255,0.35)', color: 'rgba(255,255,255,0.85)', fontSize: 'max(10px, 3.2cqw)', fontWeight: 600 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            {isTextLane(r.lane) ? 'Add text' : 'Add'}
          </span>
        </button>
      ))}
      {/* Resizable frame: the main video's box in its slot — drag it to move, its corners to resize */}
      {onFrameMainRectChange && activeSegment && isFrameLayout(activeSegment.layout) && (() => {
        const frame = frameOf(activeSegment)
        const main = frame.main_slots ?? [0]
        return frameLanesFor(activeSegment)
          // (not the movable circle: dragging it moves the circle itself — its view is set by its view box)
          .filter(r => typeof r.lane === 'number' && main.includes(r.lane) && r.lane !== FRAME_TEMPLATES[activeSegment.layout as FrameLayout].movable && !frame.main_hidden?.[String(r.lane)] && !itemAt(frame, r.lane, currentTimeMs, activeSegment)
            && frameSlotSize(activeSegment.layout as FrameLayout, true, r.lane, activeSegment.frame) !== null)
          .map(r => (
            <FrameMainBox key={`main-${r.lane}`} row={r} rect={mainRect(frame, r.lane as number)}
              onChange={rect => onFrameMainRectChange(r.lane as number, rect)} />
          ))
      })()}
      {/* Resizable frame: drag the line between two rows to make one bigger and the other smaller */}
      {/* The same box for a video or photo put in a slot (clicking it also selects it) */}
      {onFrameItemChange && itemRows.filter(r => (r.item.kind === 'video' || r.item.kind === 'photo') && !r.item.hidden).map(r => (
        <FrameMainBox key={`box-${r.item.id}`} row={r} rect={boxRect(r.item.rect)}
          selected={r.item.id === activeFrameItemId} onSelect={() => onFrameItemClick?.(r.item.id)}
          onChange={rect => onFrameItemChange(r.item.id, { rect })} />
      ))}
      {onFrameRowsChange && activeSegment && isFrameLayout(activeSegment.layout)
        && <FrameRowHandles seg={activeSegment} onChange={onFrameRowsChange} onSwap={onFrameRowsSwap} />}
      {/* A free frame's bars (Side by side: left | right; Screen + face cam: under the Screen; Trio with
          main: under the Main and between Left and Right). The second first: where they meet, the first is on top */}
      {onFrameBarChange && activeSegment && isFrameLayout(activeSegment.layout) && FRAME_TEMPLATES[activeSegment.layout].bar2
        && <FreeBarHandle seg={activeSegment} which={2} onChange={onFrameBarChange} />}
      {onFrameBarChange && activeSegment && isFrameLayout(activeSegment.layout) && FRAME_TEMPLATES[activeSegment.layout].bar
        && <FreeBarHandle seg={activeSegment} which={1} onChange={onFrameBarChange} />}
      {/* The face cam's circle: drag it anywhere (over the Screen too), its corner to resize */}
      {onFrameFaceChange && activeSegment && isFrameLayout(activeSegment.layout) && FRAME_TEMPLATES[activeSegment.layout].movable !== undefined
        && <MovableAreaBox seg={activeSegment} onChange={onFrameFaceChange} />}
      {/* Image overlay boxes */}
      {activeOverlays.map(ov => (
        <OverlayBox
          key={ov.id}
          overlay={ov}
          isActive={ov.id === activeOverlayId}
          onChange={updates => onOverlayChange?.(ov.id, updates)}
          onSelect={() => onSelectOverlay?.(ov.id)}
          onDelete={() => onDeleteOverlay?.(ov.id)}
        />
      ))}
      {/* Text overlay boxes — drag to reposition */}
      {activeTextOverlays.map(o => (
        <TextOverlayBox
          key={o.id}
          overlay={o}
          isActive={o.id === activeTextOverlayId}
          onChange={updates => onTextOverlayChange?.(o.id, updates)}
          onSelect={onSelectTextOverlay ?? (() => {})}
          onDelete={() => onDeleteTextOverlay?.(o.id)}
          editing={o.id === editingTextId}
          onStartEdit={() => { onSelectTextOverlay?.(o.id); setEditingTextId(o.id) }}
          onEndEdit={() => { setEditingTextId(null); onEditTextDone?.() }}
        />
      ))}
      {/* The captions' box: drag to move them anywhere, the corners to make them bigger or smaller (its size: the part playing's) */}
      {showCaptions && onCaptionPositionChange && (
        <CaptionBox
          rect={capRect}
          position_y={captionStyle?.position_y ?? captionDefaultY(captionStyleNow ?? {})}
          position_x={captionStyle?.position_x ?? 0.5}
          size={captionStyleNow?.size ?? 52}
          onMove={onCaptionPositionChange}
          onSize={onCaptionSizeChange}
        />
      )}
    </div>
    </GuideContext.Provider>
  )
}

// ── Centre guides (as in Instagram): while something is dragged in the preview, a line shows when
// it's centred left-to-right (a vertical line) or top-to-bottom (a horizontal one), and it snaps on.
type Guides = { v?: number; h?: number } | null
const GuideContext = createContext<(g: Guides) => void>(() => {})
/** How close (share of the preview) a centre must be to snap */
const GUIDE_SNAP = 0.012
/** `centre` snapped onto `target` when close: [value, snapped?] */
function snapTo(centre: number, target: number, tol = GUIDE_SNAP): [number, boolean] {
  return Math.abs(centre - target) <= tol ? [target, true] : [centre, false]
}

/**
 * The main video's box inside its slot: drag it to move, a corner to resize (the picture is cut
 * from the source to the box's new shape). Double-click fills the slot again.
 */
function FrameMainBox({ row, rect, onChange, selected, onSelect }: {
  /** Its slot's area of the frame (shares of the frame) */
  row: { x: number; y: number; w: number; h: number }
  rect: { x: number; y: number; w: number; h: number } | null
  onChange: (rect: { x: number; y: number; w: number; h: number } | null) => void
  /** A video / photo item: picked when pressed, outlined while it is */
  selected?: boolean
  onSelect?: () => void
}) {
  const [active, setActive] = useState(false)
  const setGuides = useContext(GuideContext)
  const r = rect ?? { x: 0, y: 0, w: 1, h: 1 }
  function start(e: React.PointerEvent, mode: 'move' | 'nw' | 'ne' | 'sw' | 'se') {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    onSelect?.()
    const wrap = (e.currentTarget.closest('[data-frame-main]') as HTMLElement).parentElement!.getBoundingClientRect()
    const sw = wrap.width * row.w, sh = wrap.height * row.h          // the slot in px
    const x0 = e.clientX, y0 = e.clientY
    setActive(true)
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / sw, dy = (ev.clientY - y0) / sh
      let { x, y, w, h } = r
      if (mode === 'move') {
        x = Math.max(0, Math.min(1 - w, r.x + dx)); y = Math.max(0, Math.min(1 - h, r.y + dy))
        // Centre guides: the middle of its area, each way
        const [cx, onV] = snapTo(x + w / 2, 0.5, GUIDE_SNAP / row.w), [cy, onH] = snapTo(y + h / 2, 0.5, GUIDE_SNAP / row.h)
        if (onV) x = cx - w / 2
        if (onH) y = cy - h / 2
        setGuides(onV || onH ? { ...(onV ? { v: row.x + row.w / 2 } : {}), ...(onH ? { h: row.y + row.h / 2 } : {}) } : null)
      } else {
        const right = r.x + r.w, bottom = r.y + r.h
        if (mode === 'nw' || mode === 'sw') { x = Math.max(0, Math.min(right - MIN_MAIN_BOX, r.x + dx)); w = right - x }
        else w = Math.max(MIN_MAIN_BOX, Math.min(1 - r.x, r.w + dx))
        if (mode === 'nw' || mode === 'ne') { y = Math.max(0, Math.min(bottom - MIN_MAIN_BOX, r.y + dy)); h = bottom - y }
        else h = Math.max(MIN_MAIN_BOX, Math.min(1 - r.y, r.h + dy))
      }
      const q = (v: number) => Math.round(v * 1000) / 1000
      onChange({ x: q(x), y: q(y), w: q(w), h: q(h) })
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setActive(false); setGuides(null) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const corner = (mode: 'nw' | 'ne' | 'sw' | 'se') => (
    <span key={mode} onPointerDown={e => start(e, mode)} aria-hidden="true"
      className="absolute rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
      style={{
        width: 12, height: 12, background: '#c8ff00', boxShadow: '0 0 0 2px rgba(0,0,0,0.7)', touchAction: 'none',
        cursor: mode === 'nw' || mode === 'se' ? 'nwse-resize' : 'nesw-resize',
        ...(mode[0] === 'n' ? { top: -6 } : { bottom: -6 }), ...(mode[1] === 'w' ? { left: -6 } : { right: -6 }),
        ...(active ? { opacity: 1 } : {}),
      }} />
  )
  return (
    <div data-frame-main className="group absolute"
      title="Drag to move the video · drag a corner to resize · double-click to fill the area"
      onPointerDown={e => start(e, 'move')}
      onDoubleClick={e => { e.stopPropagation(); onChange(null) }}
      style={{
        left: `${(row.x + r.x * row.w) * 100}%`, top: `${(row.y + r.y * row.h) * 100}%`, width: `${r.w * row.w * 100}%`, height: `${r.h * row.h * 100}%`,
        cursor: active ? 'grabbing' : 'move', touchAction: 'none', zIndex: 18,
        boxShadow: active || selected ? 'inset 0 0 0 2px #c8ff00' : undefined,
      }}
      onClick={e => { if (onSelect) e.stopPropagation() }}>
      <span className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity" style={{ boxShadow: 'inset 0 0 0 1.5px rgba(200,255,0,0.8)' }} />
      {(['nw', 'ne', 'sw', 'se'] as const).map(corner)}
    </div>
  )
}

/**
 * The bars: handles on the lines between a frame's rows (e.g. the text band and the video). Drag one
 * up or down to resize the two rows it sits between; double-click puts the template's sizes back.
 * Swap (the small button beside it) trades the two rows' places — each keeps its own size, look and
 * contents (Pic + Vid: the picture below, the video on top). The bar is kept small: it sits on the
 * picture being edited.
 */
function FrameRowHandles({ seg, onChange, onSwap }: { seg: SegmentLocal; onChange: (heights: number[] | null) => void; onSwap?: (order: number[]) => void }) {
  const layout = seg.layout as Parameters<typeof frameRows>[0]
  const rows = frameRows(layout, true, seg.frame)
  // The rows on screen, top to bottom, as template row numbers (row_h is kept per template row)
  const order = validRowOrder(layout, seg.frame) ?? rows.map((_, i) => i)
  /** Heights in screen order → per template row, as saved */
  const toTemplate = (hs: number[]) => { const out: number[] = []; order.forEach((t, k) => { out[t] = hs[k] }); return out }
  const [dragging, setDragging] = useState<number | null>(null)
  function down(e: React.PointerEvent, i: number) {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
    const y0 = e.clientY
    const hs = rows.map(r => r.h)
    const pair = hs[i] + hs[i + 1]
    setDragging(i)
    const move = (ev: PointerEvent) => {
      const a = Math.max(MIN_ROW_H, Math.min(pair - MIN_ROW_H, hs[i] + (ev.clientY - y0) / box.height))
      const next = [...hs]
      next[i] = Math.round(a * 1000) / 1000
      next[i + 1] = Math.round((pair - a) * 1000) / 1000
      onChange(toTemplate(next))
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setDragging(null) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const swap = (i: number) => {
    const next = [...order]
    ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
    onSwap?.(next)
  }
  const name = (r: (typeof rows)[number]) => ('label' in r && r.label) || (r.kind === 'band' ? 'text' : r.kind === 'caption' ? 'captions' : 'picture')
  return (
    <>
      {rows.slice(0, -1).map((r, i) => {
        const on = dragging === i
        return (
          <div key={i} role="separator" aria-orientation="horizontal" tabIndex={0}
            aria-label="Drag to resize the areas above and below. Double-click to reset."
            title="Drag to resize · double-click to reset"
            onPointerDown={e => down(e, i)}
            onDoubleClick={e => { e.stopPropagation(); onChange(null) }}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
              e.preventDefault(); e.stopPropagation()
              const hs = rows.map(x => x.h), pair = hs[i] + hs[i + 1]
              const a = Math.max(MIN_ROW_H, Math.min(pair - MIN_ROW_H, hs[i] + (e.key === 'ArrowDown' ? 0.01 : -0.01)))
              hs[i] = a; hs[i + 1] = pair - a
              onChange(toTemplate(hs))
            }}
            className="group absolute left-0 right-0 flex items-center justify-center focus-visible:outline-none"
            style={{ top: `calc(${(r.y + r.h) * 100}% - 6px)`, height: 12, cursor: 'row-resize', touchAction: 'none', zIndex: 25 }}>
            <span className="absolute left-0 right-0 transition-opacity opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
              style={{ top: 5.5, height: 1, background: '#c8ff00', opacity: on ? 1 : undefined }} />
            <span className="relative flex items-center justify-center rounded-full transition-transform group-hover:scale-110"
              style={{ width: 22, height: 7, background: on ? '#c8ff00' : 'rgba(20,20,20,0.85)', boxShadow: `0 0 0 1px ${on ? '#c8ff00' : 'rgba(255,255,255,0.55)'}, 0 1px 4px rgba(0,0,0,0.6)` }}>
              <span style={{ width: 10, height: 1.5, borderRadius: 1, background: on ? '#000' : '#fff' }} />
            </span>
            {/* Swap: the areas above and below trade places */}
            {onSwap && (
              <button type="button" data-handle="1"
                aria-label={`Swap ${name(r)} and ${name(rows[i + 1])}`} title="Swap the areas above and below"
                onPointerDown={e => e.stopPropagation()}
                onDoubleClick={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); swap(i) }}
                className="relative ml-1 flex items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#c8ff00]"
                style={{ width: 14, height: 14, cursor: 'pointer', background: 'rgba(20,20,20,0.85)', boxShadow: '0 0 0 1px rgba(255,255,255,0.55), 0 1px 4px rgba(0,0,0,0.6)', color: '#fff' }}>
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M7 3v18M3 7l4-4 4 4M17 21V3M13 17l4 4 4-4" />
                </svg>
              </button>
            )}
          </div>
        )
      })}
    </>
  )
}

/** A free frame's bars changed: where they are (null: back to the template's) and their swaps */
export type FreeBarPatch = { split?: number | null; split2?: number | null; flip?: boolean; flip2?: boolean }

/**
 * A free frame's bar: drag it to resize the areas on either side (Side by side: left | right; Screen +
 * face cam: the Screen's height; Trio with main: the Main against the pair, Left against Right).
 * Double-click puts it back where the template has it. A bar with a swap has a button on it: the
 * areas on either side trade places.
 */
function FreeBarHandle({ seg, which, onChange }: { seg: SegmentLocal; which: 1 | 2; onChange: (patch: FreeBarPatch) => void }) {
  const layout = seg.layout as FrameLayout
  const tpl = FRAME_TEMPLATES[layout]
  const bar = (which === 2 ? tpl.bar2 : tpl.bar)!
  const key = which === 2 ? 'split2' : 'split', flipKey = which === 2 ? 'flip2' : 'flip'
  const flipped = barFlipped(layout, seg.frame, which)
  // Where the line is on the frame: swapped, the frame is mirrored that way
  const at = barAt(layout, seg.frame, which) ?? bar.at
  const s = flipped ? 1 - at : at
  const vertical = bar.dir === 'v'
  // The line runs along the areas that meet at it
  const meet = frameAreas(layout, true, seg.frame).filter(a => a.kind === 'slot'
    && (vertical ? Math.abs(a.x + a.w - s) < 1e-4 || Math.abs(a.x - s) < 1e-4 : Math.abs(a.y + a.h - s) < 1e-4 || Math.abs(a.y - s) < 1e-4))
  const from = meet.length ? Math.min(...meet.map(a => (vertical ? a.y : a.x))) : 0
  const to = meet.length ? Math.max(...meet.map(a => (vertical ? a.y + a.h : a.x + a.w))) : 1
  const [dragging, setDragging] = useState(false)
  // A place on the frame → the bar's value (swapped: measured from the other side), in its limits
  const set = (v: number) => onChange({ [key]: Math.round(Math.max(bar.min, Math.min(bar.max, flipped ? 1 - v : v)) * 1000) / 1000 })
  function down(e: React.PointerEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-swap]')) return
    e.stopPropagation(); e.preventDefault()
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
    setDragging(true)
    const move = (ev: PointerEvent) => set(vertical ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height)
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setDragging(false) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div role="separator" aria-orientation={vertical ? 'vertical' : 'horizontal'} tabIndex={0}
      aria-label="Drag to resize the areas on either side. Double-click to reset."
      title="Drag to resize · double-click to reset"
      onPointerDown={down}
      onDoubleClick={e => { e.stopPropagation(); onChange({ [key]: null }) }}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        const keys = vertical ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
        if (!keys.includes(e.key)) return
        e.preventDefault(); e.stopPropagation()
        set(s + (e.key === keys[1] ? 0.01 : -0.01))
      }}
      className={`group absolute flex items-center justify-center focus-visible:outline-none ${vertical ? 'flex-col' : ''}`}
      style={vertical
        ? { left: `calc(${s * 100}% - 9px)`, top: `${from * 100}%`, height: `${(to - from) * 100}%`, width: 18, cursor: 'col-resize', touchAction: 'none', zIndex: 25 }
        : { top: `calc(${s * 100}% - 9px)`, left: `${from * 100}%`, width: `${(to - from) * 100}%`, height: 18, cursor: 'row-resize', touchAction: 'none', zIndex: 25 }}>
      <span className="absolute transition-opacity opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
        style={vertical
          ? { left: 8, width: 2, top: 0, bottom: 0, background: '#c8ff00', opacity: dragging ? 1 : undefined }
          : { top: 8, height: 2, left: 0, right: 0, background: '#c8ff00', opacity: dragging ? 1 : undefined }} />
      <span className="relative flex items-center justify-center rounded-full transition-transform group-hover:scale-110"
        style={{ width: vertical ? 12 : 34, height: vertical ? 34 : 12, background: dragging ? '#c8ff00' : 'rgba(20,20,20,0.85)', boxShadow: `0 0 0 1.5px ${dragging ? '#c8ff00' : 'rgba(255,255,255,0.55)'}, 0 2px 8px rgba(0,0,0,0.6)` }}>
        <span style={vertical
          ? { width: 2, height: 14, borderRadius: 2, background: dragging ? '#000' : '#fff', boxShadow: `3px 0 0 ${dragging ? '#000' : '#fff'}`, transform: 'translateX(-1.5px)' }
          : { width: 14, height: 2, borderRadius: 2, background: dragging ? '#000' : '#fff', boxShadow: `0 3px 0 ${dragging ? '#000' : '#fff'}`, transform: 'translateY(-1.5px)' }} />
      </span>
      {/* Swap: the areas on either side trade places */}
      {bar.swap && (
        <button type="button" data-swap="1"
          aria-label="Swap the areas on either side" title="Swap the areas on either side"
          onPointerDown={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onChange({ [flipKey]: !flipped }) }}
          className={`relative flex items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#c8ff00] ${vertical ? 'mt-1.5' : 'ml-1.5'}`}
          style={{ width: 18, height: 18, cursor: 'pointer', background: 'rgba(20,20,20,0.85)', boxShadow: '0 0 0 1px rgba(255,255,255,0.55), 0 1px 4px rgba(0,0,0,0.6)', color: '#fff' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            style={vertical ? { transform: 'rotate(90deg)' } : undefined}>
            <path d="M7 3v18M3 7l4-4 4 4M17 21V3M13 17l4 4 4-4" />
          </svg>
        </button>
      )}
    </div>
  )
}

/**
 * The face cam's circle (a free frame's movable slot): drag it anywhere in the frame — over the
 * Screen too — and its corner to resize it, keeping its shape. Double-click puts it back. It always
 * stays inside the frame (adjustFreeAreas keeps it there).
 */
function MovableAreaBox({ seg, onChange }: { seg: SegmentLocal; onChange: (box: { x: number; y: number; w: number } | null) => void }) {
  const layout = seg.layout as FrameLayout
  const slot = FRAME_TEMPLATES[layout].movable!
  const a = frameAreas(layout, true, seg.frame).find(x => x.kind === 'slot' && x.slot === slot)
  const [active, setActive] = useState(false)
  if (!a) return null
  const round = (v: number) => Math.round(v * 1000) / 1000
  const ratio = a.h / a.w
  function drag(e: React.PointerEvent, resize: boolean) {
    if (e.button !== 0 || !a) return
    e.stopPropagation(); e.preventDefault()
    const el = (resize ? e.currentTarget.parentElement!.parentElement : e.currentTarget.parentElement) as HTMLElement
    const box = el.getBoundingClientRect()
    const x0 = e.clientX, y0 = e.clientY, start = { x: a.x, y: a.y, w: a.w }
    setActive(true)
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / box.width, dy = (ev.clientY - y0) / box.height
      if (resize) {
        let w = Math.max(MIN_MOVABLE_W, Math.min(1 - start.x, start.w + dx))
        if (start.y + w * ratio > 1) w = (1 - start.y) / ratio
        onChange({ x: round(start.x), y: round(start.y), w: round(w) })
      } else {
        onChange({ x: round(Math.max(0, Math.min(1 - start.w, start.x + dx))), y: round(Math.max(0, Math.min(1 - start.w * ratio, start.y + dy))), w: round(start.w) })
      }
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setActive(false) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const circle = a.kind === 'slot' && a.radius === 'circle'
  return (
    <div role="button" tabIndex={0} aria-label="Face cam: drag to move it, drag its corner to resize. Double-click to put it back."
      title="Drag to move · corner to resize · double-click to reset"
      onPointerDown={e => drag(e, false)}
      onDoubleClick={e => { e.stopPropagation(); onChange(null) }}
      onClick={e => e.stopPropagation()}
      className="group absolute"
      style={{
        left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%`,
        borderRadius: circle ? '50%' : 8, cursor: active ? 'grabbing' : 'move', touchAction: 'none', zIndex: 26,
        boxShadow: active ? 'inset 0 0 0 2px #c8ff00' : undefined,
      }}>
      <span className="absolute inset-0 pointer-events-none transition-opacity opacity-0 group-hover:opacity-100"
        style={{ borderRadius: circle ? '50%' : 8, boxShadow: 'inset 0 0 0 1.5px rgba(200,255,0,0.8)' }} />
      {/* The corner: resize, keeping its shape */}
      <span className="absolute" style={{ right: circle ? '9%' : -6, bottom: circle ? '9%' : -6 }}>
        <span onPointerDown={e => drag(e, true)} aria-label="Resize the face cam" role="presentation"
          className="block rounded-sm transition-opacity opacity-0 group-hover:opacity-100"
          style={{ width: 12, height: 12, background: '#c8ff00', border: '1.5px solid rgba(0,0,0,0.7)', cursor: 'nwse-resize', opacity: active ? 1 : undefined }} />
      </span>
    </div>
  )
}

// ── Rotate handle: drag round the box's middle to turn it (Shift: 15° steps; near a right angle it
//    snaps straight); double-click: straight again ──────────────────────────────

/** Degrees in -180..180 */
const normAngle = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180

function RotateHandle({ boxRef, rotation, onRotate, size = 20 }: {
  boxRef: React.RefObject<HTMLDivElement | null>; rotation: number; onRotate: (deg: number) => void; size?: number
}) {
  const [turning, setTurning] = useState<number | null>(null)
  function start(e: React.MouseEvent) {
    e.stopPropagation(); e.preventDefault()
    const r = boxRef.current?.getBoundingClientRect()
    if (!r) return
    // (the middle of a turned box is still the middle of its bounding box)
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const a0 = Math.atan2(e.clientY - cy, e.clientX - cx)
    const r0 = rotation
    function move(ev: MouseEvent) {
      let deg = normAngle(r0 + ((Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0) * 180) / Math.PI)
      if (ev.shiftKey) deg = normAngle(Math.round(deg / 15) * 15)
      else { const right = Math.round(deg / 90) * 90; if (Math.abs(deg - right) < 4) deg = normAngle(right) }
      deg = Math.round(deg * 10) / 10
      setTurning(deg)
      onRotate(deg)
    }
    function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); setTurning(null) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return (
    <div data-handle="1" onMouseDown={start} onDoubleClick={e => { e.stopPropagation(); onRotate(0) }}
      title="Drag to rotate (Shift: 15° steps) · double-click to straighten" aria-label="Rotate"
      style={{
        position: 'absolute', top: -size / 2, left: -size / 2, width: size, height: size, borderRadius: '50%',
        background: '#c8ff00', border: '2px solid #111', cursor: 'grab', pointerEvents: 'auto', boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2,
      }}>
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 11a8 8 0 10-2.3 5.7" /><path d="M20 4v7h-7" />
      </svg>
      {turning != null && (
        <span style={{ position: 'absolute', bottom: size + 4, left: '50%', transform: `translateX(-50%) rotate(${-rotation}deg)`, whiteSpace: 'nowrap',
          background: '#111', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, pointerEvents: 'none' }}>
          {Math.round(turning)}°
        </span>
      )}
    </div>
  )
}

// ── OverlayBox — free-position drag+resize for image/video overlays ──────────

/**
 * Picture in picture: the video in its window, kept in step with the clip's playhead (the live
 * time) and playing while the clip plays; its sound unless muted. Stretched to its box, as the
 * export draws it (render.py video overlays).
 */
function PipVideo({ overlay }: { overlay: Overlay }) {
  const ref = useRef<HTMLVideoElement>(null)
  const playing = usePlayerStore(s => s.playing)
  const sync = useCallback(() => {
    const v = ref.current
    if (!v) return
    const want = Math.max(0, ((overlay.source_offset_ms ?? 0) + liveTime.get() - overlay.start_ms) / 1000)
    const live = usePlayerStore.getState().playing
    // Playing: only re-seek on real drift (a seek stalls the picture); paused: follow exactly
    if (!v.seeking && Math.abs(v.currentTime - want) > (live ? 0.3 : 0.05)) v.currentTime = want
    if (live && v.paused) v.play().catch(() => {})
    if (!live && !v.paused) v.pause()
  }, [overlay.source_offset_ms, overlay.start_ms])
  useEffect(() => liveTime.subscribe(sync), [sync])
  useEffect(() => { sync() }, [sync, playing])
  useEffect(() => () => ref.current?.pause(), [])
  return (
    <video ref={ref} src={overlay.preview_url} muted={!!overlay.muted} playsInline preload="auto" crossOrigin="anonymous"
      onLoadedData={sync}
      style={{ width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none', display: 'block' }} />
  )
}

interface OverlayBoxProps {
  overlay: Overlay
  isActive: boolean
  onChange: (updates: Partial<Overlay>) => void
  onSelect: () => void
  onDelete: () => void
}

function OverlayBox({ overlay, isActive, onChange, onSelect, onDelete }: OverlayBoxProps) {
  const ref = useRef<HTMLDivElement>(null)
  const setGuides = useContext(GuideContext)
  const [hover, setHover] = useState(false)

  function cRect() {
    const r = ref.current?.parentElement?.getBoundingClientRect()
    return r ? { w: r.width, h: r.height } : { w: 1, h: 1 }
  }

  function startDrag(e: React.MouseEvent) {
    if ((e.target as HTMLElement).dataset.handle) return
    e.stopPropagation()
    onSelect()
    const sx = e.clientX, sy = e.clientY
    const start = { x: overlay.x, y: overlay.y }
    let moved = false
    function move(ev: MouseEvent) {
      moved = true
      const { w, h } = cRect()
      let x = Math.max(0, Math.min(1 - overlay.w, start.x + (ev.clientX - sx) / w))
      let y = Math.max(0, Math.min(1 - overlay.h, start.y + (ev.clientY - sy) / h))
      // Centre guides: snap its middle onto the frame's middle
      const [cx, onV] = snapTo(x + overlay.w / 2, 0.5), [cy, onH] = snapTo(y + overlay.h / 2, 0.5)
      if (onV) x = cx - overlay.w / 2
      if (onH) y = cy - overlay.h / 2
      setGuides(onV || onH ? { ...(onV ? { v: 0.5 } : {}), ...(onH ? { h: 0.5 } : {}) } : null)
      onChange({ x, y })
    }
    function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); setGuides(null) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function startResize(e: React.MouseEvent, dir: string) {
    e.stopPropagation()
    const sx = e.clientX, sy = e.clientY
    const start = { x: overlay.x, y: overlay.y, w: overlay.w, h: overlay.h }
    const re = start.x + start.w, be = start.y + start.h
    function move(ev: MouseEvent) {
      const { w, h } = cRect()
      const dx = (ev.clientX - sx) / w, dy = (ev.clientY - sy) / h
      let { x, y, w: bw, h: bh } = start
      if (dir.includes('e')) bw = Math.max(0.04, Math.min(1 - x, bw + dx))
      if (dir.includes('s')) bh = Math.max(0.04, Math.min(1 - y, bh + dy))
      if (dir.includes('w')) { const nx = Math.max(0, Math.min(re - 0.04, x + dx)); bw = re - nx; x = nx }
      if (dir.includes('n')) { const ny = Math.max(0, Math.min(be - 0.04, y + dy)); bh = be - ny; y = ny }
      onChange({ x, y, w: Math.max(0.04, bw), h: Math.max(0.04, bh) })
    }
    function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const imageUrl = useMemo(() => {
    if (overlay.type !== 'image') return null
    return overlay.preview_url ?? null
  }, [overlay.type, overlay.preview_url])

  const color = overlay.type === 'video' ? '#f97316' : '#f59e0b'
  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left: `${overlay.x * 100}%`, top: `${overlay.y * 100}%`,
        width: `${overlay.w * 100}%`, height: `${overlay.h * 100}%`,
        // Not picked: just the picture (a faint outline when pointed at); picked: its frame, ✕ and handles
        border: `2px solid ${isActive ? color : hover ? `${color}66` : 'transparent'}`,
        boxSizing: 'border-box', cursor: 'move', userSelect: 'none',
        boxShadow: isActive ? `0 0 0 1px ${color}55` : 'none',
        // Turned round its middle (the export turns it the same way)
        ...(overlay.rotation ? { transform: `rotate(${overlay.rotation}deg)` } : {}),
      }}
      onMouseDown={startDrag}
      data-photo-id={overlay.id}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Image content: the whole picture stretched to fill its box, whatever its width and height
          (the export stretches it the same way: render.py image overlays) */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {overlay.type === 'video' && overlay.preview_url
        ? <PipVideo overlay={overlay} />
        : imageUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={imageUrl} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none', display: 'block', opacity: overlay.opacity ?? 1 }} />
        : <div style={{ width: '100%', height: '100%', background: `${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color }}>IMG</span>
          </div>
      }
      </div>
      {isActive && overlay.type === 'image' && (
        <RotateHandle boxRef={ref} rotation={overlay.rotation ?? 0} onRotate={deg => onChange({ rotation: deg || null })} />
      )}

      {/* Delete button — top-right corner, when picked */}
      {isActive && <button
        data-handle="1"
        onMouseDown={e => { e.stopPropagation(); onDelete() }}
        style={{
          position: 'absolute', top: -10, right: -10,
          width: 20, height: 20, borderRadius: '50%',
          background: '#ef4444', border: '2px solid #1a1a1a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', pointerEvents: 'auto', boxSizing: 'border-box',
        }}
      >
        <svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1 1l6 6M7 1L1 7" stroke="white" strokeWidth="1.4" strokeLinecap="round"/></svg>
      </button>}

      {/* Resize handles, when picked */}
      {isActive && HANDLES.map(({ cursor, pos: hPos, dir }) => (
        <div
          key={dir}
          data-handle="1"
          style={{
            position: 'absolute', width: 10, height: 10,
            background: '#fff', border: `2px solid ${color}`,
            borderRadius: 2, cursor, pointerEvents: 'auto', boxSizing: 'border-box',
            opacity: isActive ? 1 : 0.4,
            ...hPos,
          }}
          onMouseDown={e => startResize(e, dir)}
        />
      ))}
    </div>
  )
}

// ── CaptionBox — the captions on the preview: moved and resized like a text ────

/** The caption sizes the Size slider allows (CaptionStyler) */
const CAPTION_SIZE_MIN = 20, CAPTION_SIZE_MAX = 100

/**
 * A box round the captions where they are drawn (`rect`, from the canvas). Pointed at: a faint
 * outline; clicked: picked, with a lime outline and a handle at each corner. Dragging the box
 * moves the captions anywhere (saved as where they're centred, position_x / position_y; the export
 * puts them there), snapping to the middle; dragging a corner makes them bigger or smaller (the Size slider).
 */
function CaptionBox({ rect, position_y, position_x, size, onMove, onSize }: {
  rect: CaptionRect | null
  position_y: number
  position_x: number
  size: number
  onMove: (y: number, x: number) => void
  onSize?: (size: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const setGuides = useContext(GuideContext)
  const [picked, setPicked] = useState(false)
  const [moving, setMoving] = useState(false)

  // A click anywhere else lets go of it
  useEffect(() => {
    if (!picked) return
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setPicked(false) }
    window.addEventListener('mousedown', away, true)
    return () => window.removeEventListener('mousedown', away, true)
  }, [picked])

  const area = () => ref.current?.parentElement?.getBoundingClientRect() ?? null

  function startMove(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    setPicked(true)
    setMoving(true)
    const sy = e.clientY, oy = position_y, sx = e.clientX, ox = position_x
    function move(ev: MouseEvent) {
      const r = area()
      if (!r) return
      let y = Math.max(0.05, Math.min(0.95, oy + (ev.clientY - sy) / r.height))
      let x = Math.max(0.05, Math.min(0.95, ox + (ev.clientX - sx) / r.width))
      const [cy, onH] = snapTo(y, 0.5)
      if (onH) y = cy
      const [cx, onV] = snapTo(x, 0.5)
      if (onV) x = cx
      setGuides(onV || onH ? { ...(onV ? { v: 0.5 } : {}), ...(onH ? { h: 0.5 } : {}) } : null)
      onMove(y, x)
    }
    function up() {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
      setGuides(null); setMoving(false)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  /** A corner dragged: the size follows how far the pointer is from the captions' middle */
  function startSize(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    if (!onSize) return
    const r = area()
    if (!r) return
    const cx = r.left + r.width * position_x
    const d0 = Math.max(8, Math.abs(e.clientX - cx))
    const s0 = size
    function move(ev: MouseEvent) {
      const d = Math.max(4, Math.abs(ev.clientX - cx))
      onSize!(Math.max(CAPTION_SIZE_MIN, Math.min(CAPTION_SIZE_MAX, Math.round(s0 * d / d0))))
    }
    function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // Where the captions are; before any have been drawn, about where they will be
  const r = rect ?? { x: position_x - 0.4, w: 0.8, h: (size / 1080) * (9 / 16) * 1.4, y: position_y - (size / 1080) * (9 / 16) * 0.7 }
  // (while dragged, it follows the pointer at once; the canvas catches up a frame later)
  const midY = moving || !rect ? position_y : r.y + r.h / 2
  const left = moving || !rect ? position_x - r.w / 2 : r.x
  const PAD = 1.2   // % of the preview round the words
  const accent = '#c8ff00'
  const corner = (pos: React.CSSProperties, cursor: string): React.CSSProperties => ({
    position: 'absolute', width: 10, height: 10, background: accent, border: '2px solid #111', borderRadius: 3, cursor, ...pos,
  })

  return (
    <div
      ref={ref}
      onMouseDown={startMove}
      onClick={e => e.stopPropagation()}
      title="Captions: drag to move them, drag a corner to resize"
      className="cap-box"
      data-picked={picked || undefined}
      style={{
        position: 'absolute',
        left: `${(left * 100) - PAD}%`, width: `${r.w * 100 + PAD * 2}%`,
        top: `${(midY - r.h / 2) * 100 - PAD / 2}%`, height: `${r.h * 100 + PAD}%`,
        minHeight: 18,
        cursor: 'move', userSelect: 'none',
        borderRadius: 4,
        border: `1.5px solid ${picked ? accent : 'transparent'}`,
        background: picked ? 'rgba(200,255,0,0.1)' : 'transparent',
        // Above frame layout's own draggable boxes (main video: 18, row divider: 25) so their
        // drag handlers don't steal clicks meant for the captions
        zIndex: 30,
      }}
    >
      {picked && onSize && (
        <>
          <div onMouseDown={startSize} style={corner({ left: -6, top: -6 }, 'nwse-resize')} aria-label="Resize the captions" />
          <div onMouseDown={startSize} style={corner({ right: -6, top: -6 }, 'nesw-resize')} aria-label="Resize the captions" />
          <div onMouseDown={startSize} style={corner({ left: -6, bottom: -6 }, 'nesw-resize')} aria-label="Resize the captions" />
          <div onMouseDown={startSize} style={corner({ right: -6, bottom: -6 }, 'nwse-resize')} aria-label="Resize the captions" />
        </>
      )}
    </div>
  )
}

// ── TextOverlayBox — draggable positioning handle for text overlays ───────────

interface TextOverlayBoxProps {
  overlay: TextOverlayType
  isActive: boolean
  onChange: (updates: Partial<TextOverlayType>) => void
  onSelect: (id: string | null) => void
  onDelete: () => void
  /** Being typed in on the preview (double-click): a text field takes the canvas text's place */
  editing: boolean
  onStartEdit: () => void
  onEndEdit: () => void
}

function TextOverlayBox({ overlay, isActive, onChange, onSelect, onDelete, editing, onStartEdit, onEndEdit }: TextOverlayBoxProps) {
  const ref = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const setGuides = useContext(GuideContext)

  function cRect() {
    const r = ref.current?.parentElement?.getBoundingClientRect()
    return r ? { w: r.width, h: r.height } : { w: 1, h: 1 }
  }

  // Editing on the preview: the cursor goes in with the words selected; Enter makes a new line
  useEffect(() => {
    if (!editing) return
    const el = areaRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [editing])

  function startDrag(e: React.MouseEvent) {
    if (editing) return
    e.stopPropagation()
    onSelect(overlay.id)
    const sx = e.clientX, sy = e.clientY
    // A centred overlay (no x) starts its drag from where it is drawn
    const centredX = () => {
      const el = ref.current, parent = el?.parentElement
      return el && parent ? el.getBoundingClientRect().left / 1 - parent.getBoundingClientRect().left : 0
    }
    const ox = overlay.x ?? (centredX() / cRect().w), oy = overlay.y ?? 0.4
    // The text's own size (shares of the preview), to find its middle
    const box = ref.current?.getBoundingClientRect()
    const ew = box ? box.width / cRect().w : 0, eh = box ? box.height / cRect().h : 0
    function move(ev: MouseEvent) {
      const { w, h } = cRect()
      let x = Math.max(0, Math.min(0.92, ox + (ev.clientX - sx) / w))
      let y = Math.max(0, Math.min(0.92, oy + (ev.clientY - sy) / h))
      // Centre guides: snap its middle onto the frame's middle
      const [cx, onV] = snapTo(x + ew / 2, 0.5), [cy, onH] = snapTo(y + eh / 2, 0.5)
      if (onV) x = cx - ew / 2
      if (onH) y = cy - eh / 2
      setGuides(onV || onH ? { ...(onV ? { v: 0.5 } : {}), ...(onH ? { h: 0.5 } : {}) } : null)
      onChange({ x, y })
    }
    function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); setGuides(null) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  /** Drag a side: the box's width (the text wraps inside it). The other side stays where it is. */
  function startWidth(e: React.MouseEvent, side: 'left' | 'right') {
    e.stopPropagation()
    e.preventDefault()
    onSelect(overlay.id)
    const sx = e.clientX
    const { w: cw } = cRect()
    const box = ref.current?.getBoundingClientRect()
    const x0 = overlay.x ?? 0.1
    const w0 = overlay.w ?? (box ? box.width / cw : 0.5)
    const right = x0 + w0
    function move(ev: MouseEvent) {
      const d = (ev.clientX - sx) / cRect().w
      if (side === 'right') onChange({ w: Math.max(MIN_TEXT_W, Math.min(1 - x0, w0 + d)) })
      else {
        const x = Math.max(0, Math.min(right - MIN_TEXT_W, x0 + d))
        onChange({ x, w: right - x })
      }
    }
    function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  /** Drag the top or bottom: the box's height (the text stays its size, in the middle of the box) */
  function startHeight(e: React.MouseEvent, side: 'top' | 'bottom') {
    e.stopPropagation()
    e.preventDefault()
    onSelect(overlay.id)
    const sy = e.clientY
    const { h: ch } = cRect()
    const box = ref.current?.getBoundingClientRect()
    const y0 = overlay.y ?? 0.4
    const h0 = overlay.h ?? (box ? box.height / ch : 0.1)
    const bottom = y0 + h0
    function move(ev: MouseEvent) {
      const d = (ev.clientY - sy) / cRect().h
      if (side === 'bottom') onChange({ h: Math.max(MIN_TEXT_H, Math.min(1 - y0, h0 + d)) })
      else {
        const y = Math.max(0, Math.min(bottom - MIN_TEXT_H, y0 + d))
        onChange({ y, h: bottom - y })
      }
    }
    function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function startResize(e: React.MouseEvent) {
    e.stopPropagation()
    const sx = e.clientX
    const initialSize = overlay.size ?? 72
    function move(ev: MouseEvent) {
      const { w } = cRect()
      const dx = ev.clientX - sx
      onChange({ size: Math.max(20, Math.min(300, Math.round(initialSize + dx * 270 / w))) })
    }
    function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const centred = overlay.x == null
  const x = overlay.x ?? 0.5
  const y = overlay.y ?? 0.4
  const accent = '#c8ff00'
  const fontSize = `${(overlay.size ?? 72) / 10.8}cqw`
  const handle = (extra: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute', background: accent, border: '2px solid #111', borderRadius: 4, pointerEvents: 'auto', ...extra,
  })

  return (
    <div
      ref={ref}
      onMouseDown={startDrag}
      onClick={e => { e.stopPropagation(); if (!editing) onSelect(overlay.id) }}
      onDoubleClick={e => { e.stopPropagation(); if (!centred) onStartEdit() }}
      title={editing ? undefined : 'Double-click to edit the text'}
      style={{
        position: 'absolute',
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        transform: [centred ? 'translateX(-50%)' : '', overlay.rotation ? `rotate(${overlay.rotation}deg)` : ''].join(' ').trim() || undefined,
        cursor: editing ? 'text' : 'move',
        userSelect: 'none',
        border: `1.5px solid ${isActive || editing ? accent : 'transparent'}`,
        borderRadius: 3,
        padding: 0,
        background: editing ? 'rgba(0,0,0,0.25)' : isActive ? 'rgba(200,255,0,0.12)' : 'transparent',
        backdropFilter: 'none',
        boxShadow: isActive ? `0 0 0 1px ${accent}44` : 'none',
        // A box with a width set shows that width (the text wraps inside it)
        ...(overlay.w && !centred ? { width: `${overlay.w * 100}%` } : { maxWidth: '90%' }),
        // A box with a height set: at least that tall, the text in its middle
        ...(overlay.h && !centred ? { minHeight: `${overlay.h * 100}%`, display: 'flex', flexDirection: 'column', justifyContent: 'center' } : {}),
      }}
    >
      {editing ? (
        <textarea
          ref={areaRef}
          value={overlay.text}
          onChange={e => onChange({ text: e.target.value })}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          onBlur={onEndEdit}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); onEndEdit() } }}
          aria-label="Edit the text"
          rows={Math.max(1, overlay.text.split('\n').length)}
          spellCheck={false}
          style={{
            ...textCss(overlay), fontSize, lineHeight: TEXT_LINE_EM,
            display: 'block', width: overlay.w ? '100%' : undefined, minWidth: '2ch',
            whiteSpace: overlay.w ? 'pre-wrap' : 'pre', overflowWrap: overlay.w ? 'anywhere' : undefined, overflow: 'hidden', resize: 'none',
            background: 'transparent', border: 'none', outline: 'none', padding: 0, margin: 0,
            caretColor: accent, userSelect: 'text',
            ...({ fieldSizing: 'content' } as React.CSSProperties),
          }}
        />
      ) : (
        /* Invisible text — the canvas's own lines, sized to match canvas text (canvas 540×960; size/6.075 cqw = size/1080*960/540 of container width) */
        <span style={{ ...textCss(overlay, true), fontSize, lineHeight: TEXT_LINE_EM, whiteSpace: 'pre', display: 'block', pointerEvents: 'none', userSelect: 'none', margin: 0 }}>
          {(overlay.text ? textOverlayLines(overlay, 1080).join('\n') : '') || '…'}
        </span>
      )}
      {isActive && !editing && !centred && (['left', 'right'] as const).map(side => (
        <div key={side} onMouseDown={e => startWidth(e, side)}
          title="Drag to make the text box wider or narrower (the text wraps inside it)"
          aria-label={`Text box width (${side} side)`}
          style={handle({ top: '50%', [side]: -5, transform: 'translateY(-50%)', width: 8, height: 22, cursor: 'ew-resize' })} />
      ))}
      {isActive && !editing && !centred && (['top', 'bottom'] as const).map(side => (
        <div key={side} onMouseDown={e => startHeight(e, side)}
          title="Drag to make the text box taller or shorter (the text stays in its middle)"
          aria-label={`Text box height (${side} side)`}
          style={handle({ left: '50%', [side]: -5, transform: 'translateX(-50%)', width: 22, height: 8, cursor: 'ns-resize' })} />
      ))}
      {isActive && !editing && !centred && (
        <RotateHandle boxRef={ref} size={18} rotation={overlay.rotation ?? 0} onRotate={deg => onChange({ rotation: deg })} />
      )}
      {isActive && !editing && (
        <button
          onMouseDown={e => { e.stopPropagation(); onDelete() }}
          style={{
            position: 'absolute', top: -9, right: -9,
            width: 18, height: 18, borderRadius: '50%',
            background: '#ef4444', border: '2px solid #111',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'auto',
          }}
        >
          <svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1 1l6 6M7 1L1 7" stroke="white" strokeWidth="1.4" strokeLinecap="round"/></svg>
        </button>
      )}
      {isActive && !editing && (
        <div
          onMouseDown={startResize}
          title="Drag to make the text bigger or smaller"
          style={{
            position: 'absolute', bottom: -6, right: -6,
            width: 14, height: 14, borderRadius: 3,
            background: accent, border: '2px solid #111',
            cursor: 'nwse-resize', pointerEvents: 'auto',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="6" height="6" viewBox="0 0 8 8" fill="none">
            <path d="M1 4h6M5 2l2 2-2 2" stroke="black" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      )}
    </div>
  )
}

// ── DraggableBox ─────────────────────────────────────────────────────────────

interface DraggableBoxProps {
  pos: BoxPosition
  /** Locked w/h in normalised units; null = free resize (Horizontal) */
  aspect: number | null
  color: string
  isActive: boolean
  /** The layout's name (Vertical, Split, …), first on the tag in the layout's colour */
  kind?: string
  label: string
  onSelect: () => void
  onChange: (newPos: BoxPosition) => void
}

const MIN_BOX = 0.05

/**
 * A corner of the crop frame as a camera's focus bracket (user, 2026-10-31: "the frame is highlighting more
 * and looks ordinary — make it easier and creative"): an L in the box's colour inside a bigger, easy-to-grab spot
 */
function bracketStyle(dir: string, color: string): React.CSSProperties {
  const n = dir.includes('n'), w = dir.includes('w')
  // (user, 2026-10-31) the frame itself soft white, the corners in the layout's colour with its glow — the
  // timeline's colour for that layout, so which format it is reads at a glance
  const line = `3px solid ${color}`
  return {
    position: 'absolute', width: 14, height: 14, pointerEvents: 'none',
    [n ? 'top' : 'bottom']: 4, [w ? 'left' : 'right']: 4,
    [n ? 'borderTop' : 'borderBottom']: line,
    [w ? 'borderLeft' : 'borderRight']: line,
    [`border${n ? 'Top' : 'Bottom'}${w ? 'Left' : 'Right'}Radius`]: 7,
    filter: `drop-shadow(0 0 6px ${color}aa) drop-shadow(0 1px 2px rgba(0,0,0,0.45))`,
  }
}

/** The frame's tags (what it becomes, its zoom): small dark glass pills */
const GLASS_TAG: React.CSSProperties = {
  position: 'absolute', top: 8, display: 'flex', alignItems: 'center', gap: 5,
  fontSize: 10.5, fontWeight: 650, letterSpacing: '0.02em', color: '#fff', lineHeight: 1.3,
  padding: '3px 8px', borderRadius: 999, pointerEvents: 'none',
  background: 'rgba(10, 10, 12, 0.55)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
  boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.14), 0 4px 12px -4px rgba(0, 0, 0, 0.6)',
}

function DraggableBox({ pos, aspect, color, isActive, kind, label, onSelect, onChange }: DraggableBoxProps) {
  const ref = useRef<HTMLDivElement>(null)
  // Moving or resizing: the thirds guides show, to place the face
  const [busy, setBusy] = useState(false)

  function cRect() {
    const r = ref.current?.parentElement?.getBoundingClientRect()
    return r ? { w: r.width, h: r.height } : { w: 1, h: 1 }
  }

  function startDrag(e: React.MouseEvent) {
    if ((e.target as HTMLElement).dataset.handle) return
    e.stopPropagation()
    e.preventDefault()
    onSelect()
    setBusy(true)
    const sx = e.clientX, sy = e.clientY, start = { ...pos }
    function move(ev: MouseEvent) {
      const { w, h } = cRect()
      onChange({
        ...start,
        x: Math.max(0, Math.min(1 - start.w, start.x + (ev.clientX - sx) / w)),
        y: Math.max(0, Math.min(1 - start.h, start.y + (ev.clientY - sy) / h)),
      })
    }
    function up() { setBusy(false); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function startResize(e: React.MouseEvent, dir: string) {
    e.stopPropagation()
    e.preventDefault()
    onSelect()
    setBusy(true)
    const sx = e.clientX, sy = e.clientY, start = { ...pos }
    const re = start.x + start.w, be = start.y + start.h
    function move(ev: MouseEvent) {
      const { w, h } = cRect()
      const dx = (ev.clientX - sx) / w, dy = (ev.clientY - sy) / h
      if (aspect) {
        // Locked shape: resize from a corner while the opposite corner stays put
        const west = dir.includes('w'), north = dir.includes('n')
        const ax = west ? re : start.x, ay = north ? be : start.y
        const growW = west ? -dx : dx, growH = (north ? -dy : dy) * aspect
        const maxW = Math.min(west ? ax : 1 - ax, (north ? ay : 1 - ay) * aspect)
        const nw = Math.max(Math.min(MIN_BOX, maxW), Math.min(maxW, start.w + (growW + growH) / 2))
        const nh = nw / aspect
        onChange({ x: west ? ax - nw : ax, y: north ? ay - nh : ay, w: nw, h: nh })
        return
      }
      let { x, y, w: bw, h: bh } = start
      if (dir.includes('e')) bw = Math.max(MIN_BOX, Math.min(1 - x, bw + dx))
      if (dir.includes('s')) bh = Math.max(MIN_BOX, Math.min(1 - y, bh + dy))
      if (dir.includes('w')) { const nx = Math.max(0, Math.min(re - MIN_BOX, x + dx)); bw = re - nx; x = nx }
      if (dir.includes('n')) { const ny = Math.max(0, Math.min(be - MIN_BOX, y + dy)); bh = be - ny; y = ny }
      onChange({ x, y, w: bw, h: bh })
    }
    function up() { setBusy(false); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // Locked boxes resize from the corners only; edge handles would break the shape
  const handles = aspect ? HANDLES.filter(h => h.dir.length === 2) : HANDLES

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left: `${pos.x * 100}%`, top: `${pos.y * 100}%`,
        width: `${pos.w * 100}%`, height: `${pos.h * 100}%`,
        // A fine see-through edge with a dark hairline round it: clear on bright and dark video alike
        border: `1px solid rgba(255, 255, 255, ${isActive ? 0.42 : 0.24})`,
        boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.28), 0 12px 40px -14px rgba(0, 0, 0, 0.7)',
        borderRadius: 4, background: 'transparent',
        boxSizing: 'border-box', cursor: 'move', pointerEvents: 'auto', userSelect: 'none',
        zIndex: isActive ? 2 : 1,
      }}
      onMouseDown={startDrag}
      onClick={e => { e.stopPropagation(); onSelect() }}
    >
      {/* Thirds guides while moving or resizing (where to put the eyes) */}
      {busy && (
        <div aria-hidden="true" style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'linear-gradient(90deg, transparent calc(33.333% - 0.5px), rgba(255,255,255,0.35) calc(33.333% - 0.5px), rgba(255,255,255,0.35) calc(33.333% + 0.5px), transparent calc(33.333% + 0.5px), transparent calc(66.666% - 0.5px), rgba(255,255,255,0.35) calc(66.666% - 0.5px), rgba(255,255,255,0.35) calc(66.666% + 0.5px), transparent calc(66.666% + 0.5px)),'
            + ' linear-gradient(180deg, transparent calc(33.333% - 0.5px), rgba(255,255,255,0.35) calc(33.333% - 0.5px), rgba(255,255,255,0.35) calc(33.333% + 0.5px), transparent calc(33.333% + 0.5px), transparent calc(66.666% - 0.5px), rgba(255,255,255,0.35) calc(66.666% - 0.5px), rgba(255,255,255,0.35) calc(66.666% + 0.5px), transparent calc(66.666% + 0.5px))',
        }} />
      )}

      {/* Slot label — what this box becomes in the output */}
      <div style={{ ...GLASS_TAG, left: 8 }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: color, boxShadow: `0 0 6px ${color}` }} />
        {/* (lightened: a dark blue name didn't read on the dark glass) */}
        {kind && <span style={{ color: `color-mix(in srgb, ${color} 60%, white)` }}>{kind}</span>}
        {kind && <span style={{ opacity: 0.4 }}>·</span>}
        {label}
      </div>

      {/* Zoom badge — how far this crop is punched in (only when it is: "1.0x" read like a speed) */}
      {Math.round(10 / Math.max(0.1, pos.h)) / 10 > 1 && (
        <div style={{ ...GLASS_TAG, right: 8 }}>
          Zoom {(Math.round(10 / Math.max(0.1, pos.h)) / 10).toFixed(1)}×
        </div>
      )}

      {/* Corners: focus brackets in a 26 px spot to grab; edges (free boxes only): a small bar */}
      {handles.map(({ cursor, pos: hPos, dir }) => dir.length === 2 ? (
        <div
          key={dir}
          data-handle="1"
          style={{
            position: 'absolute', width: 26, height: 26, cursor, pointerEvents: 'auto',
            [dir.includes('n') ? 'top' : 'bottom']: -6, [dir.includes('w') ? 'left' : 'right']: -6,
          }}
          onMouseDown={e => startResize(e, dir)}
        >
          <span style={bracketStyle(dir, color)} />
        </div>
      ) : (
        <div
          key={dir}
          data-handle="1"
          style={{
            position: 'absolute', width: dir === 'n' || dir === 's' ? 18 : 4, height: dir === 'n' || dir === 's' ? 4 : 18,
            background: color, borderRadius: 999, cursor, pointerEvents: 'auto',
            boxShadow: `0 0 6px ${color}aa, 0 1px 3px rgba(0,0,0,0.5)`,
            ...hPos,
            ...(dir === 'n' ? { top: -2.5 } : dir === 's' ? { bottom: -2.5 } : dir === 'e' ? { right: -2.5 } : { left: -2.5 }),
          }}
          onMouseDown={e => startResize(e, dir)}
        />
      ))}
    </div>
  )
}
