import { useEffect, useState } from 'react'
import type { SyncLogEntry } from '@shared/types.js'
import { useViewStore } from '../store/viewStore'
import { api } from '../lib/api'
import { ModalHeader } from './ModalHeader'
import { useT } from '../i18n'

export function SyncHistoryModal() {
  const open = useViewStore((s) => s.syncHistoryOpen)
  const close = useViewStore((s) => s.setSyncHistoryOpen)
  const t = useT()
  const [entries, setEntries] = useState<SyncLogEntry[]>([])

  useEffect(() => {
    if (!open) return
    api.fetchSyncHistory().then((res) => setEntries(res.entries)).catch(() => undefined)
  }, [open])

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={() => close(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <ModalHeader title={t('syncHistory.title')} onClose={() => close(false)} />
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--fg-muted)' }}>
              <th>{t('syncHistory.started')}</th><th>{t('syncHistory.status')}</th><th>{t('syncHistory.issues')}</th><th>{t('syncHistory.duration')}</th><th>{t('syncHistory.error')}</th>
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
