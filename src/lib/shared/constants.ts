export const OUTPUT_WIDTH = 1080
export const OUTPUT_HEIGHT = 1920
export const OUTPUT_ASPECT = '9:16'

/** A part's speed (the editor's Speed): from SPEED_MIN to SPEED_MAX times as filmed. The export
 *  takes the same range (chai-cut-backend: python/render.py, python/audio.py, jobs/render.ts) */
export const SPEED_MIN = 0.1
export const SPEED_MAX = 10

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB
export const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm']
export const ACCEPTED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.mkv', '.webm']

export const STORAGE_BUCKET_RAW = 'raw-videos'
export const STORAGE_BUCKET_CLIPS = 'clips'
export const STORAGE_BUCKET_OVERLAYS = 'overlays'

// Sarvam AI supported languages for transcription
export const SARVAM_LANGUAGES = [
  { code: 'te-IN', label: 'Telugu' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'en-IN', label: 'Hinglish / English (India)' },
] as const

export const CAPTION_FONTS = [
  { id: 'noto-sans-telugu', label: 'Noto Sans Telugu', file: 'NotoSansTelugu-Regular.ttf' },
  { id: 'noto-sans-devanagari', label: 'Noto Sans Devanagari', file: 'NotoSansDevanagari-Regular.ttf' },
  { id: 'roboto', label: 'Roboto', file: 'Roboto-Regular.ttf' },
  { id: 'montserrat-bold', label: 'Montserrat Bold', file: 'Montserrat-Bold.ttf' },
] as const

export const DEFAULT_CAPTION_STYLE = {
  font: 'noto-sans-telugu',
  size: 80,   // (user, 2026-11-15: 52 read small on a phone — ~5% of the width now)
  color: '#FFFFFF',
  position: 'bottom-center',
  animation: 'karaoke',
} as const

export const JOB_POLL_INTERVAL_MS = 2000

export const VIDEO_CRF = 18 // near-lossless H.264
export const VIDEO_CODEC = 'libx264'
export const AUDIO_CODEC = 'aac'
export const AUDIO_BITRATE = '192k'
