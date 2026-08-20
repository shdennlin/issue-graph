import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ExternalLink, Maximize2, Minimize2, Type, X } from 'lucide-react'
import type { AnnotationDTO, IssueComment, NormalizedIssue } from '@shared/types.js'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { useSchemaStore } from '../store/schemaStore'
import { useResizable } from '../hooks/useResizable'
import { api } from '../lib/api'
import { sortCommentsOldestFirst } from '../lib/comments'
import { priorityLabelFor, stateColorVar, stateIcon, stateLabelFor } from '../lib/colors'
import { getDesignDocsForIssue, groupIssueLabels, shortPrefixDisplay, type LabelSection } from '../lib/labelSchema'
import { isOverdueIssue } from '../lib/dueDate'
import { milestoneFilterKey } from '../views/filters'
import { resolveHierarchy } from '../views/hierarchy'
import { renderMarkdownHtml } from '../lib/markdown'
import { MarkdownBody } from './MarkdownBody'
import { translate, useLocale, useT } from '../i18n'

function timeAgo(iso: string, locale: ReturnType<typeof useLocale>): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 60) return translate(locale, 'detailPanel.minutesAgo', { count: m })
  const h = Math.floor(m / 60)
  if (h < 24) return translate(locale, 'detailPanel.hoursAgo', { count: h })
  return translate(locale, 'detailPanel.daysAgo', { count: Math.floor(h / 24) })
}

// Per-panel preferences — independent from the global theme/font-size settings
// so users who want a roomier read of a single issue without inflating the rest
// of the UI can opt in here.
const WIDE_MODE_KEY = 'ig-detail-wide-v1'
const TEXT_SIZE_KEY = 'ig-detail-text-size-v1'
type TextSize = 'sm' | 'md' | 'lg' | 'xl'

export function DetailPanel() {
  const focusedId = useViewStore((s) => s.focusedId)
  const setDetailPanelOpen = useViewStore((s) => s.setDetailPanelOpen)
  const setFilter = useViewStore((s) => s.setFilter)
  const graph = useGraphStore((s) => s.graph)
  const reload = useGraphStore((s) => s.load)
  const { schema } = useSchemaStore()
  const t = useT()
  const locale = useLocale()
  const [description, setDescription] = useState<string | null>(null)
  const [descLoading, setDescLoading] = useState(false)
  const [comments, setComments] = useState<IssueComment[] | null>(null)
  const [annotationDraft, setAnnotationDraft] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingBody, setEditingBody] = useState('')

  const [wideMode, setWideMode] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false
    try { return localStorage.getItem(WIDE_MODE_KEY) === '1' } catch { return false }
  })
  const [textSize, setTextSize] = useState<TextSize>(() => {
    if (typeof localStorage === 'undefined') return 'md'
    try {
      const v = localStorage.getItem(TEXT_SIZE_KEY)
      return v === 'sm' || v === 'lg' || v === 'xl' ? v : 'md'
    } catch { return 'md' }
  })

  const toggleWide = useCallback(() => {
    setWideMode((prev) => {
      const next = !prev
      try { localStorage.setItem(WIDE_MODE_KEY, next ? '1' : '0') } catch { /* silent */ }
      return next
    })
  }, [])

  // 'm' (maximize) toggles wide mode while the panel is open. Same
  // input-focus guards as the other global letter shortcuts in App.tsx so
  // typing 'm' into the annotation textarea doesn't trigger it.
  useEffect(() => {
    if (!focusedId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'm' && e.key !== 'M') return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
      e.preventDefault()
      toggleWide()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusedId, toggleWide])

  // "Copied!" feedback after the user copies the issue identifier. The
  // transient swap lasts ~1.2s — long enough to register, short enough to
  // not block re-copy. Reset whenever the focused issue changes so the
  // pill text matches the displayed identifier (see the issueId effect).
  // No useCallback: the project uses React Compiler, which auto-memoizes
  // and complains when manual memoization is added on top.
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<number | null>(null)
  const copyIdentifier = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id)
      setCopied(true)
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // Clipboard API can fail on non-secure origins (http://) or when
      // permission is denied. Silently swallow — the ID stays visible
      // (selectable text inside the button) so the user has a fallback.
    }
  }
  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
  }, [])

  // Cmd/Ctrl+Shift+C → copy the focused issue's identifier. Mirrors the
  // existing right-click "Copy ID" action but as a keyboard shortcut.
  // Active only when the panel is open (gated on focusedId). Unlike the
  // letter-only `m` shortcut above we don't need to guard against typing
  // in inputs — Cmd/Ctrl+Shift+C is a chorded combo and doesn't collide
  // with text entry. Body inlined (instead of calling copyIdentifier) so
  // the effect doesn't re-bind on every render — copyIdentifier has an
  // unstable identity since we can't wrap it in useCallback (React
  // Compiler rejects manual memoization in this codebase).
  useEffect(() => {
    if (!focusedId) return
    const onKey = async (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (!e.shiftKey || e.altKey) return
      if (e.key.toLowerCase() !== 'c') return
      e.preventDefault()
      try {
        await navigator.clipboard.writeText(focusedId)
        setCopied(true)
        if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
        copyTimerRef.current = window.setTimeout(() => setCopied(false), 1200)
      } catch { /* see copyIdentifier comment */ }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusedId])

  // Mirror wide mode onto <body> so canvas-floating controls (inline search
  // button/bar) can hide themselves — they live inside GraphCanvas and would
  // otherwise sit on top of the wide panel via their higher z-index. Gated
  // on focusedId because wideMode persists in localStorage but the panel
  // only actually renders when an issue is focused.
  useEffect(() => {
    const body = document.body
    if (wideMode && focusedId) {
      body.dataset.detailWide = '1'
    } else {
      delete body.dataset.detailWide
    }
    return () => { delete body.dataset.detailWide }
  }, [wideMode, focusedId])

  const cycleTextSize = useCallback(() => {
    setTextSize((prev) => {
      const next: TextSize =
        prev === 'sm' ? 'md' : prev === 'md' ? 'lg' : prev === 'lg' ? 'xl' : 'sm'
      try { localStorage.setItem(TEXT_SIZE_KEY, next) } catch { /* silent */ }
      return next
    })
  }, [])

  const issue = focusedId ? graph?.data.issues.find((i) => i.identifier === focusedId) : null

  // Extract identifier to a top-level binding so the effect's dep array
  // references it directly. Avoids react-hooks/exhaustive-deps complaining
  // about deriving the dep from `issue?.identifier` inside the deps array.
  const issueId = issue?.identifier
  useEffect(() => {
    // react-hooks/set-state-in-effect: standard async-fetch pattern — clear
    // stale description, mark loading, then write the resolved value (or
    // null on error). Refactoring to avoid setState here would require a
    // fetching library that's out of scope.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDescription(null)
    setComments(null)
    setCopied(false)
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
    if (!issueId) return
    let cancelled = false
    setDescLoading(true)
    api
      .fetchIssueDetail(issueId)
      .then((res) => {
        if (cancelled) return
        setDescription(res.data.description ?? '')
        setComments(res.data.comments ?? [])
      })
      .catch(() => {
        if (cancelled) return
        setDescription(null)
        setComments(null)
      })
      .finally(() => { if (!cancelled) setDescLoading(false) })
    return () => { cancelled = true }
  }, [issueId])

  // Viewport-adaptive max: never wider than 75% of the window, never wider
  // than 1200px (long-form reading column ceiling). Re-derived on window
  // resize so the hook's clamp tracks the current viewport.
  const [viewportW, setViewportW] = useState<number>(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth,
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => setViewportW(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // Side mode: capped at 75% viewport / 1200px (long-form reading column).
  const sideMax = Math.max(320, Math.min(1200, Math.floor(viewportW * 0.75)))
  // Wide mode: own resize range — wider lower bound, viewport-percentage cap.
  const wideMax = Math.max(600, Math.floor(viewportW * 0.95))

  const side = useResizable({
    storageKey: 'ig-detail-panel-w',
    defaultWidth: 380,
    min: 280,
    max: sideMax,
    side: 'right',
  })
  const wide = useResizable({
    storageKey: 'ig-detail-panel-wide-w',
    defaultWidth: Math.min(900, wideMax),
    min: 600,
    max: wideMax,
    side: 'right',
  })
  const active = wideMode ? wide : side
  const activeMax = wideMode ? wideMax : sideMax
  // Stored width may exceed the current max after a viewport shrink — clamp
  // at render time so the panel never overflows before the next drag.
  const renderedWidth = Math.min(active.width, activeMax)
  const startResize = active.startResize
  const resizing = active.resizing
  const sortedComments = useMemo(
    () => comments === null ? null : sortCommentsOldestFirst(comments),
    [comments],
  )

  if (!issue) return null

  const annotations: AnnotationDTO[] = (graph?.data.annotations ?? []).filter(
    (a) => a.targetType === 'issue' && a.targetId === issue.identifier,
  )
  const docs = getDesignDocsForIssue(issue, graph?.data.designdocs)
  const labelSections = groupIssueLabels(issue, schema)

  // Each section maps to the filter dimension that section's labels live in.
  // Selecting *just* the clicked value mirrors the state / priority /
  // assignee chips above — a chip is "show me only this", not a toggle.
  const applyLabelFilter = (sec: LabelSection, id: string): void => {
    const f = useViewStore.getState().filters
    switch (sec.kind) {
      case 'primary': setFilter('primaryValues', [id]); break
      case 'type': setFilter('typeValues', [id]); break
      case 'prefix': setFilter('prefixSelections', { ...f.prefixSelections, [sec.key]: [id] }); break
      case 'group': setFilter('groupSelections', { ...f.groupSelections, [sec.key]: [id] }); break
      case 'orphan': setFilter('orphanValues', [id]); break
    }
  }

  const submitAnnotation = async () => {
    const body = annotationDraft.trim()
    if (!body) return
    await api.createAnnotation({ targetType: 'issue', targetId: issue.identifier, body })
    setAnnotationDraft('')
    reload()
  }

  const saveEdit = async () => {
    if (editingId === null) return
    await api.patchAnnotation(editingId, editingBody.trim())
    setEditingId(null)
    setEditingBody('')
    reload()
  }

  const remove = async (id: number) => {
    if (!confirm(t('detailPanel.confirmDeleteAnnotation'))) return
    await api.deleteAnnotation(id)
    reload()
  }

  const blocksOut = issue.relations.filter((r) => r.type === 'blocks').map((r) => r.targetIdentifier)
  const blocksIn: NormalizedIssue[] = (graph?.data.issues ?? []).filter((other) =>
    other.relations.some((r) => r.type === 'blocks' && r.targetIdentifier === issue.identifier),
  )

  // Related links — bidirectional in Linear, so collect from both
  // directions and dedupe per identifier. Filter to only those present in
  // cache so we don't show ghost links the user can't click into.
  const allIssues = graph?.data.issues ?? []
  const inCache = new Set(allIssues.map((i) => i.identifier))
  const relatedIds = new Set<string>()
  for (const r of issue.relations) {
    if (r.type === 'related' && inCache.has(r.targetIdentifier)) relatedIds.add(r.targetIdentifier)
  }
  for (const other of allIssues) {
    if (other.identifier === issue.identifier) continue
    for (const r of other.relations) {
      if (r.type === 'related' && r.targetIdentifier === issue.identifier) {
        relatedIds.add(other.identifier)
      }
    }
  }
  const relatedList: NormalizedIssue[] = Array.from(relatedIds)
    .map((id) => allIssues.find((i) => i.identifier === id))
    .filter((i): i is NormalizedIssue => i !== undefined)

  // Sub-issue hierarchy. Indexed rather than `.find`-per-child: a parent can
  // carry up to 20 children and each lookup would otherwise scan every issue.
  const byId = new Map(allIssues.map((i) => [i.identifier, i]))
  const hierarchy = resolveHierarchy(issue, byId)

  return (
    <aside
      className={[
        'detail-panel',
        `detail-text-${textSize}`,
        wideMode ? 'is-wide' : '',
        resizing ? 'is-resizing' : '',
      ].filter(Boolean).join(' ')}
      style={wideMode ? { width: renderedWidth } : { width: renderedWidth, flexShrink: 0 }}
    >
      <div className="resize-handle resize-handle-left" onMouseDown={startResize} title="Drag to resize" />
      <div className="detail-header">
        <h2>
          <button
            type="button"
            className={`detail-identifier${copied ? ' is-copied' : ''}`}
            onClick={() => void copyIdentifier(issue.identifier)}
            title={copied ? t('detailPanel.copied') : t('detailPanel.copyId')}
            aria-label={t('detailPanel.copyIdAria', { id: issue.identifier })}
          >
            <span className="detail-identifier-text">{issue.identifier}</span>
            {copied && (
              <span className="detail-identifier-icon" aria-hidden>
                <Check size={11} />
              </span>
            )}
          </button>
          <span className="detail-title-text">{issue.title}</span>
        </h2>
        <button
          className="icon-only detail-text-size-btn"
          onClick={cycleTextSize}
          title={t('detailPanel.cycleTextSize', { size: textSize })}
          aria-label={t('detailPanel.cycleTextSizeAria')}
        >
          <Type size={12} />
          <span className="detail-text-size-label">{textSize}</span>
        </button>
        <button
          className="icon-only"
          onClick={toggleWide}
          title={wideMode ? t('detailPanel.collapse') : t('detailPanel.expand')}
          aria-label={wideMode ? t('detailPanel.collapse') : t('detailPanel.expand')}
        >
          {wideMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <button
          className="icon-only detail-close"
          onClick={() => setDetailPanelOpen(false)}
          title={t('detailPanel.closeTitle')}
          aria-label={t('detailPanel.closeAria')}
        >
          <X size={16} />
        </button>
      </div>
      <a className="detail-source-link" href={issue.url} target="_blank" rel="noreferrer">
        {t('detailPanel.openInSource')} <ExternalLink size={12} />
      </a>

      <div className="section">
        <div className="row">
          <span className="k">{t('detailPanel.state')}</span>
          <button
            type="button"
            className={`state-pill detail-state-pill is-${issue.state.type}`}
            style={{ color: stateColorVar(issue.state.type) }}
            onClick={() => { setFilter('stateTypes', [issue.state.type]); setDetailPanelOpen(false) }}
            title={t('detailPanel.filterByState', { value: stateLabelFor(issue.state.type, locale) })}
          >
            <span className="glyph" aria-hidden>{stateIcon(issue.state.type)}</span>
            <span>{issue.state.name}</span>
          </button>
        </div>
        <div className="row">
          <span className="k">{t('detailPanel.priority')}</span>
          <button
            type="button"
            className="detail-filter-link"
            onClick={() => { setFilter('priorities', [issue.priority]); setDetailPanelOpen(false) }}
            title={t('detailPanel.filterByPriority', { value: priorityLabelFor(issue.priority, locale) })}
          >
            {priorityLabelFor(issue.priority, locale)}
          </button>
        </div>
        <div className="row">
          <span className="k">{t('detailPanel.assignee')}</span>
          <button
            type="button"
            className="detail-filter-link"
            onClick={() => { setFilter('assignees', [issue.assignee?.displayName ?? '(unassigned)']); setDetailPanelOpen(false) }}
            title={t('detailPanel.filterByAssignee', { value: issue.assignee?.displayName ?? t('detailPanel.unassignedShort') })}
          >
            {issue.assignee?.displayName ?? t('detailPanel.unassignedShort')}
          </button>
        </div>
        <div className="row">
          <span className="k">{t('detailPanel.project')}</span>
          {issue.project ? (
            <button
              type="button"
              className="detail-filter-link"
              onClick={() => { setFilter('projectIds', [issue.project!.id]); setDetailPanelOpen(false) }}
              title={t('detailPanel.filterByProject', { value: issue.project.name })}
            >
              {issue.project.name}
            </button>
          ) : (
            <span style={{ color: 'var(--fg-muted)' }}>—</span>
          )}
        </div>
        {/* Milestone row only renders when the issue has a project — a
            milestone without a project isn't representable in Linear's data
            model and would have no filter key. Mirrors the milestone view's
            "skip projectless issues" rule. */}
        {issue.project && (
          <div className="row">
            <span className="k">{t('detailPanel.milestone')}</span>
            {issue.projectMilestone ? (
              <button
                type="button"
                className="detail-filter-link"
                onClick={() => {
                  setFilter('milestoneIds', [
                    milestoneFilterKey(issue.project!.id, issue.projectMilestone!.id),
                  ])
                  setDetailPanelOpen(false)
                }}
                title={t('detailPanel.filterByMilestone', { value: issue.projectMilestone.name })}
              >
                {issue.projectMilestone.name}
              </button>
            ) : (
              <span style={{ color: 'var(--fg-muted)' }}>{t('detailPanel.noMilestone')}</span>
            )}
          </div>
        )}
        {issue.team && (
          <div className="row">
            <span className="k">{t('detailPanel.team')}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {issue.team.color && (
                <span
                  aria-hidden
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: issue.team.color,
                  }}
                />
              )}
              <span>
                {issue.team.name}
                {issue.team.key && (
                  <span style={{ color: 'var(--fg-muted)', marginLeft: 6 }}>
                    {issue.team.key}
                  </span>
                )}
              </span>
            </span>
          </div>
        )}
        {typeof issue.estimate === 'number' && (
          <div className="row">
            <span className="k">{t('detailPanel.estimate')}</span>
            <span>{t('detailPanel.estimatePointsShort', { value: issue.estimate })}</span>
          </div>
        )}
        {issue.dueDate && (
          <div className="row">
            <span className="k">{t('detailPanel.dueDate')}</span>
            <span
              title={issue.dueDate}
              style={
                isOverdueIssue(issue)
                  ? { color: 'var(--danger, #ef4444)', fontWeight: 600 }
                  : undefined
              }
            >
              {issue.dueDate}
              {isOverdueIssue(issue) && (
                <span style={{ marginLeft: 6, fontSize: 11 }}>
                  · {t('detailPanel.overdue')}
                </span>
              )}
            </span>
          </div>
        )}
        {issue.startedAt && (
          <div className="row">
            <span className="k">{t('detailPanel.startedAt')}</span>
            <span title={issue.startedAt}>{timeAgo(issue.startedAt, locale)}</span>
          </div>
        )}
        <div className="row"><span className="k">{t('detailPanel.created')}</span><span>{timeAgo(issue.createdAt, locale)}</span></div>
        <div className="row"><span className="k">{t('detailPanel.updated')}</span><span>{timeAgo(issue.updatedAt, locale)}</span></div>
        {/* Every label on the issue, one row per schema section. Driven by
            groupIssueLabels rather than by looking up the groups the schema
            named, so a label from a group autodetection has not classified
            (or has not seen yet) still surfaces under "Labels" instead of
            vanishing. Chips filter the dimension they belong to, matching the
            state/priority/assignee rows above. */}
        {labelSections.map((sec) => (
          <div className="row" key={`${sec.kind}:${sec.key}`}>
            <span className="k">
              {sec.kind === 'prefix' ? `${sec.key}:` : sec.kind === 'orphan' ? t('detailPanel.labels') : sec.key}
            </span>
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {sec.labels.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className="detail-filter-link"
                  onClick={() => { applyLabelFilter(sec, l.id); setDetailPanelOpen(false) }}
                  title={
                    sec.kind === 'orphan'
                      ? t('detailPanel.filterByLabel', { value: l.name })
                      : t('detailPanel.filterByGroup', {
                          group: sec.kind === 'prefix' ? `${sec.key}:` : sec.key,
                          value: l.name,
                        })
                  }
                >
                  {sec.kind === 'prefix' ? shortPrefixDisplay(l.name, sec.key) : l.name}
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>

      {docs.length > 0 && (
        <div className="section">
          <h3>{t('detailPanel.designDocs', { count: docs.length })}</h3>
          {docs.length > 1 && (
            <div className="detail-spec-warn">
              <AlertTriangle size={14} className="detail-spec-warn-icon" />
              <span>
                {t('detailPanel.designSpansWarn', { count: docs.length })}
              </span>
            </div>
          )}
          {docs.map((d) => (
            <details key={d.name} open={docs.length === 1}>
              <summary>
                {d.name} {d.status === 'parked' && t('detailPanel.parked')} — {d.doneTasks}/{d.totalTasks}
              </summary>
              <div className="progress" style={{ height: 6, background: 'var(--chip-bg)', borderRadius: 3, margin: '4px 0' }}>
                <div style={{ width: `${(d.progress * 100).toFixed(0)}%`, height: '100%', background: 'var(--accent)' }} />
              </div>
              <div style={{ color: 'var(--fg-muted)', fontSize: 11 }}>{d.filePath}</div>
            </details>
          ))}
        </div>
      )}

      {(hierarchy.parent || hierarchy.children.length > 0) && (
        // Hierarchy — Linear's parent/children, which live outside `relations`
        // and so never appear as edges. Section is omitted entirely when the
        // issue has neither: most issues don't use sub-issues, and an empty
        // heading would be noise on every card.
        <div className="section">
          <h3>{t('detailPanel.hierarchy')}</h3>
          {hierarchy.parent && (
            <div>
              <div style={{ color: 'var(--fg-muted)', fontSize: 11 }}>{t('detailPanel.parentIssue')}</div>
              <div>
                <a href="#" onClick={(e) => { e.preventDefault(); useViewStore.getState().setFocusedId(hierarchy.parent!.identifier) }}>
                  ↑ {hierarchy.parent.identifier} {hierarchy.parent.issue?.title ?? ''}
                </a>
              </div>
            </div>
          )}
          {hierarchy.children.length > 0 && (
            <div style={{ marginTop: hierarchy.parent ? 6 : 0 }}>
              <div
                style={{ color: 'var(--fg-muted)', fontSize: 11 }}
                title={[
                  hierarchy.unresolved > 0
                    ? t('detailPanel.subIssuesUnresolved', { count: hierarchy.unresolved })
                    : '',
                  hierarchy.truncated ? t('detailPanel.subIssuesTruncated') : '',
                ].filter(Boolean).join('\n')}
              >
                {t('detailPanel.subIssues')} —{' '}
                {t('detailPanel.subIssuesProgress', {
                  done: hierarchy.done,
                  total: hierarchy.truncated ? `${hierarchy.total}+` : hierarchy.total,
                })}
              </div>
              {hierarchy.children.map((c) => (
                <div key={c.identifier}>
                  {c.issue ? (
                    <a href="#" onClick={(e) => { e.preventDefault(); useViewStore.getState().setFocusedId(c.identifier) }}>
                      ↳ {c.identifier} {c.issue.title}
                    </a>
                  ) : (
                    // Unlike `related` (which hides uncached targets), an
                    // uncached child still represents outstanding work — it
                    // counts toward the progress denominator, so hiding the
                    // row would make the number unexplainable.
                    <span style={{ color: 'var(--fg-muted)' }} title={t('detailPanel.subIssueNotCached')}>
                      ↳ {c.identifier}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(blocksOut.length > 0 || blocksIn.length > 0) && (
        <div className="section">
          <h3>{t('detailPanel.blocks')}</h3>
          {blocksIn.length > 0 && (
            <div>
              <div style={{ color: 'var(--fg-muted)', fontSize: 11 }}>{t('detailPanel.blockedBy')}</div>
              {blocksIn.map((b) => (
                <div key={b.identifier}>
                  <a href="#" onClick={(e) => { e.preventDefault(); useViewStore.getState().setFocusedId(b.identifier) }}>
                    ← {b.identifier} {b.title}
                  </a>
                </div>
              ))}
            </div>
          )}
          {blocksOut.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ color: 'var(--fg-muted)', fontSize: 11 }}>{t('detailPanel.blocksOut')}</div>
              {blocksOut.map((id) => (
                <div key={id}>
                  <a href="#" onClick={(e) => { e.preventDefault(); useViewStore.getState().setFocusedId(id) }}>→ {id}</a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {relatedList.length > 0 && (
        <div className="section">
          <h3>{t('detailPanel.related', { count: relatedList.length })}</h3>
          {/* `related` is bidirectional — no in/out split, just list. The
              ↔ icon mirrors the dashed-edge style on the canvas + the
              connectivity-badge ╍ glyph, keeping visual grammar consistent. */}
          {relatedList.map((r) => (
            <div key={r.identifier}>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  useViewStore.getState().setFocusedId(r.identifier)
                }}
              >
                ↔ {r.identifier} {r.title}
              </a>
            </div>
          ))}
        </div>
      )}

      <div className="section">
        <h3>{t('detailPanel.annotations', { count: annotations.length })}</h3>
        {annotations.map((a) => (
          <div key={a.id} style={{ borderTop: '1px solid var(--node-border)', paddingTop: 6, marginTop: 6 }}>
            {editingId === a.id ? (
              <>
                <textarea value={editingBody} onChange={(e) => setEditingBody(e.target.value)} rows={3} style={{ width: '100%' }} />
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  <button className="primary" onClick={saveEdit}>{t('common.save')}</button>
                  <button onClick={() => setEditingId(null)}>{t('common.cancel')}</button>
                </div>
              </>
            ) : (
              <>
                <div dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(a.body) }} />
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  <button onClick={() => { setEditingId(a.id); setEditingBody(a.body) }}>{t('common.edit')}</button>
                  <button onClick={() => remove(a.id)}>{t('common.delete')}</button>
                  <span style={{ color: 'var(--fg-muted)', fontSize: 11, marginLeft: 'auto' }}>
                    {timeAgo(new Date(a.updatedAt).toISOString(), locale)}
                  </span>
                </div>
              </>
            )}
          </div>
        ))}
        <textarea
          rows={3}
          placeholder={t('detailPanel.addAnnotationPlaceholder')}
          value={annotationDraft}
          onChange={(e) => setAnnotationDraft(e.target.value)}
          style={{ width: '100%', marginTop: 6 }}
        />
        <button className="primary" onClick={submitAnnotation} style={{ marginTop: 4 }}>{t('detailPanel.addAnnotation')}</button>
      </div>

      <div className="section">
        <h3>{t('detailPanel.description')}</h3>
        {descLoading && (
          <div className="skeleton-stack" aria-busy="true" aria-label={t('detailPanel.descriptionLoadingAria')}>
            <div className="skeleton skeleton-line" style={{ width: '92%' }} />
            <div className="skeleton skeleton-line" style={{ width: '78%' }} />
            <div className="skeleton skeleton-line" style={{ width: '85%' }} />
            <div className="skeleton skeleton-line" style={{ width: '40%' }} />
          </div>
        )}
        {!descLoading && description !== null && (
          <div dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(description || '', t('detailPanel.noDescription')) }} />
        )}
        {!descLoading && description === null && <div style={{ color: 'var(--fg-muted)' }}>{t('detailPanel.descriptionLoadFail')}</div>}
      </div>

      <div className="section">
        <h3>{t('detailPanel.comments', { count: sortedComments?.length ?? 0 })}</h3>
        {descLoading && sortedComments === null && (
          <div style={{ color: 'var(--fg-muted)' }}>{t('detailPanel.commentsLoading')}</div>
        )}
        {sortedComments !== null && sortedComments.length === 0 && !descLoading && (
          <div style={{ color: 'var(--fg-muted)' }}>{t('detailPanel.noComments')}</div>
        )}
        {sortedComments !== null && sortedComments.map((cm) => (
          <div key={cm.id} className="detail-comment">
            <div className="detail-comment-head">
              <strong>{cm.user?.displayName ?? t('detailPanel.unknownAuthor')}</strong>
              <span className="detail-comment-time">{timeAgo(cm.createdAt, locale)}</span>
            </div>
            <MarkdownBody body={cm.body} />
          </div>
        ))}
      </div>
    </aside>
  )
}
