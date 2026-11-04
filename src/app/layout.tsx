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
      {/* Dark everywhere, except that the dashboard, the clip board and the editor have a dark /
          light switch (components/ui/cinematic-theme-switcher.tsx). Its choice (`shortcut-theme`) is
          put on those pages before they paint, so a light page never flashes dark. The old
          site-wide switch's `theme` is cleared so nobody stays stuck in light mode. */}
      <body className={displayFont.variable}>
        {/* next/script runs it before the page is interactive (a raw <script> in a component
            makes React warn on every render) */}
        <Script id="clear-old-theme" strategy="beforeInteractive">
          {`try { localStorage.removeItem('theme'); if (/^\\/(dashboard|videos\\/|editor\\/)/.test(location.pathname) && localStorage.getItem('shortcut-theme') === 'light') document.documentElement.setAttribute('data-theme', 'light') } catch (e) {}`}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
