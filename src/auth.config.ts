import type { NextAuthConfig } from 'next-auth'
import { isAuthPage, needsSignIn } from './lib/publicPaths'

export const authConfig = {
  // AUTH_TRUST_HOST isn't reliably picked up on Railway (vs. Vercel, which sets it for you) —
  // set it directly so both middleware (edge) and auth.ts (node) trust the deployed host.
  trustHost: true,
  pages: {
    signIn: '/login',
    // (a Google sign-in that didn't finish comes back to the form, which says why: ?error=…)
    error: '/login',
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const { pathname } = nextUrl
      // Signed out: sent to sign in only from the signed-in parts of the site. Public pages, the
      // sign-in pages and the API pass (the API checks for itself), and so does an address that isn't
      // a page, which shows Page not found (F2 bug 9: it used to show the sign-in page)
      if (!isLoggedIn && needsSignIn(pathname)) return false
      if (isLoggedIn && isAuthPage(pathname)) return Response.redirect(new URL('/dashboard', nextUrl))
      return true
    },
  },
  providers: [],
} satisfies NextAuthConfig
