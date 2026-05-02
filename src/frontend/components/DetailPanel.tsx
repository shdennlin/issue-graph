import { useEffect, useState } from 'react'
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

  const issue = focusedId ? graph?.data.issues.find((i) => i.identifier === focusedId) : null

  useEffect(() => {
    setDescription(null)
    if (!issue) return
    setDescLoading(true)
    api
      .fetchIssueDetail(issue.identifier)
      .then((res) => setDescription(res.data.description ?? ''))
      .catch(() => setDescription(null))
      .finally(() => setDescLoading(false))
  }, [issue?.identifier])

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

  return (
    <aside
      className={`detail-panel${resizing ? ' is-resizing' : ''}`}
      style={{ width, flexShrink: 0 }}
    >
      <div className="resize-handle resize-handle-left" onMouseDown={startResize} title="Drag to resize" />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <h2 style={{ flex: 1 }}>
          <span style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            {issue.identifier}
          </span>{' '}
          {issue.title}
        </h2>
        <button onClick={() => setFocusedId(null)} title="Close">×</button>
      </div>
      <a href={issue.url} target="_blank" rel="noreferrer">Open in source ↗</a>

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
        {descLoading && <div style={{ color: 'var(--fg-muted)' }}>Loading…</div>}
        {!descLoading && description !== null && (
          <div dangerouslySetInnerHTML={{ __html: marked.parse(description || '*No description*') as string }} />
        )}
        {!descLoading && description === null && <div style={{ color: 'var(--fg-muted)' }}>Could not load description.</div>}
      </div>
    </aside>
  )
}
