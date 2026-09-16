/**
 * Render `ts` as a human-readable relative phrase ("just now", "3 min ago",
 * "yesterday", "Mar 4"). Designed for low-frequency UI labels — pair with a
 * refresh tick if you need it to age in place.
 *
 * `now` is injectable so the function stays pure and testable.
 */
const ABS_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

export function formatRelative(ts: number, now: number = Date.now()): string {
  const diffSec = Math.max(0, Math.round((now - ts) / 1000))
  if (diffSec < 10) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin} min ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr} hr ago`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay === 1) return 'yesterday'
  if (diffDay < 7) return `${diffDay} days ago`
  return ABS_FORMATTER.format(new Date(ts))
}

export function formatAbsolute(ts: number): string {
  return ABS_FORMATTER.format(new Date(ts))
}

/** A coarse age, as a number plus the unit it is counted in. */
export interface CompactAge {
  value: number
  unit: 'm' | 'h' | 'd'
}

/**
 * Age reduced to one number and one unit — `45m`, `2h`, `9d`.
 *
 * Separate from `formatRelative`, which is prose ("3 hr ago", "yesterday") and
 * far too wide for a badge sitting on a graph node. Returns structure rather
 * than a string so the caller renders it through i18n; both existing
 * relative-time helpers in this repo hardcode English, which is why a
 * Traditional Chinese session still read "updated 3d ago".
 *
 * Rounds down: something 119 minutes old reads "1h", never "2h". Overstating
 * an age is worse here than understating it, because the number is being read
 * against a filter window the user chose.
 */
export function compactAge(ts: number, now: number = Date.now()): CompactAge {
  const minutes = Math.max(0, Math.floor((now - ts) / 60_000))
  if (minutes < 60) return { value: minutes, unit: 'm' }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { value: hours, unit: 'h' }
  return { value: Math.floor(hours / 24), unit: 'd' }
}
