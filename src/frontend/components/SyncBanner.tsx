import { useEffect, useState } from 'react'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { api } from '../lib/api'

function colorClass(ageMinutes: number): string {
  if (ageMinutes < 5) return 'stale-ok'
  if (ageMinutes < 30) return 'stale-warn'
  return 'stale-bad'
}

function format(age: number): string {
  if (age < 1) return 'just now'
  if (age < 60) return `${age}m ago`
  const h = Math.floor(age / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function SyncBanner() {
  const graph = useGraphStore((s) => s.graph)
  const status = useGraphStore((s) => s.status)
  const syncing = useGraphStore((s) => s.syncing)
  const forceSync = useGraphStore((s) => s.forceSync)
  const reloadGraph = useGraphStore((s) => s.load)
  const setSyncHistoryOpen = useViewStore((s) => s.setSyncHistoryOpen)
  const setSettingsOpen = useViewStore((s) => s.setSettingsOpen)
  const [tick, setTick] = useState(0)
  const warning = graph?.workspaceWarning ?? null

  const dismissWarning = async () => {
    await api.acknowledgeWorkspaceChange()
    await reloadGraph()
  }

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const last = graph?.fetchedAt ?? 0
  const age = last ? Math.floor((Date.now() - last) / 60_000) : Infinity

  return (
    <>
      {warning && (
        <div
          style={{
            background: 'var(--danger, #b91c1c)',
            color: '#fff',
            padding: '8px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 13,
          }}
        >
          <span style={{ fontWeight: 600 }}>⚠ Workspace changed:</span>
          <span>
            <code style={{ background: 'rgba(255,255,255,0.18)', padding: '1px 5px', borderRadius: 3 }}>
              {warning.previous}
            </code>{' '}
            →{' '}
            <code style={{ background: 'rgba(255,255,255,0.18)', padding: '1px 5px', borderRadius: 3 }}>
              {warning.current}
            </code>
          </span>
          <span style={{ opacity: 0.9 }}>
            Cache may contain stale issues from the previous workspace.
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              onClick={() => setSettingsOpen(true)}
              style={{ background: '#fff', color: 'var(--danger, #b91c1c)', fontWeight: 600 }}
              title="Open Settings → Reset cache & re-sync"
            >
              Open Settings
            </button>
            <button onClick={dismissWarning} title="Dismiss this warning without resetting">
              Dismiss
            </button>
          </span>
        </div>
      )}
    <div className="banner">
      <div className="left">
        <span className="pill" title="Click for sync history" onClick={() => setSyncHistoryOpen(true)} style={{ cursor: 'pointer' }}>
          {graph?.instanceLabel ? `🟢 ${graph.instanceLabel}` : '🟢 issue-graph'}
        </span>
        <span
          className={isFinite(age) ? colorClass(age) : 'stale-bad'}
          onClick={() => setSyncHistoryOpen(true)}
          style={{ cursor: 'pointer' }}
          title="Click for sync history"
        >
          {`Last sync: ${graph === null ? 'loading…' : isFinite(age) ? format(age) : 'never'}`}
          {graph?.stale && ' (stale)'}
        </span>
      </div>
      <div className="right">
        <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
          {graph?.data.issues.length ?? 0} issues · {graph?.data.designdocs?.length ?? 0} docs
          <span aria-hidden> · </span>
          <span title="tick">{tick}</span>
        </span>
        <button
          onClick={forceSync}
          disabled={status === 'loading'}
          title="Shift-click to force a fresh fetch"
        >
          {syncing ? '⏳ Syncing…' : status === 'loading' ? '⏳ Loading…' : '↻ Refresh'}
        </button>
      </div>
    </div>
    </>
  )
}
