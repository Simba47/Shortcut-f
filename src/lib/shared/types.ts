import type { CardLook, FrameBackground } from './brandCard'

// ─── Domain types mirroring the database schema ───────────────────────────────

export type VideoStatus = 'uploaded' | 'transcribing' | 'ready' | 'failed'
export type ClipStatus = 'draft' | 'rendering' | 'done' | 'failed'
export type JobType = 'transcribe' | 'render'
export type JobStatus = 'queued' | 'processing' | 'done' | 'failed'
export type SourceType = 'upload' | 'link'
export type FrameLayout = 'frame_single' | 'frame_video_photo' | 'frame_dual' | 'frame_dual_letterbox' | 'frame_triple'
  | 'frame_title_caption' | 'frame_big_small' | 'frame_photo_story'
  | 'frame_blur_fill' | 'frame_gameplay' | 'frame_pip' | 'frame_screenshot' | 'frame_comment' | 'frame_letterbox_wide'
  | 'frame_two_crops' | 'frame_side_by_side' | 'frame_name_tags' | 'frame_brand_card' | 'frame_top_list'
  | 'frame_screen_face' | 'frame_audiogram' | 'frame_grid' | 'frame_news' | 'frame_trio_main'
export type LayoutType = 'vertical' | 'split' | 'trio' | 'spotlight' | 'centered' | 'horizontal' | FrameLayout
/** How a photo slot moves over its format's duration */
export type SlotMotion = 'none' | 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right'

/** Letterbox band of a frame: a solid strip holding text */
export interface FrameBand {
  text: string
  bg: string
  color: string
  /** Font size in px at 1080 wide */
  size: number
  font?: string | null
}

/** Rounded corners on a video/photo in a frame slot, 0–100: 0 = square edge to edge; more = rounder corners and a wider black border */
export type CornerStyle = number

/** A lane of a frame: one of its media slots (0 = top) or the letterbox band */
/** A media slot (0–3), the text band, or a frame's second text area (a name tag, a badge, a ticker) */
export type FrameLane = number | 'band' | 'band2'
export type FrameItemKind = 'video' | 'photo' | 'text'

/**
 * Something placed on a frame lane for part of the format's time. A lane can hold several items
 * one after another (a slideshow); they never overlap. Times are clip time, like text overlays,
 * and anything outside the format's own range isn't shown.
 */
export interface FrameItem {
  id: string
  lane: FrameLane
  kind: FrameItemKind
  start_ms: number
  end_ms: number
  // Video: another uploaded video, starting at source_offset_ms at start_ms (loops if shorter)
  source_video_id?: string | null
  source_offset_ms?: number
  /** This video's share in the audio mix (0–1) */
  volume?: number
  /** Video: B-roll Make my clips laid (the worker's lib/broll.ts) — what it searched for, the stock videos
   *  it looked at (the editor's Swap shows the others) and which of them this is */
  broll?: BrollPick | null
  muted?: boolean
  /** Not shown (or heard) in the preview or the export */
  hidden?: boolean
  /** Can't be moved, trimmed, cut, changed or deleted until unlocked */
  locked?: boolean
  /** Video / photo: its box inside its slot when resized / moved (shares of the slot; absent = the whole slot) */
  rect?: { x: number; y: number; w: number; h: number } | null
  // Photo
  image_path?: string | null
  /** Signed URL for image_path — preview only, never saved */
  image_url?: string | null
  motion?: SlotMotion | null
  /** Video/photo: rounded corners with a black border around it */
  corners?: CornerStyle
  // Text (a card in a slot, or text on the band)
  text?: string
  bg?: string
  color?: string
  size?: number
  font?: string | null
  /** Text: where its centre sits in its band/slot, as shares of the row (default 0.5, 0.5 = centred) */
  x?: number
  y?: number
  /** Text: its box's width as a share of the frame's (the text wraps inside it; absent = 0.88) */
  w?: number
  /** Text: its box's height as a share of the frame's, when made taller than its lines (the text stays in its middle) */
  h?: number
  /** Text: turned this many degrees clockwise round its centre */
  rotation?: number | null
  /** Band only: show the clip's captions here instead of fixed text */
  captions?: boolean
}

/** A stock video B-roll was picked from (as the stock search lists it: server/services/stock.ts StockItem) */
export interface BrollAlt {
  ref: string; provider: string; title: string
  thumb: string; preview: string; url: string
  width: number; height: number; duration: number
}
export interface BrollPick { query: string; alts: BrollAlt[]; at: number }

/** Extra settings of a format that uses a frame layout */
export interface FrameSettings {
  /** The band's look when nothing is on it, and the default style for new text */
  band?: FrameBand
  /** Slots that show the main video underneath their items (default: the top slot) */
  main_slots?: number[]
  /** The main video's sound in this frame (older frames; see main_volumes) */
  main_volume?: number
  main_muted?: boolean
  /** Sound of the main video in each slot that shows it, by slot index — each slot is set on its own */
  main_volumes?: Record<string, number>
  main_mutes?: Record<string, boolean>
  /** The main video hidden in a slot (its lane's eye: what's under it shows; its sound still plays unless muted), by slot index */
  main_hidden?: Record<string, boolean>
  /** The main video locked in a slot (its lane's lock: its box can't be moved, nor it taken out), by slot index */
  main_locked?: Record<string, boolean>
  /** Rounded corners of the main video, per slot index */
  main_corners?: Record<string, CornerStyle>
  /** The main video is heard under the frame though no slot shows it (Photo Story), at main_volume */
  main_under?: boolean
  /** Heights of the frame's rows (one per template row, shares of the frame) when resized; absent = the template's */
  row_h?: number[] | null
  /** The rows' order top to bottom (template row numbers) when swapped with the bar's swap; absent = the template's */
  row_order?: number[] | null
  /** A free frame's bar (Side by side, Screen + face cam): where it was dragged (share of the frame); absent = the template's */
  split?: number | null
  /** A free frame's second bar (Trio with main: between Left and Right): where it was dragged; absent = the template's */
  split2?: number | null
  /** A free frame's bar swapped (Trio with main: the Main below, the pair on top) — the frame mirrored across that way */
  flip?: boolean | null
  /** Its second bar swapped (Trio with main: Left and Right traded) */
  flip2?: boolean | null
  /** A free frame's movable area (the face cam's circle) once placed: its top-left and width (shares of the frame; it keeps its shape) */
  face_box?: { x: number; y: number; w: number } | null
  /** The main video's box inside its slot when resized / moved, per slot index: shares of the slot (absent = the whole slot) */
  main_rects?: Record<string, { x: number; y: number; w: number; h: number }>
  /** A Branded card's own look (its background and where its video, title and @handle sit: brandCard.ts); absent = the template's */
  card?: CardLook | null
  /** The frame's own background behind and around its videos (a colour, gradient or pattern: brandCard.ts); absent = the template's */
  bg?: FrameBackground | null
  items?: FrameItem[]
}
export type AnimationType = 'karaoke' | 'fade' | 'none'
  // Animated presets (render.py _preset_events, VideoPreview drawPresetCaptions)
  | 'pop' | 'highlight' | 'bounce' | 'word' | 'hormozi' | 'box' | 'glow'
/**
 * How one section gives way to the next (transitions.type). The names are ffmpeg's xfade
 * transitions, which the export draws them with (render.py), except the two older ones: 'fade' (a
 * dissolve) and 'wipe' (= wipeleft). 'cut': none.
 */
export type TransitionType = 'cut' | 'fade' | 'wipe' | 'fadeblack' | 'fadewhite' | 'slideleft' | 'slideup' | 'zoomin' | 'circleopen'
  | 'slideright' | 'slidedown' | 'smoothleft' | 'hblur' | 'radial' | 'pixelize'
  // Trending (drawn by render.py's custom expressions, and swipeup as a smeared slideup)
  | 'velocity' | 'zoomout' | 'swipeup' | 'shake' | 'glitch' | 'flare' | 'spin' | 'warp'

export interface Video {
  id: string
  user_id: string
  title: string | null
  source_type: SourceType
  source_url: string | null
  storage_path: string | null
  duration_ms: number | null
  status: VideoStatus
  download_progress: number
  created_at: string
}

export interface Transcript {
  id: string
  video_id: string
  language: string | null
  created_at: string
}

export interface TranscriptWord {
  id: string
  transcript_id: string
  word: string
  word_roman: string | null
  start_ms: number
  end_ms: number
  speaker_id: string | null
  confidence: number | null
}

export interface Clip {
  id: string
  video_id: string
  start_ms: number
  end_ms: number
  aspect_ratio: string
  status: ClipStatus
  output_url: string | null
  output_storage_path: string | null
  created_at: string
}

export interface Segment {
  id: string
  clip_id: string
  start_ms: number
  end_ms: number
  layout: LayoutType
  sort_order: number
  /** Frame layouts only: letterbox band settings */
  frame?: FrameSettings | null
  /** Editor controls: not shown or exported / silent / can't be moved, trimmed or deleted */
  hidden?: boolean
  muted?: boolean
  locked?: boolean
  /**
   * An inserted video (modules/editor/inserts.ts): where the main video stands still while it
   * plays (clip-relative ms of the main video). Null for every other section.
   */
  video_offset_ms?: number | null
  /**
   * How fast this part plays its stretch of the main video (1 = as filmed, 0.5 = slow motion,
   * 2 = twice as fast). It lasts its video's length ÷ speed on the timeline (inserts.ts).
   */
  speed?: number | null
  /** Slow motion made smooth in the export (new in-between frames) */
  smooth?: boolean | null
  /** The sound's pitch changes with the speed (higher when faster); off: the voice stays natural */
  pitch?: boolean | null
}

export interface CropBox {
  id: string
  segment_id: string
  slot_index: number
  /** null = the clip's main video */
  source_video_id: string | null
  /** Main video: where in it this format starts. Other video: where in that video to start. */
  source_offset_ms: number
  /** Frame slots: a photo instead of a video (storage path) */
  image_path?: string | null
  /** Signed URL for image_path — preview only, never saved */
  image_url?: string | null
  image_motion?: SlotMotion | null
  /** Frame slots: this video's share in the audio mix (0–1) */
  volume?: number
  muted?: boolean
  /** An added video (B-roll) hidden: the main video shows there instead */
  hidden?: boolean
}

export interface BoxKeyframe {
  id: string
  box_id: string
  t_ms: number
  x: number
  y: number
  w: number
  h: number
}

export interface CaptionStyle {
  id: string
  clip_id: string
  font: string | null
  size: number | null
  color: string | null
  position: string | null
  position_y: number | null
  /** Where the captions are centred left to right, 0–1 of the width (dragged on the preview); null = the middle */
  position_x?: number | null
  animation: AnimationType
  /** Letters the captions are shown in: 'roman' = English letters (e.g. Tenglish); 'auto'/null = the spoken language's own script */
  language: string | null
  translated_from_language: string | null
  timing_offset_ms: number | null
  /** Captions switched on for this clip (false = the user turned them off) */
  enabled?: boolean
  /** Presets: colour of the spoken / emphasised word (the box, for 'highlight') */
  highlight_color?: string | null
  /** Presets: words per caption line (null = the preset's own: 3 for highlight, 5 otherwise) */
  words_per_line?: number | null
  /** Capital letters (only changes Latin text) */
  uppercase?: boolean
  /** The case the words are written in (the editor's Aa buttons): null = saved before it (UPPER when uppercase, else Title) */
  text_case?: 'title' | 'upper' | 'lower' | null
  /** Presets: outline thickness in px at 1080 wide */
  stroke_width?: number | null
  /** Words the AI marked important, keyed by the word's start_ms; set by the export */
  emphasis?: Record<string, boolean> | null
  /**
   * The caption style picked (modules/captions/templates.ts: a preset in its own font and look);
   * null = none. `animation` then holds its base preset, drawn where templates aren't known.
   */
  template?: string | null
}

export interface TextOverlay {
  id: string
  clip_id: string
  text: string
  start_ms: number
  end_ms: number
  x: number | null
  y: number | null
  font: string | null
  size: number | null
  color: string | null
  /** Editor controls: not shown or exported / can't be moved, trimmed or deleted */
  hidden?: boolean
  locked?: boolean
  /** Editor: the timeline track it is on (shared with videos and photos; tracks.ts). Saved in clips.layers. */
  track?: number
  /**
   * Width of the text box, as a share of the frame's width (dragged on the preview): the text
   * wraps inside it. Unset = one line per line typed (no wrapping).
   */
  w?: number | null
  /**
   * Height of the text box, as a share of the frame's height (dragged on the preview): the text
   * keeps its size and sits in the middle of the box. Never smaller than the text. Unset = as tall
   * as the text.
   */
  h?: number | null
  // ── Text styling (Text tool). All optional: older text keeps its look.
  // TODO(backend): save these with the text and draw them in the export.
  /** 400 regular · 700 bold · 900 black (default 700) */
  weight?: number
  italic?: boolean
  /** Show the text in capitals */
  uppercase?: boolean
  /** Extra space between letters, px at 1080 wide (default 0) */
  letter_spacing?: number
  /** 0–1 (default 1) */
  opacity?: number
  /** Degrees, around the text's centre (default 0) */
  rotation?: number
  /** Outline round the letters (null/absent = none) */
  stroke_color?: string | null
  /** Outline thickness, px at 1080 wide */
  stroke_width?: number
  /** A box behind the text (null/absent = none) */
  bg_color?: string | null
  /** 0–1 */
  bg_opacity?: number
  /** Box corner roundness, px at 1080 wide */
  bg_radius?: number
  /** none · soft (blurred) · hard (solid offset) · glow (coloured halo) */
  shadow?: 'none' | 'soft' | 'hard' | 'glow'
  /** Colour of the hard shadow or the glow */
  shadow_color?: string | null
  /** How the text comes in ('slide' = slide up) */
  animation?: 'none' | 'fade' | 'pop' | 'zoom-in' | 'zoom-out' | 'blur'
    | 'slide' | 'slide-down' | 'slide-left' | 'slide-right' | 'drop' | 'bounce'
    | 'typewriter' | 'wipe' | 'spin' | 'flicker' | 'glitch'
}

export interface AudioTrack {
  id: string
  clip_id: string
  storage_path: string
  start_ms: number
  volume: number
  duck_under_speech: boolean
  /** Trimmed music: how far into the song this track starts playing (default 0) */
  offset_ms?: number
  /** Trimmed music: clip time where this track stops (default: when the song ends) */
  end_ms?: number
  /** The fade-in / fade-out buttons (0.5 s each, in the preview and the export) */
  fade_in?: boolean
  fade_out?: boolean
  /** Editor controls: silent / can't be moved, trimmed or deleted */
  muted?: boolean
  locked?: boolean
  /** Editor: the audio track it is on (tracks.ts). Saved in clips.layers. */
  track?: number
}

export interface Transition {
  id: string
  clip_id: string
  after_segment_id: string
  type: TransitionType
  duration_ms: number
}

export interface Job {
  id: string
  type: JobType
  payload: Record<string, unknown>
  status: JobStatus
  error: string | null
  created_at: string
  updated_at: string
}

// ─── Render payload shapes ─────────────────────────────────────────────────────

export interface TranscribeJobPayload {
  video_id: string
  storage_path: string
  language_code?: string
  is_retranscribe?: boolean
  // When set, only the clip's audio range is transcribed (clip-level transcription)
  clip_id?: string
  clip_start_ms?: number
  clip_end_ms?: number
}

export type RenderQuality = '480p' | '720p' | '1080p' | '2160p'

export interface RenderJobPayload {
  clip_id: string
  video_storage_path: string
  quality?: RenderQuality
}

export interface Overlay {
  id: string
  clip_id: string
  type: 'image' | 'video'
  storage_path: string | null
  preview_url?: string
  source_video_id: string | null
  source_offset_ms: number
  x: number
  y: number
  w: number
  h: number
  start_ms: number
  end_ms: number
  z_index: number
  created_at: string
  /** Editor controls: not shown or exported / silent / can't be moved, trimmed or deleted */
  hidden?: boolean
  muted?: boolean
  locked?: boolean
  /** Editor: the timeline track a photo is on (shared with videos and text; tracks.ts). Saved in clips.layers. */
  track?: number
  /** Degrees, clockwise, round the box's middle (its rotate handle on the preview) */
  rotation?: number | null
  /** How see-through it is, 0–1 (a brand kit's logo; absent = solid) */
  opacity?: number | null
}

// ─── Editor state (client-only, not persisted as a single blob) ────────────────

export interface BoxKeyframeLocal extends Omit<BoxKeyframe, 'id' | 'box_id'> {}

export interface CropBoxLocal extends Omit<CropBox, 'segment_id'> {
  keyframes: BoxKeyframeLocal[]
}

export interface SegmentLocal extends Omit<Segment, 'id' | 'clip_id'> {
  id: string
  crop_boxes: CropBoxLocal[]
  /** Preview only (shownSegment): a hidden added video whose sound is on — heard, not seen */
  sound_only?: { video_id: string; offset_ms: number; volume?: number }
  /** Editor only: a video on top the user added as B-roll (uploaded in the B-roll panel). Stock footage is B-roll anyway. */
  lane?: 'broll'
  /** A video on top: the timeline track it is on (shared with photos and text; tracks.ts). A higher track is shown over a lower one. */
  track?: number
}

// ─── Layout slot counts ────────────────────────────────────────────────────────

export const LAYOUT_SLOT_COUNT: Record<LayoutType, number> = {
  vertical: 1,
  split: 2,
  trio: 3,
  spotlight: 1,
  centered: 1,
  horizontal: 1,
  frame_single: 1,
  frame_video_photo: 2,
  frame_dual: 2,
  frame_dual_letterbox: 2,
  frame_triple: 3,
  frame_title_caption: 1,
  frame_big_small: 2,
  frame_photo_story: 2,
  frame_blur_fill: 1,
  frame_gameplay: 2,
  frame_pip: 2,
  frame_screenshot: 2,
  frame_comment: 1,
  frame_letterbox_wide: 1,
  frame_two_crops: 2,
  frame_side_by_side: 2,
  frame_name_tags: 2,
  frame_brand_card: 1,
  frame_top_list: 1,
  frame_screen_face: 2,
  frame_audiogram: 1,
  frame_grid: 4,
  frame_news: 1,
  frame_trio_main: 3,
}
