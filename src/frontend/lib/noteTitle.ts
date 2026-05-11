/**
 * Derive a display title for a note from its markdown body.
 *
 * Rules (in priority order):
 *   1. First non-empty line is an H1 (`# foo`) → use the heading text
 *   2. First non-empty line is a higher heading (`## foo`, `### foo`...) → strip the marker
 *   3. Otherwise → first non-empty line truncated to MAX_LEN chars (with ellipsis when truncated)
 *   4. Empty / whitespace-only body → 'Untitled note'
 *
 * Title is computed at render time, never persisted, so renames are zero-cost
 * and there's no risk of title/body drift.
 */
const MAX_LEN = 60
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/

export function deriveTitle(body: string): string {
  if (!body) return 'Untitled note'
  const lines = body.split('\n')
  for (const raw of lines) {
    const line = raw.trim()
    if (line.length === 0) continue
    const headingMatch = line.match(HEADING_RE)
    if (headingMatch && headingMatch[2]) {
      const text = headingMatch[2].trim()
      if (text.length > MAX_LEN) return text.slice(0, MAX_LEN - 1) + '…'
      return text
    }
    if (line.length > MAX_LEN) return line.slice(0, MAX_LEN - 1) + '…'
    return line
  }
  return 'Untitled note'
}

/**
 * Derive a short preview snippet (for grid cards) — the next few non-title
 * lines, joined with spaces, truncated. Used under the title on a card.
 */
const SNIPPET_MAX_LEN = 180

export function deriveSnippet(body: string): string {
  if (!body) return ''
  const lines = body.split('\n')
  let titleConsumed = false
  const out: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (line.length === 0) continue
    if (!titleConsumed) {
      titleConsumed = true
      continue
    }
    // Strip basic markdown markers so the preview reads cleanly.
    const cleaned = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*+]\s+/, '• ')
      .replace(/^>\s*/, '')
      .replace(/`{1,3}/g, '')
    out.push(cleaned)
    if (out.join(' ').length >= SNIPPET_MAX_LEN) break
  }
  const joined = out.join(' ')
  if (joined.length > SNIPPET_MAX_LEN) return joined.slice(0, SNIPPET_MAX_LEN - 1) + '…'
  return joined
}
