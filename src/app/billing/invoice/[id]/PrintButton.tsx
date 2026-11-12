'use client'

export function PrintButton() {
  return (
    <button onClick={() => window.print()} style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '8px 16px', fontSize: 14, cursor: 'pointer' }}>
      Print / Save as PDF
    </button>
  )
}
