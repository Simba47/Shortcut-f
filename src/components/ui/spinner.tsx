import type { CSSProperties } from 'react'

/**
 * The one "working…" spinner, for every button and small wait (user, 2026-11-16: there were three
 * different ones). A faint ring with a bright arc running round it whose tail fades out; it is the
 * text's own colour and as big as the text (1em), so it fits any button — pass `size` (px) where it
 * stands alone (over a video). Slower, not stopped, with motion turned down: it still says "working".
 * Styles: .spin in app/globals.css.
 */
export function Spinner({ size, className, style }: { size?: number; className?: string; style?: CSSProperties }) {
  return (
    <span className={className ? `spin ${className}` : 'spin'} aria-hidden="true"
      style={size != null ? { fontSize: size, ...style } : style} />
  )
}
