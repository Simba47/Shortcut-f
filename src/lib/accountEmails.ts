// The emails about a deleted account (user, 2026-11-24): the one the person gets when Shortcut's admin deletes their
// account (with its restore link), and the one Shortcut's admins get when someone restores theirs (with their
// feedback). Pure: builds the subject, HTML and plain text. The site sends them (modules/auth/mailer.ts) and so does
// the admin app (a copy of this file: Shortcut-Admin-f scripts/sync-from-site.mjs). The same light look as the
// "Payment received" email (receiptEmail.ts). The admin's reason for the deletion is never in them.
import { COMPANY } from './company'

export interface MailParts { subject: string; html: string; text: string }

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const day = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
const hello = (name: string | null) => (name?.trim() ? `Hi ${name.trim().split(/\s+/)[0]},` : 'Hi,')

function page(o: { base: string; title: string; preheader: string; badge: string; body: string; button?: { href: string; label: string }; foot: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;">${esc(o.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;overflow:hidden;">
        <tr><td style="background:#0a0a0a;padding:20px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;">
              <img src="${esc(o.base)}/apple-icon.png" width="28" height="28" alt="" style="display:inline-block;vertical-align:middle;border-radius:7px;border:0;">
              <span style="display:inline-block;vertical-align:middle;margin-left:8px;font-size:17px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">Shortcut</span>
            </td>
            <td align="right" style="vertical-align:middle;">
              <span style="display:inline-block;background:#c8ff00;color:#0a0a0a;font-size:11px;font-weight:700;letter-spacing:.08em;padding:5px 10px;border-radius:999px;">${esc(o.badge)}</span>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:32px 28px 8px;">${o.body}</td></tr>
        ${o.button ? `<tr><td style="padding:16px 28px 8px;">
          <a href="${esc(o.button.href)}" style="display:inline-block;background:#0a0a0a;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px;">${esc(o.button.label)}</a>
        </td></tr>` : ''}
        <tr><td style="padding:16px 28px 28px;">
          <p style="margin:0;font-size:13px;line-height:1.55;color:#52525b;">Questions? Reply to this email or write to <a href="mailto:${esc(COMPANY.email)}" style="color:#0a0a0a;">${esc(COMPANY.email)}</a>.</p>
        </td></tr>
        <tr><td style="padding:16px 28px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:11.5px;line-height:1.6;color:#a1a1aa;">
          Shortcut is run by ${esc(COMPANY.legalName)}, ${esc(COMPANY.address.join(', '))}.<br>
          ${esc(o.foot)}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

const p = (s: string, o: { muted?: boolean; big?: boolean } = {}) =>
  `<p style="margin:0 0 ${o.big ? 10 : 12}px;font-size:${o.big ? 15 : 14}px;line-height:1.55;color:${o.muted ? '#71717a' : '#3f3f46'};">${s}</p>`

/**
 * "Your Shortcut account was deleted": everything is kept until `purgeAt`; the button opens the restore page
 * (`restoreUrl`, with its one-time link), where they tell us what went wrong and get the account back.
 */
export function accountDeletedEmail(r: { name: string | null; purgeAt: Date; restoreUrl: string; base: string }): MailParts {
  const subject = 'Your Shortcut account was deleted'
  const until = day(r.purgeAt)
  const body = [
    p(esc(`${hello(r.name)}`), { muted: true }),
    `<h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;color:#0a0a0a;letter-spacing:-0.02em;">Your account was deleted</h1>`,
    p(esc(`Your Shortcut account has been deleted, and you can't sign in to it now. Nothing is gone yet: your videos, clips and credits are kept until ${until}.`), { big: true }),
    p(esc(`Want it back? Restore it before ${until} and tell us in a line or two what went wrong or what we could do better. Your account comes back straight away, as it was.`)),
    p(esc(`After ${until} the account and everything in it is deleted for good.`), { muted: true }),
  ].join('')
  const text = [
    hello(r.name), '',
    'Your Shortcut account was deleted, and you can\'t sign in to it now.',
    `Nothing is gone yet: your videos, clips and credits are kept until ${until}.`, '',
    `Want it back? Restore it before ${until} and tell us what went wrong or what we could do better:`,
    r.restoreUrl, '',
    `After ${until} the account and everything in it is deleted for good.`, '',
    `Questions? Reply to this email or write to ${COMPANY.email}.`, '',
    `${COMPANY.legalName}, ${COMPANY.address.join(', ')}`,
  ].join('\n')
  return {
    subject, text,
    html: page({ base: r.base, title: subject, preheader: `Restore it before ${until}: everything is kept until then.`, badge: 'ACCOUNT', body,
      button: { href: r.restoreUrl, label: 'Restore my account' }, foot: 'You got this email because your Shortcut account was deleted.' }),
  }
}

/** To Shortcut's admins: an account was restored by its owner, with what they wrote */
export function accountRestoredAdminEmail(r: { email: string; feedback: string; deletedAt: Date | null; base: string }): MailParts {
  const subject = `Account restored: ${r.email}`
  const body = [
    `<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;font-weight:700;color:#0a0a0a;letter-spacing:-0.02em;">${esc(r.email)} restored their account</h1>`,
    p(esc(`It was deleted${r.deletedAt ? ` on ${day(r.deletedAt)}` : ''}. They're back in now. What they wrote:`), { muted: true }),
    `<div style="margin:6px 0 4px;padding:14px 16px;background:#fafafa;border:1px solid #e4e4e7;border-radius:12px;font-size:14px;line-height:1.55;color:#18181b;white-space:pre-wrap;">${esc(r.feedback)}</div>`,
  ].join('')
  const text = [`${r.email} restored their account${r.deletedAt ? ` (deleted on ${day(r.deletedAt)})` : ''}.`, '', 'What they wrote:', r.feedback].join('\n')
  return { subject, text, html: page({ base: r.base, title: subject, preheader: r.feedback.slice(0, 120), badge: 'FEEDBACK', body, foot: 'Sent to Shortcut’s admins.' }) }
}
