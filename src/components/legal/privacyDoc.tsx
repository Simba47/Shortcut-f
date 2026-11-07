import Link from 'next/link'
import { Clock, Cookie, Database, Lock, Mail, RefreshCw, Share2, ShieldCheck, Sparkles, UserCheck } from 'lucide-react'
import { type LegalCard } from '@/components/legal/LegalCardPage'
import { COMPANY } from '@/lib/company'
import { EmailLink } from '@/components/ui/email-link'

// Privacy Policy: its words, shared by its page (app/privacy) and the popup in the profile menu
// (components/ui/account-menu.tsx) — one place to change them.
const UPDATED = 'October 8, 2026'
const mail = <EmailLink />

// The services named in "Sharing of Information" must stay in step with the code (src/lib, src/server/services).
export const privacyCards: LegalCard[] = [
  {
    icon: Database,
    title: 'Information We Collect',
    body: <>We collect information you provide directly to us when you create an account, upload or import videos, edit clips, choose a plan, or request support. This includes your name, email address, password (stored only in hashed form), the videos and audio you upload, any images or logos you add, your edits, and your plan and usage details. When we process your videos we also create transcripts and AI results such as clip moments, hooks, titles, captions and hashtags, and our servers receive basic technical data such as your IP address and device and browser type. In our mobile apps, we ask for access to your photos, videos and files only so you can pick a video to upload and save finished clips. We do not collect your contacts, precise location, or social media account data. Shortcut is meant for people aged 18 and over, and we do not knowingly collect data from children.</>,
  },
  {
    icon: Sparkles,
    title: 'How We Use Your Information',
    body: <>We use the information we collect to create and secure your account, verify your email with a one-time code, store and transcribe your videos, find the best moments, write captions and text, render your clips, manage your plan and usage limits, provide support, prevent misuse, and communicate with you about your account and important changes to the service. We do not use your videos for advertising, and we do not use them to train our own AI models.</>,
  },
  {
    icon: Share2,
    title: 'Sharing of Information',
    body: <>Your videos and clips are private to your account and are only published if you download and post them yourself. We never sell your personal data to third parties. Information is only shared with trusted service providers who process it on our behalf to run Shortcut: Cloudflare (storing your videos and clips), our database host (account and project data), Sarvam AI (turning the speech in your videos into text), Google Gemini and Anthropic Claude (AI that reads your transcripts to pick moments and write captions), Resend (sending email codes), and Pexels and Pixabay (the stock video search words you type). We may also share information when the law requires it or to protect the rights and safety of our users.</>,
  },
  {
    icon: Lock,
    title: 'Data Security',
    body: <>We implement commercially reasonable technical and organisational security measures designed to protect your information from loss, theft, misuse, and unauthorised access, including encrypted connections (HTTPS), hashed passwords, private storage for your videos with time-limited access links, and limited staff access. Payments for paid plans are processed by our payment partner, and we never store your full card details.</>,
  },
  {
    icon: Cookie,
    title: 'Cookies & Tracking',
    body: <>We use only the cookies and similar on-device storage needed for Shortcut to work, such as keeping you signed in and remembering your settings. We do not use advertising cookies, and we do not track you across other apps or websites. You may control cookie settings through your browser, but disabling cookies will sign you out and may limit certain features.</>,
  },
  {
    icon: UserCheck,
    title: 'Your Rights',
    body: <>You have the right to access, correct, or delete your personal data at any time, and to withdraw your consent, as provided under India’s Digital Personal Data Protection Act, 2023. You can update your name and password in Account settings, and delete your account and all of its data from Account settings → Delete my account (see <Link href="/delete-account">Delete your account</Link>). To request a copy of your data or exercise any other right, please contact us at {mail}. We will respond within 30 days.</>,
  },
  {
    icon: Clock,
    title: 'Data Retention',
    body: <>We retain your account data for as long as your account is active. Your videos, clips and transcripts are kept for the history period of your plan, and you can delete them at any time. When you delete your account, we delete your account details, videos, audio, clips, transcripts and project data, and backup copies are removed within 30 days. We keep limited records, such as payment and tax records, only as long as the law requires.</>,
  },
  {
    icon: RefreshCw,
    title: 'Changes to This Policy',
    body: <>We may update this Privacy Policy from time to time. We will notify you of any significant changes by posting the new policy on this page and updating the ‘Last updated’ date. We encourage you to review this policy periodically to stay informed about how we protect your information.</>,
  },
  {
    icon: Mail,
    title: 'Contact Us',
    body: <>If you have any questions about this Privacy Policy or our data practices, please contact our Grievance Officer at {mail} or <a href={`tel:${COMPANY.phone.replace(/\s/g, '')}`}>{COMPANY.phone}</a>, or write to us at: {COMPANY.legalName}, {COMPANY.address.join(', ')}, India.</>,
  },
]

export const PRIVACY_DOC = { badge: 'Data Protection', badgeIcon: ShieldCheck, title: 'Privacy Policy', updated: UPDATED }
