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
 * made: nothing else needs to read the whole video meanwhile; progress 0-100 as the worker last heard,
 * null before it has started), or null (none, failed, not for picking, or no table yet), when Gemini
 * reads the whole video as before
 */
export async function pickingState(videoId: string): Promise<{ state: 'ready' | 'reading'; progress: number | null } | null> {
  try {
    // (to_jsonb: a worker from before progress was recorded has no such column)
    const [row] = await sql<{ status: string; progress: string | null }[]>`
      SELECT r.status, to_jsonb(r)->>'progress' AS progress FROM reference_transcripts r
      WHERE r.video_id = ${videoId} AND r.for_picking LIMIT 1`
    if (row?.status === 'done') return { state: 'ready', progress: 100 }
    if (row?.status === 'submitted') return { state: 'reading', progress: row.progress === null ? null : Number(row.progress) }
    return null
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
