import sql from '@/lib/db'

/**
 * The editor's tool guides (ToolHints: a small loop of what each timeline tool does, on hover) — user,
 * 2026-11-19: shown until the account's first finished export; after that the tools show just their name
 * and shortcut. The Guide page's switch overrides it: users.tool_guides true = always the loops,
 * false = always the plain labels, null = the automatic rule.
 *
 * A finished export is a clip with an output file (only the worker's render sets it: jobs/render.ts), so a
 * failed or stopped export doesn't count.
 */

let column: Promise<void> | null = null
function ensureColumn(): Promise<void> {
  column ??= sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS tool_guides BOOLEAN`
    .then(() => undefined).catch(e => { column = null; throw e })
  return column
}

export type ToolGuides = { on: boolean; chosen: boolean; exported: boolean }

export async function toolGuides(userId: string): Promise<ToolGuides> {
  await ensureColumn()
  const [r] = await sql<{ tool_guides: boolean | null; exported: boolean }[]>`
    SELECT u.tool_guides,
      EXISTS (SELECT 1 FROM clips c JOIN videos v ON v.id = c.video_id
              WHERE v.user_id = u.id AND c.output_storage_path IS NOT NULL) AS exported
    FROM users u WHERE u.id = ${userId}`
  if (!r) return { on: true, chosen: false, exported: false }
  return { on: r.tool_guides ?? !r.exported, chosen: r.tool_guides != null, exported: r.exported }
}

/** The Guide page's switch: on = the loops, off = the plain labels, from now on */
export async function setToolGuides(userId: string, on: boolean): Promise<void> {
  await ensureColumn()
  await sql`UPDATE users SET tool_guides = ${on} WHERE id = ${userId}`
}
