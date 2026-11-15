'use client'

import Link from 'next/link'
import { useSession } from 'next-auth/react'

export default function NotFound() {
  // Signed in: back to the dashboard. Signed out (a mistyped address, an old link): back to the home
  // page, not the dashboard, which would only ask them to sign in (F2 bug 9)
  const { status } = useSession()
  const signedIn = status === 'authenticated'
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0d0d0d', padding: 24, textAlign: 'center' }}>
      <p style={{ fontSize: 64, lineHeight: 1, marginBottom: 16 }}>✂</p>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Page not found</h1>
      <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', maxWidth: 320, marginBottom: 28 }}>
        The clip or page you&apos;re looking for doesn&apos;t exist or may have been deleted.
      </p>
      <Link
        href={signedIn ? '/dashboard' : '/'}
        style={{ padding: '10px 24px', borderRadius: 12, background: '#c8ff00', color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer', border: 'none', textDecoration: 'none' }}
      >
        {signedIn ? 'Go to Dashboard' : 'Go to home page'}
      </Link>
    </div>
  )
}
