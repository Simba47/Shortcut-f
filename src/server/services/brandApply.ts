import sql from '@/lib/db'
import type { AudioTrack, BoxKeyframe, CaptionStyle, Overlay, SegmentLocal, TextOverlay, Transition } from '@chai-cut/shared'
import { BRAND_ENDS_ON, captionBand, cleanBrandKitData, type BrandKit } from '@/lib/shared/brandKit'
import { cleanBrandOn, type BrandOn } from '@/lib/shared/brandOn'
import { lockHolds } from '@/lib/shared/brandTeam'
import { brandChanged, putBrandOn, takeBrandOff, updateBrand, type BrandTarget } from '@/modules/brand/engine'
import { isShot } from '@/modules/editor/shots'
import { rowsToLocal } from '@/modules/editor/utils'
import { hasColumn } from './clips'

/**
 * The brand engine (modules/brand/engine.ts) on clips that aren't open in the editor (brand kit
 * rebuild, Phase 2, 2026-10-27): the same rules as the editor, run on the server — a clip is read
 * as the editor reads it, the engine changes it, and only what it changed is written back, in one
 * transaction.
 *
 *  - brandClip: a kit put on a clip (or taken off, or swapped): new clips with the default kit,
 *    "Apply brand to all clips" on the clip board
 *  - catchUpClip: a clip whose kit changed since it went on follows it (before an export, so a clip
 *    exported without ever being opened is on-brand)
 *
 * Nothing here is paid for: it's our own database and code.
 */

const err = (message: string, status: number) => Object.assign(new Error(message), { status, expose: true })

/** A kit the user can put on clips (their own, or one shared with them), as the engine takes it; null: none such */
export async function usableKit(userId: string, kitId: string): Promise<BrandKit | null> {
  // (their own, or one shared with them while its owner's plan shares kits: brandKits.ts kitAccess)
  const { kitAccess, usableEnds } = await import('./brandKits')
  const access = await kitAccess(userId, kitId)
  if (!access) return null
  const [row] = await sql<{ name: string }[]>`SELECT name FROM brand_kits WHERE id = ${kitId}`.catch(() => [])
  if (!row) return null
  // (a shared kit's logo is its owner's; its intro and outro are theirs too: not for this user's clips)
  return { id: kitId, name: row.name, data: await usableEnds(access.data, access.ownerId, access.role !== 'owner') }
}

/** A clip as the brand engine takes it, and what the writing back needs */
interface Loaded {
  target: BrandTarget
  brand: BrandOn | null
  userId: string
  /** Its caption style row, if it has one */
  hasStyle: boolean
}

/** A clip read as the editor reads it (app/editor/[clipId]/page.tsx): the parts the brand works on */
async function load(clipId: string): Promise<Loaded | null> {
  const [clip] = await sql<{ id: string; video_id: string; start_ms: number; end_ms: number; user_id: string; brand: unknown; layers: unknown; trims: unknown }[]>`
    SELECT c.id, c.video_id, c.start_ms, c.end_ms, v.user_id, to_jsonb(c)->'brand' AS brand,
      to_jsonb(c)->'layers' AS layers, to_jsonb(c)->'trim_ranges' AS trims
    FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId}`
  if (!clip) return null
  const [segRows, styles, texts, overlays, transitions, audioTracks] = await Promise.all([
    // (each box as saved, with its views: an end card moves parts around — render.ts reads them the same way)
    sql`
      SELECT s.*, COALESCE(json_agg(to_jsonb(cb) || jsonb_build_object('box_keyframes', COALESCE((
          SELECT json_agg(bk.* ORDER BY bk.t_ms) FROM box_keyframes bk WHERE bk.box_id = cb.id), '[]'::json))
        ORDER BY cb.slot_index) FILTER (WHERE cb.id IS NOT NULL), '[]') AS crop_boxes
      FROM segments s LEFT JOIN crop_boxes cb ON cb.segment_id = s.id
      WHERE s.clip_id = ${clipId} GROUP BY s.id ORDER BY s.sort_order`,
    sql`SELECT * FROM caption_styles WHERE clip_id = ${clipId} LIMIT 1`,
    sql`SELECT * FROM text_overlays WHERE clip_id = ${clipId}`,
    sql`SELECT * FROM overlays WHERE clip_id = ${clipId} ORDER BY z_index`,
    sql`SELECT * FROM transitions WHERE clip_id = ${clipId}`,
    sql`SELECT * FROM audio_tracks WHERE clip_id = ${clipId}`,
  ])
  const segments = rowsToLocal(segRows as never) as SegmentLocal[]
  const keyframes: Record<string, BoxKeyframe[]> = Object.fromEntries(segments.flatMap(s => s.crop_boxes.map(b =>
    [b.id, ((b.keyframes ?? []) as BoxKeyframe[]).map(k => ({ id: k.id, box_id: b.id, t_ms: k.t_ms, x: Number(k.x), y: Number(k.y), w: Number(k.w), h: Number(k.h) }))])))
  // Its length on the timeline: its stretch of the video, longer by videos put in between, and by
  // parts played slower (as the editor's page works it out)
  const own = (s: SegmentLocal) => !(s.crop_boxes[0]?.source_video_id && s.crop_boxes[0].source_video_id !== clip.video_id)
  const inserted = segments.filter(s => s.video_offset_ms != null && !String(s.layout).startsWith('frame_') && !own(s))
    .reduce((t, s) => t + Math.max(0, s.end_ms - s.start_ms), 0)
  const slower = segments.filter(s => own(s) && Number(s.speed) > 0 && Number(s.speed) !== 1)
    .reduce((t, s) => t + (s.end_ms - s.start_ms) * (1 - Number(s.speed)), 0)
  const caption = (styles[0] ?? {}) as Partial<CaptionStyle>
  // (the note beside the parts also keeps rows, caption parts and groups: only its record of the
  // sections cut by a video on top — `cut` — has to keep matching the parts)
  const noted = (clip.layers as { cut?: unknown } | null)?.cut
  const timelineEdits = !(Array.isArray(noted) && noted.length) && !segments.some(s => isShot(s, clip.video_id))
  return {
    target: {
      clipId, lengthMs: clip.end_ms - clip.start_ms + inserted + Math.max(0, slower), mainVideoId: clip.video_id, ends: BRAND_ENDS_ON,
      overlays: overlays as unknown as Overlay[], texts: texts as unknown as TextOverlay[],
      caption, textCase: caption.uppercase ? 'upper' : 'title', segments,
      keyframes, transitions: transitions as unknown as Transition[],
      // (with a video on top, the editor keeps a note of its layers beside the parts: changing the parts
      // here would leave it behind — the editor makes the end card when the clip is opened)
      timelineEdits,
      audioTracks: audioTracks as unknown as AudioTrack[],
      // (the intro and outro: here only where the main video's place at any moment is plain — no parts
      // removed the older way, none played faster or slower; else the editor puts them in when it's opened)
      canInsert: timelineEdits && !(Array.isArray(clip.trims) && clip.trims.length) && !(slower !== 0 || segments.some(s => own(s) && (s.speed ?? 1) !== 1)),
      // (the logo keeps off its captions — where they sit, else low down: the editor knows each look's
      // own spot, and the faces, when it's open)
      avoid: styles[0] && caption.enabled !== false ? [captionBand(caption.position_y ?? 0.84)] : [],
    },
    brand: cleanBrandOn(clip.brand),
    userId: clip.user_id,
    hasStyle: styles.length > 0,
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
/** The caption style fields the brand can set (and the database has) */
const CAPTION_FIELDS = ['template', 'animation', 'font', 'size', 'color', 'highlight_color', 'uppercase', 'words_per_line'] as const

/**
 * What the engine changed, written back in one transaction: brand logos, text styles, caption style, frames,
 * the parts an end card, intro or outro changed (and what they moved along), the brand switch
 */
async function save(l: Loaded, next: BrandTarget, brand: BrandOn | null) {
  const was = l.target, clipId = was.clipId
  const [hasOpacity, hasTemplate, hasEnabled, hasBrand] = await Promise.all([
    hasColumn('overlays', 'opacity'), hasColumn('caption_styles', 'template'), hasColumn('caption_styles', 'enabled'), hasColumn('clips', 'brand'),
  ])
  const before = new Map(was.overlays.map(o => [o.id, o]))
  const after = new Map(next.overlays.map(o => [o.id, o]))
  const removed = was.overlays.filter(o => !after.has(o.id)).map(o => o.id)
  const added = next.overlays.filter(o => !before.has(o.id))
  const changed = next.overlays.filter(o => before.has(o.id) && !same(o, before.get(o.id)))
  const row = (o: Overlay) => ({
    storage_path: o.storage_path, x: o.x, y: o.y, w: o.w, h: o.h, start_ms: Math.round(o.start_ms), end_ms: Math.round(o.end_ms), z_index: o.z_index,
    ...(hasOpacity ? { opacity: o.opacity ?? null } : {}),
  })
  const textOf = (t: TextOverlay | undefined) => [t?.font, t?.color, t?.size, t?.start_ms, t?.end_ms]
  const texts = next.texts.filter((t, i) => !same(textOf(t), textOf(was.texts[i])))
  const fields = CAPTION_FIELDS.filter(k => (k !== 'template' || hasTemplate) && !same(next.caption[k], was.caption[k]))
  // (capitals are yes or no: the field takes no empty value)
  const captionPatch = Object.fromEntries(fields.map(k => [k, next.caption[k] ?? (k === 'uppercase' ? false : null)]))
  // The parts (an end card made or taken off): new ones with their boxes and views, gone ones, and
  // those cut shorter or longer or given another layout; every part's order by time (the export
  // joins them in that order); transitions gone and back
  const wasSeg = new Map(was.segments.map(s => [s.id, s]))
  const nextIds = new Set(next.segments.map(s => s.id))
  const goneSegs = was.segments.filter(s => !nextIds.has(s.id)).map(s => s.id)
  const newSegs = next.segments.filter(s => !wasSeg.has(s.id))
  const moved = next.segments.filter(s => wasSeg.has(s.id) && !same([s.start_ms, s.end_ms, s.layout], [wasSeg.get(s.id)!.start_ms, wasSeg.get(s.id)!.end_ms, wasSeg.get(s.id)!.layout]))
  const order = [...next.segments].sort((a, b) => a.start_ms - b.start_ms || a.sort_order - b.sort_order).map((s, i) => [s.id, i] as const)
  const reordered = order.filter(([id, i]) => !newSegs.some(s => s.id === id) && wasSeg.get(id)?.sort_order !== i)
  const nextTr = new Set(next.transitions.map(x => x.id)), wasTr = new Set(was.transitions.map(x => x.id))
  const goneTr = was.transitions.filter(x => !nextTr.has(x.id)).map(x => x.id)
  const newTr = next.transitions.filter(x => !wasTr.has(x.id))
  const [hasControls, hasSpeed, hasInsert] = newSegs.length
    ? await Promise.all([hasColumn('segments', 'locked'), hasColumn('segments', 'speed'), hasColumn('segments', 'video_offset_ms')])
    : [false, false, false]
  const segRow = (s: SegmentLocal) => ({
    id: s.id, clip_id: clipId, start_ms: Math.round(s.start_ms), end_ms: Math.round(s.end_ms), layout: s.layout,
    sort_order: order.find(([id]) => id === s.id)![1], frame: s.frame ? sql.json(s.frame as never) : null,
    ...(hasControls ? { hidden: !!s.hidden, muted: !!s.muted, locked: !!s.locked } : {}),
    ...(hasSpeed ? { speed: s.speed ?? 1, smooth: !!s.smooth, pitch: !!s.pitch } : {}),
    ...(hasInsert ? { video_offset_ms: s.video_offset_ms ?? null } : {}),
  })
  const boxRows = newSegs.flatMap(s => s.crop_boxes.map(b => ({
    id: b.id, segment_id: s.id, slot_index: b.slot_index, source_video_id: b.source_video_id ?? null,
    source_offset_ms: Math.round(b.source_offset_ms ?? 0), image_path: b.image_path ?? null, image_motion: b.image_motion ?? null,
    volume: b.volume ?? 1, muted: !!b.muted, ...(hasControls ? { hidden: !!b.hidden } : {}),
  })))
  const viewRows = newSegs.flatMap(s => s.crop_boxes.flatMap(b => (next.keyframes[b.id] ?? []).map(k => ({ box_id: b.id, t_ms: Math.round(k.t_ms), x: k.x, y: k.y, w: k.w, h: k.h }))))
  const frames = next.segments.filter(s => wasSeg.has(s.id) && !same(s.frame, wasSeg.get(s.id)!.frame))
  // (an intro moves everything after it along: the views of the parts that stay, and where their boxes start in their videos)
  const keptBoxes = next.segments.filter(s => wasSeg.has(s.id)).flatMap(s => s.crop_boxes.map(b => ({ b, was: wasSeg.get(s.id)!.crop_boxes.find(x => x.id === b.id) })))
  const reviewed = keptBoxes.filter(({ b, was: w }) => w && !same(next.keyframes[b.id] ?? [], was.keyframes[b.id] ?? [])).map(({ b }) => b.id)
  const reviewRows = reviewed.flatMap(id => (next.keyframes[id] ?? []).map(k => ({ box_id: id, t_ms: Math.round(k.t_ms), x: k.x, y: k.y, w: k.w, h: k.h })))
  const reoffset = keptBoxes.filter(({ b, was: w }) => w && Math.round(b.source_offset_ms ?? 0) !== Math.round(w.source_offset_ms ?? 0)).map(({ b }) => b)
  // Music and sounds moved along (the video's own sound cut in two around an intro's place)
  const wasAudio = new Map(was.audioTracks.map(a => [a.id, a]))
  const nextAudio = new Set(next.audioTracks.map(a => a.id))
  const goneAudio = was.audioTracks.filter(a => !nextAudio.has(a.id)).map(a => a.id)
  const audioCols = new Set(was.audioTracks.flatMap(a => Object.keys(a)))
  const newAudio = next.audioTracks.filter(a => !wasAudio.has(a.id))
    .map(a => Object.fromEntries(Object.entries({ ...a, clip_id: clipId }).filter(([k]) => audioCols.has(k) || k === 'clip_id')))
  const audioOf = (a: AudioTrack) => [a.start_ms, a.end_ms ?? null, a.offset_ms ?? null]
  const movedAudio = next.audioTracks.filter(a => wasAudio.has(a.id) && !same(audioOf(a), audioOf(wasAudio.get(a.id)!)))

  await sql.begin(async tx => {
    if (removed.length) await tx`DELETE FROM overlays WHERE id = ANY(${removed}) AND clip_id = ${clipId}`
    if (added.length) {
      await tx`INSERT INTO overlays ${tx(added.map(o => ({
        id: o.id, clip_id: clipId, type: o.type, source_video_id: o.source_video_id, source_offset_ms: o.source_offset_ms, ...row(o),
      })))}`
    }
    for (const o of changed) await tx`UPDATE overlays SET ${tx(row(o))} WHERE id = ${o.id} AND clip_id = ${clipId}`
    for (const t of texts) {
      await tx`UPDATE text_overlays SET font = ${t.font ?? null}, color = ${t.color ?? null}, size = ${t.size ?? null},
        start_ms = ${Math.round(t.start_ms)}, end_ms = ${Math.round(t.end_ms)} WHERE id = ${t.id} AND clip_id = ${clipId}`
    }
    if (fields.length) {
      if (l.hasStyle) await tx`UPDATE caption_styles SET ${tx(captionPatch)} WHERE clip_id = ${clipId}`
      // (a clip with no caption style yet: one in the brand's look — captions stay off until switched on: they cost money)
      else await tx`INSERT INTO caption_styles ${tx({ clip_id: clipId, position: 'bottom-center', ...captionPatch, ...(hasEnabled ? { enabled: false } : {}) })}`
    }
    for (const s of frames) await tx`UPDATE segments SET frame = ${s.frame ? tx.json(s.frame as never) : null} WHERE id = ${s.id} AND clip_id = ${clipId}`
    // (the parts: what's gone first — its boxes and views go with it — so a part given back keeps its ids)
    if (goneTr.length) await tx`DELETE FROM transitions WHERE id = ANY(${goneTr}) AND clip_id = ${clipId}`
    if (goneSegs.length) {
      // (its views and boxes first: as the database cascades them, without leaning on it)
      await tx`DELETE FROM box_keyframes WHERE box_id IN (SELECT cb.id FROM crop_boxes cb JOIN segments s ON s.id = cb.segment_id
        WHERE s.id = ANY(${goneSegs}) AND s.clip_id = ${clipId})`
      await tx`DELETE FROM crop_boxes WHERE segment_id IN (SELECT id FROM segments WHERE id = ANY(${goneSegs}) AND clip_id = ${clipId})`
      await tx`DELETE FROM segments WHERE id = ANY(${goneSegs}) AND clip_id = ${clipId}`
    }
    for (const s of moved) await tx`UPDATE segments SET start_ms = ${Math.round(s.start_ms)}, end_ms = ${Math.round(s.end_ms)}, layout = ${s.layout} WHERE id = ${s.id} AND clip_id = ${clipId}`
    for (const [id, i] of reordered) await tx`UPDATE segments SET sort_order = ${i} WHERE id = ${id} AND clip_id = ${clipId}`
    if (newSegs.length) await tx`INSERT INTO segments ${tx(newSegs.map(segRow))}`
    if (boxRows.length) await tx`INSERT INTO crop_boxes ${tx(boxRows)}`
    if (viewRows.length) await tx`INSERT INTO box_keyframes ${tx(viewRows)}`
    for (const b of reoffset) await tx`UPDATE crop_boxes SET source_offset_ms = ${Math.round(b.source_offset_ms ?? 0)} WHERE id = ${b.id}`
    if (reviewed.length) {
      await tx`DELETE FROM box_keyframes WHERE box_id = ANY(${reviewed})`
      if (reviewRows.length) await tx`INSERT INTO box_keyframes ${tx(reviewRows)}`
    }
    if (goneAudio.length) await tx`DELETE FROM audio_tracks WHERE id = ANY(${goneAudio}) AND clip_id = ${clipId}`
    for (const a of movedAudio) {
      await tx`UPDATE audio_tracks SET start_ms = ${Math.round(a.start_ms)}, end_ms = ${a.end_ms == null ? null : Math.round(a.end_ms)}
        ${audioCols.has('offset_ms') ? tx`, offset_ms = ${a.offset_ms == null ? null : Math.round(a.offset_ms)}` : tx``} WHERE id = ${a.id} AND clip_id = ${clipId}`
    }
    if (newAudio.length) await tx`INSERT INTO audio_tracks ${tx(newAudio as never)}`
    if (newTr.length) await tx`INSERT INTO transitions ${tx(newTr.map(x => ({ id: x.id, clip_id: clipId, after_segment_id: x.after_segment_id, type: x.type, duration_ms: x.duration_ms })))}`
    if (hasBrand) await tx`UPDATE clips SET brand = ${brand ? tx.json(brand as never) : null} WHERE id = ${clipId}`
  })
}

/**
 * A kit put on a clip (`kitId`), or the brand taken off (`null`): a kit on before comes off first,
 * putting back what it changed. The clip must be the user's; the kit theirs or shared with them.
 * Returns whether the clip has a brand on now.
 */
export async function brandClip(userId: string, clipId: string, kitId: string | null): Promise<boolean> {
  const l = await load(clipId)
  if (!l) throw err('Clip not found', 404)
  if (l.userId !== userId) throw err('Clip not found', 404)
  const kit = kitId ? await usableKit(userId, kitId) : null
  if (kitId && !kit) throw err('That brand kit isn’t yours to use', 403)
  // (the same kit again: the clip takes the kit as it is now — "Put on all" says so)
  if (kit && l.brand?.kit_id === kit.id) { await followKit(l, kit); return true }
  // (a locked team kit on it stays on: only its owner, or someone who can edit it, takes it off — Phase 6)
  if (l.brand) {
    const { kitAccess } = await import('./brandKits')
    const on = await kitAccess(userId, l.brand.kit_id)
    if (on && lockHolds(on.data, on.role)) throw err('This clip has a locked team brand kit on: only its owner can take it off.', 403)
  }
  let t = l.target
  if (l.brand) {
    // (the kit on now, else — deleted since — as it was when it went on)
    const old = (await usableKit(userId, l.brand.kit_id))?.data ?? l.brand.applied ?? null
    t = takeBrandOff(t, old, l.brand.before)
  }
  if (!kit) {
    await save(l, t, null)
    return false
  }
  const r = putBrandOn(t, kit)
  await save(l, r.target, { kit_id: kit.id, before: r.before, applied: r.applied })
  return true
}

/**
 * A clip whose kit changed since it went on follows it (updateBrand), as the editor does when it's
 * opened. A clip branded before the kit's version was kept takes the kit as it is now, as where it
 * starts from. Never fails the caller: a problem is only logged.
 */
export async function catchUpClip(clipId: string): Promise<void> {
  try {
    const l = await load(clipId)
    if (!l?.brand) return
    const kit = await usableKit(l.userId, l.brand.kit_id)
    if (!kit) return
    await followKit(l, kit)
  } catch (e) {
    console.error('[brand] a clip could not follow its kit:', e)
  }
}

/** The clip takes its kit as it is now, if it changed since the clip last took it */
async function followKit(l: Loaded, kit: BrandKit) {
  const on = l.brand!
  if (!on.applied) { await save(l, l.target, { ...on, applied: kit.data }); return }
  if (!brandChanged(on.applied, kit.data)) return
  const r = updateBrand(l.target, on.applied, kit, on.before)
  await save(l, r.target, { ...on, before: r.before, applied: r.applied })
}

/** The brand kit on one of the user's clips, as saved (null: none) */
export async function clipKit(userId: string, clipId: string): Promise<string | null> {
  if (!(await hasColumn('clips', 'brand'))) return null
  const [row] = await sql<{ kit: string | null }[]>`
    SELECT c.brand->>'kit_id' AS kit FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId} AND v.user_id = ${userId}`
  if (!row) throw err('Clip not found', 404)
  return row.kit
}

/** The clips of one of the user's videos, each with its brand kit (null: none), for the clip board */
export async function clipBrands(userId: string, videoId: string): Promise<Record<string, string | null>> {
  if (!(await hasColumn('clips', 'brand'))) return {}
  const rows = await sql<{ id: string; kit: string | null }[]>`
    SELECT c.id, c.brand->>'kit_id' AS kit FROM clips c JOIN videos v ON v.id = c.video_id
    WHERE c.video_id = ${videoId} AND v.user_id = ${userId}`
  return Object.fromEntries(rows.map(r => [r.id, r.kit]))
}

/**
 * "Apply brand to all clips" (the clip board): a kit on every clip of a video (or the brand off
 * them all, `null`). Clips being exported are left alone. Returns how many changed.
 * `clipIds`: only these of the video's clips — the ones on the board pressed (user, 2026-11-09: the AI's
 * board said "Put on all 7" and put it on the clips cut by hand too, which that board doesn't list)
 */
export async function brandVideoClips(userId: string, videoId: string, kitId: string | null, clipIds?: string[]): Promise<{ changed: number; skipped: number }> {
  const all = await sql<{ id: string; status: string }[]>`
    SELECT c.id, c.status FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.video_id = ${videoId} AND v.user_id = ${userId}`
  const only = clipIds ? new Set(clipIds) : null
  const rows = only ? all.filter(r => only.has(r.id)) : all
  if (kitId && !(await usableKit(userId, kitId))) throw err('That brand kit isn’t yours to use', 403)
  let changed = 0, skipped = 0
  for (const r of rows) {
    if (r.status === 'rendering') { skipped++; continue }
    try { await brandClip(userId, r.id, kitId); changed++ } catch (e) {
      skipped++
      console.error('[brand] a clip could not be branded:', e)
    }
  }
  return { changed, skipped }
}

