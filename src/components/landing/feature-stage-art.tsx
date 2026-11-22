/**
 * The Features showcase's stage art (user 2026-11-22: "design these cards properly"): one scene per feature, drawn
 * from the hero's own podcast footage (public/landing/hero-podcast.jpg, 1280 × 720 — him on the left, her on the right)
 * so the stage looks like the product at work. Each scene loops gently by itself (CSS: transforms and opacity only;
 * styles .fa-* in app/landing.css); with reduced motion they hold still.
 */
const SHOT = '/landing/hero-podcast.jpg'
// a 9:16 crop of the 16:9 shot, centred on him (4 %) or on her (99 %)
const crop = (x: number) => ({ backgroundImage: `url(${SHOT})`, backgroundPosition: `${x}% 50%` })

function Phone({ x, children, className = '' }: { x: number; children?: React.ReactNode; className?: string }) {
  return (
    <div className={`fa-phone ${className}`}>
      <div className="fa-phone-shot" style={crop(x)} />
      <span className="fa-island" />
      {children}
    </div>
  )
}

const CAPTION = ['Every', 'episode', 'has', 'ten', 'great', 'moments']

export function StageArt({ id }: { id: string }) {
  switch (id) {
    case 'steer':                     // the wide shot, the 9:16 frame gliding between them; the preview follows
      return (
        <div className="fa fa-steer">
          <div className="fa-wide" style={{ backgroundImage: `url(${SHOT})` }}>
            <div className="fa-frame" style={{ backgroundImage: `url(${SHOT})` }}><span className="fa-frame-tag">Frame · Video</span><i /><b /></div>
          </div>
          <div className="fa-steer-preview"><div className="fa-phone"><div className="fa-phone-shot fa-pan" style={{ backgroundImage: `url(${SHOT})` }} /><span className="fa-island" /></div></div>
          <span className="fa-chip fa-chip-live"><i />Steering live</span>
        </div>
      )
    case 'export':                    // three clips rendering side by side, each ending ready
      return (
        <div className="fa fa-render">
          {[4, 99, 52].map((x, k) => (
            <div key={k} className="fa-render-clip" style={{ '--k': k } as React.CSSProperties}>
              <Phone x={x} />
              <div className="fa-render-bar"><i /></div>
              <span className="fa-render-state"><em>Rendering</em><strong>✓ Ready</strong></span>
            </div>
          ))}
          <span className="fa-chip">While you edit</span>
        </div>
      )
    case 'captions':                  // the words write themselves, the current one lit; the style chips
      return (
        <div className="fa fa-captions">
          <Phone x={4}>
            <p className="fa-cap">{CAPTION.map((w, k) => <span key={w} style={{ '--k': k } as React.CSSProperties}>{w}</span>)}</p>
          </Phone>
          <div className="fa-styles">
            <span data-on>Karaoke</span><span>Box</span><span>Highlight</span>
          </div>
        </div>
      )
    case 'hooks':                     // a hook title pops onto the short; a text toolbar beside it
      return (
        <div className="fa fa-hooks">
          <Phone x={99}>
            <span className="fa-hook">Wait for it…</span>
          </Phone>
          <div className="fa-toolbar">
            <span className="fa-tb-font">Aa</span>
            <span className="fa-tb-b">B</span>
            <span className="fa-tb-sw" style={{ background: '#fff' }} />
            <span className="fa-tb-sw fa-tb-on" style={{ background: 'var(--logo, #c8ff00)' }} />
            <span className="fa-tb-sw" style={{ background: '#38bdf8' }} />
          </div>
        </div>
      )
    case 'layouts':                   // three real layouts, the chosen one outlined
      return (
        <div className="fa fa-layouts">
          <figure><Phone x={4} /><figcaption>Vertical</figcaption></figure>
          <figure className="fa-pick">
            <div className="fa-phone fa-split">
              <div className="fa-split-half" style={{ backgroundImage: `url(${SHOT})`, backgroundPosition: '6% 40%' }} />
              <div className="fa-split-half" style={{ backgroundImage: `url(${SHOT})`, backgroundPosition: '97% 40%' }} />
              <span className="fa-island" />
            </div>
            <figcaption>Split</figcaption>
          </figure>
          <figure>
            <div className="fa-phone fa-vt">
              <span className="fa-vt-title">10 great moments</span>
              <div className="fa-vt-shot" style={{ backgroundImage: `url(${SHOT})` }} />
              <span className="fa-vt-line" /><span className="fa-vt-line fa-vt-line-2" />
              <span className="fa-island" />
            </div>
            <figcaption>Video + Text</figcaption>
          </figure>
        </div>
      )
    default:
      return null
  }
}
