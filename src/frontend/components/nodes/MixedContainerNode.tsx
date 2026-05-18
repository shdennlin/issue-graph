import { memo } from 'react'
import type { CSSProperties } from 'react'
import type { NodeProps } from 'reactflow'

interface MixedContainerData {
  bucket: {
    id: string
    name: string
    color: string
    count: number
    /** Optional: render '(done/total)' next to count for views that track progress
     *  (e.g. milestone view). 'count' alone stays as the generic case. */
    progress?: { done: number; total: number }
    /** Optional ISO date string. Rendered as a small chip ('📅 May 30') beside
     *  the count. Past dates are flagged via the .overdue modifier. */
    targetDate?: string | null
  }
}

function formatTargetDate(iso: string): { label: string; overdue: boolean } {
  // Linear's targetDate is a date-only string like '2025-05-30'. Parse as UTC
  // to avoid the off-by-one timezone drift when the user is west of UTC.
  const d = new Date(iso + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return { label: iso, overdue: false }
  const now = new Date()
  const overdue = d.getTime() < now.getTime()
  // Show year only when not the current year — keeps the chip tight.
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear()
  const opts: Intl.DateTimeFormatOptions = sameYear
    ? { month: 'short', day: 'numeric', timeZone: 'UTC' }
    : { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }
  return { label: d.toLocaleDateString(undefined, opts), overdue }
}

function MixedContainerImpl({ data }: NodeProps<MixedContainerData>) {
  const b = data.bucket
  const tint = b.color || 'var(--fg-muted)'
  const countLabel = b.progress ? `${b.progress.done}/${b.progress.total}` : String(b.count)
  const date = b.targetDate ? formatTargetDate(b.targetDate) : null
  return (
    <div
      className="mixed-container"
      style={{ '--bucket-tint': tint } as CSSProperties}
    >
      <div className="mixed-container-header">
        <span className="mixed-container-name" style={{ color: tint }}>{b.name}</span>
        <span className="mixed-container-count">{countLabel}</span>
        {date && (
          <span
            className={`mixed-container-date${date.overdue ? ' overdue' : ''}`}
            title={`Target date: ${b.targetDate}`}
          >
            📅 {date.label}
          </span>
        )}
      </div>
    </div>
  )
}

export const MixedContainerNode = memo(MixedContainerImpl)
