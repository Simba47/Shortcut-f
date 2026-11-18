'use client'

import { SessionProvider, useSession } from 'next-auth/react'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { needsSignIn } from '@/lib/publicPaths'
import { BrandKitDialogHost } from '@/components/brand/BrandKitDialog'
import { GoogleAnalytics } from '@/components/analytics/GoogleAnalytics'
import { LastSeenPing } from '@/components/LastSeenPing'

function SessionWatcher() {
  const { status, data } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const replaced = !!data?.replaced

  useEffect(() => {
    // The account signed in on another device: this one is signed out (a full page load, so the
    // route can clear the cookie)
    if (replaced) { window.location.replace('/api/auth/signed-out'); return }
    // (only from the signed-in parts of the site: an address that isn't a page stays on Page not found)
    if (status === 'unauthenticated' && needsSignIn(pathname)) {
      router.replace('/login')
    }
  }, [status, replaced, pathname, router])

  return null
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    // Checked every minute (and when the tab comes back into focus): a device replaced by a
    // sign-in elsewhere is signed out even while it sits idle
    <SessionProvider refetchInterval={60}>
      <SessionWatcher />
      {/* Google Analytics: only where NEXT_PUBLIC_GA_ID is set (the live site) */}
      <GoogleAnalytics />
      {/* Signed in with the site open: the admin's green "online" dot */}
      <LastSeenPing />
      {children}
      {/* Brand kits, as a popup over any page (openBrandKits) */}
      <BrandKitDialogHost />
    </SessionProvider>
  )
}
