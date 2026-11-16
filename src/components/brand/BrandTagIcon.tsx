'use client'

import { useId } from 'react'

/**
 * The brand kit's one icon (user, 2026-11-16: "keep this logo for the brand kit everywhere"): a tag.
 * Drawn on a 16-unit grid; it reads by what it's doing —
 *   plain  an outline in the text colour (buttons, titles, the editor's tool)
 *   on     a kit is on: the tag filled with the kit's main colour, its hole in the accent colour
 *   off    no kit: a faint outline with a slash through it (the slash cut clear of the tag)
 */
export const BRAND_TAG_PATH = 'M2.5 8.6V3.5a1 1 0 0 1 1-1h5.1l5 5a1 1 0 0 1 0 1.4l-4.7 4.7a1 1 0 0 1-1.4 0z'

/** The bare shapes, for an <svg viewBox="0 0 16 16"> someone else draws (stroke from that svg) */
export const BRAND_TAG = <><path d={BRAND_TAG_PATH} /><circle cx="5.6" cy="5.6" r="1" fill="currentColor" stroke="none" /></>

type Props = {
  size?: number
  /** line weight in the 16-unit grid (1.6 matches the clip board's lists; the editor's tool bar uses 1.2 ≈ its 1.8 on 24) */
  weight?: number
  /** a kit's colours: the tag shows it on */
  kit?: { main: string; accent: string } | null
  /** no kit: the slashed tag */
  off?: boolean
  className?: string
}

export function BrandTagIcon({ size = 15, weight = 1.6, kit, off, className }: Props) {
  const id = useId()
  const mask = `bt-${id.replace(/:/g, '')}`
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={weight}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`brand-tag${className ? ` ${className}` : ''}`}
      data-state={kit ? 'on' : off ? 'off' : undefined}>
      {kit ? (
        <>
          <path d={BRAND_TAG_PATH} fill={kit.main} strokeOpacity={0.45} />
          <circle cx="5.6" cy="5.6" r="1.25" fill={kit.accent} stroke="currentColor" strokeOpacity={0.45} strokeWidth={0.8} />
        </>
      ) : off ? (
        <>
          <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="16" height="16">
            <rect width="16" height="16" fill="#fff" />
            <path d="M2.2 13.8L13.8 2.2" stroke="#000" strokeWidth={weight + 2.4} />
          </mask>
          <g mask={`url(#${mask})`} opacity={0.6}>{BRAND_TAG}</g>
          <path d="M2.2 13.8L13.8 2.2" opacity={0.85} />
        </>
      ) : BRAND_TAG}
    </svg>
  )
}
