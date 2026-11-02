'use client'

import { useBrandPalette, useBrandLock, withBrand } from './brandPalette'
import { InfoTip } from '@/components/ui/info-tip'
import { EmojiButton, insertAtCursor } from './EmojiPicker'
import type { SegmentLocal, FrameItem, FrameLane, FrameBand } from '@chai-cut/shared'
import { isFrameLayout, frameHasBand, frameLanes, frameOf, DEFAULT_BAND, frameTextLanes, isTextLane, textLaneLook } from '@/modules/editor/frames'
import { FRAME_ITEM_COLORS, frameItemColor } from './SegmentTimeline'
import { ItemTimeRange } from './ItemTimeRange'

const ACCENT = '#c8ff00'
// 'none': no background (the video or picture under it shows)
const TEXT_BG = ['none', '#000000', '#ffffff', '#c8ff00', '#ef4444', '#2563eb', '#f59e0b']
const TEXT_COLOR = ['#ffffff', '#000000', '#c8ff00', '#facc15']

interface Props {
  /** The frame under the playhead (null when the playhead isn't in a frame) */
  segment: SegmentLocal | null
  currentTimeMs: number
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Add text on a lane at the playhead */
  onAdd: (lane: FrameLane) => void
  onUpdate: (id: string, patch: Partial<Omit<FrameItem, 'id'>>) => void
  onRemove: (id: string) => void
  /** The band's colour where no text is on it */
  onUpdateBand: (patch: Partial<FrameBand>) => void
}

function msToLabel(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Text of a frame — on its band or as cards in its slots — edited in the Text tool */
export function FrameTextPanel({ segment, currentTimeMs, selectedId, onSelect, onAdd, onUpdate, onRemove, onUpdateBand }: Props) {
  if (!segment || !isFrameLayout(segment.layout)) return null
  const frame = frameOf(segment)
  const lanes = frameLanes(segment.layout)
  const order = (lane: FrameLane) => lanes.findIndex(l => l.lane === lane)
  const laneName = (lane: FrameLane) => isTextLane(lane) ? lanes.find(l => l.lane === lane)?.label ?? 'Band' : `${lanes.find(l => l.lane === lane)?.label ?? ''} card`
  const texts = (frame.items ?? [])
    .filter(it => it.kind === 'text' && it.end_ms > segment.start_ms && it.start_ms < segment.end_ms)
    .sort((a, b) => order(a.lane) - order(b.lane) || a.start_ms - b.start_ms)
  const hasBand = frameHasBand(segment.layout)
  // Each text area of the frame (the band, and a name tag / badge / ticker where it has one)
  const textLanes = frameTextLanes(segment.layout)

  return (
    <div className="flex flex-col gap-3 p-4" style={{ borderBottom: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
      <div className="flex items-center justify-between gap-2">
        <p style={{ fontSize: 11, fontWeight: 600, color: 'rgb(var(--ed-fg) / 0.5)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Frame text</p>
        {hasBand && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {textLanes.map(lane => (
              <button key={lane} onClick={() => onAdd(lane)}
                className="h-7 px-2.5 rounded-lg text-[11px] font-semibold transition-opacity hover:opacity-90"
                style={{ background: ACCENT, color: '#000' }}>
                + {textLanes.length > 1 ? lanes.find(l => l.lane === lane)?.label ?? 'Text' : 'Band text'} at {msToLabel(currentTimeMs)}
              </button>
            ))}
          </div>
        )}
      </div>

      {texts.length === 0 && (
        <p className="text-xs" style={{ color: 'rgb(var(--ed-fg) / 0.35)' }}>
          {hasBand ? 'No text on this frame yet.' : 'Add a text card with + on a slot lane in the timeline.'}
        </p>
      )}

      {texts.map(it => {
        const on = it.id === selectedId
        const from = Math.max(it.start_ms, segment.start_ms), to = Math.min(it.end_ms, segment.end_ms)
        const name = it.captions ? 'Captions' : it.text?.trim() || 'Empty text'
        return (
          <div key={it.id} className="flex flex-col rounded-lg overflow-hidden"
            style={{ background: 'rgb(var(--ed-fg) / 0.03)', boxShadow: `inset 0 0 0 ${on ? 1.5 : 1}px ${on ? frameItemColor(it) : 'rgb(var(--ed-fg) / 0.08)'}` }}>
            <button onClick={() => onSelect(on ? null : it.id)} aria-expanded={on}
              className="flex items-center gap-2 h-9 px-3 text-left transition-colors hover:bg-[rgb(var(--ed-fg)/0.04)]">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: frameItemColor(it) }} />
              <span className="text-xs truncate flex-1" style={{ color: it.text?.trim() || it.captions ? 'var(--ed-text)' : 'rgb(var(--ed-fg) / 0.4)' }}>{name}</span>
              <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>{laneName(it.lane)} · {msToLabel(from)}–{msToLabel(to)}</span>
            </button>

            {on && (
              <div className="flex flex-col gap-3 px-3 pb-3 pt-1">
                {it.captions ? (
                  <>
                    <p className="flex items-center gap-1.5 text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                      Captions in this band
                      <InfoTip label="About captions in the band" size={12}>Your captions show inside the band here instead of their usual spot. Style them in Captions.</InfoTip>
                    </p>
                    <button onClick={() => onUpdate(it.id, { captions: false, text: '' })}
                      className="self-start text-[11px] font-medium hover:underline" style={{ color: 'var(--ed-accent-text)' }}>Use your own text instead</button>
                  </>
                ) : (() => {
                  const t = { ...DEFAULT_BAND, ...textLaneLook(segment, it.lane), ...pickStyle(it) }
                  return (
                    <>
                      <div className="flex gap-2 items-start">
                        <textarea rows={2} value={it.text ?? ''} placeholder="Type your title or hook…" aria-label="Text" autoFocus={!it.text}
                          data-frame-text={it.id}
                          onChange={e => onUpdate(it.id, { text: e.target.value })}
                          className="flex-1 px-3 py-2 rounded-lg text-sm outline-none resize-none text-[var(--ed-text)]"
                          style={{ background: 'rgb(var(--ed-fg) / 0.06)', border: '1px solid rgb(var(--ed-fg) / 0.12)' }} />
                        <EmojiButton label="Add an emoji to the text"
                          onPick={e => onUpdate(it.id, { text: insertAtCursor(document.querySelector<HTMLTextAreaElement>(`[data-frame-text="${it.id}"]`), it.text ?? '', e) })} />
                      </div>
                      <Swatches title="Background" colors={TEXT_BG} value={t.bg} onChange={bg => onUpdate(it.id, { bg })} />
                      <Swatches title="Text colour" colors={TEXT_COLOR} value={t.color} onChange={color => onUpdate(it.id, { color })} />
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Text size</span>
                          <span className="text-[11px] tabular-nums" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>{t.size}px</span>
                        </div>
                        <input type="range" min={32} max={120} step={2} value={t.size} aria-label="Text size"
                          // (white, not lime — user, 2026-11-01; the editor's text colour, so dark on the light theme)
                          onChange={e => onUpdate(it.id, { size: Number(e.target.value) })} style={{ accentColor: 'var(--ed-text)' }} />
                      </div>
                    </>
                  )
                })()}

                <ItemTimeRange item={it} segment={segment} currentTimeMs={currentTimeMs} onChange={patch => onUpdate(it.id, patch)} />

                <div className="flex items-center justify-between">
                  {it.lane === 'band' && !it.captions ? (
                    <button onClick={() => onUpdate(it.id, { captions: true })}
                      className="text-[11px] font-medium hover:underline" style={{ color: FRAME_ITEM_COLORS.captions }}>Show captions here instead</button>
                  ) : <span />}
                  <button onClick={() => onRemove(it.id)}
                    className="text-[11px] font-medium hover:underline" style={{ color: '#f87171' }}>Remove</button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {hasBand && (
        <Swatches title="Band colour (where there's no text)" colors={TEXT_BG} value={frame.band?.bg ?? DEFAULT_BAND.bg} onChange={bg => onUpdateBand({ bg })} />
      )}
    </div>
  )
}

function pickStyle(it: FrameItem) {
  const out: { bg?: string; color?: string; size?: number } = {}
  if (it.bg) out.bg = it.bg
  if (it.color) out.color = it.color
  if (it.size) out.size = it.size
  return out
}

function Swatches({ title, colors: own, value, onChange }: { title: string; colors: string[]; value: string; onChange: (c: string) => void }) {
  // The brand kit's colours first (components/editor/brandPalette.ts); "none" stays where it was
  // (brand lock: the team kit's colours only, and no free picker)
  const lock = useBrandLock()
  const palette = withBrand(useBrandPalette(), own)
  const colors = lock ? [...lock.colors, ...own.filter(c => c === 'none')] : palette
  const isPreset = colors.some(c => c.toLowerCase() === value.toLowerCase())
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>{title}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {colors.map(c => {
          const on = c.toLowerCase() === value.toLowerCase()
          return (
            <button key={c} onClick={() => onChange(c)} aria-label={c === 'none' ? `${title}: none` : `${title} ${c}`} aria-pressed={on}
              title={c === 'none' ? 'None (see-through)' : undefined}
              style={{
                width: 22, height: 22, borderRadius: '50%', border: `2px solid ${on ? ACCENT : 'rgb(var(--ed-fg) / 0.15)'}`, boxShadow: on ? '0 0 0 2px rgba(200,255,0,0.25)' : 'none',
                // "None": a crossed-out circle
                background: c === 'none' ? 'linear-gradient(135deg, transparent 45%, #ef4444 45%, #ef4444 55%, transparent 55%)' : c,
              }} />
          )
        })}
        {!lock && <label style={{ width: 22, height: 22, borderRadius: '50%', position: 'relative', cursor: 'pointer', flexShrink: 0 }} title="Custom colour">
          <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)', border: `2px solid ${!isPreset ? ACCENT : 'rgb(var(--ed-fg) / 0.2)'}` }} />
          <input type="color" value={value.startsWith('#') ? value : '#000000'} onChange={e => onChange(e.target.value)} aria-label={`Custom ${title.toLowerCase()}`}
            style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
        </label>}
      </div>
      {lock && <span className="text-[10.5px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>Brand lock: {lock.by}&rsquo;s colours</span>}
    </div>
  )
}
