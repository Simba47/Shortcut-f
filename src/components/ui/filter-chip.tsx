'use client'

import { useEffect, useId, useRef, useState } from 'react'

/**
 * A filter as a small button that opens its choices (styles: .ag-chip / .ag-menu in app/globals.css): the AI
 * edits page's and the clip board's. Unset (its first
 * choice) it is quiet and says what it filters ("Length ▾"); set, it is brighter, says its choice and
 * has an ✕ that sets it back. Sort always says its choice. The menu: a tick on the choice, arrow keys,
 * Enter, Esc; a click outside closes it.
 */
export function FilterChip<T extends string>({ label, value, onChange, options, clearable = false, align = 'start', size = 'md', icon }: {
  label: string; value: T; onChange: (v: T) => void; options: Array<[T, string]>; clearable?: boolean; align?: 'start' | 'end'
  /** md: 40 px (AI edits, beside the dashboard's search pill); sm: 32 px; xs: 28 px (the clip board's narrow list) */
  size?: 'md' | 'sm' | 'xs'
  /** Shown in place of the label's words (which stay for screen readers): e.g. Sort's arrows */
  icon?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  // (kept a moment after closing, to fade out: .ag-menu[data-closing])
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (open) { setShown(true); return }
    if (!shown) return
    const t = setTimeout(() => setShown(false), 120)
    return () => clearTimeout(t)
  }, [open, shown])
  const [hi, setHi] = useState(0)
  const wrap = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const set = clearable && value !== options[0][0]
  const name = options.find(([id]) => id === value)?.[1] ?? ''
  useEffect(() => {
    if (!open) return
    const out = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', out)
    return () => window.removeEventListener('pointerdown', out)
  }, [open])
  const show = () => { setHi(Math.max(0, options.findIndex(([id]) => id === value))); setOpen(true) }
  const pick = (v: T) => { onChange(v); setOpen(false); btn.current?.focus() }
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) { if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show() } return }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHi(i => (i + 1) % options.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(i => (i - 1 + options.length) % options.length) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(options[hi][0]) }
    else if (e.key === 'Tab') setOpen(false)
  }
  const listId = `ag-menu-${useId().replace(/:/g, '')}`
  return (
    <div ref={wrap} className="ag-chip" data-size={size} data-set={set || undefined} data-open={open || undefined}>
      <button ref={btn} type="button" className="ag-chip-main" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${name}`} onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKey}>
        {icon ? <span className="ag-chip-icon" title={label}>{icon}</span> : <span className="ag-chip-label">{label}</span>}
        {(set || !clearable) && <span className="ag-chip-value">{name}</span>}
        {!set && <svg className="ag-chip-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>}
      </button>
      {set && (
        <button type="button" className="ag-chip-x" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onChange(options[0][0])}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      )}
      {shown && (
        <ul id={open ? listId : undefined} role="listbox" aria-label={label} className="ag-menu" data-align={align} data-closing={!open || undefined}>
          {options.map(([id, text], i) => (
            <li key={id} role="option" aria-selected={id === value} data-hi={i === hi || undefined}
              onPointerEnter={() => setHi(i)} onClick={() => pick(id)}>
              <svg className="ag-menu-tick" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              {text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
