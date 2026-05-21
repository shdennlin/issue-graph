import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Type, X } from 'lucide-react'
import type { IssueStateType, NormalizedIssue, ProjectStateType } from '@shared/types.js'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { useResizable } from '../hooks/useResizable'
import { MarkdownBody } from './MarkdownBody'
import { useT, type DictKey } from '../i18n'

// Shared with DetailPanel — same storage key so cycling text size in either
// panel updates the other on next render.
const TEXT_SIZE_KEY = 'ig-detail-text-size-v1'
type TextSize = 'sm' | 'md' | 'lg' | 'xl'

const PROJECT_STATE_DICT_KEY: Record<ProjectStateType, DictKey> = {
  backlog: 'projectPanel.projectStates.backlog',
  planned: 'projectPanel.projectStates.planned',
  started: 'projectPanel.projectStates.started',
  paused: 'projectPanel.projectStates.paused',
  completed: 'projectPanel.projectStates.completed',
  canceled: 'projectPanel.projectStates.canceled',
}

const ISSUE_STATE_DICT_KEY: Record<IssueStateType, DictKey> = {
  backlog: 'states.backlog',
  unstarted: 'states.unstarted',
  started: 'states.started',
  completed: 'states.completed',
  canceled: 'states.canceled',
  triage: 'states.triage',
}

// Display order for the "By state" section — Linear's canonical lifecycle
// reading left-to-right. Triage is rarely populated; keep it last.
const STATE_DISPLAY_ORDER: IssueStateType[] = [
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
  'triage',
]

const PROJECT_STATE_COLOR: Record<ProjectStateType, string> = {
  backlog: 'var(--fg-muted)',
  planned: 'var(--state-unstarted, #6b7280)',
  started: 'var(--state-started, #f59e0b)',
  paused: '#d97706',
  completed: 'var(--state-completed, #10b981)',
  canceled: 'var(--state-canceled, #ef4444)',
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

interface IssueCounts {
  total: number
  done: number
  byState: Record<IssueStateType, number>
}

function computeIssueCounts(issues: NormalizedIssue[], projectId: string): IssueCounts {
  const byState: Record<IssueStateType, number> = {
    backlog: 0,
    unstarted: 0,
    started: 0,
    completed: 0,
    canceled: 0,
    triage: 0,
  }
  let total = 0
  for (const i of issues) {
    if (i.project?.id !== projectId) continue
    total += 1
    byState[i.state.type] += 1
  }
  return { total, done: byState.completed, byState }
}

interface MilestoneRollup {
  id: string
  name: string
  targetDate: string | null
  description: string | null
  done: number
  total: number
}

function computeMilestoneRollups(
  issues: NormalizedIssue[],
  projectId: string,
  declared: Array<{ id: string; name: string; targetDate: string | null; sortOrder: number | null; description: string | null }>,
): MilestoneRollup[] {
  // Start from the project's declared milestones (so empty milestones still
  // show up) and fold in issue counts. Issues with no milestone are grouped
  // under a synthetic '__none' entry only if any such issues exist.
  const counts = new Map<string, { done: number; total: number }>()
  let noneTotal = 0
  let noneDone = 0
  for (const i of issues) {
    if (i.project?.id !== projectId) continue
    const m = i.projectMilestone
    if (!m) {
      noneTotal += 1
      if (i.state.type === 'completed') noneDone += 1
      continue
    }
    const slot = counts.get(m.id) ?? { done: 0, total: 0 }
    slot.total += 1
    if (i.state.type === 'completed') slot.done += 1
    counts.set(m.id, slot)
  }

  const sorted = [...declared].sort((a, b) => {
    const ao = a.sortOrder ?? Number.POSITIVE_INFINITY
    const bo = b.sortOrder ?? Number.POSITIVE_INFINITY
    if (ao !== bo) return ao - bo
    return a.name.localeCompare(b.name)
  })

  const rollups: MilestoneRollup[] = sorted.map((m) => ({
    id: m.id,
    name: m.name,
    targetDate: m.targetDate,
    description: m.description,
    done: counts.get(m.id)?.done ?? 0,
    total: counts.get(m.id)?.total ?? 0,
  }))

  if (noneTotal > 0) {
    rollups.push({
      id: '__none',
      name: '(No milestone)',
      targetDate: null,
      description: null,
      done: noneDone,
      total: noneTotal,
    })
  }
  return rollups
}

export function ProjectPanel() {
  const focusedProjectId = useViewStore((s) => s.focusedProjectId)
  const focusedMilestoneId = useViewStore((s) => s.focusedMilestoneId)
  const clearFocusedMilestone = useViewStore((s) => s.clearFocusedMilestone)
  const closeProjectPanel = useViewStore((s) => s.closeProjectPanel)
  const graph = useGraphStore((s) => s.graph)
  const projectDetails = useGraphStore((s) => s.projectDetails)
  const loadProjectDetail = useGraphStore((s) => s.loadProjectDetail)
  const t = useT()
  const milestonesListRef = useRef<HTMLUListElement | null>(null)

  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<number | null>(null)

  const [textSize, setTextSize] = useState<TextSize>(() => {
    if (typeof localStorage === 'undefined') return 'md'
    try {
      const v = localStorage.getItem(TEXT_SIZE_KEY)
      return v === 'sm' || v === 'lg' || v === 'xl' ? v : 'md'
    } catch { return 'md' }
  })
  // Re-read when DetailPanel toggles it in the same tab — storage events only
  // fire across tabs, so we additionally poll on focus to catch same-tab
  // updates without an extra cross-component event bus. Cheap because the
  // panel only mounts when focusedProjectId is set.
  useEffect(() => {
    const reread = () => {
      try {
        const v = localStorage.getItem(TEXT_SIZE_KEY)
        const next: TextSize = v === 'sm' || v === 'lg' || v === 'xl' ? v : 'md'
        setTextSize((prev) => (prev === next ? prev : next))
      } catch { /* silent */ }
    }
    window.addEventListener('storage', reread)
    window.addEventListener('focus', reread)
    return () => {
      window.removeEventListener('storage', reread)
      window.removeEventListener('focus', reread)
    }
  }, [])
  const cycleTextSize = useCallback(() => {
    setTextSize((prev) => {
      const next: TextSize =
        prev === 'sm' ? 'md' : prev === 'md' ? 'lg' : prev === 'lg' ? 'xl' : 'sm'
      try { localStorage.setItem(TEXT_SIZE_KEY, next) } catch { /* silent */ }
      return next
    })
  }, [])

  // Fetch detail on mount / project change. The store handles dedup so this
  // is safe to call repeatedly without thrashing the cache.
  useEffect(() => {
    if (!focusedProjectId) return
    void loadProjectDetail(focusedProjectId)
  }, [focusedProjectId, loadProjectDetail])

  // When opened with a focusMilestoneId (clicked a milestone container in
  // milestone view), scroll that row into view and expand its <details>.
  // Effect waits on `detail` so the milestone DOM exists by the time we
  // query for it. One-shot — clear the focus once applied.
  const detailForFocus = focusedProjectId ? projectDetails[focusedProjectId] : undefined
  useEffect(() => {
    if (!focusedMilestoneId) return
    if (!detailForFocus) return
    const list = milestonesListRef.current
    if (!list) return
    const row = list.querySelector<HTMLElement>(
      `[data-milestone-id="${CSS.escape(focusedMilestoneId)}"]`,
    )
    if (!row) {
      clearFocusedMilestone()
      return
    }
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    const details = row.querySelector<HTMLDetailsElement>('.project-panel-milestone-details')
    if (details) details.open = true
    clearFocusedMilestone()
  }, [focusedMilestoneId, detailForFocus, clearFocusedMilestone])

  // Cmd/Ctrl+Shift+C → copy project id. Inlined like DetailPanel's shortcut
  // (React Compiler rejects useCallback wrappers).
  useEffect(() => {
    if (!focusedProjectId) return
    const onKey = async (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (!e.shiftKey || e.altKey) return
      if (e.key.toLowerCase() !== 'c') return
      e.preventDefault()
      try {
        await navigator.clipboard.writeText(focusedProjectId)
        setCopied(true)
        if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
        copyTimerRef.current = window.setTimeout(() => setCopied(false), 1200)
      } catch {
        // Clipboard API can fail on http:// origins — silent fallback.
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusedProjectId])

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
  }, [])

  const [viewportW, setViewportW] = useState<number>(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth,
  )
  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const sideMax = Math.max(360, Math.floor(viewportW * 0.5))
  const { width, startResize, resizing } = useResizable({
    storageKey: 'ig-project-panel-w',
    defaultWidth: 380,
    min: 300,
    max: sideMax,
    side: 'right',
  })
  const renderedWidth = Math.min(width, sideMax)

  if (!focusedProjectId) return null

  // Project name / color come from the in-memory issue list (each issue
  // carries its project's {id, name, color}). Title-only fields, so even
  // when the detail fetch is in flight or errored we still render a
  // meaningful header.
  const issues = graph?.data.issues ?? []
  const summary = issues.find((i) => i.project?.id === focusedProjectId)?.project ?? null
  const detailEntry = projectDetails[focusedProjectId]
  const detail = detailEntry && detailEntry !== 'loading' && detailEntry !== 'error' ? detailEntry : null

  const counts = computeIssueCounts(issues, focusedProjectId)
  const rollups = detail ? computeMilestoneRollups(issues, focusedProjectId, detail.milestones) : []

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(focusedProjectId)
      setCopied(true)
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // see Cmd-Shift-C comment above
    }
  }

  return (
    <aside
      className={[
        'project-panel',
        `detail-text-${textSize}`,
        resizing ? 'is-resizing' : '',
      ].filter(Boolean).join(' ')}
      style={{ width: renderedWidth, flexShrink: 0 }}
    >
      <div className="resize-handle resize-handle-left" onMouseDown={startResize} title="Drag to resize" />
      <div className="project-panel-header">
        <h2 className="project-panel-title">
          <button
            type="button"
            className={`project-panel-id${copied ? ' is-copied' : ''}`}
            onClick={() => void copyId()}
            title={copied ? t('projectPanel.copied') : t('projectPanel.copyId')}
            aria-label={t('projectPanel.copyIdAria')}
          >
            <span className="project-panel-id-text">PROJ</span>
            {copied && (
              <span className="project-panel-id-icon" aria-hidden>
                <Check size={11} />
              </span>
            )}
          </button>
          <span className="project-panel-name">
            {summary?.name ?? '—'}
          </span>
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
          onClick={closeProjectPanel}
          title={t('projectPanel.closeTitle')}
          aria-label={t('projectPanel.closeAria')}
        >
          <X size={16} />
        </button>
      </div>

      {detailEntry === 'loading' && (
        <div className="project-panel-loading" role="status">{t('projectPanel.loading')}</div>
      )}
      {detailEntry === 'error' && (
        <div className="project-panel-error" role="alert">
          {t('projectPanel.loadError')}
          <button
            className="project-panel-retry"
            onClick={() => void loadProjectDetail(focusedProjectId, { force: true })}
          >
            {t('projectPanel.retry')}
          </button>
        </div>
      )}

      {detail && (
        <>
          <section className="project-panel-section">
            <div className="project-panel-statusrow">
              <span
                className="project-panel-state-pill"
                style={{ '--proj-state-color': PROJECT_STATE_COLOR[detail.state] } as React.CSSProperties}
              >
                <span className="project-panel-state-dot" />
                {t(PROJECT_STATE_DICT_KEY[detail.state])}
              </span>
            </div>
            <div className="project-panel-progress-row">
              <div className="project-panel-progress-bar" aria-hidden>
                <div
                  className="project-panel-progress-bar-fill"
                  style={{ width: `${Math.round(detail.progress * 100)}%` }}
                />
              </div>
              <span className="project-panel-progress-label">
                {t('projectPanel.linearProgress', { percent: Math.round(detail.progress * 100) })}
                {' · '}
                {t('projectPanel.issuesProgress', { done: counts.done, total: counts.total })}
              </span>
            </div>
            <dl className="project-panel-meta">
              <div>
                <dt>{t('projectPanel.lead')}</dt>
                <dd>{detail.lead?.displayName ?? t('projectPanel.noLead')}</dd>
              </div>
              <div>
                <dt>{t('projectPanel.target')}</dt>
                <dd>{formatDate(detail.targetDate) ?? t('projectPanel.noDate')}</dd>
              </div>
              <div>
                <dt>{t('projectPanel.startDate')}</dt>
                <dd>{formatDate(detail.startDate) ?? t('projectPanel.noDate')}</dd>
              </div>
            </dl>
          </section>

          <section className="project-panel-section">
            <h3 className="project-panel-section-title">{t('projectPanel.milestones')}</h3>
            {rollups.length === 0 ? (
              <div className="project-panel-empty">{t('projectPanel.noMilestones')}</div>
            ) : (
              <ul className="project-panel-milestones" ref={milestonesListRef}>
                {rollups.map((m) => {
                  const pct = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0
                  return (
                    <li key={m.id} className="project-panel-milestone" data-milestone-id={m.id}>
                      <span className="project-panel-milestone-name">{m.name}</span>
                      <span className="project-panel-milestone-counts">{m.done}/{m.total}</span>
                      <div className="project-panel-milestone-bar" aria-label={`${pct}%`}>
                        <div className="project-panel-milestone-bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                      {m.description && (
                        <details className="project-panel-milestone-details">
                          <summary className="project-panel-milestone-details-summary">
                            {t('projectPanel.milestoneDetails')}
                          </summary>
                          <div className="project-panel-milestone-description">
                            <MarkdownBody body={m.description} />
                          </div>
                        </details>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className="project-panel-section">
            <h3 className="project-panel-section-title">{t('projectPanel.byState')}</h3>
            <ul className="project-panel-by-state">
              {STATE_DISPLAY_ORDER.map((s) => (
                <li key={s} className="project-panel-by-state-row">
                  <span className="project-panel-by-state-name">{t(ISSUE_STATE_DICT_KEY[s])}</span>
                  <span className="project-panel-by-state-count">{counts.byState[s]}</span>
                </li>
              ))}
            </ul>
          </section>

          {(detail.content || detail.description) && (
            <section className="project-panel-section">
              <h3 className="project-panel-section-title">{t('projectPanel.description')}</h3>
              <div className="project-panel-description">
                <MarkdownBody body={detail.content || detail.description || ''} />
              </div>
            </section>
          )}

          {detail.updates.length > 0 && (
            <section className="project-panel-section">
              <h3 className="project-panel-section-title">{t('projectPanel.updates')}</h3>
              <ul className="project-panel-updates">
                {detail.updates.map((u) => (
                  <li key={u.id} className="project-panel-update">
                    <div className="project-panel-update-head">
                      <span className="project-panel-update-author">{u.userName ?? '—'}</span>
                      <span className="project-panel-update-time">
                        {formatDate(u.createdAt) ?? ''}
                      </span>
                    </div>
                    <div className="project-panel-update-body">
                      <MarkdownBody body={u.body} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </aside>
  )
}
