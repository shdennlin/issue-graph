import { Fragment } from 'react'
import { findMatchRanges } from '../../lib/notesMatch'

interface Props {
  text: string
  query: string
  className?: string
}

/**
 * Renders `text` with case-insensitive matches of `query` wrapped in
 * <mark class="note-highlight"> spans. Used for the note title in the grid
 * card and the snippet in the list row.
 */
export function HighlightedText({ text, query, className }: Props) {
  const q = query.trim()
  if (q.length === 0) return <>{text}</>
  const ranges = findMatchRanges(q, text)
  if (ranges.length === 0) return <>{text}</>
  const parts: React.ReactNode[] = []
  let cursor = 0
  ranges.forEach(([start, end], idx) => {
    if (start > cursor) parts.push(<Fragment key={`t-${idx}`}>{text.slice(cursor, start)}</Fragment>)
    parts.push(
      <mark key={`m-${idx}`} className={className ?? 'note-highlight'}>
        {text.slice(start, end)}
      </mark>,
    )
    cursor = end
  })
  if (cursor < text.length) parts.push(<Fragment key="t-end">{text.slice(cursor)}</Fragment>)
  return <>{parts}</>
}
