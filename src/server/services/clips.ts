import { savedTextStyle } from '@/modules/editor/textStyle'
import sql from '@/lib/db'
import { cleanTrims, trimMap, MAX_CLIP_MS, MIN_CLIP_MS } from '@/lib/trims'
import { cleanProgressBar } from '@/lib/shared/brandKit'
import { cleanCardLook, cleanFrameBackground } from '@/lib/shared/brandCard'
import { cleanBrandOn } from '@/lib/shared/brandOn'
import { lockCaption, lockClipLook, lockHolds, lockSetOf } from '@/lib/shared/brandTeam'
import type { SegmentLocal, BoxKeyframeLocal, CaptionStyle, TextOverlay, AudioTrack, Transition, Overlay, FrameSettings, FrameItem, CornerStyle, BrollAlt, BrollPick } from '@chai-cut/shared'
import { SPEED_MIN, SPEED_MAX } from '@chai-cut/shared'

interface CreateClipInput {
  video_id: string; start_ms?: number; end_ms?: number; layout?: string; title?: string
}

export async function createClip(userId: string, input: CreateClipInput) {
  const [video] = await sql`
    SELECT id, duration_ms, storage_path FROM videos WHERE id = ${input.video_id} AND user_id = ${userId}
  `
  if (!video) throw Object.assign(new Error('Video not found'), { status: 404 })

  const { checkClipQuota } = await import('./quota')
  await checkClipQuota(userId)

  const startMs = input.start_ms ?? 0
  const endMs = input.end_ms ?? (video.duration_ms ?? 5 * 60 * 1000)
  const layout = input.layout === 'vertical' ? 'vertical' : 'horizontal'

  const [clip] = await sql`
    INSERT INTO clips (video_id, start_ms, end_ms, status, title)
    VALUES (${input.video_id}, ${startMs}, ${endMs}, 'draft', ${input.title ?? null})
    RETURNING id
  `
  if (!clip) throw Object.assign(new Error('Failed to create clip'), { status: 500 })

  // No captions yet: they cost money, so the clip opens with captions off and they're made when
  // switched on in the editor (for this clip only). The account's default brand kit goes on it
  const { brandNewClips } = await import('./brandKits')
  await brandNewClips(userId, [{ id: clip.id as string, lengthMs: endMs - startMs }])

  return { clip_id: clip.id, layout }
}

interface SaveClipInput {
  segments: SegmentLocal[]
  captionStyle: Partial<CaptionStyle>
  textOverlays: TextOverlay[]
  audioTracks: AudioTrack[]
  transitions: Transition[]
  filters: { brightness: number; contrast: number; saturation: number }
  overlays: Omit<Overlay, 'created_at'>[]
  /** Remove pauses and filler words when exporting */
  removeFillers?: boolean
  /** The clip's own sound (top of the Music panel) */
  originalSound?: { volume: number; muted: boolean }
  /** The clip's progress bar (Brand kit panel), null = none; left out by an editor that doesn't know it: what's saved stays */
  progressBar?: unknown
  /** The brand kit on the clip and what it changed (lib/shared/brandOn.ts); null = off */
  brand?: unknown
  /**
   * Parts of the video removed from the clip: [[start, end], …] in ms of the source video
   * (lib/trims.ts). Left out by an editor that doesn't know about them: what's saved stays.
   */
  trims?: unknown
  /** The clip's start and end in its video, when dragged in the editor: [start, end] ms */
  range?: unknown
  /**
   * Videos on top (B-roll) are layers in the editor, saved as one row of parts in `segments`. This
   * is the editor's note of the sections it cut to do so (modules/editor/shots.ts), kept as it is
   * and handed back when the clip is opened; null = no video on top. Left out by an editor that
   * doesn't know about layers: what's saved stays (and no longer matches the rows, so it's ignored).
   */
  layers?: unknown
}

/**
 * The brand lock (brand kit Phase 6): on a clip with a locked team kit on — shared with the user as
 * "Can use" — what's saved keeps to the kit's colours and fonts (as the editor shows it: brandTeam.ts
 * lockClipLook), and the kit isn't taken off or swapped: only its owner, or someone who can edit it, can.
 * Anyone else's save goes as it is.
 */
async function keptToLock(userId: string, clipId: string, body: SaveClipInput): Promise<SaveClipInput> {
  if (!(await hasColumn('clips', 'brand'))) return body
  const [row] = await sql<{ kit: string | null }[]>`
    SELECT c.brand->>'kit_id' AS kit FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId} AND v.user_id = ${userId}`
  if (!row) return body
  const { kitAccess } = await import('./brandKits')
  const now = body.brand === undefined ? row.kit : (cleanBrandOn(body.brand)?.kit_id ?? null)
  if (row.kit && row.kit !== now) {
    const was = await kitAccess(userId, row.kit)
    if (was && lockHolds(was.data, was.role)) {
      throw Object.assign(new Error('This clip has a locked team brand kit on: only its owner can take it off.'), { status: 403 })
    }
  }
  if (!now) return body
  const access = await kitAccess(userId, now)
  if (!access || !lockHolds(access.data, access.role)) return body
  const set = lockSetOf(access.data)
  const kept = lockClipLook({ texts: body.textOverlays ?? [], caption: body.captionStyle ?? {}, parts: [], segments: body.segments ?? [] }, set)
  // (its caption parts — each in its own look — saved beside the rows)
  const layers = body.layers && typeof body.layers === 'object' ? body.layers as Record<string, unknown> : null
  const parts = Array.isArray(layers?.captionParts)
    ? (layers.captionParts as unknown[]).map(p => {
      const style = p && typeof p === 'object' ? (p as { style?: unknown }).style : null
      return style && typeof style === 'object' ? { ...(p as object), style: lockCaption(style as Partial<CaptionStyle>, set) } : p
    })
    : null
  return {
    ...body, textOverlays: kept.texts, captionStyle: kept.caption, segments: kept.segments,
    ...(layers && parts ? { layers: { ...layers, captionParts: parts } } : {}),
  }
}

export async function saveClip(userId: string, clipId: string, input: SaveClipInput) {
  // (a locked team kit's colours and fonts: before anything is written)
  const body = await keptToLock(userId, clipId, input)
  const { segments, captionStyle, textOverlays, audioTracks, transitions, overlays } = body
  const ms = (v: number) => Math.round(v)

  // Ownership check and the existing caption style in one round trip
  const [[clip], [existingStyle]] = await Promise.all([
    sql`SELECT c.id, c.start_ms, c.end_ms, to_jsonb(c)->'trim_ranges' AS trim_ranges,
      (to_jsonb(c)->>'original_start_ms')::int AS original_start_ms, (to_jsonb(c)->>'original_end_ms')::int AS original_end_ms,
      v.user_id, v.duration_ms AS video_duration_ms FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId}`,
    sql`SELECT id FROM caption_styles WHERE clip_id = ${clipId} LIMIT 1`,
  ])
  if (!clip) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if (clip.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })

  // Re-index sort_order as 0,1,2… — the store uses fractional values (e.g. +0.5) to insert
  // between existing segments in-memory, but the DB column is INTEGER. Order by time: repeated
  // splits can give two segments the same fractional sort_order, and the renderer concatenates
  // segments in sort_order, so a tie could swap them in the export.
  const sortedSegments = [...segments].sort((a, b) => a.start_ms - b.start_ms || a.sort_order - b.sort_order)

  // Hide / mute / lock (and music trims) once the database has those fields (the backend adds them when it starts)
  const hasControls = await itemControlFields()
  // A video put in between: where the main video waits meanwhile (modules/editor/inserts.ts).
  // Written for every row, so a part that is no longer one (or an older clip's leftover) is cleared.
  const hasInsertField = await hasColumn('segments', 'video_offset_ms')
  // A part played faster or slower (speed, smooth slow-mo, pitch), once the backend has added them
  const hasSpeedField = await hasColumn('segments', 'speed')
  const speedOfRow = (seg: (typeof segments)[number]) => {
    const v = Number((seg as { speed?: unknown }).speed)
    return isFinite(v) && v >= SPEED_MIN && v <= SPEED_MAX ? Math.round(v * 100) / 100 : 1
  }
  const speedNotSaved = hasSpeedField ? 0 : segments.filter(s => speedOfRow(s) !== 1).length
  const holdOf = (seg: (typeof sortedSegments)[number]) => {
    const v = (seg as { video_offset_ms?: unknown }).video_offset_ms
    return typeof v === 'number' && isFinite(v) && v >= 0 && seg.crop_boxes[0]?.source_video_id ? ms(v) : null
  }
  const segRows = sortedSegments.map((seg, si) => ({
    id: seg.id, clip_id: clipId, start_ms: ms(seg.start_ms), end_ms: ms(seg.end_ms), layout: seg.layout, sort_order: si,
    frame: seg.frame ? sql.json(cleanFrame(seg.frame) as never) : null,
    ...(hasControls ? { hidden: !!seg.hidden, muted: !!seg.muted, locked: !!seg.locked } : {}),
    ...(hasInsertField ? { video_offset_ms: holdOf(seg) } : {}),
    ...(hasSpeedField ? { speed: speedOfRow(seg), smooth: !!seg.smooth && speedOfRow(seg) < 1, pitch: !!seg.pitch && speedOfRow(seg) !== 1 } : {}),
  }))
  const boxRows = sortedSegments.flatMap(seg => seg.crop_boxes.map(box => ({
    id: box.id, segment_id: seg.id, slot_index: box.slot_index,
    source_video_id: box.source_video_id ?? null, source_offset_ms: ms(box.source_offset_ms ?? 0),
    image_path: box.image_path ?? null,
    image_motion: box.image_motion && motions.includes(box.image_motion) ? box.image_motion : null,
    volume: Math.max(0, Math.min(1, Number(box.volume ?? 1))),
    muted: !!box.muted,
    ...(hasControls ? { hidden: !!box.hidden } : {}),
  })))
  const keyframeRows = sortedSegments.flatMap(seg => seg.crop_boxes.flatMap(box =>
    (box.keyframes ?? []).map((kf: BoxKeyframeLocal) => ({ box_id: box.id, t_ms: ms(kf.t_ms), x: kf.x, y: kf.y, w: kf.w, h: kf.h }))))
  const segIds = segRows.map(r => r.id)
  const boxIds = boxRows.map(r => r.id)
  // Other videos this clip shows (B-roll, frame lanes, video overlays): the renderer fetches them
  // by ID, so none may be another user's video. (A deleted video's ID is let through — the
  // renderer skips it — so a clip that still points at one can keep saving.)
  const videoIds = [...new Set([
    ...boxRows.map(r => r.source_video_id),
    ...sortedSegments.flatMap(seg => (seg.frame?.items ?? []).map(it => it?.kind === 'video' ? it.source_video_id : null)),
    ...overlays.map(o => o.source_video_id),
  ].filter((id): id is string => typeof id === 'string' && id.length > 0))]

  // Segments and crop boxes are written by the IDs the client sends. None of them may belong to
  // another clip: the upserts below would change that clip's rows and the deletes would remove
  // its boxes and keyframes. New IDs (not in the database yet) are fine.
  if (segIds.length > 0 || boxIds.length > 0 || videoIds.length > 0) {
    const [foreign] = await sql`
      SELECT
        (SELECT count(*) FROM segments WHERE id = ANY(${segIds}) AND clip_id <> ${clipId})::int AS segments,
        (SELECT count(*) FROM crop_boxes cb JOIN segments s ON s.id = cb.segment_id
          WHERE cb.id = ANY(${boxIds}) AND s.clip_id <> ${clipId})::int AS boxes,
        (SELECT count(*) FROM videos WHERE id::text = ANY(${videoIds}) AND user_id <> ${userId})::int AS others_videos
    `
    if (foreign.segments > 0 || foreign.boxes > 0) {
      throw Object.assign(new Error('This save refers to formats of another clip'), { status: 400 })
    }
    if (foreign.others_videos > 0) {
      throw Object.assign(new Error('This save refers to a video that is not yours'), { status: 400 })
    }
  }

  const hasEnabledField = await captionEnabledField()
  const hasPresetFields = await captionPresetFields()
  // The caption style (template): saved once the backend has added its field
  const hasTemplateField = await hasColumn('caption_styles', 'template')
  // The key words (emphasis): the backend adds that field too
  const hasEmphasisField = await hasColumn('caption_styles', 'emphasis')
  // Captions moved left or right, once the worker has added the field
  const hasCaptionX = await hasColumn('caption_styles', 'position_x')
  // The captions' case (Title, UPPER, lower), once the worker has added the field
  const hasTextCase = await hasColumn('caption_styles', 'text_case')
  // The newer kinds of transition: saved as they are once the backend allows them (else the nearest older kind)
  const transitionKindOk = await transitionKindsAllowed()
  const hasRemoveFillers = typeof body.removeFillers === 'boolean' && await clipsHasRemoveFillers()
  const hasFades = await hasColumn('audio_tracks', 'fade_in')
  const hasTextW = await hasColumn('text_overlays', 'w')
  const hasTextH = await hasColumn('text_overlays', 'h')
  // How far a text / photo is turned (its rotate handle on the preview), once the worker has added the field
  const hasTextRot = await hasColumn('text_overlays', 'rotation')
  // The Text-tool look, once the worker has added its field
  const hasTextStyle = await hasColumn('text_overlays', 'style')
  const hasPhotoRot = await hasColumn('overlays', 'rotation')
  // How see-through a photo is (a brand kit's logo), once the worker has added the field
  const hasPhotoOpacity = await hasColumn('overlays', 'opacity')
  /** Degrees, clockwise, -180..180 (nothing when it isn't turned) */
  const turn = (r: unknown) => (typeof r === 'number' && isFinite(r) && Math.round(r * 10) % 3600 !== 0 ? (((r % 360) + 540) % 360) - 180 : null)
  // The clip's start and end, when dragged in the editor (bug #8)
  const range = clipRangeFrom(body.range, clip, body.trims)
  const keepsMadeRange = !!range && await hasColumn('clips', 'original_start_ms')
  const clipStart = range ? range[0] : Number(clip.start_ms), clipEnd = range ? range[1] : Number(clip.end_ms)
  // Removed parts of the video, once the database has that field (the backend adds it when it starts)
  const trims = Array.isArray(body.trims) && await hasColumn('clips', 'trim_ranges')
    ? cleanTrims(body.trims, clipStart, clipEnd)
    : null
  // The editor's note beside the rows (see SaveClipInput.layers), once the database has the field
  const layersJson = body.layers === undefined ? undefined : body.layers === null ? null : JSON.stringify(body.layers)
  const savesLayers = layersJson !== undefined && (layersJson === null || (layersJson.length < 2_000_000 && typeof body.layers === 'object'))
    && await hasColumn('clips', 'layers')
  const original = body.originalSound
  const hasOriginal = !!original && typeof original.volume === 'number' && await hasColumn('clips', 'original_volume')
  // The progress bar, once the worker has added the field
  const bar = body.progressBar === undefined ? undefined : cleanProgressBar(body.progressBar)
  const savesBar = bar !== undefined && await hasColumn('clips', 'progress_bar')
  // The brand kit switch (clips.brand, once the backend has added it). A huge `before` (thousands of
  // texts) is dropped rather than refused: the brand then comes off without putting styles back
  let brandOn = body.brand === undefined ? undefined : cleanBrandOn(body.brand)
  // (a kit the user can't use — deleted, or no longer shared with them — isn't saved as on: the clip
  // keeps its look, the switch off)
  if (brandOn) {
    const { canUseKit } = await import('./brandKits')
    if (!(await canUseKit(userId, brandOn.kit_id))) brandOn = null
  }
  const brandJson = brandOn && JSON.stringify(brandOn).length > 400_000 ? { ...brandOn, before: null } : brandOn
  const savesBrand = brandJson !== undefined && await hasColumn('clips', 'brand')

  // Transitions the database can't take yet (before the backend widens its check): saved as a
  // Dissolve, and the editor is told how many, so it can say so
  const keepsKind = (type: string) => type === 'cut' || type === 'fade' || type === 'wipe' || transitionKindOk(type)
  const asDissolve = transitions.filter(t => segIds.includes(t.after_segment_id) && !keepsKind(t.type)).length

  // Every statement is built up front and pipelined in one transaction: the database is far
  // from the server (~300–500 ms per round trip), and awaiting each statement made saves take
  // 10–20 s, long enough for the next auto-save to overlap and collide with this one.
  await sql.begin(tx => {
    const q = []

    if (segRows.length > 0) {
      q.push(hasControls ? tx`
        INSERT INTO segments ${tx(segRows)}
        ON CONFLICT (id) DO UPDATE SET start_ms = EXCLUDED.start_ms, end_ms = EXCLUDED.end_ms,
          layout = EXCLUDED.layout, sort_order = EXCLUDED.sort_order, frame = EXCLUDED.frame,
          hidden = EXCLUDED.hidden, muted = EXCLUDED.muted, locked = EXCLUDED.locked
          ${hasInsertField ? tx`, video_offset_ms = EXCLUDED.video_offset_ms` : tx``}
          ${hasSpeedField ? tx`, speed = EXCLUDED.speed, smooth = EXCLUDED.smooth, pitch = EXCLUDED.pitch` : tx``}
        WHERE segments.clip_id = ${clipId}
      ` : tx`
        INSERT INTO segments ${tx(segRows)}
        ON CONFLICT (id) DO UPDATE SET start_ms = EXCLUDED.start_ms, end_ms = EXCLUDED.end_ms,
          layout = EXCLUDED.layout, sort_order = EXCLUDED.sort_order, frame = EXCLUDED.frame
          ${hasInsertField ? tx`, video_offset_ms = EXCLUDED.video_offset_ms` : tx``}
          ${hasSpeedField ? tx`, speed = EXCLUDED.speed, smooth = EXCLUDED.smooth, pitch = EXCLUDED.pitch` : tx``}
        WHERE segments.clip_id = ${clipId}
      `)
      // Formats removed in the editor (cascades to their crop boxes and keyframes)
      q.push(tx`DELETE FROM segments WHERE clip_id = ${clipId} AND id != ALL(${segIds})`)
    }
    if (boxRows.length > 0) {
      q.push(hasControls ? tx`
        INSERT INTO crop_boxes ${tx(boxRows)}
        ON CONFLICT (id) DO UPDATE SET segment_id = EXCLUDED.segment_id, slot_index = EXCLUDED.slot_index,
          source_video_id = EXCLUDED.source_video_id, source_offset_ms = EXCLUDED.source_offset_ms,
          image_path = EXCLUDED.image_path, image_motion = EXCLUDED.image_motion,
          volume = EXCLUDED.volume, muted = EXCLUDED.muted, hidden = EXCLUDED.hidden
        WHERE crop_boxes.segment_id IN (SELECT id FROM segments WHERE clip_id = ${clipId})
      ` : tx`
        INSERT INTO crop_boxes ${tx(boxRows)}
        ON CONFLICT (id) DO UPDATE SET segment_id = EXCLUDED.segment_id, slot_index = EXCLUDED.slot_index,
          source_video_id = EXCLUDED.source_video_id, source_offset_ms = EXCLUDED.source_offset_ms,
          image_path = EXCLUDED.image_path, image_motion = EXCLUDED.image_motion,
          volume = EXCLUDED.volume, muted = EXCLUDED.muted
        WHERE crop_boxes.segment_id IN (SELECT id FROM segments WHERE clip_id = ${clipId})
      `)
      // Boxes left over from a layout with more slots (e.g. Split → Vertical)
      q.push(tx`DELETE FROM crop_boxes WHERE segment_id = ANY(${segIds}) AND id != ALL(${boxIds})`)
      q.push(tx`DELETE FROM box_keyframes WHERE box_id = ANY(${boxIds})`)
      if (keyframeRows.length > 0) q.push(tx`INSERT INTO box_keyframes ${tx(keyframeRows)}`)
    }

    // Captions on/off is saved on the caption style (enabled), so turning them off is remembered
    // and the style is kept. A database without that field yet (its backend hasn't added it)
    // keeps the old way: no style row means captions off.
    const captionEnabled = (captionStyle as Record<string, unknown>).enabled !== false
    if (!captionEnabled && !hasEnabledField) {
      q.push(tx`DELETE FROM caption_styles WHERE clip_id = ${clipId}`)
    } else if (Object.keys(captionStyle).length > 0) {
      const styleFields = ['font', 'size', 'color', 'position', 'position_y', 'animation', 'language', 'translated_from_language', 'timing_offset_ms',
        // Animated presets. Not emphasis here: it goes below, only when the editor has some.
        ...(hasPresetFields ? PRESET_STYLE_FIELDS : []),
        ...(hasTemplateField ? ['template'] : []),
        ...(hasCaptionX ? ['position_x'] : []),
        ...(hasTextCase ? ['text_case'] : [])]
      const onOff = hasEnabledField ? { enabled: captionEnabled } : {}
      const entries = Object.entries(captionStyle).filter(([k, v]) => styleFields.includes(k) && v !== undefined)
      const fields: Record<string, unknown> = Object.fromEntries(entries)
      // Capitals are yes or no (the field takes no empty value): empty is off. An editor could send it
      // empty — a brand kit taken off a clip that had no caption style yet — and every save of that
      // clip failed, shown as "Connection lost" (user, 2026-11-04)
      if ('uppercase' in fields && fields.uppercase == null) fields.uppercase = false
      // Key words: saved once the editor has them (picked by AI there, or changed in the Captions
      // panel) — never an empty copy over the ones the export picked
      const emphasis = (captionStyle as Partial<CaptionStyle>).emphasis
      if (hasEmphasisField && emphasis && typeof emphasis === 'object') {
        fields.emphasis = sql.json(emphasis as never)
      }
      // A database the backend hasn't updated yet only accepts the original animations
      if (!hasPresetFields && typeof fields.animation === 'string' && !['karaoke', 'fade', 'none'].includes(fields.animation)) {
        fields.animation = 'karaoke'
      }
      if (existingStyle?.id) {
        const set = { ...fields, ...onOff }
        if (Object.keys(set).length > 0) q.push(tx`UPDATE caption_styles SET ${tx(set)} WHERE id = ${existingStyle.id}`)
      } else {
        q.push(tx`INSERT INTO caption_styles ${tx({ clip_id: clipId, ...fields, ...onOff })}`)
      }
    }

    if (hasRemoveFillers) q.push(tx`UPDATE clips SET remove_fillers = ${body.removeFillers!} WHERE id = ${clipId}`)
    if (range) {
      q.push(tx`UPDATE clips SET start_ms = ${range[0]}, end_ms = ${range[1]} WHERE id = ${clipId}`)
      // The first move keeps where the clip was made (Reset goes back to it)
      if (keepsMadeRange) {
        q.push(tx`UPDATE clips SET original_start_ms = COALESCE(original_start_ms, ${Number(clip.start_ms)}),
          original_end_ms = COALESCE(original_end_ms, ${Number(clip.end_ms)}) WHERE id = ${clipId}`)
      }
    }
    if (trims) q.push(tx`UPDATE clips SET trim_ranges = ${trims.length ? sql.json(trims as never) : null} WHERE id = ${clipId}`)
    if (savesLayers) q.push(tx`UPDATE clips SET layers = ${body.layers ? sql.json(body.layers as never) : null} WHERE id = ${clipId}`)
    if (savesBar) q.push(tx`UPDATE clips SET progress_bar = ${bar ? sql.json(bar as never) : null} WHERE id = ${clipId}`)
    if (savesBrand) q.push(tx`UPDATE clips SET brand = ${brandJson ? sql.json(brandJson as never) : null} WHERE id = ${clipId}`)
    if (hasOriginal) {
      q.push(tx`UPDATE clips SET original_volume = ${Math.max(0, Math.min(1, original!.volume))}, original_muted = ${!!original!.muted} WHERE id = ${clipId}`)
    }

    q.push(tx`DELETE FROM text_overlays WHERE clip_id = ${clipId}`)
    if (textOverlays.length > 0) {
      q.push(tx`INSERT INTO text_overlays ${tx(textOverlays.map(({ id, text, start_ms, end_ms, x, y, font, size, color, hidden, locked, w, h, rotation, ...look }) => ({
        id, clip_id: clipId, text, start_ms: ms(start_ms), end_ms: ms(end_ms), x, y, font, size, color,
        // Box width (the text wraps inside it): a share of the frame's width, or none
        ...(hasTextW ? { w: typeof w === 'number' && w > 0 ? Math.min(1, w) : null } : {}),
        // Box height (the text sits in its middle): a share of the frame's height, or none
        ...(hasTextH ? { h: typeof h === 'number' && h > 0 ? Math.min(1, h) : null } : {}),
        ...(hasTextRot ? { rotation: turn(rotation) } : {}),
        ...(hasControls ? { hidden: !!hidden, locked: !!locked } : {}),
        ...(hasTextStyle ? { style: (st => (st ? sql.json(st as never) : null))(savedTextStyle(look)) } : {}),
      })))}`)
    }

    q.push(tx`DELETE FROM audio_tracks WHERE clip_id = ${clipId}`)
    if (audioTracks.length > 0) {
      q.push(tx`INSERT INTO audio_tracks ${tx(audioTracks.map(({ id, storage_path, start_ms, volume, duck_under_speech, offset_ms, end_ms, muted, locked, fade_in, fade_out }) => ({
        id, clip_id: clipId, storage_path, start_ms: ms(start_ms), volume, duck_under_speech,
        ...(hasFades ? { fade_in: !!fade_in, fade_out: !!fade_out } : {}),
        ...(hasControls ? {
          offset_ms: offset_ms == null ? null : ms(offset_ms), end_ms: end_ms == null ? null : ms(end_ms),
          muted: !!muted, locked: !!locked,
        } : {}),
      })))}`)
    }

    q.push(tx`DELETE FROM transitions WHERE clip_id = ${clipId}`)
    // A transition can only point at a format that still exists
    const liveTransitions = transitions.filter(t => segIds.includes(t.after_segment_id))
    if (liveTransitions.length > 0) {
      q.push(tx`INSERT INTO transitions ${tx(liveTransitions.map(({ id, after_segment_id, type, duration_ms }) => ({
        id, clip_id: clipId, after_segment_id,
        type: keepsKind(type) ? type : 'fade',
        duration_ms: ms(duration_ms),
      })))}`)
    }

    q.push(tx`DELETE FROM overlays WHERE clip_id = ${clipId}`)
    if (overlays.length > 0) {
      q.push(tx`INSERT INTO overlays ${tx(overlays.map(({ id, type, storage_path, source_video_id, source_offset_ms, x, y, w, h, start_ms, end_ms, z_index, hidden, muted, locked, rotation, opacity }) => ({
        id, clip_id: clipId, type, storage_path: storage_path ?? null,
        source_video_id: source_video_id ?? null, source_offset_ms: ms(source_offset_ms ?? 0),
        x, y, w, h, start_ms: ms(start_ms), end_ms: ms(end_ms), z_index,
        ...(hasPhotoRot ? { rotation: turn(rotation) } : {}),
        ...(hasPhotoOpacity ? { opacity: typeof opacity === 'number' && isFinite(opacity) && opacity < 0.999 ? Math.max(0.05, opacity) : null } : {}),
        ...(hasControls ? { hidden: !!hidden, muted: !!muted, locked: !!locked } : {}),
      })))}`)
    }

    return q
  })
  return { transitionsAsDissolve: asDissolve, speedNotSaved }
}

/**
 * Delete several of the user's clips at once, with their exported files. All or nothing: if any
 * id isn't one of the user's clips, or a clip is still rendering (the worker would write its
 * export afterwards), nothing is deleted.
 */
export async function deleteClips(userId: string, clipIds: unknown) {
  const { cleanIds, deleteR2Keys, MAX_BULK_DELETE, uploadsOnlyUsedBy, deleteUploads } = await import('./videos')
  const ids = cleanIds(clipIds)
  if (ids.length === 0) throw Object.assign(new Error('No clips selected'), { status: 400 })
  if (ids.length > MAX_BULK_DELETE) throw Object.assign(new Error(`You can delete up to ${MAX_BULK_DELETE} clips at a time`), { status: 400 })

  const clips = await sql`
    SELECT c.id, c.status, c.output_storage_path FROM clips c JOIN videos v ON v.id = c.video_id
    WHERE c.id = ANY(${ids}) AND v.user_id = ${userId}
  `
  if (clips.length !== ids.length) throw Object.assign(new Error('Not found'), { status: 404 })
  const rendering = clips.filter(c => c.status === 'rendering').length
  if (rendering > 0) {
    throw Object.assign(new Error(rendering === 1
      ? 'One of these clips is still rendering. Wait for it to finish, then delete it.'
      : `${rendering} of these clips are still rendering. Wait for them to finish, then delete them.`), { status: 409 })
  }

  await deleteR2Keys(clips.map(c => c.output_storage_path as string | null).filter((k): k is string => !!k))
  // Formats, captions, overlays… go with their clip (foreign keys cascade)
  // Before the rows go (it reads them); it never throws
  const { logClipEvents } = await import('./suggestionEvents')
  await logClipEvents(userId, ids, 'deleted')
  // B-roll uploaded into these clips that no other clip uses goes with them (read before the rows go)
  const uploads = await uploadsOnlyUsedBy(userId, ids)
  const songs = await sql<{ storage_path: string }[]>`
    SELECT DISTINCT storage_path FROM audio_tracks WHERE clip_id = ANY(${ids}) AND storage_path LIKE ${`audio/${userId}/%`}`
  await sql`DELETE FROM clips WHERE id = ANY(${ids})`
  await deleteUploads(uploads)
  // Songs uploaded for these clips (stored per upload; another clip can't share one)
  const stillUsed = new Set((await sql<{ storage_path: string }[]>`
    SELECT storage_path FROM audio_tracks WHERE storage_path = ANY(${songs.map(s => s.storage_path)})`).map(r => r.storage_path))
  // (a brand kit's music or sound logo stays: the kit still uses it)
  if (songs.length) {
    const kits = await sql<{ d: string }[]>`SELECT data::text AS d FROM brand_kits WHERE user_id = ${userId}`.catch(() => [])
    for (const s of songs) if (kits.some(k => k.d.includes(s.storage_path))) stillUsed.add(s.storage_path)
  }
  await deleteR2Keys(songs.map(s => s.storage_path).filter(p => !stillUsed.has(p)))
  return { deleted: ids.length }
}

export async function reeditClip(userId: string, clipId: string) {
  const [clip] = await sql`
    SELECT c.id, v.user_id FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId}
  `
  if (!clip) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if (clip.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })
  await sql`UPDATE clips SET status = 'draft', output_url = NULL WHERE id = ${clipId}`
}

const motions = ['none', 'zoom_in', 'zoom_out', 'pan_left', 'pan_right']
const hex = (v: unknown) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : undefined
/** A background colour, or 'none' (see-through: what's under it shows) */
const bgHex = (v: unknown) => v === 'none' ? 'none' : hex(v)
// Corners slider 0–100 (0 = square, saved as nothing). 's'/'m'/'l' from the first version of the
// feature become their slider values, so clips saved then keep their corners.
// Whether caption_styles has its enabled field yet (the backend adds it when it starts). Once
// it's there it stays, so a yes is remembered; a no is checked again on the next save.
let enabledFieldKnown = false
async function captionEnabledField(): Promise<boolean> {
  if (enabledFieldKnown) return true
  const rows = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'caption_styles' AND column_name = 'enabled'`.catch(() => [])
  enabledFieldKnown = rows.length > 0
  return enabledFieldKnown
}

// Hide / mute / lock fields (added by the backend with the timeline controls, all at once): same rule
let itemControlsKnown = false
async function itemControlFields(): Promise<boolean> {
  if (itemControlsKnown) return true
  const rows = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'crop_boxes' AND column_name = 'hidden'`.catch(() => [])
  itemControlsKnown = rows.length > 0
  return itemControlsKnown
}

/**
 * A dragged clip start / end from the editor, checked: inside the video, at least MIN_CLIP_MS, and
 * playing at most MAX_CLIP_MS (a clip already longer may only get shorter). Null when unchanged;
 * refused (400) when it breaks a rule.
 */
function clipRangeFrom(raw: unknown, clip: Record<string, unknown>, newTrims?: unknown): [number, number] | null {
  if (raw == null) return null
  const bad = (msg: string) => Object.assign(new Error(msg), { status: 400 })
  if (!Array.isArray(raw) || raw.length !== 2 || !raw.every(v => Number.isFinite(Number(v)))) throw bad('Invalid clip start and end')
  const start = Math.round(Number(raw[0])), end = Math.round(Number(raw[1]))
  const oldStart = Number(clip.start_ms), oldEnd = Number(clip.end_ms)
  if (start === oldStart && end === oldEnd) return null
  // Back to where the clip was made (Reset): always allowed, however long it was
  if (clip.original_start_ms != null && start === Number(clip.original_start_ms) && end === Number(clip.original_end_ms)) return [start, end]
  const videoLen = Number(clip.video_duration_ms) || 0
  if (start < 0 || (videoLen > 0 && end > videoLen + 50)) throw bad('The clip can\u2019t reach past its video')
  const played = (t: unknown, a: number, b: number) => trimMap(cleanTrims(t, a, b), a, b).lengthMs
  const len = played(Array.isArray(newTrims) ? newTrims : clip.trim_ranges, start, end)
  if (len < MIN_CLIP_MS) throw bad('A clip must be at least 1 second long')
  if (len > Math.max(MAX_CLIP_MS, played(clip.trim_ranges, oldStart, oldEnd)) + 50) throw bad('A clip can be up to 5 minutes long')
  return [start, Math.min(end, videoLen > 0 ? videoLen : end)]
}

// Columns the backend adds when it starts (remembered once seen): saving works before and after
const knownColumns = new Set<string>()
export async function hasColumn(table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`
  if (knownColumns.has(key)) return true
  const rows = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = ${table} AND column_name = ${column}`.catch(() => [])
  if (rows.length) knownColumns.add(key)
  return rows.length > 0
}

/**
 * Which kinds transitions.type takes: the backend widens the table's check when it starts (its
 * index.ts), so a kind the editor offers may not be allowed yet (the trending ones, until the
 * backend that knows them has started). Before that, only cut / fade / wipe are sure to save —
 * anything else would fail the whole save, so it goes in as a Dissolve. Looked up again every
 * minute until every kind is allowed.
 */
let transitionCheck: { def: string | null; at: number } | null = null
const ALL_TRANSITION_KINDS = ['pixelize', 'velocity', 'zoomout', 'swipeup', 'shake', 'glitch', 'flare', 'spin', 'warp']
export async function transitionKindsAllowed(): Promise<(type: string) => boolean> {
  const fresh = transitionCheck && (Date.now() - transitionCheck.at < 60_000
    || (transitionCheck.def !== null && ALL_TRANSITION_KINDS.every(k => transitionCheck!.def!.includes(`'${k}'`))))
  if (!fresh) {
    const rows = await sql`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'transitions'::regclass AND conname = 'transitions_type_check'`.catch(() => null)
    // (no check at all takes every kind; a failed lookup: only the sure ones)
    transitionCheck = rows === null ? { def: '', at: Date.now() } : { def: rows.length === 0 ? null : String(rows[0].def), at: Date.now() }
  }
  const def = transitionCheck!.def
  return (type: string) => def === null || def.includes(`'${type}'`)
}

// clips.remove_fillers (added by the backend with "Remove pauses and filler words"): same rule
let removeFillersKnown = false
export async function clipsHasRemoveFillers(): Promise<boolean> {
  if (removeFillersKnown) return true
  const rows = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'clips' AND column_name = 'remove_fillers'`.catch(() => [])
  removeFillersKnown = rows.length > 0
  return removeFillersKnown
}

// Caption preset fields (added by the backend with the presets): same remember-a-yes rule
const PRESET_STYLE_FIELDS = ['highlight_color', 'words_per_line', 'uppercase', 'stroke_width']
let presetFieldsKnown = false
async function captionPresetFields(): Promise<boolean> {
  if (presetFieldsKnown) return true
  const rows = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'caption_styles' AND column_name = 'highlight_color'`.catch(() => [])
  presetFieldsKnown = rows.length > 0
  return presetFieldsKnown
}

const OLD_CORNERS: Record<string, number> = { s: 35, m: 60, l: 100 }
const corner = (v: unknown): CornerStyle | undefined => {
  const n = typeof v === 'string' ? OLD_CORNERS[v] : v
  return typeof n === 'number' && isFinite(n) && n > 0 ? Math.round(Math.min(100, n)) : undefined
}
// Per-slot settings keyed "0"–"2"; anything else is dropped
function slotMap<T>(m: unknown, pick: (v: unknown) => T | undefined): Record<string, T> | undefined {
  if (!m || typeof m !== 'object') return undefined
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(m)) { const p = pick(v); if (/^[0-3]$/.test(k) && p !== undefined) out[k] = p }
  return out
}
const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined

// B-roll Make my clips laid: its search and the stock videos it chose from (for the editor's Swap) —
// at most 8, each a stock library's own video (the links importStock accepts), and which one it shows
const STOCK_REF = /^((pixabay|pexels):\d+|coverr:[A-Za-z0-9_-]{1,64})$/
const STOCK_HOST = /(^|\.)(pixabay\.com|pexels\.com|coverr\.co)$/
export function cleanBroll(b: unknown): BrollPick | null {
  const x = b as Partial<BrollPick> | null | undefined
  if (!x || !Array.isArray(x.alts)) return null
  const host = (u: unknown) => { try { return typeof u === 'string' ? new URL(u).hostname : '' } catch { return '' } }
  const alts: BrollAlt[] = x.alts.slice(0, 8).flatMap((a): BrollAlt[] => {
    if (!a || typeof a.ref !== 'string' || !STOCK_REF.test(a.ref) || !STOCK_HOST.test(host(a.url))) return []
    const text = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '')
    const link = (v: unknown) => (STOCK_HOST.test(host(v)) ? text(v, 600) : '')
    return [{
      ref: a.ref, provider: text(a.provider, 16), title: text(a.title, 120), thumb: link(a.thumb), preview: link(a.preview), url: text(a.url, 600),
      width: Math.round(num(a.width, 0, 10000) ?? 0), height: Math.round(num(a.height, 0, 10000) ?? 0), duration: Math.round(num(a.duration, 0, 36000) ?? 0),
    }]
  })
  if (!alts.length) return null
  return { query: typeof x.query === 'string' ? x.query.slice(0, 100) : '', alts, at: Math.round(num(x.at, 0, alts.length - 1) ?? 0) }
}

// Keep only what a frame needs from the client: known fields, sane values, and never the
// preview-only signed image URLs (they expire; the editor signs fresh ones on load)
function cleanFrame(frame: FrameSettings): FrameSettings {
  // A media box inside its slot (resized / moved), or nothing when it fills the slot
  const rectOf = (r: unknown) => {
    const q = r as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | null | undefined
    const x = num(q?.x, 0, 1), y = num(q?.y, 0, 1), w = num(q?.w, 0.05, 1), h = num(q?.h, 0.05, 1)
    const r3 = (v: number) => Math.round(v * 1000) / 1000
    return x !== undefined && y !== undefined && w !== undefined && h !== undefined ? { rect: { x: r3(x), y: r3(y), w: r3(w), h: r3(h) } } : {}
  }
  const items: FrameItem[] = (frame.items ?? []).slice(0, 300).flatMap((it): FrameItem[] => {
    if (!it || typeof it.id !== 'string' || !['video', 'photo', 'text'].includes(it.kind)) return []
    // A slot (0–3), the band, or a frame's second text area
    const lane = it.lane === 'band' || it.lane === 'band2' ? it.lane : num(it.lane, 0, 3)
    const start = num(it.start_ms, 0, 1e9), end = num(it.end_ms, 0, 1e9)
    if (lane === undefined || start === undefined || end === undefined || end <= start) return []
    const base: FrameItem = { id: it.id.slice(0, 64), lane: typeof lane === 'string' ? lane : Math.round(lane), kind: it.kind, start_ms: Math.round(start), end_ms: Math.round(end), ...(it.hidden ? { hidden: true } : {}), ...(it.locked ? { locked: true } : {}) }
    if (it.kind === 'video') {
      if (typeof it.source_video_id !== 'string') return []
      const broll = cleanBroll(it.broll)
      return [{ ...base, source_video_id: it.source_video_id, source_offset_ms: Math.round(num(it.source_offset_ms, 0, 1e9) ?? 0), volume: num(it.volume, 0, 1) ?? 1, muted: !!it.muted, corners: corner(it.corners), ...rectOf(it.rect), ...(broll ? { broll } : {}) }]
    }
    if (it.kind === 'photo') {
      if (typeof it.image_path !== 'string') return []
      return [{ ...base, image_path: it.image_path, motion: it.motion && motions.includes(it.motion) ? it.motion : 'none', corners: corner(it.corners), ...rectOf(it.rect) }]
    }
    return [{
      ...base, text: typeof it.text === 'string' ? it.text.slice(0, 500) : '', captions: !!it.captions,
      bg: bgHex(it.bg), color: hex(it.color), size: num(it.size, 16, 200),
      x: num(it.x, 0, 1), y: num(it.y, 0, 1), w: num(it.w, 0.05, 1), h: num(it.h, 0.01, 1),
      ...(typeof it.rotation === 'number' && isFinite(it.rotation) && Math.round(it.rotation * 10) % 3600 !== 0
        ? { rotation: Math.round(((((it.rotation % 360) + 540) % 360) - 180) * 10) / 10 } : {}),
    }]
  })
  return {
    band: frame.band ? {
      text: '', bg: bgHex(frame.band.bg) ?? '#000000', color: hex(frame.band.color) ?? '#ffffff',
      size: num(frame.band.size, 16, 200) ?? 64, font: null,
    } : undefined,
    main_slots: Array.isArray(frame.main_slots) ? [...new Set(frame.main_slots.filter(i => Number.isInteger(i) && i >= 0 && i <= 3))] : undefined,
    main_volume: num(frame.main_volume, 0, 1),
    main_muted: frame.main_muted === undefined ? undefined : !!frame.main_muted,
    main_under: frame.main_under ? true : undefined,
    // The main video's box in its slot, when resized / moved
    main_rects: frame.main_rects && typeof frame.main_rects === 'object'
      ? Object.fromEntries(Object.entries(frame.main_rects).flatMap(([k, r]) => {
          const x = num(r?.x, 0, 1), y = num(r?.y, 0, 1), w = num(r?.w, 0.05, 1), h = num(r?.h, 0.05, 1)
          return /^[0-3]$/.test(k) && x !== undefined && y !== undefined && w !== undefined && h !== undefined
            ? [[k, { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, w: Math.round(w * 1000) / 1000, h: Math.round(h * 1000) / 1000 }]] : []
        }))
      : undefined,
    // Resized rows (at most 4 in a template); the export checks they fit the frame's template
    row_h: Array.isArray(frame.row_h) && frame.row_h.length >= 2 && frame.row_h.length <= 4 && frame.row_h.every(h => typeof h === 'number' && h >= 0.03 && h <= 1)
      ? frame.row_h.map(h => Math.round(h * 1000) / 1000) : undefined,
    // The bar's swap: the rows' order, a reordering of the template's rows (0..n-1, each once)
    row_order: Array.isArray(frame.row_order) && frame.row_order.length >= 2 && frame.row_order.length <= 4
      && frame.row_order.every(i => Number.isInteger(i) && i >= 0 && i < frame.row_order!.length) && new Set(frame.row_order).size === frame.row_order.length
      ? [...frame.row_order] : undefined,
    // A free frame's bar and its moved area (the face cam's circle): shares of the frame
    split: num(frame.split, 0, 1),
    split2: num(frame.split2, 0, 1),
    flip: frame.flip === true ? true : undefined,
    flip2: frame.flip2 === true ? true : undefined,
    // A Branded card's own look (lib/shared/brandCard.ts)
    card: frame.card && typeof frame.card === 'object' ? cleanCardLook(frame.card) : undefined,
    // The frame's own background (a colour, gradient or pattern)
    bg: frame.bg && typeof frame.bg === 'object' ? cleanFrameBackground(frame.bg) : undefined,
    face_box: frame.face_box && typeof frame.face_box === 'object' && [frame.face_box.x, frame.face_box.y, frame.face_box.w].every(v => typeof v === 'number' && isFinite(v))
      ? { x: num(frame.face_box.x, 0, 1)!, y: num(frame.face_box.y, 0, 1)!, w: num(frame.face_box.w, 0.05, 1)! } : undefined,
    main_volumes: slotMap(frame.main_volumes, v => num(v, 0, 1)),
    main_mutes: slotMap(frame.main_mutes, v => typeof v === 'boolean' ? v : undefined),
    main_hidden: slotMap(frame.main_hidden, v => (v === true ? true : undefined)),
    main_locked: slotMap(frame.main_locked, v => (v === true ? true : undefined)),
    main_corners: frame.main_corners && typeof frame.main_corners === 'object'
      // (0 is kept: square on purpose — dropped, the slot would take the next frame's default)
      ? Object.fromEntries(Object.entries(frame.main_corners).filter(([k, v]) => /^[0-3]$/.test(k) && (v === 0 || corner(v))).map(([k, v]) => [k, v === 0 ? 0 : corner(v)!]))
      : undefined,
    items,
  }
}

/**
 * Writes the clip's hook, title, post caption and hashtags again (Gemini, src/lib/clipText.ts)
 * and saves them. The hook text overlay already on the clip is left as the user has it.
 */
export async function regenerateClipText(userId: string, clipId: string) {
  const [clip] = await sql`
    SELECT c.id, c.start_ms, c.end_ms, c.video_id, v.user_id, v.title AS video_title
    FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId}
  `
  if (!clip) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if (clip.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })
  const { aiProvider, askGemini } = await import('@/lib/gemini')
  if (!aiProvider()) throw Object.assign(new Error('AI text is not configured'), { status: 500 })

  const [transcript] = await sql`SELECT id FROM transcripts WHERE video_id = ${clip.video_id} ORDER BY created_at DESC LIMIT 1`
  const words = transcript
    ? await sql<{ word: string; start_ms: number; end_ms: number }[]>`
        SELECT word, start_ms, end_ms FROM transcript_words
        WHERE transcript_id = ${transcript.id} AND start_ms >= ${clip.start_ms} AND start_ms < ${clip.end_ms}
        ORDER BY start_ms`
    : []
  if (!words.length) throw Object.assign(new Error('This clip has no captions yet, so there is nothing to write from'), { status: 400 })

  const { generateClipText } = await import('@/lib/clipText')
  // The brand's words (brand kit Phase 5): names spelled its way, its tone, words it hides, its
  // hashtags and closing line — rules on the one call made anyway, nothing more paid for
  const { brandWordsFor } = await import('./brandKits')
  const { brandCaptionWords, brandClipText, brandVoice } = await import('@/lib/brandWords')
  const brandWords = await brandWordsFor(userId, clipId)
  let text
  try {
    text = brandClipText(await generateClipText(brandCaptionWords(words, brandWords), clip.video_title ?? null, prompt => askGemini(prompt), 'roman', brandVoice(brandWords)), brandWords)
  } catch (e) {
    console.error('[ai-text] Gemini error:', e)
    throw Object.assign(new Error('AI could not write the text right now. Try again in a moment.'), { status: 502 })
  }
  const [hasColumns] = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'clips' AND column_name = 'post_caption'`
  if (!hasColumns) throw Object.assign(new Error('AI text needs the latest backend. Try again after it restarts.'), { status: 503 })
  await sql`
    UPDATE clips SET title = ${text.title}, hook_text = ${text.hook}, post_caption = ${text.post_caption}, hashtags = ${text.hashtags}
    WHERE id = ${clipId}
  `
  return text
}
