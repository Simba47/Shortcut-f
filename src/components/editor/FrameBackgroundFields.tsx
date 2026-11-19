'use client'

import { useEffect, useState } from 'react'
import { CARD_PATTERNS, CARD_PATTERN_SCALE, DEFAULT_FRAME_BG, type CardPattern, type FrameBackground } from '@/lib/shared/brandCard'
import { useBrandLock, useBrandPalette } from './brandPalette'

/**
 * A frame's own background (user, 2026-10-19): the area behind and around its videos — the frame's
 * as the template has it, or one colour, a gradient or a pattern of two colours (lib/shared/brandCard.ts;
 * the export draws it the same way). The brand's colours come first; with a brand lock, only they.
 */
const PATTERN_NAMES: Record<CardPattern, string> = { dots: 'Dots', grid: 'Grid', stripes: 'Stripes', checker: 'Checks', waves: 'Waves' }
const muted = 'rgb(var(--ed-fg) / 0.5)'

export function FrameBackgroundFields({ value, onChange, disabled }: {
  /** null: as the frame's template has it */
  value: FrameBackground | null
  onChange: (bg: FrameBackground | null) => void
  disabled?: boolean
}) {
  const bg = value ?? DEFAULT_FRAME_BG
  const style = value ? value.style : 'template'
  const set = (patch: Partial<FrameBackground>) => onChange({ ...bg, ...patch })
  // (the label above, the choices across the full width: the options panel can be narrow)
  const seg = <T extends string>(label: string, options: Array<[T, string]>, v: T, pick: (v: T) => void) => (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium" style={{ color: muted }}>{label}</span>
      <div className="cap-seg w-full" role="radiogroup" aria-label={label}>
        {options.map(([id, name]) => (
          <button key={id} type="button" role="radio" aria-checked={v === id} data-on={v === id || undefined} disabled={disabled}
            className="cap-seg-btn flex-1 min-w-0" style={{ height: 24, padding: '0 4px', fontSize: 11 }} onClick={() => pick(id)}>{name}</button>
        ))}
      </div>
    </div>
  )
  return (
    <div className="flex flex-col gap-2">
      {seg('Background', [['template', 'Frame’s'], ['solid', 'Colour'], ['gradient', 'Gradient'], ['pattern', 'Pattern']], style,
        v => onChange(v === 'template' ? null : { ...bg, style: v }))}
      {value && (
        <>
          <ColorPick label={value.style === 'solid' ? 'Colour' : value.style === 'gradient' ? 'From' : 'Ground'} value={bg.color} disabled={disabled} onChange={color => set({ color })} />
          {value.style !== 'solid' && (
            <ColorPick label={value.style === 'gradient' ? 'To' : 'Pattern'} value={bg.color2} disabled={disabled} onChange={color2 => set({ color2 })} />
          )}
          {value.style === 'gradient' && seg('Direction', [['down', 'Top to bottom'], ['diagonal', 'Diagonal']], bg.direction, direction => set({ direction }))}
          {/* How solid it is (user, 2026-11-19): below 100%, the video, blurred, shows through */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium w-14 shrink-0" style={{ color: muted }}>Opacity</span>
            <input type="range" min={0} max={100} step={5} value={Math.round((bg.opacity ?? 1) * 100)} disabled={disabled} aria-label="Background opacity"
              onChange={e => { const o = Number(e.target.value) / 100; onChange({ ...bg, opacity: o }) }}
              className="ed-zoom-range flex-1 min-w-0" style={{ width: 'auto', '--p': `${Math.round((bg.opacity ?? 1) * 100)}%` } as React.CSSProperties} />
            <span className="w-9 shrink-0 text-right text-[11px] tabular-nums" style={{ color: muted }}>{Math.round((bg.opacity ?? 1) * 100)}%</span>
          </div>
          {value.style === 'pattern' && (
            <>
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Pattern">
                {CARD_PATTERNS.map(pt => (
                  <button key={pt} type="button" role="radio" aria-checked={bg.pattern === pt} disabled={disabled} onClick={() => set({ pattern: pt })}
                    className="h-6 px-2 rounded-md text-[11px] font-semibold"
                    style={{ color: 'var(--ed-text)', background: bg.pattern === pt ? 'rgba(200,255,0,0.12)' : 'rgb(var(--ed-fg) / 0.06)', boxShadow: `inset 0 0 0 1px ${bg.pattern === pt ? '#c8ff00' : 'rgb(var(--ed-fg) / 0.1)'}` }}>
                    {PATTERN_NAMES[pt]}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium w-14 shrink-0" style={{ color: muted }}>Size</span>
                <input type="range" min={CARD_PATTERN_SCALE[0]} max={CARD_PATTERN_SCALE[1]} step={4} value={bg.scale} disabled={disabled} aria-label="Pattern size"
                  onChange={e => set({ scale: Number(e.target.value) })}
                  className="ed-zoom-range flex-1 min-w-0" style={{ width: 'auto', '--p': `${((bg.scale - CARD_PATTERN_SCALE[0]) / (CARD_PATTERN_SCALE[1] - CARD_PATTERN_SCALE[0])) * 100}%` } as React.CSSProperties} />
                <span className="w-8 shrink-0 text-right text-[11px] tabular-nums" style={{ color: muted }}>{bg.scale}</span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

/** A colour: the brand's colours as quick picks first, then any colour (none but the brand's under a brand lock) */
function ColorPick({ label, value, disabled, onChange }: { label: string; value: string; disabled?: boolean; onChange: (c: string) => void }) {
  const palette = useBrandPalette()
  const lock = useBrandLock()
  const quick = lock ? lock.colors : [...new Set([...palette, '#000000', '#ffffff'])].slice(0, 8)
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium w-14 shrink-0" style={{ color: muted }}>{label}</span>
      <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1">
        {quick.map(c => (
          <button key={c} type="button" disabled={disabled} onClick={() => onChange(c)} aria-label={`${label}: ${c}`} title={c}
            className="w-5 h-5 rounded-full shrink-0"
            style={{ background: c, boxShadow: c.toLowerCase() === value.toLowerCase() ? '0 0 0 2px #c8ff00' : '0 0 0 1px rgb(var(--ed-fg) / 0.25)' }} />
        ))}
        {!lock && (
          <>
            <input value={draft} maxLength={7} disabled={disabled} aria-label={`${label} (hex)`}
              onChange={e => { setDraft(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase()) }}
              onBlur={() => setDraft(value)}
              className="w-[68px] h-6 px-1.5 rounded-md text-[11px] font-mono text-[var(--ed-text)] outline-none"
              style={{ background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }} />
            <input type="color" value={value} disabled={disabled} onChange={e => onChange(e.target.value.toLowerCase())} aria-label={`Pick any ${label.toLowerCase()}`}
              className="w-6 h-6 rounded-md cursor-pointer bg-transparent" style={{ border: 'none', padding: 0 }} />
          </>
        )}
      </div>
    </div>
  )
}
