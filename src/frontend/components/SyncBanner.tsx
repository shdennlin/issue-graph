import { useEffect, useState } from 'react'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { api } from '../lib/api'
import type { WorkspaceListResponse } from '../lib/api'

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
  const [workspaces, setWorkspaces] = useState<WorkspaceListResponse | null>(null)
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false)
  const warning = graph?.workspaceWarning ?? null

  const dismissWarning = async () => {
    await api.acknowledgeWorkspaceChange()
    await reloadGraph()
  }

  useEffect(() => {
    api.fetchWorkspaces().then(setWorkspaces).catch(() => setWorkspaces(null))
  }, [])

  const last = graph?.fetchedAt ?? 0
  const age = last ? Math.floor((Date.now() - last) / 60_000) : Infinity
  const lastSyncText = `Last sync: ${graph === null ? 'loading…' : isFinite(age) ? format(age) : 'never'}${
    graph?.stale ? ' (stale)' : ''
  }`

  const switchWorkspace = async (id: string) => {
    if (!id || id === workspaces?.active?.id) return
    setSwitchingWorkspace(true)
    try {
      await api.switchWorkspace(id)
      window.location.reload()
    } catch (err) {
      setSwitchingWorkspace(false)
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      {switchingWorkspace && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              background: 'var(--bg-elev, #fff)',
              color: 'var(--fg)',
              padding: '20px 24px',
              borderRadius: 8,
              boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
              fontWeight: 600,
            }}
          >
            Switching workspace…
          </div>
        </div>
      )}
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
        {workspaces && !workspaces.legacyMode && workspaces.profiles.length > 0 ? (
          <label className="workspace-select" title="Active Linear workspace profile">
            <span className="status-dot" aria-hidden />
            <span className="workspace-select-label">{workspaces.active?.name ?? graph?.instanceLabel ?? 'issue-graph'}</span>
            <select
              value={workspaces.active?.id ?? ''}
              onChange={(e) => switchWorkspace(e.target.value)}
              disabled={switchingWorkspace || syncing || status === 'loading'}
              aria-label="Active Linear workspace profile"
            >
              {workspaces.profiles.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <span className="select-chevron" aria-hidden>▾</span>
          </label>
        ) : (
          <span className="pill">
            <span className="status-dot" aria-hidden /> {graph?.instanceLabel ?? 'issue-graph'}
          </span>
        )}
      </div>
      <div className="right">
        <span
          className={`last-sync-link ${isFinite(age) ? colorClass(age) : 'stale-bad'}`}
          onClick={() => setSyncHistoryOpen(true)}
          title="Click for sync history"
        >
          {lastSyncText}
        </span>
        <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
          {graph?.data.issues.length ?? 0} issues · {graph?.data.designdocs?.length ?? 0} docs
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
