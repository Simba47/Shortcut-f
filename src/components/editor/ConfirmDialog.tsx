'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface ConfirmOptions {
  title: string
  body?: string
  /** Label of the confirming button (default "Delete") */
  confirmLabel?: string
  /** Label of the other button (default "Cancel") and what it does besides closing */
  cancelLabel?: string
  onCancel?: () => void
  /** The cancel button is an action of its own ("Go to it"): Esc or a click outside only closes */
  cancelIsAction?: boolean
  /** A warning rather than a delete: the confirm button isn't red */
  tone?: 'danger' | 'warning'
  /** A second, gentler thing to do instead (a quiet link under the text) */
  extraLabel?: string
  onExtra?: () => void
}

type Pending = ConfirmOptions & { onConfirm: () => void }

/**
 * "Are you sure?" before anything is deleted. `confirm(options, onConfirm)` opens the dialog and
 * runs `onConfirm` only if the user confirms; render `dialog` once in the page.
 */
export function useConfirm(): { confirm: (options: ConfirmOptions, onConfirm: () => void) => void; dialog: React.ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null)
  const confirm = useCallback((options: ConfirmOptions, onConfirm: () => void) => setPending({ ...options, onConfirm }), [])
  const dialog = pending ? <ConfirmDialog {...pending} onClose={() => setPending(null)} /> : null
  return { confirm, dialog }
}

function ConfirmDialog({ title, body, confirmLabel = 'Delete', cancelLabel = 'Cancel', onCancel, cancelIsAction, tone = 'danger', extraLabel, onExtra, onConfirm, onClose }: Pending & { onClose: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  // Esc and a click outside are the same answer as the cancel button, unless that button is an action of its own
  const dismissRef = useRef(() => {})
  dismissRef.current = () => { onClose(); if (!cancelIsAction) onCancel?.() }

  useEffect(() => {
    // Focus the confirm button so Enter confirms; Esc cancels. Capture phase so the editor's own
    // shortcuts (Delete, Space…) don't also act while the dialog is open.
    const previous = document.activeElement as HTMLElement | null
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismissRef.current() }
      else if (e.key !== 'Tab' && e.key !== 'Enter' && e.key !== ' ') e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); previous?.focus?.() }
  }, [onClose])

  // Premium sheet (styles: .cfm-* in globals.css): a frosted card with a gradient edge and a soft
  // glow in the action's colour, an animated icon (the bin's lid lifts), and two buttons that
  // show their keys (Esc / Enter)
  return (
    <div className="cfm-backdrop fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 400 }}
      onPointerDown={e => { if (e.target === e.currentTarget) dismissRef.current() }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby={body ? 'confirm-body' : undefined}
        className="editor-theme cfm-card" data-tone={tone}>
        <span className="cfm-icon" aria-hidden="true">
          <span className="cfm-ring" /><span className="cfm-ring cfm-ring-2" />
          {tone === 'danger' ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <g className="cfm-lid"><path d="M3 6h18" /><path d="M8 6V4h8v2" /></g>
              <path d="M6 6l1 14h10l1-14" /><path d="M10 11v6M14 11v6" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
            </svg>
          )}
        </span>
        <p id="confirm-title" className="cfm-title">{title}</p>
        {body && <p id="confirm-body" className="cfm-body">{body}</p>}
        {extraLabel && onExtra && (
          <button onClick={() => { onClose(); onExtra() }}
            className="text-[12px] underline underline-offset-2 transition-opacity opacity-70 hover:opacity-100"
            style={{ color: 'inherit', marginTop: -4, marginBottom: 10 }}>
            {extraLabel}
          </button>
        )}
        <div className="cfm-actions">
          <button onClick={() => { onClose(); onCancel?.() }} className="cfm-btn cfm-cancel">
            {cancelLabel}<kbd className="cfm-kbd">Esc</kbd>
          </button>
          <button ref={confirmRef} onClick={() => { onClose(); onConfirm() }} className="cfm-btn cfm-confirm">
            <span className="cfm-shine" aria-hidden="true" />
            {confirmLabel}<kbd className="cfm-kbd">↵</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}
