import { useEffect, useState } from 'react'
import type { SyncLogEntry } from '@shared/types.js'
import { useViewStore } from '../store/viewStore'
import { api } from '../lib/api'

export function SyncHistoryModal() {
  const open = useViewStore((s) => s.syncHistoryOpen)
  const close = useViewStore((s) => s.setSyncHistoryOpen)
  const [entries, setEntries] = useState<SyncLogEntry[]>([])

  useEffect(() => {
    if (!open) return
    api.fetchSyncHistory().then((res) => setEntries(res.entries)).catch(() => undefined)
  }, [open])

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={() => close(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ flex: 1, margin: 0 }}>Sync History</h3>
          <button onClick={() => close(false)}>×</button>
        </div>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--fg-muted)' }}>
              <th>Started</th><th>Status</th><th>Issues</th><th>Duration</th><th>Error</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} style={{ borderTop: '1px solid var(--node-border)' }}>
                <td>{new Date(e.startedAt).toLocaleString()}</td>
                <td>{e.status}</td>
                <td>{e.issuesCount ?? '—'}</td>
                <td>{e.finishedAt ? `${e.finishedAt - e.startedAt}ms` : '—'}</td>
                <td style={{ color: 'var(--danger)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.errorMessage ?? ''}>
                  {e.errorMessage ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
