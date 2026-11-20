'use client'

import { useState } from 'react'
import type { ToolGuides } from '@/server/services/toolGuides'

/** "Show tool guides in the editor": the loops on the timeline tools, or just their names (/api/account/tool-guides) */
export function ToolGuidesSwitch({ initial }: { initial: ToolGuides }) {
  const [state, setState] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function flip() {
    const on = !state.on
    setBusy(true); setError(null)
    setState(s => ({ ...s, on, chosen: true }))
    try {
      const r = await fetch('/api/account/tool-guides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error ?? 'Could not save')
      setState(d)
    } catch {
      setState(s => ({ ...s, on: !on }))
      setError('Could not save. Check the connection and try again.')
    } finally { setBusy(false) }
  }

  const why = error ?? (state.chosen
    ? (state.on ? 'On: every tool shows its little video when you point at it.' : 'Off: tools show just their name and shortcut.')
    : (state.exported
      ? 'Off since your first export: tools show just their name and shortcut. Switch on to see the videos again.'
      : 'On until your first export. After that, tools show just their name and shortcut.'))

  return (
    <div className="gd-switch">
      <div className="gd-switch-text">
        <b id="gd-guides-label">Show tool guides in the editor</b>
        <span className={error ? 'gd-switch-err' : undefined} aria-live="polite">{why}</span>
      </div>
      <button type="button" role="switch" className="gd-toggle" aria-checked={state.on} aria-labelledby="gd-guides-label"
        disabled={busy} onClick={flip} />
    </div>
  )
}
