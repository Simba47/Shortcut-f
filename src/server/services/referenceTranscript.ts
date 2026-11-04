import sql from '@/lib/db'

// The reference transcript: the worker's own speech model reads every upload in the background,
// quickly and without Google's limits (the worker's jobs/reference_transcripts.ts). When its switch
// is on (REFERENCE_TRANSCRIBER=on, the video in REFERENCE_PERCENT) it marks the transcript
// for_picking, and Make my clips, Best moments and Ask AI pick their moments from it instead of
// waiting for Gemini to read the whole video. Its words are never shown: a clip's captions are still
// read by Gemini for that clip alone.

type Word = { word: string; start_ms: number; end_ms: number }

/** Whether the video has a reference transcript to pick moments from (none, or no table yet: false) */
export async function hasPickingTranscript(videoId: string): Promise<boolean> {
  try {
    const [row] = await sql`
      SELECT 1 FROM reference_transcripts WHERE video_id = ${videoId} AND status = 'done' AND for_picking LIMIT 1`
    return !!row
  } catch {
    return false   // a database the worker hasn't set up for it yet
  }
}

/** Its words, in time order, or null when there is none to pick from */
export async function pickingWords(videoId: string): Promise<Word[] | null> {
  try {
    const [row] = await sql<{ words: Word[] | null }[]>`
      SELECT words FROM reference_transcripts WHERE video_id = ${videoId} AND status = 'done' AND for_picking`
    return row?.words?.length ? row.words : null
  } catch {
    return null
  }
}
