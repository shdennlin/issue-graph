import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink, Maximize2, Minimize2, Type, X } from 'lucide-react'
import { marked } from 'marked'
import type { AnnotationDTO, NormalizedIssue } from '@shared/types.js'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { useSchemaStore } from '../store/schemaStore'
import { useResizable } from '../hooks/useResizable'
import { api } from '../lib/api'
import { stateLabel, priorityLabel } from '../lib/colors'
import { getDesignDocsForIssue } from '../lib/labelSchema'

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Per-panel preferences — independent from the global theme/font-size settings
// so users who want a roomier read of a single issue without inflating the rest
// of the UI can opt in here.
const WIDE_MODE_KEY = 'ig-detail-wide-v1'
const TEXT_SIZE_KEY = 'ig-detail-text-size-v1'
type TextSize = 'sm' | 'md' | 'lg'

export function DetailPanel() {
  const focusedId = useViewStore((s) => s.focusedId)
  const setFocusedId = useViewStore((s) => s.setFocusedId)
  const graph = useGraphStore((s) => s.graph)
  const reload = useGraphStore((s) => s.load)
  const { schema } = useSchemaStore()
  const [description, setDescription] = useState<string | null>(null)
  const [descLoading, setDescLoading] = useState(false)
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
      return v === 'sm' || v === 'lg' ? v : 'md'
    } catch { return 'md' }
  })

  const toggleWide = useCallback(() => {
    setWideMode((prev) => {
      const next = !prev
      try { localStorage.setItem(WIDE_MODE_KEY, next ? '1' : '0') } catch { /* silent */ }
      return next
    })
  }, [])

  const cycleTextSize = useCallback(() => {
    setTextSize((prev) => {
      const next: TextSize = prev === 'sm' ? 'md' : prev === 'md' ? 'lg' : 'sm'
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
    if (!issueId) return
    setDescLoading(true)
    api
      .fetchIssueDetail(issueId)
      .then((res) => setDescription(res.data.description ?? ''))
      .catch(() => setDescription(null))
      .finally(() => setDescLoading(false))
  }, [issueId])

  const { width, startResize, resizing } = useResizable({
    storageKey: 'ig-detail-panel-w',
    defaultWidth: 380,
    min: 280,
    max: 720,
    side: 'right',
  })

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
    if (!confirm('Delete this annotation?')) return
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
      style={wideMode ? undefined : { width, flexShrink: 0 }}
    >
      <div className="resize-handle resize-handle-left" onMouseDown={startResize} title="Drag to resize" />
      <div className="detail-header">
        <h2>
          <span className="detail-identifier">{issue.identifier}</span>{' '}
          {issue.title}
        </h2>
        <button
          className="icon-only"
          onClick={cycleTextSize}
          title={`Text size: ${textSize} (click to cycle sm/md/lg)`}
          aria-label="Cycle text size"
        >
          <Type size={14} />
        </button>
        <button
          className="icon-only"
          onClick={toggleWide}
          title={wideMode ? 'Collapse to side panel' : 'Expand to wide view'}
          aria-label={wideMode ? 'Collapse to side panel' : 'Expand to wide view'}
        >
          {wideMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <button
          className="icon-only detail-close"
          onClick={() => setFocusedId(null)}
          title="Close (Esc)"
          aria-label="Close detail panel"
        >
          <X size={16} />
        </button>
      </div>
      <a className="detail-source-link" href={issue.url} target="_blank" rel="noreferrer">
        Open in source <ExternalLink size={12} />
      </a>

      <div className="section">
        <div className="row"><span className="k">State</span><span>{stateLabel(issue.state.type)}</span></div>
        <div className="row"><span className="k">Priority</span><span>{priorityLabel(issue.priority)}</span></div>
        <div className="row"><span className="k">Assignee</span><span>{issue.assignee?.displayName ?? 'unassigned'}</span></div>
        <div className="row"><span className="k">Created</span><span>{timeAgo(issue.createdAt)}</span></div>
        <div className="row"><span className="k">Updated</span><span>{timeAgo(issue.updatedAt)}</span></div>
        {schema.primaryGroup && (
          <div className="row">
            <span className="k">{schema.primaryGroup}</span>
            <span>{issue.labels.find((l) => l.group?.name === schema.primaryGroup)?.name ?? '—'}</span>
          </div>
        )}
      </div>

      {docs.length > 0 && (
        <div className="section">
          <h3>Design docs ({docs.length})</h3>
          {docs.length > 1 && (
            <div className="detail-spec-warn">
              <AlertTriangle size={14} className="detail-spec-warn-icon" />
              <span>
                This issue spans <strong>{docs.length}</strong> design-doc changes (specs).
                A spec is one delivery batch — an issue covering multiple specs is usually
                too large for a single batch. Consider splitting it into per-spec sub-issues.
              </span>
            </div>
          )}
          {docs.map((d) => (
            <details key={d.name} open={docs.length === 1}>
              <summary>
                {d.name} {d.status === 'parked' && '(parked)'} — {d.doneTasks}/{d.totalTasks}
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
          <h3>Blocks</h3>
          {blocksIn.length > 0 && (
            <div>
              <div style={{ color: 'var(--fg-muted)', fontSize: 11 }}>Blocked by</div>
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
              <div style={{ color: 'var(--fg-muted)', fontSize: 11 }}>Blocks</div>
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
          <h3>Related ({relatedList.length})</h3>
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
        <h3>Annotations ({annotations.length})</h3>
        {annotations.map((a) => (
          <div key={a.id} style={{ borderTop: '1px solid var(--node-border)', paddingTop: 6, marginTop: 6 }}>
            {editingId === a.id ? (
              <>
                <textarea value={editingBody} onChange={(e) => setEditingBody(e.target.value)} rows={3} style={{ width: '100%' }} />
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  <button className="primary" onClick={saveEdit}>Save</button>
                  <button onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <div dangerouslySetInnerHTML={{ __html: marked.parse(a.body) as string }} />
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  <button onClick={() => { setEditingId(a.id); setEditingBody(a.body) }}>Edit</button>
                  <button onClick={() => remove(a.id)}>Delete</button>
                  <span style={{ color: 'var(--fg-muted)', fontSize: 11, marginLeft: 'auto' }}>
                    {timeAgo(new Date(a.updatedAt).toISOString())}
                  </span>
                </div>
              </>
            )}
          </div>
        ))}
        <textarea
          rows={3}
          placeholder="Add annotation (markdown)…"
          value={annotationDraft}
          onChange={(e) => setAnnotationDraft(e.target.value)}
          style={{ width: '100%', marginTop: 6 }}
        />
        <button className="primary" onClick={submitAnnotation} style={{ marginTop: 4 }}>Add annotation</button>
      </div>

      <div className="section">
        <h3>Description</h3>
        {descLoading && (
          <div className="skeleton-stack" aria-busy="true" aria-label="Loading description">
            <div className="skeleton skeleton-line" style={{ width: '92%' }} />
            <div className="skeleton skeleton-line" style={{ width: '78%' }} />
            <div className="skeleton skeleton-line" style={{ width: '85%' }} />
            <div className="skeleton skeleton-line" style={{ width: '40%' }} />
          </div>
        )}
        {!descLoading && description !== null && (
          <div dangerouslySetInnerHTML={{ __html: marked.parse(description || '*No description*') as string }} />
        )}
        {!descLoading && description === null && <div style={{ color: 'var(--fg-muted)' }}>Could not load description.</div>}
      </div>
    </aside>
  )
}
