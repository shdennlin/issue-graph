// The issue list under the filter panel: every card the canvas drew, as rows.
//
// The graph answers "what blocks what"; this answers "which ones are there and
// in what order". It lists the SAME set the canvas drew (GraphCanvas publishes
// the ids) rather than re-running the filters, so the two cannot disagree.
//
// Hovering a row highlights that card via `listHoverId`, which GraphCanvas
// treats as a hovered card; clicking focuses it and pans the camera. Ordering
// and row resolution live in lib/issueList (pure, tested) — this file is the
// thin shell, because `.tsx` is outside vitest's reach.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { List, Pin, PinOff } from 'lucide-react'
import type { NormalizedIssue } from '@shared/types.js'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { priorityClass, priorityLabelFor, stateColorVar } from '../lib/colors'
import {
  buildIssueListRows,
  ISSUE_SORT_KEYS,
  RAIL_WIDTH_DEFAULT,
  rowMeta,
  type IssueSortKey,
  type RowMeta,
} from '../lib/issueList'
import { compactAge, formatDateTime } from '../lib/relativeTime'
import { useLocale, useT, type DictKey } from '../i18n'

// Same 17h / 3d wording the cards use, so a row and its card agree.
const AGE_UNIT_KEYS: Record<'m' | 'h' | 'd', DictKey> = {
  m: 'issueNode.ageMinutes',
  h: 'issueNode.ageHours',
  d: 'issueNode.ageDays',
}

const SORT_LABEL_KEY = {
  updated: 'issueList.sortUpdated',
  priority: 'issueList.sortPriority',
  state: 'issueList.sortState',
  assignee: 'issueList.sortAssignee',
  id: 'issueList.sortId',
} as const

interface RowProps {
  issue: NormalizedIssue
  meta: RowMeta | null
  focused: boolean
  onEnter: (id: string) => void
  onLeave: (id: string) => void
  onPick: (id: string) => void
}

// Memoized: the list re-renders on every focus change and sort, and a few
// hundred rows should not all repaint because one of them gained a class.
function RowMetaCell({ meta }: { meta: RowMeta }) {
  const t = useT()
  const locale = useLocale()
  switch (meta.kind) {
    case 'age': {
      const age = compactAge(meta.ts)
      return <span className="issue-list-meta is-time">{t(AGE_UNIT_KEYS[age.unit], { count: age.value })}</span>
    }
    case 'priority':
      return (
        <span className="issue-list-meta is-priority" title={priorityLabelFor(meta.priority, locale)}>
          <span className={priorityClass(meta.priority)} />
        </span>
      )
    case 'state':
      return (
        <span className="issue-list-meta is-state" title={meta.name}>
          {meta.name}
        </span>
      )
    case 'assignee':
      return (
        <span className="issue-list-meta is-assignee" title={meta.name}>
          {meta.initials}
        </span>
      )
    case 'unassigned':
      return <span className="issue-list-meta is-assignee is-none" title={t('issueList.unassigned')}>—</span>
  }
}

const Row = memo(function Row({ issue, meta, focused, onEnter, onLeave, onPick }: RowProps) {
  const t = useT()
  const locale = useLocale()
  const id = issue.identifier
  const updatedTs = new Date(issue.updatedAt).getTime()
  const hasTs = Number.isFinite(updatedTs)
  return (
    <button
      type="button"
      className={`issue-list-row${focused ? ' is-focused' : ''}`}
      data-issue-id={id}
      title={`${id} · ${issue.title}\n${issue.state.name}${issue.assignee ? ` · ${issue.assignee.displayName}` : ''}${
        hasTs ? `\n${t('filterPanel.recencyModeUpdated')} ${formatDateTime(updatedTs, locale)}` : ''
      }`}
      onMouseEnter={() => onEnter(id)}
      onMouseLeave={() => onLeave(id)}
      onFocus={() => onEnter(id)}
      onBlur={() => onLeave(id)}
      onClick={() => onPick(id)}
    >
      <span className="issue-list-dot" style={{ background: stateColorVar(issue.state.type) }} />
      <span className="issue-list-id">{id}</span>
      <span className="issue-list-title">{issue.title}</span>
      {meta && <RowMetaCell meta={meta} />}
    </button>
  )
})

export function IssueListPanel() {
  const t = useT()
  const issues = useGraphStore((s) => s.graph?.data.issues)
  const visibleIds = useViewStore((s) => s.visibleIssueIds)
  const focusedId = useViewStore((s) => s.focusedId)
  const filters = useViewStore((s) => s.filters)
  const pinned = useViewStore((s) => s.issueListPinned)
  const togglePinned = useViewStore((s) => s.toggleIssueListPinned)
  const setListHoverId = useViewStore((s) => s.setListHoverId)
  const [sort, setSort] = useState<IssueSortKey>('updated')
  const bodyRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const height = useViewStore((s) => s.issueListHeight)
  const setHeight = useViewStore((s) => s.setIssueListHeight)
  const setRailWidth = useViewStore((s) => s.setLeftRailWidth)

  // Same pin / hover-to-expand behaviour as the filter panel above it.
  const [hovering, setHovering] = useState(false)
  const hideTimer = useRef<number | undefined>(undefined)
  const open = pinned || hovering
  const show = () => {
    window.clearTimeout(hideTimer.current)
    setHovering(true)
  }
  // Delayed so a sweep past the edge does not snap the list shut, and skipped
  // while the sort <select> has focus: its native popup lives outside this
  // subtree, so the pointer "leaves" the panel and collapsing would unmount
  // the select out from under its own open menu.
  const hide = () => {
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (rootRef.current?.contains(document.activeElement) && document.activeElement?.tagName === 'SELECT') return
      setHovering(false)
    }, 220)
  }
  useEffect(() => () => window.clearTimeout(hideTimer.current), [])

  const rows = useMemo(
    () => (issues ? buildIssueListRows(issues, visibleIds, sort) : []),
    [issues, visibleIds, sort],
  )

  // The panel can unmount (view switch) while a row is hovered, which would
  // leave the canvas highlighting a card nobody is pointing at.
  useEffect(() => () => setListHoverId(null), [setListHoverId])

  // Keep the focused row on screen when focus moves from elsewhere (a card
  // click, the quick switcher). `nearest` + no smooth scroll: house style is
  // no animation on programmatic scroll.
  useEffect(() => {
    if (!open || !focusedId) return
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-issue-id="${CSS.escape(focusedId)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, focusedId, rows])

  const onEnter = useCallback((id: string) => setListHoverId(id), [setListHoverId])
  // Clear only if the row being left is still the hovered one, so a late
  // leave from the previous row cannot wipe the next row's highlight.
  const onLeave = useCallback(
    (id: string) => {
      if (useViewStore.getState().listHoverId === id) setListHoverId(null)
    },
    [setListHoverId],
  )
  const onPick = useCallback((id: string) => {
    const view = useViewStore.getState()
    // setFocusedId resets detailPanelOpen from the auto-open preference, and
    // an open Detail covers the canvas — which hides the very jump the click
    // asked for. A list is for moving around the graph, so restore exactly
    // what was open before (open stays open, closed stays closed); Detail is
    // one keypress away when you want it.
    const wasDetailOpen = view.detailPanelOpen
    view.setFocusedId(id)
    useViewStore.getState().setDetailPanelOpen(wasDetailOpen)
    useViewStore.getState().requestPanToFocused()
  }, [])

  // Drag-to-resize. Pointer capture keeps the drag alive when the cursor
  // leaves the thin handle, and — because the pointer is then "inside" the
  // handle — the panel's own mouseleave does not fire and collapse an
  // unpinned list mid-drag.
  const startDrag = (axis: 'x' | 'y') => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startY = e.clientY
    const startW = useViewStore.getState().leftRailWidth
    const startH = rootRef.current?.getBoundingClientRect().height ?? 0
    const move = (ev: PointerEvent) => {
      if (axis === 'x') setRailWidth(startW + (ev.clientX - startX))
      else setHeight(startH + (ev.clientY - startY))
    }
    const end = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }

  // Collapsed, it is a handle that still says how many issues are listed.
  if (!open) {
    return (
      <button
        type="button"
        className="facet-handle issue-list-handle"
        onMouseEnter={show}
        onFocus={show}
        onClick={show}
        aria-label={t('issueList.expandList')}
        title={t('issueList.expandList')}
      >
        <List size={13} />
        <span className="issue-list-heading">{t('issueList.title')}</span>
        <span className="issue-list-count">{rows.length}</span>
      </button>
    )
  }

  return (
    <div
      className="issue-list"
      ref={rootRef}
      style={height === null ? undefined : { height, flex: 'none' }}
      onMouseEnter={show} onMouseLeave={hide} onFocusCapture={show}>
      <div className="issue-list-head">
        <span className="issue-list-toggle">
          <List size={13} />
          <span className="issue-list-heading">{t('issueList.title')}</span>
          <span className="issue-list-count" title={t('issueList.countTitle')}>
            {rows.length}
          </span>
        </span>
        <select
          className="issue-list-sort"
          value={sort}
          aria-label={t('issueList.sortLabel')}
          onChange={(e) => setSort(e.target.value as IssueSortKey)}
        >
          {ISSUE_SORT_KEYS.map((k) => (
            <option key={k} value={k}>
              {t(SORT_LABEL_KEY[k])}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`facet-pin-panel${pinned ? ' is-pinned' : ''}`}
          onClick={togglePinned}
          aria-pressed={pinned}
          aria-label={t(pinned ? 'issueList.unpin' : 'issueList.pin')}
          title={t(pinned ? 'issueList.unpin' : 'issueList.pin')}
        >
          {pinned ? <Pin size={11} /> : <PinOff size={11} />}
        </button>
      </div>
      <div className="issue-list-body" ref={bodyRef} onMouseLeave={() => setListHoverId(null)}>
        {rows.length === 0 ? (
          <div className="issue-list-empty">{t('issueList.empty')}</div>
        ) : (
          rows.map((issue) => (
            <Row
              key={issue.identifier}
              issue={issue}
              meta={rowMeta(issue, sort, filters)}
              focused={issue.identifier === focusedId}
              onEnter={onEnter}
              onLeave={onLeave}
              onPick={onPick}
            />
          ))
        )}
      </div>
      <div
        className="issue-list-resize is-x"
        onPointerDown={startDrag('x')}
        onDoubleClick={() => setRailWidth(RAIL_WIDTH_DEFAULT)}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('issueList.resizeWidth')}
        title={t('issueList.resizeWidth')}
      />
      <div
        className="issue-list-resize is-y"
        onPointerDown={startDrag('y')}
        onDoubleClick={() => setHeight(null)}
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('issueList.resizeHeight')}
        title={t('issueList.resizeHeight')}
      />
    </div>
  )
}
