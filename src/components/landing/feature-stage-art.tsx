/**
 * The Features showcase's stage art (user 2026-11-22: "design these cards properly"): one scene per feature, drawn
 * from real podcast footage (not the hero's — see STUDIO and BOOTH below) so the stage looks like the product at work. Each scene loops gently by itself (CSS: transforms and opacity only;
 * styles .fa-* in app/landing.css); with reduced motion they hold still.
 */
// (user 2026-11-23: other footage than the hero's) two free Pexels clips the user downloaded, as stills (1280 × 720):
//   STUDIO  a bright studio, two women talking across a table (video 16069125) — her on the left at 13 %, her on the
//           right at 81 % (9:16 crop positions)
//   BOOTH   a woman at a yellow mic in a teal booth (video 7599378) — centred at 53 %
const STUDIO = '/landing/feat-studio.jpg'
const BOOTH = '/landing/feat-booth.jpg'
const crop = (img: string, x: number) => ({ backgroundImage: `url(${img})`, backgroundPosition: `${x}% 50%` })

function Phone({ img, x, children, className = '' }: { img: string; x: number; children?: React.ReactNode; className?: string }) {
  return (
    <div className={`fa-phone ${className}`}>
      <div className="fa-phone-shot" style={crop(img, x)} />
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
        <div className="fa fa-steer fa-steer-studio">
          <div className="fa-wide" style={{ backgroundImage: `url(${STUDIO})` }}>
            <div className="fa-frame" style={{ backgroundImage: `url(${STUDIO})` }}><span className="fa-frame-tag">Frame · Video</span><i /><b /></div>
          </div>
          <div className="fa-steer-preview"><div className="fa-phone"><div className="fa-phone-shot fa-pan" style={{ backgroundImage: `url(${STUDIO})` }} /><span className="fa-island" /></div></div>
          <span className="fa-chip fa-chip-live"><i />Steering live</span>
        </div>
      )
    case 'export':                    // three clips rendering side by side, each ending ready
      return (
        <div className="fa fa-render">
          {([[STUDIO, 13], [BOOTH, 53], [STUDIO, 81]] as const).map(([img, x], k) => (
            <div key={k} className="fa-render-clip" style={{ '--k': k } as React.CSSProperties}>
              <Phone img={img} x={x} />
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
          <Phone img={BOOTH} x={53}>
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
          <Phone img={STUDIO} x={81}>
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
          <figure><Phone img={BOOTH} x={53} /><figcaption>Vertical</figcaption></figure>
          <figure className="fa-pick">
            <div className="fa-phone fa-split">
              <div className="fa-split-half" style={{ backgroundImage: `url(${STUDIO})`, backgroundPosition: '14% 40%' }} />
              <div className="fa-split-half" style={{ backgroundImage: `url(${STUDIO})`, backgroundPosition: '80% 40%' }} />
              <span className="fa-island" />
            </div>
            <figcaption>Split</figcaption>
          </figure>
          <figure>
            <div className="fa-phone fa-vt">
              <span className="fa-vt-title">10 great moments</span>
              <div className="fa-vt-shot" style={{ backgroundImage: `url(${BOOTH})` }} />
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
