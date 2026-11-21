// The email sent when videos come into their last days (server/services/expiry.ts sweepExpiry). Pure, so it is
// tested on its own (expiryEmail.test.ts); mailer.ts sends it. In the receipts' dark look.

export interface ExpiryEmailInput {
  base: string
  name: string | null
  /** Pro: "★ Keep" is offered */
  canKeep: boolean
  videos: Array<{ title: string | null; expiresAt: Date; clips: number }>
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const day = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })

export function expiryEmail(i: ExpiryEmailInput): { subject: string; html: string; text: string } {
  const n = i.videos.length
  const first = i.videos[0]
  const subject = n === 1
    ? `“${first.title || 'Your video'}” is deleted on ${day(first.expiresAt)}`
    : `${n} of your videos are deleted soon`
  const rows = i.videos.map(v => ({
    title: v.title || 'Untitled video',
    when: day(v.expiresAt),
    clips: v.clips === 0 ? 'no clips' : `${v.clips} clip${v.clips === 1 ? '' : 's'}`,
  }))
  const action = i.canKeep
    ? 'Download the clips you want, or press ★ Keep on the video to keep it for good.'
    : 'Download the clips you want before then. Pro keeps videos for good with ★ Keep.'
  const dash = `${i.base}/dashboard`
  const hello = i.name ? `Hi ${i.name.split(' ')[0]},` : 'Hi,'
  const text = [
    hello, '',
    `${n === 1 ? 'This video and its clips are' : 'These videos and their clips are'} deleted on the day shown:`,
    ...rows.map(r => `  • ${r.title} (${r.clips}): ${r.when}`), '',
    action, '', dash, '', 'Shortcut',
  ].join('\n')
  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 16px;">
  <table width="460" cellpadding="0" cellspacing="0" style="background:#141414;border:1px solid #2a2a2a;border-radius:12px;">
    <tr><td style="padding:36px 40px;">
      <p style="margin:0 0 4px;font-size:13px;color:#555;letter-spacing:.05em;">SHORTCUT</p>
      <h1 style="margin:8px 0 12px;font-size:20px;font-weight:700;color:#f0f0f0;">${n === 1 ? 'A video is deleted soon' : `${n} videos are deleted soon`}</h1>
      <p style="margin:0 0 18px;font-size:14px;color:#888;line-height:1.5;">${esc(hello)} ${n === 1 ? 'this video and its clips are' : 'these videos and their clips are'} deleted on the day shown.</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
        ${rows.map(r => `<tr><td style="padding:10px 0;border-top:1px solid #222;font-size:14px;color:#e6e6e6;">${esc(r.title)}<br><span style="font-size:12px;color:#666;">${r.clips}</span></td>
        <td align="right" style="padding:10px 0;border-top:1px solid #222;font-size:13px;color:#f5a623;white-space:nowrap;">${r.when}</td></tr>`).join('')}
      </table>
      <p style="margin:0 0 24px;font-size:14px;color:#888;line-height:1.5;">${esc(action)}</p>
      <a href="${esc(dash)}" style="display:inline-block;background:#c8ff00;color:#000;font-weight:700;font-size:14px;text-decoration:none;padding:11px 20px;border-radius:9px;">Open your videos</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`
  return { subject, html, text }
}
