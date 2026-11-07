import type { Metadata } from 'next'
import { LegalCardPage } from '@/components/legal/LegalCardPage'
import { privacyCards, PRIVACY_DOC } from '@/components/legal/privacyDoc'

export const metadata: Metadata = {
  title: 'Privacy Policy — Shortcut',
  description: 'How Shortcut collects, uses, shares and protects your information.',
}

export default function PrivacyPage() {
  return <LegalCardPage badge={PRIVACY_DOC.badge} badgeIcon={PRIVACY_DOC.badgeIcon} title={PRIVACY_DOC.title} updated={PRIVACY_DOC.updated} cards={privacyCards} />
}
