// Ask AI's price in words on the clip board (ClipPickerShell): it follows the video's length.

/**
 * A video's length as people say it: "52 min", "1 h", "1 h 5 min". Started minutes count (up, not to the
 * nearest), as the price counts started hours: 60 min 20 s is "1 h 1 min", never "1 h" counted as 2 hours
 */
export function lengthLabel(ms: number | null | undefined): string {
  const min = Math.max(1, Math.ceil((ms ?? 0) / 60_000))
  const h = Math.floor(min / 60), m = min % 60
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${min} min`
}
/**
 * What an Ask AI search costs on this video, in words (user, 2026-11-25: the price didn't say it follows
 * the video's length): its credits per started hour of video, the hours it counts as, the total
 */
export function askPriceWords(durationMs: number | null | undefined, countsAs: number, credits: number) {
  const perHour = Math.round(credits / Math.max(1, countsAs))
  const len = lengthLabel(durationMs)
  return {
    line: countsAs > 1
      ? `This video is ${len}, counted as ${countsAs} hours · ${countsAs} × ${perHour} = ${credits} credits a search`
      : `This video is ${len} · ${credits} credits a search (${perHour} for each started hour of video)`,
    popup: countsAs > 1
      ? `This video is ${len}. Ask AI costs ${perHour} credits for each started hour of video, so ${countsAs} × ${perHour} = ${credits} credits for this search.`
      : `This video is ${len}. Ask AI costs ${perHour} credits for each started hour of video, so this search costs ${credits} credits.`,
  }
}
