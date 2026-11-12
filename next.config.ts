import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  devIndicators: false,
  // React's compiler, only for components marked 'use memo' (the editor): it keeps the parts of the
  // editor that didn't change, so a drag no longer rebuilds the whole editor on every mouse move
  // (measured 2026-10-26: half the main-thread work per drag, the same saves)
  reactCompiler: { compilationMode: 'annotation' },
  // Let phones/laptops on the same Wi-Fi open the dev server (http://192.168.x.x:3000).
  // Next blocks dev scripts for non-localhost origins otherwise, so nothing is interactive.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*'],
  // The mascot picture (the loader's panda) is kept by the browser for a week, so the loader shows it at once
  async headers() {
    return [
      { source: '/mascot/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=2592000' }] },
      // Every page: no other site may show ours inside a frame (clickjacking), HTTPS only, files
      // read as the type they say they are, and no camera, microphone or location
      { source: '/:path*', headers: [
        { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ] },
    ]
  },
experimental: {
    serverActions: {
      bodySizeLimit: '2gb',
    },
    // Raise the 10 MB default cap on incoming request bodies for route handlers.
    // Without this, uploads > 10 MB are silently truncated before busboy reads them.
    middlewareClientMaxBodySize: 2 * 1024 * 1024 * 1024,
  },
}

export default nextConfig
