import { NextResponse, type NextRequest } from 'next/server'

/**
 * Where a device goes once its account signed in on more devices than its plan allows (modules/auth/devices.ts):
 * its session cookie is cleared — the middleware can't tell it no longer counts — and it lands on
 * /login, whose sign-in form says why (the `signed_out` note, AuthSlider.tsx).
 */
export async function GET(req: NextRequest) {
  // Only the path: the browser stays on the address it is using. (Behind Railway the website sees
  // itself as localhost:8080, so an address built from req.url sent the device to https://localhost:8080.)
  const res = new NextResponse(null, { status: 307, headers: { Location: '/login' } })
  for (const { name } of req.cookies.getAll()) {
    // authjs.session-token, its __Secure- form on https, and their chunks (.0, .1, …)
    if (!name.includes('authjs.session-token')) continue
    res.cookies.set(name, '', { maxAge: 0, path: '/', httpOnly: true, sameSite: 'lax', secure: name.startsWith('__Secure-') })
  }
  res.cookies.set('signed_out', 'elsewhere', { maxAge: 10 * 60, path: '/', sameSite: 'lax' })
  return res
}
