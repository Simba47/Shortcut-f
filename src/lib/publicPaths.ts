// Pages anyone can open without signing in. Legal pages must be here: app store reviewers check them.
// Used by the server check (auth.config.ts) and the browser check (app/providers.tsx). Razorpay's
// website review checks prices and the refund policy signed out too: payments from a site it has not
// approved are blocked.
export const PUBLIC_PATHS = ['/', '/pricing', '/refunds', '/privacy', '/terms', '/support', '/delete-account']

// The sign-in pages (a signed-in visitor is sent on to the dashboard from these)
export const AUTH_PAGES = ['/login', '/signup', '/verify-otp', '/forgot-password', '/reset-password', '/restore-account']

// The parts of the site that need an account: a signed-out visitor is sent to sign in from these
// only. Any other address that isn't a page (/abc, an old link) shows "Page not found", not the
// sign-in page (F2 bug 9). A new signed-in page needs its first folder here: publicPaths.test.ts
// fails until every page folder in src/app is in one of these three lists.
export const SIGNED_IN_AREAS = ['/dashboard', '/upload', '/videos', '/editor', '/brand', '/billing', '/settings', '/guide']

const under = (pathname: string, area: string) => pathname === area || pathname.startsWith(`${area}/`)

export const isAuthPage = (pathname: string) => AUTH_PAGES.some(p => under(pathname, p))

/** Whether a signed-out visitor at this address should be sent to sign in */
export const needsSignIn = (pathname: string) => SIGNED_IN_AREAS.some(a => under(pathname, a))
