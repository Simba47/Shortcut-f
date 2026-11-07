import sql from '@/lib/db'
import { hasColumn } from './clips'
import { pickKeyWords } from '@/lib/keyWords'

/**
 * The words that matter in a clip's captions, picked by AI (lib/keyWords.ts) — what the caption
 * styles make stand out. The export asks the same question the first time it renders a clip with
 * such a style (backend jobs/render.ts, the same lib/keyWords.ts); this asks it as soon as one is
 * picked in the editor, so the preview shows them. Kept on the caption style
 * (caption_styles.emphasis: { "<word start_ms>": true }; the line words a Creator style uses on a
 * line with no key word: caption_styles.line_keys); a clip that has them keeps them, unless
 * `fresh` (the Key words tab's "Pick again with AI") — then the new picks replace them.
 */
export async function clipEmphasis(userId: string, clipId: string, opts: { fresh?: boolean } = {}): Promise<{ emphasis: Record<string, true> | null; line_keys?: Record<string, true> | null }> {
  const [clip] = await sql`
    SELECT c.id, c.start_ms, c.end_ms, c.video_id, v.user_id, v.title AS video_title
    FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId}
  `
  if (!clip) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if (clip.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })

  const saves = await hasColumn('caption_styles', 'emphasis')
  // (the line words — what a Creator line makes big without a key word — once the worker has added the field)
  const savesLine = saves && await hasColumn('caption_styles', 'line_keys')
  if (saves && !opts.fresh) {
    const [style] = await sql`SELECT * FROM caption_styles WHERE clip_id = ${clipId} LIMIT 1`
    if (style?.emphasis) return { emphasis: style.emphasis as Record<string, true>, line_keys: (style.line_keys as Record<string, true> | null) ?? null }
  }

  const { aiProvider, askGemini } = await import('@/lib/gemini')
  if (!aiProvider()) return { emphasis: null }
  const [transcript] = await sql`SELECT id FROM transcripts WHERE video_id = ${clip.video_id} ORDER BY created_at DESC LIMIT 1`
  const words = transcript
    ? await sql<{ word: string; start_ms: number; end_ms: number }[]>`
        SELECT word, start_ms, end_ms FROM transcript_words
        WHERE transcript_id = ${transcript.id} AND start_ms >= ${clip.start_ms} AND start_ms < ${clip.end_ms}
        ORDER BY start_ms`
    : []
  if (!words.length) return { emphasis: null }

  let picked: Awaited<ReturnType<typeof pickKeyWords>> = null
  try {
    picked = await pickKeyWords([...words], (clip.video_title as string | null)?.trim() || null, (prompt, o) => askGemini(prompt, o))
  } catch (e) {
    console.warn('[emphasis] Gemini failed; the captions go without key words:', e instanceof Error ? e.message : e)
    return { emphasis: null }
  }
  // Kept for the export too (only where none were picked yet: never over the user's own — unless
  // they asked for new ones)
  if (picked && saves) {
    const set = savesLine ? { emphasis: sql.json(picked.emphasis), line_keys: sql.json(picked.line_keys) } : { emphasis: sql.json(picked.emphasis) }
    await (opts.fresh
      ? sql`UPDATE caption_styles SET ${sql(set)} WHERE clip_id = ${clipId}`
      : sql`UPDATE caption_styles SET ${sql(set)} WHERE clip_id = ${clipId} AND emphasis IS NULL`)
      .catch(e => console.warn('[emphasis] could not save:', e))
  }
  return picked ?? { emphasis: null }
}
