import { useMemo } from 'react'
import { useNotificationStore } from '../store/notificationStore'
import { useGraphStore } from '../store/graphStore'
import { buildNameLookup, describeScope } from '../lib/describeScope'
import { parseScope } from '../lib/notificationScope'
import { NotificationScopeEditor } from './NotificationScopeEditor'
import { useLocale } from '../i18n'
import { useSavedViewsStore } from '../store/savedViewsStore'
import { currentQuery } from '../store/urlSync'
import { useT } from '../i18n'

/**
 * The Notifications block of Settings.
 *
 * Its own file because it is the one settings group that writes nowhere near
 * the server: every control here lands in localStorage via `preferences.ts`.
 * That is the point rather than an implementation detail — several people can
 * reach one instance, and each of them wants to be interrupted about different
 * things, so a shared `setting` row would let them overwrite each other.
 */
export function NotificationSettings({ webhookConfigured }: { webhookConfigured: boolean }) {
  const enabled = useNotificationStore((s) => s.enabled)
  const setEnabled = useNotificationStore((s) => s.setEnabled)
  const desktopEnabled = useNotificationStore((s) => s.desktopEnabled)
  const setDesktopEnabled = useNotificationStore((s) => s.setDesktopEnabled)
  const support = useNotificationStore((s) => s.support)
  const requestPermission = useNotificationStore((s) => s.requestPermission)
  const scopeQuery = useNotificationStore((s) => s.scopeQuery)
  const setScopeQuery = useNotificationStore((s) => s.setScopeQuery)
  const savedViews = useSavedViewsStore((s) => s.views)
  const graph = useGraphStore((s) => s.graph)
  const t = useT()
  const locale = useLocale()

  // Both passes are O(issues) and the scope changes only on an explicit click,
  // so without memoising they would rerun on every keystroke elsewhere in
  // Settings. React Compiler is not enabled here — see CLAUDE.md.
  const names = useMemo(
    () => buildNameLookup(graph?.data.issues ?? [], graph?.data.labels ?? []),
    [graph],
  )
  const scopeLines = useMemo(() => {
    const parsed = parseScope(scopeQuery)
    return parsed ? describeScope(parsed.filters, names, t, locale) : []
  }, [scopeQuery, names, t, locale])

  // Three states, like capabilityStore's write controls: impossible here /
  // possible but not granted / available. `null` would mean "not asked yet",
  // which cannot happen for this probe — it reads synchronously at store init.
  const unsupported = support === 'unsupported'
  const denied = support === 'denied'
  const desktopBlocked = unsupported || denied || !webhookConfigured

  // A saved view whose stored query is exactly the current scope. Matching on
  // the query rather than remembering an id is the same trick savedViewMatch
  // uses: edit the view and the match simply stops holding.
  const matchedView = savedViews.find((v) => v.query === scopeQuery)
  const scoped = scopeQuery !== ''

  return (
    <>
      <h4>{t('notifications.settingsHeading')}</h4>

      <label style={{ display: 'block', marginBottom: 4 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{' '}
        {t('notifications.enable')}
      </label>
      <div className="settings-help" style={{ marginBottom: 10 }}>
        {t('notifications.enableHelp')}
      </div>

      <label style={{ display: 'block', marginBottom: 4, opacity: desktopBlocked ? 0.55 : 1 }}>
        <input
          type="checkbox"
          checked={desktopEnabled && !desktopBlocked}
          disabled={desktopBlocked}
          onChange={async (e) => {
            // requestPermission MUST run inside this gesture — asking on mount
            // is what gets a prompt silently suppressed.
            if (e.target.checked && support !== 'granted') await requestPermission()
            const granted = useNotificationStore.getState().support === 'granted'
            setDesktopEnabled(e.target.checked && granted)
          }}
        />{' '}
        {t('notifications.desktop')}
      </label>
      <div className="settings-help" style={{ marginBottom: 10 }}>
        {unsupported
          ? t('notifications.desktopUnsupported')
          : denied
            ? t('notifications.desktopDenied')
            : !webhookConfigured
              ? t('notifications.desktopNeedsWebhook')
              : t('notifications.desktopBackgroundCaveat')}
      </div>

      <label style={{ display: 'block', marginBottom: 4 }}>
        {t('notifications.scope')}{' '}
        <select
          value={matchedView ? `view:${matchedView.id}` : scoped ? 'custom' : 'all'}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'all') return setScopeQuery('')
            if (v.startsWith('view:')) {
              const id = Number(v.slice(5))
              const view = savedViews.find((x) => x.id === id)
              if (view) setScopeQuery(view.query)
            }
            // 'custom' is not selectable — it only ever describes a snapshot
            // that is already stored, so picking it is a no-op.
          }}
        >
          <option value="all">{t('notifications.scopeAll')}</option>
          {scoped && !matchedView && <option value="custom">{t('notifications.scopeCustom')}</option>}
          {savedViews.map((v) => (
            <option key={v.id} value={`view:${v.id}`}>
              {v.name}
            </option>
          ))}
        </select>
      </label>

      {/* Plain text, not filter chips. Rendering chips would mean handing an
          arbitrary Filters to a facet list built from the live graph, and
          buildFacets omits a facet whose dimension is currently empty — so a
          constrained dimension could vanish from the summary. Under-reporting
          the scope of a *notification* filter reads as "I am told about more
          than I am", which is the worse direction to be wrong in. */}
      {scoped ? (
        <div className="notif-scope-lines">
          {scopeLines.map((line) => (
            <div key={line.label} className="notif-scope-line">
              <span className="notif-scope-dim">{line.label}</span>
              <span className="notif-scope-op">
                {line.negated ? t('notifications.scopeIsNot') : t('notifications.scopeIs')}
              </span>
              <span className="notif-scope-vals">{line.values.join(', ') || '✓'}</span>
            </div>
          ))}
          {scopeLines.length === 0 && (
            <div className="settings-help">{t('notifications.scopeSummaryEmpty')}</div>
          )}
        </div>
      ) : (
        <div className="settings-help" style={{ marginBottom: 6 }}>
          {t('notifications.scopeSummaryAll')}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <button type="button" onClick={() => setScopeQuery(currentQuery())}>
          {t('notifications.scopeCurrent')}
        </button>
        {scoped && (
          <button type="button" onClick={() => setScopeQuery('')}>
            {t('notifications.scopeReset')}
          </button>
        )}
      </div>
      <div className="settings-help" style={{ marginBottom: 12 }}>
        {t('notifications.scopeCurrentHint')}
      </div>

      {/* The third way in, below the two quick ones: build the scope from
          scratch. Collapsed by default because it is the long path — and
          because its counts cost a pass over every issue, which a settings
          page that merely mounted should not pay. */}
      <NotificationScopeEditor />
    </>
  )
}
