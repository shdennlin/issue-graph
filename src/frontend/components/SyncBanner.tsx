import { useCallback, useRef, useState } from 'react'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { useClickOutside } from '../hooks/useClickOutside'
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
  const profiles = useWorkspaceStore((s) => s.profiles)
  const legacyMode = useWorkspaceStore((s) => s.legacyMode)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const activeTabId = useWorkspaceStore((s) => s.activeTabId)
  const changeTabWorkspace = useWorkspaceStore((s) => s.changeTabWorkspace)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLLabelElement | null>(null)
  const warning = graph?.workspaceWarning ?? null

  const dismissWarning = async () => {
    await api.acknowledgeWorkspaceChange()
    await reloadGraph()
  }

  const closePicker = useCallback(() => setPickerOpen(false), [])
  useClickOutside(pickerRef, pickerOpen, closePicker)

  const last = graph?.fetchedAt ?? 0
  const age = last ? Math.floor((Date.now() - last) / 60_000) : Infinity
  const lastSyncText = `Last sync: ${graph === null ? 'loading…' : isFinite(age) ? format(age) : 'never'}${
    graph?.stale ? ' (stale)' : ''
  }`

  const showPicker = !legacyMode && profiles.length > 0
  const activeName = profiles.find((p) => p.id === currentWorkspaceId)?.name
    ?? graph?.instanceLabel
    ?? 'issue-graph'

  // Repointing this tab at a different workspace, in place. Different
  // from clicking another tab in the TabBar — that switches active tab
  // (which has its own filters/focus). This swap KEEPS the current
  // tab's filters / focus / chain isolation but applies them to a
  // different workspace's data.
  const onPickWorkspace = (workspaceId: string) => {
    setPickerOpen(false)
    if (!activeTabId) return
    if (workspaceId === currentWorkspaceId) return
    changeTabWorkspace(activeTabId, workspaceId)
  }

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
        {showPicker ? (
          <label
            ref={pickerRef}
            className="workspace-picker"
            title="Change this tab's workspace (keeps filters/focus)"
          >
            <button
              type="button"
              className="pill workspace-picker-button"
              aria-haspopup="menu"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen(!pickerOpen)}
            >
              <span className="status-dot" aria-hidden /> {activeName}
              <span className="select-chevron" aria-hidden>▾</span>
            </button>
            {pickerOpen && (
              <div className="workspace-picker-menu" role="menu">
                {profiles.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitem"
                    className={`workspace-picker-item${p.id === currentWorkspaceId ? ' is-current' : ''}`}
                    onClick={() => onPickWorkspace(p.id)}
                    title={p.id === currentWorkspaceId ? 'Already on this workspace' : `Switch this tab to ${p.name}`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
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
