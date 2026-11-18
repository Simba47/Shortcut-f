'use client'

import { useSession } from 'next-auth/react'
import { useEffect } from 'react'

/**
 * Tells the server this account has the site open (app/api/account/seen): when the tab is shown,
 * then once a minute while it stays visible. A tab left in the background stops pinging, so the
 * admin's green "online" dot goes out ~2 minutes after the person leaves.
 */
export function LastSeenPing() {
  const { status } = useSession()
  useEffect(() => {
    if (status !== 'authenticated') return
    const ping = () => {
      if (document.visibilityState !== 'visible') return
      fetch('/api/account/seen', { method: 'POST', keepalive: true }).catch(() => {})
    }
    ping()
    const timer = setInterval(ping, 60_000)
    document.addEventListener('visibilitychange', ping)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', ping) }
  }, [status])
  return null
}
