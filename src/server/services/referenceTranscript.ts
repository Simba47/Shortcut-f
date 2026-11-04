import sql from '@/lib/db'

// The reference transcript: the worker's own speech model reads every upload in the background,
// quickly and without Google's limits (the worker's jobs/reference_transcripts.ts). When its switch
// is on (REFERENCE_TRANSCRIBER=on, the video in REFERENCE_PERCENT) it marks the transcript
// for_picking, and Make my clips, Best moments and Ask AI pick their moments from it instead of
// waiting for Gemini to read the whole video. Its words are never shown: a clip's captions are still
// read by Gemini for that clip alone.

type Word = { word: string; start_ms: number; end_ms: number }

/**
 * Where the video's reference transcript stands for picking moments: 'ready' (done), 'reading' (being
 * made: nothing else needs to read the whole video meanwhile), or null (none, failed, not for picking,
 * or no table yet), when Gemini reads the whole video as before
 */
export async function pickingState(videoId: string): Promise<'ready' | 'reading' | null> {
  try {
    const [row] = await sql<{ status: string }[]>`
      SELECT status FROM reference_transcripts WHERE video_id = ${videoId} AND for_picking LIMIT 1`
    return row?.status === 'done' ? 'ready' : row?.status === 'submitted' ? 'reading' : null
  } catch {
    return null   // a database the worker hasn't set up for it yet
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
