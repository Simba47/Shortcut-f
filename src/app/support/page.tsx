import type { Metadata } from 'next'
import Link from 'next/link'
import { Bug, Clapperboard, Headphones, LifeBuoy, Mail, Upload, UserCog } from 'lucide-react'
import { LegalCardPage, type LegalCard } from '@/components/legal/LegalCardPage'
import { COMPANY } from '@/lib/company'
import { EmailLink } from '@/components/ui/email-link'
import { PLANS } from '@/lib/plans'
import { ACCEPTED_VIDEO_EXTENSIONS, SARVAM_LANGUAGES } from '@/lib/shared/constants'

export const metadata: Metadata = {
  title: 'Support — Shortcut',
  description: 'Get help with Shortcut: uploads, clips, captions, your account and billing.',
}

const UPDATED = 'October 8, 2026'
const mail = <EmailLink />
const tel = COMPANY.phone.replace(/\s/g, '')
const whatsapp = <a href={`https://wa.me/${tel.replace('+', '')}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
const phone = <a href={`tel:${tel}`}>{COMPANY.phone}</a>

const formats = ACCEPTED_VIDEO_EXTENSIONS.map(e => e.slice(1).toUpperCase()).join(', ')
const languages = SARVAM_LANGUAGES.map(l => l.label).join(', ')
const maxSizes = Object.values(PLANS).map(p => `${p.maxFileSizeGb} GB on ${p.name}`).join(', ')

const CARDS: LegalCard[] = [
  {
    icon: Headphones,
    title: 'Contact Support',
    body: <>For any questions, issues, or feedback, reach us at {mail}, on {whatsapp}, or by phone at {phone}. Our team typically responds within 24–48 hours on business days (Monday to Saturday). Please include the email address you use for Shortcut and as much detail as possible about your issue so we can help you faster.</>,
  },
  {
    icon: Upload,
    title: 'Uploading Videos',
    body: <>Shortcut accepts {formats} files, up to {maxSizes}. To import from Google Drive or Dropbox, copy the link to the video file itself (not a folder) and set sharing to ‘Anyone with the link’. If an upload stops halfway, keep the app open on a steady connection and try again. If you see a message about your plan’s video limit, delete an old video or upgrade your plan. Still stuck? Email {mail} with the file name and size.</>,
  },
  {
    icon: Clapperboard,
    title: 'Clips, Captions & Editing',
    body: <>Captions are available in {languages}. If a word in the captions is wrong, open the clip in the editor and fix the text. If the AI picked the wrong moment or framing, drag the start and end of the clip on the timeline or move the crop box. Hooks, titles and hashtags are written by AI and can be wrong, so check and edit them before you post. Clips on the Free plan carry a Shortcut watermark, which paid plans remove.</>,
  },
  {
    icon: Bug,
    title: 'Report a Bug or Issue',
    body: <>If you’ve found a bug or something isn’t working as expected on the website or in the app, please email {mail} with the steps to reproduce the issue, your device and browser or app version (for example, ‘iPhone 15, iOS 26’ or ‘Chrome on Windows’), and any screenshots or screen recordings. Your reports help us improve Shortcut for everyone.</>,
  },
  {
    icon: UserCog,
    title: 'Account & Billing',
    body: <>Didn’t get your verification code? Check your spam folder and wait a minute before asking for a new one; each code expires after 10 minutes. Forgot your password? Choose ‘Forgot password’ on the sign-in page. You can change your name and password in Account settings, and compare plans on our <Link href="/pricing">Pricing</Link> page. Cancellations and refunds are explained in our <Link href="/refunds">Refund and Cancellation Policy</Link>. If you subscribed in our iOS or Android app, manage or cancel it in your App Store or Google Play subscription settings; deleting the app does not cancel it. To delete your account and all of its data, open Account settings → Delete my account, or see <Link href="/delete-account">Delete your account</Link>. For billing problems, contact {mail} with your account email and the date and amount of the payment.</>,
  },
  {
    icon: Mail,
    title: 'General Enquiries',
    body: <>For partnership opportunities, press enquiries, or general questions about Shortcut, you can reach us at {mail}. To report copyright infringement or misuse of Shortcut, email us with the subject ‘Copyright’ or ‘Abuse’. We look forward to hearing from you. You can also write to us at: {COMPANY.legalName}, {COMPANY.address.join(', ')}, India.</>,
  },
]

export default function SupportPage() {
  return <LegalCardPage badge="Help & Support" badgeIcon={LifeBuoy} title="Support" updated={UPDATED} cards={CARDS} numbered={false} />
}
