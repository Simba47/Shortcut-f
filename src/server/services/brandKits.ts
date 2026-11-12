import { PutObjectCommand, GetObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2, R2_BUCKET } from '@/lib/r2'
import sql from '@/lib/db'
import { getUserPlan } from './quota'
import { brandKitLimit, cleanBrandKitData, DEFAULT_BRAND_KIT, isBrandFont, brandFontKey, type BrandKit, type BrandKitData } from '@/lib/shared/brandKit'
import { cleanRole, INVITE_DAYS, TEAM_PLANS, teamSeats, type KitInviteIn, type KitInviteOut, type KitMember, type KitRole, type KitTeam } from '@/lib/shared/brandTeam'
import { hasColumn } from './clips'
import { pictureColours } from './brandStyle'
import { BRAND_WORDS_ON, cleanBrandWords, type BrandWords } from '@/lib/brandWords'
import { looksLikeEmail } from '@/lib/shared/email'

/**
 * Brand kits (lib/shared/brandKit.ts): a user's saved looks, kept in brand_kits (the backend creates
 * the table when it starts). How many a user can have depends on their plan.
 */

// (written for the user: shown as it is, a 503 too — lib/api-error.ts)
const err = (message: string, status: number) => Object.assign(new Error(message), { status, expose: true })
const MAX_NAME = 40
const cleanName = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, MAX_NAME) : '')

/** Before the backend has made the table: a clear answer instead of a database error */
async function tableReady() {
  const [row] = await sql<{ ok: boolean }[]>`SELECT to_regclass('public.brand_kits') IS NOT NULL AS ok`
  if (!row?.ok) throw err('Brand kits are being set up — try again in a few minutes.', 503)
}

/**
 * How long a logo's link works: as long as a signed link can (7 days). The editor puts it on the logo
 * it adds to a clip, so a short one (it was 6 hours) left a broken logo in an editor kept open longer.
 */
export const LOGO_LINK_SECONDS = 7 * 24 * 60 * 60

async function signLogo(path: string | null): Promise<string | null> {
  if (!path) return null
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: path }), { expiresIn: LOGO_LINK_SECONDS }).catch(() => null)
}

type Row = { id: string; name: string; data: unknown }
/**
 * A kit as the editor gets it. `ownerId`: whose kit it is (its files are theirs); `sharedBy`: shared with
 * this user by them, as `role` (Phase 6: "Can use" or "Can edit")
 */
async function toKit(row: Row, ownerId: string, sharedBy: string | null = null, role: KitRole = 'use'): Promise<BrandKit> {
  const data = await usableEnds(cleanBrandKitData(row.data, ownerId), ownerId, sharedBy !== null)
  // (someone else's default is not this user's)
  if (sharedBy !== null) data.is_default = false
  return { id: row.id, name: row.name, data, logo_url: await signLogo(data.logo.path), ...(sharedBy !== null ? { shared_by: sharedBy, role } : {}) }
}

/**
 * A kit's intro and outro as the user can have them on their clips (brand kit Phase 4): their own
 * videos still in their library. A shared kit's are its owner's videos — a clip can't show another
 * user's video (saveClip refuses it) — so the people it's shared with get none.
 */
export async function usableEnds(data: BrandKitData, ownerId: string, shared: boolean): Promise<BrandKitData> {
  const { intro, outro } = data.ends
  if (!intro && !outro) return data
  const ids = shared ? [] : [intro?.id, outro?.id].filter((x): x is string => !!x)
  const have = new Set(ids.length
    ? (await sql<{ id: string }[]>`SELECT id FROM videos WHERE id = ANY(${ids}) AND user_id = ${ownerId}`.catch(() => [])).map(r => r.id)
    : [])
  const keep = (v: typeof intro) => (v && have.has(v.id) ? v : null)
  return { ...data, ends: { ...data.ends, intro: keep(intro), outro: keep(outro) } }
}

/** Is the sharing table there yet (the backend makes it when it starts)? */
async function sharesReady(): Promise<boolean> {
  const [row] = await sql<{ ok: boolean }[]>`SELECT to_regclass('public.brand_kit_shares') IS NOT NULL AS ok`.catch(() => [])
  return !!row?.ok
}

/** Is the invites table there yet (Phase 6: the backend makes it when it starts)? */
async function invitesReady(): Promise<boolean> {
  const [row] = await sql<{ ok: boolean }[]>`SELECT to_regclass('public.brand_kit_invites') IS NOT NULL AS ok`.catch(() => [])
  return !!row?.ok
}

/**
 * What the user can do with a kit (Phase 6): 'owner' — it's theirs; 'edit' or 'use' — it's shared with
 * them, as the owner said; null — nothing (not theirs, not shared with them, or its owner's plan no
 * longer shares kits: their team's access waits until it does again). `data`: the kit's settings.
 */
export async function kitAccess(userId: string, kitId: string): Promise<{ role: 'owner' | KitRole; ownerId: string; data: BrandKitData } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(kitId)) return null
  const shares = await sharesReady()
  const [row] = await (shares
    ? sql<{ owner: string; data: unknown; member: boolean; role: string | null; plan: string | null }[]>`
        SELECT bk.user_id AS owner, bk.data, s.user_id IS NOT NULL AS member, to_jsonb(s)->>'role' AS role, o.plan
        FROM brand_kits bk LEFT JOIN users o ON o.id = bk.user_id
        LEFT JOIN brand_kit_shares s ON s.kit_id = bk.id AND s.user_id = ${userId}
        WHERE bk.id = ${kitId}`
    : sql<{ owner: string; data: unknown; member: boolean; role: string | null; plan: string | null }[]>`
        SELECT user_id AS owner, data, false AS member, null AS role, null AS plan FROM brand_kits WHERE id = ${kitId}`
  ).catch(() => [])
  if (!row) return null
  const data = cleanBrandKitData(row.data, row.owner)
  if (row.owner === userId) return { role: 'owner', ownerId: row.owner, data }
  if (!row.member || !teamSeats(row.plan)) return null
  return { role: cleanRole(row.role), ownerId: row.owner, data }
}

/**
 * Whether the user can put this kit on their clips: their own, or one shared with them (its owner's plan
 * still sharing). The one check every place that takes a kit's id uses (Make my clips, saving a clip with
 * its brand switch on).
 */
export async function canUseKit(userId: string, kitId: string): Promise<boolean> {
  return !!(await kitAccess(userId, kitId))
}

/**
 * The kit taken off clips that still have it switched on (`ownerId`: only that person's clips; else
 * everyone's): they keep their look — the logo and styles stay as they are — but no longer point at a
 * kit they can't use (the kit deleted, or no longer shared with them), which left the editor's switch
 * stuck on a kit it couldn't find
 */
async function releaseClips(kitId: string, ownerId?: string): Promise<void> {
  if (!(await hasColumn('clips', 'brand'))) return
  await (ownerId
    ? sql`UPDATE clips c SET brand = NULL FROM videos v WHERE v.id = c.video_id AND v.user_id = ${ownerId} AND c.brand->>'kit_id' = ${kitId}`
    : sql`UPDATE clips SET brand = NULL WHERE brand->>'kit_id' = ${kitId}`)
}


/** The user's email (lower case), for the invites sent to it */
async function emailOf(userId: string): Promise<string | null> {
  const [row] = await sql<{ email: string | null }[]>`SELECT email FROM users WHERE id = ${userId}`
  return row?.email ? row.email.trim().toLowerCase() : null
}

/** Invites waiting for the user (to their email; not expired; the inviter's plan still sharing) */
async function invitesFor(userId: string): Promise<KitInviteIn[]> {
  if (!(await invitesReady())) return []
  const email = await emailOf(userId)
  if (!email) return []
  const rows = await sql<{ id: string; kit_name: string; by: string | null; role: string; plan: string | null }[]>`
    SELECT i.id, bk.name AS kit_name, COALESCE(NULLIF(o.name, ''), o.email) AS by, i.role, o.plan
    FROM brand_kit_invites i JOIN brand_kits bk ON bk.id = i.kit_id JOIN users o ON o.id = bk.user_id
    WHERE i.email = ${email} AND bk.user_id <> ${userId} AND i.created_at > now() - make_interval(days => ${INVITE_DAYS})
    ORDER BY i.created_at`
  return rows.filter(r => teamSeats(r.plan) > 0).map(r => ({ id: r.id, kit_name: r.kit_name, by: r.by ?? 'A teammate', role: cleanRole(r.role) }))
}

/**
 * The user's kits, oldest first, then the kits shared with them (their owner's plan still sharing), how
 * many of their own their plan allows, and the invites waiting for them
 */
export async function listBrandKits(userId: string): Promise<{ kits: BrandKit[]; limit: number; plan: string; invites: KitInviteIn[] }> {
  await tableReady()
  const [rows, plan, shared, invites] = await Promise.all([
    sql<Row[]>`SELECT id, name, data FROM brand_kits WHERE user_id = ${userId} ORDER BY created_at, id`,
    getUserPlan(userId),
    (async (): Promise<Array<Row & { owner: string; by: string | null; role: string | null }>> => (!(await sharesReady()) ? [] : sql<(Row & { owner: string; by: string | null; role: string | null })[]>`
      SELECT bk.id, bk.name, bk.data, bk.user_id AS owner, COALESCE(NULLIF(u.name, ''), u.email) AS by, to_jsonb(s)->>'role' AS role
      FROM brand_kit_shares s JOIN brand_kits bk ON bk.id = s.kit_id JOIN users u ON u.id = bk.user_id
      WHERE s.user_id = ${userId} AND u.plan = ANY(${TEAM_PLANS}) ORDER BY s.created_at, bk.id`))(),
    invitesFor(userId).catch(() => []),
  ])
  const kits = await Promise.all([...rows.map(r => toKit(r, userId)), ...shared.map(r => toKit(r, r.owner, r.by ?? 'a teammate', cleanRole(r.role)))])
  return { kits, limit: brandKitLimit(plan), plan, invites }
}

// ── Teams (Phase 6) ────────────────────────────────────────────────────────────
// The owner invites people by email — an account or not yet — as "Can use" (put it on their clips) or
// "Can edit" (change it too). They accept or decline in the app (Brand kits page); no email is sent —
// it costs nothing — the owner can copy a link to the invite and send it however they like. How many
// people a kit can have depends on the owner's plan (brandTeam.ts TEAM_SEATS); while their plan doesn't
// share, their team's access waits (kitAccess). With the kit's brand lock on, people who can only use
// it keep to its colours and fonts on clips it's on (clips.ts saveClip; the editor shows the same).

type KitShare = KitMember

async function ownKit(userId: string, kitId: string) {
  await tableReady()
  const [kit] = await sql<{ id: string }[]>`SELECT id FROM brand_kits WHERE id = ${kitId} AND user_id = ${userId}`
  if (!kit) throw err('Brand kit not found', 404)
}

/** The owner's kit's team: who it's shared with and as what, the invites out, and how many people the plan allows */
export async function listKitShares(userId: string, kitId: string): Promise<KitTeam> {
  await ownKit(userId, kitId)
  const seats = teamSeats(await getUserPlan(userId))
  if (!(await sharesReady())) return { people: [], invites: [], can_share: false, seats }
  const [people, invites] = await Promise.all([
    sql<(Omit<KitShare, 'role'> & { role: string | null })[]>`
      SELECT u.id AS user_id, u.name, u.email, to_jsonb(s)->>'role' AS role FROM brand_kit_shares s JOIN users u ON u.id = s.user_id
      WHERE s.kit_id = ${kitId} ORDER BY s.created_at`,
    (async () => (!(await invitesReady()) ? [] : sql<{ id: string; email: string; role: string; expired: boolean }[]>`
      SELECT id, email, role, created_at <= now() - make_interval(days => ${INVITE_DAYS}) AS expired
      FROM brand_kit_invites WHERE kit_id = ${kitId} ORDER BY created_at`))(),
  ])
  return {
    people: people.map(p => ({ ...p, role: cleanRole(p.role) })),
    invites: invites.map(i => ({ id: i.id, email: i.email, role: cleanRole(i.role), expired: i.expired })),
    can_share: seats > 0, seats,
  }
}

/** Places taken on the kit's team: its people and the invites still open */
async function seatsTaken(kitId: string): Promise<number> {
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM brand_kit_shares WHERE kit_id = ${kitId}`
  if (!(await invitesReady())) return n
  const [{ m }] = await sql<{ m: number }[]>`
    SELECT count(*)::int AS m FROM brand_kit_invites WHERE kit_id = ${kitId} AND created_at > now() - make_interval(days => ${INVITE_DAYS})`
  return n + m
}

/**
 * The owner invites the person with this email to their kit, as `role`. Someone already on its team just
 * gets the new role; an invite sent before is sent again (a new link's time, the new role).
 */
export async function inviteToKit(userId: string, kitId: string, email: unknown, role: unknown): Promise<{ person?: KitShare; invite?: KitInviteOut }> {
  await ownKit(userId, kitId)
  const seats = teamSeats(await getUserPlan(userId))
  if (!seats) throw err('Sharing brand kits with your team is on the Agency plan.', 403)
  if (!(await sharesReady()) || !(await invitesReady())) throw err('Teams are being set up — try again in a few minutes.', 503)
  const mail = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (mail.length > 200 || !looksLikeEmail(mail)) throw err('Type their email address', 400)
  if (mail === (await emailOf(userId))) throw err('That’s you — the kit is already yours.', 400)
  const r = cleanRole(role)
  const [member] = await sql<Omit<KitShare, 'role'>[]>`
    SELECT u.id AS user_id, u.name, u.email FROM brand_kit_shares s JOIN users u ON u.id = s.user_id
    WHERE s.kit_id = ${kitId} AND lower(u.email) = ${mail}`
  if (member) {
    await sql`UPDATE brand_kit_shares SET role = ${r} WHERE kit_id = ${kitId} AND user_id = ${member.user_id}`
    return { person: { ...member, role: r } }
  }
  const [open] = await sql<{ id: string }[]>`SELECT id FROM brand_kit_invites WHERE kit_id = ${kitId} AND email = ${mail}`
  if (!open && await seatsTaken(kitId) >= seats) throw err(`A kit can be shared with up to ${seats} people on your plan.`, 403)
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO brand_kit_invites (kit_id, email, role, invited_by) VALUES (${kitId}, ${mail}, ${r}, ${userId})
    ON CONFLICT (kit_id, email) DO UPDATE SET role = EXCLUDED.role, created_at = now()
    RETURNING id`
  return { invite: { id: row.id, email: mail, role: r, expired: false } }
}

/** The owner takes back an invite */
export async function cancelInvite(userId: string, kitId: string, inviteId: string): Promise<void> {
  await ownKit(userId, kitId)
  if (!(await invitesReady())) return
  await sql`DELETE FROM brand_kit_invites WHERE id = ${inviteId} AND kit_id = ${kitId}`
}

/** The owner changes what someone on the kit's team can do */
export async function setMemberRole(userId: string, kitId: string, memberId: string, role: unknown): Promise<KitRole> {
  await ownKit(userId, kitId)
  const r = cleanRole(role)
  const rows = await sql`UPDATE brand_kit_shares SET role = ${r} WHERE kit_id = ${kitId} AND user_id = ${memberId} RETURNING user_id`
  if (!rows.length) throw err('They’re not on this kit’s team', 404)
  return r
}

/**
 * The person invited accepts (they join the kit's team, as the invite says) or declines (the invite
 * goes). Only an invite to their own email, not expired, from someone whose plan still shares kits.
 */
export async function answerInvite(userId: string, inviteId: string, accept: boolean): Promise<BrandKit | null> {
  await tableReady()
  if (!(await invitesReady())) throw err('Invite not found', 404)
  const email = await emailOf(userId)
  const [inv] = await sql<{ id: string; kit_id: string; role: string; owner: string; plan: string | null; expired: boolean }[]>`
    SELECT i.id, i.kit_id, i.role, bk.user_id AS owner, o.plan, i.created_at <= now() - make_interval(days => ${INVITE_DAYS}) AS expired
    FROM brand_kit_invites i JOIN brand_kits bk ON bk.id = i.kit_id JOIN users o ON o.id = bk.user_id
    WHERE i.id = ${inviteId} AND i.email = ${email ?? ''}`
  if (!inv) throw err('This invite isn’t for this account — sign in with the email it was sent to.', 404)
  if (!accept) { await sql`DELETE FROM brand_kit_invites WHERE id = ${inv.id}`; return null }
  if (inv.expired) throw err('This invite has expired — ask for a new one.', 410)
  const seats = teamSeats(inv.plan)
  if (!seats) throw err('This team’s plan doesn’t share brand kits right now.', 403)
  if (inv.owner === userId) { await sql`DELETE FROM brand_kit_invites WHERE id = ${inv.id}`; throw err('That’s your own kit.', 400) }
  await sql.begin(async tx => {
    const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM brand_kit_shares WHERE kit_id = ${inv.kit_id} AND user_id <> ${userId}`
    if (n >= seats) throw err('This kit’s team is full — ask its owner to make room.', 403)
    await tx`INSERT INTO brand_kit_shares (kit_id, user_id, role) VALUES (${inv.kit_id}, ${userId}, ${cleanRole(inv.role)})
      ON CONFLICT (kit_id, user_id) DO UPDATE SET role = EXCLUDED.role`
    await tx`DELETE FROM brand_kit_invites WHERE id = ${inv.id}`
  })
  const [row] = await sql<(Row & { by: string | null })[]>`
    SELECT bk.id, bk.name, bk.data, COALESCE(NULLIF(u.name, ''), u.email) AS by FROM brand_kits bk JOIN users u ON u.id = bk.user_id WHERE bk.id = ${inv.kit_id}`
  return row ? toKit(row, inv.owner, row.by ?? 'a teammate', cleanRole(inv.role)) : null
}

/** Stops sharing: the owner takes someone off, or someone leaves a kit shared with them */
export async function unshareKit(userId: string, kitId: string, memberId: string): Promise<void> {
  await tableReady()
  if (!(await sharesReady())) return
  const [kit] = await sql<{ user_id: string }[]>`SELECT user_id FROM brand_kits WHERE id = ${kitId}`
  if (!kit || (kit.user_id !== userId && memberId !== userId)) throw err('Brand kit not found', 404)
  await sql`DELETE FROM brand_kit_shares WHERE kit_id = ${kitId} AND user_id = ${memberId}`
  // (their clips with it on keep their look, the kit's switch off)
  await releaseClips(kitId, memberId).catch(e => console.error('[brand] clips not released from a kit no longer shared:', e))
}

/** A new kit (default settings, or `data`), within the plan's count */
export async function createBrandKit(userId: string, body: { name?: unknown; data?: unknown }): Promise<BrandKit> {
  await tableReady()
  const plan = await getUserPlan(userId)
  const limit = brandKitLimit(plan)
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM brand_kits WHERE user_id = ${userId}`
  if (n >= limit) throw err(`Your plan has room for ${limit} brand kit${limit === 1 ? '' : 's'}. Upgrade for more.`, 403)
  const data: BrandKitData = body.data === undefined ? DEFAULT_BRAND_KIT : cleanBrandKitData(body.data, userId)
  const name = cleanName(body.name) || `Brand kit ${n + 1}`
  const [row] = await sql<Row[]>`
    INSERT INTO brand_kits (user_id, name, data) VALUES (${userId}, ${name}, ${sql.json(data as never)})
    RETURNING id, name, data`
  return toKit(row, userId)
}

/**
 * A kit's name or settings changed: by its owner, or (Phase 6) by someone it's shared with as "Can edit" —
 * not its brand lock or default mark (the owner's), and a logo or font they uploaded is copied into the
 * owner's folder, where the kit's files are kept (and the export looks for them)
 */
export async function updateBrandKit(userId: string, kitId: string, body: { name?: unknown; data?: unknown }): Promise<BrandKit> {
  await tableReady()
  const name = body.name === undefined ? null : cleanName(body.name)
  if (name === '') throw err('Give the kit a name', 400)
  const access = await kitAccess(userId, kitId)
  if (!access) throw err('Brand kit not found', 404)
  if (access.role === 'use') throw err('Only its owner, or someone who can edit it, can change this kit.', 403)
  const owner = access.ownerId
  const [cur] = await sql<Row[]>`SELECT id, name, data FROM brand_kits WHERE id = ${kitId} AND user_id = ${owner}`
  if (!cur) throw err('Brand kit not found', 404)
  const editor = access.role === 'edit'
  const raw = body.data === undefined ? cur.data : editor ? await intoOwnerFiles(body.data, userId, owner, cur.data) : body.data
  const data = cleanBrandKitData(raw, owner)
  if (editor) {
    const was = cleanBrandKitData(cur.data, owner)
    data.lock = was.lock
    data.is_default = was.is_default
  }
  const row = await sql.begin(async tx => {
    // One default kit per account: marking this one unmarks the others
    if (data.is_default && !editor) {
      await tx`UPDATE brand_kits SET data = jsonb_set(data, '{is_default}', 'false'::jsonb), updated_at = now()
        WHERE user_id = ${owner} AND id <> ${kitId} AND (data->>'is_default')::boolean`
    }
    const [r] = await tx<Row[]>`
      UPDATE brand_kits SET name = ${name ?? cur.name}, data = ${tx.json(data as never)}, updated_at = now()
      WHERE id = ${kitId} AND user_id = ${owner}
      RETURNING id, name, data`
    return r
  })
  if (!row) throw err('Brand kit not found', 404)
  if (!editor) return toKit(row, userId)
  const [by] = await sql<{ by: string | null }[]>`SELECT COALESCE(NULLIF(name, ''), email) AS by FROM users WHERE id = ${owner}`
  return toKit(row, owner, by?.by ?? 'a teammate', 'edit')
}

/**
 * A kit's settings from someone who can edit it, with the logo and fonts they uploaded (kept in their own
 * folder, brand/<them>/) copied into the owner's — the kit's files are the owner's. A file that can't be
 * copied is left out (the kit keeps what it had).
 */
async function intoOwnerFiles(raw: unknown, editorId: string, ownerId: string, curRaw: unknown): Promise<unknown> {
  if (!raw || typeof raw !== 'object') return raw
  const d = { ...(raw as Record<string, unknown>) }
  const cur = cleanBrandKitData(curRaw, ownerId)
  const copy = (from: string, to: string) =>
    r2.send(new CopyObjectCommand({ Bucket: R2_BUCKET, Key: to, CopySource: `${R2_BUCKET}/${from}` })).then(() => true, e => { console.warn('[brand] a file could not be copied for a kit:', e); return false })
  const logo = d.logo && typeof d.logo === 'object' ? { ...(d.logo as Record<string, unknown>) } : null
  const mine = `brand/${editorId}/`
  if (logo && typeof logo.path === 'string' && logo.path.startsWith(mine) && !logo.path.includes('..')) {
    const to = `brand/${ownerId}/${logo.path.slice(mine.length)}`
    if (await copy(logo.path, to)) logo.path = to
    else { logo.path = cur.logo.path; logo.ratio = cur.logo.ratio }
    d.logo = logo
  }
  if (Array.isArray(d.fonts)) {
    const had = new Set(cur.fonts.map(f => f.family))
    const fonts: unknown[] = []
    for (const f of d.fonts) {
      const family = (f as { family?: unknown })?.family
      if (typeof family !== 'string' || !isBrandFont(family) || had.has(family)) { fonts.push(f); continue }
      if (await copy(brandFontKey(editorId, family), brandFontKey(ownerId, family))) fonts.push(f)
    }
    d.fonts = fonts
  }
  return d
}

// ── The default kit on new clips ───────────────────────────────────────────────
// A clip made by hand, from Best moments or from Ask AI starts with the account's default kit:
// its logo (where and when the kit says) and, when the kit's captions are on, its caption style —
// captions stay off until they're switched on in the editor (they cost money), then show in the
// kit's style. Make my clips does the same in the worker (its lib/brandKit.ts).

/** The account's default kit, or null (none marked, or the table isn't there yet) */
export async function defaultBrandKit(userId: string): Promise<BrandKitData | null> {
  const [row] = await sql<{ data: unknown }[]>`
    SELECT data FROM brand_kits WHERE user_id = ${userId} AND (data->>'is_default')::boolean LIMIT 1`.catch(() => [])
  return row ? cleanBrandKitData(row.data, userId) : null
}

/**
 * The brand words a clip's words are read with (Phase 5, lib/brandWords.ts): those of the kit switched on
 * for it (one its owner can still use), else of the owner's default kit; without a clip (`clipId` null),
 * the user's default kit's. Null: none — or no table yet, or a hiccup: the words are then shown as they are.
 */
export async function brandWordsFor(userId: string, clipId: string | null): Promise<BrandWords | null> {
  if (!BRAND_WORDS_ON) return null
  try {
    if (!clipId) {
      const [row] = await sql<{ words: unknown }[]>`
        SELECT data->'words' AS words FROM brand_kits WHERE user_id = ${userId} AND (data->>'is_default')::boolean LIMIT 1`
      return row ? cleanBrandWords(row.words) : null
    }
    const shares = await sharesReady()
    // (the clip's own kit first, else the default)
    const [row] = await (shares
      ? sql<{ words: unknown }[]>`
          SELECT bk.data->'words' AS words FROM clips c JOIN videos v ON v.id = c.video_id
          JOIN brand_kits bk ON (bk.id::text = to_jsonb(c)->'brand'->>'kit_id'
              AND (bk.user_id = v.user_id OR (EXISTS (SELECT 1 FROM brand_kit_shares s WHERE s.kit_id = bk.id AND s.user_id = v.user_id)
                AND EXISTS (SELECT 1 FROM users o WHERE o.id = bk.user_id AND o.plan = ANY(${TEAM_PLANS})))))
            OR (bk.user_id = v.user_id AND (bk.data->>'is_default')::boolean)
          WHERE c.id = ${clipId} AND v.user_id = ${userId}
          ORDER BY (bk.id::text = to_jsonb(c)->'brand'->>'kit_id') DESC LIMIT 1`
      : sql<{ words: unknown }[]>`
          SELECT bk.data->'words' AS words FROM clips c JOIN videos v ON v.id = c.video_id
          JOIN brand_kits bk ON bk.user_id = v.user_id AND (bk.id::text = to_jsonb(c)->'brand'->>'kit_id' OR (bk.data->>'is_default')::boolean)
          WHERE c.id = ${clipId} AND v.user_id = ${userId}
          ORDER BY (bk.id::text = to_jsonb(c)->'brand'->>'kit_id') DESC LIMIT 1`)
    return row ? cleanBrandWords(row.words) : null
  } catch (e) {
    console.warn('[brand] the brand words could not be read:', e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * The default kit put on clips just made — by hand, from Best moments or Ask AI — through the brand
 * engine, as the editor's switch puts it on (brandApply.ts brandClip): its logo, title style, caption
 * look (captions stay off until they're switched on: they cost money) and frames, with the kit's
 * version kept so the clips follow it. `lengthMs` isn't needed any more (the engine reads the clip);
 * kept for the callers. Never fails the clips: a problem is only logged.
 */
export async function brandNewClips(userId: string, clips: Array<{ id: string; lengthMs: number }>): Promise<void> {
  if (!clips.length) return
  try {
    const [row] = await sql<{ id: string }[]>`SELECT id FROM brand_kits WHERE user_id = ${userId} AND (data->>'is_default')::boolean LIMIT 1`.catch(() => [])
    if (!row) return
    const { brandClip } = await import('./brandApply')
    for (const c of clips) await brandClip(userId, c.id, row.id).catch(e => console.error('[brand] the default kit could not be put on a new clip:', e))
  } catch (e) {
    console.error('[brand] the default kit could not be put on new clips:', e)
  }
}

/**
 * The kit goes; its logo file stays (clips it was put on still show it). Every clip with it switched
 * on — the owner's, and those of the people it was shared with — keeps its look, the switch off.
 */
export async function deleteBrandKit(userId: string, kitId: string): Promise<void> {
  await tableReady()
  const rows = await sql`DELETE FROM brand_kits WHERE id = ${kitId} AND user_id = ${userId} RETURNING id`
  if (!rows.length) throw err('Brand kit not found', 404)
  await releaseClips(kitId).catch(e => console.error('[brand] clips not released from a deleted kit:', e))
}

const MAX_FONT_BYTES = 10 * 1024 * 1024

/**
 * A font uploaded for a kit: a TrueType or OpenType file (checked by its first bytes, not its name),
 * kept at brand/<user>/fonts/<id>. Its family name for text and captions is "BrandFont-<id>"; its
 * name in the kit is the file's name, which the user can change.
 */
export async function uploadBrandFont(userId: string, file: File): Promise<{ family: string; name: string }> {
  if (file.size > MAX_FONT_BYTES) throw err('A font file can be at most 10 MB', 400)
  const body = Buffer.from(await file.arrayBuffer())
  const sig = body.subarray(0, 4).toString('latin1')
  const otf = sig === 'OTTO'
  if (!(otf || sig === '\x00\x01\x00\x00' || sig === 'true')) throw err('Use a TTF or OTF font file', 400)
  const id = crypto.randomUUID()
  const family = `BrandFont-${id}`
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: brandFontKey(userId, family), Body: body, ContentType: otf ? 'font/otf' : 'font/ttf' }))
  const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, 40) || 'Brand font'
  return { family, name }
}

/** One of the user's own brand fonts, or one of a kit shared with them, for the editor to draw with */
export async function readBrandFont(userId: string, family: string): Promise<{ body: Uint8Array; type: string }> {
  if (!isBrandFont(family)) throw err('Not a brand font', 400)
  let res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: brandFontKey(userId, family) })).catch(() => null)
  if (!res?.Body && await sharesReady()) {
    // A shared kit's font: kept under its owner's folder
    const [kit] = await sql<{ user_id: string }[]>`
      SELECT bk.user_id FROM brand_kit_shares s JOIN brand_kits bk ON bk.id = s.kit_id
      WHERE s.user_id = ${userId} AND bk.data->'fonts' @> ${sql.json([{ family }] as never)} LIMIT 1`
    if (kit) res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: brandFontKey(kit.user_id, family) })).catch(() => null)
  }
  if (!res?.Body) throw err('Font not found', 404)
  return { body: await res.Body.transformToByteArray(), type: res.ContentType ?? 'font/ttf' }
}

const LOGO_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const MAX_LOGO_BYTES = 5 * 1024 * 1024

/**
 * A logo uploaded for a kit: kept under brand/<user>/ (a PNG keeps its see-through background), with
 * its brand colours read from it (brandStyle.ts pictureColours: on our server, no paid service)
 */
export async function uploadBrandLogo(userId: string, file: File): Promise<{ path: string; url: string | null; colors: { main: string; accent: string | null } | null }> {
  const ext = LOGO_TYPES[file.type]
  if (!ext) throw err('Use a PNG, JPG or WebP picture for the logo', 400)
  if (file.size > MAX_LOGO_BYTES) throw err('The logo can be at most 5 MB', 400)
  const path = `brand/${userId}/${crypto.randomUUID()}.${ext}`
  const body = Buffer.from(await file.arrayBuffer())
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: path, Body: body, ContentType: file.type }))
  const [url, colors] = await Promise.all([signLogo(path), pictureColours(body)])
  return { path, url, colors }
}
