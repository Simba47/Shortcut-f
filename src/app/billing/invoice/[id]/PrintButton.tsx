'use client'

export function PrintButton() {
  return (
    <button type="button" className="iv-print" onClick={() => window.print()}>
      Print or save as PDF
    </button>
  )
}
