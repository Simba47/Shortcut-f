'use client'

import { useEffect, useRef, useState } from 'react'

/** A photo's crop (shares of the picture as shown, mirrored or not) and whether it's mirrored */
export interface PhotoEdit { x: number; y: number; w: number; h: number; mirror: boolean }
export const NO_PHOTO_EDIT: PhotoEdit = { x: 0, y: 0, w: 1, h: 1, mirror: false }
export const isPhotoEdited = (e: PhotoEdit) => e.mirror || e.x > 0.001 || e.y > 0.001 || e.w < 0.999 || e.h < 0.999

/** Crop shapes offered (width / height); null = any shape */
const SHAPES: Array<{ id: string; label: string; ratio: number | null }> = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
]
const MIN = 0.05
const BOX_H = 260
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/**
 * Crop and mirror a photo before it goes in (user, 2026-11-05, in the "Add a photo" window): drag
 * the box to move it, its corners to resize it; a shape keeps it to that shape. The photo is made
 * that way before it's uploaded (bakePhoto), so the editor and the export show the same picture.
 */
export function PhotoCropper({ src, value, onChange }: { src: string; value: PhotoEdit; onChange: (e: PhotoEdit) => void }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [outerW, setOuterW] = useState(368)
  const [shape, setShape] = useState('free')

  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setOuterW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The picture as shown: as big as fits the box
  const scale = natural ? Math.min(outerW / natural.w, BOX_H / natural.h) : 0
  const dw = natural ? natural.w * scale : 0, dh = natural ? natural.h * scale : 0
  const ratioOf = (id: string) => SHAPES.find(s => s.id === id)?.ratio ?? null
  // A shape as shares of the picture: w share / h share
  const shareRatio = (r: number) => natural ? r * natural.h / natural.w : r

  function pickShape(id: string) {
    setShape(id)
    const r = ratioOf(id)
    if (r == null || !natural) return
    // The biggest box of that shape, in the middle
    const k = shareRatio(r)
    let w = 1, h = w / k
    if (h > 1) { h = 1; w = k }
    onChange({ ...value, x: (1 - w) / 2, y: (1 - h) / 2, w, h })
  }

  function drag(e: React.PointerEvent, kind: 'move' | 'tl' | 'tr' | 'bl' | 'br') {
    if (e.button !== 0 || !dw || !dh) return
    e.preventDefault(); e.stopPropagation()
    const x0 = e.clientX, y0 = e.clientY, v0 = value
    const r = ratioOf(shape)
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / dw, dy = (ev.clientY - y0) / dh
      if (kind === 'move') {
        onChange({ ...v0, x: clamp(v0.x + dx, 0, 1 - v0.w), y: clamp(v0.y + dy, 0, 1 - v0.h) })
        return
      }
      // The opposite corner stays put
      const left = kind === 'tl' || kind === 'bl', top = kind === 'tl' || kind === 'tr'
      const ax = left ? v0.x + v0.w : v0.x, ay = top ? v0.y + v0.h : v0.y
      const px = clamp((left ? v0.x : v0.x + v0.w) + dx, 0, 1), py = clamp((top ? v0.y : v0.y + v0.h) + dy, 0, 1)
      let w = Math.max(MIN, Math.abs(ax - px)), h = Math.max(MIN, Math.abs(ay - py))
      const maxW = left ? ax : 1 - ax, maxH = top ? ay : 1 - ay
      w = Math.min(w, maxW); h = Math.min(h, maxH)
      if (r != null) {
        const k = shareRatio(r)
        h = w / k
        if (h > maxH) { h = maxH; w = h * k }
      }
      onChange({ ...v0, x: left ? ax - w : ax, y: top ? ay - h : ay, w, h })
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const chip = (on: boolean): React.CSSProperties => ({
    background: on ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.04)', color: on ? '#fff' : 'rgba(255,255,255,0.55)',
    border: '1px solid rgba(255,255,255,0.08)',
  })

  return (
    <div className="flex flex-col gap-2.5">
      <div ref={outerRef} className="relative flex items-center justify-center rounded-xl overflow-hidden select-none" style={{ height: BOX_H, background: '#111', touchAction: 'none' }}>
        <div className="relative" style={{ width: dw || '100%', height: dh || '100%' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="The photo" draggable={false}
            onLoad={e => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="absolute inset-0 w-full h-full" style={{ objectFit: 'fill', transform: value.mirror ? 'scaleX(-1)' : undefined }} />
          {natural && (
            <div role="group" aria-label="Crop box: drag to move, drag a corner to resize" onPointerDown={e => drag(e, 'move')}
              className="absolute" style={{
                left: `${value.x * 100}%`, top: `${value.y * 100}%`, width: `${value.w * 100}%`, height: `${value.h * 100}%`,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.55), inset 0 0 0 2px #c8ff00', cursor: 'move',
              }}>
              {/* thirds, to line things up */}
              <span className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: 'linear-gradient(to right, transparent calc(33.33% - 0.5px), rgba(255,255,255,0.3) calc(33.33% - 0.5px), rgba(255,255,255,0.3) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255,255,255,0.3) calc(66.66% - 0.5px), rgba(255,255,255,0.3) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px)), linear-gradient(to bottom, transparent calc(33.33% - 0.5px), rgba(255,255,255,0.3) calc(33.33% - 0.5px), rgba(255,255,255,0.3) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255,255,255,0.3) calc(66.66% - 0.5px), rgba(255,255,255,0.3) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px))',
              }} />
              {(['tl', 'tr', 'bl', 'br'] as const).map(c => (
                <span key={c} onPointerDown={e => drag(e, c)} aria-label="Drag to resize"
                  className="absolute rounded-sm" style={{
                    width: 14, height: 14, background: '#c8ff00', border: '2px solid #111',
                    [c[0] === 't' ? 'top' : 'bottom']: -7, [c[1] === 'l' ? 'left' : 'right']: -7,
                    cursor: c === 'tl' || c === 'br' ? 'nwse-resize' : 'nesw-resize',
                  }} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-semibold mr-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>Crop</span>
        {SHAPES.map(s => (
          <button key={s.id} type="button" onClick={() => pickShape(s.id)} aria-pressed={shape === s.id}
            className="px-2 h-7 rounded-md text-[11px] font-semibold" style={chip(shape === s.id)}>{s.label}</button>
        ))}
        <span className="flex-1" />
        <button type="button" onClick={() => onChange({ ...value, mirror: !value.mirror, x: 1 - value.x - value.w })} aria-pressed={value.mirror}
          title="Flip the photo left to right" className="flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-semibold" style={chip(value.mirror)}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M6 1v10M4.5 3L1 9h3.5V3zM7.5 3L11 9H7.5V3z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg>
          Mirror
        </button>
        {isPhotoEdited(value) && (
          <button type="button" onClick={() => { setShape('free'); onChange(NO_PHOTO_EDIT) }}
            className="px-2 h-7 rounded-md text-[11px] font-semibold" style={chip(false)}>Reset</button>
        )}
      </div>
    </div>
  )
}

/** The photo made as edited — cropped, mirrored — as a new file of the same kind (unchanged: the same file) */
export async function bakePhoto(file: File, edit: PhotoEdit): Promise<File> {
  if (!isPhotoEdited(edit)) return file
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not read the photo'))
      el.src = url
    })
    const nw = img.naturalWidth, nh = img.naturalHeight
    const cw = Math.max(1, Math.round(edit.w * nw)), ch = Math.max(1, Math.round(edit.h * nh))
    // The crop is of the picture as shown: mirrored, its left edge is the photo's right
    const sx = (edit.mirror ? 1 - edit.x - edit.w : edit.x) * nw, sy = edit.y * nh
    const canvas = document.createElement('canvas')
    canvas.width = cw; canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not edit the photo')
    if (edit.mirror) { ctx.translate(cw, 0); ctx.scale(-1, 1) }
    ctx.drawImage(img, sx, sy, edit.w * nw, edit.h * nh, 0, 0, cw, ch)
    const type = file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg'
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, 0.92))
    if (!blob) throw new Error('Could not edit the photo')
    const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.' + ext, { type })
  } finally {
    URL.revokeObjectURL(url)
  }
}
