// Storage sizes in words, for the server's messages and the pages alike (pure)

const GB = 1024 ** 3
const MB = 1024 ** 2

/** "4.2 GB", "15 GB" (no ".0"), "350 MB" under 1 GB */
export function formatStorage(bytes: number): string {
  const b = Math.max(0, bytes)
  if (b >= GB) return `${parseFloat((b / GB).toFixed(1))} GB`
  return `${Math.round(b / MB)} MB`
}
