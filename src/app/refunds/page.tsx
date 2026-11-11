import type { Metadata } from 'next'
import Link from 'next/link'
import { BadgeCheck, CalendarX, Coins, CreditCard, Mail, ReceiptIndianRupee, RotateCcw, Smartphone, Zap } from 'lucide-react'
import { LegalCardPage, type LegalCard } from '@/components/legal/LegalCardPage'
import { COMPANY } from '@/lib/company'
import { EmailLink } from '@/components/ui/email-link'

export const metadata: Metadata = {
  title: 'Refund and Cancellation Policy — Shortcut',
  description: 'How to cancel a Shortcut plan, when payments are refunded, and how plans and credits are delivered.',
}

// Razorpay's website review asks for this page, open without signing in (user, 2026-11-12: a payment
// was blocked because the site was not approved). It says what the billing code does: cancelling stops
// the renewal and keeps the plan to the end of the paid month (api/billing/cancel), top-up credits last
// 12 months, a job that fails gives its credits back.
const UPDATED = 'November 12, 2026'
const mail = <EmailLink />

const CARDS: LegalCard[] = [
  {
    icon: CalendarX,
    title: 'Cancelling Your Plan',
    body: <>You can cancel a paid plan at any time from the <Link href="/pricing">Pricing</Link> page (Cancel subscription), or by emailing {mail}. Cancelling stops the next renewal: you are not charged again, and you keep your plan, its features and its credits until the end of the month you have paid for. After that your account moves to the free plan.</>,
  },
  {
    icon: CreditCard,
    title: 'Subscription Payments',
    body: <>Paid plans are billed monthly in advance, in Indian Rupees (₹), and renew automatically until you cancel. Because a plan’s credits and features are available the moment it starts, a month that has started is not refunded, in full or in part, except in the cases listed under ‘When We Refund’.</>,
  },
  {
    icon: Coins,
    title: 'Credit Top-ups',
    body: <>Top-up packs are one-time payments. Their credits are added to your account straight away and last 12 months. Top-ups are not refundable once the credits are added, except in the cases listed under ‘When We Refund’. If a job fails, the credits it used are returned to your account automatically.</>,
  },
  {
    icon: RotateCcw,
    title: 'When We Refund',
    body: <>We refund the payment in full if you were charged twice for the same plan or pack; if you were charged but your plan or credits were not added and we cannot fix it within 2 working days; or if a plan renewed after you had cancelled it. Write to us within 7 days of the payment. If money left your account for a payment that failed, it is returned automatically by Razorpay and your bank, usually within 5–7 working days, and you do not need to ask.</>,
  },
  {
    icon: ReceiptIndianRupee,
    title: 'How to Ask for a Refund',
    body: <>Email {mail} with the email address you use for Shortcut, and the date, amount and payment ID of the payment (it is on your invoice and in the receipt from Razorpay). We reply within 2 working days. An approved refund is sent to the card, UPI account or bank account you paid with and usually reaches you within 5–7 working days, depending on your bank.</>,
  },
  {
    icon: Smartphone,
    title: 'Purchases in Our Mobile Apps',
    body: <>If you subscribed in our iOS or Android app, the payment was made to Apple or Google. Cancel it in your App Store or Google Play subscription settings, and ask Apple or Google for any refund under their refund policies; we cannot refund those payments ourselves.</>,
  },
  {
    icon: Zap,
    title: 'Delivery of Service',
    body: <>Shortcut is an online service: nothing is shipped. Your plan or credits are added to your account as soon as the payment is confirmed, usually within a minute, and you can use them straight away on the website and in the apps. If they have not appeared within 30 minutes, email {mail}.</>,
  },
  {
    icon: BadgeCheck,
    title: 'Invoices',
    body: <>An invoice is made for every payment. You can see and download your payments and invoices on the <Link href="/billing">Payments &amp; invoices</Link> page after signing in.</>,
  },
  {
    icon: Mail,
    title: 'Contact Us',
    body: <>For any question about a payment, cancellation or refund, contact us at {mail} or <a href={`tel:${COMPANY.phone.replace(/\s/g, '')}`}>{COMPANY.phone}</a>, or write to us at: {COMPANY.legalName}, {COMPANY.address.join(', ')}, India.</>,
  },
]

export default function RefundsPage() {
  return <LegalCardPage badge="Legal Documentation" badgeIcon={ReceiptIndianRupee} title="Refund and Cancellation Policy" updated={UPDATED} cards={CARDS} />
}
