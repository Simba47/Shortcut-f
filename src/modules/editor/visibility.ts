import type { SegmentLocal, CropBoxLocal } from '@chai-cut/shared'
import { isFrameLayout } from './frames'
import { defaultCropForSlot } from './utils'
import { inFramePicture } from './framePicture'

/**
 * A part of the main video moved off the main row onto a row above or below it (as in Resolve):
 * a video on a row like any other, showing the main video itself from its own moment (its box
 * names the main video, source_offset_ms in the video's own time). One picture, never a frame,
 * a split or a trio (a borrowed reaction slot is one of those: brollSources.ts). shots.ts makes it
 * a part of the main video again where it plays, so the main player plays it, sound and all.
 */
export function isMainShot(seg: SegmentLocal, mainVideoId: string | null | undefined): boolean {
  const box = seg.crop_boxes[0]
  return !!mainVideoId && box?.source_video_id === mainVideoId && seg.crop_boxes.length === 1 && seg.video_offset_ms == null
    && !isFrameLayout(seg.layout) && seg.layout !== 'split' && seg.layout !== 'trio'
}

/** The video added over the main video in a section (B-roll / an inserted video / a part of the main video on a row), if any: its crop box */
export function addedVideoBox(seg: SegmentLocal, mainVideoId: string | null | undefined): CropBoxLocal | null {
  const box = seg.crop_boxes[0]
  return !isFrameLayout(seg.layout) && box?.source_video_id && (box.source_video_id !== mainVideoId || isMainShot(seg, mainVideoId)) ? box : null
}

/**
 * A gap in the main row: a part of the main video deleted in the editor. It keeps its place and
 * time and nothing after it moves; nothing of the main video is in it (black and silent: what's
 * on top or below plays there). Saved as the part hidden and muted with its picture box hidden
 * too — a main-video box is never hidden otherwise (the eye switches the part), so the switches
 * can't bring it back. The timeline draws it empty; it closes when the part after it is dragged
 * into it, or when it is deleted again (EditorShell askDeleteFormat / movePart).
 */
export function isGapPart(seg: SegmentLocal, mainVideoId: string | null | undefined): boolean {
  return !!seg.hidden && !!seg.muted && !!seg.crop_boxes[0]?.hidden && !isFrameLayout(seg.layout) && !addedVideoBox(seg, mainVideoId)
}

/** Crop box id of the main video standing in for a hidden added video (default framing) */
export const STAND_IN_SUFFIX = ':main'

/**
 * A section as the preview and the export show it (render.ts does the same):
 *  - an added video shows unless it's hidden; hidden, the main video shows there (default framing).
 *    Its sound is its own switch: on, it's heard (instead of the main video's) even while hidden
 *  - hidden photos, videos and text in a frame aren't shown
 *  - `hidden` stays on only where the main video itself shows and is hidden — painted black
 */
export function shownSegment(seg: SegmentLocal, mainVideoId: string | null | undefined, videoAR?: number): SegmentLocal {
  const box = addedVideoBox(seg, mainVideoId)
  if (box && !box.hidden) return seg.hidden ? { ...seg, hidden: false } : seg
  if (box) {
    return {
      ...seg,
      ...(box.muted === false && box.source_video_id
        ? { sound_only: { video_id: box.source_video_id, offset_ms: box.source_offset_ms ?? 0, volume: box.volume } } : {}),
      crop_boxes: [{
        ...box, id: `${box.id}${STAND_IN_SUFFIX}`, source_video_id: null, source_offset_ms: seg.start_ms, muted: false, hidden: false,
        // (the main video as filmed: the added video's mirror and turn aren't its)
        mirror: undefined, turn: undefined,
        keyframes: [{ t_ms: seg.start_ms, ...inFramePicture(defaultCropForSlot('vertical', 0, videoAR)) }],
      }],
    }
  }
  if (isFrameLayout(seg.layout)) {
    const items = seg.frame?.items
    // Hidden items aren't drawn; a hidden video with its sound on stays (heard, not seen)
    const shown = items?.some(i => i.hidden) ? { ...seg, frame: { ...seg.frame!, items: items.filter(i => !i.hidden || (i.kind === 'video' && !i.muted)) } } : seg
    // A frame's main video isn't hidden as a whole (its slots are the frame)
    return shown.hidden ? { ...shown, hidden: false } : shown
  }
  return seg
}
