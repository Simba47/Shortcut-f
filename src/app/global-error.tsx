'use client'

import { useEffect, useState } from 'react'

/**
 * The last safety net (user, 2026-11-28): shown only when the site's frame itself (the root layout) fails, so
 * the other error pages — which live inside that frame — can't. It replaces the whole page, <html> included,
 * and nothing of the site loads with it (no globals.css, no fonts, no session): so everything is in here — the
 * styles, the logo, the icon — and it works on its own. The error pages' look, kept simple: no panda, no videos.
 * Reload does a full reload (the frame is broken, so a fresh start is the fix); home is a plain link. The error
 * code is Next's digest (the same code sits next to the full error in the server log), shown only when there is one.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => { console.error(error) }, [error])
  const [copied, setCopied] = useState(false)
  const copy = () => {
    if (!error.digest) return
    navigator.clipboard?.writeText(error.digest).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400) }).catch(() => {})
  }

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>Shortcut couldn’t load</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <div className="ge">
          <header className="ge-head">
            <a href="/" className="ge-logo" aria-label="Shortcut home">
              <svg viewBox="0 0 102 118" aria-hidden="true"><path d="M36 2H92Q98 2 94 6L34 66A32 32 0 0 1 36 2Z" /><path d="M66 116H10Q4 116 8 112L68 52A32 32 0 0 1 66 116Z" /></svg>
              <span>Shortcut</span>
            </a>
          </header>

          <main className="ge-main">
            <span className="ge-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3M12 18v3M4.6 6.6l2.1 2.1M17.3 15.3l2.1 2.1M3 12h3M18 12h3M4.6 17.4l2.1-2.1M17.3 8.7l2.1-2.1" /></svg>
            </span>
            <h1 className="ge-title">Shortcut couldn’t load</h1>
            <p className="ge-sub"><span>Something went wrong on our side.</span> <span>Reload to try again.</span></p>
            <div className="ge-actions">
              <a href="/" className="ge-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>
                Go to home page
              </a>
              <button type="button" className="ge-btn ge-btn-main" onClick={() => window.location.reload()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" /></svg>
                Reload
              </button>
            </div>
            {error.digest && (
              <p className="ge-code">
                Error code <code>{error.digest}</code>
                <button type="button" className="ge-copy" onClick={copy} aria-label={copied ? 'Copied' : 'Copy the error code'} data-done={copied || undefined}>
                  {copied
                    ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                    : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>}
                </button>
              </p>
            )}
          </main>

          <footer className="ge-foot">© {new Date().getFullYear()} Shortcut · Stoory Marketing Pvt. Ltd.</footer>
        </div>
      </body>
    </html>
  )
}

/* All of its styles, in the page (the site's stylesheets don't load with it). The other error pages' look:
   dark, the same sizes, lime only on the main button; system fonts (the site's font may not load either). */
const CSS = `
*{box-sizing:border-box}
html,body{margin:0}
body{background:#050505;color:#f4f4f5;font-family:"Inter Tight",system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.ge{min-height:100vh;min-height:100svh;display:flex;flex-direction:column;background:radial-gradient(ellipse 70% 60% at 50% 42%,#111112,#050505 78%)}
.ge-head{display:flex;align-items:center;padding:18px clamp(16px,3.4vw,56px)}
.ge-logo{display:inline-flex;align-items:center;gap:9px;color:#f4f4f5;text-decoration:none;font-weight:700;font-size:19px;letter-spacing:-.02em;border-radius:8px}
.ge-logo svg{width:22px;height:25px}
.ge-logo path{fill:#c8ff00}
.ge-main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:12px 20px 48px}
.ge-ico{display:grid;place-items:center;width:56px;height:56px;margin-bottom:22px;border-radius:16px;color:rgba(244,244,245,.78);background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)}
.ge-ico svg{width:26px;height:26px}
.ge-title{margin:0;font-size:clamp(28px,4.18vw,46px);font-weight:800;letter-spacing:-.04em;line-height:1.06;text-wrap:balance}
.ge-sub{margin:14px 0 0;max-width:600px;font-size:clamp(14.5px,1.43vw,16px);line-height:1.55;color:rgba(244,244,245,.62)}
.ge-sub span{display:block;text-wrap:balance}
.ge-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-top:28px}
.ge-btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;height:48px;padding:0 23px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.03);color:#f4f4f5;font:inherit;font-size:14.5px;font-weight:700;text-decoration:none;cursor:pointer;transition:background .15s,border-color .15s,transform .15s}
.ge-btn:hover{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.3)}
.ge-btn:active{transform:scale(.97)}
.ge-btn svg{width:17px;height:17px}
.ge-btn-main{border:0;background:#c8ff00;color:#0a0a0a}
.ge-btn-main:hover{background:#d4ff33}
.ge-btn:focus-visible,.ge-logo:focus-visible,.ge-copy:focus-visible{outline:2px solid #c8ff00;outline-offset:3px}
.ge-code{display:inline-flex;align-items:center;gap:8px;margin:22px 0 0;font-size:12.5px;color:rgba(244,244,245,.42)}
.ge-code code{padding:4px 8px;border-radius:6px;background:rgba(255,255,255,.05);color:rgba(244,244,245,.62);font:500 12px/1 ui-monospace,"Cascadia Code",Consolas,monospace}
.ge-copy{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:transparent;color:rgba(244,244,245,.6);cursor:pointer}
.ge-copy:hover{color:#f4f4f5;border-color:rgba(255,255,255,.28)}
.ge-copy[data-done]{color:#c8ff00;border-color:rgba(200,255,0,.4)}
.ge-copy svg{width:14px;height:14px}
.ge-foot{padding:16px clamp(16px,3.4vw,56px);border-top:1px solid rgba(255,255,255,.06);font-size:12.5px;color:rgba(244,244,245,.42)}
@media (max-width:600px){
  .ge-head{padding:14px 16px}
  .ge-actions{flex-direction:column-reverse;width:100%;max-width:340px}
  .ge-btn{width:100%}
  .ge-foot{text-align:center}
}
`
