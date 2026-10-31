'use client'

import { SessionProvider, useSession } from 'next-auth/react'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { PUBLIC_PATHS } from '@/lib/publicPaths'
import { BrandKitDialogHost } from '@/components/brand/BrandKitDialog'

const AUTH_PAGES = ['/login', '/signup', '/verify-otp', '/forgot-password', '/reset-password']

function SessionWatcher() {
  const { status, data } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const replaced = !!data?.replaced

  useEffect(() => {
    // The account signed in on another device: this one is signed out (a full page load, so the
    // route can clear the cookie)
    if (replaced) { window.location.replace('/api/auth/signed-out'); return }
    if (status === 'unauthenticated' && !AUTH_PAGES.some(p => pathname.startsWith(p)) && !PUBLIC_PATHS.includes(pathname)) {
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
      {children}
      {/* Brand kits, as a popup over any page (openBrandKits) */}
      <BrandKitDialogHost />
    </SessionProvider>
  )
}
