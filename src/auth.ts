import NextAuth, { CredentialsSignin } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import PostgresAdapter from '@auth/pg-adapter'
import { Pool } from 'pg'
import { authConfig } from './auth.config'
import { verifyPassword } from './modules/auth/password'
import { startSession, isCurrentSession, endSession } from './modules/auth/devices'
import sql from './lib/db'
import { accountLock } from './server/services/accountDeletion'
import { clientIp, loginSucceeded, startLoginAttempt } from './modules/auth/limits'
import { queueServerEvent } from './server/analytics'

const g = global as typeof globalThis & { _pgPool?: Pool }
if (!g._pgPool) {
  // Same reason as lib/db.ts: idle connections are closed before Railway's proxy drops them.
  // DB_SSL=off as in lib/db.ts (Railway's private network, where a pooler sits, has no SSL)
  g._pgPool = new Pool({
    connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL === 'off' ? false : { rejectUnauthorized: false }, max: 3,
    idleTimeoutMillis: 20_000, keepAlive: true, connectionTimeoutMillis: 15_000,
  })
}
const pool = g._pgPool

/** "Continue with Google" is on when its keys are set (AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET: Google Cloud's OAuth client) */
export const googleOn = () => !!process.env.AUTH_GOOGLE_ID && !!process.env.AUTH_GOOGLE_SECRET

/** A password tried on an account that signs in with Google only (no password yet): the form says so */
class GoogleOnly extends CredentialsSignin { code = 'google_only' }
/** Too many wrong passwords lately (modules/auth/limits.ts): the form says to wait */
class TooManyTries extends CredentialsSignin { code = 'too_many' }
/** Deleted or blocked by Shortcut's admin (server/services/accountDeletion.ts): no sign-in; the form says why */
class AccountDeleted extends CredentialsSignin { code = 'deleted' }
class AccountBlocked extends CredentialsSignin { code = 'blocked' }

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter: PostgresAdapter(pool),
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 365 },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, request) {
        const email = (credentials?.email as string | undefined)?.toLowerCase().trim()
        const password = credentials?.password as string | undefined
        if (!email || !password) return null
        // (counted as a wrong try until the password checks out: modules/auth/limits.ts)
        let attempt: string
        try { attempt = await startLoginAttempt(email, clientIp(request?.headers)) }
        catch (e) { if ((e as { code?: string }).code === 'too_many') throw new TooManyTries(); throw e }

        const [user] = await sql`
          SELECT id, email, name, image, password_hash, "emailVerified"
          FROM users WHERE email = ${email}
        `
        if (!user) return null
        if (!user.password_hash) {
          if (user.emailVerified) throw new GoogleOnly()
          return null
        }
        if (!user.emailVerified) return null

        const ok = await verifyPassword(password, user.password_hash as string)
        if (!ok) return null
        await loginSucceeded(email, attempt)
        const lock = await accountLock({ id: user.id as string })
        if (lock.state === 'deleted') throw new AccountDeleted()
        if (lock.state === 'blocked') throw new AccountBlocked()

        // (image: the profile photo's address — the same one photoUrl makes in server/services/account.ts)
        const photo = user.image as string | null
        return {
          id: user.id as string, email: user.email as string, name: (user.name as string | null) ?? null,
          image: photo?.startsWith('avatars/') ? `/api/account/photo?v=${photo.split('/').pop()!.slice(0, 8)}` : null,
        }
      },
    }),
    // "Continue with Google" (user, 2026-10-30). The same email is the same account: someone who signed
    // up with a password lands in it with Google too (Google has confirmed the email — signIn below
    // takes only confirmed ones). The profile photo isn't taken: the site's photo is its own (Settings).
    ...(googleOn() ? [Google({
      allowDangerousEmailAccountLinking: true,
      profile: p => ({ id: p.sub, name: p.name ?? null, email: p.email?.toLowerCase().trim(), image: null }),
    })] : []),
  ],
  events: {
    // Signed out here: this device's place is free for another (modules/auth/devices.ts)
    async signOut(message) {
      if ('token' in message && message.token) await endSession(message.token.sid as string | undefined)
    },
  },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== 'google') return true
      const email = profile?.email?.toLowerCase().trim()
      if (!email || profile?.email_verified !== true) return false
      // Deleted or blocked by Shortcut's admin: back to the sign-in form, which says why (and, deleted, offers the restore link)
      const lock = await accountLock({ email })
      if (lock.state !== 'ok') return `/login?error=${lock.state}&email=${encodeURIComponent(email)}`
      // An account started with this email but never confirmed (a password chosen, its code never
      // entered): that password may not be this person's, so it goes — the account is theirs now
      await sql`UPDATE users SET password_hash = NULL, "emailVerified" = now() WHERE email = ${email} AND "emailVerified" IS NULL`
      await sql`DELETE FROM verification_otps WHERE email = ${email} AND purpose = 'signup'`
      return true
    },
    async jwt({ token, user, account, trigger, session }) {
      if (user) {
        token.id = user.id
        // A new account made by Google: its email is confirmed (Google confirmed it)
        if (account?.provider === 'google') await sql`UPDATE users SET "emailVerified" = COALESCE("emailVerified", now()) WHERE id = ${user.id as string}`
        // Devices at once (plans v2, 2026-11-21: Trial 1, Starter 2, Pro 3): past the plan's number, the device
        // used least recently is signed out (modules/auth/devices.ts). Its browser, to tell devices apart.
        let agent: string | null = null
        try { agent = (await (await import('next/headers')).headers()).get('user-agent') } catch { /* not in a request */ }
        token.sid = await startSession(user.id as string, agent)
        delete token.replaced
        // Google Analytics (server/analytics.ts): a Google sign-in that made the account is a sign_up
        // (an email sign-up's is sent when its code is confirmed), any other a login. By id only.
        const method = account?.provider === 'google' ? 'google' : 'email'
        queueServerEvent(trigger === 'signUp' && method === 'google' ? 'sign_up' : 'login', { method }, user.id as string)
      } else if (token.id && !token.replaced && !(await isCurrentSession(token.id as string, token.sid as string | undefined))) {
        token.replaced = true
      }
      // Account settings changed the name: the page calls update({ name }) so the session shows it
      if (trigger === 'update' && session && typeof session === 'object' && 'name' in session) {
        token.name = (session as { name?: string | null }).name ?? null
      }
      // …or the profile photo: update({ image }). Only our own photo address (or none) is taken.
      if (trigger === 'update' && session && typeof session === 'object' && 'image' in session) {
        const image = (session as { image?: unknown }).image
        token.picture = typeof image === 'string' && image.startsWith('/api/account/photo?v=') ? image : null
      }
      return token
    },
    session({ session, token }) {
      // A replaced sign-in gets no user id: nothing treats it as signed in (server/auth.ts, providers.tsx)
      if (token.replaced) { session.replaced = true; return session }
      if (session.user && token.id) session.user.id = token.id as string
      return session
    },
  },
})
