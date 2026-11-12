import { Resend } from 'resend'

let resend: Resend | null = null

function getResend(): Resend {
  if (!resend) {
    const key = process.env.AUTH_RESEND_KEY
    if (!key) throw new Error('AUTH_RESEND_KEY is not set')
    resend = new Resend(key)
  }
  return resend
}
const FROM = process.env.AUTH_EMAIL_FROM ?? 'Shortcut <noreply@resend.dev>'

export async function sendOtpEmail(
  email: string,
  otp: string,
  purpose: 'signup' | 'password_reset',
): Promise<void> {
  const isSignup = purpose === 'signup'
  const subject = isSignup ? 'Your Shortcut verification code' : 'Reset your Shortcut password'
  const heading = isSignup ? 'Verify your email' : 'Reset your password'
  const body = isSignup
    ? 'Enter this code to verify your Shortcut account.'
    : 'Enter this code to reset your password.'

  const { error } = await getResend().emails.send({
    from: FROM,
    to: email,
    subject,
    html: `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:48px 16px;">
      <table width="420" cellpadding="0" cellspacing="0"
        style="background:#141414;border:1px solid #2a2a2a;border-radius:12px;">
        <tr><td style="padding:36px 40px;">
          <p style="margin:0 0 4px;font-size:13px;color:#555;letter-spacing:.05em;">SHORTCUT</p>
          <h1 style="margin:8px 0 12px;font-size:20px;font-weight:700;color:#f0f0f0;">${heading}</h1>
          <p style="margin:0 0 28px;font-size:14px;color:#888;line-height:1.5;">${body}</p>
          <div style="background:#1e1e1e;border:1px solid #2a2a2a;border-radius:8px;
            padding:20px;text-align:center;margin-bottom:28px;">
            <span style="font-size:38px;font-weight:700;letter-spacing:14px;color:#c8ff00;
              font-variant-numeric:tabular-nums;">${otp}</span>
          </div>
          <p style="margin:0;font-size:12px;color:#555;line-height:1.6;">
            This code expires in <strong style="color:#888;">10 minutes</strong>.<br>
            If you didn&apos;t request this, you can safely ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
  // The SDK doesn't throw on API-level failures (bad key, unverified domain, etc.) — it just
  // returns { error }. Left unchecked, the caller (and the user) sees a false "email sent".
  if (error) {
    console.error('[mailer] Resend rejected the OTP email:', error)
    throw new Error(`Failed to send verification email: ${error.message}`)
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

/** The receipt for a payment, with a link to the invoice on the billing page */
export async function sendReceiptEmail(r: {
  to: string; name: string | null; planName: string; amountPaise: number; invoiceNo: string | null
  paidAt: Date; invoiceId: string; taxInvoice: boolean
}): Promise<void> {
  const base = (process.env.APP_URL || process.env.AUTH_URL || 'https://shortcutapp.in').replace(/\/$/, '')
  const link = `${base}/billing/invoice/${r.invoiceId}`
  const amount = (r.amountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const date = r.paidAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const doc = r.taxInvoice ? 'tax invoice' : 'receipt'
  const hello = r.name ? `Hi ${esc(r.name)},` : 'Hi,'
  const { error } = await getResend().emails.send({
    from: FROM,
    to: r.to,
    subject: `Your Shortcut ${r.planName} payment of ₹${amount}`,
    html: `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:48px 16px;">
      <table width="460" cellpadding="0" cellspacing="0" style="background:#141414;border:1px solid #2a2a2a;border-radius:12px;">
        <tr><td style="padding:36px 40px;">
          <p style="margin:0 0 4px;font-size:13px;color:#555;letter-spacing:.05em;">SHORTCUT</p>
          <h1 style="margin:8px 0 12px;font-size:20px;font-weight:700;color:#f0f0f0;">Payment received</h1>
          <p style="margin:0 0 24px;font-size:14px;color:#888;line-height:1.5;">${hello} thank you. Your ${esc(r.planName)} plan is active.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#1e1e1e;border:1px solid #2a2a2a;border-radius:8px;margin-bottom:24px;">
            <tr><td style="padding:14px 18px;font-size:13px;color:#888;">Amount</td><td align="right" style="padding:14px 18px;font-size:15px;color:#c8ff00;font-weight:700;">₹${amount}</td></tr>
            <tr><td style="padding:0 18px 14px;font-size:13px;color:#888;">Date</td><td align="right" style="padding:0 18px 14px;font-size:13px;color:#f0f0f0;">${esc(date)}</td></tr>
            ${r.invoiceNo ? `<tr><td style="padding:0 18px 14px;font-size:13px;color:#888;">Invoice</td><td align="right" style="padding:0 18px 14px;font-size:13px;color:#f0f0f0;">${esc(r.invoiceNo)}</td></tr>` : ''}
          </table>
          <a href="${esc(link)}" style="display:inline-block;background:#c8ff00;color:#000;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;">View ${doc}</a>
          <p style="margin:24px 0 0;font-size:12px;color:#555;line-height:1.6;">Your plan renews every month until you cancel on the Plans page. Questions? Reply to this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
  if (error) {
    console.error('[mailer] Resend rejected the receipt email:', error)
    throw new Error(`Failed to send receipt email: ${error.message}`)
  }
}
