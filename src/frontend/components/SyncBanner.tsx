// Workspace-change warning banner. The sync metadata that used to live
// here (last-sync, issue/doc counts, refresh button, workspace picker)
// moved into `TabBar` as part of unifying the two header rows. This
// component renders two red bars:
//
//   1. The active workspace's credentials were rejected by the backend. This
//      used to be handled by showing the setup screen, but that screen now
//      means "no workspaces exist" — a workspace that exists with a bad key is
//      a different problem and needs a different message, or the graph just
//      renders empty with no explanation.
//   2. The backend detects that the active Linear API key resolves to a
//      different `viewer.organization.urlKey` than the last sync — i.e. the
//      cache may contain stale issues from a previous workspace.

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
  const authError = graph?.authError ?? false

  if (authError) {
    return (
      <div className="sync-banner-error">
        <span style={{ fontWeight: 600 }}>{t('syncBanner.authError')}</span>
        <span style={{ opacity: 0.9 }}>{t('syncBanner.authErrorHelp')}</span>
        <button onClick={() => setSettingsOpen(true)} title={t('syncBanner.openSettingsTitle')}>
          {t('syncBanner.openSettings')}
        </button>
      </div>
    )
  }

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
