/** Longest an email address can be (RFC 5321) */
export const MAX_EMAIL = 254

/**
 * Something@something.something, checked for length first: on a long crafted string the pattern
 * backtracks for minutes (a 1 MB one froze the server), so it only ever sees a short one.
 */
export const looksLikeEmail = (s: string) => s.length <= MAX_EMAIL && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
