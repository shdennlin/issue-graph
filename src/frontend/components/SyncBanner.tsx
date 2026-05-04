import { useEffect, useState } from 'react'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'

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
  const setSyncHistoryOpen = useViewStore((s) => s.setSyncHistoryOpen)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const last = graph?.fetchedAt ?? 0
  const age = last ? Math.floor((Date.now() - last) / 60_000) : Infinity

  return (
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
  )
}
