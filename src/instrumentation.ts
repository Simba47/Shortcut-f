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
  // Videos expire after their plan's days (plans v2, 2026-11-21): the hourly sweep that warns and deletes
  // (server/services/expiry.ts; VIDEO_EXPIRY, off on a computer unless set). Never stops the site from starting.
  try {
    const { startExpirySweep } = await import('@/server/services/expiry')
    const { deleteVideos } = await import('@/server/services/videos')
    const { sendExpiryEmail } = await import('@/modules/auth/mailer')
    const { canKeep } = await import('@/lib/expiry')
    startExpirySweep({
      remove: deleteVideos,
      notify: (to, videos) => sendExpiryEmail({ to: to.email, name: to.name, canKeep: canKeep(to.plan), videos }),
    })
  } catch (e) {
    console.warn('[expiry] sweep not set up:', e instanceof Error ? e.message : e)
  }
}
