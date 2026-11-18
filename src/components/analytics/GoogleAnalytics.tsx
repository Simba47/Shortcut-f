'use client'

import Script from 'next/script'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { GA_ID, apiEvent, campaignQuery, jsonBody, pageKind, track } from '@/lib/analytics'

// Google Analytics on every page (lib/analytics.ts says what is counted and what never is). Nothing at
// all without NEXT_PUBLIC_GA_ID (QA, local).

/** gtag, queued until Google's script arrives (so the first page and early events aren't lost) */
function ensureGtag() {
  if (typeof window.gtag === 'function') return
  window.dataLayer = window.dataLayer ?? []
  window.gtag = function gtag() {
    // (gtag.js reads the arguments object itself, as Google's own snippet pushes it)
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments)
  }
  window.gtag('js', new Date())
  window.gtag('config', GA_ID, {
    // Pages are sent by hand, by their kind (PageViews)
    send_page_view: false,
    // No advertising features: the Privacy Policy says we don't use them
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  })
}

/** A same-site page as GA sees it: its kind, and the campaign tags only */
const pageLocation = (pathname: string, search: string) => `${window.location.origin}${pageKind(pathname)}${campaignQuery(search)}`

/** Where the visitor came from: another site as it is; one of ours, by its kind */
function referrer(): string | undefined {
  const r = document.referrer
  if (!r) return undefined
  try {
    const u = new URL(r)
    return u.origin === window.location.origin ? `${u.origin}${pageKind(u.pathname)}` : r
  } catch { return undefined }
}

/** The page last counted: the same page drawn again (React's development double run, a remount) isn't a new view */
let lastViewed = ''

let fetchWatched = false
/**
 * The site's own server calls that are an event (lib/analytics.ts API_EVENTS) are counted when they
 * work, whichever page made them; a call refused for want of credits is counted as out_of_credits.
 * The call itself is untouched: same request, same answer, errors as they were.
 */
function watchFetch() {
  if (fetchWatched || typeof window.fetch !== 'function') return
  fetchWatched = true
  const original = window.fetch
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const res = await original.call(window, input, init)
    try {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href)
      if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
        const e = apiEvent(method, url.pathname)
        if (e) {
          const where = pageKind(window.location.pathname)
          if (res.ok) track(e.event, { ...e.params?.(jsonBody(init?.body)), page_kind: where })
          else if (res.status === 402) track('out_of_credits', { action: e.event, page_kind: where })
        }
      }
    } catch { /* counting never breaks a call */ }
    return res
  }
}

function PageViews() {
  const pathname = usePathname()
  const { data } = useSession()
  const userId = data?.user?.id ?? null

  // The signed-in account by its internal id only (one person across their phone and laptop)
  useEffect(() => {
    ensureGtag()
    window.gtag!('set', { user_id: userId })
  }, [userId])

  useEffect(() => {
    ensureGtag()
    watchFetch()
    if (pathname === lastViewed) return
    lastViewed = pathname
    const kind = pageKind(pathname)
    window.gtag!('event', 'page_view', {
      page_location: pageLocation(pathname, window.location.search),
      page_title: kind,
      page_referrer: referrer(),
    })
  }, [pathname])

  return null
}

export function GoogleAnalytics() {
  if (!GA_ID) return null
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`} strategy="afterInteractive" />
      <PageViews />
    </>
  )
}
