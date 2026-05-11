// Workspace-change warning banner. The sync metadata that used to live
// here (last-sync, issue/doc counts, refresh button, workspace picker)
// moved into `TabBar` as part of unifying the two header rows. This
// component now only renders the red warning bar shown when the backend
// detects that the active Linear API key resolves to a different
// `viewer.organization.urlKey` than the last sync — i.e. the cache may
// contain stale issues from a previous workspace.

import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { api } from '../lib/api'
import { useT } from '../i18n'

export function SyncBanner() {
  const graph = useGraphStore((s) => s.graph)
  const reloadGraph = useGraphStore((s) => s.load)
  const setSettingsOpen = useViewStore((s) => s.setSettingsOpen)
  const t = useT()
  const warning = graph?.workspaceWarning ?? null

  if (!warning) return null

  const dismiss = async () => {
    await api.acknowledgeWorkspaceChange()
    await reloadGraph()
  }

  return (
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
      <span style={{ fontWeight: 600 }}>{t('syncBanner.workspaceChanged')}</span>
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
        {t('syncBanner.cacheStale')}
      </span>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        <button
          onClick={() => setSettingsOpen(true)}
          style={{ background: '#fff', color: 'var(--danger, #b91c1c)', fontWeight: 600 }}
          title={t('syncBanner.openSettingsTitle')}
        >
          {t('syncBanner.openSettings')}
        </button>
        <button onClick={dismiss} title={t('syncBanner.dismissTitle')}>
          {t('syncBanner.dismiss')}
        </button>
      </span>
    </div>
  )
}
