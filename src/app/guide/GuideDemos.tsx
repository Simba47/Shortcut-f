/**
 * The Guide's little demos (user, 2026-11-19: "less text, show it"): drawn loops in the same style as the
 * timeline tools' (toolHints.css .th-* gives the stage, bars, picture); their own parts are .gdv-* in
 * guide.css. Each is one 216 × 120 scene on a loop.
 */

type Scene = 'upload' | 'link' | 'askai' | 'clipboard' | 'captions' | 'export' | 'brand'

const D: Record<Scene, number> = { upload: 3.6, link: 3.8, askai: 4.2, clipboard: 4.2, captions: 3, export: 3.8, brand: 3.8 }

const Check = () => <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
/** The + on an Ask AI result: its size and place on the element itself */
const ADD: React.CSSProperties = { left: 18, top: -6, width: 14, height: 14 }
const dl = (n: number) => ({ ['--dl' as string]: n }) as React.CSSProperties

/** A small picture (sky, sun, a person, the ground), as on the timeline tools' screens */
function Pic() {
  return <div className="th-pic"><i className="th-pic-sun" /><i className="th-pic-ground" /><i className="th-pic-head" /><i className="th-pic-body" /></div>
}

/** askText: what's typed in Ask AI's box (Make my clips' card shows "best moments": MmcProgress.tsx) */
export function Demo({ scene, label, askText }: { scene: Scene; label: string; askText?: string }) {
  return (
    <div className="th-stage gdv" data-scene={scene} style={{ ['--th-d' as string]: `${D[scene]}s` }} role="img" aria-label={label}>
      <div className="th-loop">{parts(scene, askText)}</div>
    </div>
  )
}

function parts(scene: Scene, askText = 'funny reactions') {
  switch (scene) {
    case 'upload':
      return (<>
        <i className="gdv-zone" />
        <span className="gdv-up-ico"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg></span>
        <span className="gdv-file"><b>MP4</b></span>
        <i className="gdv-track gdv-up-track"><i /></i>
        <span className="gdv-done gdv-up-done"><Check /></span>
      </>)
    case 'link':
      return (<>
        <span className="gdv-input gdv-link-in">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7" /></svg>
          <span className="gdv-link-text">drive.google.com/file/d/…</span>
        </span>
        <span className="gdv-ask">
          <span className="gdv-coin">₹</span><span>15 credits</span><b className="gdv-ok">OK</b>
        </span>
        <i className="gdv-track gdv-link-track"><i /></i>
        <span className="gdv-done gdv-link-done"><Check /></span>
      </>)
    case 'askai':
      return (<>
        <span className="gdv-input gdv-ask-in">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
          <span className="gdv-ask-text">{askText}</span>
        </span>
        <div className="th-bar" data-k="main" style={{ left: 16, width: 184, top: 44, height: 22 }} />
        <i className="gdv-mark" style={{ left: 38, width: 24, ...dl(0) }} />
        <i className="gdv-mark" style={{ left: 104, width: 20, ...dl(0.06) }} />
        <i className="gdv-mark" style={{ left: 160, width: 26, ...dl(0.12) }} />
        <span className="gdv-res" style={{ left: 37, ...dl(0) }}><Pic /><i className="gdv-add" style={ADD}>+</i></span>
        <span className="gdv-res" style={{ left: 101, ...dl(0.06) }}><Pic /><i className="gdv-add" style={ADD}>+</i></span>
        <span className="gdv-res" style={{ left: 160, ...dl(0.12) }}><Pic /><i className="gdv-add" style={ADD}>+</i></span>
      </>)
    case 'clipboard':
      return (<>
        {['#c8ff00', '#c8ff00', '#38bdf8', 'rgba(255,255,255,.55)', '#38bdf8', '#c8ff00'].map((tag, i) => (
          <span key={i} className="gdv-card" style={{ left: 14 + i * 32, ...dl(i * 0.05) }}>
            <Pic /><i className="gdv-cap" /><i className="gdv-tag" style={{ background: tag }} />
            {i === 1 && <i className="gdv-heart"><svg viewBox="0 0 24 24" width="10" height="10" fill="#f472b6"><path d="M12 21s-7.5-4.6-9.5-9.2C1 8.4 3.4 5 6.8 5c2 0 3.6 1.1 5.2 3 1.6-1.9 3.2-3 5.2-3 3.4 0 5.8 3.4 4.3 6.8C19.5 16.4 12 21 12 21z" /></svg></i>}
            {i === 3 && <i className="gdv-exported" />}
          </span>
        ))}
      </>)
    case 'captions':
      return (
        <span className="gdv-phone" style={{ left: 77, top: 6, width: 62, height: 108 }}>
          <Pic />
          <span className="gdv-words"><em className="gdv-w0">SO</em> <em className="gdv-w1">GOOD</em> <em className="gdv-w2">!</em></span>
        </span>
      )
    case 'export':
      return (<>
        <span className="gdv-phone gdv-exp-clip" style={{ left: 40, top: 14, width: 50, height: 88 }}><Pic /><i className="gdv-exported gdv-exp-dot" /></span>
        <b className="gdv-pill gdv-exp-btn">Export</b>
        <span className="gdv-pill gdv-exp-bar"><i /></span>
        <b className="gdv-pill gdv-exp-dl">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v12M7 11l5 5 5-5M5 20h14" /></svg>Download
        </b>
      </>)
    case 'brand':
      return (<>
        <span className="gdv-kit">
          <i className="gdv-logo">S</i>
          <span className="gdv-swatches"><i style={{ background: '#c8ff00' }} /><i style={{ background: '#f472b6' }} /><i style={{ background: '#f4f4f5' }} /></span>
          <b>Aa</b>
        </span>
        {[0, 1, 2].map(i => (
          <span key={i}>
            <i className="gdv-fly" style={{ ...dl(i * 0.12), ['--tx' as string]: `${86 + i * 38}px` }} />
            <span className="gdv-phone gdv-brand-ph" style={{ left: 98 + i * 38, top: 30, width: 30, height: 54, ...dl(i * 0.12) }}>
              <Pic /><i className="gdv-ph-logo" /><i className="gdv-ph-cap" />
            </span>
          </span>
        ))}
      </>)
  }
}
