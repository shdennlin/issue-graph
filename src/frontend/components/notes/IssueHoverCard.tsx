import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { NormalizedIssue } from '@shared/types.js'
import { priorityClass, priorityLabel, stateColorVar, stateIcon } from '../../lib/colors'
import { getPrimaryLabel, getTypeLabel, groupIssueLabels, shortPrefixDisplay } from '../../lib/labelSchema'
import { useSchemaStore } from '../../store/schemaStore'

interface Props {
  issue: NormalizedIssue
  anchorRect: DOMRect
}

const CARD_WIDTH = 320
const MARGIN = 8

export function IssueHoverCard({ issue, anchorRect }: Props) {
  const { schema, typeIcons } = useSchemaStore()
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Two-pass placement: render once invisibly to measure real height, then
  // place. Matches the approach in components/Tooltip.tsx so flip-on-overflow
  // works without estimating heights upfront.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const h = el.offsetHeight
    const desiredLeft = anchorRect.left
    const leftMax = window.innerWidth - CARD_WIDTH - MARGIN
    const left = Math.max(MARGIN, Math.min(leftMax, desiredLeft))
    let top = anchorRect.bottom + 6
    if (top + h > window.innerHeight - MARGIN) {
      top = anchorRect.top - h - 6
    }
    if (top < MARGIN) top = MARGIN
    setPos({ top, left })
  }, [anchorRect])

  // Re-clamp on viewport resize so a card opened near the edge doesn't get
  // stranded off-screen if the user resizes the window while hovering.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => setPos(null)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const primary = getPrimaryLabel(issue, schema)
  const type = getTypeLabel(issue, schema)
  const typeIcon = type ? typeIcons[type.name] ?? type.name.charAt(0).toUpperCase() : null
  // Same chip coverage as IssueNode: everything the header doesn't show.
  const chipSections = groupIssueLabels(issue, schema).filter(
    (sec) => sec.kind === 'prefix' || sec.kind === 'group' || sec.kind === 'orphan',
  )

  return createPortal(
    <div
      ref={ref}
      className="issue-node issue-hover-card"
      role="tooltip"
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: CARD_WIDTH,
        zIndex: 1000,
        pointerEvents: 'none',
        opacity: pos ? 1 : 0,
        transition: 'opacity 80ms ease',
      }}
    >
      <div className="top">
        {typeIcon && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <span aria-hidden>{typeIcon}</span>
          </span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <span className={priorityClass(issue.priority)} aria-label={priorityLabel(issue.priority)} />
        </span>
        <span className="pid">{issue.identifier}</span>
        <span style={{ marginLeft: 'auto' }}>
          <span
            className={`state-pill is-${issue.state.type}`}
            style={{ color: stateColorVar(issue.state.type) }}
          >
            <span className="glyph" aria-hidden>{stateIcon(issue.state.type)}</span>
            {issue.state.name}
          </span>
        </span>
      </div>
      <div className="title">{issue.title}</div>
      <div className="meta">
        <span>{issue.assignee?.displayName ?? 'unassigned'}</span>
        {primary && (
          <span
            className="chip"
            style={primary.color ? ({ ['--chip-tint' as string]: primary.color } as React.CSSProperties) : undefined}
          >
            {primary.name}
          </span>
        )}
        {chipSections.flatMap((sec) =>
          sec.labels.map((l) => (
            <span
              key={l.id}
              className="chip"
              style={l.color ? ({ ['--chip-tint' as string]: l.color } as React.CSSProperties) : undefined}
              title={sec.kind === 'orphan' ? l.name : `${sec.key}: ${l.name}`}
            >
              {sec.kind === 'prefix' ? `${sec.key}: ${shortPrefixDisplay(l.name, sec.key)}` : l.name}
            </span>
          )),
        )}
      </div>
    </div>,
    document.body,
  )
}
