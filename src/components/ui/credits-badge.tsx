import type { MouseEvent } from 'react'
import type { CreditsInfo } from '@/lib/useCredits'

/** The balance in a page's header; it opens the credit history on the billing page */
export function CreditsBadge({ credits, className = 'credits-badge', onClick }: { credits: CreditsInfo | null; className?: string; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void }) {
  if (!credits) return null
  const soon = credits.nextExpiry ? `${credits.nextExpiry.amount} credits expire ${new Date(credits.nextExpiry.at).toLocaleDateString()}. ` : ''
  return (
    <a href="/billing#credits" onClick={onClick} className={`${className}${credits.balance <= 5 ? ' is-low' : ''}`} title={`${soon}See your credit history`}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9 10h4.5a1.5 1.5 0 010 3H10" /></svg>
      <span><strong>{credits.balance}</strong> credits</span>
    </a>
  )
}

/** Beside an "out of credits" message: the way to get more */
export function TopUpLink({ message }: { message: string | null | undefined }) {
  if (!message || !/Top up or upgrade/.test(message)) return null
  return <a href="/pricing#topups" className="credits-topup">Get credits</a>
}
