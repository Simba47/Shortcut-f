import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalCardPage } from '@/components/legal/LegalCardPage'
import { termsCards, TERMS_DOC } from '@/components/legal/termsDoc'

export const metadata: Metadata = {
  title: 'Terms and Conditions — Shortcut',
  description: 'The rules for using Shortcut, our video clipping service.',
}

export default function TermsPage() {
  return <LegalCardPage badge={TERMS_DOC.badge} badgeIcon={TERMS_DOC.badgeIcon} title={TERMS_DOC.title} updated={TERMS_DOC.updated} cards={termsCards(<Link href="/privacy">Privacy Policy</Link>)} />
}
