import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ExternalLink, Maximize2, Minimize2, Type, X } from 'lucide-react'
import type { AnnotationDTO, IssueComment, NormalizedIssue } from '@shared/types.js'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { useSchemaStore } from '../store/schemaStore'
import { useResizable } from '../hooks/useResizable'
import { api } from '../lib/api'
import { sortCommentsOldestFirst } from '../lib/comments'
import { priorityLabelFor, stateColorVar, stateIcon, stateLabelFor } from '../lib/colors'
import { getDesignDocsForIssue } from '../lib/labelSchema'
import { milestoneFilterKey } from '../views/filters'
import { renderMarkdownHtml, renderMarkdownNodes } from '../lib/markdown'
import { translate, useLocale, useT } from '../i18n'

function MarkdownBody({ body }: { body: string }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const nodes = renderMarkdownNodes(body)
    if (nodes.length === 0 && body) {
      // Sanitizer stripped everything (e.g., Linear bot comment with raw HTML).
      // Fall back to plaintext so the card isn't blank.
      const pre = document.createElement('div')
      pre.style.whiteSpace = 'pre-wrap'
      pre.textContent = body
      el.replaceChildren(pre)
      return
    }
    el.replaceChildren(...nodes)
  }, [body])
  return <div ref={ref} />
}

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
          <span className="detail-identifier">{issue.identifier}</span>{' '}
          {issue.title}
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
        <div className="row"><span className="k">{t('detailPanel.created')}</span><span>{timeAgo(issue.createdAt, locale)}</span></div>
        <div className="row"><span className="k">{t('detailPanel.updated')}</span><span>{timeAgo(issue.updatedAt, locale)}</span></div>
        {schema.primaryGroup && (() => {
          const primary = issue.labels.find((l) => l.group?.name === schema.primaryGroup)
          return (
            <div className="row">
              <span className="k">{schema.primaryGroup}</span>
              {primary ? (
                <button
                  type="button"
                  className="detail-filter-link"
                  onClick={() => { setFilter('primaryValues', [primary.id]); setDetailPanelOpen(false) }}
                  title={t('detailPanel.filterByGroup', { group: schema.primaryGroup, value: primary.name })}
                >
                  {primary.name}
                </button>
              ) : (
                <span style={{ color: 'var(--fg-muted)' }}>—</span>
              )}
            </div>
          )
        })()}
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
