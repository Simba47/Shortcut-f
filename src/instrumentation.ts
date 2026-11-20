// Runs once when a copy of the site starts (Next.js instrumentation).

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // The Gemini key's prepaid credits ran out: noted for the admin's Gemini credits page
  // (server/services/aiUsage.ts). Never stops the site from starting.
  try {
    const { onKeyCreditsEmpty } = await import('@/lib/gemini')
    const { keyCreditsEmptyRecorder } = await import('@/server/services/aiUsage')
    onKeyCreditsEmpty(keyCreditsEmptyRecorder('website'))
  } catch (e) {
    console.warn('[gemini] credits-empty watch not set up:', e instanceof Error ? e.message : e)
  }
}
