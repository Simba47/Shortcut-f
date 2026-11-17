import { BrandTagIcon } from './BrandTagIcon'

/**
 * "From your brand kit" (user, 2026-11-17: when a brand kit is on, its captions and title look win — the
 * same on every page). Said over the settings it takes the place of: Make my clips' Captions and Title
 * boxes, the editor's Captions panel (Style, Look) and Text panel (Style, Look). `onOwn`: the way to use
 * one's own style instead (the editor: for this clip); without it, `hint` says how. Styles: .kit-bar in
 * globals.css (works on the clip board's and the editor's colours alike).
 */
export function KitStyleBar({ what, kitName, onOwn, hint }: {
  /** "Captions", "Title", "Text" */
  what: string
  kitName: string
  onOwn?: () => void
  hint?: string
}) {
  return (
    <div className="kit-bar" role="status">
      <BrandTagIcon size={15} />
      <span className="kit-bar-text">
        <b>{what} from your brand kit</b>
        <small>{kitName}{hint ? ` · ${hint}` : ''}</small>
      </span>
      {onOwn && <button type="button" className="kit-bar-btn" onClick={onOwn}>Use my own style</button>}
    </div>
  )
}

/** Using one's own style while a kit is on (the editor): a quiet line, and the way back to the kit's */
export function KitStyleBack({ what, onKit }: { what: string; onKit: () => void }) {
  return (
    <p className="kit-back">
      Your own {what.toLowerCase()} style on this clip ·{' '}
      <button type="button" onClick={onKit}>Use the brand kit&rsquo;s again</button>
    </p>
  )
}
