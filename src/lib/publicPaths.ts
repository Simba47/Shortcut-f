// Pages anyone can open without signing in. Legal pages must be here: app store reviewers check them.
// Used by the server check (auth.config.ts) and the browser check (app/providers.tsx). Razorpay's
// website review checks prices and the refund policy signed out too: payments from a site it has not
// approved are blocked.
export const PUBLIC_PATHS = ['/', '/pricing', '/refunds', '/privacy', '/terms', '/support', '/delete-account']
