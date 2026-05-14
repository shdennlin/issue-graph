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
