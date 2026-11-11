'use client'

/**
 * While a clip's captions are made (AI reading its speech: a minute or more on a new video), a scan
 * goes over the picture: lime corner marks round it, a glowing line sweeping down with a grid in its
 * wake and points riding it (the user's references, 2026-11-09). A loop, not progress: how far AI
 * has got isn't known. Clicks go through it; it fades out as the words arrive (styles: .cap-scan).
 */
export function CaptionScan({ label }: {
  /** The line under it while captions are made; null: no scan */
  label: string | null
}) {
  return (
    <div className="cap-scan" data-on={label !== null || undefined} aria-hidden="true">
      <i className="cap-scan-corner" data-c="tl" />
      <i className="cap-scan-corner" data-c="tr" />
      <i className="cap-scan-corner" data-c="bl" />
      <i className="cap-scan-corner" data-c="br" />
      <div className="cap-scan-track">
        <div className="cap-scan-grid" />
        <div className="cap-scan-sweep">
          <div className="cap-scan-line"><b /><b /><b /></div>
        </div>
      </div>
      {label !== null && <span className="cap-scan-tag"><i />{label}</span>}
    </div>
  )
}
