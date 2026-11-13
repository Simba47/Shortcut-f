import type { Metadata } from 'next'
import { Inter_Tight } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import './landing.css'
import './auth.css'
import './legal.css'
import { Providers } from './providers'

// Exposed as --font-display; only the landing page opts into it
const displayFont = Inter_Tight({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-display',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Shortcut — Vertical Video Editor',
  description: 'Transcribe, clip, and edit vertical videos in Telugu, Hindi, and Hinglish.',
  icons: {
    icon: '/favicon.png',
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* Dark everywhere (user, 2026-11-13: the dark / light switch taken off every page). Anyone who had
          picked light keeps that choice in their browser (`shortcut-theme`, and the older site-wide `theme`):
          both are cleared, so nobody is stuck in light mode with no switch to leave it. (The light styles in
          globals.css stay, unused, in case light mode comes back.) */}
      <body className={displayFont.variable}>
        {/* next/script runs it before the page is interactive (a raw <script> in a component
            makes React warn on every render) */}
        <Script id="clear-old-theme" strategy="beforeInteractive">
          {`try { localStorage.removeItem('theme'); localStorage.removeItem('shortcut-theme') } catch (e) {}`}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
