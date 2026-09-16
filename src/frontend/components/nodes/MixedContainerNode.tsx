import { memo } from 'react'
import type { CSSProperties, MouseEvent, PointerEvent } from 'react'
import type { NodeProps } from 'reactflow'
import { useViewStore } from '../../store/viewStore'
import { useT } from '../../i18n'
import { UNCLASSIFIED_BUCKET } from '../../views/mix'

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
    /** Optional Linear project id. When set, the header name becomes a button
     *  that opens the ProjectPanel. Opt-in so mix view stays non-clickable. */
    projectId?: string | null
    /** Optional Linear milestone id. When set alongside projectId, opening
     *  the panel also scrolls + expands that milestone's <details>. Used by
     *  milestone view's per-milestone containers. */
    milestoneId?: string | null
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
  const openProjectPanel = useViewStore((s) => s.openProjectPanel)
  const t = useT()
  const canOpen = Boolean(b.projectId)
  // Mix view can't translate its own bucket names (views have no `t`), so the
  // catch-all bucket travels as a sentinel and is localized here.
  const name = b.name === UNCLASSIFIED_BUCKET ? t('views.mix.unclassified') : b.name

  // React Flow attaches its drag listener on the dragHandle's pointerdown.
  // Stop the button's pointerdown from bubbling so clicking the name doesn't
  // also initiate a drag of the container. Same trick as ProjectBackdropNode.
  const onNameClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (b.projectId) openProjectPanel(b.projectId, b.milestoneId ?? null)
  }
  const stopPointer = (e: PointerEvent<HTMLButtonElement>) => e.stopPropagation()

  return (
    <div
      className="mixed-container"
      style={{ '--bucket-tint': tint } as CSSProperties}
    >
      <div className="mixed-container-header">
        {canOpen ? (
          <button
            type="button"
            className="mixed-container-name mixed-container-name-btn"
            style={{ color: tint }}
            onClick={onNameClick}
            onPointerDown={stopPointer}
            title={t('projectPanel.openDetail')}
          >
            {name}
          </button>
        ) : (
          <span className="mixed-container-name" style={{ color: tint }}>{name}</span>
        )}
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
