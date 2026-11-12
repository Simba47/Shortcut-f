import Link from 'next/link'
import { Ban, Clapperboard, Copyright, CreditCard, FileCheck, FileText, Landmark, Mail, ShieldAlert, UserCog, UserX } from 'lucide-react'
import { type LegalCard } from '@/components/legal/LegalCardPage'
import { COMPANY } from '@/lib/company'
import { EmailLink } from '@/components/ui/email-link'

// Terms and Conditions: its words, shared by its page (app/terms) and the popup in the profile menu
// (components/ui/account-menu.tsx) — one place to change them.
const UPDATED = 'October 8, 2026'
const mail = <EmailLink />

/** `privacy`: the link to the Privacy Policy (a page link, or in the popup a switch to it) */
export const termsCards = (privacy: React.ReactNode): LegalCard[] => [
  {
    icon: FileCheck,
    title: 'Acceptance of Terms',
    body: <>By accessing and using Shortcut on our website or in our mobile apps for Android and iOS, you agree to be bound by these Terms and Conditions and our {privacy}. If you do not agree with any part of these terms, you may not use our services. You must be at least 18 years old to use Shortcut. These terms establish a legally binding agreement between you and {COMPANY.legalName}. We may update these terms from time to time; we will change the ‘Last updated’ date above and tell you by email or in the app before significant changes take effect.</>,
  },
  {
    icon: Clapperboard,
    title: 'Description of Service',
    body: <>Shortcut is a video editing service that turns your long videos into short vertical clips for platforms such as YouTube Shorts and Instagram Reels. It uses artificial intelligence to transcribe your videos, find the best moments, and write hooks, titles, captions and hashtags. AI can make mistakes, so always review your clips and text before you post them; we do not promise any number of views, followers or earnings. Each plan keeps your videos and clips for the history period shown on our pricing page, so please download any clips you want to keep. Features may change, be added or be removed over time.</>,
  },
  {
    icon: UserCog,
    title: 'User Accounts',
    body: <>You must sign up with a real email address that you can access, and you are responsible for safeguarding your password and for all activity in your account. You must notify us immediately at {mail} of any unauthorized use of your account. An account is for one person only; you may not share it or create extra accounts to get around plan limits.</>,
  },
  {
    icon: CreditCard,
    title: 'Plans and Payments',
    body: <>Shortcut offers a free plan and paid plans. The price, limits and features of each plan are shown before you buy, and prices are in Indian Rupees (₹). Paid plans are subscriptions that renew automatically each month or year until you cancel, and you will be charged at the start of each new billing period. If you subscribe in our iOS or Android app, payment is charged to your Apple or Google account, and billing, renewals and refunds follow the App Store or Google Play terms; you can manage or cancel your subscription in your App Store or Google Play account settings at least 24 hours before it renews, and deleting the app does not cancel it. When you cancel, you keep paid features until the end of the period you have paid for. Refunds for payments made on our website follow our <Link href="/refunds">Refund and Cancellation Policy</Link>; apart from those and refunds required by law or by the store’s refund policy, payments are non-refundable. Clips made on the free plan carry a Shortcut watermark, which you must not remove. These terms are between you and us, not Apple or Google, who are not responsible for the service.</>,
  },
  {
    icon: Copyright,
    title: 'Intellectual Property',
    body: <>You own the videos you upload and the clips you make with Shortcut, and you must only upload videos you own or have permission to use and edit. You allow us to store, process and change your content only as needed to provide the service, including sending it to the service providers listed in our {privacy}; this permission ends when you delete the content or your account. {COMPANY.legalName} retains all rights to Shortcut’s software, design, name and logo. Stock videos added from Pexels or Pixabay are covered by their own licences.</>,
  },
  {
    icon: Ban,
    title: 'Prohibited Activities',
    body: <>You may not use Shortcut to upload or create content you do not have the rights to, content that is illegal, sexually explicit, hateful, harassing or harmful to children, or deepfakes and misleading edits that make a real person appear to say or do something they did not. You may not hack, overload or reverse-engineer the service, use bots to access it, remove watermarks, get around plan limits, or violate any applicable Indian laws. Any such violation may result in removal of the content, suspension of your account, and reporting to the relevant authorities. To report content that infringes your copyright, email {mail}.</>,
  },
  {
    icon: ShieldAlert,
    title: 'Limitation of Liability',
    body: <>Shortcut is provided “as is” and “as available”, and we do not promise that it will always be available or free of errors. To the extent allowed by law, {COMPANY.legalName} shall not be liable for any indirect, incidental, special or consequential damages arising from your use of the service, such as lost data, views or earnings. Our total liability to you for any claims arising under these terms shall not exceed the amount you paid to us in the three months preceding the claim.</>,
  },
  {
    icon: UserX,
    title: 'Termination',
    body: <>You can stop using Shortcut and delete your account at any time from Account settings → Delete my account (see <Link href="/delete-account">Delete your account</Link>), which permanently deletes your account and content. We may suspend or terminate your account if you breach these terms or engage in conduct that is harmful to the service or its users. Upon termination, your right to use Shortcut ceases immediately.</>,
  },
  {
    icon: Landmark,
    title: 'Governing Law',
    body: <>These Terms and Conditions are governed by and construed in accordance with the laws of India. Any disputes arising under these terms shall be subject to the exclusive jurisdiction of the courts in {COMPANY.address.join(', ')}, India.</>,
  },
  {
    icon: Mail,
    title: 'Contact Us',
    body: <>If you have any questions about these Terms and Conditions, please contact us at {mail} or <a href={`tel:${COMPANY.phone.replace(/\s/g, '')}`}>{COMPANY.phone}</a>, or write to us at: {COMPANY.legalName}, {COMPANY.address.join(', ')}, India.</>,
  },
]

export const TERMS_DOC = { badge: 'Legal Documentation', badgeIcon: FileText, title: 'Terms and Conditions', updated: UPDATED }
