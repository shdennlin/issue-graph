import { useEffect, useMemo, useState } from 'react'
import type { DesignDocCoverage } from '@shared/types.js'
import { useViewStore } from '../store/viewStore'
import { api } from '../lib/api'

type StrategyFilter = 'all' | 'linked' | 'unlinked'

export function CoverageModal() {
  const open = useViewStore((s) => s.coverageOpen)
  const close = useViewStore((s) => s.setCoverageOpen)
  const [data, setData] = useState<DesignDocCoverage | null>(null)
  const [filter, setFilter] = useState<StrategyFilter>('all')

  useEffect(() => {
    if (!open) return
    setData(null)
    api.fetchCoverage().then(setData).catch(() => setData(null))
  }, [open])

  const filteredChanges = useMemo(() => {
    if (!data) return []
    if (filter === 'linked') return data.perChange.filter((c) => c.ids.length > 0)
    if (filter === 'unlinked') return data.perChange.filter((c) => c.ids.length === 0)
    return data.perChange
  }, [data, filter])

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={() => close(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ flex: 1, margin: 0 }}>Design-doc Coverage</h3>
          <button onClick={() => close(false)}>×</button>
        </div>

        {!data && <p style={{ color: 'var(--fg-muted)' }}>Loading…</p>}

        {data && (
          <>
            <p style={{ color: 'var(--fg-muted)', fontSize: 12, marginTop: 0, lineHeight: 1.5 }}>
              The adapter scans <code>openspec/changes/*/proposal.md</code> and tries 3 ways to link each
              change to a Linear issue: <strong>frontmatter</strong> (<code>linear: [PROJ-123]</code>),{' '}
              <strong>folder name</strong> (<code>PROJ-123-some-feature/</code>), or any{' '}
              <strong>line mentioning "linear"</strong>. Results below show what was found — fix gaps by
              adding any of the three to your proposal.
            </p>
            {data.totalChanges === 0 && (
              <p style={{ color: 'var(--warn)', fontSize: 13, marginTop: 0 }}>
                No design-doc changes detected at all. Set <code>REPO_PATH</code> in <code>.env</code> to
                your repo root (e.g. <code>/Users/you/myproject</code>) and click 🔄 Refresh.
              </p>
            )}

            {/* Top-line numbers */}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
              <Stat label="Total changes" value={data.totalChanges} />
              <Stat label="Linked" value={data.linkedChanges} tone="ok" />
              <Stat label="Unlinked" value={data.unlinkedChanges} tone={data.unlinkedChanges > 0 ? 'warn' : 'ok'} />
              <Stat label="Issues missing doc" value={data.issuesMissingDoc.length} tone={data.issuesMissingDoc.length > 0 ? 'warn' : 'ok'} />
            </div>

            {/* Per-strategy breakdown */}
            <h4 style={{ margin: '12px 0 6px', fontSize: 12, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Linked via strategy
            </h4>
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: 13 }}>
              <span><strong>{data.byStrategy.frontmatter}</strong> frontmatter</span>
              <span><strong>{data.byStrategy.folderName}</strong> folder name</span>
              <span><strong>{data.byStrategy.regexLine}</strong> regex line</span>
            </div>

            {/* Per-change list */}
            <h4 style={{ margin: '12px 0 6px', fontSize: 12, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Per-change ({filteredChanges.length})
            </h4>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, fontSize: 12 }}>
              <button onClick={() => setFilter('all')} className={filter === 'all' ? 'active' : ''}>All</button>
              <button onClick={() => setFilter('linked')} className={filter === 'linked' ? 'active' : ''}>Linked</button>
              <button onClick={() => setFilter('unlinked')} className={filter === 'unlinked' ? 'active' : ''}>Unlinked</button>
            </div>
            <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--node-border)', borderRadius: 6 }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-elev)' }}>
                  <tr style={{ textAlign: 'left', color: 'var(--fg-muted)' }}>
                    <th style={{ padding: '4px 8px' }}>Change</th>
                    <th style={{ padding: '4px 8px' }}>Status</th>
                    <th style={{ padding: '4px 8px' }}>IDs</th>
                    <th style={{ padding: '4px 8px' }}>Sources</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredChanges.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ padding: 12, textAlign: 'center', color: 'var(--fg-muted)' }}>
                        {filter === 'linked'
                          ? 'No changes linked yet. Add a Linear ID to any proposal.md (see top of this modal).'
                          : filter === 'unlinked'
                            ? 'All changes are linked to at least one Linear issue. ✓'
                            : 'No design-doc changes detected.'}
                      </td>
                    </tr>
                  )}
                  {filteredChanges.map((c) => (
                    <tr key={c.filePath} style={{ borderTop: '1px solid var(--node-border)' }}>
                      <td style={{ padding: '4px 8px' }}>
                        <span title={c.filePath} style={{ fontFamily: 'var(--font-mono)' }}>{c.name}</span>
                      </td>
                      <td style={{ padding: '4px 8px' }}>
                        <span className="chip" style={{ fontSize: 10 }}>{c.status}</span>
                      </td>
                      <td style={{ padding: '4px 8px' }}>
                        {c.ids.length === 0
                          ? <span style={{ color: 'var(--warn)' }}>none</span>
                          : c.ids.join(', ')}
                      </td>
                      <td style={{ padding: '4px 8px' }}>
                        <SourceTags sources={c.sources} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Issues missing design doc */}
            {data.issuesMissingDoc.length > 0 && (
              <>
                <h4 style={{ margin: '16px 0 6px', fontSize: 12, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Active issues without design doc ({data.issuesMissingDoc.length})
                </h4>
                <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--node-border)', borderRadius: 6 }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-elev)' }}>
                      <tr style={{ textAlign: 'left', color: 'var(--fg-muted)' }}>
                        <th style={{ padding: '4px 8px' }}>ID</th>
                        <th style={{ padding: '4px 8px' }}>State</th>
                        <th style={{ padding: '4px 8px' }}>Title</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.issuesMissingDoc.map((i) => (
                        <tr key={i.identifier} style={{ borderTop: '1px solid var(--node-border)' }}>
                          <td style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)' }}>
                            <a href={i.url} target="_blank" rel="noreferrer">{i.identifier}</a>
                          </td>
                          <td style={{ padding: '4px 8px' }}>{i.state}</td>
                          <td style={{ padding: '4px 8px' }}>{i.title}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <details style={{ marginTop: 14, fontSize: 12, color: 'var(--fg-muted)' }}>
              <summary style={{ cursor: 'pointer' }}>How to add a link</summary>
              <div style={{ marginTop: 6 }}>
                <p style={{ margin: '4px 0' }}><strong>Frontmatter (recommended):</strong> add to top of <code>proposal.md</code></p>
                <pre style={{ background: 'var(--chip-bg)', padding: 6, borderRadius: 4 }}>{`---
linear: [PROJ-123, PROJ-456]
---`}</pre>
                <p style={{ margin: '4px 0' }}><strong>Folder name:</strong> rename change dir to <code>PROJ-123-some-feature/</code></p>
                <p style={{ margin: '4px 0' }}><strong>Regex line:</strong> any line in <code>proposal.md</code> mentioning "linear" — e.g. <code>Linear: PROJ-123</code></p>
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' }) {
  const color = tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : 'var(--fg)'
  return (
    <div style={{ padding: '6px 12px', background: 'var(--bg-elev)', border: '1px solid var(--node-border)', borderRadius: 6 }}>
      <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color }}>{value}</div>
    </div>
  )
}

function SourceTags({ sources }: { sources: { frontmatter: string[]; folderName: string[]; regexLine: string[] } }) {
  const tags: { name: string; ids: string[] }[] = [
    { name: 'frontmatter', ids: sources.frontmatter },
    { name: 'folder', ids: sources.folderName },
    { name: 'regex', ids: sources.regexLine },
  ].filter((t) => t.ids.length > 0)
  if (tags.length === 0) return <span style={{ color: 'var(--fg-muted)' }}>—</span>
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      {tags.map((t) => (
        <span key={t.name} className="chip" style={{ fontSize: 10 }} title={t.ids.join(', ')}>
          {t.name}
        </span>
      ))}
    </span>
  )
}
